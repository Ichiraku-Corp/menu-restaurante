-- Notas rápidas para cocina: las más usadas de cada plato y de toda la carta (pos_notas). En una transacción que se deshace.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;
insert into public.staff (email, role) values ('tablet@prueba.test', 'sala') on conflict do nothing;
select c.id as cat from public.categories c order by c.position limit 1 \gset
insert into public.dishes (category_id, name, price) values (:cat, 'Ramen notas', 9) returning id as ramen \gset
insert into public.dishes (category_id, name, price) values (:cat, 'Sushi notas', 8) returning id as sushi \gset
insert into public.pos_orders (kind, label, status, service_pct, opened_at) values ('llevar', 'Notas', 'abierta', 0, now()) returning id as o \gset
insert into public.pos_items (order_id, dish_id, name, qty, unit_price, status, notes, created_at)
select :o, d, n, 1, 5, 'enviado', nota, now() - interval '1 day' from (values
  (:ramen, 'Ramen notas', 'Sin picante'), (:ramen, 'Ramen notas', 'Sin picante'), (:ramen, 'Ramen notas', 'Sin picante'), (:ramen, 'Ramen notas', 'sin  picante '),
  (:ramen, 'Ramen notas', 'extra de fideos'), (:ramen, 'Ramen notas', 'extra de fideos'), (:ramen, 'Ramen notas', 'solo una vez'),
  (:ramen, 'Ramen notas', 'una nota muy larga que nadie va a repetir igual nunca jamás'), (:ramen, 'Ramen notas', 'una nota muy larga que nadie va a repetir igual nunca jamás'),
  (:sushi, 'Sushi notas', 'sin picante'), (:sushi, 'Sushi notas', 'tempurizado'), (:sushi, 'Sushi notas', 'tempurizado')) v(d, n, nota);
insert into public.pos_items (order_id, dish_id, name, qty, unit_price, status, notes, created_at)
  values (:o, :ramen, 'Ramen notas', 1, 5, 'enviado', 'muy vieja', now() - interval '90 days'), (:o, :ramen, 'Ramen notas', 1, 5, 'enviado', 'muy vieja', now() - interval '90 days');

set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_notas(60) as n \gset
select prueba.ok(:'n'::jsonb -> 'platos' -> (:ramen)::text = '["Sin picante", "extra de fideos"]'::jsonb,
                 'del ramen: «Sin picante» (4 veces, sin importar mayúsculas ni espacios) y «extra de fideos» (2); no la de una sola vez ni la muy larga');
select prueba.ok(:'n'::jsonb -> 'platos' -> (:sushi)::text = '["tempurizado"]'::jsonb, 'cada plato trae las suyas');
select prueba.ok((:'n'::jsonb -> 'todas') @> '["Sin picante"]'::jsonb and not ((:'n'::jsonb -> 'todas') @> '["extra de fideos"]'::jsonb),
                 'en toda la carta salen las que se usaron 3 veces o más');
select prueba.ok(not (:'n'::jsonb::text like '%muy vieja%'), 'las notas de hace más de 60 días no salen');
select set_config('request.jwt.claims', '{"role":"authenticated","email":"nadie@prueba.test"}', false);
select prueba.ok(public.pos_notas(60) is null, 'un equipo que no es tablet de sala no las ve');
reset role;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select prueba.falla('select public.pos_notas(60)', 'permission denied', 'el público no las ve');
reset role;
select set_config('request.jwt.claims', '', false);
rollback;
\echo 'TODAS LAS PRUEBAS DE NOTAS RÁPIDAS PASARON'
