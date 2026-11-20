-- ============================================================================
-- Opinión del cliente (Ichiraku): la página opinion.html (el QR del recibo) y Gestión › Clientes › Opiniones.
--  · Cada recibo lleva un enlace único del pedido (pos.sql: opinion_qr). Vale 30 días.
--  · El cliente da de 1 a 5 estrellas y un comentario; si quiere que lo contacten, deja nombre y WhatsApp.
--  · Después de calificar, a todos se les invita a contarlo también en Google (el enlace se pega en Gestión). Las normas
--    de Google no permiten invitar solo a los clientes contentos.
--  · 1–2 estrellas: alerta al correo del cierre con el comentario, la mesa y quién atendió.
-- Se ejecuta después de pos.sql y alertas.sql. Se puede volver a ejecutar.
-- ============================================================================

-- Lo que ve el cliente al abrir el enlace (sin su teléfono: el recibo puede quedar en la mesa)
create or replace function public.opinion_ver(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare op record; cerrada timestamptz;
begin
  select * into op from public.opiniones where token = p_token;
  if op.order_id is null then return jsonb_build_object('estado', 'no_existe'); end if;
  select closed_at into cerrada from public.pos_orders where id = op.order_id;
  return jsonb_build_object(
    'estado', case when op.created_at < now() - interval '30 days' then 'vencida' when op.rating is not null then 'respondida' else 'nueva' end,
    'fecha', to_char(coalesce(cerrada, op.created_at) at time zone 'America/Caracas', 'DD/MM/YYYY'),
    'rating', op.rating, 'comment', op.comment, 'contacto', op.name <> '' or op.phone <> '',
    'cambios', greatest(0, 3 - op.edits),
    'google', case when op.rating is not null then nullif(trim((select opinion_google from public.gestion_settings limit 1)), '') end);
end $$;

-- Guardar (o cambiar, hasta 3 veces) la opinión. Si deja nombre o WhatsApp, reemplazan a los anteriores; en blanco, se conservan.
create or replace function public.opinion_enviar(p_token text, p_rating int, p_comment text default '', p_name text default '', p_phone text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare op record; o record; st record; tel text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'); nom text := left(trim(coalesce(p_name, '')), 60); antes int;
begin
  select * into op from public.opiniones where token = p_token for update;
  if op.order_id is null then raise exception 'Este enlace no es válido: escanea de nuevo el código del recibo'; end if;
  if op.created_at < now() - interval '30 days' then raise exception 'Este enlace ya venció (dura 30 días)'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'Elige de 1 a 5 estrellas'; end if;
  if op.rating is not null and op.edits >= 3 then raise exception 'Ya cambiaste tu opinión 3 veces: quedó guardada la última'; end if;
  if tel <> '' and (length(regexp_replace(tel, '\D', '', 'g')) not between 7 and 15 or tel ~ '.\+') then raise exception 'Revisa el número de WhatsApp'; end if;
  antes := op.rating;
  update public.opiniones set rating = p_rating, comment = left(trim(coalesce(p_comment, '')), 500),
    name = case when nom <> '' or tel <> '' then nom else name end, phone = case when nom <> '' or tel <> '' then tel else phone end,
    answered_at = coalesce(answered_at, now()), updated_at = now(), edits = edits + case when antes is null then 0 else 1 end
  where order_id = op.order_id
  returning * into op;
  select * into st from public.gestion_settings limit 1;
  -- 1–2 estrellas: alerta al correo (una vez; si la cambia a 1–2 más tarde, también)
  if p_rating <= 2 and (antes is null or antes > 2) and coalesce(st.opinion_alerta, true) then
    select * into o from public.pos_orders where id = op.order_id;
    perform public.pos_alerta('opinion-' || op.order_id,
      'Opinión de ' || p_rating || ' estrella' || case when p_rating = 1 then '' else 's' end || ': ' || public.pos_order_label(op.order_id),
      array['Visita: ' || public.pos_order_label(op.order_id) || ' · ' || coalesce(public.pos_hora(o.closed_at), '—'),
            'Atendió: ' || coalesce(public.pos_emp_name(o.opened_by), '—') || coalesce(' · cobró ' || public.pos_emp_name(o.closed_by), ''),
            'Comentario: ' || coalesce(nullif(op.comment, ''), '(no escribió comentario)'),
            'Contacto: ' || coalesce(nullif(concat_ws(' · ', nullif(op.name, ''), nullif(op.phone, '')), ''), 'no dejó sus datos'),
            'Todas las opiniones: Gestión › Clientes › Opiniones']);
  end if;
  return jsonb_build_object('ok', true, 'cambios', greatest(0, 3 - op.edits),
    'google', nullif(trim(coalesce(st.opinion_google, '')), ''));
end $$;

-- Gestión › Clientes › Opiniones: resumen de los últimos días (por fecha de la visita), por mesonero y la lista
create or replace function public.gestion_opiniones(p_dias int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d int := greatest(1, least(coalesce(p_dias, 30), 366)); desde timestamptz;
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  desde := now() - make_interval(days => d);
  return (
    with v as (
      select op.*, o.opened_by, o.closed_at from public.opiniones op join public.pos_orders o on o.id = op.order_id where op.created_at >= desde)
    select jsonb_build_object(
      'dias', d,
      'puente_qr', coalesce((select value ->> 'qr' from public.pos_kv where key = 'bridge_status'), '') = 'true',
      'impresos', (select count(*) from v),
      'respondidas', (select count(*) from v where rating is not null),
      'promedio', (select round(avg(rating), 1) from v where rating is not null),
      'estrellas', (select jsonb_agg((select count(*) from v where rating = s) order by s) from generate_series(1, 5) s),
      'por_mesonero', (select coalesce(jsonb_agg(jsonb_build_object('nombre', z.nombre, 'n', z.n, 'promedio', z.prom, 'bajas', z.bajas) order by z.n desc, z.nombre), '[]'::jsonb)
                       from (select coalesce(public.pos_emp_name(opened_by), '—') nombre, count(*) n, round(avg(rating), 1) prom, count(*) filter (where rating <= 2) bajas
                             from v where rating is not null group by 1) z),
      'lista', (select coalesce(jsonb_agg(x.j order by x.t desc), '[]'::jsonb) from (
                  select jsonb_build_object('order_id', order_id, 'visita', public.pos_hora(coalesce(closed_at, created_at)), 'respondida', public.pos_hora(coalesce(updated_at, answered_at)),
                           'mesa', public.pos_order_label(order_id), 'mesonero', coalesce(public.pos_emp_name(opened_by), '—'), 'rating', rating, 'comment', comment,
                           'name', name, 'phone', phone, 'cambios', edits) j, coalesce(updated_at, answered_at) t
                  from v where rating is not null order by coalesce(updated_at, answered_at) desc limit 300) x))
  );
end $$;

revoke execute on function public.opinion_ver(text) from public;
revoke execute on function public.opinion_enviar(text, int, text, text, text) from public;
grant execute on function public.opinion_ver(text) to anon, authenticated;
grant execute on function public.opinion_enviar(text, int, text, text, text) to anon, authenticated;
revoke execute on function public.gestion_opiniones(int) from anon, public;
grant execute on function public.gestion_opiniones(int) to authenticated;
