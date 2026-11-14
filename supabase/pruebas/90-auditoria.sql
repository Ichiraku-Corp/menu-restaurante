-- Auditoría de la carta y los permisos: queda quién cambió qué, sin guardar secretos
\set ON_ERROR_STOP 1
\set QUIET 1
insert into public.staff (email, role) values ('dueno@prueba.test', 'dueño') on conflict do nothing;
select (select min(id) from public.dishes) plato \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
update public.dishes set price = price + 1 where id = :plato;
reset role;
select prueba.ok((select who = 'dueno@prueba.test' and via like 'authenticated%aal2' and new_data ? 'price' and not new_data ? 'updated_at' from public.audit_log where tbl = 'dishes' order by id desc limit 1),
  'un cambio de precio desde Gestión queda con la cuenta y el precio antes/después');
select set_config('request.jwt.claims', '', false);
update public.dishes set name = name || ' X' where id = :plato;
select prueba.ok((select via like 'SQL directo%' from public.audit_log where tbl = 'dishes' order by id desc limit 1), 'un cambio hecho directo en la base queda como «SQL directo»');
update public.employees set pos_pin_hash = extensions.crypt('4321', extensions.gen_salt('bf')) where name = 'Mesera Prueba';
select prueba.ok((select new_data ->> 'pos_pin' = 'PIN cambiado' and not (new_data ? 'pos_pin_hash') and not (old_data ? 'pos_pin_hash') from public.audit_log where tbl = 'employees' order by id desc limit 1),
  'el cambio de PIN se anota sin guardar el PIN');
update public.employees set pos_pin_hash = extensions.crypt('2222', extensions.gen_salt('bf')) where name = 'Mesera Prueba';
delete from public.categories where id = (select max(id) from public.categories where not exists (select 1 from public.dishes d where d.category_id = categories.id));
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.ok((select count(*) from public.audit_log) = 0, 'una tablet no puede leer la auditoría');
select prueba.falla('delete from public.audit_log', 'permission denied', 'nadie borra la auditoría desde la app');
reset role;
select set_config('request.jwt.claims', '', false);
\echo 'TODAS LAS PRUEBAS DE AUDITORÍA PASARON'
