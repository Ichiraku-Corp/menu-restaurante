-- Yummy como método de pago (pedido de Edgar, 24/11): Yummy le cobra al cliente en su app y le paga al restaurante
-- después por pago móvil. En la caja queda «Yummy (por cobrar)»: no va en la gaveta y se ve el total del mes.
-- Todo en una transacción que se deshace al final.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;
select (select id from public.employees where name = 'Cajera Prueba') caja, (select id from public.employees where name = 'Mesera Prueba') mesera,
       (select id from public.dishes where name = 'Teuchi') teuchi \gset
select not exists (select 1 from public.pos_sessions where status = 'abierta') as hay_que_abrir \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
\if :hay_que_abrir
select public.pos_cash_open(:caja, '1111', 0, 0);
\endif
select public.pos_open_delivery(:mesera, '2222', 'Cliente Yummy', '', '', 0, 'yummy') as o1 \gset
select public.pos_add(:mesera, '2222', :o1, jsonb_build_array(jsonb_build_object('dish_id', :teuchi, 'variant', 'Gr', 'qty', 1)));
select public.pos_send(:mesera, '2222', :o1);
reset role;
select total as t1 from public.pos_totals(:o1) \gset
set role authenticated;
select public.pos_pay(:caja, '1111', :o1, jsonb_build_array(jsonb_build_object('method', 'yummy', 'amount', :t1, 'device', 'Caja')), 'REF', false, false) ->> 'closed' as c1 \gset
reset role;
select prueba.ok(:'c1' = 'true' and (select customer_id from public.pos_orders where id = :o1) is null, 'un pedido de Yummy se cobra con Yummy sin datos del cliente');
select prueba.ok((select currency = 'REF' and amount_ref = round(:t1::numeric, 2) from public.pos_payments where order_id = :o1), 'queda anotado en Ref por el total');

-- El resumen del cierre: Yummy aparece aparte, como «por cobrar», con lo que va del mes
select id as ses from public.pos_sessions where status = 'abierta' \gset
select public.pos_session_report(:ses) as rep \gset
select prueba.ok((:'rep'::jsonb -> 'yummy_mes' ->> 'ref')::numeric >= round(:t1::numeric, 2) and (:'rep'::jsonb -> 'yummy_mes' ->> 'pedidos')::int >= 1,
  'el reporte del cierre trae lo vendido por Yummy en el mes');
update public.pos_orders set status = 'anulada', void_reason = 'prueba' where status = 'abierta';
-- Sin correos configurados el cierre se imprime: así se ve el texto del cierre
update public.gestion_settings set report_emails = '';
set role authenticated;
select public.pos_cash_close(:caja, '1111', '{}'::jsonb, '');
reset role;
select prueba.ok((select body from public.pos_print_jobs where body like '%CIERRE DE CAJA%' order by id desc limit 1) ~ 'Yummy \(por cobrar\) +Ref',
  'el cierre impreso muestra «Yummy (por cobrar)» aparte de lo que hay en la gaveta');
select prueba.ok((select (expected ->> 'yummy')::numeric from public.pos_sessions where id = :ses) = round(:t1::numeric, 2)
  and (select (expected ->> 'efectivo_usd')::numeric - opening_usd from public.pos_sessions where id = :ses)
      = (select coalesce(sum(amount), 0) from public.pos_payments where session_id = :ses and method = 'efectivo_usd'),
  'Yummy queda aparte: no se suma al efectivo esperado en la gaveta');
-- Ventas del día en Gestión: Yummy con su propia línea
select public.pos_sync_day((now() at time zone 'America/Caracas')::date);
select prueba.ok((select (by_method ->> 'yummy')::numeric from public.daily_sales where sale_date = (now() at time zone 'America/Caracas')::date) >= round(:t1::numeric, 2),
  'en las ventas del día Yummy tiene su propia línea (para el total del mes en Gestión)');
select set_config('request.jwt.claims', '', false);
rollback;
\echo TODAS LAS PRUEBAS DE YUMMY PASARON
