-- Vuelto mixto: los dólares enteros en efectivo y el resto en bolívares
\set ON_ERROR_STOP 1
\set QUIET 1
select (select id from public.employees where name = 'Cajera Prueba') caja, (select id from public.employees where name = 'Mesera Prueba') mesera,
       (select min(id) from public.dishes) plato \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_cash_open(:caja, '1111', 20, 0) is not null as abierta \gset
select public.pos_open(:mesera, '2222', null, 'Vuelto') as o \gset
select public.pos_add(:mesera, '2222', :o, jsonb_build_array(jsonb_build_object('dish_id', :plato, 'qty', 1)));
select public.pos_send(:mesera, '2222', :o);
select public.pos_pay(:caja, '1111', :o, '[{"method":"efectivo_usd","amount":15.5,"device":"Caja"}]', 'MIX') -> 'change' as ch \gset
reset role;
select prueba.ok((:'ch'::jsonb ->> 'currency') = 'MIX' and (:'ch'::jsonb ->> 'usd')::numeric = 5 and (:'ch'::jsonb ->> 'bs')::numeric = 50,
                 format('vuelto de Ref 5,50 = $5 + Bs 50 a tasa 100 (dio %s)', :'ch'));
select prueba.ok((select count(*) from public.pos_payments where order_id = :o and reference = 'vuelto') = 2, 'quedan dos salidas de vuelto: una en $ y otra en Bs');
select prueba.ok((select sum(amount_ref) from public.pos_payments where order_id = :o) = 10, 'lo cobrado neto es Ref 10');
\echo 'TODAS LAS PRUEBAS DE VUELTO PASARON'
