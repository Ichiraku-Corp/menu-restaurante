-- Nómina: faltas y descuentos de la quincena, con la tasa euro BCV del día
\set ON_ERROR_STOP 1
\set QUIET 1
select (select id from public.employees where name = 'Mesera Prueba') mesera, (now() at time zone 'America/Caracas')::date hoy \gset
select date_trunc('month', :'hoy'::date)::date + case when extract(day from :'hoy'::date) >= 16 then 15 else 0 end as q0 \gset
delete from public.pos_rates where rate_date > :'hoy'::date;
insert into public.pos_rates (rate_date, eur, source) values (:'hoy'::date + 1, 123.45, 'prueba');
-- La cuenta de la mesera pasa Ref 7 a la quincena (como lo hace la liquidación del servicio)
insert into public.pos_tab_moves (employee_id, kind, amount_ref, note, created_by) values (:mesera, 'descuento_nomina', -7, 'Pasa a la quincena', 'prueba');

set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
insert into public.payroll_adjustments (employee_id, period, kind, days, amount_ref, reason, created_by)
  values (:mesera, :'q0', 'falta', 1, 10, 'No vino el sábado', 'otro@prueba.test');
insert into public.payroll_adjustments (employee_id, period, kind, amount_ref, reason) values (:mesera, :'q0', 'descuento', 15.5, 'Adelanto');
select prueba.falla(format('insert into public.payroll_adjustments (employee_id, period, kind, amount_ref) values (%s, %L, %L, 5)', :mesera, (:'q0'::date + 2)::text, 'descuento'),
  'period_check', 'cada descuento va en una quincena (día 1 o 16)');
select prueba.falla(format('insert into public.payroll_adjustments (employee_id, period, kind, amount_ref) values (%s, %L, %L, 0)', :mesera, :'q0', 'descuento'),
  'amount_ref_check', 'el monto tiene que ser mayor que cero');
select public.gestion_nomina(:'hoy'::date) as n \gset
select prueba.ok((:'n'::jsonb ->> 'desde')::date = :'q0'::date and jsonb_array_length(:'n'::jsonb -> 'ajustes') = 2, 'la quincena trae sus faltas y descuentos');
select prueba.ok((:'n'::jsonb -> 'ajustes' -> 0 ->> 'por') = 'dueno@prueba.test' and (:'n'::jsonb -> 'ajustes' -> 0 ->> 'kind') = 'falta',
  'queda quién lo anotó (no se puede poner otro nombre)');
select prueba.ok((:'n'::jsonb -> 'proxima' ->> 'eur')::numeric = 123.45 and (:'n'::jsonb -> 'tasa' ->> 'fecha')::date <= :'hoy'::date,
  'trae la tasa euro de hoy y la próxima si el BCV ya la publicó');
select prueba.ok(exists (select 1 from jsonb_array_elements(:'n'::jsonb -> 'cuentas') c where (c ->> 'employee_id')::bigint = :mesera and (c ->> 'amount')::numeric = 7),
  'muestra lo que la cuenta del empleado pasa a la quincena');
select prueba.ok(jsonb_array_length(public.gestion_nomina(:'q0'::date - 20) -> 'ajustes') = 0, 'otra quincena no trae esos descuentos');
update public.payroll_adjustments set created_by = 'otro@prueba.test', amount_ref = 12 where reason = 'No vino el sábado';
select prueba.ok((select created_by = 'dueno@prueba.test' and amount_ref = 12 from public.payroll_adjustments where reason = 'No vino el sábado'),
  'se puede corregir el monto, pero no quién lo anotó');
select prueba.ok(exists (select 1 from public.audit_log where tbl = 'payroll_adjustments' and action = 'alta' and who = 'dueno@prueba.test'), 'queda en la auditoría');
-- Marcar pagado: queda el monto, la tasa, los Bs, quién y cuándo; no se puede pagar dos veces la misma quincena
insert into public.payroll_payments (employee_id, period, amount_ref, rate, amount_bs, paid_by) values (:mesera, :'q0', 113, 100, 11300, 'otro@prueba.test');
select prueba.falla(format('insert into public.payroll_payments (employee_id, period, amount_ref) values (%s, %L, 113)', :mesera, :'q0'), 'payroll_payments_pkey',
  'no se marca dos veces el pago de la misma persona en la quincena');
select prueba.ok((select (p -> 0 ->> 'bs')::numeric = 11300 and (p -> 0 ->> 'por') = 'dueno@prueba.test' from (select public.gestion_nomina(:'hoy'::date) -> 'pagos' p) x),
  'el pago queda con sus Bs, la tasa y quién lo marcó');

-- Una tablet no ve ni anota nada de la nómina
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.ok((select count(*) from public.payroll_adjustments) = 0, 'una tablet no lee las faltas ni los descuentos');
select prueba.falla(format('insert into public.payroll_adjustments (employee_id, period, kind, amount_ref) values (%s, %L, %L, 5)', :mesera, :'q0', 'descuento'),
  'row-level security', 'una tablet no puede anotar descuentos');
select prueba.falla('select public.gestion_nomina(null)', 'Sin permiso', 'una tablet no ve la nómina');
select prueba.ok((select count(*) from public.payroll_payments) = 0, 'una tablet no ve quién cobró la quincena');
delete from public.payroll_payments;  -- sin permiso no borra nada

select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
select prueba.ok(exists (select 1 from public.payroll_payments where employee_id = :mesera), 'una tablet no puede desmarcar un pago');
select prueba.falla(format('delete from public.employees where id = %s', :mesera), 'foreign key', 'no se puede eliminar a alguien con pagos de nómina guardados (se desactiva)');
delete from public.payroll_adjustments where reason = 'Adelanto';
delete from public.payroll_payments where employee_id = :mesera and period = :'q0';
select prueba.ok(not exists (select 1 from public.payroll_payments), 'desmarcar el pago lo borra (y queda en la auditoría)');
select prueba.ok((select count(*) from public.payroll_adjustments where employee_id = :mesera) = 1, 'se puede borrar un descuento mal anotado');
reset role;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select prueba.falla('select count(*) from public.payroll_adjustments', 'permission denied', 'el público no lee la nómina');
select prueba.falla('select count(*) from public.payroll_payments', 'permission denied', 'el público no ve los pagos de la nómina');
select prueba.falla('select public.gestion_nomina(null)', 'permission denied', 'el público no puede pedir la nómina');
reset role;
delete from public.payroll_adjustments;
delete from public.payroll_payments;
delete from public.pos_tab_moves where created_by = 'prueba' and note = 'Pasa a la quincena';
delete from public.pos_rates where rate_date > :'hoy'::date;
select set_config('request.jwt.claims', '', false);
\echo 'TODAS LAS PRUEBAS DE NÓMINA PASARON'
