-- Ventas por WhatsApp: carta → código → pedido → caja → cocina, reservas, cola de salida y permisos.
\set ON_ERROR_STOP 1
\set QUIET 1
select (select id from public.employees where name = 'Cajera Prueba') caja, (select id from public.employees where name = 'Mesera Prueba') mesera \gset
select id as kobayashi from public.dishes where name = 'Pollo Kobayashi' \gset
select id as gyozas from public.dishes where name = 'Gyozas' \gset
update public.dishes set available = true where id in (:kobayashi, :gyozas);
update public.wa_settings set hours = '{"0":["00:00","23:59"],"1":["00:00","23:59"],"2":["00:00","23:59"],"3":["00:00","23:59"],"4":["00:00","23:59"],"5":["00:00","23:59"],"6":["00:00","23:59"]}'::jsonb;
insert into public.wa_zones (name, fee) values ('Centro', 2) returning id as centro \gset

-- ---------------------------------------------------------------- La carta (público)
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select prueba.falla('select count(*) from public.wa_carts', 'permission denied', 'el público no lee carritos');
select prueba.falla('select count(*) from public.wa_conversations', 'permission denied', 'el público no lee conversaciones');
select prueba.falla($$select public.wa_ingest('584141234567', 'x', 'w1', 'text', 'hola')$$, 'permission denied', 'el público no puede fingir mensajes de WhatsApp');
select prueba.falla($$select public.wa_outbox_next(10)$$, 'permission denied', 'el público no lee la cola de salida');
select prueba.falla(format($$select public.wa_cart_create('[{"dish_id": %s, "qty": 1}]')$$, :kobayashi), 'tamaño', 'sin tamaño no se puede pedir un plato con tamaños');
select prueba.falla(format($$select public.wa_cart_create('[{"dish_id": %s, "qty": 0}]')$$, :gyozas), 'cantidad', 'cantidad cero no vale');
select prueba.falla(format($$select public.wa_cart_create('[{"dish_id": %s, "qty": 1, "option": "Inventada"}]')$$, :gyozas), 'opción', 'opción inventada no vale');
select prueba.falla($$select public.wa_cart_create('[]')$$, 'vacío', 'carrito vacío no vale');
-- El cliente manda un precio falso: se ignora y se usa el de la carta.
select public.wa_cart_create(format($$[{"dish_id": %s, "variant": "Gr", "qty": 1, "unit_price": 0.01}, {"dish_id": %s, "qty": 2, "notes": "salsa teriyaki"}]$$,
       :kobayashi, :gyozas)::jsonb) as cart \gset
select :'cart'::jsonb ->> 'code' as code \gset
select prueba.ok(length(:'code') = 5, 'la carta recibe un código de 5 letras');
select prueba.ok((:'cart'::jsonb ->> 'subtotal')::numeric = 25, 'el subtotal usa los precios reales (15 + 2×5), no los del cliente');
reset role;

-- ---------------------------------------------------------------- Llega el mensaje (función «whatsapp»)
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select public.wa_ingest('0414-123.45.67', 'Naruto', 'wamid.1', 'text', 'Hola, quiero hacer el pedido ' || :'code', null,
       '{"source_id": "ad_123", "source_type": "ad"}') as r \gset
select (:'r'::jsonb ->> 'conversation_id')::bigint as conv \gset
select prueba.ok((select phone from public.wa_conversations where id = :conv) = '584141234567', 'el teléfono se guarda con código de país');
select prueba.ok((select referral ->> 'source_id' from public.wa_conversations where id = :conv) = 'ad_123', 'se guarda de qué anuncio vino');
select prueba.ok((public.wa_ingest('584141234567', 'Naruto', 'wamid.1', 'text', 'repetido') ->> 'duplicate')::boolean, 'si Meta reenvía el mismo mensaje no se duplica');
select prueba.ok((select count(*) from public.wa_messages where conversation_id = :conv) = 1, 'queda un solo mensaje');

select public.wa_order_from_cart(:conv, lower(:'code')) as o \gset
select prueba.ok((:'o'::jsonb ->> 'subtotal')::numeric = 25 and (:'o'::jsonb ->> 'status') = 'borrador', 'el código crea el pedido en borrador');
select prueba.ok((:'o'::jsonb ->> 'total_bs')::numeric = 2500, 'el total en Bs usa la tasa del día (25 × 100)');
select prueba.falla(format('select public.wa_order_submit(%s)', :conv), 'retirar o delivery', 'no se envía sin elegir retiro o delivery');
select public.wa_order_set(:conv, '{"kind": "delivery", "customer_name": "Naruto Uzumaki", "doc_id": "V-12.345.678"}');
select prueba.falla(format('select public.wa_order_submit(%s)', :conv), 'zona', 'delivery sin zona no se envía');
select public.wa_order_set(:conv, jsonb_build_object('zone_id', :centro, 'address', 'Calle 5, casa 12, Konoha'));
select prueba.falla(format($$select public.wa_order_set(%s, '{"payment_method": "efectivo"}')$$, :conv), 'pago antes', 'sin efectivo al recibir');
select public.wa_order_set(:conv, '{"payment_method": "pago_movil"}');
select prueba.falla(format('select public.wa_order_submit(%s)', :conv), 'referencia', 'sin referencia ni captura no se envía');
select public.wa_order_set(:conv, '{"payment_ref": "123456"}') as o \gset
select prueba.ok((:'o'::jsonb ->> 'total')::numeric = 27, 'el total suma el delivery de la zona (25 + 2)');
select public.wa_order_submit(:conv);
select prueba.ok((select status from public.wa_orders where conversation_id = :conv) = 'por_aceptar', 'el pedido queda por aceptar');

-- Pedido mínimo de delivery
select public.wa_ingest('584149999999', 'Sasuke', 'wamid.2', 'text', 'hola') ->> 'conversation_id' as conv2 \gset
select public.wa_cart_create(format('[{"dish_id": %s, "qty": 1}]', :gyozas)::jsonb) ->> 'code' as code2 \gset
select public.wa_order_from_cart(:conv2, :'code2');
select public.wa_order_set(:conv2, jsonb_build_object('kind', 'delivery', 'zone_id', :centro, 'address', 'Avenida 1', 'customer_name', 'Sasuke',
       'payment_method', 'zelle', 'payment_ref', 'ZX1'));
select prueba.falla(format('select public.wa_order_submit(%s)', :conv2), 'mínimo', 'delivery por debajo de Ref 10 no se acepta');
select public.wa_order_set(:conv2, '{"kind": "llevar"}');
select public.wa_order_submit(:conv2);
select prueba.ok((select delivery_fee from public.wa_orders where conversation_id = :conv2) = 0, 'para llevar no cobra delivery ni pide mínimo');
reset role;
select count(*) as jobs_before from public.pos_print_jobs \gset

-- ---------------------------------------------------------------- Caja
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"puente@prueba.test"}', false);
select prueba.falla(format('select public.wa_pending(%s, %L)', :caja, '1111'), 'no está autorizado', 'el puente no ve pedidos de WhatsApp');
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.falla('select count(*) from public.wa_orders', 'permission denied', 'la tablet no lee la tabla directo');
select prueba.falla(format('select public.wa_pending(%s, %L)', :caja, '9999'), 'PIN', 'sin el PIN correcto no se ve nada');
select public.wa_pending(:caja, '1111') as p \gset
select prueba.ok(jsonb_array_length(:'p'::jsonb -> 'orders') = 2, 'caja ve los 2 pedidos por aceptar');
select (select (x ->> 'id')::bigint from jsonb_array_elements(:'p'::jsonb -> 'orders') x where x ->> 'kind' = 'delivery') as wo,
       (select (x ->> 'id')::bigint from jsonb_array_elements(:'p'::jsonb -> 'orders') x where x ->> 'kind' = 'llevar') as wo2 \gset
select public.wa_accept(:caja, '1111', :wo) as pid \gset
select prueba.falla(format('select public.wa_accept(%s, %L, %s)', :caja, '1111', :wo), 'ya fue atendido', 'no se puede aceptar dos veces');
select prueba.falla(format('select public.wa_reject(%s, %L, %s, %L)', :caja, '1111', :wo2, 'no'), 'motivo', 'rechazar pide un motivo');
select public.wa_reject(:caja, '1111', :wo2, 'Nos quedamos sin gyozas por hoy');
reset role;

select prueba.ok((select kind = 'delivery' and origin = 'whatsapp' and delivery_fee = 2 and phone = '584141234567'
                  from public.pos_orders where id = :pid), 'aceptar abre un Delivery en caja con el teléfono y el envío');
select prueba.ok((select count(*) from public.pos_items where order_id = :pid and status = 'enviado') = 2, 'los platos quedan enviados a cocina');
select prueba.ok((select sum(qty * unit_price) from public.pos_items where order_id = :pid) = 25, 'con los precios reales');
select prueba.ok((select count(*) from public.pos_print_jobs) - :jobs_before >= 1, 'se imprime la comanda');
select prueba.ok((select c.wa_phone = '584141234567' and c.doc_id = 'V12345678' from public.customers c
                  join public.pos_orders o on o.customer_id = c.id where o.id = :pid), 'el cliente queda registrado con su WhatsApp');
select prueba.ok((select status from public.wa_orders where id = :wo2) = 'rechazado', 'el rechazado queda registrado');
select prueba.ok((select count(*) from public.wa_outbox where status = 'pendiente') = 2, 'hay 2 avisos por enviar (aceptado y rechazado)');
select prueba.ok((select body from public.wa_outbox where conversation_id = :conv2 order by id desc limit 1) like '%sin gyozas%', 'el motivo le llega al cliente');

-- ---------------------------------------------------------------- Cola de salida (función «whatsapp»)
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select public.wa_outbox_next(10) as q \gset
select prueba.ok(jsonb_array_length(:'q'::jsonb) = 2 and (:'q'::jsonb -> 0 ->> 'in_window')::boolean, 'la función toma los 2 avisos, dentro de las 24 h');
select public.wa_outbox_done(((:'q'::jsonb) -> 0 ->> 'id')::bigint, true, 'wamid.out1');
select public.wa_outbox_done(((:'q'::jsonb) -> 1 ->> 'id')::bigint, false, '', 'timeout');
select prueba.ok((select status from public.wa_messages where wa_id = 'wamid.out1') = 'enviado', 'lo enviado queda en la conversación');
select prueba.ok(jsonb_array_length(public.wa_outbox_next(10)) = 1, 'lo que falló se reintenta');
select public.wa_status('wamid.out1', 'read');
select public.wa_status('wamid.out1', 'delivered');
select prueba.ok((select status from public.wa_messages where wa_id = 'wamid.out1') = 'leido', 'un «entregado» tardío no borra el «leído»');

-- ---------------------------------------------------------------- Reservas
select prueba.falla(format($$select public.wa_reservation_create(%s, 'Hinata', 4, now() - interval '1 hour')$$, :conv), 'ya pasó', 'no se reserva en el pasado');
select public.wa_reservation_create(:conv, 'Hinata', 4, now() + interval '2 days', 'Edo', 'Cumpleaños') as rid \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.ok(jsonb_array_length(public.wa_pending(:caja, '1111') -> 'reservations') = 1, 'caja ve la reserva pendiente');
select public.wa_reservation_set(:caja, '1111', :rid, 'confirmada');
select prueba.falla(format('select public.wa_reservation_set(%s, %L, %s, %L)', :caja, '1111', :rid, 'rechazada'), 'ya fue atendida', 'una reserva atendida no cambia');

-- ---------------------------------------------------------------- Bandeja
select prueba.ok((public.wa_inbox(:caja, '1111') -> 0 ->> 'unread')::int >= 1, 'la bandeja muestra mensajes sin leer');
select prueba.ok(jsonb_array_length(public.wa_thread(:caja, '1111', :conv)) >= 1, 'se puede abrir la conversación');
select public.wa_reply(:caja, '1111', :conv, 'Hola Naruto, tu pedido sale en 20 min');
reset role;
select prueba.ok((select bot_paused from public.wa_conversations where id = :conv), 'al responder a mano el bot se pausa en esa conversación');
select prueba.ok((select unread from public.wa_conversations where id = :conv) = 0, 'y queda leída');
update public.wa_conversations set last_in_at = now() - interval '25 hours' where id = :conv;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.falla(format('select public.wa_reply(%s, %L, %s, %L)', :caja, '1111', :conv, 'hola'), '24 horas', 'fuera de las 24 h no se puede escribir texto libre');
select public.wa_notify_ready(:caja, '1111', :pid);
reset role;
select prueba.ok((select body from public.wa_outbox where conversation_id = :conv order by id desc limit 1) like '%en camino%', 'aviso de delivery en camino');
select prueba.ok((select count(distinct event) from public.wa_events where event in ('conversacion', 'carrito', 'pedido_enviado', 'aceptado', 'rechazado', 'reserva')) = 6,
                 'el embudo queda medido');
\echo 'TODAS LAS PRUEBAS DE WHATSAPP PASARON'
