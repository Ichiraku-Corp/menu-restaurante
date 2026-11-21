-- Entrar a la tablet solo con el PIN (sin tocar el nombre): el PIN dice quién es; límite contra adivinanzas.
-- Todo en una transacción que se deshace al final.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;
insert into public.staff (email, role) values ('tablet@prueba.test', 'sala') on conflict do nothing;
insert into public.employees (name, job_title, pos_can_charge) values ('Directo Caja', 'Caja', true), ('Directo Mesera', 'Mesera', false), ('Directo Baja', 'Mesera', false);
select (select id from public.employees where name = 'Directo Caja') caja, (select id from public.employees where name = 'Directo Mesera') mesera,
       (select id from public.employees where name = 'Directo Baja') baja \gset
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select public.pos_set_pin(:caja, '4826'), public.pos_set_pin(:mesera, '7351'), public.pos_set_pin(:baja, '1593');
update public.employees set active = false where id = :baja;
select prueba.falla('select public.pos_set_pin(' || :mesera || ', ''4826'')', 'ya lo usa otra persona', 'no se puede repetir el PIN de otra persona');

set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_pin_login('4826') as r \gset
select prueba.ok((:'r'::jsonb ->> 'ok')::boolean and (:'r'::jsonb ->> 'id')::bigint = :caja and (:'r'::jsonb ->> 'can_charge')::boolean,
                 'con solo el PIN entra la cajera, con su permiso de cobrar');
reset role;
select prueba.ok((select count(*) from public.pos_log where employee_id = :caja and action = 'entrada') = 1, 'queda anotada su entrada');
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.ok((public.pos_pin_login('7351', false) ->> 'id')::bigint = :mesera, 'para marcar llegada solo dice quién es…');
reset role;
select prueba.ok((select count(*) from public.pos_log where employee_id = :mesera and action = 'entrada') = 0, '…y no cuenta como entrada');
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.ok(not (public.pos_pin_login('1593') ->> 'ok')::boolean, 'quien ya no trabaja aquí no entra');
select prueba.ok(public.pos_pin_login('12a4') ->> 'error' = 'PIN incorrecto', 'un PIN que no son 4 números no entra');

-- Si dos personas tuvieran el mismo PIN (puesto antes de la regla), se pide tocar el nombre
reset role;
update public.employees set pos_pin_hash = (select pos_pin_hash from public.employees where id = :caja) where id = :baja;
update public.employees set active = true where id = :baja;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.ok((public.pos_pin_login('4826') ->> 'elegir')::boolean, 'si dos personas comparten PIN, pide tocar el nombre');
select prueba.ok((public.pos_check_pin(:caja, '4826') ->> 'ok')::boolean, 'y tocando el nombre entra como siempre');

-- Contra adivinanzas: 10 PIN sin dueño en 10 minutos cierran la entrada directa (con el nombre sigue)
select count(*) from (select public.pos_pin_login(lpad(g::text, 4, '0')) from generate_series(9000, 9009) g) x \gset
select prueba.ok(public.pos_pin_login('7351') ->> 'error' like 'Demasiados intentos%', 'tras 10 PIN sin dueño, la entrada directa se cierra un rato');
select prueba.ok((public.pos_check_pin(:mesera, '7351') ->> 'ok')::boolean, 'pero tocando el nombre se sigue entrando');

-- Solo las tablets
select set_config('request.jwt.claims', '{"role":"authenticated","email":"nadie@prueba.test"}', false);
select prueba.ok(public.pos_pin_login('7351') ->> 'error' = 'Este dispositivo no está autorizado', 'un equipo que no es tablet de sala no entra');
reset role;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select prueba.falla('select public.pos_pin_login(''7351'')', 'permission denied', 'el público no puede probar PIN');
reset role;
select set_config('request.jwt.claims', '', false);
rollback;
\echo 'TODAS LAS PRUEBAS DE ENTRAR CON EL PIN PASARON'
