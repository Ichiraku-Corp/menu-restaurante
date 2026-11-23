-- Panel de Gestión › Inicio: metas del semáforo, ventas por día contra el año pasado, cobros por método y los platos que más
-- venden con lo que deja cada uno. Todo en una transacción que se deshace al final.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;
update public.gestion_settings set iva_pct = 16 where id = 1;
select (now() at time zone 'America/Caracas')::date - 1 as ayer \gset
-- Ayer, el mismo día de la semana del año pasado (364 días antes) y otro día de la semana
insert into public.daily_sales (sale_date, total, service_amount, by_method, tickets, source) values
  (:'ayer', 232, 20, '{"debito": 150, "pago_movil": 50, "efectivo": 32, "nota": "x"}', 4, 'pos'),
  (:'ayer'::date - 364, 200, 0, '{"efectivo": 200}', 3, 'syth'),
  (:'ayer'::date - 3, 116, 10, '{"debito": 100, "otros": 16}', 2, 'pos')
on conflict (sale_date) do update set total = excluded.total, service_amount = excluded.service_amount, by_method = excluded.by_method, tickets = excluded.tickets;
-- Un plato con receta (116 g de harina a Ref 10 el kg = Ref 1,16) a Ref 11,60 con IVA (Ref 10 sin IVA) y otro sin receta
select c.id as cat from public.categories c order by c.position limit 1 \gset
insert into public.ingredients (name, buy_unit, buy_qty, buy_price, waste_pct) values ('Harina panel', 'kg', 1, 10, 0) returning id as harina \gset
insert into public.dishes (category_id, name, price) values (:cat, 'Plato panel', 11.60) returning id as plato \gset
insert into public.dishes (category_id, name, price) values (:cat, 'Sin receta panel', 5) returning id as sinreceta \gset
insert into public.recipe_items (dish_id, variant, ingredient_id, qty, unit) values (:plato, '', :harina, 116, 'g');
insert into public.sales_items (sale_date, dish_id, dish_name, variant, qty, amount) values
  (:'ayer', :plato, 'Plato panel', '', 10, 116), (:'ayer', :sinreceta, 'Sin receta panel', '', 30, 150);

insert into public.staff (email, role) values ('dueno@prueba.test', 'dueño') on conflict do nothing;
insert into public.staff (email, role) values ('tablet@prueba.test', 'sala') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
select public.gestion_panel(7) as p \gset
select prueba.ok((:'p'::jsonb ->> 'dias')::int = 7 and (:'p'::jsonb ->> 'hasta')::date = :'ayer'::date and jsonb_array_length(:'p'::jsonb -> 'serie') = 7,
                 'el panel cubre los últimos 7 días completos (hasta ayer), uno por día');
select prueba.ok(:'p'::jsonb -> 'metas' = '{"insumos_pct": 35.0, "nomina_pct": 25.0, "comisiones_pct": 2.0, "cocina_min": 15.0, "calificacion": 4.5}'::jsonb,
                 'las metas recomendadas vienen de fábrica: insumos 35 %, nómina 25 %, comisiones 2 %, cocina 15 min y calificación 4,5');
select prueba.ok((select (e ->> 'ventas')::numeric = 232 and (e ->> 'ventas_ant')::numeric = 200 from jsonb_array_elements(:'p'::jsonb -> 'serie') e
                  where (e ->> 'dia')::date = :'ayer'::date), 'cada día trae lo vendido y lo del mismo día de la semana del año pasado');
select prueba.ok((select count(*) from jsonb_array_elements(:'p'::jsonb -> 'serie') e where e -> 'ventas' = 'null'::jsonb) = 5,
                 'los días sin ventas quedan vacíos, no en cero');
select prueba.ok(:'p'::jsonb -> 'metodos' = '[{"metodo": "debito", "ref": 250}, {"metodo": "pago_movil", "ref": 50}, {"metodo": "efectivo", "ref": 32}, {"metodo": "otros", "ref": 16}]'::jsonb,
                 'los cobros por método suman lo anotado en los cierres, de mayor a menor (lo que no es un número no cuenta)');
select prueba.ok(:'p'::jsonb -> 'platos' -> 0 ->> 'plato' = 'Sin receta panel' and :'p'::jsonb -> 'platos' -> 1 ->> 'plato' = 'Plato panel',
                 'los platos van de más a menos vendido en plata');
select prueba.ok(:'p'::jsonb -> 'platos' -> 1 = '{"plato": "Plato panel", "cant": 10, "ventas": 116, "precio": 11.60, "costo": 1.16, "costo_pct": 12, "deja": 8.84}'::jsonb,
                 'cada plato trae su costo por receta, el % de costo sin IVA (1,16 de 10 = 12 %) y lo que deja por plato (Ref 8,84)');
select prueba.ok(:'p'::jsonb -> 'platos' -> 0 -> 'costo' = 'null'::jsonb and :'p'::jsonb -> 'platos' -> 0 -> 'costo_pct' = 'null'::jsonb,
                 'un plato sin receta sale sin costo (no como cero)');
select prueba.ok(jsonb_array_length(public.gestion_panel(30) -> 'serie') = 30 and public.gestion_panel(99) ->> 'dias' = '7', 'también 30 días; cualquier otro número vuelve a 7');
-- Las metas se cambian en Ajustes (el dueño puede; fuera de rango, no)
update public.gestion_settings set meta_insumos_pct = 30 where id = 1;
select prueba.ok((public.gestion_panel(7) -> 'metas' ->> 'insumos_pct')::numeric = 30, 'si el dueño cambia una meta, el panel la usa');
select prueba.falla('update public.gestion_settings set meta_calificacion = 6 where id = 1', 'gestion_settings_metas_panel_check', 'una calificación de 6 no es una meta posible');
-- Solo el dueño o un administrador
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.falla('select public.gestion_panel(7)', 'Sin permiso', 'una tablet no ve el panel');
reset role;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select prueba.falla('select public.gestion_panel(7)', 'permission denied', 'el público no ve el panel');
reset role;
select set_config('request.jwt.claims', '', false);
rollback;
\echo 'TODAS LAS PRUEBAS DEL PANEL PASARON'
