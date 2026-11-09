-- Pantalla de cocina: el plato aparece al enviarlo, se marca listo, la mesera lo ve y lo marca servido
\set ON_ERROR_STOP 1
\set QUIET 1
select (select id from public.employees where name = 'Mesera Prueba') mesera, (select min(id) from public.dishes) plato,
       (select id from public.pos_tables where active order by id offset 1 limit 1) mesa \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_open(:mesera, '2222', :mesa) as o \gset
select public.pos_add(:mesera, '2222', :o, jsonb_build_array(jsonb_build_object('dish_id', :plato, 'qty', 2, 'notes', 'sin cebollín')));
select prueba.ok(not exists (select 1 from jsonb_array_elements(public.pos_kitchen() -> 'orders') x where (x ->> 'id')::bigint = :o), 'lo que no se ha enviado no sale en cocina');
select public.pos_send(:mesera, '2222', :o);
select (select x from jsonb_array_elements(public.pos_kitchen() -> 'orders') x where (x ->> 'id')::bigint = :o) as k \gset
select prueba.ok(:'k'::jsonb -> 'items' -> 0 ->> 'notes' = 'sin cebollín', 'al enviar, la comanda sale en cocina con su nota');
select (:'k'::jsonb -> 'items' -> 0 ->> 'id')::bigint as item \gset
select prueba.ok(public.pos_kitchen_ready(array[:item]::bigint[]) = 1, 'cocina marca el plato listo con un toque');
select prueba.ok(not exists (select 1 from jsonb_array_elements(public.pos_kitchen() -> 'orders') x where (x ->> 'id')::bigint = :o), 'lo listo sale de la pantalla');
select prueba.ok((select (x ->> 'ready')::int from jsonb_array_elements(public.pos_state() -> 'orders') x where (x ->> 'id')::bigint = :o) = 1, 'la tablet de la mesera ve 1 plato listo');
select prueba.ok(public.pos_served(:mesera, '2222', :o) = 1, 'la mesera marca servido');
select prueba.ok((select (x ->> 'ready')::int from jsonb_array_elements(public.pos_state() -> 'orders') x where (x ->> 'id')::bigint = :o) = 0, 'ya no aparece como listo');
select prueba.ok(jsonb_array_length(public.pos_dish_times(30)) >= 1, 'el tiempo del plato entra al promedio');
reset role;
\echo 'TODAS LAS PRUEBAS DE COCINA PASARON'
