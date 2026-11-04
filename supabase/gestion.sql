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
