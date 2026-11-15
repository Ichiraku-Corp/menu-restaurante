-- Estaciones de cocina: cada pantalla ve solo los platos de su estación (por plato, por categoría o la principal)
\set ON_ERROR_STOP 1
\set QUIET 1
select (select id from public.employees where name = 'Mesera Prueba') mesera,
       (select id from public.pos_tables where active order by id offset 3 limit 1) mesa \gset
-- Tres platos sin tamaños de tres categorías distintas
select (array_agg(d.id order by d.category_id))[1] a, (array_agg(d.id order by d.category_id))[2] b, (array_agg(d.id order by d.category_id))[3] c,
       (array_agg(d.category_id order by d.category_id))[1] cat_a, (array_agg(d.category_id order by d.category_id))[2] cat_b
  from (select distinct on (category_id) id, category_id from public.dishes where available and jsonb_array_length(coalesce(variants, '[]'::jsonb)) = 0 order by category_id, id) d \gset
insert into public.kitchen_stations (name, position) values ('Ramen', 1), ('Sushi', 2), ('Bebidas y postres', 3);
select (select id from public.kitchen_stations where name = 'Ramen') ramen, (select id from public.kitchen_stations where name = 'Sushi') sushi,
       (select id from public.kitchen_stations where name = 'Bebidas y postres') barra \gset
update public.categories set station_id = :sushi where id = :cat_a;      -- la categoría del plato A va a Sushi
update public.dishes set station_id = :barra where id = :c;              -- el plato C va a la barra aunque su categoría no
-- La categoría del plato B no tiene estación: va a la principal (Ramen, la primera)

set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_open(:mesera, '2222', :mesa) as o \gset
select public.pos_add(:mesera, '2222', :o, jsonb_build_array(jsonb_build_object('dish_id', :a, 'qty', 1), jsonb_build_object('dish_id', :b, 'qty', 2), jsonb_build_object('dish_id', :c, 'qty', 1)));
select public.pos_send(:mesera, '2222', :o);
reset role;
select (select id from public.pos_items where order_id = :o and dish_id = :a) ia, (select id from public.pos_items where order_id = :o and dish_id = :c) ic \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select (select x from jsonb_array_elements(public.pos_kitchen(:sushi) -> 'orders') x where (x ->> 'id')::bigint = :o) ks,
       (select x from jsonb_array_elements(public.pos_kitchen(:ramen) -> 'orders') x where (x ->> 'id')::bigint = :o) kr,
       (select x from jsonb_array_elements(public.pos_kitchen(:barra) -> 'orders') x where (x ->> 'id')::bigint = :o) kb,
       (select x from jsonb_array_elements(public.pos_kitchen(null) -> 'orders') x where (x ->> 'id')::bigint = :o) kt \gset
select prueba.ok(jsonb_array_length(:'ks'::jsonb -> 'items') = 1 and :ia = (:'ks'::jsonb -> 'items' -> 0 ->> 'id')::bigint,
  'Sushi ve solo el plato de su categoría');
select prueba.ok(jsonb_array_length(:'kr'::jsonb -> 'items') = 1 and (:'kr'::jsonb -> 'items' -> 0 ->> 'qty')::numeric = 2, 'lo que no tiene estación va a la principal (Ramen)');
select prueba.ok(jsonb_array_length(:'kb'::jsonb -> 'items') = 1 and :ic = (:'kb'::jsonb -> 'items' -> 0 ->> 'id')::bigint,
  'un plato con su propia estación va a esa (la barra), aunque su categoría no');
select prueba.ok(jsonb_array_length(:'kt'::jsonb -> 'items') = 3, '«Todas» muestra el pedido completo');
select prueba.ok((:'ks'::jsonb -> 'others' ->> 'Ramen')::int = 1 and (:'ks'::jsonb -> 'others' ->> 'Bebidas y postres')::int = 1, 'cada estación ve qué más lleva el pedido en las otras');
select prueba.ok((select (s ->> 'pending')::int from jsonb_array_elements(public.pos_kitchen(null) -> 'stations') s where (s ->> 'id')::bigint = :sushi) >= 1
             and jsonb_array_length(public.pos_kitchen(null) -> 'stations') = 3, 'trae las estaciones con sus platos pendientes');
select prueba.ok(public.pos_kitchen_ready(array[(:'ks'::jsonb -> 'items' -> 0 ->> 'id')::bigint]) = 1, 'Sushi marca su plato listo');
select prueba.ok(exists (select 1 from jsonb_array_elements(public.pos_kitchen(:sushi) -> 'recent') r where (r ->> 'id')::bigint = :ia)
             and (public.pos_kitchen(:sushi) -> 'today' ->> 'count')::int + (public.pos_kitchen(:ramen) -> 'today' ->> 'count')::int + (public.pos_kitchen(:barra) -> 'today' ->> 'count')::int
                 = (public.pos_kitchen(null) -> 'today' ->> 'count')::int
             and not exists (select 1 from jsonb_array_elements(public.pos_kitchen(:ramen) -> 'recent') r where (r ->> 'id')::bigint = (:'ks'::jsonb -> 'items' -> 0 ->> 'id')::bigint),
  '«Listos» y el promedio de hoy son de cada estación');
select prueba.falla('insert into public.kitchen_stations (name) values (''Hack'')', 'row-level security', 'una tablet no crea estaciones');
reset role;
-- Una estación apagada: sus platos van a la principal
update public.kitchen_stations set active = false where id = :sushi;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_add(:mesera, '2222', :o, jsonb_build_array(jsonb_build_object('dish_id', :a, 'qty', 1)));
select public.pos_send(:mesera, '2222', :o);
select prueba.ok((select jsonb_array_length(x -> 'items') from jsonb_array_elements(public.pos_kitchen(:ramen) -> 'orders') x where (x ->> 'id')::bigint = :o) = 2
             and jsonb_array_length(public.pos_kitchen(null) -> 'stations') = 2, 'si se apaga una estación, sus platos van a la principal');
reset role;
update public.pos_items set ready_at = now() where order_id = :o and ready_at is null and status = 'enviado';
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select prueba.falla('select count(*) from public.kitchen_stations', 'permission denied', 'el público no ve las estaciones');
reset role;
delete from public.kitchen_stations;
select prueba.ok((select count(*) from public.categories where station_id is not null) = 0 and (select count(*) from public.dishes where station_id is not null) = 0,
  'al borrar las estaciones, platos y categorías quedan sin estación');
select set_config('request.jwt.claims', '', false);
\echo 'TODAS LAS PRUEBAS DE ESTACIONES PASARON'
