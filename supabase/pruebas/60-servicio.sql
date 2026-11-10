-- Liquidación del servicio: con descuento de deudas (tope 40) y sin descontar (deudas quedan pendientes)
\set ON_ERROR_STOP 1
\set QUIET 1
select (select id from public.employees where name = 'Mesera Prueba') mesera \gset
insert into public.staff (email, role) values ('dueno@prueba.test', 'dueño') on conflict do nothing;
insert into public.pos_tab_moves (employee_id, kind, amount_ref, note, created_by) values (:mesera, 'saldo_inicial', 70, 'prueba', 'prueba');
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
select public.svc_month('2026-01-01') is not null;
select prueba.ok((public.svc_month('2026-01-01') -> 'info' ->> 'max_from_bonus')::numeric = 40, 'el tope del bono para deudas es Ref 40');
-- Sin descontar: se paga el bono completo y la deuda queda en la cuenta
select public.svc_month_save('2026-01-01', jsonb_build_object('service_manual', '1000', 'deduct_debts', false,
  'lines', jsonb_build_array(jsonb_build_object('kind', 'persona', 'employee_id', :mesera, 'pct', 10))));
select public.svc_month_close('2026-01-01') is not null;
select (select x from jsonb_array_elements(public.svc_month('2026-01-01') -> 'lines') x where (x ->> 'employee_id')::bigint = :mesera) as l \gset
select prueba.ok((:'l'::jsonb ->> 'pay_ref')::numeric = 100 and (:'l'::jsonb ->> 'from_bonus')::numeric = 0, 'sin descontar, se paga el bono completo');
reset role;
select prueba.ok(public.pos_tab_balance(:mesera) = 70, 'sin descontar, la deuda queda pendiente en la cuenta');
set role authenticated;
-- Reabrir y liquidar descontando: 40 del bono y 30 a la quincena
select public.svc_month_reopen('2026-01-01');
select public.svc_month_save('2026-01-01', jsonb_build_object('service_manual', '1000', 'deduct_debts', true,
  'lines', jsonb_build_array(jsonb_build_object('kind', 'persona', 'employee_id', :mesera, 'pct', 10))));
select public.svc_month_close('2026-01-01') is not null;
select (select x from jsonb_array_elements(public.svc_month('2026-01-01') -> 'lines') x where (x ->> 'employee_id')::bigint = :mesera) as l \gset
select prueba.ok((:'l'::jsonb ->> 'from_bonus')::numeric = 40 and (:'l'::jsonb ->> 'to_payroll')::numeric = 30 and (:'l'::jsonb ->> 'pay_ref')::numeric = 60,
  'descontando: Ref 40 del bono y Ref 30 a la quincena');
reset role;
select prueba.ok(public.pos_tab_balance(:mesera) = 0, 'descontando, la cuenta queda en cero');
\echo 'TODAS LAS PRUEBAS DEL SERVICIO PASARON'
