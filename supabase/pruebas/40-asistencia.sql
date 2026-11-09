-- Asistencia desde la tablet, uniforme del día y rendimiento del mes
\set ON_ERROR_STOP 1
\set QUIET 1
select (select id from public.employees where name = 'Cajera Prueba') caja, (select id from public.employees where name = 'Mesera Prueba') mesera \gset
insert into public.staff (email, role) values ('dueno@prueba.test', 'dueño') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.ok(public.pos_mark_status(:mesera, '2222') -> 'next' = '["in"]'::jsonb, 'sin marcas hoy, le toca marcar llegada');
select prueba.falla(format('select public.pos_mark(%s, %L, %L)', :mesera, '9999', 'in'), 'PIN', 'sin el PIN correcto no se marca');
select prueba.ok(public.pos_mark(:mesera, '2222', 'in') -> 'next' = '["break_start", "out"]'::jsonb, 'después de llegar puede salir a descanso o irse');
select pg_sleep(1.1);
select prueba.ok(public.pos_mark(:mesera, '2222', 'break_start') -> 'next' = '["break_end"]'::jsonb, 'en descanso solo puede volver');
select prueba.falla(format('select public.pos_uniform_list(%s, %L)', :mesera, '2222'), 'permiso para cobrar', 'la mesera no anota uniformes');
select prueba.ok(jsonb_array_length(public.pos_uniform_list(:caja, '1111')) = 1, 'la cajera ve a quien llegó hoy');
select public.pos_uniform_set(:caja, '1111', :mesera, false, 'sin delantal');
reset role;
update public.gestion_settings set perf_rules = '{"max_late": 3, "max_absent": 5, "max_break_over": 3, "max_no_uniform": 0}';
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
select (select x from jsonb_array_elements(public.perf_month(current_date) -> 'people') x where (x ->> 'employee_id')::bigint = :mesera) as p \gset
select prueba.ok((:'p'::jsonb ->> 'worked')::int = 1 and (:'p'::jsonb ->> 'no_uniform')::int = 1, 'el mes cuenta 1 día trabajado y 1 día sin uniforme');
select prueba.ok((:'p'::jsonb ->> 'ok')::boolean = false and :'p'::jsonb -> 'reasons' ->> 0 = '1 días sin uniforme', 'con la regla de 0 días sin uniforme, no cumple y dice por qué');
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.falla('select public.perf_month(current_date)', 'Sin permiso', 'una tablet no ve el rendimiento');
reset role;
\echo 'TODAS LAS PRUEBAS DE ASISTENCIA PASARON'
