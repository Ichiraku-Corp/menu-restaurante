-- Prueba automática del recorrido de un día de caja. Si algo se rompe, se detiene con un error claro.
-- Se ejecuta sola en GitHub antes de cada cambio (ver .github/workflows/pruebas.yml).
\set ON_ERROR_STOP 1
\set QUIET 1

create schema if not exists prueba;
create or replace function prueba.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALLÓ: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;
-- Ejecuta un SQL que DEBE fallar con un mensaje que contenga «esperado».
create or replace function prueba.falla(q text, esperado text, msg text) returns void language plpgsql as $$
begin
  begin execute q;
  exception when others then
    if position(lower(esperado) in lower(sqlerrm)) > 0 then raise notice 'ok: %', msg; return; end if;
    raise exception 'FALLÓ: % (error inesperado: %)', msg, sqlerrm;
  end;
  raise exception 'FALLÓ: % (debía dar error y no lo dio)', msg;
end $$;
grant usage on schema prueba to anon, authenticated;
grant execute on all functions in schema prueba to anon, authenticated;

-- ---------------------------------------------------------------- Datos de prueba
insert into public.staff (email, role) values ('tablet@prueba.test', 'sala'), ('puente@prueba.test', 'impresora') on conflict do nothing;
insert into public.gestion_settings (id) values (1) on conflict do nothing;
update public.gestion_settings set report_emails = 'cierre@prueba.test', service_pct = 10;
insert into public.employees (name, job_title, pos_can_charge) values ('Cajera Prueba', 'Caja', true), ('Mesera Prueba', 'Mesera', false);
insert into public.pos_rates (rate_date, eur, source) values ((now() at time zone 'America/Caracas')::date, 100, 'prueba')
  on conflict (rate_date) do update set eur = 100;
select (select id from public.employees where name = 'Cajera Prueba') caja, (select id from public.employees where name = 'Mesera Prueba') mesera,
       (select id from public.pos_tables where active order by id limit 1) mesa \gset
-- Un plato sencillo de Ref 10 (sin tamaños)
update public.dishes set price = 10, available = true, variants = '[]'::jsonb where id = (select min(id) from public.dishes) returning id as plato \gset

select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select public.pos_set_pin(:caja, '1111'), public.pos_set_pin(:mesera, '2222');

-- ---------------------------------------------------------------- Accesos
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select prueba.falla('select count(*) from public.pos_orders', 'permission denied', 'el público no puede leer pedidos');
select prueba.falla('select public.pos_state()', 'permission denied', 'el público no puede ver el estado de caja');
select prueba.ok((select count(*) from public.dishes) > 0, 'el público sí ve el menú');
reset role;

set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"puente@prueba.test"}', false);
select prueba.falla('select public.pos_state()', 'no está autorizado', 'el puente no ve el estado de caja');
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.falla('select count(*) from public.pos_kv', 'permission denied', 'la tablet no lee tablas internas');
select prueba.falla('select public.pos_totals(1)', 'permission denied', 'la tablet no llama ayudantes internos');
select prueba.ok((select count(*) from public.pos_orders) = 0, 'la tablet no lee pedidos directo (solo por funciones)');

-- ---------------------------------------------------------------- Abrir caja
select prueba.falla(format('select public.pos_cash_open(%s, %L, 50, 0)', :mesera, '2222'), 'permiso para cobrar', 'la mesera no puede abrir caja');
select prueba.falla(format('select public.pos_cash_open(%s, %L, 50, 0)', :caja, '9999'), 'PIN', 'PIN equivocado no entra');
select public.pos_cash_open(:caja, '1111', 50, 0) is not null as abierta \gset
select prueba.ok(:'abierta'::boolean, 'la cajera abre la caja con fondo de $50');

-- ---------------------------------------------------------------- Pedido 1: mesa, 2 platos, efectivo con vuelto
select public.pos_open(:mesera, '2222', :mesa) as o1 \gset
select public.pos_add(:mesera, '2222', :o1, jsonb_build_array(jsonb_build_object('dish_id', :plato, 'qty', 2)));
select prueba.falla(format('select public.pos_pay(%s, %L, %s, %L)', :caja, '1111', :o1, '[{"method":"efectivo_usd","amount":30}]'), 'sin enviar', 'no se cobra con platos sin enviar a cocina');
select public.pos_send(:mesera, '2222', :o1);
select prueba.ok((public.pos_order(:o1) -> 'totals' ->> 'total')::numeric = 22, 'mesa: 2 x 10 + 10 % de servicio = Ref 22');
select prueba.falla(format('select public.pos_pay(%s, %L, %s, %L)', :mesera, '2222', :o1, '[{"method":"efectivo_usd","amount":30}]'), 'permiso para cobrar', 'la mesera no puede cobrar');
select prueba.falla(format('select public.pos_pay(%s, %L, %s, %L)', :caja, '1111', :o1, '[{"method":"efectivo_usd","amount":5}]'), 'Falta por cobrar', 'no se cierra una cuenta incompleta');
select public.pos_pay(:caja, '1111', :o1, '[{"method":"efectivo_usd","amount":30,"device":"Caja"}]');
select prueba.ok((public.pos_order(:o1) ->> 'status') = 'cobrada', 'la mesa queda cobrada');

-- ---------------------------------------------------------------- Pedido 2: para llevar, pago móvil en bolívares
select public.pos_open(:mesera, '2222', null, 'Cliente') as o2 \gset
select public.pos_add(:mesera, '2222', :o2, jsonb_build_array(jsonb_build_object('dish_id', :plato, 'qty', 1)));
select public.pos_send(:mesera, '2222', :o2);
select public.pos_pay(:caja, '1111', :o2, '[{"method":"pago_movil","amount":1000,"device":"Caja"}]');
select prueba.ok((public.pos_order(:o2) ->> 'status') = 'cobrada', 'para llevar cobrado con Bs 1.000 (Ref 10 a tasa 100)');

-- ---------------------------------------------------------------- Pedido Yummy (no se le paga a la empresa de delivery)
select public.pos_open_delivery(:mesera, '2222', 'Cliente Yummy', '', '', 0, 'yummy') as oy \gset
select prueba.ok((public.pos_order(:oy) ->> 'channel') = 'yummy', 'el pedido de Yummy queda marcado como Yummy');
select public.pos_add(:mesera, '2222', :oy, jsonb_build_array(jsonb_build_object('dish_id', :plato, 'qty', 1)));
select public.pos_send(:mesera, '2222', :oy);
select public.pos_pay(:caja, '1111', :oy, '[{"method":"pago_movil","amount":1000,"device":"Caja"}]');

-- ---------------------------------------------------------------- Pedido 3: anulación con motivo; mesa vacía se borra
select public.pos_open(:mesera, '2222', null, 'Se arrepintió') as o3 \gset
select public.pos_add(:mesera, '2222', :o3, jsonb_build_array(jsonb_build_object('dish_id', :plato, 'qty', 1)));
select public.pos_send(:mesera, '2222', :o3);
select prueba.falla(format('select public.pos_cancel(%s, %L, %s, %L)', :caja, '1111', :o3, ''), 'motivo', 'anular lo enviado a cocina pide motivo');
select public.pos_cancel(:caja, '1111', :o3, 'Cliente se fue');
select public.pos_open(:mesera, '2222', null, 'Vacía') as o4 \gset
select prueba.ok(public.pos_drop_empty(:mesera, '2222', :o4), 'una mesa abierta sin platos se borra sola');

-- ---------------------------------------------------------------- Salida de caja y cierre
select prueba.falla(format('select public.pos_cash_out(%s, %L, %L, 10, %L)', :caja, '1111', 'efectivo_usd', ''), 'motivo', 'la salida de caja pide motivo');
select public.pos_cash_out(:caja, '1111', 'efectivo_usd', 10, 'Pago delivery semanal');
select (public.pos_cash_summary() -> 'methods' -> 'efectivo_usd' ->> 'amount')::numeric as efe \gset
select prueba.ok(:efe + 50 = 62, format('efectivo esperado: 50 de fondo + 22 cobrados - 10 de salida = 62 (dio %s)', :efe + 50));
select public.pos_cash_close(:caja, '1111', '{"efectivo_usd":62,"pago_movil":2000}'::jsonb, '');
reset role;
select prueba.ok((select status from public.pos_sessions order by id desc limit 1) = 'cerrada', 'la caja queda cerrada');
select prueba.ok((select (data -> 'totals' ->> 'total')::numeric from public.pos_reports order by id desc limit 1) = 42, 'el correo de cierre queda en cola con Ref 42 vendidos');
select prueba.ok((select count(*) from public.pos_orders where status = 'abierta') = 0, 'no quedan mesas abiertas');
select prueba.ok((public.pos_week_report(date_trunc('week', now() at time zone 'America/Caracas')::date) -> 'totals' ->> 'orders')::int = 3,
                 'el resumen semanal cuenta los 3 pedidos cobrados');
select prueba.ok((public.pos_week_report(date_trunc('week', now() at time zone 'America/Caracas')::date) -> 'delivery' ->> 'orders')::int = 0,
                 'Yummy no suma a lo que se le paga a la empresa de delivery');
select prueba.ok(jsonb_array_length(public.pos_week_report(date_trunc('week', now() at time zone 'America/Caracas')::date) -> 'outs') = 1,
                 'el resumen semanal muestra la salida de caja');
\echo 'TODAS LAS PRUEBAS DE CAJA PASARON'
