-- Clientes en la caja: buscador único (teléfono, cédula o nombre), ficha con la tarjeta de puntos,
-- revisión de dobles al registrar y, en Gestión, posibles repetidos y unir. Todo se deshace al final.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;
insert into public.staff (email, role) values ('dueno@prueba.test', 'dueño') on conflict do nothing;
select (select id from public.employees where name = 'Cajera Prueba') caja, (select id from public.employees where name = 'Mesera Prueba') mesera,
       (select id from public.dishes where name = 'Teuchi') teuchi \gset
select not exists (select 1 from public.pos_sessions where status = 'abierta') as hay_que_abrir \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
\if :hay_que_abrir
select public.pos_cash_open(:caja, '1111', 0, 0);
\endif
-- José viene, se registra con su teléfono y paga con «Tarjeta entregada» (un sello)
select public.pos_open(:mesera, '2222', null, 'Buscador 1') as o1 \gset
select public.pos_add(:mesera, '2222', :o1, jsonb_build_array(jsonb_build_object('dish_id', :teuchi, 'variant', 'Gr', 'qty', 2)));
select public.pos_send(:mesera, '2222', :o1);
select public.pos_set_customer(:mesera, '2222', :o1, '', 'José Pérez', '0414-777.66.55', '', false) ->> 'id' as jose \gset
reset role;
select total as t1 from public.pos_totals(:o1) \gset
set role authenticated;
select public.pos_pay(:caja, '1111', :o1, jsonb_build_array(jsonb_build_object('method', 'efectivo_usd', 'amount', :t1, 'device', 'Caja')), 'REF', false, true);
-- Josefina, con cédula
select public.pos_open(:mesera, '2222', null, 'Buscador 2') as o2 \gset
select public.pos_set_customer(:mesera, '2222', :o2, 'V-30.111.222', 'Josefina Gómez', '0412 1110000', '', false) ->> 'id' as josefina \gset

-- 1) Buscador
select public.pos_customer_search(:mesera, '2222', '0414 777 6655') as b1 \gset
select public.pos_customer_search(:mesera, '2222', '7766') as b2 \gset
select public.pos_customer_search(:mesera, '2222', 'V-30.111.222') as b3 \gset
select public.pos_customer_search(:mesera, '2222', 'jose perez') as b4 \gset
select public.pos_customer_search(:mesera, '2222', 'PÉREZ josé') as b5 \gset
select public.pos_customer_search(:mesera, '2222', 'jo') as b6 \gset
reset role;
select prueba.ok((:'b1'::jsonb -> 0 ->> 'id')::bigint = :jose, 'con el teléfono completo, José sale primero');
select prueba.ok(:'b1'::jsonb -> 0 ->> 'tel' = '0414 ••• 6655' and position('7776655' in :'b1') = 0, 'el teléfono sale tapado (0414 ••• 6655): no se ve completo');
select prueba.ok(exists (select 1 from jsonb_array_elements(:'b2'::jsonb) e where (e ->> 'id')::bigint = :jose), 'con parte del teléfono también lo encuentra');
select prueba.ok((:'b3'::jsonb -> 0 ->> 'id')::bigint = :josefina and :'b3'::jsonb -> 0 ->> 'doc' = 'V-•••222', 'con la cédula, como sea que se escriba, sale Josefina con la cédula tapada');
select prueba.ok(exists (select 1 from jsonb_array_elements(:'b4'::jsonb) e where (e ->> 'id')::bigint = :jose), 'por nombre sin acentos encuentra a «José Pérez»');
select prueba.ok(exists (select 1 from jsonb_array_elements(:'b5'::jsonb) e where (e ->> 'id')::bigint = :jose), 'las palabras pueden ir en otro orden y con mayúsculas');
select prueba.ok(:'b6'::jsonb = '[]'::jsonb, 'con menos de 3 letras no busca');
-- 2) Ficha: visitas, gasto, lo que suele pedir y la tarjeta de puntos
select prueba.ok((:'b1'::jsonb -> 0 ->> 'visitas')::int = 1 and (:'b1'::jsonb -> 0 ->> 'gastado')::numeric = round(:t1::numeric, 2)
  and (:'b1'::jsonb -> 0 ->> 'sellos')::int = 1 and (:'b1'::jsonb -> 0 ->> 'canjes')::int = 0, 'la ficha trae 1 visita, lo que gastó y 1 sello de la tarjeta de puntos');
select prueba.ok(:'b1'::jsonb -> 0 -> 'suele' ->> 0 = 'Teuchi Gr', 'y lo que suele pedir (Teuchi Gr)');

-- 3) Registrar: si el teléfono ya es de alguien, pregunta antes de crear otro cliente
set role authenticated;
select public.pos_open(:mesera, '2222', null, 'Buscador 3') as o3 \gset
select public.pos_set_customer(:mesera, '2222', :o3, '', 'Jose', '0414 777 6655', '', false, null, 'revisar') as r3 \gset
reset role;
select prueba.ok((:'r3'::jsonb -> 'conflicto' ->> 'id')::bigint = :jose and :'r3'::jsonb ->> 'por' = 'telefono', 'con un teléfono conocido no guarda: devuelve la ficha de José para preguntar');
select prueba.ok((select customer_id from public.pos_orders where id = :o3) is null, 'y el pedido todavía no tiene cliente');
set role authenticated;
select public.pos_set_customer(:mesera, '2222', :o3, '', 'José Pérez', '0414 777 6655', '', false, :jose) ->> 'id' as r3b \gset
select public.pos_open(:mesera, '2222', null, 'Buscador 4') as o4 \gset
select public.pos_set_customer(:mesera, '2222', :o4, '', 'María Pérez', '0414 777 6655', '', false, null, 'nuevo') ->> 'id' as maria \gset
reset role;
select prueba.ok(:r3b::bigint = :jose and (select customer_id from public.pos_orders where id = :o3) = :jose, '«Es la misma persona»: el pedido queda con José');
select prueba.ok(:maria::bigint not in (:jose, :josefina), '«Es otra persona» (mismo teléfono): se registra aparte');
select prueba.falla(format('select public.pos_set_customer(%s, %L, %s, %L, %L, %L, %L, false, %s)', :mesera, '2222', :o3, 'V30111222', 'José Pérez', '', '', :jose),
  'otro cliente', 'a un cliente elegido no se le puede poner la cédula de otro');

-- 4) Gestión › Clientes: posibles repetidos y unir (solo el dueño)
select prueba.falla('select public.gestion_clientes_repetidos()', 'Sin permiso', 'la tablet no ve los repetidos');
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
set role authenticated;
select public.gestion_clientes_repetidos() as rep \gset
reset role;
select prueba.ok(exists (select 1 from jsonb_array_elements(:'rep'::jsonb) g where g ->> 'por' = 'telefono'
  and exists (select 1 from jsonb_array_elements(g -> 'clientes') c where (c ->> 'id')::bigint = :maria)), 'José y María salen como posibles repetidos por el teléfono');
set role authenticated;
select public.gestion_unir_clientes(:jose, :maria) as u \gset
reset role;
select prueba.ok((:'u'::jsonb ->> 'pedidos')::int = 1 and (select customer_id from public.pos_orders where id = :o4) = :jose
  and not exists (select 1 from public.customers where id = :maria), 'unir: el pedido de María pasa a José y María deja de estar');
update public.customers set doc_id = 'V12121212' where id = :jose;
set role authenticated;
select prueba.falla(format('select public.gestion_unir_clientes(%s, %s)', :josefina, :jose), 'distintas', 'no deja unir si los dos tienen cédulas distintas');
reset role;
select set_config('request.jwt.claims', '', false);
rollback;
\echo TODAS LAS PRUEBAS DEL BUSCADOR DE CLIENTES PASARON
