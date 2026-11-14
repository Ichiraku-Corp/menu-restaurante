-- Esquema del menú digital. Ejecutar una vez en Supabase → SQL Editor.
-- Lectura pública (clientes que escanean el QR), escritura sólo para
-- usuarios autenticados (el panel de admin).

create table if not exists public.categories (
  id         bigint generated always as identity primary key,
  name       text not null,
  subtitle   text not null default '',   -- p. ej. nombre en japonés
  position   int  not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.dishes (
  id          bigint generated always as identity primary key,
  category_id bigint not null references public.categories(id) on delete cascade,
  name        text not null,
  subtitle    text not null default '',   -- p. ej. nombre en japonés
  description text not null default '',
  -- Precio base (el menor si hay tamaños). Se usa si "variants" está vacío.
  price       numeric(10,2) not null default 0 check (price >= 0),
  -- Tamaños con precio propio: [{"label":"Peq","price":10},{"label":"Gr","price":15}]
  variants    jsonb not null default '[]'::jsonb,
  -- Sabores / opciones a elegir: {Fresa, Mora, Taro}
  options     text[] not null default '{}',
  photo_url   text,
  tags        text[] not null default '{}',
  available   boolean not null default true,
  position    int not null default 0,
  -- Libre para el futuro (p. ej. estadísticas del juego de cartas:
  -- {"rareza":"épica","ataque":5,"defensa":3}). El menú la ignora.
  attributes  jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists dishes_category_idx on public.dishes (category_id, position);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists dishes_touch on public.dishes;
create trigger dishes_touch before update on public.dishes
  for each row execute function public.touch_updated_at();

-- Row Level Security
alter table public.categories enable row level security;
alter table public.dishes     enable row level security;

drop policy if exists "categories public read" on public.categories;
create policy "categories public read" on public.categories for select using (true);
drop policy if exists "dishes public read" on public.dishes;
create policy "dishes public read" on public.dishes for select using (true);

-- Escribir en la carta: aquí NO se abre a nadie. gestion.sql pone la regla real (solo dueño/admin con 2FA).
-- Si la regla ya existe no se toca, así volver a ejecutar este archivo nunca afloja la seguridad.
do $$
declare t text;
begin
  foreach t in array array['categories', 'dishes'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || ' admin write') then
      execute format('create policy %I on public.%I for all to authenticated using (false) with check (false)', t || ' admin write', t);
    end if;
  end loop;
end $$;
-- El público solo lee la carta: sin permiso de escritura ni siquiera a nivel de tabla
revoke insert, update, delete, truncate on public.categories, public.dishes from anon;

-- Almacenamiento de fotos (bucket público de lectura)
insert into storage.buckets (id, name, public)
values ('dishes', 'dishes', true)
on conflict (id) do nothing;

drop policy if exists "dish photos public read" on storage.objects;
create policy "dish photos public read" on storage.objects for select
  using (bucket_id = 'dishes');
-- Subir, cambiar o borrar fotos: igual que la carta, cerrado aquí; gestion.sql pone la regla real (dueño/admin con 2FA)
do $$
declare p text;
begin
  foreach p in array array['insert', 'update', 'delete'] loop
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'dish photos admin ' || p) then
      execute format(case p when 'insert' then 'create policy %I on storage.objects for insert to authenticated with check (false)'
                            else 'create policy %I on storage.objects for ' || p || ' to authenticated using (false)' end, 'dish photos admin ' || p);
    end if;
  end loop;
end $$;

-- IMPORTANTE: en Authentication → Providers → Email, desactiva
-- "Allow new users to sign up" y crea tu usuario admin a mano en
-- Authentication → Users. Así nadie más puede registrarse y editar.

-- Si creaste las tablas con una versión anterior de este archivo:
alter table public.categories add column if not exists subtitle text not null default '';
alter table public.dishes add column if not exists subtitle text not null default '';
alter table public.dishes add column if not exists variants jsonb not null default '[]'::jsonb;
alter table public.dishes add column if not exists options text[] not null default '{}';

-- Para cargar el menú completo, ejecuta después supabase/seed.sql.
