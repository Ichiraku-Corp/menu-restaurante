-- Freno a los PIN equivocados en las funciones de la caja (pedido de Edgar, 24/11), y el sello solo desde Ref 20.
-- Las secuencias del freno no se deshacen con rollback: se dejan en cero al empezar y al terminar.
\set ON_ERROR_STOP 1
\set QUIET 1
select setval('public.pos_pin_fallos_seq', 1, false), setval('public.pos_pin_ventana_seq', 1, false);
set ichiraku.pin_freno = '10';
begin;
select (select id from public.employees where name = 'Cajera Prueba') caja, (select id from public.employees where name = 'Mesera Prueba') mesera,
       (select id from public.dishes where name = 'Limonada rosa') limonada \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);

-- 1) 10 PIN equivocados en un minuto: las funciones de la caja frenan, aunque el siguiente PIN sea el correcto
select prueba.falla(format('select public.pos_announcements(%s, %L)', :mesera, '0000'), 'PIN incorrecto', 'un PIN equivocado dice «PIN incorrecto»');
select prueba.falla(format('select public.pos_announcements(%s, %L)', :mesera, lpad(g::text, 4, '0')), 'PIN incorrecto', 'otro PIN equivocado') from generate_series(1, 8) g;
select public.pos_announcements(:mesera, '2222') is not null as todavia \gset
select prueba.ok(:'todavia'::boolean, 'con 9 errores todavía entra con el PIN correcto');
select prueba.falla(format('select public.pos_announcements(%s, %L)', :mesera, '0009'), 'PIN incorrecto', 'el décimo error');
select prueba.falla(format('select public.pos_announcements(%s, %L)', :mesera, '2222'), 'espera un minuto', 'al décimo error en un minuto, ni el PIN correcto entra: hay que esperar');
select prueba.falla(format('select public.pos_announcements(%s, %L)', :caja, '1111'), 'espera un minuto', 'el freno es para todas las tablets');
reset role;
-- pasado el minuto vuelve a entrar
select setval('public.pos_pin_ventana_seq', extract(epoch from clock_timestamp())::bigint - 61);
set role authenticated;
select public.pos_announcements(:mesera, '2222') is not null as despues \gset
reset role;
select prueba.ok(:'despues'::boolean, 'pasado el minuto vuelve a entrar con su PIN');
select setval('public.pos_pin_fallos_seq', 1, false), setval('public.pos_pin_ventana_seq', 1, false);

-- 2) El mismo tope de la pantalla: 5 errores de una persona en 10 minutos la frenan también por esta vía
insert into public.pos_log (employee_id, action) select :mesera, 'pin_fallido' from generate_series(1, 5);
set role authenticated;
select prueba.falla(format('select public.pos_announcements(%s, %L)', :mesera, '2222'), 'Espera 10 minutos', 'con 5 errores en la pantalla tampoco entra llamando directo');
select public.pos_announcements(:caja, '1111') is not null as otra \gset
reset role;
select prueba.ok(:'otra'::boolean, 'las demás personas siguen entrando');
delete from public.pos_log where employee_id = :mesera and action = 'pin_fallido';

-- 3) El sello de la tarjeta de puntos solo desde Ref 20
select not exists (select 1 from public.pos_sessions where status = 'abierta') as hay_que_abrir \gset
set role authenticated;
\if :hay_que_abrir
select public.pos_cash_open(:caja, '1111', 0, 0);
\endif
select public.pos_open(:mesera, '2222', null, 'Sello chico') as o1 \gset
select public.pos_add(:mesera, '2222', :o1, jsonb_build_array(jsonb_build_object('dish_id', :limonada, 'qty', 1)));
select public.pos_send(:mesera, '2222', :o1);
reset role;
select total as t1 from public.pos_totals(:o1) \gset
set role authenticated;
select public.pos_pay(:caja, '1111', :o1, jsonb_build_array(jsonb_build_object('method', 'efectivo_usd', 'amount', :t1, 'device', 'Caja')), 'REF', false, true);
reset role;
select prueba.ok(:t1::numeric < 20 and not (select sello from public.pos_orders where id = :o1), 'una compra de menos de Ref 20 no anota sello aunque llegue marcada');
select set_config('request.jwt.claims', '', false);
rollback;
reset ichiraku.pin_freno;
select setval('public.pos_pin_fallos_seq', 1, false), setval('public.pos_pin_ventana_seq', 1, false);
\echo TODAS LAS PRUEBAS DEL FRENO DE PIN Y DEL SELLO PASARON
