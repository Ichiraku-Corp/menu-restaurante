-- Modo sin internet: llave de la red local y subida de los pedidos hechos sin internet
\set ON_ERROR_STOP 1
\set QUIET 1
select (select id from public.employees where name = 'Mesera Prueba') mesera \gset
select (select id from public.pos_tables where active order by id desc limit 1) mesa \gset
select (select min(id) from public.dishes) plato \gset
update public.pos_orders set status = 'cobrada' where table_id = :mesa and status = 'abierta';
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_lan_token() ->> 'token' as tk \gset
select prueba.ok(length(:'tk') = 36, 'la tablet recibe la llave de la red local');
select prueba.falla($$select public.pos_offline_sync('{}')$$, 'Sin permiso', 'una tablet no sube pedidos por su cuenta');
select set_config('request.jwt.claims', '{"role":"authenticated","email":"puente@prueba.test"}', false);
select prueba.ok(public.pos_lan_token() ->> 'token' = :'tk', 'el puente recibe la misma llave');

-- Mesa nueva abierta sin internet, con dos envíos a cocina
select public.pos_offline_sync(jsonb_build_object('uuid', 'prueba-sinred-001', 'at', now() - interval '20 minutes', 'device', 'Tablet Feria', 'emp', :mesera, 'pin', '2222',
  'order', jsonb_build_object('tmp', 'sr-abc123', 'kind', 'mesa', 'table_id', :mesa, 'label', 'Mesa de prueba'),
  'items', jsonb_build_array(jsonb_build_object('dish_id', :plato, 'qty', 2, 'notes', 'sin salsa')))) as r1 \gset
select prueba.ok((:'r1'::jsonb ->> 'platos')::int = 1 and :'r1'::jsonb ->> 'nota' = '', 'sube el primer envío con PIN verificado');
select public.pos_offline_sync(jsonb_build_object('uuid', 'prueba-sinred-002', 'at', now() - interval '10 minutes', 'emp', :mesera, 'pin', '2222',
  'order', jsonb_build_object('tmp', 'sr-abc123', 'kind', 'mesa', 'table_id', :mesa),
  'items', jsonb_build_array(jsonb_build_object('dish_id', :plato, 'qty', 1)))) as r2 \gset
select prueba.ok(:'r1'::jsonb ->> 'order_id' = :'r2'::jsonb ->> 'order_id', 'el segundo envío va al mismo pedido');
select public.pos_offline_sync(jsonb_build_object('uuid', 'prueba-sinred-002', 'emp', :mesera, 'pin', '2222', 'order', '{}'::jsonb, 'items', '[]'::jsonb)) as r3 \gset
select prueba.ok((:'r3'::jsonb ->> 'repetido')::boolean, 'si el puente lo manda dos veces, no se duplica');
reset role;
select prueba.ok((select count(*) from public.pos_items where order_id = (:'r1'::jsonb ->> 'order_id')::bigint and status = 'enviado') = 2
  and (select table_id from public.pos_orders where id = (:'r1'::jsonb ->> 'order_id')::bigint) = :mesa, 'la mesa queda abierta con los platos enviados, lista para cobrar');
select prueba.ok((select bool_and(sent_at < now() - interval '5 minutes') from public.pos_items where order_id = (:'r1'::jsonb ->> 'order_id')::bigint), 'guarda la hora real en que se pidió');
select prueba.ok((select count(*) from public.pos_print_jobs where body like '%sin salsa%') = 0, 'no vuelve a imprimir la comanda (ya salió en cocina)');
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"puente@prueba.test"}', false);
-- PIN equivocado: el pedido igual se guarda (ya se cocinó), pero queda marcado
select public.pos_offline_sync(jsonb_build_object('uuid', 'prueba-sinred-003', 'emp', :mesera, 'pin', '0000',
  'order', jsonb_build_object('tmp', 'sr-xyz', 'kind', 'llevar', 'label', 'Juan'), 'items', jsonb_build_array(jsonb_build_object('dish_id', :plato, 'qty', 1)))) as r4 \gset
select prueba.ok(:'r4'::jsonb ->> 'nota' = 'PIN no verificado', 'con PIN equivocado se guarda marcado «PIN no verificado»');
reset role;

-- ---------------------------------------------------------------- Parte 2: cobros hechos sin internet
select (select id from public.employees where name = 'Cajera Prueba') caja, not exists (select 1 from public.pos_sessions where status = 'abierta') hay_que_abrir,
       (select total from public.pos_totals((:'r1'::jsonb ->> 'order_id')::bigint)) total1, (select total from public.pos_totals((:'r4'::jsonb ->> 'order_id')::bigint)) total4 \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
\if :hay_que_abrir
select public.pos_cash_open(:caja, '1111', 0, 0);
\endif
select prueba.falla($$select public.pos_offline_pay('{"uuid":"prueba-pago-000"}')$$, 'Sin permiso', 'una tablet no sube cobros por su cuenta');
select prueba.falla(format('select public.pos_pay_core(%s, %s, %L, %L, false, now(), true)', :caja, (:'r1'::jsonb ->> 'order_id'), '[]', 'REF'), 'permission denied', 'nadie llama el cobro interno sin PIN');
reset role;
select count(*) as jobs0 from public.pos_print_jobs \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"puente@prueba.test"}', false);
-- La mesa abierta sin internet se cobra sin internet: $ en efectivo con vuelto en $
select public.pos_offline_pay(jsonb_build_object('uuid', 'prueba-pago-001', 'at', now() - interval '5 minutes', 'device', 'Caja', 'emp', :caja, 'pin', '1111',
  'order', jsonb_build_object('tmp', 'sr-abc123', 'label', 'Mesa de prueba'), 'change_currency', 'REF',
  'lines', jsonb_build_array(jsonb_build_object('method', 'efectivo_usd', 'amount', :total1 + 5)))) as p1 \gset
select prueba.ok(:'p1'::jsonb ->> 'nota' = '' and (:'p1'::jsonb -> 'cobro' ->> 'closed')::boolean, 'sube el cobro de la mesa hecha sin internet y la cierra');
select public.pos_offline_pay(jsonb_build_object('uuid', 'prueba-pago-001', 'emp', :caja, 'pin', '1111', 'order', '{}'::jsonb, 'lines', '[]'::jsonb)) as p2 \gset
select prueba.ok((:'p2'::jsonb ->> 'repetido')::boolean, 'si el puente lo manda dos veces, no se cobra dos veces');
select public.pos_offline_pay(jsonb_build_object('uuid', 'prueba-pago-002', 'emp', :caja, 'pin', '1111', 'order', jsonb_build_object('tmp', 'sr-abc123'),
  'lines', jsonb_build_array(jsonb_build_object('method', 'efectivo_usd', 'amount', 3)))) as p3 \gset
-- Cobrado de menos (la cuenta creció con internet): queda anotado, abierto y con aviso
select public.pos_offline_pay(jsonb_build_object('uuid', 'prueba-pago-003', 'emp', :caja, 'pin', '1111', 'order', jsonb_build_object('tmp', 'sr-xyz', 'label', 'Juan'),
  'lines', jsonb_build_array(jsonb_build_object('method', 'pago_movil', 'amount', round(:total4 * 100 / 2, 2), 'reference', '1234')))) as p4 \gset
reset role;
select (:'p1'::jsonb ->> 'order_id')::bigint as o1, (:'p4'::jsonb ->> 'order_id')::bigint as o4 \gset
select prueba.ok((select status = 'cobrada' and closed_at < now() - interval '4 minutes' and session_id is not null from public.pos_orders where id = :o1)
  and (select bool_and(created_at < now() - interval '4 minutes') from public.pos_payments where order_id = :o1)
  and (select count(*) from public.pos_payments where order_id = :o1 and amount < 0 and currency = 'REF') = 1, 'queda cobrada a la hora real, en la caja abierta, con su vuelto en $');
select prueba.ok(:'p3'::jsonb ->> 'nota' like '%ya estaba cobrada%' and (select count(*) from public.pos_payments where order_id = :o1) = 2, 'un segundo cobro del mismo pedido no se anota dos veces');
select prueba.ok(:'p4'::jsonb ->> 'nota' like '%quedan Ref%' and (select status from public.pos_orders where id = :o4) = 'abierta'
  and (select count(*) from public.pos_payments where order_id = :o4 and reference = '1234') = 1, 'si se cobró de menos, el pago queda anotado y el pedido abierto');
select prueba.ok((select count(*) from public.pos_offline_entries where kind = 'pago') = 3 and (select count(*) from public.pos_print_jobs) = :jobs0,
  'los cobros quedan registrados y no se vuelve a imprimir el recibo (ya salió en la laptop)');
\echo 'TODAS LAS PRUEBAS SIN INTERNET PASARON'
