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
drop policy if exists "categories admin write" on public.categories;
create policy "categories admin write" on public.categories for all
  to authenticated using (true) with check (true);

drop policy if exists "dishes public read" on public.dishes;
create policy "dishes public read" on public.dishes for select using (true);
drop policy if exists "dishes admin write" on public.dishes;
create policy "dishes admin write" on public.dishes for all
  to authenticated using (true) with check (true);

-- Almacenamiento de fotos (bucket público de lectura)
insert into storage.buckets (id, name, public)
values ('dishes', 'dishes', true)
on conflict (id) do nothing;

drop policy if exists "dish photos public read" on storage.objects;
create policy "dish photos public read" on storage.objects for select
  using (bucket_id = 'dishes');
drop policy if exists "dish photos admin insert" on storage.objects;
create policy "dish photos admin insert" on storage.objects for insert
  to authenticated with check (bucket_id = 'dishes');
drop policy if exists "dish photos admin update" on storage.objects;
create policy "dish photos admin update" on storage.objects for update
  to authenticated using (bucket_id = 'dishes');
drop policy if exists "dish photos admin delete" on storage.objects;
create policy "dish photos admin delete" on storage.objects for delete
  to authenticated using (bucket_id = 'dishes');

-- IMPORTANTE: en Authentication → Providers → Email, desactiva
-- "Allow new users to sign up" y crea tu usuario admin a mano en
-- Authentication → Users. Así nadie más puede registrarse y editar.

-- Si creaste las tablas con una versión anterior de este archivo:
alter table public.categories add column if not exists subtitle text not null default '';
alter table public.dishes add column if not exists subtitle text not null default '';
alter table public.dishes add column if not exists variants jsonb not null default '[]'::jsonb;
alter table public.dishes add column if not exists options text[] not null default '{}';

-- Para cargar el menú completo, ejecuta después supabase/seed.sql.
