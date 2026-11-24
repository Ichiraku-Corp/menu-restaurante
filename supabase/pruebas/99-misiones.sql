-- Misiones de Shibu (pedido de Edgar, 24/11): misiones del día, puntos y fichas automáticos al cobrar, tienda con aprobación
-- de la caja y juegos con el resultado decidido por la base. Todo en una transacción que se deshace al final.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;
select setseed(0.42);
-- Una maid y una cajera nuevas, solo para esta prueba (así no cuenta lo que vendieron otras pruebas hoy)
insert into public.employees (name, job_title, pos_can_charge, pos_pin_hash) values
  ('Maid Misiones', 'Maid nivel 1', false, extensions.crypt('5555', extensions.gen_salt('bf'))),
  ('Cajera Misiones', 'Caja', true, extensions.crypt('6666', extensions.gen_salt('bf')));
select (select id from public.employees where name = 'Cajera Misiones') caja, (select id from public.employees where name = 'Maid Misiones') mesera,
       (select id from public.dishes where name = 'Dorayaki') postre, (select id from public.dishes where name = 'Teuchi') teuchi,
       (select id from public.dishes where name = 'Taiyaki') taiyaki, public.mis_hoy() hoy \gset
-- La cajera de prueba no se llama «Cajera…»: se le activa a mano (en producción entra sola por su cargo)
update public.employees set juega_misiones = true where id = :caja;
select prueba.ok(public.mis_juega(:mesera) and public.mis_juega(:caja), 'juegan la maid (por su cargo) y la cajera');
select prueba.ok((select count(*) from public.mis_catalogo) = 100 and not exists (select 1 from public.mis_catalogo where activa),
  'las 100 misiones de la lista están cargadas y apagadas hasta que Edgar las apruebe');

-- 1) Con 3 misiones activas (una por nivel), el día toma una de cada nivel
update public.mis_catalogo set activa = true where numero in (26, 4, 14);
delete from public.mis_dia where fecha = :'hoy';
select public.mis_asignar(:'hoy');
select prueba.ok((select count(*) = 3 and sum(puntos) = 6 from public.mis_dia where fecha = :'hoy'), 'el día toma 3 misiones: 1, 2 y 3 puntos');
-- Para la prueba se fijan misiones que se pueden cumplir con un pedido chico
delete from public.mis_dia where fecha = :'hoy';
insert into public.mis_dia (fecha, nivel, texto, tipo, params, puntos) values
  (:'hoy', 1, 'Vende 1 postre', 'unidades', '{"n": 1, "cat": "Postres"}', 1),
  (:'hoy', 2, 'Cierra 1 comanda de $10 o más', 'comandas', '{"n": 1, "monto": 10}', 2),
  (:'hoy', 3, 'Ninguna anulación de platos en tu turno', 'sin_anulaciones', '{}', 3);

-- 2) La mesera vende; al cobrar, la base anota sus misiones cumplidas (puntos + 1 ficha cada una)
select not exists (select 1 from public.pos_sessions where status = 'abierta') as hay_que_abrir \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
\if :hay_que_abrir
select public.pos_cash_open(:caja, '6666', 0, 0);
\endif
select public.pos_open(:mesera, '5555', null, 'Misiones 1') as o1 \gset
select public.pos_add(:mesera, '5555', :o1, jsonb_build_array(jsonb_build_object('dish_id', :postre, 'qty', 1), jsonb_build_object('dish_id', :teuchi, 'variant', 'Gr', 'qty', 1)));
select public.pos_send(:mesera, '5555', :o1);
select public.mis_estado(:mesera, '5555') as antes \gset
reset role;
select total as t1 from public.pos_totals(:o1) \gset
select prueba.ok((:'antes'::jsonb -> 'misiones' -> 0 ->> 'hecha')::boolean = false and (:'antes'::jsonb ->> 'puntos')::int = 0,
  'antes de cobrar no hay misión cumplida ni puntos');
set role authenticated;
select public.pos_pay(:caja, '6666', :o1, jsonb_build_array(jsonb_build_object('method', 'efectivo_usd', 'amount', :t1, 'device', 'Caja')), 'REF', false, false);
reset role;
select prueba.ok((select count(*) from public.mis_logros where employee_id = :mesera and fecha = :'hoy') = 2
  and public.mis_saldo(:mesera) = 3 and public.mis_fichas_saldo(:mesera) = 2,
  'al cobrar se anotan sus 2 misiones cumplidas: 1 + 2 = 3 puntos y 2 fichas');
select prueba.ok(not exists (select 1 from public.mis_logros where employee_id = :mesera and nivel = 3),
  'la misión «sin anulaciones» espera al cierre de caja');
select prueba.ok(not exists (select 1 from public.mis_logros where employee_id = :caja), 'la cajera no gana misiones por lo que anotó la mesera');
-- «Ninguna comanda tuya por debajo de $8» (la 22): solo cuenta con el mínimo de comandas y se da al cerrar la caja
select prueba.ok((public.mis_medir(:mesera, :'hoy', 'sin_bajas', '{"monto": 8, "minimo": 1}') ->> 'actual')::int = 1
  and (public.mis_medir(:mesera, :'hoy', 'sin_bajas', '{"monto": 1000, "minimo": 1}') ->> 'actual')::int = 0
  and (public.mis_medir(:mesera, :'hoy', 'sin_bajas', '{"monto": 8, "minimo": 50}') ->> 'actual')::int = 0
  and public.mis_tipo_medible('sin_bajas') and public.mis_tipo_cierre('sin_bajas')
  and (select tipo = 'sin_bajas' from public.mis_catalogo where numero = 22),
  '«ninguna comanda por debajo de $8»: se cumple solo con el mínimo de comandas y se da al cerrar la caja');

-- 3) Lo que ve la tablet
set role authenticated;
select public.mis_estado(:mesera, '5555') as est \gset
reset role;
select prueba.ok((:'est'::jsonb ->> 'juega')::boolean and jsonb_array_length(:'est'::jsonb -> 'misiones') = 3
  and jsonb_array_length(:'est'::jsonb -> 'nuevos') = 2 and (:'est'::jsonb ->> 'puntos')::int = 3 and (:'est'::jsonb ->> 'fichas')::int = 2
  and not (:'est'::jsonb ->> 'saludo_hoy')::boolean,
  'la tablet ve las 3 misiones, las 2 recién cumplidas para celebrar, sus puntos y fichas');
select prueba.ok((:'est'::jsonb -> 'misiones' -> 1 ->> 'actual')::numeric >= 1 and (:'est'::jsonb -> 'misiones' -> 1 ->> 'meta')::numeric = 1,
  'cada misión trae cuánto lleva y cuánto pide');
select array(select id from public.mis_logros where employee_id = :mesera)::text as vistos \gset
set role authenticated;
select public.mis_marcar(:mesera, '5555', true, :'vistos'::bigint[]);
select public.mis_estado(:mesera, '5555') as est2 \gset
reset role;
select prueba.ok((:'est2'::jsonb ->> 'saludo_hoy')::boolean and jsonb_array_length(:'est2'::jsonb -> 'nuevos') = 0,
  'la bienvenida y las celebraciones salen una sola vez');

-- 4) Lo que NO cuenta: un pedido pagado con Yummy o cargado a la cuenta de un empleado
set role authenticated;
select public.pos_open(:mesera, '5555', null, 'Misiones Yummy') as o2 \gset
select public.pos_add(:mesera, '5555', :o2, jsonb_build_array(jsonb_build_object('dish_id', :teuchi, 'variant', 'Gr', 'qty', 3)));
select public.pos_send(:mesera, '5555', :o2);
reset role;
select total as t2 from public.pos_totals(:o2) \gset
set role authenticated;
select public.pos_pay(:caja, '6666', :o2, jsonb_build_array(jsonb_build_object('method', 'yummy', 'amount', :t2, 'device', 'Caja')), 'REF', false, false);
reset role;
select prueba.ok(public.mis_venta_dia(:mesera, :'hoy') = round(:t1::numeric, 2), 'lo cobrado con Yummy no suma a sus misiones');

-- 5) Tienda: compra directa con sus puntos; el premio sale a cocina en Ref 0 y queda en el cierre de la caja
insert into public.tienda_items (nombre, puntos, dish_id) values ('Taiyaki de prueba', 2, :taiyaki) returning id as premio \gset
select id as sesion from public.pos_sessions where status = 'abierta' \gset
select count(*) as pedidos_antes from public.pos_orders where session_id = :sesion and status = 'cobrada' and not premio \gset
set role authenticated;
select public.tienda_canjear(:mesera, '5555', :premio) as cj \gset
reset role;
select (:'cj'::jsonb ->> 'order_id')::bigint as premio_pedido \gset
select prueba.ok(public.mis_saldo(:mesera) = 1 and (select estado from public.tienda_canjes where id = (:'cj'::jsonb ->> 'id')::bigint) = 'entregado',
  'al comprar se descuentan sus puntos y el premio queda entregado, sin esperar a nadie');
select prueba.ok((select status = 'cobrada' and premio and session_id = :sesion from public.pos_orders where id = :premio_pedido)
  and (select bool_and(unit_price = 0 and status = 'enviado' and list_price > 0 and promo = 'Premio de misiones') from public.pos_items where order_id = :premio_pedido)
  and (select count(*) from public.pos_print_jobs where body like '%Premio de misiones%') >= 1,
  'sale la comanda a cocina y el pedido queda en Ref 0 en la caja abierta, con lo que vale en la carta');
set role authenticated;
select public.pos_cash_summary() as smp \gset
select prueba.falla(format('select public.tienda_canjear(%s, %L, %s)', :mesera, '5555', :premio), 'Te faltan 1 puntos', 'sin puntos suficientes no deja comprar');
reset role;
select prueba.ok((:'smp'::jsonb ->> 'orders')::int = :pedidos_antes
  and exists (select 1 from jsonb_array_elements(:'smp'::jsonb -> 'premios') v
              where v ->> 'quien' = 'Maid' and v ->> 'premio' like 'Taiyaki%' and (v ->> 'valor')::numeric > 0),
  'el resumen de caja lo muestra en «Premios de misiones» con lo que vale y no lo cuenta como pedido');
select prueba.ok(exists (select 1 from jsonb_array_elements(public.pos_session_report(:sesion) -> 'premios') v where v ->> 'quien' = 'Maid')
  and not exists (select 1 from jsonb_array_elements(public.pos_session_report(:sesion) -> 'orders') v where v ->> 'label' like 'Premio:%')
  and (public.pos_session_report(:sesion) -> 'totals' ->> 'orders')::int = :pedidos_antes,
  'el reporte del cierre (correo) trae los premios aparte y no los cuenta como pedidos');
select public.pos_sync_day(:'hoy');
select prueba.ok((select tickets from public.daily_sales where sale_date = :'hoy') = (select count(*) from public.pos_orders where status = 'cobrada' and not premio
                  and (closed_at at time zone 'America/Caracas')::date = :'hoy'),
  'en las ventas del día el premio no cuenta como ticket (no baja el ticket promedio)');
-- Con la caja cerrada no se compra (el premio tiene que quedar en el registro de una caja)
-- (la caja se marca cerrada sin disparar los triggers: las misiones del cierre se prueban en el punto 7)
insert into public.mis_puntos (employee_id, delta, motivo) values (:mesera, 5, 'prueba');
set session_replication_role = replica;
update public.pos_sessions set status = 'cerrada' where id = :sesion;
set session_replication_role = default;
set role authenticated;
select prueba.falla(format('select public.tienda_canjear(%s, %L, %s)', :mesera, '5555', :premio), 'La caja está cerrada', 'con la caja cerrada no se compran premios');
reset role;
set session_replication_role = replica;
update public.pos_sessions set status = 'abierta' where id = :sesion;
set session_replication_role = default;
select prueba.ok(public.mis_saldo(:mesera) = 6, 'si no pudo comprar, no pierde sus puntos');

-- 6) Juegos: gastan 1 ficha, el resultado lo decide la base y no se pasa del tope de 3 puntos al día
set role authenticated;
select public.jgo_tragamonedas(:mesera, '5555') as tm \gset
reset role;
select prueba.ok(public.mis_fichas_saldo(:mesera) = 1 and jsonb_array_length(:'tm'::jsonb -> 'carretes') = 3
  and (:'tm'::jsonb ->> 'premio')::int in (0, 1, 3) and (:'tm'::jsonb ->> 'fichas')::int = 1,
  'la tragamonedas gasta 1 ficha y devuelve 3 símbolos y su premio');
select prueba.ok(public.mis_saldo(:mesera) = 6 + (:'tm'::jsonb ->> 'premio')::int, 'el premio de la tragamonedas suma a sus puntos');
set role authenticated;
select prueba.falla(format('select public.jgo_ruleta(%s, %L, %L)', :mesera, '5555', 'azul'), 'Elige rojo', 'una apuesta que no existe no se acepta');
select public.jgo_ruleta(:mesera, '5555', 'rojo') as ru \gset
reset role;
select prueba.ok((:'ru'::jsonb ->> 'numero')::int between 0 and 36 and :'ru'::jsonb ->> 'color' in ('rojo', 'negro', 'verde')
  and ((:'ru'::jsonb ->> 'color' = 'rojo') = ((:'ru'::jsonb ->> 'premio')::int > 0) or public.jgo_ganado_hoy(:mesera) >= 3),
  'la ruleta paga si sale el color apostado');
set role authenticated;
select prueba.falla(format('select public.jgo_tragamonedas(%s, %L)', :mesera, '5555'), 'No tienes fichas', 'sin fichas no se juega');
reset role;
-- Tope: con 3 puntos ganados hoy jugando, ya no se juega aunque tenga fichas
insert into public.mis_fichas (employee_id, delta, motivo) values (:mesera, 2, 'prueba');
insert into public.mis_puntos (employee_id, delta, motivo) values (:mesera, 3 - public.jgo_ganado_hoy(:mesera), 'juego:prueba');
set role authenticated;
select prueba.falla(format('select public.jgo_tragamonedas(%s, %L)', :mesera, '5555'), 'tope de hoy', 'al llegar a 3 puntos jugando, se acaba el juego por hoy');
reset role;
select prueba.ok(public.mis_fichas_saldo(:mesera) = 2, 'si no puede jugar, no pierde la ficha');
delete from public.mis_puntos where employee_id = :mesera and motivo like 'juego:%';
-- Blackjack: una mano completa
set role authenticated;
select public.jgo_bj_empezar(:mesera, '5555') as bj \gset
reset role;
select prueba.ok(jsonb_array_length(:'bj'::jsonb -> 'jugador') = 2 and (:'bj'::jsonb ->> 'total')::int between 4 and 21
  and (:'bj'::jsonb ->> 'estado' <> 'jugando' or :'bj'::jsonb -> 'crupier' -> 1 = 'null'::jsonb),
  'el blackjack reparte 2 cartas y esconde la segunda del crupier');
set role authenticated;
select prueba.falla(format('select public.jgo_bj_accion(%s, %L, %s, %L)', :caja, '6666', :'bj'::jsonb ->> 'id', 'pedir'), 'Mano no encontrada', 'nadie juega la mano de otra');
select public.jgo_bj_accion(:mesera, '5555', (:'bj'::jsonb ->> 'id')::bigint, 'plantarse') as bj2 \gset
reset role;
select prueba.ok(:'bj2'::jsonb ->> 'estado' in ('gano', 'perdio', 'empate', 'blackjack') and jsonb_array_length(:'bj2'::jsonb -> 'crupier') >= 2
  and not (:'bj2'::jsonb -> 'crupier') @> '[null]'::jsonb
  and (:'bj2'::jsonb ->> 'premio')::int = case :'bj2'::jsonb ->> 'estado' when 'gano' then 1 when 'blackjack' then 2 else 0 end,
  'al plantarse se ve la mano del crupier y el premio va con el resultado');
select prueba.ok(not exists (select 1 from public.jgo_partidas where mazo is not null and estado = 'terminada'), 'al terminar la mano el mazo se borra');
-- Una mano ganadora que termina cuando el tope ya se llenó con otros juegos: no suma y lo avisa (al_tope)
delete from public.mis_puntos where employee_id = :mesera and motivo like 'juego:%';
set role authenticated;
select public.jgo_bj_empezar(:mesera, '5555') as bj3 \gset
reset role;
update public.jgo_partidas set estado = 'jugando', premio = 0, mazo = '["2♣", "3♣"]'::jsonb,
  resultado = '{"jugador": ["10♠", "10♥"], "crupier": ["10♦", "7♣"]}'::jsonb where id = (:'bj3'::jsonb ->> 'id')::bigint;
delete from public.mis_puntos where employee_id = :mesera and motivo like 'juego:%';   -- por si el reparto ya pagó algo
insert into public.mis_puntos (employee_id, delta, motivo) values (:mesera, 3, 'juego:prueba');
set role authenticated;
select public.jgo_bj_accion(:mesera, '5555', (:'bj3'::jsonb ->> 'id')::bigint, 'plantarse') as bj4 \gset
reset role;
select prueba.ok(:'bj4'::jsonb ->> 'estado' = 'gano' and (:'bj4'::jsonb ->> 'premio')::int = 0 and (:'bj4'::jsonb ->> 'al_tope')::boolean
  and :'bj4'::jsonb ->> 'mensaje' = 'Ganaste (ya llegaste al tope de hoy)' and public.jgo_ganado_hoy(:mesera) = 3,
  'si el tope se llenó mientras la mano seguía abierta, ganar no suma y se avisa');
delete from public.mis_puntos where employee_id = :mesera and motivo like 'juego:%';

-- 7) Al cerrar la caja se dan las misiones del final del día (aquí: sin anulaciones)
-- (las anulaciones de otras pruebas de hoy se mueven a otro día, para medir solo esta)
update public.pos_items set voided_at = voided_at - interval '3 days' where created_by = :mesera and status = 'anulado' and voided_at > now() - interval '2 days';
update public.pos_orders set status = 'anulada', void_reason = 'prueba' where status = 'abierta';
update public.gestion_settings set report_emails = '';
set role authenticated;
select public.pos_cash_close(:caja, '6666', '{}'::jsonb, '');
reset role;
select prueba.ok(exists (select 1 from public.mis_logros where employee_id = :mesera and nivel = 3), 'al cerrar la caja gana «sin anulaciones» quien no tuvo ninguna');

-- 8) Quien no juega no ve misiones ni canjea; Gestión ve todo y no activa lo que no se puede medir
update public.employees set juega_misiones = false where id = :caja;
select (select id from public.mis_catalogo where numero = 69) m69, (select id from public.mis_catalogo where numero = 30) m30 \gset
set role authenticated;
select prueba.ok(not (public.mis_estado(:caja, '6666') ->> 'juega')::boolean, 'quien no juega no ve misiones');
select prueba.falla(format('select public.tienda_canjear(%s, %L, %s)', :caja, '6666', :premio), 'meseras y cajeras', 'quien no juega no canjea');
select prueba.falla('select public.gestion_misiones()', 'Sin permiso', 'una tablet no entra a Gestión');
reset role;
insert into public.staff (email, role) values ('dueno@prueba.test', 'dueño') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
select jsonb_array_length(public.gestion_misiones() -> 'catalogo') as cat \gset
select prueba.ok(:cat = 100, 'Gestión ve las 100 misiones');
select prueba.falla(format('select public.gestion_mision_guardar(%s, true)', :m69), 'todavía no se puede medir',
  'no se activa una misión que el sistema todavía no mide');
select public.gestion_mision_guardar(:m30, true, 'Vende postre en 4 comandas', 2, 'todos', null);
select prueba.falla($$select public.gestion_misiones_ajustes('{"tope_juegos": 50}')$$, 'tope de los juegos', 'el tope de los juegos tiene límite');
reset role;
select prueba.ok((select activa from public.mis_catalogo where numero = 30), 'Gestión activa una misión medible');
select set_config('request.jwt.claims', '', false);
rollback;
\echo TODAS LAS PRUEBAS DE MISIONES PASARON
