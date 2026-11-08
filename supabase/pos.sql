-- ============================================================================
-- Sistema de ventas (punto de venta) de Ichiraku Ramen.
-- Ejecutar en Supabase → SQL Editor DESPUÉS de supabase/gestion.sql.
-- Se puede ejecutar más de una vez.
--
-- Cuentas:
--   · «sala»: la cuenta compartida de las tablets y la laptop de caja. Cada persona
--     se identifica además con su PIN de 4 dígitos (Gestión → Nómina).
--   · «impresora»: la usa el puente de impresión de la laptop de caja. Solo puede
--     leer la cola de impresión y guardar la tasa del día.
-- Todo pasa por funciones (RPC) que comprueban el dispositivo y el PIN, y dejan
-- registro de quién hizo cada cosa. Las tablas no se pueden tocar directamente.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- Roles
alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_check
  check (role in ('dueño', 'admin', 'cajero', 'cocina', 'sala', 'impresora'));

alter table public.employees add column if not exists pos_pin_hash text;
alter table public.gestion_settings add column if not exists service_pct numeric(5,2) not null default 10
  check (service_pct between 0 and 100);

-- ---------------------------------------------------------------- Tablas
create table if not exists public.pos_rates (
  rate_date  date primary key,
  eur        numeric(14,4) not null check (eur > 0),   -- Bs por 1 euro (tasa BCV)
  source     text not null default 'manual',
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_tables (
  id       bigint generated always as identity primary key,
  area     text not null,
  number   int  not null,
  position int  not null default 0,
  active   boolean not null default true,
  unique (area, number)
);
insert into public.pos_tables (area, number, position)
select a.area, n, a.pos * 100 + n
from (values ('Feria', 20, 1), ('Tokio', 8, 2), ('Edo', 5, 3)) as a(area, cnt, pos),
     generate_series(1, a.cnt) n
on conflict (area, number) do nothing;

create table if not exists public.pos_sessions (
  id          bigint generated always as identity primary key,
  opened_at   timestamptz not null default now(),
  opened_by   bigint references public.employees(id) on delete set null,
  opening_usd numeric(12,2) not null default 0,
  opening_bs  numeric(14,2) not null default 0,
  closed_at   timestamptz,
  closed_by   bigint references public.employees(id) on delete set null,
  expected    jsonb,
  counted     jsonb,
  notes       text not null default '',
  status      text not null default 'abierta' check (status in ('abierta', 'cerrada'))
);
create unique index if not exists pos_sessions_one_open on public.pos_sessions ((true)) where status = 'abierta';

create table if not exists public.pos_orders (
  id              bigint generated always as identity primary key,
  kind            text not null default 'mesa' check (kind in ('mesa', 'llevar')),
  table_id        bigint references public.pos_tables(id) on delete set null,
  label           text not null default '',
  status          text not null default 'abierta' check (status in ('abierta', 'cobrada', 'anulada')),
  service_pct     numeric(5,2) not null default 0,
  discount        numeric(12,2) not null default 0 check (discount >= 0),
  discount_reason text not null default '',
  discount_by     bigint references public.employees(id) on delete set null,
  opened_by       bigint references public.employees(id) on delete set null,
  opened_at       timestamptz not null default now(),
  closed_by       bigint references public.employees(id) on delete set null,
  closed_at       timestamptz,
  session_id      bigint references public.pos_sessions(id) on delete set null,
  rate            numeric(14,4),
  void_reason     text not null default ''
);
alter table public.pos_orders drop constraint if exists pos_orders_kind_check;
alter table public.pos_orders add constraint pos_orders_kind_check check (kind in ('mesa', 'llevar', 'delivery'));
alter table public.pos_orders add column if not exists phone        text not null default '';
alter table public.pos_orders add column if not exists address      text not null default '';
alter table public.pos_orders add column if not exists delivery_fee numeric(10,2) not null default 0 check (delivery_fee >= 0);
alter table public.pos_orders add column if not exists precuenta_at timestamptz;
alter table public.pos_orders add column if not exists day_number   int;   -- número de orden del día (1, 2, 3…)
alter table public.pos_orders add column if not exists customer_id  bigint references public.customers(id) on delete set null;
-- Cuenta dividida por persona: {"n": 4, "units": {"<id del plato>": [1, 3]}} (persona de cada unidad; 0 = sin asignar)
alter table public.pos_orders add column if not exists split        jsonb;
create unique index if not exists pos_orders_one_open_per_table on public.pos_orders (table_id)
  where status = 'abierta' and table_id is not null;
create index if not exists pos_orders_closed_at on public.pos_orders (closed_at);

create table if not exists public.pos_items (
  id          bigint generated always as identity primary key,
  order_id    bigint not null references public.pos_orders(id) on delete cascade,
  dish_id     bigint references public.dishes(id) on delete set null,
  name        text not null,
  variant     text not null default '',
  option      text not null default '',
  notes       text not null default '',
  qty         numeric(8,2) not null check (qty > 0),
  unit_price  numeric(10,2) not null check (unit_price >= 0),
  status      text not null default 'pendiente' check (status in ('pendiente', 'enviado', 'anulado')),
  created_by  bigint references public.employees(id) on delete set null,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  void_reason text not null default '',
  voided_by   bigint references public.employees(id) on delete set null,
  voided_at   timestamptz
);
create index if not exists pos_items_order on public.pos_items (order_id);

-- Métodos: en divisas (cuentan 1 a 1 con el precio Ref) o en bolívares (a la tasa del día).
create table if not exists public.pos_payments (
  id         bigint generated always as identity primary key,
  order_id   bigint not null references public.pos_orders(id) on delete cascade,
  method     text not null check (method in ('efectivo_usd', 'zelle', 'binance', 'paypal',
                                             'efectivo_bs', 'pago_movil', 'punto_debito', 'punto_credito')),
  currency   text not null check (currency in ('REF', 'BS')),
  amount     numeric(14,2) not null,          -- en su moneda; negativo = vuelto entregado
  amount_ref numeric(12,2) not null,
  rate       numeric(14,4),
  reference  text not null default '',
  created_by bigint references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  session_id bigint references public.pos_sessions(id) on delete set null
);
create index if not exists pos_payments_session on public.pos_payments (session_id);
alter table public.pos_payments add column if not exists person smallint;   -- persona que pagó (cuenta dividida)

create table if not exists public.pos_print_jobs (
  id         bigint generated always as identity primary key,
  printer    text not null check (printer in ('cocina', 'caja', 'edo')),
  body       text not null,
  status     text not null default 'pendiente' check (status in ('pendiente', 'impreso', 'error')),
  attempts   int  not null default 0,
  error      text not null default '',
  created_at timestamptz not null default now(),
  printed_at timestamptz
);
alter table public.pos_print_jobs drop constraint if exists pos_print_jobs_printer_check;
alter table public.pos_print_jobs add constraint pos_print_jobs_printer_check check (printer in ('cocina', 'caja', 'edo'));
create index if not exists pos_print_jobs_pending on public.pos_print_jobs (id) where status <> 'impreso';

create table if not exists public.pos_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  employee_id bigint references public.employees(id) on delete set null,
  action      text not null,
  order_id    bigint,
  detail      jsonb not null default '{}'::jsonb
);

-- Solo lectura para dueño/admin (con 2FA); el resto pasa por las funciones.
do $$
declare t text;
begin
  foreach t in array array['pos_rates', 'pos_tables', 'pos_sessions', 'pos_orders', 'pos_items',
                           'pos_payments', 'pos_print_jobs', 'pos_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "manage %1$s" on public.%1$I', t);
    execute format('create policy "manage %1$s" on public.%1$I for select to authenticated using (public.can_manage())', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
drop policy if exists "manage pos_tables write" on public.pos_tables;
create policy "manage pos_tables write" on public.pos_tables for all to authenticated
  using (public.can_manage()) with check (public.can_manage());

-- ---------------------------------------------------------------- Ayudas
create or replace function public.pos_is_device() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.staff_role(), '') in ('sala', 'dueño', 'admin', 'cajero')
$$;

-- Comprueba dispositivo + PIN; devuelve el id del empleado o lanza un error.
create or replace function public.pos_auth(p_emp bigint, p_pin text) returns bigint
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not public.pos_is_device() then raise exception 'Este dispositivo no está autorizado'; end if;
  if not exists (select 1 from public.employees e where e.id = p_emp and e.active and e.pos_pin_hash is not null
                 and e.pos_pin_hash = extensions.crypt(coalesce(p_pin, ''), e.pos_pin_hash)) then
    raise exception 'PIN incorrecto. Vuelve a entrar.';
  end if;
  return p_emp;
end $$;

create or replace function public.pos_emp_name(p_emp bigint) returns text
language sql stable security definer set search_path = public as $$
  select case when position('·' in e.job_title) > 0 then trim(split_part(e.job_title, '·', 2))
              else split_part(trim(e.name), ' ', 1) end
  from public.employees e where e.id = p_emp
$$;

create or replace function public.pos_rate() returns numeric
language sql stable security definer set search_path = public as $$
  select eur from public.pos_rates where rate_date <= (now() at time zone 'America/Caracas')::date
  order by rate_date desc limit 1
$$;

create or replace function public.pos_money(x numeric) returns text
language sql immutable as $$ select to_char(coalesce(x, 0), 'FM999G999G990D00') $$;

create or replace function public.pos_order_label(p_order bigint) returns text
language sql stable security definer set search_path = public as $$
  select case when o.kind = 'mesa' then coalesce(t.area || ' ' || t.number, 'Mesa')
              when o.kind = 'delivery' then 'Delivery' || case when o.label <> '' then ': ' || o.label else '' end
              else 'Para llevar' || case when o.label <> '' then ': ' || o.label else '' end end
  from public.pos_orders o left join public.pos_tables t on t.id = o.table_id where o.id = p_order
$$;

-- subtotal (con IVA) · descuento · servicio · delivery · total · pagado
drop function if exists public.pos_totals(bigint);
create or replace function public.pos_totals(p_order bigint)
returns table (subtotal numeric, discount numeric, service numeric, delivery numeric, total numeric, paid numeric)
language sql stable security definer set search_path = public as $$
  with s as (
    select coalesce(sum(i.qty * i.unit_price) filter (where i.status <> 'anulado'), 0) as sub, o.discount, o.service_pct, o.delivery_fee
    from public.pos_orders o left join public.pos_items i on i.order_id = o.id
    where o.id = p_order group by o.id
  ), b as (select sub, least(discount, sub) as disc, service_pct, delivery_fee from s)
  select round(sub, 2), round(disc, 2), round((sub - disc) * service_pct / 100, 2), round(delivery_fee, 2),
         round(sub - disc, 2) + round((sub - disc) * service_pct / 100, 2) + round(delivery_fee, 2),
         coalesce((select sum(amount_ref) from public.pos_payments where order_id = p_order), 0) from b
$$;

-- Nombre de cada persona en una cuenta dividida (el color es el mismo de la pantalla)
create or replace function public.pos_person_name(p int) returns text
language sql immutable as $$
  select case when p between 1 and 8
    then 'Persona ' || p || ' - ' || (array['Azul', 'Rojo', 'Verde', 'Naranja', 'Morado', 'Rosado', 'Turquesa', 'Amarillo'])[p]
    else 'Sin asignar' end
$$;

-- Unidades de cada plato con su persona (2 Gyozas = 2 unidades que pueden ser de personas distintas)
create or replace function public.pos_split_units(p_order bigint)
returns table (item_id bigint, unit int, person int, name text, variant text, price numeric)
language sql stable security definer set search_path = public as $$
  select i.id, k, coalesce((o.split -> 'units' -> i.id::text ->> (k - 1))::int, 0),
         i.name, i.variant, round(i.unit_price * least(1, i.qty - (k - 1)), 2)
  from public.pos_orders o join public.pos_items i on i.order_id = o.id and i.status <> 'anulado'
  cross join lateral generate_series(1, ceil(i.qty)::int) k
  where o.id = p_order
$$;

-- Cuánto le toca a cada persona: sus platos + su parte del descuento y del servicio (proporcional)
-- + delivery en partes iguales. Los céntimos de redondeo los absorbe la última persona.
create or replace function public.pos_split(p_order bigint)
returns table (person int, subtotal numeric, discount numeric, service numeric, delivery numeric, total numeric, paid numeric)
language plpgsql stable security definer set search_path = public as $$
declare o record; t record; n int; r record; acc numeric := 0; lastp int;
begin
  select * into o from public.pos_orders where id = p_order;
  n := coalesce((o.split ->> 'n')::int, 0);
  if n < 2 then return; end if;
  select * into t from public.pos_totals(p_order);
  select max(u.person) into lastp from public.pos_split_units(p_order) u where u.person > 0;
  for r in
    select g.p, coalesce(sum(u.price), 0) as sub
    from (select generate_series(1, n) p union select 0 where exists (select 1 from public.pos_split_units(p_order) x where x.person = 0)) g
    left join public.pos_split_units(p_order) u on u.person = g.p
    group by g.p order by case when g.p = 0 then 99 else g.p end
  loop
    person := r.p; subtotal := round(r.sub, 2);
    discount := case when t.subtotal > 0 then round(t.discount * r.sub / t.subtotal, 2) else 0 end;
    service := round((subtotal - discount) * o.service_pct / 100, 2);
    delivery := case when r.p > 0 then round(t.delivery / n, 2) else 0 end;
    total := subtotal - discount + service + delivery;
    if r.p = lastp and r.p > 0 and not exists (select 1 from public.pos_split_units(p_order) x where x.person = 0) then
      total := t.total - acc;  -- cuadra los céntimos
    end if;
    acc := acc + total;
    paid := coalesce((select sum(amount_ref) from public.pos_payments where order_id = p_order and pos_payments.person = r.p), 0);
    return next;
  end loop;
end $$;

create or replace function public.pos_print(p_printer text, p_body text) returns void
language sql security definer set search_path = public as $$
  insert into public.pos_print_jobs (printer, body) values (p_printer, p_body)
$$;

create or replace function public.pos_now_txt() returns text
language sql stable as $$ select to_char(now() at time zone 'America/Caracas', 'DD/MM/YYYY HH24:MI') $$;

create or replace function public.pos_line(l text, r text, w int default 48) returns text
language sql immutable as $$
  select case when length(l) + length(r) + 1 > w then left(l, greatest(w - length(r) - 1, 1)) else l end
         || repeat(' ', greatest(w - least(length(l), greatest(w - length(r) - 1, 1)) - length(r), 1)) || r
$$;

-- Siguiente número de orden del día (hora de Caracas).
create or replace function public.pos_next_number() returns int
language sql volatile security definer set search_path = public as $$
  select coalesce(max(day_number), 0) + 1 from public.pos_orders
  where (opened_at at time zone 'America/Caracas')::date = (now() at time zone 'America/Caracas')::date
$$;

-- ---------------------------------------------------------------- Mejores vendedores (incentivos)
-- Cada plato cuenta para quien lo pidió en la tablet; solo pedidos cobrados y sin anulaciones.
-- Ventas en Ref con IVA, sin el 10 % de servicio.
create or replace function public.pos_ranking(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.created_by, 'name', public.pos_emp_name(x.created_by), 'sales', x.sales, 'items', x.items, 'orders', x.orders)
                  order by x.sales desc, x.items desc), '[]'::jsonb)
  from (select i.created_by, round(sum(i.qty * i.unit_price), 2) sales, sum(i.qty) items, count(distinct i.order_id) orders
        from public.pos_items i join public.pos_orders o on o.id = i.order_id
        where o.status = 'cobrada' and i.status <> 'anulado' and i.created_by is not null
          and (o.closed_at at time zone 'America/Caracas')::date between p_from and p_to
        group by i.created_by) x
$$;

create or replace function public.pos_tops() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date := (now() at time zone 'America/Caracas')::date;
begin
  if not (public.pos_is_device() or public.can_manage()) then raise exception 'Sin permiso'; end if;
  return jsonb_build_object(
    'day',   jsonb_build_object('from', d, 'to', d, 'rows', public.pos_ranking(d, d)),
    'week',  jsonb_build_object('from', date_trunc('week', d)::date, 'to', d, 'rows', public.pos_ranking(date_trunc('week', d)::date, d)),
    'month', jsonb_build_object('from', date_trunc('month', d)::date, 'to', d, 'rows', public.pos_ranking(date_trunc('month', d)::date, d)));
end $$;

-- ---------------------------------------------------------------- Lectura
create or replace function public.pos_staff() returns table (id bigint, name text)
language sql stable security definer set search_path = public as $$
  select e.id, public.pos_emp_name(e.id) from public.employees e
  where public.pos_is_device() and e.active and e.pos_pin_hash is not null order by 2
$$;

create or replace function public.pos_check_pin(p_emp bigint, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare fails int; ok boolean;
begin
  if not public.pos_is_device() then return jsonb_build_object('ok', false, 'error', 'Este dispositivo no está autorizado'); end if;
  select count(*) into fails from public.pos_log where employee_id = p_emp and action = 'pin_fallido' and at > now() - interval '10 minutes';
  if fails >= 5 then return jsonb_build_object('ok', false, 'error', 'Demasiados intentos. Espera 10 minutos.'); end if;
  select exists (select 1 from public.employees e where e.id = p_emp and e.active and e.pos_pin_hash is not null
                 and e.pos_pin_hash = extensions.crypt(coalesce(p_pin, ''), e.pos_pin_hash)) into ok;
  insert into public.pos_log (employee_id, action) values (p_emp, case when ok then 'entrada' else 'pin_fallido' end);
  return case when ok then jsonb_build_object('ok', true, 'name', public.pos_emp_name(p_emp))
              else jsonb_build_object('ok', false, 'error', 'PIN incorrecto') end;
end $$;

create or replace function public.pos_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.pos_is_device() then raise exception 'Este dispositivo no está autorizado'; end if;
  select jsonb_build_object(
    'rate', public.pos_rate(),
    'rate_date', (select max(rate_date) from public.pos_rates where rate_date <= (now() at time zone 'America/Caracas')::date),
    'service_pct', coalesce((select service_pct from public.gestion_settings limit 1), 10),
    'session', (select jsonb_build_object('id', s.id, 'opened_at', s.opened_at, 'opened_by', public.pos_emp_name(s.opened_by))
                from public.pos_sessions s where s.status = 'abierta'),
    'tables', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'area', t.area, 'number', t.number) order by t.position), '[]'::jsonb)
               from public.pos_tables t where t.active),
    'orders', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', o.id, 'kind', o.kind, 'table_id', o.table_id, 'label', public.pos_order_label(o.id), 'day_number', o.day_number,
                 'opened_at', o.opened_at, 'opened_by', public.pos_emp_name(o.opened_by),
                 'total', (select total from public.pos_totals(o.id)),
                 'paid', (select paid from public.pos_totals(o.id)),
                 'precuenta_at', o.precuenta_at, 'phone', o.phone,
                 'pending', (select count(*) from public.pos_items i where i.order_id = o.id and i.status = 'pendiente'),
                 'items', (select count(*) from public.pos_items i where i.order_id = o.id and i.status <> 'anulado')) order by o.opened_at), '[]'::jsonb)
               from public.pos_orders o where o.status = 'abierta'),
    'printer_backlog', (select count(*) from public.pos_print_jobs where status <> 'impreso' and created_at > now() - interval '1 day'),
    'printer_oldest', (select min(created_at) from public.pos_print_jobs where status = 'pendiente' and created_at > now() - interval '1 day')
  ) into r;
  return r;
end $$;

create or replace function public.pos_order(p_order bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.pos_is_device() then raise exception 'Este dispositivo no está autorizado'; end if;
  select jsonb_build_object(
    'id', o.id, 'kind', o.kind, 'table_id', o.table_id, 'label', public.pos_order_label(o.id), 'status', o.status, 'day_number', o.day_number,
    'service_pct', o.service_pct, 'discount_reason', o.discount_reason, 'opened_at', o.opened_at,
    'customer', o.label, 'phone', o.phone, 'address', o.address, 'delivery_fee', o.delivery_fee, 'precuenta_at', o.precuenta_at,
    'client', (select jsonb_build_object('id', c.id, 'name', c.name, 'doc_id', c.doc_id, 'phone', c.phone, 'email', c.email) from public.customers c where c.id = o.customer_id),
    'opened_by', public.pos_emp_name(o.opened_by),
    'totals', (select to_jsonb(x) from public.pos_totals(o.id) x),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', i.id, 'dish_id', i.dish_id, 'name', i.name, 'variant', i.variant, 'option', i.option, 'notes', i.notes,
                'qty', i.qty, 'unit_price', i.unit_price, 'status', i.status, 'void_reason', i.void_reason,
                'by', public.pos_emp_name(i.created_by)) order by i.id), '[]'::jsonb)
              from public.pos_items i where i.order_id = o.id),
    'split', o.split,
    'split_totals', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.pos_split(o.id) x),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('method', p.method, 'currency', p.currency, 'amount', p.amount,
                   'amount_ref', p.amount_ref, 'reference', p.reference, 'person', p.person) order by p.id), '[]'::jsonb)
                 from public.pos_payments p where p.order_id = o.id)
  ) into r from public.pos_orders o where o.id = p_order;
  return r;
end $$;

-- ---------------------------------------------------------------- Pedidos
create or replace function public.pos_open(p_emp bigint, p_pin text, p_table bigint default null, p_label text default '')
returns bigint language plpgsql security definer set search_path = public as $$
declare oid bigint; svc numeric;
begin
  perform public.pos_auth(p_emp, p_pin);
  if p_table is not null then
    select id into oid from public.pos_orders where table_id = p_table and status = 'abierta';
    if oid is not null then return oid; end if;
    if not exists (select 1 from public.pos_tables where id = p_table and active) then raise exception 'Mesa no encontrada'; end if;
    select coalesce(service_pct, 10) into svc from public.gestion_settings limit 1;
    insert into public.pos_orders (kind, table_id, service_pct, opened_by, day_number) values ('mesa', p_table, coalesce(svc, 10), p_emp, public.pos_next_number()) returning id into oid;
  else
    insert into public.pos_orders (kind, label, service_pct, opened_by, day_number) values ('llevar', left(coalesce(trim(p_label), ''), 40), 0, p_emp, public.pos_next_number()) returning id into oid;
  end if;
  insert into public.pos_log (employee_id, action, order_id) values (p_emp, 'abrir', oid);
  return oid;
end $$;

-- p_items: [{"dish_id": 1, "variant": "Peq", "option": "Fresa", "notes": "sin cebollín", "qty": 2}]
create or replace function public.pos_add(p_emp bigint, p_pin text, p_order bigint, p_items jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare it record; d record; price numeric; n int := 0;
begin
  perform public.pos_auth(p_emp, p_pin);
  if not exists (select 1 from public.pos_orders where id = p_order and status = 'abierta') then raise exception 'El pedido ya está cerrado'; end if;
  for it in select * from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
            as x(dish_id bigint, variant text, option text, notes text, qty numeric) loop
    select * into d from public.dishes where id = it.dish_id;
    if d.id is null then raise exception 'Plato no encontrado'; end if;
    if not d.available then raise exception '% está agotado', d.name; end if;
    if coalesce(it.qty, 0) <= 0 or it.qty > 99 then raise exception 'Cantidad no válida'; end if;
    price := d.price;
    if jsonb_typeof(d.variants) = 'array' and jsonb_array_length(d.variants) > 0 then
      select (v ->> 'price')::numeric into price from jsonb_array_elements(d.variants) v where v ->> 'label' = coalesce(it.variant, '');
      if price is null then raise exception 'Elige el tamaño de %', d.name; end if;
    end if;
    insert into public.pos_items (order_id, dish_id, name, variant, option, notes, qty, unit_price, created_by)
    values (p_order, d.id, d.name, coalesce(it.variant, ''), left(coalesce(it.option, ''), 40), left(coalesce(trim(it.notes), ''), 120), it.qty, price, p_emp);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Envía a cocina lo pendiente e imprime la comanda.
create or replace function public.pos_send(p_emp bigint, p_pin text, p_order bigint)
returns int language plpgsql security definer set search_path = public as $$
declare body text; n int; num int; added boolean; lines text;
begin
  perform public.pos_auth(p_emp, p_pin);
  select count(*) into n from public.pos_items where order_id = p_order and status = 'pendiente';
  if n = 0 then return 0; end if;
  select day_number into num from public.pos_orders where id = p_order;
  added := exists (select 1 from public.pos_items x where x.order_id = p_order and x.status in ('enviado', 'anulado'));
  select string_agg('^' || trim(to_char(i.qty, 'FM990.##')) || ' ' || i.name ||
                    case when i.variant <> '' then ' ' || i.variant else '' end ||
                    case when i.option <> '' then E'\n  ' || i.option else '' end ||
                    case when i.notes <> '' then E'\n  >> ' || i.notes else '' end, E'\n' order by i.id)
    into lines from public.pos_items i where i.order_id = p_order and i.status = 'pendiente';
  body := '^' || public.pos_order_label(p_order) || E'\n' || case when added then E'^+ AGREGADO\n' else '' end ||
          coalesce('Orden #' || num || '   ', '') || public.pos_now_txt() || '  ' || coalesce(public.pos_emp_name(p_emp), '') || E'\n=\n' || lines || E'\n=';
  update public.pos_items set status = 'enviado', sent_at = now() where order_id = p_order and status = 'pendiente';
  perform public.pos_print('cocina', body);
  -- Copia para la comandera de pedidos de afuera (impresora de caja)
  perform public.pos_print('caja', '^ORDEN #' || coalesce(num::text, '-') || case when added then ' (+ agregado)' else '' end || E'\n' ||
    '^' || public.pos_order_label(p_order) || E'\n' || public.pos_line('Hora: ' || to_char(now() at time zone 'America/Caracas', 'HH24:MI'),
    'Maid: ' || coalesce(public.pos_emp_name(p_emp), '')) || E'\n=\n' || lines || E'\n=');
  insert into public.pos_log (employee_id, action, order_id, detail) values (p_emp, 'enviar', p_order, jsonb_build_object('platos', n));
  return n;
end $$;

-- Quitar un plato: si no se ha enviado se borra; si ya está en cocina se anula con motivo.
create or replace function public.pos_void(p_emp bigint, p_pin text, p_item bigint, p_reason text default '')
returns text language plpgsql security definer set search_path = public as $$
declare it record;
begin
  perform public.pos_auth(p_emp, p_pin);
  select i.*, o.status as ostatus into it from public.pos_items i join public.pos_orders o on o.id = i.order_id where i.id = p_item;
  if it.id is null then raise exception 'Plato no encontrado'; end if;
  if it.ostatus <> 'abierta' then raise exception 'El pedido ya está cerrado'; end if;
  if it.status = 'pendiente' then
    delete from public.pos_items where id = p_item; return 'quitado';
  end if;
  if it.status = 'anulado' then return 'ya anulado'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Escribe el motivo de la anulación'; end if;
  update public.pos_items set status = 'anulado', void_reason = trim(p_reason), voided_by = p_emp, voided_at = now() where id = p_item;
  perform public.pos_print('cocina', '^ANULAR - ' || public.pos_order_label(it.order_id) || E'\n' || public.pos_now_txt() || E'\n=\n^' ||
    trim(to_char(it.qty, 'FM990.##')) || ' ' || it.name || case when it.variant <> '' then ' ' || it.variant else '' end ||
    E'\nMotivo: ' || trim(p_reason) || E'\n=');
  insert into public.pos_log (employee_id, action, order_id, detail)
  values (p_emp, 'anular_plato', it.order_id, jsonb_build_object('plato', it.name, 'variante', it.variant, 'cantidad', it.qty,
          'monto', it.qty * it.unit_price, 'motivo', trim(p_reason)));
  return 'anulado';
end $$;

create or replace function public.pos_discount(p_emp bigint, p_pin text, p_order bigint, p_amount numeric, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.pos_auth(p_emp, p_pin);
  if coalesce(p_amount, 0) < 0 then raise exception 'Monto no válido'; end if;
  if p_amount > 0 and length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Escribe el motivo del descuento'; end if;
  update public.pos_orders set discount = round(p_amount, 2), discount_reason = trim(coalesce(p_reason, '')), discount_by = p_emp
  where id = p_order and status = 'abierta';
  if not found then raise exception 'El pedido ya está cerrado'; end if;
  insert into public.pos_log (employee_id, action, order_id, detail)
  values (p_emp, 'descuento', p_order, jsonb_build_object('monto', p_amount, 'motivo', trim(coalesce(p_reason, ''))));
end $$;

-- Dividir la cuenta por persona (lo hace caja al cobrar). p_split null o n < 2 = quitar la división.
create or replace function public.pos_set_split(p_emp bigint, p_pin text, p_order bigint, p_split jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare n int; clean jsonb := '{}'::jsonb; it record; arr jsonb; v int; k int;
begin
  perform public.pos_auth(p_emp, p_pin);
  if not exists (select 1 from public.pos_orders where id = p_order and status = 'abierta') then raise exception 'El pedido ya está cerrado'; end if;
  n := coalesce((p_split ->> 'n')::int, 0);
  if n < 2 then
    update public.pos_orders set split = null where id = p_order;
    insert into public.pos_log (employee_id, action, order_id, detail) values (p_emp, 'dividir', p_order, jsonb_build_object('personas', 0));
    return;
  end if;
  if n > 8 then raise exception 'Máximo 8 personas'; end if;
  -- Solo se guardan platos de este pedido y personas válidas
  for it in select i.id, ceil(i.qty)::int as units from public.pos_items i where i.order_id = p_order and i.status <> 'anulado' loop
    arr := '[]'::jsonb;
    for k in 0 .. it.units - 1 loop
      v := coalesce((p_split -> 'units' -> it.id::text ->> k)::int, 0);
      if v < 0 or v > n then v := 0; end if;
      arr := arr || to_jsonb(v);
    end loop;
    clean := clean || jsonb_build_object(it.id::text, arr);
  end loop;
  update public.pos_orders set split = jsonb_build_object('n', n, 'units', clean) where id = p_order;
  insert into public.pos_log (employee_id, action, order_id, detail) values (p_emp, 'dividir', p_order, jsonb_build_object('personas', n));
end $$;

create or replace function public.pos_move(p_emp bigint, p_pin text, p_order bigint, p_table bigint)
returns void language plpgsql security definer set search_path = public as $$
declare old text;
begin
  perform public.pos_auth(p_emp, p_pin);
  if exists (select 1 from public.pos_orders where table_id = p_table and status = 'abierta') then raise exception 'Esa mesa está ocupada'; end if;
  old := public.pos_order_label(p_order);
  update public.pos_orders set table_id = p_table, kind = 'mesa' where id = p_order and status = 'abierta' and kind = 'mesa';
  if not found then raise exception 'No se puede mover este pedido'; end if;
  perform public.pos_print('cocina', '^CAMBIO DE MESA' || E'\n' || old || ' -> ' || public.pos_order_label(p_order) || E'\n' || public.pos_now_txt() || E'\n=');
  insert into public.pos_log (employee_id, action, order_id, detail) values (p_emp, 'mover', p_order, jsonb_build_object('de', old));
end $$;

create or replace function public.pos_bill_text(p_order bigint, p_title text) returns text
language sql stable security definer set search_path = public as $$
  with t as (select * from public.pos_totals(p_order)), o as (select * from public.pos_orders where id = p_order),
       r as (select coalesce(o.rate, public.pos_rate()) as rate from o)
  select E'~^ICHIRAKU RAMEN\n~' || p_title || E'\n' || public.pos_order_label(p_order) || '   ' || public.pos_now_txt() || E'\n=\n' ||
    case when coalesce((o.split ->> 'n')::int, 0) < 2 then
    coalesce((select string_agg(public.pos_line(trim(to_char(g.q, 'FM990.##')) || ' ' || g.name ||
                case when g.variant <> '' then ' ' || g.variant else '' end, public.pos_money(g.amt)), E'\n' order by g.first)
              from (select i.name, i.variant, sum(i.qty) q, sum(i.qty * i.unit_price) amt, min(i.id) first
                    from public.pos_items i where i.order_id = p_order and i.status <> 'anulado'
                    group by i.name, i.variant, i.unit_price) g), '') || E'\n=\n'
    else
    -- Cuenta dividida: una sección por persona con sus platos y lo que le toca pagar
    (select string_agg(
       '~^' || upper(public.pos_person_name(sp.person)) || E'\n' ||
       coalesce((select string_agg(public.pos_line(g.q || ' ' || g.name || case when g.variant <> '' then ' ' || g.variant else '' end,
                   public.pos_money(g.amt)), E'\n' order by g.first)
                 from (select u.name, u.variant, count(*) q, sum(u.price) amt, min(u.item_id) first
                       from public.pos_split_units(p_order) u where u.person = sp.person group by u.name, u.variant) g), '') || E'\n' ||
       case when sp.discount > 0 then public.pos_line('  Descuento', '-' || public.pos_money(sp.discount)) || E'\n' else '' end ||
       case when sp.service > 0 then public.pos_line('  Servicio ' || trim(to_char(o.service_pct, 'FM990.##')) || '%', public.pos_money(sp.service)) || E'\n' else '' end ||
       case when sp.delivery > 0 then public.pos_line('  Delivery', public.pos_money(sp.delivery)) || E'\n' else '' end ||
       '~^Ref ' || public.pos_money(sp.total) || E'\n' ||
       case when sp.paid >= sp.total - 0.02 and sp.total > 0 then E'~(PAGADO)\n'
            when r.rate is not null then '~Bs ' || public.pos_money(round((sp.total - sp.paid) * r.rate, 2)) || E'\n' else '' end ||
       E'=\n', '' order by case when sp.person = 0 then 99 else sp.person end)
     from public.pos_split(p_order) sp)
    end ||
    public.pos_line('Subtotal', 'Ref ' || public.pos_money(t.subtotal)) || E'\n' ||
    case when t.discount > 0 then public.pos_line('Descuento', '-Ref ' || public.pos_money(t.discount)) || E'\n' else '' end ||
    case when t.service > 0 then public.pos_line('Servicio ' || trim(to_char(o.service_pct, 'FM990.##')) || '%', 'Ref ' || public.pos_money(t.service)) || E'\n' else '' end ||
    case when t.delivery > 0 then public.pos_line('Delivery', 'Ref ' || public.pos_money(t.delivery)) || E'\n' else '' end ||
    E'=\n~^TOTAL  Ref ' || public.pos_money(t.total) || E'\n' ||
    case when r.rate is not null then E'~^Bs ' || public.pos_money(round(t.total * r.rate, 2)) || E'\n~(tasa ' || public.pos_money(r.rate) || E')\n=\n' else E'=\n' end ||
    case when t.paid > 0 and t.paid < t.total - 0.02 then public.pos_line('Pagado', 'Ref ' || public.pos_money(t.paid)) || E'\n' ||
      E'~^RESTA  Ref ' || public.pos_money(t.total - t.paid) || E'\n' else '' end ||
    coalesce((select 'Cliente: ' || c.name || case when coalesce(c.doc_id, '') <> '' then '  CI/RIF: ' || c.doc_id else '' end || E'\n'
              from public.customers c where c.id = o.customer_id and o.kind <> 'delivery'), '') ||
    case when o.kind = 'delivery' then 'Cliente: ' || o.label || case when o.phone <> '' then '  Tel: ' || o.phone else '' end ||
      case when o.address <> '' then E'\nDireccion: ' || o.address else '' end || E'\n' else '' end ||
    '~Precios con IVA incluido.'
  from t, o, r
$$;

create or replace function public.pos_precuenta(p_emp bigint, p_pin text, p_order bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.pos_auth(p_emp, p_pin);
  update public.pos_orders set precuenta_at = now() where id = p_order;
  -- Las mesas de Edo (arriba) imprimen la precuenta en su propia impresora.
  perform public.pos_print(case when exists (select 1 from public.pos_orders o join public.pos_tables t on t.id = o.table_id where o.id = p_order and t.area = 'Edo')
                                then 'edo' else 'caja' end,
                           E'@logo\n' || public.pos_bill_text(p_order, 'PRECUENTA - no es factura') || E'\n\n~Gracias por tu visita!');
  insert into public.pos_log (employee_id, action, order_id) values (p_emp, 'precuenta', p_order);
end $$;

-- p_payments: [{"method": "pago_movil", "amount": 1520.50, "reference": "1234"}, {"method": "efectivo_usd", "amount": 20}]
-- p_change_currency: en qué se entrega el vuelto si sobra ('REF' = dólares en efectivo, 'BS' = bolívares en efectivo).
-- p_partial = true: abono (por ejemplo, cada persona paga su parte); el pedido sigue abierto hasta completar.
drop function if exists public.pos_pay(bigint, text, bigint, jsonb, text);
create or replace function public.pos_pay(p_emp bigint, p_pin text, p_order bigint, p_payments jsonb, p_change_currency text default 'REF', p_partial boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; t record; sess bigint; rt numeric; p record; cur text; ref numeric; paid numeric := 0; over numeric; chg jsonb := null; due numeric; who int; pover numeric := 0;
begin
  perform public.pos_auth(p_emp, p_pin);
  select * into o from public.pos_orders where id = p_order for update;
  if o.id is null or o.status <> 'abierta' then raise exception 'El pedido ya está cerrado'; end if;
  if exists (select 1 from public.pos_items where order_id = p_order and status = 'pendiente') then
    raise exception 'Hay platos sin enviar a cocina: envíalos o quítalos antes de cobrar';
  end if;
  select id into sess from public.pos_sessions where status = 'abierta';
  if sess is null then raise exception 'La caja está cerrada: ábrela antes de cobrar'; end if;
  select * into t from public.pos_totals(p_order);
  due := round(t.total - t.paid, 2);
  rt := public.pos_rate();
  for p in select * from jsonb_to_recordset(coalesce(p_payments, '[]'::jsonb)) as x(method text, amount numeric, reference text, person int) loop
    if coalesce(p.amount, 0) <= 0 then continue; end if;
    if p.person is not null and (p.person < 1 or p.person > coalesce((o.split ->> 'n')::int, 0)) then p.person := null; end if;
    who := coalesce(p.person, who);
    cur := case when p.method in ('efectivo_usd', 'zelle', 'binance', 'paypal') then 'REF' else 'BS' end;
    if cur = 'BS' and rt is null then raise exception 'Falta la tasa del día para cobrar en bolívares'; end if;
    ref := case when cur = 'REF' then round(p.amount, 2) else round(p.amount / rt, 2) end;
    insert into public.pos_payments (order_id, method, currency, amount, amount_ref, rate, reference, created_by, session_id, person)
    values (p_order, p.method, cur, round(p.amount, 2), ref, case when cur = 'BS' then rt end, left(coalesce(trim(p.reference), ''), 40), p_emp, sess, p.person);
    paid := paid + ref;
  end loop;
  if paid <= 0 then raise exception 'Escribe el monto a cobrar'; end if;
  if paid < due - 0.02 then
    if not coalesce(p_partial, false) then raise exception 'Falta por cobrar Ref %', public.pos_money(due - paid); end if;
    -- Cuenta dividida: si la persona pagó más de lo que le toca, se le da vuelto
    if who is not null then
      select round(x.paid - x.total, 2) into pover from public.pos_split(p_order) x where x.person = who;
      if coalesce(pover, 0) > 0.02 then
        if coalesce(p_change_currency, 'REF') = 'BS' and rt is not null then
          insert into public.pos_payments (order_id, method, currency, amount, amount_ref, rate, reference, created_by, session_id, person)
          values (p_order, 'efectivo_bs', 'BS', -round(pover * rt, 2), -pover, rt, 'vuelto', p_emp, sess, who);
          chg := jsonb_build_object('currency', 'BS', 'amount', round(pover * rt, 2));
        else
          insert into public.pos_payments (order_id, method, currency, amount, amount_ref, reference, created_by, session_id, person)
          values (p_order, 'efectivo_usd', 'REF', -pover, -pover, 'vuelto', p_emp, sess, who);
          chg := jsonb_build_object('currency', 'REF', 'amount', pover);
        end if;
        paid := paid - pover;
      else pover := 0;
      end if;
    end if;
    perform public.pos_print('caja', '^ABONO' || case when who is not null then E'\n^' || upper(public.pos_person_name(who)) else '' end || E'\n' || public.pos_order_label(p_order) || '   ' || public.pos_now_txt() || E'\n=\n' ||
      public.pos_line('Abonado ahora', 'Ref ' || public.pos_money(paid)) || E'\n' ||
      case when pover > 0 then public.pos_line('Vuelto', case when chg ->> 'currency' = 'BS' then 'Bs ' else 'Ref ' end || public.pos_money((chg ->> 'amount')::numeric)) || E'\n' else '' end ||
      public.pos_line('Total de la cuenta', 'Ref ' || public.pos_money(t.total)) || E'\n^' ||
      public.pos_line('RESTA', 'Ref ' || public.pos_money(due - paid), 24) || E'\n\nNo es factura fiscal.');
    insert into public.pos_log (employee_id, action, order_id, detail) values (p_emp, 'abono', p_order, jsonb_build_object('monto', paid));
    return jsonb_build_object('total', t.total, 'paid', paid, 'rest', round(due - paid, 2), 'change', chg, 'closed', false);
  end if;
  over := round(paid - due, 2);
  if over > 0.02 then
    if coalesce(p_change_currency, 'REF') = 'BS' and rt is not null then
      insert into public.pos_payments (order_id, method, currency, amount, amount_ref, rate, reference, created_by, session_id, person)
      values (p_order, 'efectivo_bs', 'BS', -round(over * rt, 2), -over, rt, 'vuelto', p_emp, sess, who);
      chg := jsonb_build_object('currency', 'BS', 'amount', round(over * rt, 2));
    else
      insert into public.pos_payments (order_id, method, currency, amount, amount_ref, reference, created_by, session_id, person)
      values (p_order, 'efectivo_usd', 'REF', -over, -over, 'vuelto', p_emp, sess, who);
      chg := jsonb_build_object('currency', 'REF', 'amount', over);
    end if;
  end if;
  update public.pos_orders set status = 'cobrada', closed_by = p_emp, closed_at = now(), session_id = sess, rate = rt where id = p_order;
  perform public.pos_print('caja', public.pos_bill_text(p_order, 'RECIBO - no es factura fiscal') || E'\n=\n' ||
    (select string_agg(public.pos_line(case when p2.person is not null then 'P' || p2.person || ' ' else '' end || case p2.method when 'efectivo_usd' then 'Efectivo $' when 'efectivo_bs' then 'Efectivo Bs'
               when 'pago_movil' then 'Pago movil' when 'punto_debito' then 'Punto debito' when 'punto_credito' then 'Punto credito'
               else initcap(p2.method) end || case when p2.reference = 'vuelto' then ' (vuelto)' else '' end,
             case when p2.currency = 'BS' then 'Bs ' else 'Ref ' end || public.pos_money(p2.amount)), E'\n' order by p2.id)
     from public.pos_payments p2 where p2.order_id = p_order) || E'\n\n~Gracias por tu visita!');
  insert into public.pos_log (employee_id, action, order_id, detail) values (p_emp, 'cobrar', p_order, jsonb_build_object('total', t.total));
  return jsonb_build_object('total', t.total, 'paid', paid, 'rest', 0, 'change', chg, 'closed', true);
end $$;

create or replace function public.pos_cancel(p_emp bigint, p_pin text, p_order bigint, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
declare sent int;
begin
  perform public.pos_auth(p_emp, p_pin);
  if exists (select 1 from public.pos_payments where order_id = p_order) then raise exception 'Este pedido ya tiene pagos: no se puede anular'; end if;
  select count(*) into sent from public.pos_items where order_id = p_order and status = 'enviado';
  if sent > 0 and length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Escribe el motivo de la anulación'; end if;
  if sent > 0 then
    perform public.pos_print('cocina', '^ANULAR PEDIDO' || E'\n' || public.pos_order_label(p_order) || E'\n' || public.pos_now_txt() ||
      E'\nMotivo: ' || trim(p_reason) || E'\n=');
  end if;
  update public.pos_items set status = 'anulado', void_reason = trim(coalesce(p_reason, '')), voided_by = p_emp, voided_at = now()
  where order_id = p_order and status = 'enviado';
  delete from public.pos_items where order_id = p_order and status = 'pendiente';
  update public.pos_orders set status = 'anulada', void_reason = trim(coalesce(p_reason, '')), closed_by = p_emp, closed_at = now(),
    session_id = (select id from public.pos_sessions where status = 'abierta')
  where id = p_order and status = 'abierta';
  if not found then raise exception 'El pedido ya está cerrado'; end if;
  insert into public.pos_log (employee_id, action, order_id, detail)
  values (p_emp, 'anular_pedido', p_order, jsonb_build_object('motivo', trim(coalesce(p_reason, '')), 'platos_enviados', sent));
end $$;

-- ---------------------------------------------------------------- Tasa del día
-- p_date: «fecha valor» del BCV (publica en la tarde la tasa del día siguiente). Solo el puente puede fijarla;
-- desde la sala siempre es la de hoy.
drop function if exists public.pos_set_rate(numeric, text, bigint, text);
create or replace function public.pos_set_rate(p_rate numeric, p_source text default 'bcv', p_emp bigint default null, p_pin text default null, p_date date default null)
returns void language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'America/Caracas')::date;
begin
  if coalesce(public.staff_role(), '') <> 'impresora' then perform public.pos_auth(p_emp, p_pin);
  elsif p_date is not null and p_date between d - 7 and d + 7 then d := p_date; end if;
  if coalesce(p_rate, 0) <= 0 then raise exception 'Tasa no válida'; end if;
  insert into public.pos_rates (rate_date, eur, source, updated_at)
  values (d, round(p_rate, 4), coalesce(p_source, 'manual'), now())
  on conflict (rate_date) do update set eur = excluded.eur, source = excluded.source, updated_at = now();
  insert into public.pos_log (employee_id, action, detail) values (p_emp, 'tasa', jsonb_build_object('eur', p_rate, 'fuente', p_source, 'fecha', d));
end $$;

-- ---------------------------------------------------------------- Caja
create or replace function public.pos_cash_open(p_emp bigint, p_pin text, p_usd numeric default 0, p_bs numeric default 0)
returns bigint language plpgsql security definer set search_path = public as $$
declare sid bigint;
begin
  perform public.pos_auth(p_emp, p_pin);
  if exists (select 1 from public.pos_sessions where status = 'abierta') then raise exception 'La caja ya está abierta'; end if;
  insert into public.pos_sessions (opened_by, opening_usd, opening_bs) values (p_emp, coalesce(p_usd, 0), coalesce(p_bs, 0)) returning id into sid;
  insert into public.pos_log (employee_id, action, detail) values (p_emp, 'abrir_caja', jsonb_build_object('fondo_usd', p_usd, 'fondo_bs', p_bs));
  return sid;
end $$;

create or replace function public.pos_cash_summary(p_session bigint default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s record; r jsonb;
begin
  if not (public.pos_is_device() or public.can_manage()) then raise exception 'Sin permiso'; end if;
  select * into s from public.pos_sessions where id = coalesce(p_session, (select id from public.pos_sessions where status = 'abierta'));
  if s.id is null then return null; end if;
  select jsonb_build_object(
    'id', s.id, 'status', s.status, 'opened_at', s.opened_at, 'closed_at', s.closed_at,
    'opened_by', public.pos_emp_name(s.opened_by), 'opening_usd', s.opening_usd, 'opening_bs', s.opening_bs,
    'methods', (select coalesce(jsonb_object_agg(m.method, jsonb_build_object('currency', m.currency, 'amount', m.amount, 'amount_ref', m.amount_ref)), '{}'::jsonb)
                from (select method, min(currency) currency, sum(amount) amount, sum(amount_ref) amount_ref
                      from public.pos_payments where session_id = s.id group by method) m),
    'orders', (select count(*) from public.pos_orders where session_id = s.id and status = 'cobrada'),
    'sales', (select coalesce(sum(t.subtotal - t.discount), 0) from public.pos_orders o, public.pos_totals(o.id) t where o.session_id = s.id and o.status = 'cobrada'),
    'service', (select coalesce(sum(t.service), 0) from public.pos_orders o, public.pos_totals(o.id) t where o.session_id = s.id and o.status = 'cobrada'),
    'delivery', (select coalesce(sum(t.delivery), 0) from public.pos_orders o, public.pos_totals(o.id) t where o.session_id = s.id and o.status = 'cobrada'),
    'discounts', (select coalesce(jsonb_agg(jsonb_build_object('order', public.pos_order_label(o.id), 'amount', o.discount, 'reason', o.discount_reason,
                    'by', public.pos_emp_name(o.discount_by))), '[]'::jsonb)
                  from public.pos_orders o where o.session_id = s.id and o.discount > 0 and o.status = 'cobrada'),
    'voids', (select coalesce(jsonb_agg(jsonb_build_object('order', public.pos_order_label(i.order_id), 'item', i.name ||
                case when i.variant <> '' then ' ' || i.variant else '' end, 'qty', i.qty, 'amount', i.qty * i.unit_price,
                'reason', i.void_reason, 'by', public.pos_emp_name(i.voided_by), 'at', i.voided_at) order by i.voided_at), '[]'::jsonb)
              from public.pos_items i where i.status = 'anulado' and i.voided_at >= s.opened_at and i.voided_at <= coalesce(s.closed_at, now())),
    'open_orders', (select count(*) from public.pos_orders where status = 'abierta'),
    'expected', s.expected, 'counted', s.counted, 'notes', s.notes
  ) into r;
  return r;
end $$;

-- Rehace las ventas de un día en la gestión (Ventas e Inventario) a partir de los pedidos cobrados.
create or replace function public.pos_sync_day(p_date date) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.daily_sales (sale_date, total, service_amount, by_method, tickets, source, notes, updated_at)
  select p_date,
    coalesce(sum(t.subtotal - t.discount + t.delivery), 0), coalesce(sum(t.service), 0),
    coalesce((select jsonb_object_agg(k, v) from (
      select case p.method when 'punto_debito' then 'debito' when 'punto_credito' then 'credito' when 'pago_movil' then 'pago_movil'
                           when 'efectivo_usd' then 'efectivo' when 'efectivo_bs' then 'efectivo' else 'otros' end k, round(sum(p.amount_ref), 2) v
      from public.pos_payments p join public.pos_orders o2 on o2.id = p.order_id
      where o2.status = 'cobrada' and (o2.closed_at at time zone 'America/Caracas')::date = p_date group by 1) m), '{}'::jsonb),
    count(*), 'pos', 'Sistema de ventas propio', now()
  from public.pos_orders o, public.pos_totals(o.id) t
  where o.status = 'cobrada' and (o.closed_at at time zone 'America/Caracas')::date = p_date
  on conflict (sale_date) do update set total = excluded.total, service_amount = excluded.service_amount, by_method = excluded.by_method,
    tickets = excluded.tickets, source = excluded.source, notes = excluded.notes, updated_at = now();
  delete from public.sales_items where sale_date = p_date;
  insert into public.sales_items (sale_date, dish_id, dish_name, variant, qty, amount)
  select p_date, i.dish_id, i.name, i.variant, sum(i.qty), sum(i.qty * i.unit_price)
  from public.pos_items i join public.pos_orders o on o.id = i.order_id
  where o.status = 'cobrada' and i.status <> 'anulado' and (o.closed_at at time zone 'America/Caracas')::date = p_date
  group by i.dish_id, i.name, i.variant;
  perform public.apply_sales_consumption(p_date);
end $$;

-- ---------------------------------------------------------------- Reporte detallado del cierre (para el correo)
alter table public.gestion_settings add column if not exists report_emails text not null default '';
create table if not exists public.pos_reports (
  id         bigint generated always as identity primary key,
  session_id bigint references public.pos_sessions(id) on delete cascade,
  recipients text not null,
  data       jsonb not null,
  status     text not null default 'pendiente' check (status in ('pendiente', 'enviado', 'error')),
  attempts   int  not null default 0,
  error      text not null default '',
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
alter table public.pos_reports enable row level security;
drop policy if exists "manage pos_reports" on public.pos_reports;
create policy "manage pos_reports" on public.pos_reports for select to authenticated using (public.can_manage());
revoke all on public.pos_reports from anon;

create or replace function public.pos_session_report(p_session bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (select * from public.pos_sessions where id = p_session),
  o as (select o.*, t.subtotal, t.discount as disc, t.service, t.delivery, t.total from public.pos_orders o, public.pos_totals(o.id) t
        where o.session_id = p_session),
  it as (select i.*, o.status as ostatus from public.pos_items i join o on o.id = i.order_id)
  select jsonb_build_object(
    'session', (select jsonb_build_object('id', s.id, 'opened_at', s.opened_at, 'closed_at', s.closed_at, 'opened_by', public.pos_emp_name(s.opened_by),
                 'closed_by', public.pos_emp_name(s.closed_by), 'opening_usd', s.opening_usd, 'opening_bs', s.opening_bs,
                 'expected', s.expected, 'counted', s.counted, 'notes', s.notes) from s),
    'rate', public.pos_rate(),
    'totals', (select jsonb_build_object('orders', count(*) filter (where status = 'cobrada'), 'cancelled', count(*) filter (where status = 'anulada'),
                 'sales', coalesce(sum(subtotal - disc) filter (where status = 'cobrada'), 0), 'discounts', coalesce(sum(disc) filter (where status = 'cobrada'), 0),
                 'service', coalesce(sum(service) filter (where status = 'cobrada'), 0), 'delivery', coalesce(sum(delivery) filter (where status = 'cobrada'), 0),
                 'total', coalesce(sum(total) filter (where status = 'cobrada'), 0)) from o),
    'methods', (select coalesce(jsonb_agg(jsonb_build_object('method', method, 'currency', currency, 'amount', amount, 'amount_ref', amount_ref, 'count', n) order by amount_ref desc), '[]'::jsonb)
                from (select method, min(currency) currency, sum(amount) amount, sum(amount_ref) amount_ref, count(*) n from public.pos_payments where session_id = p_session group by method) m),
    'by_kind', (select coalesce(jsonb_agg(jsonb_build_object('kind', k, 'orders', n, 'total', tt) order by tt desc), '[]'::jsonb)
                from (select case when o.kind = 'mesa' then coalesce(t.area, 'Mesa') when o.kind = 'delivery' then 'Delivery' else 'Para llevar' end k, count(*) n, sum(o.total) tt
                      from o left join public.pos_tables t on t.id = o.table_id where o.status = 'cobrada' group by 1) x),
    'dishes', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'variant', variant, 'qty', q, 'amount', a) order by a desc), '[]'::jsonb)
               from (select name, variant, sum(qty) q, sum(qty * unit_price) a from it where status <> 'anulado' and ostatus = 'cobrada' group by name, variant) x),
    'staff', (select coalesce(jsonb_agg(jsonb_build_object('name', n, 'orders', c, 'total', tt) order by tt desc), '[]'::jsonb)
              from (select public.pos_emp_name(opened_by) n, count(*) c, sum(total) tt from o where status = 'cobrada' group by opened_by) x),
    'hours', (select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'orders', c, 'total', tt) order by h), '[]'::jsonb)
              from (select extract(hour from closed_at at time zone 'America/Caracas')::int h, count(*) c, sum(total) tt from o where status = 'cobrada' group by 1) x),
    'orders', (select coalesce(jsonb_agg(jsonb_build_object('label', public.pos_order_label(o.id), 'status', o.status, 'opened_at', o.opened_at, 'closed_at', o.closed_at,
                 'waiter', public.pos_emp_name(o.opened_by), 'cashier', public.pos_emp_name(o.closed_by), 'total', o.total, 'service', o.service,
                 'client', (select c.name || coalesce(' (' || c.doc_id || ')', '') from public.customers c where c.id = o.customer_id),
                 'discount', o.discount, 'delivery', o.delivery, 'void_reason', o.void_reason,
                 'items', (select string_agg(trim(to_char(i.qty, 'FM990.##')) || ' ' || i.name || case when i.variant <> '' then ' ' || i.variant else '' end ||
                            case when i.status = 'anulado' then ' (anulado)' else '' end, ', ' order by i.id) from it i where i.order_id = o.id),
                 'payments', (select string_agg(p.method || ' ' || p.amount || case when p.reference not in ('', 'vuelto') then ' #' || p.reference
                               when p.reference = 'vuelto' then ' (vuelto)' else '' end, ', ' order by p.id) from public.pos_payments p where p.order_id = o.id)
               ) order by o.closed_at), '[]'::jsonb) from o),
    'voids', (select coalesce(jsonb_agg(jsonb_build_object('order', public.pos_order_label(i.order_id), 'item', i.name || case when i.variant <> '' then ' ' || i.variant else '' end,
                'qty', i.qty, 'amount', i.qty * i.unit_price, 'reason', i.void_reason, 'by', public.pos_emp_name(i.voided_by), 'at', i.voided_at) order by i.voided_at), '[]'::jsonb)
              from public.pos_items i, s where i.status = 'anulado' and i.voided_at between s.opened_at and coalesce(s.closed_at, now())),
    'discounts', (select coalesce(jsonb_agg(jsonb_build_object('order', public.pos_order_label(id), 'amount', discount, 'reason', discount_reason, 'by', public.pos_emp_name(discount_by))), '[]'::jsonb)
                  from o where discount > 0 and status = 'cobrada'),
    'cancelled', (select coalesce(jsonb_agg(jsonb_build_object('order', public.pos_order_label(id), 'reason', void_reason, 'by', public.pos_emp_name(closed_by))), '[]'::jsonb)
                  from o where status = 'anulada'),
    'tops', (select jsonb_build_object(
               'day', public.pos_ranking(d, d), 'week', public.pos_ranking(date_trunc('week', d)::date, d), 'month', public.pos_ranking(date_trunc('month', d)::date, d))
             from (select (coalesce((select closed_at from s), now()) at time zone 'America/Caracas')::date d) dd)
  )
$$;

create or replace function public.pos_report_next() returns setof public.pos_reports
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.staff_role(), '') not in ('impresora', 'dueño', 'admin') then raise exception 'Sin permiso'; end if;
  return query select * from public.pos_reports where status = 'pendiente' or (status = 'error' and attempts < 10) order by id limit 5;
end $$;
create or replace function public.pos_report_done(p_id bigint, p_ok boolean, p_error text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.staff_role(), '') not in ('impresora', 'dueño', 'admin') then raise exception 'Sin permiso'; end if;
  update public.pos_reports set status = case when p_ok then 'enviado' else 'error' end, attempts = attempts + 1,
    error = case when p_ok then '' else left(coalesce(p_error, ''), 300) end, sent_at = case when p_ok then now() end where id = p_id;
end $$;

-- p_counted: {"efectivo_usd": 120, "efectivo_bs": 3500, "pago_movil": 15000, "punto_debito": 8000, ...} (en su moneda)
create or replace function public.pos_cash_close(p_emp bigint, p_pin text, p_counted jsonb, p_notes text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record; sm jsonb; exp jsonb; body text; d date; k text; rcp text;
  names jsonb := '{"efectivo_usd":"Efectivo $","zelle":"Zelle","binance":"Binance","paypal":"PayPal","efectivo_bs":"Efectivo Bs",
                   "pago_movil":"Pago movil","punto_debito":"Punto debito","punto_credito":"Punto credito"}';
begin
  perform public.pos_auth(p_emp, p_pin);
  select * into s from public.pos_sessions where status = 'abierta' for update;
  if s.id is null then raise exception 'La caja no está abierta'; end if;
  if exists (select 1 from public.pos_orders where status = 'abierta') then raise exception 'Hay mesas abiertas: cóbralas o anúlalas antes de cerrar'; end if;
  sm := public.pos_cash_summary(s.id);
  -- esperado por método, en su moneda (el efectivo incluye el fondo inicial)
  select jsonb_object_agg(m, round(coalesce((sm -> 'methods' -> m ->> 'amount')::numeric, 0)
           + case m when 'efectivo_usd' then s.opening_usd when 'efectivo_bs' then s.opening_bs else 0 end, 2))
    into exp from jsonb_object_keys(names) m;
  update public.pos_sessions set status = 'cerrada', closed_at = now(), closed_by = p_emp, expected = exp,
    counted = coalesce(p_counted, '{}'::jsonb), notes = coalesce(p_notes, '') where id = s.id;
  body := '^CIERRE DE CAJA' || E'\n' || 'Apertura: ' || to_char(s.opened_at at time zone 'America/Caracas', 'DD/MM HH24:MI') ||
    ' ' || coalesce(public.pos_emp_name(s.opened_by), '') || E'\nCierre:   ' || public.pos_now_txt() || ' ' || coalesce(public.pos_emp_name(p_emp), '') ||
    E'\n=\n' || public.pos_line('Pedidos cobrados', (sm ->> 'orders')) || E'\n' ||
    public.pos_line('Ventas (con IVA)', 'Ref ' || public.pos_money((sm ->> 'sales')::numeric)) || E'\n' ||
    public.pos_line('Servicio', 'Ref ' || public.pos_money((sm ->> 'service')::numeric)) || E'\n' ||
    public.pos_line('Delivery', 'Ref ' || public.pos_money((sm ->> 'delivery')::numeric)) || E'\n=\n' ||
    public.pos_line('Metodo', 'Esperado / Contado') || E'\n';
  foreach k in array array['efectivo_usd', 'efectivo_bs', 'pago_movil', 'punto_debito', 'punto_credito', 'zelle', 'binance', 'paypal'] loop
    if coalesce((exp ->> k)::numeric, 0) = 0 and not (coalesce(p_counted, '{}'::jsonb) ? k) then continue; end if;
    body := body || public.pos_line(names ->> k || case when k in ('efectivo_bs', 'pago_movil', 'punto_debito', 'punto_credito') then ' (Bs)' else ' ($)' end,
      public.pos_money((exp ->> k)::numeric) || ' / ' || case when p_counted ? k then public.pos_money((p_counted ->> k)::numeric) else 'sin contar' end) ||
      case when p_counted ? k and abs((p_counted ->> k)::numeric - (exp ->> k)::numeric) >= 0.01
           then E'\n' || public.pos_line('  Diferencia', public.pos_money((p_counted ->> k)::numeric - (exp ->> k)::numeric)) else '' end || E'\n';
  end loop;
  body := body || '=' || E'\n^ANULACIONES' || E'\n' ||
    coalesce((select string_agg(public.pos_line(trim(to_char((v ->> 'qty')::numeric, 'FM990.##')) || ' ' || (v ->> 'item'), 'Ref ' || public.pos_money((v ->> 'amount')::numeric)) ||
              E'\n  ' || (v ->> 'order') || ' - ' || coalesce(v ->> 'by', '') || E'\n  Motivo: ' || (v ->> 'reason'), E'\n')
              from jsonb_array_elements(sm -> 'voids') v), 'Ninguna') ||
    E'\n=\n^DESCUENTOS\n' ||
    coalesce((select string_agg(public.pos_line(v ->> 'order', 'Ref ' || public.pos_money((v ->> 'amount')::numeric)) ||
              E'\n  ' || coalesce(v ->> 'by', '') || ' - Motivo: ' || (v ->> 'reason'), E'\n')
              from jsonb_array_elements(sm -> 'discounts') v), 'Ninguno') ||
    case when coalesce(p_notes, '') <> '' then E'\n=\nNotas: ' || p_notes else '' end || E'\n=';
  -- Mejores vendedores (día, semana y mes)
  body := body || E'\n^MEJORES VENDEDORES\n' ||
    coalesce((select string_agg(case r.n when 1 then '1. ' when 2 then '2. ' else '3. ' end || public.pos_line(r.v ->> 'name', 'Ref ' || public.pos_money((r.v ->> 'sales')::numeric), 45), E'\n' order by r.n)
              from (select v, row_number() over () n from jsonb_array_elements(public.pos_ranking((now() at time zone 'America/Caracas')::date, (now() at time zone 'America/Caracas')::date)) v limit 3) r), 'Sin ventas hoy') ||
    E'\n' || public.pos_line('Lider de la semana', coalesce((public.pos_tops() -> 'week' -> 'rows' -> 0 ->> 'name') || ' Ref ' || public.pos_money((public.pos_tops() -> 'week' -> 'rows' -> 0 ->> 'sales')::numeric), '-')) ||
    E'\n' || public.pos_line('Lider del mes', coalesce((public.pos_tops() -> 'month' -> 'rows' -> 0 ->> 'name') || ' Ref ' || public.pos_money((public.pos_tops() -> 'month' -> 'rows' -> 0 ->> 'sales')::numeric), '-')) || E'\n=';
  perform public.pos_print('caja', body);
  insert into public.pos_log (employee_id, action, detail) values (p_emp, 'cerrar_caja', jsonb_build_object('sesion', s.id));
  select trim(report_emails) into rcp from public.gestion_settings limit 1;
  if coalesce(rcp, '') <> '' then
    insert into public.pos_reports (session_id, recipients, data) values (s.id, rcp, public.pos_session_report(s.id));
  end if;
  for d in select distinct (closed_at at time zone 'America/Caracas')::date from public.pos_orders where session_id = s.id and status = 'cobrada' loop
    perform public.pos_sync_day(d);
  end loop;
  return public.pos_cash_summary(s.id);
end $$;

-- ---------------------------------------------------------------- Puente de impresión (cuenta «impresora»)
create or replace function public.pos_print_next(p_limit int default 10)
returns setof public.pos_print_jobs language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.staff_role(), '') not in ('impresora', 'dueño', 'admin') then raise exception 'Sin permiso'; end if;
  return query select * from public.pos_print_jobs
    where (status = 'pendiente' or (status = 'error' and attempts < 20)) and created_at > now() - interval '1 day'
    order by id limit greatest(1, least(coalesce(p_limit, 10), 50));
end $$;

create or replace function public.pos_print_done(p_id bigint, p_ok boolean, p_error text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.staff_role(), '') not in ('impresora', 'dueño', 'admin') then raise exception 'Sin permiso'; end if;
  update public.pos_print_jobs set status = case when p_ok then 'impreso' else 'error' end, attempts = attempts + 1,
    error = case when p_ok then '' else left(coalesce(p_error, ''), 300) end, printed_at = case when p_ok then now() end
  where id = p_id;
end $$;

-- ---------------------------------------------------------------- PIN (dueño/admin desde Gestión, o n8n)
create or replace function public.pos_set_pin(p_emp bigint, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.can_manage_or_service() then raise exception 'Sin permiso'; end if;
  if p_pin is null or p_pin = '' then update public.employees set pos_pin_hash = null where id = p_emp; return; end if;
  if p_pin !~ '^[0-9]{4}$' then raise exception 'El PIN debe tener 4 dígitos'; end if;
  if exists (select 1 from public.employees where id <> p_emp and pos_pin_hash is not null and pos_pin_hash = extensions.crypt(p_pin, pos_pin_hash)) then
    raise exception 'Ese PIN ya lo usa otra persona: elige otro';
  end if;
  update public.employees set pos_pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)) where id = p_emp;
end $$;

-- ---------------------------------------------------------------- Delivery
create or replace function public.pos_open_delivery(p_emp bigint, p_pin text, p_name text, p_phone text default '', p_address text default '', p_fee numeric default 0)
returns bigint language plpgsql security definer set search_path = public as $$
declare oid bigint;
begin
  perform public.pos_auth(p_emp, p_pin);
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Escribe el nombre del cliente'; end if;
  insert into public.pos_orders (kind, label, phone, address, delivery_fee, service_pct, opened_by, day_number)
  values ('delivery', left(trim(p_name), 40), left(trim(coalesce(p_phone, '')), 30), left(trim(coalesce(p_address, '')), 200), greatest(coalesce(p_fee, 0), 0), 0, p_emp, public.pos_next_number())
  returning id into oid;
  insert into public.pos_log (employee_id, action, order_id) values (p_emp, 'abrir', oid);
  return oid;
end $$;

create or replace function public.pos_set_delivery(p_emp bigint, p_pin text, p_order bigint, p_name text, p_phone text, p_address text, p_fee numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.pos_auth(p_emp, p_pin);
  update public.pos_orders set label = left(trim(coalesce(p_name, label)), 40), phone = left(trim(coalesce(p_phone, '')), 30),
    address = left(trim(coalesce(p_address, '')), 200), delivery_fee = greatest(coalesce(p_fee, 0), 0)
  where id = p_order and status = 'abierta' and kind = 'delivery';
  if not found then raise exception 'No se puede cambiar este pedido'; end if;
end $$;

-- ---------------------------------------------------------------- Datos del cliente (al cobrar)
create or replace function public.pos_doc(p text) returns text
language sql immutable as $$ select nullif(upper(regexp_replace(coalesce(p, ''), '[\s.\-]', '', 'g')), '') $$;

create or replace function public.pos_customer_id(d text) returns bigint
language sql stable security definer set search_path = public as $$
  select id from public.customers
  where d is not null and regexp_replace(doc_id, '^[VEJGP]', '') = regexp_replace(d, '^[VEJGP]', '')
  order by (doc_id = d) desc, id limit 1
$$;

-- Busca un cliente por cédula o RIF exactos (para autocompletar).
create or replace function public.pos_find_customer(p_emp bigint, p_pin text, p_doc text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d text := public.pos_doc(p_doc); r jsonb;
begin
  perform public.pos_auth(p_emp, p_pin);
  if d is null or length(d) < 5 then return null; end if;
  select jsonb_build_object('id', id, 'name', name, 'doc_id', doc_id, 'phone', phone, 'email', email, 'marketing_consent', marketing_consent)
    into r from public.customers where id = public.pos_customer_id(d);
  return r;
end $$;

-- Guarda (o actualiza) el cliente y lo une al pedido.
create or replace function public.pos_set_customer(p_emp bigint, p_pin text, p_order bigint, p_doc text, p_name text,
  p_phone text default '', p_email text default '', p_consent boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d text := public.pos_doc(p_doc); cid bigint;
begin
  perform public.pos_auth(p_emp, p_pin);
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Escribe el nombre del cliente'; end if;
  cid := public.pos_customer_id(d);
  if cid is null then
    insert into public.customers (doc_id, name, phone, email, registered_at, source, marketing_consent, consent_at)
    values (d, left(trim(p_name), 80), left(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), 20), left(lower(trim(coalesce(p_email, ''))), 120),
            (now() at time zone 'America/Caracas')::date, 'pos', coalesce(p_consent, false), case when p_consent then now() end)
    returning id into cid;
  else
    update public.customers set name = left(trim(p_name), 80),
      phone = coalesce(nullif(left(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), 20), ''), phone),
      email = coalesce(nullif(left(lower(trim(coalesce(p_email, ''))), 120), ''), email),
      marketing_consent = marketing_consent or coalesce(p_consent, false),
      consent_at = case when p_consent and not marketing_consent then now() else consent_at end
    where id = cid;
  end if;
  update public.pos_orders set customer_id = cid where id = p_order;
  insert into public.pos_log (employee_id, action, order_id, detail) values (p_emp, 'cliente', p_order, jsonb_build_object('cliente', cid));
  return jsonb_build_object('id', cid);
end $$;

-- ---------------------------------------------------------------- Agotados (desde la caja)
create or replace function public.pos_set_available(p_emp bigint, p_pin text, p_dish bigint, p_available boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.pos_auth(p_emp, p_pin);
  update public.dishes set available = coalesce(p_available, true) where id = p_dish;
  insert into public.pos_log (employee_id, action, detail) values (p_emp, case when p_available then 'disponible' else 'agotado' end, jsonb_build_object('plato', p_dish));
end $$;

-- ---------------------------------------------------------------- Conteo de inventario (desde la caja)
create or replace function public.pos_inventory() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.pos_is_device() then coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'unit', buy_unit,
    'stock', stock_qty, 'min', min_qty) order by name), '[]'::jsonb) end from public.ingredients
$$;
-- p_counts: [{"id": 3, "qty": 4.5}] en la unidad de compra del insumo
create or replace function public.pos_count(p_emp bigint, p_pin text, p_counts jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare c record; n int := 0; who text;
begin
  perform public.pos_auth(p_emp, p_pin);
  select name into who from public.employees where id = p_emp;
  for c in select * from jsonb_to_recordset(coalesce(p_counts, '[]'::jsonb)) as x(id bigint, qty numeric) loop
    if c.qty is null or c.qty < 0 then continue; end if;
    perform public.register_movement(c.id::text, 'conteo', c.qty, null, 'Conteo desde caja', who, 'pos');
    n := n + 1;
  end loop;
  insert into public.pos_log (employee_id, action, detail) values (p_emp, 'conteo', jsonb_build_object('insumos', n));
  return n;
end $$;

-- ---------------------------------------------------------------- Permisos de las funciones
do $$
declare f text;
begin
  foreach f in array array[
    'pos_is_device()', 'pos_auth(bigint, text)', 'pos_emp_name(bigint)', 'pos_rate()', 'pos_order_label(bigint)', 'pos_totals(bigint)',
    'pos_print(text, text)', 'pos_next_number()', 'pos_staff()', 'pos_check_pin(bigint, text)', 'pos_state()', 'pos_order(bigint)',
    'pos_open(bigint, text, bigint, text)', 'pos_add(bigint, text, bigint, jsonb)', 'pos_send(bigint, text, bigint)',
    'pos_void(bigint, text, bigint, text)', 'pos_discount(bigint, text, bigint, numeric, text)', 'pos_move(bigint, text, bigint, bigint)',
    'pos_bill_text(bigint, text)', 'pos_precuenta(bigint, text, bigint)', 'pos_pay(bigint, text, bigint, jsonb, text, boolean)',
    'pos_open_delivery(bigint, text, text, text, text, numeric)', 'pos_set_delivery(bigint, text, bigint, text, text, text, numeric)',
    'pos_set_available(bigint, text, bigint, boolean)', 'pos_find_customer(bigint, text, text)',
    'pos_set_customer(bigint, text, bigint, text, text, text, text, boolean)', 'pos_inventory()', 'pos_count(bigint, text, jsonb)',
    'pos_session_report(bigint)', 'pos_report_next()', 'pos_report_done(bigint, boolean, text)', 'pos_ranking(date, date)', 'pos_tops()',
    'pos_cancel(bigint, text, bigint, text)', 'pos_set_rate(numeric, text, bigint, text, date)', 'pos_cash_open(bigint, text, numeric, numeric)',
    'pos_cash_summary(bigint)', 'pos_sync_day(date)', 'pos_cash_close(bigint, text, jsonb, text)', 'pos_print_next(int)',
    'pos_print_done(bigint, boolean, text)', 'pos_set_pin(bigint, text)', 'pos_set_split(bigint, text, bigint, jsonb)',
    'pos_split(bigint)', 'pos_split_units(bigint)', 'pos_person_name(int)'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
-- Funciones internas: solo las llaman otras funciones.
revoke execute on function public.pos_print(text, text) from authenticated;
revoke execute on function public.pos_sync_day(date) from authenticated;
revoke execute on function public.pos_bill_text(bigint, text) from authenticated;
revoke execute on function public.pos_session_report(bigint) from authenticated;
revoke execute on function public.pos_next_number() from authenticated;
revoke execute on function public.pos_ranking(date, date) from authenticated;
revoke execute on function public.pos_customer_id(text) from anon, public, authenticated;
