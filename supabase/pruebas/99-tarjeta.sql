-- Tarjeta de puntos: «Tarjeta entregada» al cobrar (un sello por compra) y canje del premio en Ref 0
-- (2 bebidas, 2 ramen pequeños o 6 taiyakis). Todo en una transacción que se deshace al final.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;
select (select id from public.employees where name = 'Cajera Prueba') caja, (select id from public.employees where name = 'Mesera Prueba') mesera,
       (select id from public.dishes where name = 'Teuchi') teuchi, (select id from public.dishes where name = 'Limonada rosa') limonada,
       (select id from public.dishes where name = 'Taiyaki') taiyaki, (select id from public.dishes d where d.category_id not in (select id from public.categories where name in ('Ramen', 'Bebidas')) and d.name <> 'Taiyaki' and jsonb_array_length(d.variants) = 0 order by d.id limit 1) otro \gset
select not exists (select 1 from public.pos_sessions where status = 'abierta') as hay_que_abrir \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
\if :hay_que_abrir
select public.pos_cash_open(:caja, '1111', 0, 0);
\endif
-- 1) Con la casilla marcada queda un sello en la compra; sin ella (tablet vieja) no se toca; desmarcada queda en falso
select public.pos_open(:mesera, '2222', null, 'Tarjeta 1') as o1 \gset
select public.pos_add(:mesera, '2222', :o1, jsonb_build_array(jsonb_build_object('dish_id', :teuchi, 'variant', 'Gr', 'qty', 2)));
select public.pos_send(:mesera, '2222', :o1);
reset role;
select total as t1 from public.pos_totals(:o1) \gset
set role authenticated;
select public.pos_pay(:caja, '1111', :o1, jsonb_build_array(jsonb_build_object('method', 'efectivo_usd', 'amount', :t1, 'device', 'Caja')), 'REF', false, true) ->> 'closed' as c1 \gset
select public.pos_open(:mesera, '2222', null, 'Tarjeta 2') as o2 \gset
select public.pos_add(:mesera, '2222', :o2, jsonb_build_array(jsonb_build_object('dish_id', :teuchi, 'variant', 'Peq', 'qty', 1)));
select public.pos_send(:mesera, '2222', :o2);
reset role;
select total as t2 from public.pos_totals(:o2) \gset
set role authenticated;
select public.pos_pay(:caja, '1111', :o2, jsonb_build_array(jsonb_build_object('method', 'efectivo_usd', 'amount', :t2, 'device', 'Caja'))) ->> 'closed' as c2 \gset
reset role;
select prueba.ok(:'c1' = 'true' and (select sello from public.pos_orders where id = :o1), 'al cobrar con «Tarjeta entregada» marcada queda un sello en la compra');
select prueba.ok(:'c2' = 'true' and not (select sello from public.pos_orders where id = :o2), 'una tablet que todavía no manda la casilla cobra igual y no anota sello');
-- 2) Canje: lo que no entra, lo que mezcla tipos o no completa el premio se rechaza
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_open(:mesera, '2222', null, 'Canje') as o3 \gset
select public.pos_add(:mesera, '2222', :o3, jsonb_build_array(jsonb_build_object('dish_id', :limonada, 'qty', 3), jsonb_build_object('dish_id', :otro, 'qty', 1),
  jsonb_build_object('dish_id', :taiyaki, 'qty', 2), jsonb_build_object('dish_id', :teuchi, 'variant', 'Gr', 'qty', 2)));
select public.pos_send(:mesera, '2222', :o3);
reset role;
select (select id from public.pos_items where order_id = :o3 and dish_id = :limonada) lim, (select id from public.pos_items where order_id = :o3 and dish_id = :otro) pol,
       (select id from public.pos_items where order_id = :o3 and dish_id = :taiyaki) tai, (select id from public.pos_items where order_id = :o3 and dish_id = :teuchi) teu \gset
select subtotal as sub0 from public.pos_totals(:o3) \gset
set role authenticated;
select prueba.falla(format('select public.pos_canje(%s, %L, %s, %L)', :caja, '1111', :o3, jsonb_build_array(jsonb_build_object('id', :pol, 'qty', 1), jsonb_build_object('id', :lim, 'qty', 1))),
  'no entra en el canje', 'un plato que no es bebida, ramen pequeño ni taiyaki no entra en el canje');
select prueba.falla(format('select public.pos_canje(%s, %L, %s, %L)', :caja, '1111', :o3, jsonb_build_array(jsonb_build_object('id', :teu, 'qty', 2))),
  'no entra en el canje', 'un ramen grande no es premio (solo los pequeños)');
select prueba.falla(format('select public.pos_canje(%s, %L, %s, %L)', :caja, '1111', :o3, jsonb_build_array(jsonb_build_object('id', :lim, 'qty', 1), jsonb_build_object('id', :tai, 'qty', 1))),
  'un solo tipo', 'el premio es de un solo tipo: no se mezclan bebidas con taiyakis');
select prueba.falla(format('select public.pos_canje(%s, %L, %s, %L)', :caja, '1111', :o3, jsonb_build_array(jsonb_build_object('id', :lim, 'qty', 1))),
  'El premio es de 2 bebidas', 'una sola bebida no completa el premio');
select prueba.falla(format('select public.pos_canje(%s, %L, %s, %L)', :caja, '1111', :o3, jsonb_build_array(jsonb_build_object('id', :tai, 'qty', 2))),
  'El premio es de 6 taiyakis', 'dos taiyakis no completan el premio de seis');
select prueba.falla(format('select public.pos_canje(%s, %L, %s, %L)', :mesera, '2222', :o3, jsonb_build_array(jsonb_build_object('id', :lim, 'qty', 2))),
  'permiso', 'el canje lo hace quien puede cobrar');
-- 3) Dos limonadas de las tres: la línea se separa y el premio queda en Ref 0, con lo que costaba guardado
select public.pos_canje(:caja, '1111', :o3, jsonb_build_array(jsonb_build_object('id', :lim, 'qty', 2))) as cj \gset
reset role;
select subtotal as sub1 from public.pos_totals(:o3) \gset
set role authenticated;
select public.pos_order(:o3) as od \gset
reset role;
select prueba.ok(:'cj'::jsonb ->> 'premio' = 'bebida' and (:'cj'::jsonb ->> 'valor')::numeric = 4, 'el canje devuelve qué premio fue y cuánto valía (2 limonadas de Ref 2)');
select prueba.ok((select qty from public.pos_items where id = :lim) = 1 and
  (select count(*) from public.pos_items where order_id = :o3 and dish_id = :limonada and canje is not null and qty = 2 and unit_price = 0 and promo = 'Canje tarjeta de puntos') = 1,
  'la línea de 3 limonadas queda en 1 y el premio pasa a su propia línea de 2 en Ref 0');
select prueba.ok(:sub1 = :sub0 - 4, 'el subtotal baja exactamente lo que valía el premio');
select prueba.ok((select count(*) from jsonb_array_elements(:'od'::jsonb -> 'items') e where (e ->> 'canje')::boolean) = 1, 'la tablet ve qué línea es canje');
select id as premio from public.pos_items where order_id = :o3 and canje is not null \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.falla(format('select public.pos_canje(%s, %L, %s, %L)', :caja, '1111', :o3, jsonb_build_array(jsonb_build_object('id', :premio, 'qty', 2))),
  'ya es un canje', 'un premio no se canjea dos veces');
-- 4) Quitar el canje: el premio vuelve a su línea y a su precio
select public.pos_canje_quitar(:caja, '1111', :o3) as q \gset
reset role;
select subtotal as sub2 from public.pos_totals(:o3) \gset
set role authenticated;
reset role;
select prueba.ok(:q = 1 and (select qty from public.pos_items where id = :lim) = 3 and not exists (select 1 from public.pos_items where order_id = :o3 and canje is not null)
  and :sub2 = :sub0, 'al quitar el canje, las limonadas vuelven a ser 3 a su precio y el subtotal queda como antes');
-- 5) Seis taiyakis en una línea: se canjea la línea entera; al cobrar con sello, el cierre de caja los cuenta
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_open(:mesera, '2222', null, 'Taiyakis') as o4 \gset
-- (2 Teuchi: lo que se paga pasa de Ref 20, así que esta compra también lleva sello)
select public.pos_add(:mesera, '2222', :o4, jsonb_build_array(jsonb_build_object('dish_id', :taiyaki, 'qty', 6), jsonb_build_object('dish_id', :teuchi, 'variant', 'Gr', 'qty', 2)));
select public.pos_send(:mesera, '2222', :o4);
reset role;
select id as tai6 from public.pos_items where order_id = :o4 and dish_id = :taiyaki \gset
set role authenticated;
select public.pos_canje(:caja, '1111', :o4, jsonb_build_array(jsonb_build_object('id', :tai6, 'qty', 6))) ->> 'valor' as v6 \gset
reset role;
select total as t4 from public.pos_totals(:o4) \gset
set role authenticated;
select public.pos_pay(:caja, '1111', :o4, jsonb_build_array(jsonb_build_object('method', 'efectivo_usd', 'amount', :t4, 'device', 'Caja')), 'REF', false, true) ->> 'closed' as c4 \gset
select prueba.falla(format('select public.pos_canje_quitar(%s, %L, %s)', :caja, '1111', :o4), 'cerrado', 'una cuenta cobrada ya no cambia su canje');
select public.pos_cash_summary() as sm \gset
reset role;
select prueba.ok(:v6::numeric = 15 and (select unit_price from public.pos_items where id = :tai6) = 0 and (select canje ->> 'precio' from public.pos_items where id = :tai6)::numeric = 2.5,
  'con la línea completa no se separa nada: los 6 taiyakis quedan en Ref 0 y se guarda su precio (Ref 2,50)');
select prueba.ok(:'c4' = 'true' and (:'sm'::jsonb ->> 'sellos')::int >= 2 and (:'sm'::jsonb -> 'canjes' ->> 'cuentas')::int >= 1
  and (:'sm'::jsonb -> 'canjes' ->> 'valor')::numeric >= 15, 'el resumen de caja cuenta los sellos entregados y los canjes con lo que valían');
select prueba.ok(exists (select 1 from public.pos_log where action = 'canje_tarjeta' and order_id = :o4 and detail ->> 'premio' = 'taiyaki'), 'el canje queda en el registro de la caja');
-- 6) Cobro hecho sin internet con la casilla marcada: el puente lo sube con el sello
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_open(:mesera, '2222', null, 'Sin internet') as o5 \gset
select public.pos_add(:mesera, '2222', :o5, jsonb_build_array(jsonb_build_object('dish_id', :teuchi, 'variant', 'Gr', 'qty', 2)));
select public.pos_send(:mesera, '2222', :o5);
reset role;
select total as t5 from public.pos_totals(:o5) \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"puente@prueba.test"}', false);
select public.pos_offline_pay(jsonb_build_object('uuid', 'prueba-sello-001', 'emp', :caja, 'pin', '1111', 'order', jsonb_build_object('id', :o5), 'sello', true,
  'lines', jsonb_build_array(jsonb_build_object('method', 'efectivo_usd', 'amount', :t5)))) ->> 'nota' as n5 \gset
reset role;
select prueba.ok(:'n5' = '' and (select sello and status = 'cobrada' from public.pos_orders where id = :o5), 'un cobro sin internet con la casilla marcada sube con su sello');
select set_config('request.jwt.claims', '', false);
rollback;
\echo 'TODAS LAS PRUEBAS DE LA TARJETA DE PUNTOS PASARON'
