-- Avisos al personal con confirmación de lectura
\set ON_ERROR_STOP 1
\set QUIET 1
select (select id from public.employees where name = 'Cajera Prueba') caja, (select id from public.employees where name = 'Mesera Prueba') mesera \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.falla(format('select public.pos_announcement_create(%s, %L, %L, %L)', :mesera, '2222', 'Hola', ''), 'permiso para cobrar', 'la mesera no publica avisos');
select public.pos_announcement_create(:caja, '1111', 'Nuevo uniforme desde el lunes', 'Delantal negro obligatorio', 'todos', 7) as aid \gset
select prueba.ok(public.pos_announcements(:mesera, '2222') -> 0 ->> 'title' = 'Nuevo uniforme desde el lunes', 'la mesera ve el aviso pendiente');
select public.pos_announcement_read(:mesera, '2222', :aid);
select prueba.ok(jsonb_array_length(public.pos_announcements(:mesera, '2222')) = 0, 'al tocar «Entendido» ya no le sale');
select public.pos_announcement_create(:caja, '1111', 'Solo cocina', '', 'cocina', 1) as cid \gset
select prueba.ok(jsonb_array_length(public.pos_announcements(:mesera, '2222')) = 0, 'un aviso para cocina no le sale a la mesera');
reset role;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
set role authenticated;
select (select x from jsonb_array_elements(public.announcements_admin()) x where (x ->> 'id')::bigint = :aid) as a \gset
select prueba.ok((:'a'::jsonb -> 'read') @> '["Mesera"]', 'Gestión ve quién lo leyó');
select prueba.ok((:'a'::jsonb -> 'missing') @> '["Cajera"]', 'y quién falta por leerlo');
reset role;
\echo 'TODAS LAS PRUEBAS DE AVISOS PASARON'
