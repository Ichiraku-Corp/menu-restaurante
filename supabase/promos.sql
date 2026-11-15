-- ============================================================================
-- Promociones programadas (Ichiraku)
--  · Gestión las crea: nombre, % menos, días, horas (hora de Venezuela), fechas opcionales y a qué platos
--    o categorías aplican. La caja las aplica sola al anotar el plato (pos_add en pos.sql).
--  · La carta pública ve las de hoy (para anunciarlas) y la caja la lista para mostrar el precio antes de enviar.
-- Se ejecuta después de pos.sql y gestion.sql. Se puede volver a ejecutar.
-- ============================================================================

create or replace function public.gestion_promo_guardar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare pid bigint := nullif(p ->> 'id', '')::bigint; v_days int[]; v_dishes bigint[]; v_cats bigint[];
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  if length(trim(coalesce(p ->> 'name', ''))) < 2 then raise exception 'Escribe el nombre de la promoción'; end if;
  if coalesce((p ->> 'percent')::numeric, 0) <= 0 or (p ->> 'percent')::numeric > 90 then raise exception 'El descuento va de 1 %% a 90 %%'; end if;
  select coalesce(array_agg(distinct x::int order by x::int), '{}') into v_days from jsonb_array_elements_text(coalesce(p -> 'days', '[]'::jsonb)) x;
  select coalesce(array_agg(distinct x::bigint), '{}') into v_dishes from jsonb_array_elements_text(coalesce(p -> 'dish_ids', '[]'::jsonb)) x;
  select coalesce(array_agg(distinct x::bigint), '{}') into v_cats from jsonb_array_elements_text(coalesce(p -> 'category_ids', '[]'::jsonb)) x;
  if cardinality(v_days) = 0 then raise exception 'Elige al menos un día'; end if;
  if cardinality(v_dishes) + cardinality(v_cats) = 0 then raise exception 'Elige los platos o categorías de la promoción'; end if;
  if (p ->> 'end_time')::time <= (p ->> 'start_time')::time then raise exception 'La hora de fin debe ser después de la de inicio'; end if;
  if pid is null then
    insert into public.promos (name, percent, days, start_time, end_time, date_from, date_to, dish_ids, category_ids, active)
    values (trim(p ->> 'name'), (p ->> 'percent')::numeric, v_days, (p ->> 'start_time')::time, (p ->> 'end_time')::time,
            nullif(p ->> 'date_from', '')::date, nullif(p ->> 'date_to', '')::date, v_dishes, v_cats, coalesce((p ->> 'active')::boolean, true))
    returning id into pid;
  else
    update public.promos set name = trim(p ->> 'name'), percent = (p ->> 'percent')::numeric, days = v_days,
           start_time = (p ->> 'start_time')::time, end_time = (p ->> 'end_time')::time,
           date_from = nullif(p ->> 'date_from', '')::date, date_to = nullif(p ->> 'date_to', '')::date,
           dish_ids = v_dishes, category_ids = v_cats, active = coalesce((p ->> 'active')::boolean, true), updated_at = now()
    where id = pid;
    if not found then raise exception 'Esa promoción ya no existe'; end if;
  end if;
  return pid;
end $$;

create or replace function public.gestion_promo_borrar(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  delete from public.promos where id = p_id;
end $$;

-- Las promociones de hoy (activas y dentro de sus fechas), con si valen ahora mismo
create or replace function public.promos_de_hoy() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'percent', p.percent,
           'start', to_char(p.start_time, 'HH24:MI'), 'end', to_char(p.end_time, 'HH24:MI'),
           'dish_ids', to_jsonb(p.dish_ids), 'category_ids', to_jsonb(p.category_ids),
           'ahora', (now() at time zone 'America/Caracas')::time >= p.start_time and (now() at time zone 'America/Caracas')::time < p.end_time)
         order by p.start_time, p.percent desc), '[]'::jsonb)
  from public.promos p
  where p.active
    and extract(isodow from now() at time zone 'America/Caracas')::int = any (p.days)
    and (p.date_from is null or (now() at time zone 'America/Caracas')::date >= p.date_from)
    and (p.date_to is null or (now() at time zone 'America/Caracas')::date <= p.date_to)
$$;
revoke execute on function public.promos_de_hoy() from public;
-- La carta (público) y la caja (tablets) las ven; solo lo de hoy, sin nada más
create or replace function public.menu_promos() returns jsonb
language sql stable security definer set search_path = public as $$ select public.promos_de_hoy() $$;
revoke execute on function public.menu_promos() from public;
grant execute on function public.menu_promos() to anon, authenticated;
revoke execute on function public.gestion_promo_guardar(jsonb), public.gestion_promo_borrar(bigint) from anon, public;
grant execute on function public.gestion_promo_guardar(jsonb), public.gestion_promo_borrar(bigint) to authenticated;
