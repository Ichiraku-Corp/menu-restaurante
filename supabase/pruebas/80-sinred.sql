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
\echo 'TODAS LAS PRUEBAS SIN INTERNET PASARON'
