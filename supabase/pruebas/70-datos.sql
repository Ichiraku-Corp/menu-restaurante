-- Carga de datos desde planillas, ventas por plato y ficha de cliente por teléfono
\set ON_ERROR_STOP 1
\set QUIET 1
select (select id from public.employees where name = 'Cajera Prueba') caja \gset
insert into public.staff (email, role) values ('dueno@prueba.test', 'dueño') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.falla($$select public.import_data('insumos', '[{"nombre":"Harina"}]', false)$$, 'Sin permiso', 'una tablet no carga datos');
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);

-- Insumos: revisar no guarda nada y avisa los errores fila por fila
select public.import_data('insumos', '[{"nombre":"Harina de trigo","unidad":"Kilos","cantidad_compra":"1","precio":"1,50","proveedor":"Molinos Prueba","minimo":"5"},
  {"nombre":"Aceite","unidad":"litros","cantidad_compra":"0,9","precio":"3.20"},{"nombre":"Cerdo molido","unidad":"kg","precio":"6"},
  {"nombre":"Sal","unidad":"bolsa","precio":"1"}]', true) as r \gset
select prueba.ok((:'r'::jsonb ->> 'nuevo')::int = 3 and (:'r'::jsonb ->> 'error')::int = 1, 'al revisar: 3 nuevos y 1 error');
select prueba.ok(:'r'::jsonb -> 'rows' -> 3 ->> 'msg' like 'Unidad no reconocida%', 'dice qué está mal en la fila con error');
select prueba.ok((select count(*) from public.ingredients where name = 'Harina de trigo') = 0, 'revisar no guarda nada');
select public.import_data('insumos', '[{"nombre":"Harina de trigo","unidad":"Kilos","cantidad_compra":"1","precio":"1,50","proveedor":"Molinos Prueba","minimo":"5"},
  {"nombre":"Aceite","unidad":"litros","cantidad_compra":"0,9","precio":"3.20"},{"nombre":"Cerdo molido","unidad":"kg","precio":"6"}]', false) as r \gset
select prueba.ok((select buy_price from public.ingredients where name = 'Harina de trigo') = 1.5 and (select buy_qty from public.ingredients where name = 'Aceite') = 0.9,
  'carga insumos entendiendo «1,50» y «0,9»');
select prueba.ok((select s.name from public.ingredients i join public.suppliers s on s.id = i.supplier_id where i.name = 'Harina de trigo') = 'Molinos Prueba', 'crea el proveedor y lo une al insumo');
select public.import_data('insumos', '[{"nombre":"harina DE trigo","unidad":"kg","precio":"1.80"}]', false) as r \gset
select prueba.ok((:'r'::jsonb ->> 'actualiza')::int = 1 and (select buy_price from public.ingredients where name = 'Harina de trigo') = 1.8, 'el mismo insumo escrito distinto se actualiza, no se duplica');

-- Recetas: un plato con un error no se toca; los demás se cargan
select public.import_data('recetas', '[{"plato":"gyozas","insumo":"Harina de trigo","cantidad":"80","unidad":"gr"},{"plato":"Gyozas","insumo":"Cerdo molido","cantidad":"60","unidad":"g"},
  {"plato":"Pollo Kobayashi","variante":"Peq","insumo":"Aceite","cantidad":"50","unidad":"ml"},{"plato":"Pollo Kobayashi","variante":"Peq","insumo":"Pollo","cantidad":"200","unidad":"g"},
  {"plato":"Plato Fantasma","insumo":"Aceite","cantidad":"1","unidad":"ml"}]', false) as r \gset
select prueba.ok((select count(*) from public.recipe_items ri join public.dishes d on d.id = ri.dish_id where d.name = 'Gyozas') = 2, 'carga la receta de Gyozas (2 ingredientes)');
select prueba.ok((select count(*) from public.recipe_items ri join public.dishes d on d.id = ri.dish_id where d.name = 'Pollo Kobayashi') = 0, 'si falta un insumo, ese plato no se carga a medias');
select prueba.ok(:'r'::jsonb -> 'rows' @> '[{"st":"error","msg":"Línea 4: el insumo «Pollo» no existe (cárgalo primero en Insumos)"}]', 'explica qué insumo falta');
select prueba.ok(:'r'::jsonb -> 'rows' @> '[{"st":"error","msg":"No está en la carta: «Plato Fantasma»"}]', 'avisa si el plato no está en la carta');
select public.import_data('recetas', '[{"plato":"Gyozas","insumo":"Aceite","cantidad":"10","unidad":"g"}]', true) as r \gset
select prueba.ok(:'r'::jsonb -> 'rows' -> 0 ->> 'msg' like '%se compra en l, no se puede medir en g', 'no deja medir un líquido en gramos');

-- Clientes: por cédula o teléfono, sin duplicar
select public.import_data('clientes', '[{"nombre":"Ana Prueba","cedula":"V-12.345.678","telefono":"0414-123.45.67","direccion":"Calle 1"},
  {"nombre":"Ana P.","telefono":"+58 414 1234567"},{"nombre":"Sin datos"}]', false) as r \gset
select prueba.ok((:'r'::jsonb ->> 'nuevo')::int = 1 and (:'r'::jsonb ->> 'actualiza')::int = 1 and (:'r'::jsonb ->> 'error')::int = 1, 'el mismo teléfono escrito distinto es el mismo cliente');

-- Delivery: se reconoce al cliente por el teléfono
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_open_delivery(:caja, '1111', 'Ana', '04141234567', 'Calle 2, casa azul', 2) as d1 \gset
reset role;
select prueba.ok((select c.name from public.pos_orders o join public.customers c on c.id = o.customer_id where o.id = :d1) = 'Ana P.', 'el delivery queda unido al cliente por su teléfono');
select prueba.ok((select address from public.customers where name = 'Ana P.') = 'Calle 2, casa azul', 'guarda la última dirección del cliente');
update public.pos_orders set status = 'cobrada', closed_at = now() where id = :d1;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_customer_by_phone(:caja, '1111', '+58 (414) 123-4567') as f \gset
select prueba.ok(:'f'::jsonb ->> 'name' = 'Ana P.' and (:'f'::jsonb ->> 'orders')::int = 1 and :'f'::jsonb ->> 'address' = 'Calle 2, casa azul', 'la caja ve la ficha: nombre, dirección y pedidos');
select prueba.ok(public.pos_customer_by_phone(:caja, '1111', '0412-0000000') is null, 'un teléfono nuevo no trae ficha');
select prueba.falla(format('select public.pos_customer_by_phone(%s, %L, %L)', :caja, '9999', '04141234567'), 'PIN', 'sin PIN no se ven clientes');

-- Ventas por plato
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
select prueba.ok(jsonb_typeof(public.menu_sales(current_date - 30, current_date)) = 'array', 'Gestión ve las unidades vendidas por plato');
reset role;
\echo 'TODAS LAS PRUEBAS DE CARGA DE DATOS PASARON'
