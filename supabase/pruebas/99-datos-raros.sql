-- Datos raros (revisión de fallas del 24/11): lo que la base aceptaba sin deber (NaN, montos absurdos,
-- métodos de pago vacíos) o que daba errores técnicos, y la cuenta en Ref 0 que no se podía cerrar.
-- Todo en una transacción que se deshace al final.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;
select (select id from public.employees where name = 'Cajera Prueba') caja, (select id from public.employees where name = 'Mesera Prueba') mesera,
       (select id from public.dishes where name = 'Teuchi') teuchi, (select id from public.dishes where name = 'Limonada rosa') limonada,
       (select id from public.ingredients where not is_prep order by id limit 1) insumo \gset
update public.employees set tab_limit = 50 where id = :mesera;
select not exists (select 1 from public.pos_sessions where status = 'abierta') as hay_que_abrir \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
\if :hay_que_abrir
select public.pos_cash_open(:caja, '1111', 0, 0);
\endif

-- 1) Pedir y descontar
select public.pos_open(:mesera, '2222', null, 'Raros 1') as o1 \gset
select prueba.falla(format('select public.pos_add(%s, %L, %s, %L)', :mesera, '2222', :o1, '[{"dish_id": ' || :teuchi || ', "variant": "Gr", "qty": 0.001}]'),
  'Cantidad no válida', 'una cantidad que al redondear queda en 0 (0,001) se rechaza con un mensaje claro');
select public.pos_add(:mesera, '2222', :o1, jsonb_build_array(jsonb_build_object('dish_id', :teuchi, 'variant', 'Gr', 'qty', 1)));
select public.pos_send(:mesera, '2222', :o1);
select public.pos_discount(:caja, '1111', :o1, 2, 'Cliente frecuente');
select public.pos_discount(:caja, '1111', :o1, null, '');
reset role;
select prueba.ok((select discount from public.pos_orders where id = :o1) = 0, 'un descuento vacío quita el descuento (antes: error técnico)');
set role authenticated;
select prueba.falla(format('select public.pos_discount(%s, %L, %s, %L, %L)', :caja, '1111', :o1, 'NaN', 'Raro'), 'Monto no válido', 'un descuento NaN no entra');
select prueba.falla(format('select public.pos_discount(%s, %L, %s, %s, %L)', :caja, '1111', :o1, '1e15', 'Raro'), 'Monto no válido', 'un descuento absurdo no entra');

-- 2) Cobrar: método vacío o desconocido y montos NaN
select prueba.falla(format('select public.pos_pay(%s, %L, %s, %L)', :caja, '1111', :o1, '[{"method": "xxx", "amount": 50, "device": "Caja"}]'),
  'Método de pago no válido: xxx', 'un método de pago desconocido no se acepta');
select prueba.falla(format('select public.pos_pay(%s, %L, %s, %L)', :caja, '1111', :o1, '[{"amount": 50, "device": "Caja"}]'),
  'Método de pago no válido: vacío', 'un pago sin método no se acepta');
select prueba.falla(format('select public.pos_pay(%s, %L, %s, %L)', :caja, '1111', :o1, '[{"method": "efectivo_usd", "amount": "NaN", "device": "Caja"}]'),
  'Monto no válido', 'un pago NaN no cierra la cuenta (antes la daba por pagada)');
select prueba.falla(format('select public.pos_pay(%s, %L, %s, %L)', :caja, '1111', :o1, '[]'), 'Escribe el monto', 'una cuenta con saldo sigue pidiendo el monto');

-- 3) Cuenta en Ref 0: canje de la tarjeta de puntos solo, o cortesía con todo descontado
select public.pos_open(:mesera, '2222', null, 'Solo canje') as o2 \gset
select public.pos_add(:mesera, '2222', :o2, jsonb_build_array(jsonb_build_object('dish_id', :limonada, 'qty', 2)));
select public.pos_send(:mesera, '2222', :o2);
reset role;
select id as lim from public.pos_items where order_id = :o2 \gset
set role authenticated;
select public.pos_canje(:caja, '1111', :o2, jsonb_build_array(jsonb_build_object('id', :lim, 'qty', 2)));
select public.pos_pay(:caja, '1111', :o2, '[]'::jsonb, 'REF', false, false) as r2 \gset
reset role;
select prueba.ok((:'r2'::jsonb ->> 'closed')::boolean and (select status from public.pos_orders where id = :o2) = 'cobrada'
  and not exists (select 1 from public.pos_payments where order_id = :o2), 'quien viene solo a canjear su premio (Ref 0) se cierra sin pago');
select prueba.ok((select body from public.pos_print_jobs where body like '%RECIBO%' order by id desc limit 1) ~ 'Sin pago +Ref 0,00', 'y su recibo dice «Sin pago Ref 0,00»');
set role authenticated;
select public.pos_open(:mesera, '2222', null, 'Cortesía') as o3 \gset
select public.pos_add(:mesera, '2222', :o3, jsonb_build_array(jsonb_build_object('dish_id', :teuchi, 'variant', 'Gr', 'qty', 1)));
select public.pos_send(:mesera, '2222', :o3);
select public.pos_discount(:caja, '1111', :o3, 1000, 'Cortesía del dueño');
select public.pos_pay(:caja, '1111', :o3, '[]'::jsonb, 'REF', false, false) ->> 'closed' as c3 \gset
reset role;
select prueba.ok(:'c3' = 'true' and (select discount_reason from public.pos_orders where id = :o3) = 'Cortesía del dueño',
  'una cortesía con todo descontado se cierra y queda con su motivo (antes había que anularla)');
set role authenticated;
select public.pos_open(:mesera, '2222', null, 'Vacía') as o4 \gset
select public.pos_add(:mesera, '2222', :o4, jsonb_build_array(jsonb_build_object('dish_id', :limonada, 'qty', 1)));
select public.pos_send(:mesera, '2222', :o4);
reset role;
select id as it4 from public.pos_items where order_id = :o4 \gset
set role authenticated;
select public.pos_void(:caja, '1111', :it4, 'Se equivocó');
select prueba.falla(format('select public.pos_pay(%s, %L, %s, %L)', :caja, '1111', :o4, '[]'), 'está vacía', 'una cuenta sin platos no se cobra: se anula');

-- 4) Caja: salidas, abonos, delivery, precuenta, tasa, mercancía y conteo
select prueba.falla(format('select public.pos_cash_out(%s, %L, null, 5, %L)', :caja, '1111', 'Hielo'), 'solo de efectivo', 'una salida sin método da un mensaje claro (antes: error técnico)');
select prueba.falla(format('select public.pos_cash_out(%s, %L, %L, %L, %L)', :caja, '1111', 'efectivo_usd', 'NaN', 'Hielo'), 'Monto no válido', 'una salida NaN no entra');
select prueba.falla(format('select public.pos_cash_out(%s, %L, %L, 0.001, %L)', :caja, '1111', 'efectivo_usd', 'Hielo'), 'Escribe el monto', 'una salida que redondea a 0 no entra');
select prueba.falla(format('select public.pos_tab_pay(%s, %L, %s, %L)', :caja, '1111', :mesera, '[{"method": "", "amount": 5}]'),
  'Método de pago no válido', 'un abono sin método da un mensaje claro');
select prueba.falla(format('select public.pos_tab_pay(%s, %L, %s, %L)', :caja, '1111', :mesera, '[{"method": "efectivo_usd", "amount": "NaN"}]'),
  'Monto no válido', 'un abono NaN no entra');
select prueba.falla(format('select public.pos_open_delivery(%s, %L, %L, %L, %L, %L)', :mesera, '2222', 'Cliente', '', '', 'NaN'),
  'Tarifa de delivery no válida', 'una tarifa de delivery NaN no entra');
select public.pos_open_delivery(:mesera, '2222', 'Cliente', '', '', 2) as o5 \gset
select prueba.falla(format('select public.pos_set_delivery(%s, %L, %s, %L, %L, %L, %s)', :mesera, '2222', :o5, 'Cliente', '', '', '1e9'),
  'Tarifa de delivery no válida', 'ni una tarifa absurda al cambiarla');
select prueba.falla(format('select public.pos_precuenta(%s, %L, 999999999)', :mesera, '2222'), 'Pedido no encontrado', 'la precuenta de un pedido que no existe da un mensaje claro');
select prueba.falla(format('select public.pos_set_rate(%L, %L, %s, %L)', 'NaN', 'prueba', :caja, '1111'), 'Tasa no válida', 'una tasa NaN no entra');
select prueba.falla(format('select public.pos_purchase(%s, %L, %L)', :caja, '1111', '[{"id": ' || :insumo || ', "qty": "NaN"}]'), 'Cantidad no válida', 'mercancía NaN no entra');
select prueba.falla(format('select public.pos_count(%s, %L, %L)', :caja, '1111', '[{"id": ' || :insumo || ', "qty": "NaN"}]'), 'Cantidad no válida', 'un conteo NaN no entra');
select prueba.falla(format('select public.pos_cash_close(%s, %L, %L)', :caja, '1111', '{"efectivo_usd": "abc"}'), 'no es válido', 'un monto contado que no es número da un mensaje claro');
select prueba.falla(format('select public.pos_cash_close(%s, %L, %L)', :caja, '1111', '[1, 2]'), 'El conteo no es válido', 'un conteo que no es una lista de montos tampoco');
reset role;
update public.pos_sessions set status = 'cerrada' where status = 'abierta';
set role authenticated;
select prueba.falla(format('select public.pos_cash_open(%s, %L, -5, 0)', :caja, '1111'), 'Fondo de caja no válido', 'no se abre caja con fondo negativo');
select prueba.falla(format('select public.pos_cash_open(%s, %L, 0, %L)', :caja, '1111', 'NaN'), 'Fondo de caja no válido', 'ni con fondo NaN');
reset role;

-- 5) Inventario (Gestión, caja y Nex) y la base misma: NaN nunca se guarda
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select prueba.falla(format('select public.register_movement(%L, %L, %L)', :insumo::text, 'merma', 'NaN'), 'Cantidad no válida', 'el inventario no acepta una merma NaN');
select prueba.falla($q$insert into public.pos_rates (rate_date, eur, source) values ('2000-01-01', 'NaN', 'x')$q$, 'pos_rates_numeros', 'la base no guarda una tasa NaN');
select prueba.falla($q$update public.pos_orders set delivery_fee = 'NaN' where id = (select max(id) from public.pos_orders)$q$, 'pos_orders_numeros', 'ni una tarifa NaN');
select prueba.falla($q$update public.ingredients set stock_qty = 'NaN' where id = (select min(id) from public.ingredients)$q$, 'ingredients_numeros', 'ni un inventario NaN');
select set_config('request.jwt.claims', '', false);
rollback;
\echo TODAS LAS PRUEBAS DE DATOS RAROS PASARON
