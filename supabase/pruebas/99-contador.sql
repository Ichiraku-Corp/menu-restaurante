-- Resumen del mes para el contador: ventas por día (POS y Syth), cobros por método, gastos y nómina pagada
\set ON_ERROR_STOP 1
\set QUIET 1
select (select id from public.employees where name = 'Cajera Prueba') caja, (select id from public.employees where name = 'Mesera Prueba') mesera,
       (now() at time zone 'America/Caracas')::date hoy \gset
select date_trunc('month', :'hoy'::date)::date m0, date_trunc('month', :'hoy'::date)::date + case when extract(day from :'hoy'::date) >= 16 then 15 else 0 end q0 \gset
select case when :'hoy'::date = :'m0'::date then :'m0'::date + 1 else :'m0'::date end dsyth \gset
-- Lo esperado de hoy, calculado aparte
select coalesce(sum(t.subtotal - t.discount), 0) ventas, coalesce(sum(t.service), 0) serv, count(*) n
  from public.pos_orders o cross join lateral public.pos_totals(o.id) t
 where o.status = 'cobrada' and (o.closed_at at time zone 'America/Caracas')::date = :'hoy'::date \gset
select coalesce(sum(p.amount_ref), 0) cobrado from public.pos_payments p join public.pos_orders o on o.id = p.order_id
 where o.status = 'cobrada' and not p.is_tip and (o.closed_at at time zone 'America/Caracas')::date = :'hoy'::date \gset
-- Un día de Syth, gastos (fijo, del mes y del mes pasado), una salida de caja con foto y un pago de nómina
insert into public.daily_sales (sale_date, total, service_amount, source) values (:'dsyth', 812.4, 60.1, 'syth')
  on conflict (sale_date) do update set total = excluded.total, service_amount = excluded.service_amount, source = excluded.source;
insert into public.expenses (concept, amount, kind, expense_date) values ('Alquiler (prueba)', 900, 'fijo', :'m0'::date - 40),
  ('Gas (prueba)', 35.5, 'variable', :'hoy'), ('Gas viejo (prueba)', 30, 'variable', :'m0'::date - 3);
insert into public.pos_payments (order_id, method, currency, amount, amount_ref, cash_out_reason, created_by, session_id)
  values (null, 'efectivo_usd', 'REF', -5, -5, 'Hielo (prueba)', :caja, (select id from public.pos_sessions where status = 'abierta' limit 1)) returning id as salida \gset
insert into public.pos_facturas (kind, path, payment_id, created_by) values ('salida', '2026-11/abcdefabcdefabcdefabcdefabcdef01.jpg', :salida, :caja);
insert into public.payroll_payments (employee_id, period, amount_ref, rate, amount_bs) values (:mesera, :'q0', 140, 100, 14000);

set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
select public.gestion_contador(:'hoy'::date) as c \gset
select prueba.ok((:'c'::jsonb ->> 'mes')::date = :'m0'::date and (:'c'::jsonb ->> 'iva_pct')::numeric > 0, 'trae el mes y el IVA incluido en los precios');
select prueba.ok(exists (select 1 from jsonb_array_elements(:'c'::jsonb -> 'dias') d where (d ->> 'fecha')::date = :'hoy'::date and d ->> 'fuente' = 'pos'
                   and (d ->> 'ventas')::numeric = round(:ventas, 2) and (d ->> 'servicio')::numeric = round(:serv, 2) and (d ->> 'tickets')::int = :n),
  'hoy sale del sistema propio: ventas sin servicio, servicio y pedidos (' || :n || ')');
select prueba.ok((select abs(sum((m.value ->> 'ref')::numeric) - :cobrado) < 0.01 from jsonb_array_elements(:'c'::jsonb -> 'dias') d, jsonb_each(d -> 'metodos') m
                   where (d ->> 'fecha')::date = :'hoy'::date), 'los cobros por método de hoy suman lo cobrado (con el vuelto restado y sin propinas)');
select prueba.ok(exists (select 1 from jsonb_array_elements(:'c'::jsonb -> 'dias') d where (d ->> 'fecha')::date = :'dsyth'::date and d ->> 'fuente' = 'syth'
                   and (d ->> 'ventas')::numeric = 812.4 and (d ->> 'servicio')::numeric = 60.1 and d -> 'metodos' = '{}'::jsonb),
  'un día de Syth trae el total y el servicio (sin métodos)');
select prueba.ok(exists (select 1 from jsonb_array_elements(:'c'::jsonb -> 'dias') d where (d ->> 'tasa')::numeric > 0), 'cada día lleva su tasa BCV');
select prueba.ok((select count(*) from jsonb_array_elements(:'c'::jsonb -> 'gastos') g where g ->> 'concepto' in ('Alquiler (prueba)', 'Gas (prueba)')) = 2
             and not exists (select 1 from jsonb_array_elements(:'c'::jsonb -> 'gastos') g where g ->> 'concepto' = 'Gas viejo (prueba)'),
  'los gastos llevan los fijos y los del mes (no los del mes pasado)');
select prueba.ok(exists (select 1 from jsonb_array_elements(:'c'::jsonb -> 'gastos') g where g ->> 'concepto' = 'Hielo (prueba)' and (g ->> 'monto')::numeric = 5
                   and (g ->> 'factura')::boolean and g ->> 'tipo' = 'Salida de caja (Efectivo $)'), 'las salidas de caja van como gasto, con su método y si tienen foto de la factura');
select prueba.ok(exists (select 1 from jsonb_array_elements(:'c'::jsonb -> 'nomina') y where y ->> 'empleado' = 'Mesera Prueba' and (y ->> 'bs')::numeric = 14000),
  'la nómina marcada como pagada va con su tasa y sus Bs');
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.falla('select public.gestion_contador(null)', 'Sin permiso', 'una tablet no puede sacar el resumen del contador');
reset role;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select prueba.falla('select public.gestion_contador(null)', 'permission denied', 'el público tampoco');
reset role;
delete from public.payroll_payments where employee_id = :mesera and period = :'q0';
delete from public.pos_facturas where payment_id = :salida;
delete from public.pos_payments where id = :salida;
delete from public.expenses where concept like '%(prueba)';
delete from public.daily_sales where sale_date = :'dsyth' and source = 'syth' and total = 812.4;
select set_config('request.jwt.claims', '', false);
\echo 'TODAS LAS PRUEBAS DEL RESUMEN PARA EL CONTADOR PASARON'
