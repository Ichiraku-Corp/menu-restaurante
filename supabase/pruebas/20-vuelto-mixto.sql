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
-- Vuelto por pago móvil: sale de la cuenta del negocio (baja lo esperado en pago móvil, no en efectivo)
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_open(:mesera, '2222', null, 'Vuelto movil') as o2 \gset
select public.pos_add(:mesera, '2222', :o2, jsonb_build_array(jsonb_build_object('dish_id', :plato, 'qty', 1)));
select public.pos_send(:mesera, '2222', :o2);
select public.pos_pay(:caja, '1111', :o2, '[{"method":"efectivo_usd","amount":15,"device":"Caja"}]', 'MOVIL') -> 'change' as ch2 \gset
reset role;
select prueba.ok((:'ch2'::jsonb ->> 'currency') = 'MOVIL' and (:'ch2'::jsonb ->> 'amount')::numeric = 500, 'vuelto de Ref 5 por pago móvil = Bs 500');
select prueba.ok((select amount from public.pos_payments where order_id = :o2 and reference = 'vuelto') = -500
  and (select method from public.pos_payments where order_id = :o2 and reference = 'vuelto') = 'pago_movil', 'el vuelto sale del pago móvil, no de la gaveta');
-- El cliente deja el vuelto de propina: el dinero queda en la gaveta y cuenta como propina
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_open(:mesera, '2222', null, 'Vuelto propina') as o3 \gset
select public.pos_add(:mesera, '2222', :o3, jsonb_build_array(jsonb_build_object('dish_id', :plato, 'qty', 1)));
select public.pos_send(:mesera, '2222', :o3);
select public.pos_pay(:caja, '1111', :o3, '[{"method":"efectivo_usd","amount":12,"device":"Caja"}]', 'PROPINA') -> 'change' as ch3 \gset
reset role;
select prueba.ok((:'ch3'::jsonb ->> 'currency') = 'PROPINA' and (:'ch3'::jsonb ->> 'amount')::numeric = 2, 'el vuelto de Ref 2 queda de propina');
select prueba.ok((select sum(amount) from public.pos_payments where order_id = :o3 and method = 'efectivo_usd') = 12, 'en la gaveta quedan los $12 que entregó');
select prueba.ok((select sum(amount_ref) from public.pos_payments where order_id = :o3 and is_tip) = 2
  and (select paid from public.pos_totals(:o3)) = 10, 'la cuenta queda pagada en Ref 10 y Ref 2 de propina');
select prueba.ok((select count(*) from public.pos_print_jobs where body like '%Propina Efectivo $%' and body like '%RECIBO%') >= 1
  and (select count(*) from public.pos_print_jobs where body like '%vuelto>propina%') = 0, 'el recibo dice «Propina» y no muestra la línea interna');
\echo 'TODAS LAS PRUEBAS DE VUELTO PASARON'
