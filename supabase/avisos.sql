-- ============================================================================
-- Avisos al personal con confirmación de lectura (Ichiraku)
--  · Se publican desde Gestión (o desde la caja quien puede cobrar).
--  · Cada persona los ve al entrar con su PIN o al marcar su llegada, y toca «Entendido».
--  · Nex los lee en voz alta y también puede confirmarlos.
-- Se ejecuta después de pos.sql y asistencia.sql. Se puede volver a ejecutar.
-- ============================================================================

create table if not exists public.announcements (
  id          bigint generated always as identity primary key,
  title       text not null check (length(trim(title)) between 2 and 120),
  body        text not null default '',
  audience    text not null default 'todos' check (audience in ('todos', 'sala', 'cocina')),
  created_by  text not null default '',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  active      boolean not null default true
);
create table if not exists public.announcement_reads (
  announcement_id bigint not null references public.announcements(id) on delete cascade,
  employee_id     bigint not null references public.employees(id) on delete cascade,
  read_at         timestamptz not null default now(),
  via             text not null default 'tablet',
  primary key (announcement_id, employee_id)
);
alter table public.announcements enable row level security;
alter table public.announcement_reads enable row level security;
drop policy if exists manage_all on public.announcements;
create policy manage_all on public.announcements for all to authenticated using (public.can_manage()) with check (public.can_manage());
drop policy if exists manage_all on public.announcement_reads;
create policy manage_all on public.announcement_reads for select to authenticated using (public.can_manage());
revoke all on public.announcements, public.announcement_reads from anon;

-- ¿Este aviso es para esta persona? «cocina» = cargos con cocin…; «sala» = el resto
create or replace function public.ann_for(p_aud text, p_job text) returns boolean
language sql immutable set search_path = public as $$
  select p_aud = 'todos' or (p_aud = 'cocina') = (coalesce(p_job, '') ilike '%cocin%' or coalesce(p_job, '') ilike '%parrill%')
$$;

-- Avisos vigentes que esta persona todavía no confirmó
create or replace function public.pos_announcements(p_emp bigint, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare job text;
begin
  perform public.pos_auth(p_emp, p_pin);
  select job_title into job from public.employees where id = p_emp;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body, 'by', a.created_by, 'at', a.created_at) order by a.created_at), '[]'::jsonb)
          from public.announcements a
          where a.active and (a.expires_at is null or a.expires_at > now()) and public.ann_for(a.audience, job)
            and not exists (select 1 from public.announcement_reads r where r.announcement_id = a.id and r.employee_id = p_emp));
end $$;

create or replace function public.pos_announcement_read(p_emp bigint, p_pin text, p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.pos_auth(p_emp, p_pin);
  insert into public.announcement_reads (announcement_id, employee_id, via) values (p_id, p_emp, 'tablet') on conflict do nothing;
end $$;

-- Publicar desde la caja (quien puede cobrar) o desde Gestión
create or replace function public.pos_announcement_create(p_emp bigint, p_pin text, p_title text, p_body text, p_audience text default 'todos', p_days int default 7)
returns bigint language plpgsql security definer set search_path = public as $$
declare nid bigint;
begin
  perform public.pos_auth_charge(p_emp, p_pin);
  insert into public.announcements (title, body, audience, created_by, expires_at)
  values (left(trim(p_title), 120), left(coalesce(trim(p_body), ''), 2000), coalesce(nullif(p_audience, ''), 'todos'),
          coalesce(public.pos_emp_name(p_emp), ''), now() + make_interval(days => greatest(coalesce(p_days, 7), 1)))
  returning id into nid;
  return nid;
end $$;

-- Gestión: avisos con quién los leyó y quién falta
create or replace function public.announcements_admin() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body, 'audience', a.audience, 'by', a.created_by,
            'at', a.created_at, 'expires_at', a.expires_at, 'active', a.active and (a.expires_at is null or a.expires_at > now()),
            'read', (select coalesce(jsonb_agg(public.pos_emp_name(r.employee_id) order by r.read_at), '[]'::jsonb) from public.announcement_reads r where r.announcement_id = a.id),
            'missing', (select coalesce(jsonb_agg(public.pos_emp_name(e.id) order by e.name), '[]'::jsonb) from public.employees e
                        where e.active and e.pos_pin_hash is not null and public.ann_for(a.audience, e.job_title)
                          and not exists (select 1 from public.announcement_reads r where r.announcement_id = a.id and r.employee_id = e.id)))
            order by a.created_at desc), '[]'::jsonb)
          from (select * from public.announcements order by created_at desc limit 40) a);
end $$;

create or replace function public.announcement_save(p_title text, p_body text, p_audience text default 'todos', p_days int default 7) returns bigint
language plpgsql security definer set search_path = public as $$
declare nid bigint;
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  insert into public.announcements (title, body, audience, created_by, expires_at)
  values (left(trim(p_title), 120), left(coalesce(trim(p_body), ''), 2000), coalesce(nullif(p_audience, ''), 'todos'), 'Gestión',
          now() + make_interval(days => greatest(coalesce(p_days, 7), 1)))
  returning id into nid;
  return nid;
end $$;

create or replace function public.announcement_close(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  update public.announcements set active = false where id = p_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array['pos_announcements(bigint, text)', 'pos_announcement_read(bigint, text, bigint)',
                           'pos_announcement_create(bigint, text, text, text, text, integer)', 'announcements_admin()',
                           'announcement_save(text, text, text, integer)', 'announcement_close(bigint)'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke execute on function public.ann_for(text, text) from anon;
