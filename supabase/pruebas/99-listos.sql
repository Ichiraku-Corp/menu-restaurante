-- Pantalla de pedidos para llevar: «Preparando» → «¡Listo!» → sale al entregarlo
\set ON_ERROR_STOP 1
\set QUIET 1
select (select id from public.employees where name = 'Mesera Prueba') mesera,
       (select id from public.pos_tables where active order by id offset 4 limit 1) mesa,
       (select id from public.dishes where available and jsonb_array_length(coalesce(variants, '[]'::jsonb)) = 0 order by id limit 1) plato \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_open(:mesera, '2222', null, 'Para retirar') as o \gset
select public.pos_open(:mesera, '2222', :mesa) as om \gset
select public.pos_add(:mesera, '2222', :o, jsonb_build_array(jsonb_build_object('dish_id', :plato, 'qty', 2)));
select public.pos_add(:mesera, '2222', :om, jsonb_build_array(jsonb_build_object('dish_id', :plato, 'qty', 1)));
reset role;
select day_number n from public.pos_orders where id = :o \gset
select day_number nm from public.pos_orders where id = :om \gset
select array_agg(id) items from public.pos_items where order_id = :o \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.ok(not exists (select 1 from jsonb_array_elements(public.pos_listos() -> 'preparando') x where (x ->> 'n')::int = :n), 'lo que no se ha enviado a cocina no sale');
select public.pos_send(:mesera, '2222', :o);
select public.pos_send(:mesera, '2222', :om);
select prueba.ok(exists (select 1 from jsonb_array_elements(public.pos_listos() -> 'preparando') x where (x ->> 'n')::int = :n), 'al enviarlo sale en «Preparando» con su número (#' || :n || ')');
select prueba.ok(not exists (select 1 from jsonb_array_elements(public.pos_listos() -> 'preparando') x where (x ->> 'n')::int = :nm), 'los pedidos de mesa no salen en la pantalla');
select public.pos_kitchen_ready(:'items'::bigint[]);
select prueba.ok(exists (select 1 from jsonb_array_elements(public.pos_listos() -> 'listos') x where (x ->> 'n')::int = :n)
             and not exists (select 1 from jsonb_array_elements(public.pos_listos() -> 'preparando') x where (x ->> 'n')::int = :n), 'cuando cocina lo marca listo, pasa a «¡Listo!»');
select public.pos_served(:mesera, '2222', :o) as srv \gset
select prueba.ok(:srv >= 1 and not exists (select 1 from jsonb_array_elements(public.pos_listos() -> 'listos') x where (x ->> 'n')::int = :n),
  'al marcarlo entregado sale de la pantalla');
reset role;
update public.pos_items set served_at = null, ready_at = now() - interval '40 minutes' where order_id = :o;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.ok(not exists (select 1 from jsonb_array_elements(public.pos_listos() -> 'listos') x where (x ->> 'n')::int = :n), 'a los 30 minutos de listo sale solo');
select set_config('request.jwt.claims', '{"role":"authenticated","email":"nadie@prueba.test"}', false);
reset role;
-- Si la cocina nunca lo marca listo, a los 90 minutos deja de salir en «Preparando»
update public.pos_items set served_at = null, ready_at = null, sent_at = now() - interval '80 minutes' where order_id = :o;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.ok(exists (select 1 from jsonb_array_elements(public.pos_listos() -> 'preparando') x where (x ->> 'n')::int = :n), 'a los 80 minutos sin marcar sigue en «Preparando»');
reset role;
update public.pos_items set sent_at = now() - interval '95 minutes' where order_id = :o;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.ok(not exists (select 1 from jsonb_array_elements(public.pos_listos() -> 'preparando') x where (x ->> 'n')::int = :n), 'a los 90 minutos sin marcarlo listo sale de «Preparando»');
select set_config('request.jwt.claims', '{"role":"authenticated","email":"nadie@prueba.test"}', false);
select prueba.falla('select public.pos_listos()', 'no está autorizado', 'solo la ve un equipo del restaurante');
reset role;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select prueba.falla('select public.pos_listos()', 'permission denied', 'el público no la puede pedir');
reset role;
select set_config('request.jwt.claims', '', false);
\echo 'TODAS LAS PRUEBAS DE LA PANTALLA DE PEDIDOS LISTOS PASARON'
