-- Extras de los platos: cada extra es su propia línea colgada de su plato (pos_items.extra_de).
-- Sale debajo del plato en la comanda, se va con él si se anula y la cocina lo marca listo con el plato.
-- Todo en una transacción que se deshace al final.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;
update public.categories set con_extras = true where name in ('Ramen', 'Especiales');
insert into public.categories (name, position, es_extra) values ('Extras prueba', 50, true) returning id as cext \gset
insert into public.dishes (category_id, name, price, tags, position) values (:cext, 'Extra huevo prueba', 1, '{solo-caja}', 1) returning id as huevo \gset
insert into public.dishes (category_id, name, price, tags, position) values (:cext, 'Extra pollo prueba', 4, '{solo-caja}', 2) returning id as pollo \gset
select (select id from public.employees where name = 'Mesera Prueba') mesera,
       (select id from public.dishes where name = 'Teuchi') teuchi, (select id from public.dishes where name = 'Kakashi') kakashi,
       (select id from public.dishes where name = 'Tonkotsu') tonkotsu, (select id from public.dishes where name = 'Limonada rosa') limonada \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);

-- 1) Un ramen con dos extras en el mismo envío: quedan colgados del ramen, con su precio
select public.pos_open(:mesera, '2222', null, 'Extras 1') as o1 \gset
select public.pos_add(:mesera, '2222', :o1, jsonb_build_array(
  jsonb_build_object('dish_id', :teuchi, 'variant', 'Gr', 'qty', 2),
  jsonb_build_object('dish_id', :huevo, 'qty', 2, 'extra_de', 0),
  jsonb_build_object('dish_id', :pollo, 'qty', 1, 'extra_de', 0))) as n1 \gset
reset role;
select (select id from public.pos_items where order_id = :o1 and dish_id = :teuchi) teu,
       (select id from public.pos_items where order_id = :o1 and dish_id = :huevo) hue,
       (select id from public.pos_items where order_id = :o1 and dish_id = :pollo) pol \gset
select prueba.ok(:n1 = 3 and (select extra_de from public.pos_items where id = :hue) = :teu and (select extra_de from public.pos_items where id = :pol) = :teu
  and (select extra_de from public.pos_items where id = :teu) is null, 'los dos extras quedan colgados del ramen');
select prueba.ok((select unit_price from public.pos_items where id = :hue) = 1 and (select unit_price from public.pos_items where id = :pol) = 4
  and (select subtotal from public.pos_totals(:o1)) = 36, 'cada extra cobra su precio: 2 × 15 + 2 × 1 + 4 = 36');

-- 2) Lo que no cuadra se rechaza
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.falla(format('select public.pos_add(%s, %L, %s, %L)', :mesera, '2222', :o1, jsonb_build_array(jsonb_build_object('dish_id', :huevo, 'qty', 1, 'extra_de', 0))),
  'no tiene plato', 'un extra no puede apuntar a un plato que no viene antes en la lista');
select prueba.falla(format('select public.pos_add(%s, %L, %s, %L)', :mesera, '2222', :o1, jsonb_build_array(jsonb_build_object('dish_id', :kakashi, 'variant', 'Peq', 'qty', 1),
  jsonb_build_object('dish_id', :limonada, 'qty', 1, 'extra_de', 0))), 'no es un extra', 'solo los platos de la categoría de extras se cuelgan de otro plato');
select prueba.falla(format('select public.pos_add(%s, %L, %s, %L)', :mesera, '2222', :o1, jsonb_build_array(jsonb_build_object('dish_id', :pollo, 'qty', 1, 'extra_de_item', :hue))),
  'no con otro extra', 'un extra no se cuelga de otro extra');

-- 3) La comanda: los extras debajo del ramen («+ Extra huevo»; con número solo si no es uno por plato)
select public.pos_send(:mesera, '2222', :o1) as s1 \gset
reset role;
select body as com1 from public.pos_print_jobs where printer = 'cocina' order by id desc limit 1 \gset
select prueba.ok(:'com1' like E'%^2 Teuchi Gr\n  + Extra huevo prueba\n  + 1 Extra pollo prueba%', 'la comanda pone los extras debajo de su ramen');

-- 4) Un extra que piden después: sale solo y dice para cuál plato es
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_add(:mesera, '2222', :o1, jsonb_build_array(jsonb_build_object('dish_id', :huevo, 'qty', 1, 'extra_de_item', :teu)));
select public.pos_send(:mesera, '2222', :o1);
reset role;
select body as com2 from public.pos_print_jobs where printer = 'cocina' order by id desc limit 1 \gset
select prueba.ok(:'com2' like E'%^1 Extra huevo prueba\n  >> para 2 Teuchi Gr%' and :'com2' like '%AGREGADO%', 'el extra de después sale como agregado y dice «para 2 Teuchi Gr»');
select prueba.ok((select count(*) from public.pos_items where order_id = :o1 and extra_de = :teu) = 3, 'ya son tres extras colgados del ramen');

-- 5) La cuenta en la tablet y la pantalla de cocina saben de quién es cada extra
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_order(:o1) as ord \gset
select public.pos_kitchen(null) as k1 \gset
reset role;
select prueba.ok((select count(*) from jsonb_array_elements(:'ord'::jsonb -> 'items') i where (i ->> 'extra_de')::bigint = :teu) = 3, 'la cuenta trae extra_de en cada extra');
select (select c from jsonb_array_elements(:'k1'::jsonb -> 'orders') c where (c ->> 'id')::bigint = :o1) as card \gset
select prueba.ok(jsonb_array_length(:'card'::jsonb -> 'items') = 4
  and (select count(*) from jsonb_array_elements(:'card'::jsonb -> 'items') i where (i ->> 'extra_de')::bigint = :teu and i ->> 'para' = '2 Teuchi Gr') = 3,
  'la pantalla de cocina recibe los extras con su plato («para 2 Teuchi Gr»)');

-- 6) La cocina marca el ramen listo y sus extras se van con él
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_kitchen_ready(array[:teu]::bigint[]) as nl \gset
reset role;
select prueba.ok(:nl = 4 and (select count(*) from public.pos_items where order_id = :o1 and ready_at is null) = 0, 'al marcar el ramen listo, sus extras quedan listos también');

-- 7) Anular un plato enviado se lleva sus extras: los enviados se anulan con el mismo motivo y los sin enviar se quitan
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_open(:mesera, '2222', null, 'Extras 2') as o2 \gset
select public.pos_add(:mesera, '2222', :o2, jsonb_build_array(jsonb_build_object('dish_id', :kakashi, 'variant', 'Peq', 'qty', 1),
  jsonb_build_object('dish_id', :pollo, 'qty', 1, 'extra_de', 0)));
select public.pos_send(:mesera, '2222', :o2);
reset role;
select (select id from public.pos_items where order_id = :o2 and dish_id = :kakashi) kak, (select id from public.pos_items where order_id = :o2 and dish_id = :pollo) pol2 \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_add(:mesera, '2222', :o2, jsonb_build_array(jsonb_build_object('dish_id', :huevo, 'qty', 1, 'extra_de_item', :kak)));
select public.pos_void(:mesera, '2222', :kak, 'Se equivocó de ramen') as v2 \gset
reset role;
select body as anu from public.pos_print_jobs where printer = 'cocina' order by id desc limit 1 \gset
select prueba.ok(:'v2' = 'anulado' and (select status from public.pos_items where id = :pol2) = 'anulado'
  and (select void_reason from public.pos_items where id = :pol2) = 'Se equivocó de ramen'
  and not exists (select 1 from public.pos_items where order_id = :o2 and dish_id = :huevo), 'al anular el ramen se anula su extra enviado y se quita el que no había salido');
select prueba.ok(:'anu' like E'%^ANULAR%^1 Kakashi Peq\n  + 1 Extra pollo prueba\nMotivo: Se equivocó de ramen%', 'el aviso de anular a cocina incluye el extra');
select prueba.ok((select count(*) from public.pos_log where order_id = :o2 and action = 'anular_plato') = 2 and (select subtotal from public.pos_totals(:o2)) = 0,
  'el cierre ve las dos anulaciones y la cuenta queda en 0');

-- 8) Quitar un plato que no se ha enviado quita también sus extras
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_open(:mesera, '2222', null, 'Extras 3') as o3 \gset
select public.pos_add(:mesera, '2222', :o3, jsonb_build_array(jsonb_build_object('dish_id', :tonkotsu, 'variant', 'Peq', 'qty', 1),
  jsonb_build_object('dish_id', :huevo, 'qty', 1, 'extra_de', 0)));
reset role;
select id as ton from public.pos_items where order_id = :o3 and dish_id = :tonkotsu \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_void(:mesera, '2222', :ton, '') as v3 \gset
select public.pos_top_dishes(30) as top \gset
reset role;
select prueba.ok(:'v3' = 'quitado' and not exists (select 1 from public.pos_items where order_id = :o3), 'quitar el ramen sin enviar quita también su extra');
select prueba.ok(not (:'top'::jsonb @> to_jsonb(:huevo::bigint)) and not (:'top'::jsonb @> to_jsonb(:pollo::bigint)), 'los extras no salen en «Lo más pedido»');
rollback;
