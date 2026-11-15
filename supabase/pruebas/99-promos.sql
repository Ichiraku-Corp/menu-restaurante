-- Promociones programadas: Gestión las crea, la caja las aplica sola en su horario y la carta las ve
\set ON_ERROR_STOP 1
\set QUIET 1
select (select id from public.employees where name = 'Mesera Prueba') mesera,
       (select id from public.dishes where jsonb_array_length(coalesce(variants, '[]'::jsonb)) = 0 and available order by id limit 1) plato,
       extract(isodow from now() at time zone 'America/Caracas')::int hoy \gset
select price as precio, category_id as cat from public.dishes where id = :plato \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
select prueba.falla('select public.gestion_promo_guardar(''{"name":"Mala","percent":95,"days":[1],"start_time":"10:00","end_time":"12:00","dish_ids":[1]}''::jsonb)', '1 % a 90 %', 'no deja un descuento de más de 90 %');
select prueba.falla('select public.gestion_promo_guardar(''{"name":"Mala","percent":10,"days":[1],"start_time":"12:00","end_time":"10:00","dish_ids":[1]}''::jsonb)', 'después de la de inicio', 'la hora de fin va después de la de inicio');
select prueba.falla('select public.gestion_promo_guardar(''{"name":"Mala","percent":10,"days":[1],"start_time":"10:00","end_time":"12:00"}''::jsonb)', 'platos o categorías', 'pide a qué platos aplica');
-- Una que vale todo el día de hoy (por categoría) y otra que hoy no aplica (otro día), con más descuento
select public.gestion_promo_guardar(jsonb_build_object('name', 'Happy hour', 'percent', 20, 'days', jsonb_build_array(:hoy),
         'start_time', '00:00', 'end_time', '23:59:59.999', 'category_ids', jsonb_build_array(:cat))) as p1 \gset
select public.gestion_promo_guardar(jsonb_build_object('name', 'Otro día', 'percent', 50, 'days', jsonb_build_array(:hoy % 7 + 1),
         'start_time', '00:00', 'end_time', '23:59:59.999', 'dish_ids', jsonb_build_array(:plato))) as p2 \gset
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.falla('select public.gestion_promo_guardar(''{"name":"Hack","percent":90,"days":[1],"start_time":"00:00","end_time":"23:00","dish_ids":[1]}''::jsonb)', 'Sin permiso', 'una tablet no puede crear promociones');
select public.pos_open(:mesera, '2222', null, 'Promo') as o \gset
select public.pos_add(:mesera, '2222', :o, jsonb_build_array(jsonb_build_object('dish_id', :plato, 'qty', 2)));
reset role;
select unit_price, list_price, promo from public.pos_items where order_id = :o \gset
select prueba.ok(:unit_price = round(:precio * 0.8, 2) and :list_price = :precio and :'promo' = 'Happy hour -20 %', 'la caja aplica sola el 20 % de la promoción de hoy (y no la de otro día)');
select prueba.ok(position('Happy hour -20 %' in public.pos_bill_text(:o, 'PRECUENTA')) > 0, 'el ticket muestra la promoción debajo del plato');
-- Con decimales dice el porcentaje exacto (antes salía redondeado)
update public.promos set percent = 12.5 where id = :p1;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_add(:mesera, '2222', :o, jsonb_build_array(jsonb_build_object('dish_id', :plato, 'qty', 1)));
reset role;
select prueba.ok((select promo = 'Happy hour -12,5 %' and unit_price = round(:precio * 0.875, 2) from public.pos_items where order_id = :o order by id desc limit 1),
  'con decimales, la promoción dice el porcentaje exacto (12,5 %) y lo cobra');
update public.pos_items set qty = 1.5 where id = (select max(id) from public.pos_items where order_id = :o);
select prueba.ok(position('1.5 ' in public.pos_bill_text(:o, 'PRECUENTA')) > 0, 'el ticket muestra cantidades con decimales sin redondear');
update public.pos_items set qty = 1 where id = (select max(id) from public.pos_items where order_id = :o);
update public.promos set percent = 20 where id = :p1;
-- Fuera de su horario no aplica
update public.promos set start_time = '00:00', end_time = '00:00:01' where id = :p1;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_add(:mesera, '2222', :o, jsonb_build_array(jsonb_build_object('dish_id', :plato, 'qty', 1)));
reset role;
select prueba.ok((select unit_price from public.pos_items where order_id = :o order by id desc limit 1) = :precio, 'fuera del horario se cobra el precio normal');
update public.promos set end_time = '23:59:59.999' where id = :p1;
-- La carta pública ve solo las de hoy
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select public.menu_promos() as mp \gset
select prueba.ok(jsonb_array_length(:'mp'::jsonb) = 1 and (:'mp'::jsonb -> 0 ->> 'name') = 'Happy hour' and (:'mp'::jsonb -> 0 ->> 'ahora')::boolean, 'la carta ve la promoción de hoy, y que vale ahora');
select prueba.falla('select count(*) from public.promos', 'permission denied', 'el público no lee la tabla de promociones');
reset role;
select set_config('request.jwt.claims', '', false);
-- Limpieza: las promociones no deben cambiar precios de las demás pruebas
delete from public.promos;
\echo 'TODAS LAS PRUEBAS DE PROMOCIONES PASARON'
