-- Nadie fuera de dueño/admin con 2FA puede cambiar la carta ni sus fotos, aunque se vuelva a ejecutar schema.sql
\set ON_ERROR_STOP 1
\set QUIET 1
select (select min(id) from public.dishes) plato, (select price from public.dishes order by id limit 1) precio \gset
\ir ../schema.sql
\set QUIET 1
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select prueba.falla(format('update public.dishes set price = 0 where id = %s', :plato), 'permission denied', 'el público no puede cambiar precios');
select prueba.falla('insert into public.categories (name) values (''Hackeado'')', 'permission denied', 'el público no puede crear categorías');
select prueba.falla(format('delete from public.dishes where id = %s', :plato), 'permission denied', 'el público no puede borrar platos');
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
update public.dishes set price = 0 where id = :plato;
select prueba.ok((select price from public.dishes where id = :plato) = :precio, 'la cuenta de las tablets no puede cambiar precios (aun después de volver a ejecutar schema.sql)');
select prueba.falla('insert into public.categories (name) values (''Hackeado'')', 'row-level security', 'la cuenta de las tablets no puede crear categorías');
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal1"}', false);
update public.dishes set price = 0 where id = :plato;
select prueba.ok((select price from public.dishes where id = :plato) = :precio, 'ni el dueño sin el código de 2FA puede cambiar la carta');
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
update public.dishes set price = price + 1 where id = :plato;
select prueba.ok((select price from public.dishes where id = :plato) = :precio + 1, 'el dueño con 2FA sí puede editar la carta');
update public.dishes set price = price - 1 where id = :plato;
reset role;
select set_config('request.jwt.claims', '', false);
\echo 'TODAS LAS PRUEBAS DE CARTA SEGURA PASARON'
