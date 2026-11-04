-- Gestión de costos: áreas, nómina, gastos, insumos y recetas.
-- Ejecutar UNA vez en Supabase → SQL Editor, después de schema.sql.
-- Se puede volver a ejecutar sin perder datos.
--
-- Seguridad: nada de esto es público. Solo pueden leer y escribir las cuentas
-- que estén en la tabla "staff" con rol dueño o admin. Al ejecutar este
-- archivo se añaden automáticamente los usuarios que ya existen en
-- Authentication → Users (hoy, tu cuenta de administrador).

-- ---------------------------------------------------------------- Personal autorizado
create table if not exists public.staff (
  email      text primary key,
  name       text not null default '',
  role       text not null default 'dueño' check (role in ('dueño', 'admin', 'cajero')),
  created_at timestamptz not null default now()
);

create or replace function public.can_manage() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and role in ('dueño', 'admin')
  );
$$;

insert into public.staff (email)
select lower(email) from auth.users where email is not null
on conflict (email) do nothing;

-- ---------------------------------------------------------------- Áreas
create table if not exists public.cost_areas (
  id       bigint generated always as identity primary key,
  name     text not null unique,
  position int  not null default 0
);

insert into public.cost_areas (name, position) values
  ('Administrativo', 1), ('Cocina', 2), ('Salón y barra', 3), ('Seguridad y cámaras', 4)
on conflict (name) do nothing;

-- ---------------------------------------------------------------- Nómina (quincenal)
create table if not exists public.employees (
  id            bigint generated always as identity primary key,
  name          text not null,
  job_title     text not null default '',
  area_id       bigint references public.cost_areas(id) on delete set null,
  pay_quincena  numeric(12,2) not null default 0 check (pay_quincena >= 0),  -- pago por quincena
  monthly_extra numeric(12,2) not null default 0 check (monthly_extra >= 0), -- bonos u otros pagos al mes
  active        boolean not null default true,
  start_date    date,
  notes         text not null default '',
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- Gastos
-- fijo: se repite todos los meses (alquiler, internet). variable: ocurre una vez, en su fecha.
create table if not exists public.expenses (
  id           bigint generated always as identity primary key,
  area_id      bigint references public.cost_areas(id) on delete set null,
  concept      text not null,
  amount       numeric(12,2) not null check (amount >= 0),
  kind         text not null default 'variable' check (kind in ('fijo', 'variable')),
  expense_date date not null default current_date,
  notes        text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists expenses_date_idx on public.expenses (expense_date);

-- ---------------------------------------------------------------- Insumos
-- Precio de compra: buy_price por buy_qty buy_unit (p. ej. Ref 10 por 2.5 kg).
-- waste_pct: merma (lo que se pierde al limpiar o cocinar), sube el costo real.
create table if not exists public.ingredients (
  id         bigint generated always as identity primary key,
  name       text not null unique,
  buy_unit   text not null default 'kg' check (buy_unit in ('kg', 'g', 'l', 'ml', 'unidad')),
  buy_qty    numeric(12,3) not null default 1 check (buy_qty > 0),
  buy_price  numeric(12,2) not null default 0 check (buy_price >= 0),
  waste_pct  numeric(5,2) not null default 0 check (waste_pct >= 0 and waste_pct < 90),
  supplier   text not null default '',
  updated_at timestamptz not null default now()
);

drop trigger if exists ingredients_touch on public.ingredients;
create trigger ingredients_touch before update on public.ingredients
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- Recetas
-- Una línea por ingrediente. variant = tamaño del plato ('' si no tiene, o 'Peq' / 'Gr').
create table if not exists public.recipe_items (
  id            bigint generated always as identity primary key,
  dish_id       bigint not null references public.dishes(id) on delete cascade,
  variant       text not null default '',
  ingredient_id bigint not null references public.ingredients(id) on delete restrict,
  qty           numeric(12,3) not null check (qty > 0),
  unit          text not null check (unit in ('kg', 'g', 'l', 'ml', 'unidad')),
  position      int not null default 0
);
create index if not exists recipe_items_dish_idx on public.recipe_items (dish_id, variant);

-- ---------------------------------------------------------------- Permisos (RLS)
alter table public.staff        enable row level security;
alter table public.cost_areas   enable row level security;
alter table public.employees    enable row level security;
alter table public.expenses     enable row level security;
alter table public.ingredients  enable row level security;
alter table public.recipe_items enable row level security;

do $$
declare t text;
begin
  foreach t in array array['staff', 'cost_areas', 'employees', 'expenses', 'ingredients', 'recipe_items'] loop
    execute format('drop policy if exists "manage %1$s" on public.%1$I', t);
    execute format('create policy "manage %1$s" on public.%1$I for all to authenticated
                    using (public.can_manage()) with check (public.can_manage())', t);
  end loop;
end $$;

-- Nadie anónimo puede ver nada de esto.
revoke all on public.staff, public.cost_areas, public.employees, public.expenses,
              public.ingredients, public.recipe_items from anon;

-- ================================================================ Precios de proveedores
-- Los precios nuevos (de n8n o a mano) entran con propose_price(). Si el costo
-- por unidad cambia hasta auto_apply_pct (5 % por defecto) se aplica solo; si
-- cambia más, queda pendiente para aprobarlo en gestion.html → Insumos.

create table if not exists public.suppliers (
  id         bigint generated always as identity primary key,
  name       text not null unique,
  whatsapp   text not null default '',
  notes      text not null default '',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.ingredients add column if not exists supplier_id bigint references public.suppliers(id) on delete set null;

create table if not exists public.gestion_settings (
  id             int primary key default 1 check (id = 1),
  auto_apply_pct numeric(5,2) not null default 5 check (auto_apply_pct >= 0 and auto_apply_pct <= 100)
);
insert into public.gestion_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.price_updates (
  id            bigint generated always as identity primary key,
  ingredient_id bigint not null references public.ingredients(id) on delete cascade,
  supplier_id   bigint references public.suppliers(id) on delete set null,
  buy_price     numeric(12,2) not null check (buy_price >= 0),
  buy_qty       numeric(12,3) not null check (buy_qty > 0),
  buy_unit      text not null check (buy_unit in ('kg', 'g', 'l', 'ml', 'unidad')),
  old_unit_cost numeric(14,6),            -- costo por g / ml / unidad antes
  new_unit_cost numeric(14,6) not null,   -- costo por g / ml / unidad propuesto
  change_pct    numeric(8,2),             -- null si no había precio anterior
  status        text not null default 'pending' check (status in ('pending', 'applied', 'rejected')),
  reason        text not null default '',
  source        text not null default 'manual',
  raw_message   text not null default '',
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);
create index if not exists price_updates_status_idx on public.price_updates (status, created_at desc);

create table if not exists public.price_history (
  id            bigint generated always as identity primary key,
  ingredient_id bigint not null references public.ingredients(id) on delete cascade,
  old_price     numeric(12,2), old_qty numeric(12,3), old_unit text,
  new_price     numeric(12,2), new_qty numeric(12,3), new_unit text,
  source        text not null default 'manual',
  changed_at    timestamptz not null default now()
);

-- Factor a la unidad base (g, ml o unidad) y familia de la unidad.
create or replace function public.unit_factor(u text) returns numeric language sql immutable as $$
  select case u when 'kg' then 1000 when 'l' then 1000 else 1 end::numeric $$;
create or replace function public.unit_family(u text) returns text language sql immutable as $$
  select case when u in ('kg', 'g') then 'm' when u in ('l', 'ml') then 'v' else 'u' end $$;

-- Historial automático de cada cambio de precio de un insumo.
create or replace function public.log_price_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.buy_price, new.buy_qty, new.buy_unit) is distinct from (old.buy_price, old.buy_qty, old.buy_unit) then
    insert into public.price_history (ingredient_id, old_price, old_qty, old_unit, new_price, new_qty, new_unit, source)
    values (new.id, old.buy_price, old.buy_qty, old.buy_unit, new.buy_price, new.buy_qty, new.buy_unit,
            coalesce(nullif(current_setting('app.price_source', true), ''), 'manual'));
  end if;
  return new;
end $$;
drop trigger if exists ingredients_price_log on public.ingredients;
create trigger ingredients_price_log after update on public.ingredients
  for each row execute function public.log_price_change();

-- ¿Quién llama? Personal autorizado (sesión) o n8n con la service_role key.
create or replace function public.can_manage_or_service() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role' or public.can_manage()
$$;

-- Propone un precio. p_ingredient acepta el id o el nombre exacto del insumo
-- (sin distinguir mayúsculas). Devuelve {"id", "status", "change_pct", "reason"}.
create or replace function public.propose_price(
  p_ingredient text, p_buy_price numeric, p_buy_qty numeric, p_buy_unit text,
  p_supplier text default null, p_source text default 'n8n', p_raw text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ing public.ingredients; sup_id bigint; old_c numeric; new_c numeric; chg numeric;
  lim numeric; st text := 'pending'; why text := ''; new_id bigint;
begin
  if not public.can_manage_or_service() then raise exception 'Sin permiso'; end if;
  if p_buy_unit not in ('kg', 'g', 'l', 'ml', 'unidad') then raise exception 'Unidad no válida: %', p_buy_unit; end if;
  if p_buy_qty is null or p_buy_qty <= 0 or p_buy_price is null or p_buy_price < 0 then raise exception 'Precio o cantidad no válidos'; end if;

  if p_ingredient ~ '^\d+$' then select * into ing from public.ingredients where id = p_ingredient::bigint;
  else select * into ing from public.ingredients where lower(name) = lower(trim(p_ingredient)); end if;
  if ing.id is null then raise exception 'Insumo no encontrado: %', p_ingredient; end if;

  if p_supplier is not null and p_supplier <> '' then
    if p_supplier ~ '^\d+$' then select id into sup_id from public.suppliers where id = p_supplier::bigint;
    else select id into sup_id from public.suppliers where lower(name) = lower(trim(p_supplier)); end if;
  end if;

  select auto_apply_pct into lim from public.gestion_settings where id = 1;
  old_c := case when ing.buy_price > 0 then ing.buy_price / (ing.buy_qty * public.unit_factor(ing.buy_unit)) end;
  new_c := p_buy_price / (p_buy_qty * public.unit_factor(p_buy_unit));

  if public.unit_family(p_buy_unit) <> public.unit_family(ing.buy_unit) then
    why := 'La unidad cambia de tipo (' || ing.buy_unit || ' → ' || p_buy_unit || '): revisar';
  elsif old_c is null then
    st := 'applied'; why := 'Primer precio del insumo';
  else
    chg := round((new_c - old_c) / old_c * 100, 2);
    if abs(chg) <= coalesce(lim, 5) then st := 'applied'; why := 'Cambio dentro del ' || coalesce(lim, 5) || ' %';
    else why := 'Cambio mayor al ' || coalesce(lim, 5) || ' %: requiere aprobación'; end if;
  end if;

  insert into public.price_updates (ingredient_id, supplier_id, buy_price, buy_qty, buy_unit, old_unit_cost, new_unit_cost,
                                    change_pct, status, reason, source, raw_message, decided_at)
  values (ing.id, sup_id, p_buy_price, p_buy_qty, p_buy_unit, old_c, new_c, chg, st, why, coalesce(p_source, 'n8n'),
          coalesce(p_raw, ''), case when st = 'applied' then now() end)
  returning id into new_id;

  if st = 'applied' then
    perform set_config('app.price_source', coalesce(p_source, 'n8n'), true);
    update public.ingredients set buy_price = p_buy_price, buy_qty = p_buy_qty, buy_unit = p_buy_unit,
      supplier_id = coalesce(sup_id, supplier_id) where id = ing.id;
  end if;
  return jsonb_build_object('id', new_id, 'status', st, 'change_pct', chg, 'reason', why);
end $$;

-- Aprobar o rechazar un precio pendiente (desde gestion.html).
create or replace function public.decide_price(p_id bigint, p_approve boolean)
returns text language plpgsql security definer set search_path = public as $$
declare u public.price_updates;
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  select * into u from public.price_updates where id = p_id and status = 'pending' for update;
  if u.id is null then raise exception 'Ese precio ya no está pendiente'; end if;
  if p_approve then
    perform set_config('app.price_source', u.source || ' (aprobado)', true);
    update public.ingredients set buy_price = u.buy_price, buy_qty = u.buy_qty, buy_unit = u.buy_unit,
      supplier_id = coalesce(u.supplier_id, supplier_id) where id = u.ingredient_id;
  end if;
  update public.price_updates set status = case when p_approve then 'applied' else 'rejected' end, decided_at = now() where id = p_id;
  return case when p_approve then 'applied' else 'rejected' end;
end $$;

alter table public.suppliers        enable row level security;
alter table public.gestion_settings enable row level security;
alter table public.price_updates    enable row level security;
alter table public.price_history    enable row level security;
do $$
declare t text;
begin
  foreach t in array array['suppliers', 'gestion_settings', 'price_updates', 'price_history'] loop
    execute format('drop policy if exists "manage %1$s" on public.%1$I', t);
    execute format('create policy "manage %1$s" on public.%1$I for all to authenticated
                    using (public.can_manage()) with check (public.can_manage())', t);
  end loop;
end $$;
revoke all on public.suppliers, public.gestion_settings, public.price_updates, public.price_history from anon;
revoke execute on function public.propose_price(text, numeric, numeric, text, text, text, text) from anon, public;
revoke execute on function public.decide_price(bigint, boolean) from anon, public;
grant execute on function public.propose_price(text, numeric, numeric, text, text, text, text) to authenticated, service_role;
grant execute on function public.decide_price(bigint, boolean) to authenticated;

-- ================================================================ Asistencia (reconocimiento facial vía n8n)
-- El equipo facial guarda las caras; aquí solo llega QUIÉN marcó y CUÁNDO.
-- schedule: horario fijo por día ISO (1 = lunes … 7 = domingo), p. ej.
--   {"2": {"in": "12:00", "out": "22:00"}, "3": {"in": "12:00", "out": "22:00"}}
alter table public.employees add column if not exists schedule jsonb not null default '{}'::jsonb;
alter table public.employees add column if not exists device_user_id text;
create unique index if not exists employees_device_uid on public.employees (device_user_id) where device_user_id is not null and device_user_id <> '';

alter table public.gestion_settings add column if not exists late_tolerance_min int not null default 5 check (late_tolerance_min between 0 and 120);
alter table public.gestion_settings add column if not exists overtime_factor numeric(4,2) not null default 1.5 check (overtime_factor >= 0);
alter table public.gestion_settings add column if not exists service_staff_pct numeric(5,2) not null default 15 check (service_staff_pct between 0 and 100);
alter table public.gestion_settings add column if not exists fee_debito numeric(5,2) not null default 1.75;
alter table public.gestion_settings add column if not exists fee_credito numeric(5,2) not null default 4.00;
alter table public.gestion_settings add column if not exists fee_pago_movil numeric(5,2) not null default 1.90;

create table if not exists public.attendance_events (
  id          bigint generated always as identity primary key,
  employee_id bigint not null references public.employees(id) on delete cascade,
  event_time  timestamptz not null,
  kind        text not null default 'auto' check (kind in ('in', 'out', 'auto')),
  source      text not null default 'n8n',
  device_ref  text not null default '',
  created_at  timestamptz not null default now(),
  unique (employee_id, event_time)
);
create index if not exists attendance_time_idx on public.attendance_events (event_time);

-- Registra una marcación. p_employee acepta el ID del equipo facial, el número
-- de empleado o el nombre exacto. Si la marcación ya existe, no la duplica.
create or replace function public.record_attendance(
  p_employee text, p_time timestamptz, p_kind text default 'auto', p_source text default 'n8n', p_device text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare emp bigint; new_id bigint;
begin
  if not public.can_manage_or_service() then raise exception 'Sin permiso'; end if;
  select id into emp from public.employees where device_user_id = trim(p_employee);
  if emp is null and p_employee ~ '^\d+$' then select id into emp from public.employees where id = p_employee::bigint; end if;
  if emp is null then select id into emp from public.employees where lower(name) = lower(trim(p_employee)); end if;
  if emp is null then raise exception 'Empleado no encontrado: %', p_employee; end if;
  insert into public.attendance_events (employee_id, event_time, kind, source, device_ref)
  values (emp, p_time, coalesce(nullif(p_kind, ''), 'auto'), coalesce(p_source, 'n8n'), coalesce(p_device, ''))
  on conflict (employee_id, event_time) do nothing returning id into new_id;
  return jsonb_build_object('id', new_id, 'employee_id', emp, 'duplicate', new_id is null);
end $$;

-- ================================================================ Ventas diarias (vía n8n o a mano)
-- by_method: {"debito": 0, "credito": 0, "pago_movil": 0, "efectivo": 0, "otros": 0} (sin el 10 % de servicio)
create table if not exists public.daily_sales (
  sale_date      date primary key,
  total          numeric(12,2) not null default 0 check (total >= 0),   -- ventas sin servicio
  service_amount numeric(12,2) not null default 0 check (service_amount >= 0),
  by_method      jsonb not null default '{}'::jsonb,
  tickets        int not null default 0 check (tickets >= 0),
  source         text not null default 'manual',
  notes          text not null default '',
  updated_at     timestamptz not null default now()
);

create table if not exists public.sales_items (
  id        bigint generated always as identity primary key,
  sale_date date not null references public.daily_sales(sale_date) on delete cascade,
  dish_id   bigint references public.dishes(id) on delete set null,
  dish_name text not null,
  variant   text not null default '',
  qty       numeric(10,2) not null default 0 check (qty >= 0),
  amount    numeric(12,2) not null default 0 check (amount >= 0),
  unique (sale_date, dish_name, variant)
);

-- Guarda (o reemplaza) las ventas de un día. p_items: [{"name": "Hokage", "variant": "", "qty": 3, "amount": 75}, …]
-- El plato se enlaza solo con la carta si el nombre coincide (sin distinguir mayúsculas).
create or replace function public.upsert_daily_sales(
  p_date date, p_total numeric, p_service numeric default 0, p_methods jsonb default '{}'::jsonb,
  p_tickets int default 0, p_items jsonb default '[]'::jsonb, p_source text default 'n8n', p_notes text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.can_manage_or_service() then raise exception 'Sin permiso'; end if;
  insert into public.daily_sales (sale_date, total, service_amount, by_method, tickets, source, notes, updated_at)
  values (p_date, coalesce(p_total, 0), coalesce(p_service, 0), coalesce(p_methods, '{}'::jsonb), coalesce(p_tickets, 0), coalesce(p_source, 'n8n'), coalesce(p_notes, ''), now())
  on conflict (sale_date) do update set total = excluded.total, service_amount = excluded.service_amount, by_method = excluded.by_method,
    tickets = excluded.tickets, source = excluded.source, notes = excluded.notes, updated_at = now();
  delete from public.sales_items where sale_date = p_date;
  insert into public.sales_items (sale_date, dish_id, dish_name, variant, qty, amount)
  select p_date, d.id, coalesce(d.name, trim(i.name)), coalesce(trim(i.variant), ''), sum(coalesce(i.qty, 0)), sum(coalesce(i.amount, 0))
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as i(name text, variant text, qty numeric, amount numeric)
  left join public.dishes d on lower(d.name) = lower(trim(i.name))
  where coalesce(trim(i.name), '') <> ''
  group by d.id, coalesce(d.name, trim(i.name)), coalesce(trim(i.variant), '');
  get diagnostics n = row_count;
  return jsonb_build_object('date', p_date, 'items', n, 'consumo', public.apply_sales_consumption(p_date));
end $$;

alter table public.attendance_events enable row level security;
alter table public.daily_sales       enable row level security;
alter table public.sales_items       enable row level security;
do $$
declare t text;
begin
  foreach t in array array['attendance_events', 'daily_sales', 'sales_items'] loop
    execute format('drop policy if exists "manage %1$s" on public.%1$I', t);
    execute format('create policy "manage %1$s" on public.%1$I for all to authenticated
                    using (public.can_manage()) with check (public.can_manage())', t);
  end loop;
end $$;
revoke all on public.attendance_events, public.daily_sales, public.sales_items from anon;
revoke execute on function public.record_attendance(text, timestamptz, text, text, text) from anon, public;
revoke execute on function public.upsert_daily_sales(date, numeric, numeric, jsonb, int, jsonb, text, text) from anon, public;
grant execute on function public.record_attendance(text, timestamptz, text, text, text) to authenticated, service_role;
grant execute on function public.upsert_daily_sales(date, numeric, numeric, jsonb, int, jsonb, text, text) to authenticated, service_role;

-- ================================================================ Inventario y mermas
-- stock_qty y min_qty se expresan en la unidad de compra del insumo (buy_unit).
-- Cada movimiento actualiza el stock: compra suma, merma y consumo restan,
-- conteo fija la cantidad contada, ajuste suma o resta.
alter table public.ingredients add column if not exists stock_qty numeric(12,3) not null default 0;
alter table public.ingredients add column if not exists min_qty   numeric(12,3) not null default 0 check (min_qty >= 0);

create table if not exists public.inventory_movements (
  id            bigint generated always as identity primary key,
  ingredient_id bigint not null references public.ingredients(id) on delete cascade,
  kind          text not null check (kind in ('compra', 'merma', 'consumo', 'conteo', 'ajuste')),
  qty           numeric(12,3) not null,          -- en la unidad indicada en "unit"
  unit          text not null check (unit in ('kg', 'g', 'l', 'ml', 'unidad')),
  qty_stock     numeric(12,3) not null,          -- la misma cantidad en la unidad del insumo
  stock_after   numeric(12,3) not null,
  cost          numeric(12,2) not null default 0, -- valor de lo movido (Ref)
  delta         numeric(12,3) not null default 0, -- cambio del stock (+ sube, − baja)
  reason        text not null default '',
  employee_id   bigint references public.employees(id) on delete set null,
  source        text not null default 'manual',
  created_at    timestamptz not null default now()
);
alter table public.inventory_movements add column if not exists delta numeric(12,3) not null default 0;
create index if not exists inventory_movements_time_idx on public.inventory_movements (created_at desc);
create index if not exists inventory_movements_ing_idx on public.inventory_movements (ingredient_id, created_at desc);

-- Registra un movimiento. p_ingredient: id o nombre exacto. p_employee: id, nº del equipo facial o nombre.
-- Convierte unidades del mismo tipo (g ↔ kg, ml ↔ l). Devuelve el stock resultante y el costo.
create or replace function public.register_movement(
  p_ingredient text, p_kind text, p_qty numeric, p_unit text default null,
  p_reason text default '', p_employee text default null, p_source text default 'manual')
returns jsonb language plpgsql security definer set search_path = public as $$
declare ing public.ingredients; emp bigint; u text; q numeric; newstock numeric; c numeric; new_id bigint;
begin
  if not public.can_manage_or_service() then raise exception 'Sin permiso'; end if;
  if p_kind not in ('compra', 'merma', 'consumo', 'conteo', 'ajuste') then raise exception 'Tipo no válido: %', p_kind; end if;
  if p_qty is null or (p_kind <> 'ajuste' and p_qty < 0) then raise exception 'Cantidad no válida'; end if;

  if p_ingredient ~ '^\d+$' then select * into ing from public.ingredients where id = p_ingredient::bigint for update;
  else select * into ing from public.ingredients where lower(name) = lower(trim(p_ingredient)) for update; end if;
  if ing.id is null then raise exception 'Insumo no encontrado: %', p_ingredient; end if;

  u := coalesce(nullif(p_unit, ''), ing.buy_unit);
  if u not in ('kg', 'g', 'l', 'ml', 'unidad') then raise exception 'Unidad no válida: %', u; end if;
  if public.unit_family(u) <> public.unit_family(ing.buy_unit) then
    raise exception 'La unidad % no corresponde a % (se compra en %)', u, ing.name, ing.buy_unit;
  end if;
  q := p_qty * public.unit_factor(u) / public.unit_factor(ing.buy_unit);

  if p_employee is not null and p_employee <> '' then
    select id into emp from public.employees where device_user_id = trim(p_employee);
    if emp is null and p_employee ~ '^\d+$' then select id into emp from public.employees where id = p_employee::bigint; end if;
    if emp is null then select id into emp from public.employees where lower(name) = lower(trim(p_employee)); end if;
  end if;

  newstock := case p_kind when 'compra' then ing.stock_qty + q when 'conteo' then q when 'ajuste' then ing.stock_qty + q
                          else ing.stock_qty - q end;
  c := round(abs(case when p_kind = 'conteo' then q - ing.stock_qty else q end) * ing.buy_price / ing.buy_qty, 2);

  update public.ingredients set stock_qty = newstock where id = ing.id;
  insert into public.inventory_movements (ingredient_id, kind, qty, unit, qty_stock, stock_after, cost, delta, reason, employee_id, source)
  values (ing.id, p_kind, p_qty, u, q, newstock, c, newstock - ing.stock_qty, coalesce(p_reason, ''), emp, coalesce(p_source, 'manual'))
  returning id into new_id;

  return jsonb_build_object('id', new_id, 'ingredient', ing.name, 'stock', newstock, 'unit', ing.buy_unit,
                            'cost', c, 'below_min', newstock < ing.min_qty, 'min', ing.min_qty, 'employee_id', emp);
end $$;

alter table public.inventory_movements enable row level security;
drop policy if exists "manage inventory_movements" on public.inventory_movements;
create policy "manage inventory_movements" on public.inventory_movements for all to authenticated
  using (public.can_manage()) with check (public.can_manage());
revoke all on public.inventory_movements from anon;
revoke execute on function public.register_movement(text, text, numeric, text, text, text, text) from anon, public;
grant execute on function public.register_movement(text, text, numeric, text, text, text, text) to authenticated, service_role;

-- ================================================================ Ventas → inventario
-- Descuenta del stock los insumos de las recetas de lo vendido en un día
-- (movimientos "consumo" con source = 'ventas:AAAA-MM-DD'). Si se vuelve a
-- aplicar el mismo día, primero deshace lo anterior: nunca descuenta dos veces.
-- La merma del insumo se tiene en cuenta: 100 g útiles con 20 % de merma = 125 g de compra.
create or replace function public.apply_sales_consumption(p_date date)
returns int language plpgsql security definer set search_path = public as $$
declare tag text := 'ventas:' || p_date::text; r record; n int := 0; newstock numeric;
begin
  if not public.can_manage_or_service() then raise exception 'Sin permiso'; end if;
  -- 1) deshacer el consumo anterior de ese día
  for r in select ingredient_id, sum(qty_stock) q from public.inventory_movements
           where source = tag and kind = 'consumo' group by ingredient_id loop
    update public.ingredients set stock_qty = stock_qty + r.q where id = r.ingredient_id;
  end loop;
  delete from public.inventory_movements where source = tag and kind = 'consumo';

  -- 2) calcular el consumo según recetas (tamaño exacto; si no hay, receta sin tamaño; si no, la primera)
  for r in
    with sold as (
      select si.dish_id, si.variant, sum(si.qty) as sold from public.sales_items si
      where si.sale_date = p_date and si.dish_id is not null group by si.dish_id, si.variant
    ), pick as (
      select s.dish_id, s.variant, s.sold,
        coalesce(
          (select ri.variant from public.recipe_items ri where ri.dish_id = s.dish_id and ri.variant = s.variant limit 1),
          (select ri.variant from public.recipe_items ri where ri.dish_id = s.dish_id and ri.variant = '' limit 1),
          (select min(ri.variant) from public.recipe_items ri where ri.dish_id = s.dish_id)) as rv
      from sold s
    )
    select i.id as ingredient_id, i.buy_unit, i.buy_price, i.buy_qty,
           sum(p.sold * ri.qty * public.unit_factor(ri.unit) / public.unit_factor(i.buy_unit)
               / (1 - least(i.waste_pct, 89.99) / 100)) as q
    from pick p
    join public.recipe_items ri on ri.dish_id = p.dish_id and ri.variant = p.rv
    join public.ingredients i on i.id = ri.ingredient_id
    where p.rv is not null and public.unit_family(ri.unit) = public.unit_family(i.buy_unit)
    group by i.id, i.buy_unit, i.buy_price, i.buy_qty
  loop
    update public.ingredients set stock_qty = stock_qty - r.q where id = r.ingredient_id returning stock_qty into newstock;
    insert into public.inventory_movements (ingredient_id, kind, qty, unit, qty_stock, stock_after, cost, delta, reason, source, created_at)
    values (r.ingredient_id, 'consumo', round(r.q, 3), r.buy_unit, round(r.q, 3), newstock, round(r.q * r.buy_price / r.buy_qty, 2), -round(r.q, 3),
            'Ventas del ' || to_char(p_date, 'DD/MM'), tag, (p_date + time '23:59') at time zone 'America/Caracas');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.apply_sales_consumption(date) from anon, public;
grant execute on function public.apply_sales_consumption(date) to authenticated, service_role;

-- ================================================================ IVA
-- Los precios de la carta incluyen IVA: la gestión lo separa para calcular márgenes y utilidades.
alter table public.gestion_settings add column if not exists iva_pct numeric(5,2) not null default 16 check (iva_pct between 0 and 100);

-- ================================================================ Rol «cocina» (tablet de Nex)
-- Una cuenta con rol cocina solo puede usar la asistente (función nex): no lee
-- nóminas, ventas ni costos. Crear la cuenta en Authentication → Users y luego:
--   insert into public.staff (email, role) values ('cocina@tu-dominio.com', 'cocina');
alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_check check (role in ('dueño', 'admin', 'cajero', 'cocina'));

create or replace function public.staff_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.staff where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;
revoke execute on function public.staff_role() from anon, public;
grant execute on function public.staff_role() to authenticated;
