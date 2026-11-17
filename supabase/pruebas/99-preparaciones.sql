-- Preparaciones (salsas, caldos, naruto…): su costo sale de sus ingredientes y se recalcula solo; las recetas las usan
-- como cualquier insumo, y al vender se descuentan sus ingredientes del inventario.
\set ON_ERROR_STOP 1
\set QUIET 1
insert into public.staff (email, role) values ('dueno@prueba.test', 'dueño') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);

insert into public.ingredients (name, buy_unit, buy_qty, buy_price, waste_pct) values
  ('Azúcar prep', 'kg', 1, 2, 0), ('Vinagre prep', 'l', 1, 3, 0), ('Tomate prep', 'kg', 1, 4, 20);
insert into public.ingredients (name, buy_unit, buy_qty, buy_price, waste_pct, zone, min_qty, is_prep)
  values ('Salsa prep', 'l', 1.5, 99, 10, 'afuera', 5, true);
select id as salsa from public.ingredients where name = 'Salsa prep' \gset
select id as azucar from public.ingredients where name = 'Azúcar prep' \gset
select id as vinagre from public.ingredients where name = 'Vinagre prep' \gset
select id as tomate from public.ingredients where name = 'Tomate prep' \gset

-- 1) Una preparación nueva no tiene precio de compra: cuesta lo que sus ingredientes
select prueba.ok((select buy_price = 0 and waste_pct = 0 and zone = 'cocina' and min_qty = 0 from public.ingredients where id = :salsa),
  'una preparación sin ingredientes cuesta 0, sin merma propia y sin inventario');
insert into public.prep_items (prep_id, ingredient_id, qty, unit, position) values
  (:salsa, :azucar, 400, 'g', 1), (:salsa, :vinagre, 400, 'ml', 2), (:salsa, :tomate, 600, 'g', 3);
select prueba.ok((select buy_price from public.ingredients where id = :salsa) = 5.00,
  'su costo es la suma de sus ingredientes, con la merma del tomate (0,80 + 1,20 + 3,00 = 5,00)');

-- 2) Si sube un ingrediente, la preparación se recalcula sola
update public.ingredients set buy_price = 3 where id = :azucar;
select prueba.ok((select buy_price from public.ingredients where id = :salsa) = 5.40, 'al subir el azúcar, la salsa pasa a 5,40 sola');
update public.ingredients set buy_price = 1 where id = :salsa;
select prueba.ok((select buy_price from public.ingredients where id = :salsa) = 5.40, 'a mano no se le puede poner otro precio a una preparación');

-- 3) Una preparación dentro de otra: el cambio llega hasta arriba
insert into public.ingredients (name, buy_unit, buy_qty, buy_price, is_prep) values ('Base prep', 'unidad', 10, 0, true);
select id as base from public.ingredients where name = 'Base prep' \gset
insert into public.prep_items (prep_id, ingredient_id, qty, unit, position) values (:base, :salsa, 150, 'ml', 1), (:base, :tomate, 100, 'g', 2);
select prueba.ok((select buy_price from public.ingredients where id = :base) = 1.04, 'una preparación puede llevar otra (0,54 de salsa + 0,50 de tomate)');
update public.ingredients set buy_price = 6 where id = :vinagre;
select prueba.ok((select buy_price from public.ingredients where id = :salsa) = 6.60 and (select buy_price from public.ingredients where id = :base) = 1.16,
  'al subir el vinagre se recalculan la salsa y la base que lleva la salsa');
delete from public.prep_items where prep_id = :salsa and ingredient_id = :tomate;
select prueba.ok((select buy_price from public.ingredients where id = :salsa) = 3.60 and (select buy_price from public.ingredients where id = :base) = 0.86,
  'al quitar un ingrediente también se recalcula (y la base con ella)');
update public.ingredients set buy_qty = 3 where id = :salsa;
select prueba.ok((select buy_price from public.ingredients where id = :salsa) = 3.60 and (select buy_price from public.ingredients where id = :base) = 0.68,
  'si la salsa rinde el doble, la base que la usa cuesta menos');

-- 4) Lo que no se puede
select prueba.falla($$insert into public.prep_items (prep_id, ingredient_id, qty, unit) values ($$ || :salsa || ', ' || :base || $$, 1, 'unidad')$$,
  'no puede llevar', 'no se permiten ciclos (la salsa no puede llevar la base que ya la lleva)');
select prueba.falla($$insert into public.prep_items (prep_id, ingredient_id, qty, unit) values ($$ || :salsa || ', ' || :azucar || $$, 2, 'unidad')$$,
  'se compra en kg', 'cada ingrediente se mide en su familia de unidad');
select prueba.falla($$insert into public.prep_items (prep_id, ingredient_id, qty, unit) values ($$ || :azucar || ', ' || :vinagre || $$, 2, 'ml')$$,
  'Solo una preparación', 'un insumo comprado no lleva ingredientes');
select prueba.falla($$update public.ingredients set is_prep = false where id = $$ || :salsa, 'no puede volverse', 'una preparación con ingredientes no pasa a ser insumo comprado');
select prueba.falla($$delete from public.ingredients where id = $$ || :vinagre, 'foreign key', 'no se borra un insumo que lleva una preparación');
select prueba.falla($$select public.propose_price('Salsa prep', 10, 1, 'l')$$, 'es una preparación', 'a una preparación no se le propone precio');
select prueba.falla($$select public.register_movement('Salsa prep', 'compra', 1, 'l')$$, 'es una preparación', 'una preparación no lleva inventario propio');
select prueba.ok((select r -> 'rows' -> 0 ->> 'st' = 'error' and r -> 'rows' -> 0 ->> 'msg' like '%es una preparación%'
                  from public.import_data('insumos', '[{"nombre":"salsa PREP","unidad":"l","cantidad_compra":"1","precio":"2"}]', true) r),
  'la carga de insumos no pisa una preparación');
reset role;
select prueba.ok(not exists (select 1 from public.price_history where ingredient_id in (:salsa, :base)), 'los recálculos de una preparación no llenan el historial de precios');
select prueba.ok(exists (select 1 from public.price_history where ingredient_id = :vinagre), 'los cambios del vinagre sí quedan en el historial');

-- 5) Al vender, se descuentan los ingredientes de la preparación (solo los que llevan inventario)
select c.id as cat from public.categories c order by c.position limit 1 \gset
insert into public.dishes (category_id, name, price) values (:cat, 'Plato prep prueba', 5) returning id as plato \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
select prueba.ok((select r ->> 'nuevo' = '2' from public.import_data('recetas', '[{"plato":"Plato prep prueba","insumo":"Base prep","cantidad":"2","unidad":"unidad"},
  {"plato":"Plato prep prueba","insumo":"Vinagre prep","cantidad":"10","unidad":"ml"}]', false) r), 'una receta puede usar una preparación como insumo');
select public.register_movement('Azúcar prep', 'compra', 10, 'kg');
select public.register_movement('Vinagre prep', 'compra', 10, 'l');
reset role;
insert into public.daily_sales (sale_date, total) values ('2026-02-03', 15);
insert into public.sales_items (sale_date, dish_id, dish_name, qty, amount) values ('2026-02-03', :plato, 'Plato prep prueba', 3, 15);
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
select public.apply_sales_consumption('2026-02-03');
reset role;
-- 3 platos × 2 bases = 6 de 10 bases → 90 ml de salsa (rinde 3 L) → 12 g de azúcar y 12 ml de vinagre; más 30 ml de vinagre directos
select prueba.ok((select qty_stock from public.inventory_movements where ingredient_id = :azucar and kind = 'consumo') = 0.012,
  'el azúcar que va dentro de la salsa (dentro de la base) se descuenta: 12 g');
select prueba.ok((select qty_stock from public.inventory_movements where ingredient_id = :vinagre and kind = 'consumo') = 0.042,
  'el vinagre suma lo de la salsa y lo directo de la receta: 42 ml');
select prueba.ok(not exists (select 1 from public.inventory_movements where ingredient_id in (:salsa, :base, :tomate) and kind = 'consumo'),
  'no se descuentan las preparaciones ni el tomate (su inventario no se lleva todavía)');
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
select public.apply_sales_consumption('2026-02-03');
reset role;
select prueba.ok((select count(*) from public.inventory_movements where ingredient_id = :azucar and kind = 'consumo') = 1
                 and (select stock_qty from public.ingredients where id = :azucar) = 9.988, 'aplicar el mismo día dos veces no descuenta dos veces');

-- 6) Guardar desde Gestión: todo o nada
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
select public.prep_save(null, '  Caldo prep ', 2, 'l', jsonb_build_array(jsonb_build_object('ingredient_id', :tomate, 'qty', 500, 'unit', 'g'),
                                                                       jsonb_build_object('ingredient_id', :azucar, 'qty', 0.1, 'unit', 'kg'))) as caldo \gset
select prueba.ok((select name = 'Caldo prep' and is_prep and buy_qty = 2 and buy_unit = 'l' and buy_price = 2.80 from public.ingredients where id = :caldo),
  'se crea una preparación con sus ingredientes (2,50 de tomate + 0,30 de azúcar)');
select prueba.falla($$select public.prep_save($$ || :salsa || $$, 'Salsa prep', 3, 'l', '[{"ingredient_id": $$ || :base || $$, "qty": 1, "unit": "unidad"}]')$$,
  'no puede llevar', 'si una línea no se puede (un ciclo), no se guarda');
select prueba.ok((select count(*) from public.prep_items where prep_id = :salsa) = 2 and (select buy_price from public.ingredients where id = :salsa) = 3.60,
  'y la preparación queda como estaba');
select prueba.falla($$select public.prep_save($$ || :salsa || $$, 'Salsa prep', 1, 'unidad', '[]')$$, 'se usa en recetas', 'lo que rinde no cambia de familia si ya se usa');
select prueba.falla($$select public.prep_save(null, 'tomate PREP', 1, 'kg', '[]')$$, 'Ya hay un insumo', 'no repite el nombre de un insumo');
select prueba.falla($$select public.prep_save($$ || :azucar || $$, 'Azúcar prep', 1, 'kg', '[]')$$, 'No es una preparación', 'no convierte un insumo comprado');
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.falla($$select public.prep_save(null, 'Otra prep', 1, 'kg', '[]')$$, 'Sin permiso', 'una tablet no guarda preparaciones');

-- 7) Permisos
select prueba.ok((select count(*) from public.prep_items) = 0, 'una tablet no ve las preparaciones');
reset role;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select prueba.falla('select * from public.prep_items', 'permission denied', 'el público no ve las preparaciones');
reset role;
select set_config('request.jwt.claims', '', false);

\echo 'TODAS LAS PRUEBAS DE PREPARACIONES PASARON'
