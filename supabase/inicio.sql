-- ============================================================================
-- Gestión → Inicio: lo del día en una sola consulta (Ichiraku)
--  · Ventas de hoy contra el mismo día de la semana pasada, pedidos, ticket promedio y mesas abiertas.
--    Ventas = lo cobrado sin el servicio (con el delivery): la misma cifra de Ventas y de la meta del día.
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
    select d, (select coalesce(sum(t.subtotal - t.discount + t.delivery), 0) from public.pos_orders o cross join lateral public.pos_totals(o.id) t
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

-- ============================================================================
-- Indicadores (KPI) de un período de días completos: Gestión › Inicio (últimos 7 o 30 días) y el resumen del lunes.
--  · Ventas: como en la pestaña Ventas (cobrado con IVA, sin el servicio, con el delivery), pedidos, ticket promedio
--    y cuánto fue mesa, para llevar y delivery.
--  · Costos y margen: % de insumos según las recetas (sobre lo vendido que tiene receta), % de nómina (la del mes,
--    repartida por día), gastos (fijos repartidos por día + variables del período) y lo que queda: la cuenta de
--    «Utilidad neta estimada» de Costos del mes, con los insumos estimados para todo lo vendido.
--  · Servicio: minutos de cocina (de enviado a listo), minutos por mesa (de abrir a cobrar) y calificación de clientes.
--  · Control: descuentos, platos anulados después de ir a cocina y diferencias de los cierres de caja.
-- ============================================================================

-- Costo de insumos de 1 unidad vendida de un plato (y tamaño), como en Gestión: si ese tamaño no tiene receta se usa
-- la del plato sin tamaño o la del primer tamaño que la tenga. Null si no hay receta o una línea no tiene unidad compatible.
create or replace function public.kpi_costo_unidad(p_dish bigint, p_variant text) returns numeric
language sql stable security definer set search_path = public as $$
  with v as (
    select coalesce(
      (select coalesce(p_variant, '') where exists (select 1 from public.recipe_items where dish_id = p_dish and variant = coalesce(p_variant, ''))),
      (select '' where exists (select 1 from public.recipe_items where dish_id = p_dish and variant = '')),
      (select e.x ->> 'label' from public.dishes d
         cross join lateral jsonb_array_elements(case when jsonb_typeof(d.variants) = 'array' then d.variants else '[]'::jsonb end) with ordinality e(x, n)
        where d.id = p_dish and exists (select 1 from public.recipe_items r where r.dish_id = p_dish and r.variant = e.x ->> 'label')
        order by e.n limit 1)) as var
  ), l as (
    select r.qty * public.unit_factor(r.unit)
             * case when i.buy_qty * public.unit_factor(i.buy_unit) > 0
                    then i.buy_price / (i.buy_qty * public.unit_factor(i.buy_unit)) / (1 - least(i.waste_pct, 89.99) / 100) else 0 end as c,
           public.unit_family(r.unit) = public.unit_family(i.buy_unit) as ok
    from v join public.recipe_items r on r.dish_id = p_dish and r.variant = v.var
    join public.ingredients i on i.id = r.ingredient_id
  )
  select case when count(*) = 0 or bool_or(not ok) then null else sum(c) end from l
$$;

create or replace function public.kpi_calc(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  st public.gestion_settings%rowtype;
  dias int := greatest(p_to - p_from + 1, 0);
  ivaf numeric; v record; f record; canales jsonb; s record; o record; k record;
  netas numeric; pct_ins numeric; ins_est numeric; nomina numeric; fijos numeric; variables numeric; perdidas numeric;
  comisiones numeric; srv_local numeric; queda numeric;
begin
  select * into st from public.gestion_settings where id = 1;
  ivaf := 1 + coalesce(st.iva_pct, 16) / 100;
  -- Ventas
  select coalesce(sum(total), 0) total, coalesce(sum(service_amount), 0) servicio, coalesce(sum(tickets), 0) pedidos,
         coalesce(sum((by_method ->> 'debito')::numeric), 0) debito, coalesce(sum((by_method ->> 'credito')::numeric), 0) credito,
         coalesce(sum((by_method ->> 'pago_movil')::numeric), 0) pago_movil
    into v from public.daily_sales where sale_date between p_from and p_to;
  select coalesce(jsonb_object_agg(x.kind, jsonb_build_object('pedidos', x.n, 'ventas', round(x.monto, 2))), '{}'::jsonb) into canales
  from (select o2.kind, count(*) n, sum(t.subtotal - t.discount + t.delivery) monto
        from public.pos_orders o2 cross join lateral public.pos_totals(o2.id) t
        where o2.status = 'cobrada' and (o2.closed_at at time zone 'America/Caracas')::date between p_from and p_to group by o2.kind) x;
  -- Costos y margen
  select coalesce(sum(x.qty * x.uc) filter (where x.uc is not null), 0) costo,
         coalesce(sum(x.amount) filter (where x.uc is not null), 0) cubierto, coalesce(sum(x.amount), 0) vendido
    into f
  from (select si.dish_id, si.variant, sum(si.qty) qty, sum(si.amount) amount, public.kpi_costo_unidad(si.dish_id, si.variant) uc
        from public.sales_items si where si.sale_date between p_from and p_to group by si.dish_id, si.variant) x;
  netas := v.total / ivaf;
  pct_ins := case when f.cubierto > 0 then f.costo / (f.cubierto / ivaf) * 100 end;
  ins_est := coalesce(netas * pct_ins / 100, 0);
  select coalesce(sum(e.pay_quincena * 2 + coalesce(e.monthly_extra, 0)), 0) * dias * 12 / 365 into nomina from public.employees e where e.active;
  select coalesce(sum(x.amount), 0) * dias * 12 / 365 into fijos from public.expenses x where x.kind = 'fijo';
  select coalesce(sum(x.amount), 0) into variables from public.expenses x where x.kind <> 'fijo' and x.expense_date between p_from and p_to;
  select coalesce(sum(abs(m.cost)) filter (where m.kind = 'merma' or (m.kind = 'conteo' and m.delta < 0)), 0) into perdidas
    from public.inventory_movements m where (m.created_at at time zone 'America/Caracas')::date between p_from and p_to;
  comisiones := v.debito * coalesce(st.fee_debito, 0) / 100 + v.credito * coalesce(st.fee_credito, 0) / 100 + v.pago_movil * coalesce(st.fee_pago_movil, 0) / 100;
  srv_local := v.servicio * (1 - coalesce(st.service_staff_pct, 15) / 100);
  queda := netas + srv_local - comisiones - ins_est - nomina - fijos - variables - perdidas;
  -- Servicio
  select round(avg(extract(epoch from (i.ready_at - i.sent_at)) / 60)::numeric, 1) cocina, count(*) cocina_n into s
    from public.pos_items i
   where i.status <> 'anulado' and i.sent_at is not null and i.ready_at > i.sent_at and i.ready_at < i.sent_at + interval '2 hours'
     and (i.sent_at at time zone 'America/Caracas')::date between p_from and p_to;
  select round(avg(extract(epoch from (o2.closed_at - o2.opened_at)) / 60)::numeric) mesa, count(*) mesa_n into o
    from public.pos_orders o2
   where o2.status = 'cobrada' and o2.kind = 'mesa' and (o2.closed_at at time zone 'America/Caracas')::date between p_from and p_to
     and o2.closed_at between o2.opened_at + interval '2 minutes' and o2.opened_at + interval '6 hours';
  -- Control (descuentos de todos los pedidos cobrados, no solo de mesa)
  select (select coalesce(sum(o2.discount), 0) from public.pos_orders o2
           where o2.status = 'cobrada' and (o2.closed_at at time zone 'America/Caracas')::date between p_from and p_to) descuentos,
         (select count(*) from public.pos_items i where i.status = 'anulado' and i.sent_at is not null
           and (i.voided_at at time zone 'America/Caracas')::date between p_from and p_to) anulados_n,
         (select coalesce(sum(i.qty * i.unit_price), 0) from public.pos_items i where i.status = 'anulado' and i.sent_at is not null
           and (i.voided_at at time zone 'America/Caracas')::date between p_from and p_to) anulados_monto
    into k;
  return jsonb_build_object(
    'desde', p_from, 'hasta', p_to, 'dias', dias,
    'ventas', jsonb_build_object('total', round(v.total, 2), 'pedidos', v.pedidos,
                                 'ticket', case when v.pedidos > 0 then round(v.total / v.pedidos, 2) end, 'canales', canales),
    'costos', jsonb_build_object(
      'insumos_pct', round(pct_ins, 1), 'cobertura_pct', case when f.vendido > 0 then round(f.cubierto / f.vendido * 100) end,
      'insumos', round(ins_est, 2), 'nomina', round(nomina, 2), 'nomina_pct', case when netas > 0 then round(nomina / netas * 100, 1) end,
      'gastos', round(fijos + variables, 2), 'comisiones', round(comisiones, 2), 'perdidas', round(perdidas, 2),
      'servicio_local', round(srv_local, 2), 'netas', round(netas, 2),
      'queda', round(queda, 2), 'queda_pct', case when netas > 0 then round(queda / netas * 100, 1) end),
    'servicio', jsonb_build_object('cocina_min', s.cocina, 'cocina_n', s.cocina_n, 'mesa_min', o.mesa, 'mesa_n', o.mesa_n,
      'calificacion', (select round(avg(op.rating), 2) from public.opiniones op
                        where op.rating is not null and (op.created_at at time zone 'America/Caracas')::date between p_from and p_to),
      'calificaron', (select count(*) from public.opiniones op
                       where op.rating is not null and (op.created_at at time zone 'America/Caracas')::date between p_from and p_to),
      'recibos_qr', (select count(*) from public.opiniones op where (op.created_at at time zone 'America/Caracas')::date between p_from and p_to)),
    'control', jsonb_build_object(
      'descuentos', round(k.descuentos, 2), 'descuentos_pct', case when v.total > 0 then round(k.descuentos / v.total * 100, 1) end,
      'anulados', k.anulados_n, 'anulados_monto', round(k.anulados_monto, 2),
      'cierres', (select count(*) from public.pos_sessions ps where ps.status = 'cerrada'
                   and (ps.closed_at at time zone 'America/Caracas')::date between p_from and p_to),
      'cierres_fuera', (select count(*) from public.pos_sessions ps where ps.status = 'cerrada'
                         and (ps.closed_at at time zone 'America/Caracas')::date between p_from and p_to
                         and abs(public.kpi_diferencia_caja(ps.id)) > coalesce(st.alert_cash_diff, 5)),
      'diferencia', (select round(coalesce(sum(public.kpi_diferencia_caja(ps.id)), 0), 2) from public.pos_sessions ps where ps.status = 'cerrada'
                      and (ps.closed_at at time zone 'America/Caracas')::date between p_from and p_to))
  );
end $$;

-- Diferencia de un cierre en Ref (contado − esperado; los métodos en bolívares a la tasa de ese día), como el aviso del cierre
create or replace function public.kpi_diferencia_caja(p_session bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(((s.counted ->> k)::numeric - coalesce((s.expected ->> k)::numeric, 0))
                      / case when k in ('efectivo_bs', 'pago_movil', 'punto_debito', 'punto_credito')
                             then nullif(coalesce((select r.eur from public.pos_rates r where r.rate_date <= (s.closed_at at time zone 'America/Caracas')::date
                                                   order by r.rate_date desc limit 1), public.pos_rate()), 0) else 1 end), 0)
  from public.pos_sessions s cross join lateral jsonb_object_keys(coalesce(s.counted, '{}'::jsonb)) k
  where s.id = p_session and k not like '\_%' and jsonb_typeof(s.counted -> k) = 'number'
$$;

-- Gestión › Inicio: los últimos 7 o 30 días completos (hasta ayer) contra los 7 o 30 anteriores
create or replace function public.gestion_kpis(p_dias int default 7) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare n int := case when p_dias = 30 then 30 else 7 end; b date := (now() at time zone 'America/Caracas')::date - 1; a date;
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  a := b - n + 1;
  return jsonb_build_object('dias', n, 'actual', public.kpi_calc(a, b), 'anterior', public.kpi_calc(a - n, a - 1));
end $$;

-- Resumen del lunes: la semana (lunes a domingo) contra la anterior
create or replace function public.kpi_semana(p_lunes date) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('dias', 7, 'actual', public.kpi_calc(p_lunes, p_lunes + 6), 'anterior', public.kpi_calc(p_lunes - 7, p_lunes - 1))
$$;

revoke execute on function public.kpi_costo_unidad(bigint, text), public.kpi_calc(date, date), public.kpi_diferencia_caja(bigint),
  public.kpi_semana(date) from anon, public, authenticated;
revoke execute on function public.gestion_kpis(int) from anon, public;
grant execute on function public.gestion_kpis(int) to authenticated;
