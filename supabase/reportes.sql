-- ============================================================================
-- Reportes de Gestión (Ichiraku)
--  · Ventas por hora y día: promedio de ventas y pedidos por día de la semana y hora, para decidir
--    horarios y cuánta gente poner por turno. Cuenta la hora en que se abrió el pedido (cuando llegó
--    el cliente) y promedia solo entre los días de la semana que tuvieron ventas.
-- Solo dueño/admin con 2FA. Se ejecuta después de pos.sql y gestion.sql. Se puede volver a ejecutar.
-- ============================================================================

create or replace function public.gestion_ventas_hora(p_weeks integer default 8) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  semanas int := greatest(1, least(coalesce(p_weeks, 8), 52));
  hasta date := (now() at time zone 'America/Caracas')::date - 1;   -- hasta ayer: hoy es un día a medias
  desde date := hasta - semanas * 7 + 1;
  r jsonb;
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  with o as (
    select (o.opened_at at time zone 'America/Caracas') t, tt.subtotal - tt.discount + tt.delivery as venta   -- sin el servicio, como Ventas, Inicio y la meta
    from public.pos_orders o cross join lateral public.pos_totals(o.id) tt
    where o.status = 'cobrada' and (o.opened_at at time zone 'America/Caracas')::date between desde and hasta
  ), dias as (
    select extract(isodow from t)::int dow, count(distinct t::date) n from o group by 1
  ), celdas as (
    select extract(isodow from t)::int dow, extract(hour from t)::int h, count(*) pedidos, sum(venta) ventas from o group by 1, 2
  )
  select jsonb_build_object(
    'desde', desde, 'hasta', hasta, 'semanas', semanas,
    'primera', (select min(opened_at at time zone 'America/Caracas')::date from public.pos_orders where status = 'cobrada'),
    'dias', coalesce((select jsonb_object_agg(dow, n) from dias), '{}'::jsonb),
    'celdas', coalesce((select jsonb_agg(jsonb_build_object('dow', c.dow, 'hora', c.h,
                 'ventas', round(c.ventas / d.n, 2), 'pedidos', round(c.pedidos::numeric / d.n, 1)) order by c.dow, c.h)
               from celdas c join dias d using (dow)), '[]'::jsonb)
  ) into r;
  return r;
end $$;
revoke execute on function public.gestion_ventas_hora(integer) from anon, public;
grant execute on function public.gestion_ventas_hora(integer) to authenticated;
