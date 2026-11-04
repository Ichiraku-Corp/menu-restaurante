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
