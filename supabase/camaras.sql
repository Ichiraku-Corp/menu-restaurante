-- Cámaras: Nex mira por las cámaras del local.
--  · El grabador (NVR) está en la red del local. Nadie desde internet llega a él: solo la laptop de caja
--    (el puente), con un usuario de solo lectura del grabador cuya clave vive en config.json de la laptop.
--  · Nex (o el dueño desde Gestión) pide una foto: cam_pedir_foto. El puente la ve en cam_pendientes,
--    la toma, la sube al bucket privado «camaras» y avisa con cam_foto_lista. Nex la mira y anota lo que vio.
--  · Una cámara puede revisarse sola cada cierto tiempo (revisar_cada_min): el puente toma la foto y Nex la mira.
--  · Las fotos se borran solas a los 7 días (las que tienen una alerta, a los 30).
--  · Todo queda quieto hasta que se carguen las cámaras en Gestión › Ajustes › Cámaras.

create table if not exists public.cam_camaras (
  id bigint generated always as identity primary key,
  nombre text not null check (length(trim(nombre)) between 2 and 40),
  area text not null default 'otra' check (area in ('cocina', 'caja', 'salon', 'despensa', 'otra')),
  canal int not null unique check (canal between 1 and 64),
  activa boolean not null default true,
  solo_dueno boolean not null default true,  -- falso: el personal también puede pedirle a Nex que mire por ella
  que_mirar text not null default '' check (length(que_mirar) <= 300),
  revisar_cada_min int check (revisar_cada_min is null or revisar_cada_min between 15 and 1440),
  creada_at timestamptz not null default now()
);
create table if not exists public.cam_fotos (
  id bigint generated always as identity primary key,
  camara_id bigint not null references public.cam_camaras(id) on delete cascade,
  motivo text not null default 'nex' check (motivo in ('nex', 'prueba', 'revision')),
  detalle text not null default 'normal' check (detalle in ('normal', 'alto')),
  pedida_por text not null default '',
  pedida_at timestamptz not null default now(),
  lista_at timestamptz,
  path text,
  bytes int,
  error text,
  borrada_at timestamptz
);
create index if not exists cam_fotos_pendientes on public.cam_fotos (pedida_at) where lista_at is null and error is null;
create index if not exists cam_fotos_camara on public.cam_fotos (camara_id, pedida_at desc);
create table if not exists public.cam_observaciones (
  id bigint generated always as identity primary key,
  camara_id bigint references public.cam_camaras(id) on delete cascade,
  foto_id bigint references public.cam_fotos(id) on delete set null,
  at timestamptz not null default now(),
  pregunta text not null default '',
  resumen text not null,
  alerta boolean not null default false,
  por text not null default ''
);
create index if not exists cam_obs_camara on public.cam_observaciones (camara_id, at desc);
create index if not exists cam_obs_foto on public.cam_observaciones (foto_id);
alter table public.cam_camaras enable row level security;
alter table public.cam_fotos enable row level security;
alter table public.cam_observaciones enable row level security;
revoke all on public.cam_camaras, public.cam_fotos, public.cam_observaciones from anon, authenticated;

-- Bucket privado: el puente sube y borra lo suyo; el dueño ve; nadie más.
insert into storage.buckets (id, name, public) values ('camaras', 'camaras', false) on conflict (id) do nothing;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute $q$update storage.buckets set file_size_limit = 5242880, allowed_mime_types = array['image/jpeg'] where id = 'camaras'$q$;
  end if;
end $$;
drop policy if exists "camaras puente sube" on storage.objects;
create policy "camaras puente sube" on storage.objects for insert to authenticated
  with check (bucket_id = 'camaras' and coalesce(public.staff_role(), '') = 'impresora');
drop policy if exists "camaras ver" on storage.objects;
create policy "camaras ver" on storage.objects for select to authenticated
  using (bucket_id = 'camaras' and (coalesce(public.staff_role(), '') = 'impresora' or public.can_manage()));
drop policy if exists "camaras puente borra" on storage.objects;
create policy "camaras puente borra" on storage.objects for delete to authenticated
  using (bucket_id = 'camaras' and coalesce(public.staff_role(), '') = 'impresora');

-- Pedir una foto (Nex con la service_role, o el dueño desde Gestión). Si hay una de hace menos de 15 s, sirve esa.
create or replace function public.cam_pedir_foto(p_camara bigint, p_motivo text default 'nex', p_detalle text default 'normal', p_por text default '')
returns bigint language plpgsql security definer set search_path = public as $$
declare c record; fid bigint; det text := case when p_detalle = 'alto' then 'alto' else 'normal' end;
begin
  if not (coalesce(auth.jwt() ->> 'role', '') = 'service_role' or public.can_manage()) then raise exception 'Sin permiso'; end if;
  select * into c from public.cam_camaras where id = p_camara;
  if c.id is null or not c.activa then raise exception 'Esa cámara no existe o está apagada'; end if;
  select id into fid from public.cam_fotos
   where camara_id = c.id and error is null and borrada_at is null and (detalle = det or detalle = 'alto')
     and ((lista_at > now() - interval '15 seconds' and path is not null) or (lista_at is null and pedida_at > now() - interval '30 seconds'))
   order by id desc limit 1;
  if fid is not null then return fid; end if;
  if (select count(*) from public.cam_fotos where pedida_at > now() - interval '1 hour' and motivo <> 'revision') >= 60 then
    raise exception 'Ya se pidieron 60 fotos en la última hora: espera un poco';
  end if;
  insert into public.cam_fotos (camara_id, motivo, detalle, pedida_por)
  values (c.id, case when p_motivo in ('nex', 'prueba', 'revision') then p_motivo else 'nex' end, det, left(coalesce(p_por, ''), 60))
  returning id into fid;
  return fid;
end $$;

-- El puente: qué fotos tomar ahora. Anota que el puente está vivo (y cómo tiene configurado el grabador),
-- vence lo que nadie tomó en 2 minutos y agrega las revisiones automáticas que tocan.
create or replace function public.cam_pendientes(p_estado jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; r jsonb;
begin
  if coalesce(public.staff_role(), '') <> 'impresora' then raise exception 'Sin permiso'; end if;
  if p_estado is not null and jsonb_typeof(p_estado) = 'object' then
    insert into public.pos_kv (key, value, updated_at) values ('camaras_estado', (p_estado - 'clave' - 'password') || jsonb_build_object('at', now()), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  update public.cam_fotos set error = 'El puente no la tomó a tiempo', lista_at = now()
   where lista_at is null and error is null and pedida_at < now() - interval '2 minutes';
  for c in select * from public.cam_camaras where activa and revisar_cada_min is not null loop
    if not exists (select 1 from public.cam_fotos f where f.camara_id = c.id and f.motivo = 'revision'
                    and f.pedida_at > now() - make_interval(mins => c.revisar_cada_min)) then
      insert into public.cam_fotos (camara_id, motivo, pedida_por) values (c.id, 'revision', 'automática');
    end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'canal', k.canal, 'detalle', f.detalle, 'camara', k.nombre) order by f.id), '[]'::jsonb) into r
    from (select * from public.cam_fotos where lista_at is null and error is null order by id limit 8) f
    join public.cam_camaras k on k.id = f.camara_id;
  return r;
end $$;

-- El puente avisa que la foto está (o por qué no se pudo).
create or replace function public.cam_foto_lista(p_id bigint, p_path text, p_bytes int default null, p_error text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.staff_role(), '') <> 'impresora' then raise exception 'Sin permiso'; end if;
  if coalesce(p_error, '') <> '' then
    update public.cam_fotos set error = left(p_error, 200), lista_at = now() where id = p_id and lista_at is null;
    return;
  end if;
  if coalesce(p_path, '') !~ ('^[0-9]{4}-[0-9]{2}/' || p_id || '-[0-9a-f]{8,32}\.jpg$') then raise exception 'Ruta de foto no válida'; end if;
  update public.cam_fotos set path = p_path, bytes = p_bytes, lista_at = now() where id = p_id and lista_at is null;
  if not found then raise exception 'Esa foto ya no está pendiente'; end if;
end $$;

-- Limpieza: qué fotos ya se pueden borrar (7 días; 30 si Nex vio algo para alertar) y anotarlas como borradas.
create or replace function public.cam_viejas()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'path', x.path)), '[]'::jsonb) from (
    select f.id, f.path from public.cam_fotos f
     where f.path is not null and f.borrada_at is null and f.pedida_at < now() - interval '7 days'
       and coalesce(public.staff_role(), '') = 'impresora'
       and not exists (select 1 from public.cam_observaciones o where o.foto_id = f.id and o.alerta and f.pedida_at > now() - interval '30 days')
     order by f.id limit 100) x
$$;
create or replace function public.cam_borradas(p_ids bigint[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if coalesce(public.staff_role(), '') <> 'impresora' then raise exception 'Sin permiso'; end if;
  update public.cam_fotos set borrada_at = now(), path = null where id = any (p_ids) and borrada_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Nex anota lo que vio (con la service_role).
create or replace function public.cam_anotar(p_foto bigint, p_pregunta text, p_resumen text, p_alerta boolean default false, p_por text default '')
returns bigint language plpgsql security definer set search_path = public as $$
declare oid bigint;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'Sin permiso'; end if;
  insert into public.cam_observaciones (camara_id, foto_id, pregunta, resumen, alerta, por)
  values ((select camara_id from public.cam_fotos where id = p_foto), p_foto, left(coalesce(p_pregunta, ''), 300), left(coalesce(p_resumen, ''), 2000),
          coalesce(p_alerta, false), left(coalesce(p_por, ''), 60))
  returning id into oid;
  return oid;
end $$;

-- Gestión › Ajustes › Cámaras: las cámaras, su última foto, lo último que vio Nex y si el puente ya ve el grabador.
create or replace function public.gestion_camaras()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  return jsonb_build_object(
    'camaras', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'area', c.area, 'canal', c.canal, 'activa', c.activa,
                  'solo_dueno', c.solo_dueno, 'que_mirar', c.que_mirar, 'revisar_cada_min', c.revisar_cada_min,
                  'ultima', (select jsonb_build_object('id', f.id, 'path', f.path, 'lista_at', f.lista_at, 'error', f.error)
                               from public.cam_fotos f where f.camara_id = c.id and (f.path is not null or f.error is not null)
                              order by f.id desc limit 1)) order by c.canal), '[]'::jsonb) from public.cam_camaras c),
    'estado', (select value from public.pos_kv where key = 'camaras_estado'),
    'observaciones', (select coalesce(jsonb_agg(x order by x.at desc), '[]'::jsonb) from (
                        select o.at, o.resumen, o.alerta, o.pregunta, c.nombre camara from public.cam_observaciones o
                          left join public.cam_camaras c on c.id = o.camara_id order by o.at desc limit 20) x),
    'fotos_hoy', (select count(*) from public.cam_fotos where pedida_at > date_trunc('day', now() at time zone 'America/Caracas') at time zone 'America/Caracas'));
end $$;

create or replace function public.gestion_camara_guardar(p_id bigint, p_nombre text, p_area text, p_canal int, p_activa boolean,
  p_solo_dueno boolean, p_que_mirar text, p_revisar_cada_min int)
returns bigint language plpgsql security definer set search_path = public as $$
declare cid bigint;
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  if length(trim(coalesce(p_nombre, ''))) < 2 then raise exception 'Escribe el nombre de la cámara'; end if;
  if p_canal is null or p_canal not between 1 and 64 then raise exception 'El canal va del 1 al 64 (el número de la cámara en el grabador)'; end if;
  if p_revisar_cada_min is not null and p_revisar_cada_min not between 15 and 1440 then raise exception 'La revisión automática va de 15 minutos a 24 horas'; end if;
  if exists (select 1 from public.cam_camaras where canal = p_canal and id is distinct from p_id) then raise exception 'Ya hay una cámara en el canal %', p_canal; end if;
  if p_id is null then
    insert into public.cam_camaras (nombre, area, canal, activa, solo_dueno, que_mirar, revisar_cada_min)
    values (trim(p_nombre), case when p_area in ('cocina', 'caja', 'salon', 'despensa') then p_area else 'otra' end, p_canal, coalesce(p_activa, true),
            coalesce(p_solo_dueno, true), left(trim(coalesce(p_que_mirar, '')), 300), p_revisar_cada_min)
    returning id into cid;
  else
    update public.cam_camaras set nombre = trim(p_nombre), area = case when p_area in ('cocina', 'caja', 'salon', 'despensa') then p_area else 'otra' end,
      canal = p_canal, activa = coalesce(p_activa, true), solo_dueno = coalesce(p_solo_dueno, true), que_mirar = left(trim(coalesce(p_que_mirar, '')), 300),
      revisar_cada_min = p_revisar_cada_min
    where id = p_id returning id into cid;
    if cid is null then raise exception 'Cámara no encontrada'; end if;
  end if;
  return cid;
end $$;

create or replace function public.gestion_camara_borrar(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  delete from public.cam_camaras where id = p_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array['cam_pedir_foto(bigint, text, text, text)', 'cam_pendientes(jsonb)', 'cam_foto_lista(bigint, text, integer, text)', 'cam_viejas()',
                           'cam_borradas(bigint[])', 'cam_anotar(bigint, text, text, boolean, text)', 'gestion_camaras()',
                           'gestion_camara_guardar(bigint, text, text, integer, boolean, boolean, text, integer)', 'gestion_camara_borrar(bigint)'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
