-- ============================================================================
-- Fotos de facturas (Ichiraku)
--  · La caja le toma una foto a la factura o recibo de una salida de caja o de la mercancía que llegó.
--  · Se guardan en el bucket privado «facturas»: las tablets solo pueden subir, nunca ver ni borrar;
--    el dueño/admin con 2FA las ve en Gestión → Dinero → Gastos.
-- Se ejecuta después de pos.sql y gestion.sql. Se puede volver a ejecutar.
-- ============================================================================

insert into storage.buckets (id, name, public) values ('facturas', 'facturas', false)
on conflict (id) do update set public = false;
-- En Supabase: máximo 3 MB y solo imágenes (la caja ya las achica a JPG de ~200 KB)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute $q$update storage.buckets set file_size_limit = 3145728, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] where id = 'facturas'$q$;
  end if;
end $$;

drop policy if exists "facturas caja sube" on storage.objects;
create policy "facturas caja sube" on storage.objects for insert to authenticated
  with check (bucket_id = 'facturas' and (public.pos_is_device() or public.can_manage()));
drop policy if exists "facturas dueno ve" on storage.objects;
create policy "facturas dueno ve" on storage.objects for select to authenticated
  using (bucket_id = 'facturas' and public.can_manage());

-- Gestión: las facturas de los últimos días con lo que pagaron o lo que llegó
create or replace function public.gestion_facturas(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', f.id, 'kind', f.kind, 'path', f.path, 'at', f.created_at, 'por', public.pos_emp_name(f.created_by), 'detalle', f.detail)
          order by f.created_at desc), '[]'::jsonb)
          from public.pos_facturas f
          where f.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 366))));
end $$;
revoke execute on function public.gestion_facturas(integer) from anon, public;
grant execute on function public.gestion_facturas(integer) to authenticated;
