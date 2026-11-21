-- Indicadores (KPI) de Gestión › Inicio y del resumen del lunes: ventas, costos y margen, servicio y control de un período,
-- contra el período anterior. Todo en una transacción que se deshace al final (no deja datos para las demás pruebas).
\set ON_ERROR_STOP 1
\set QUIET 1
begin;
update public.gestion_settings set iva_pct = 16, fee_debito = 2, fee_credito = 3, fee_pago_movil = 1, service_staff_pct = 15, alert_cash_diff = 5 where id = 1;

-- Semana del lunes 2 al domingo 8 de marzo de 2026, contra la del 23/2 al 1/3
insert into public.daily_sales (sale_date, total, service_amount, by_method, tickets, source) values
  ('2026-03-03', 232, 20, '{"debito": 100, "pago_movil": 50, "efectivo": 82}', 4, 'pos'),
  ('2026-03-04', 116, 10, '{"credito": 100, "efectivo": 16}', 2, 'pos'),
  ('2026-02-24', 174, 15, '{"efectivo": 174}', 3, 'pos')
on conflict (sale_date) do update set total = excluded.total, service_amount = excluded.service_amount, by_method = excluded.by_method, tickets = excluded.tickets;

-- Un plato con receta (116 g de harina a Ref 10 el kg = Ref 1,16 por plato), uno sin receta y uno con tamaños
select c.id as cat from public.categories c order by c.position limit 1 \gset
insert into public.ingredients (name, buy_unit, buy_qty, buy_price, waste_pct) values ('Harina KPI', 'kg', 1, 10, 0) returning id as harina \gset
insert into public.dishes (category_id, name, price) values (:cat, 'Plato KPI', 11.60) returning id as plato \gset
insert into public.dishes (category_id, name, price) values (:cat, 'Plato sin receta KPI', 23.20) returning id as sinreceta \gset
insert into public.dishes (category_id, name, price, variants) values (:cat, 'Plato tamaños KPI', 10, '[{"label": "Peq", "price": 10}, {"label": "Gr", "price": 14}]')
  returning id as tamanos \gset
insert into public.recipe_items (dish_id, variant, ingredient_id, qty, unit) values (:plato, '', :harina, 116, 'g'), (:tamanos, 'Peq', :harina, 50, 'g');
select prueba.ok(public.kpi_costo_unidad(:plato, '') = 1.16, 'el costo de un plato sale de su receta (116 g de harina = Ref 1,16)');
select prueba.ok(public.kpi_costo_unidad(:plato, 'Grande') = 1.16, 'un tamaño sin receta usa la del plato sin tamaño');
select prueba.ok(public.kpi_costo_unidad(:tamanos, 'Gr') = 0.50, 'o la del primer tamaño que tenga receta (como en Gestión)');
select prueba.ok(public.kpi_costo_unidad(:sinreceta, '') is null, 'un plato sin receta no tiene costo (no cuenta como cero)');
insert into public.recipe_items (dish_id, variant, ingredient_id, qty, unit) values (:sinreceta, '', :harina, 10, 'ml');
select prueba.ok(public.kpi_costo_unidad(:sinreceta, '') is null, 'una línea con una unidad que no corresponde deja el plato sin costo');
delete from public.recipe_items where dish_id = :sinreceta;
insert into public.sales_items (sale_date, dish_id, dish_name, variant, qty, amount) values
  ('2026-03-03', :plato, 'Plato KPI', '', 10, 116), ('2026-03-03', :sinreceta, 'Plato sin receta KPI', '', 10, 232);

-- Gastos: uno variable en la semana (los fijos y la nómina son del mes y se reparten por día)
insert into public.expenses (concept, amount, kind, expense_date) values ('Gas KPI', 20, 'variable', '2026-03-05');
insert into public.inventory_movements (ingredient_id, kind, qty, unit, qty_stock, stock_after, cost, delta, created_at)
  values (:harina, 'merma', 0.3, 'kg', -0.3, 0, 3, -0.3, '2026-03-05 12:00-04');

-- Pedidos: una mesa de 50 minutos con descuento y un plato anulado después de ir a cocina, y un para llevar
insert into public.pos_orders (kind, label, status, service_pct, discount, opened_at, closed_at)
  values ('mesa', 'Mesa KPI', 'cobrada', 10, 2, '2026-03-03 12:00-04', '2026-03-03 12:50-04') returning id as mesa \gset
insert into public.pos_orders (kind, label, status, service_pct, opened_at, closed_at)
  values ('llevar', 'Llevar KPI', 'cobrada', 0, '2026-03-04 12:35-04', '2026-03-04 13:00-04') returning id as llevar \gset
insert into public.pos_items (order_id, name, qty, unit_price, status, sent_at, ready_at, voided_at) values
  (:mesa, 'Ramen', 1, 10, 'enviado', '2026-03-03 12:05-04', '2026-03-03 12:17-04', null),
  (:mesa, 'Gyozas', 1, 10, 'enviado', '2026-03-03 12:05-04', '2026-03-03 12:25-04', null),
  (:mesa, 'Té', 1, 6, 'anulado', '2026-03-03 12:05-04', null, '2026-03-03 12:30-04'),
  (:llevar, 'Sushi', 1, 8, 'enviado', '2026-03-04 12:40-04', '2026-03-04 12:48-04', null);
insert into public.pos_orders (kind, label, status, service_pct, opened_at) values ('llevar', 'Otro KPI', 'abierta', 0, '2026-03-04 13:30-04') returning id as otro \gset
insert into public.opiniones (order_id, token, created_at, rating) values   -- una opinión por pedido
  (:mesa, 'kpi-tok-1', '2026-03-03 13:00-04', 5), (:llevar, 'kpi-tok-2', '2026-03-04 13:01-04', 4), (:otro, 'kpi-tok-3', '2026-03-04 13:30-04', null);

-- Un cierre que no cuadra: faltan $ 10 en efectivo y Bs 500 a la tasa del día (50) = Ref 10 → Ref 20
insert into public.pos_rates (rate_date, eur) values ('2026-03-04', 50) on conflict (rate_date) do update set eur = excluded.eur;
insert into public.pos_sessions (opened_at, closed_at, status, expected, counted)
  values ('2026-03-04 11:00-04', '2026-03-04 22:00-04', 'cerrada', '{"efectivo_usd": 100, "efectivo_bs": 5000}', '{"efectivo_usd": 90, "efectivo_bs": 4500, "_inv": {}}')
  returning id as cierre \gset
select prueba.ok(public.kpi_diferencia_caja(:cierre) = -20, 'la diferencia del cierre se pasa a Ref con la tasa de ese día (−$ 10 y −Bs 500 a 50 = −Ref 20)');

select public.kpi_calc('2026-03-02', '2026-03-08') as k \gset
select prueba.ok((:'k'::jsonb -> 'ventas' ->> 'total')::numeric = 348 and (:'k'::jsonb -> 'ventas' ->> 'pedidos')::int = 6
                 and (:'k'::jsonb -> 'ventas' ->> 'ticket')::numeric = 58, 'ventas como en la pestaña Ventas: Ref 348 en 6 pedidos, ticket promedio Ref 58');
select prueba.ok((:'k'::jsonb -> 'ventas' -> 'canales' -> 'mesa' ->> 'ventas')::numeric = 18 and (:'k'::jsonb -> 'ventas' -> 'canales' -> 'llevar' ->> 'pedidos')::int = 1,
                 'por canal: la mesa vendió Ref 18 (20 menos 2 de descuento, sin el anulado) y hubo 1 para llevar');
select prueba.ok((:'k'::jsonb -> 'costos' ->> 'insumos_pct')::numeric = 11.6 and (:'k'::jsonb -> 'costos' ->> 'cobertura_pct')::numeric = 33,
                 '% de insumos sobre lo que tiene receta (11,60 de 100 sin IVA = 11,6 %), con recetas para el 33 % de lo vendido');
select prueba.ok((:'k'::jsonb -> 'costos' ->> 'insumos')::numeric = 34.80, 'los insumos se estiman para todo lo vendido (11,6 % de Ref 300 sin IVA = Ref 34,80)');
select prueba.ok((:'k'::jsonb -> 'costos' ->> 'comisiones')::numeric = 5.50 and (:'k'::jsonb -> 'costos' ->> 'servicio_local')::numeric = 25.50,
                 'comisiones del banco (2 % débito, 3 % crédito, 1 % pago móvil = Ref 5,50) y la parte del servicio que queda al local (85 % de 30)');
select (select coalesce(sum(pay_quincena * 2 + coalesce(monthly_extra, 0)), 0) from public.employees where active) * 7 * 12 / 365 as nomina,
       (select coalesce(sum(amount), 0) from public.expenses where kind = 'fijo') * 7 * 12 / 365 as fijos \gset
select prueba.ok((:'k'::jsonb -> 'costos' ->> 'nomina')::numeric = round(:nomina, 2) and (:'k'::jsonb -> 'costos' ->> 'gastos')::numeric = round(:fijos + 20, 2)
                 and (:'k'::jsonb -> 'costos' ->> 'perdidas')::numeric = 3, 'nómina y gastos fijos del mes repartidos en 7 días, más el gasto variable y la merma de la semana');
select prueba.ok((:'k'::jsonb -> 'costos' ->> 'queda')::numeric = round(300 + 25.50 - 5.50 - 34.80 - :nomina - :fijos - 20 - 3, 2),
                 'lo que queda: ventas sin IVA + servicio del local − comisiones − insumos − nómina − gastos − pérdidas');
select prueba.ok((:'k'::jsonb -> 'servicio' ->> 'cocina_min')::numeric = 13.3 and (:'k'::jsonb -> 'servicio' ->> 'cocina_n')::int = 3,
                 'tiempo de cocina: promedio de 12, 20 y 8 minutos (el anulado no cuenta)');
select prueba.ok((:'k'::jsonb -> 'servicio' ->> 'mesa_min')::numeric = 50, 'tiempo por mesa: de abrir a cobrar, 50 minutos');
select prueba.ok((:'k'::jsonb -> 'servicio' ->> 'calificacion')::numeric = 4.5 and (:'k'::jsonb -> 'servicio' ->> 'calificaron')::int = 2
                 and (:'k'::jsonb -> 'servicio' ->> 'recibos_qr')::int = 3, 'calificación 4,5 de 2 clientes que respondieron, de 3 recibos con QR');
select prueba.ok((:'k'::jsonb -> 'control' ->> 'descuentos')::numeric = 2 and (:'k'::jsonb -> 'control' ->> 'anulados')::int = 1
                 and (:'k'::jsonb -> 'control' ->> 'anulados_monto')::numeric = 6, 'control: Ref 2 de descuento y 1 plato anulado después de ir a cocina (Ref 6)');
select prueba.ok((:'k'::jsonb -> 'control' ->> 'cierres')::int = 1 and (:'k'::jsonb -> 'control' ->> 'cierres_fuera')::int = 1
                 and (:'k'::jsonb -> 'control' ->> 'diferencia')::numeric = -20, 'un cierre que no cuadra por más de Ref 5: faltan Ref 20');
select prueba.ok((public.kpi_semana('2026-03-02') -> 'anterior' -> 'ventas' ->> 'total')::numeric = 174
                 and (public.kpi_semana('2026-03-02') -> 'actual' -> 'ventas' ->> 'total')::numeric = 348, 'el resumen del lunes compara la semana con la anterior');
select prueba.ok((public.kpi_calc('2020-01-06', '2020-01-12') -> 'costos' ->> 'insumos_pct') is null
                 and (public.kpi_calc('2020-01-06', '2020-01-12') -> 'ventas' ->> 'ticket') is null, 'un período sin ventas no inventa porcentajes ni ticket');

-- Permisos: Gestión lo pide con 2FA; las funciones internas no se llaman directo
insert into public.staff (email, role) values ('dueno@prueba.test', 'dueño') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
select prueba.ok((public.gestion_kpis(30) ->> 'dias')::int = 30 and (public.gestion_kpis(7) -> 'actual' ->> 'dias')::int = 7, 'el dueño ve los últimos 7 o 30 días contra los anteriores');
select prueba.falla('select public.kpi_calc(''2026-03-02'', ''2026-03-08'')', 'permission denied', 'el cálculo interno no se llama directo');
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.falla('select public.gestion_kpis(7)', 'Sin permiso', 'una tablet no ve los indicadores');
reset role;
select set_config('request.jwt.claims', '', false);
rollback;
\echo 'TODAS LAS PRUEBAS DE INDICADORES PASARON'
