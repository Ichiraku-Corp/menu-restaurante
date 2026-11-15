-- ============================================================================
-- Gestión → Inicio: lo del día en una sola consulta (Ichiraku)
--  · Ventas de hoy contra el mismo día de la semana pasada, pedidos, ticket promedio y mesas abiertas.
--  · Estado: caja, laptop de caja, impresora y el último cierre (si su correo salió).
--  · Alertas: lo que queda poco afuera, precios por aprobar y pagos por comprobar.
-- Solo dueño/admin con 2FA. Se ejecuta después de pos.sql y gestion.sql. Se puede volver a ejecutar.
-- ============================================================================

create or replace function public.gestion_inicio() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare hoy date := (now() at time zone 'America/Caracas')::date; r jsonb;
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  with dia as (
    select d, (select coalesce(sum(t.total - t.delivery), 0) from public.pos_orders o cross join lateral public.pos_totals(o.id) t
               where o.status = 'cobrada' and (o.closed_at at time zone 'America/Caracas')::date = d) as ventas,
              (select count(*) from public.pos_orders o where o.status = 'cobrada' and (o.closed_at at time zone 'America/Caracas')::date = d) as pedidos
    from (values (hoy), (hoy - 7)) v(d)
  ), ult as (
    select s.*, (select status from public.pos_reports pr where pr.session_id = s.id order by pr.id desc limit 1) as correo
    from public.pos_sessions s where s.status = 'cerrada' order by s.closed_at desc limit 1
  )
  select jsonb_build_object(
    'hoy', hoy,
    'ventas', (select ventas from dia where d = hoy), 'pedidos', (select pedidos from dia where d = hoy),
    'ventas_semana_pasada', (select ventas from dia where d = hoy - 7), 'pedidos_semana_pasada', (select pedidos from dia where d = hoy - 7),
    'abiertas', (select count(*) from public.pos_orders where status = 'abierta'),
    'abiertas_monto', (select coalesce(sum(t.total - t.paid), 0) from public.pos_orders o cross join lateral public.pos_totals(o.id) t where o.status = 'abierta'),
    'caja', (select jsonb_build_object('abierta_desde', opened_at, 'por', public.pos_emp_name(opened_by)) from public.pos_sessions where status = 'abierta' limit 1),
    'ultimo_cierre', (select jsonb_build_object('at', closed_at, 'por', public.pos_emp_name(closed_by), 'notas', notes, 'correo', correo) from ult),
    'laptop', (select updated_at from public.pos_kv where key = 'bridge_seen'),
    'impresion_atrasada', (select count(*) from public.pos_print_jobs where status = 'pendiente' and created_at between now() - interval '1 day' and now() - interval '1 minute'),
    'poco_afuera', (select coalesce(jsonb_agg(name order by name), '[]'::jsonb) from public.ingredients where zone = 'afuera' and inv_active and (stock_qty <= 0 or stock_qty <= min_qty)),
    'precios_por_aprobar', (select count(*) from public.price_updates where status = 'pending'),
    'pagos_por_comprobar', (select count(*) from public.pos_payments where method in ('binance', 'paypal') and verified_at is null and amount > 0 and created_at > now() - interval '2 days'),
    'top_hoy', (select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'qty', x.q) order by x.q desc), '[]'::jsonb) from (
                 select i.name, sum(i.qty) q from public.pos_items i join public.pos_orders o on o.id = i.order_id
                 where i.status <> 'anulado' and (i.created_at at time zone 'America/Caracas')::date = hoy group by 1 order by 2 desc limit 5) x)
  ) into r;
  return r;
end $$;
revoke execute on function public.gestion_inicio() from anon, public;
grant execute on function public.gestion_inicio() to authenticated;
