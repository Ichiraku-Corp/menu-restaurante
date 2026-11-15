-- ============================================================================
-- Resumen del mes para el contador (Ichiraku)
--  · Gestión → Dinero → Ventas → «Excel para el contador» arma un .xlsx con: resumen, ventas por día
--    (base imponible e IVA incluido en los precios, servicio, delivery), cobros por método (con lo
--    cobrado en divisas: base del IGTF, si aplica), gastos (fijos, del mes y salidas de caja) y la
--    nómina marcada como pagada. En Ref y en Bs a la tasa euro BCV de cada día.
--  · Los días de Syth (antes del sistema propio) solo traen el total y el servicio.
-- Se ejecuta después de gestion.sql, pos.sql y nomina.sql. Se puede volver a ejecutar.
-- ============================================================================

create or replace function public.gestion_contador(p_mes date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m0 date; m1 date; t0 timestamptz; t1 timestamptz; r jsonb;
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  m0 := date_trunc('month', coalesce(p_mes, (now() at time zone 'America/Caracas')::date))::date;
  m1 := (m0 + interval '1 month - 1 day')::date;
  t0 := m0::timestamp at time zone 'America/Caracas'; t1 := (m1 + 1)::timestamp at time zone 'America/Caracas';
  with ped as (
    select o.id, (o.closed_at at time zone 'America/Caracas')::date d, t.subtotal - t.discount neto, t.service serv, t.delivery deliv
    from public.pos_orders o cross join lateral public.pos_totals(o.id) t
    where o.status = 'cobrada' and o.closed_at >= t0 and o.closed_at < t1
  ), pd as (
    select d, count(*) n, sum(neto) neto, sum(serv) serv, sum(deliv) deliv from ped group by d
  ), pg as (
    select ped.d, p.method, sum(p.amount_ref) ref, sum(p.amount) monto
    from public.pos_payments p join ped on ped.id = p.order_id where not p.is_tip group by 1, 2
  ), dia as (
    select g::date d, (select eur from public.pos_rates x where x.rate_date <= g::date order by x.rate_date desc limit 1) tasa
    from generate_series(m0, m1, interval '1 day') g
  )
  select jsonb_build_object(
    'mes', m0, 'hasta', m1,
    'iva_pct', coalesce((select max(iva_pct) from public.gestion_settings), 16),
    'dias', coalesce((select jsonb_agg(jsonb_build_object(
        'fecha', dia.d, 'tasa', dia.tasa, 'fuente', case when pd.d is not null then 'pos' else coalesce(ds.source, 'syth') end,
        'tickets', coalesce(pd.n, ds.tickets, 0),
        'ventas', round(coalesce(pd.neto, ds.total, 0), 2), 'servicio', round(coalesce(pd.serv, ds.service_amount, 0), 2), 'delivery', round(coalesce(pd.deliv, 0), 2),
        'metodos', coalesce((select jsonb_object_agg(pg.method, jsonb_build_object('ref', round(pg.ref, 2), 'monto', round(pg.monto, 2))) from pg where pg.d = dia.d), '{}'::jsonb))
        order by dia.d)
      from dia left join pd on pd.d = dia.d left join public.daily_sales ds on ds.sale_date = dia.d
      where pd.d is not null or coalesce(ds.total, 0) > 0), '[]'::jsonb),
    'gastos', coalesce((select jsonb_agg(g order by g ->> 'fecha', g ->> 'concepto') from (
        select jsonb_build_object('fecha', case when e.kind = 'fijo' then m0 else e.expense_date end, 'concepto', e.concept,
               'tipo', case when e.kind = 'fijo' then 'Fijo del mes' else 'Gasto' end, 'monto', round(e.amount, 2), 'factura', false) g
        from public.expenses e where e.kind = 'fijo' or e.expense_date between m0 and m1
        union all
        select jsonb_build_object('fecha', (p.created_at at time zone 'America/Caracas')::date, 'concepto', p.cash_out_reason,
               'tipo', 'Salida de caja (' || public.pos_metodo_nombre(p.method) || ')', 'monto', round(-p.amount_ref, 2),
               'factura', exists (select 1 from public.pos_facturas f where f.payment_id = p.id))
        from public.pos_payments p where p.cash_out_reason <> '' and p.created_at >= t0 and p.created_at < t1) x), '[]'::jsonb),
    'nomina', coalesce((select jsonb_agg(jsonb_build_object('quincena', y.period, 'empleado', e.name, 'ref', y.amount_ref, 'tasa', y.rate, 'bs', y.amount_bs,
                 'fecha', (y.paid_at at time zone 'America/Caracas')::date) order by y.period, e.name)
               from public.payroll_payments y join public.employees e on e.id = y.employee_id where y.period between m0 and m1), '[]'::jsonb)
  ) into r;
  return r;
end $$;
revoke execute on function public.gestion_contador(date) from anon, public;
grant execute on function public.gestion_contador(date) to authenticated;
