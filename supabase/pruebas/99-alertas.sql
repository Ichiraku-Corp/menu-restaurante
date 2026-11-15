-- Alertas al correo del dueño: cierre que no cuadra, anulados después de cocina, descuentos grandes, laptop sin conexión
\set ON_ERROR_STOP 1
\set QUIET 1
select prueba.ok((select alert_cash_diff from public.gestion_settings limit 1) = 5, 'si no se cambia, avisa de cierres que no cuadran por más de Ref 5');
update public.gestion_settings set alert_emails = 'alertas@prueba.test';
delete from public.pos_reports where data ->> 'kind' = 'alerta';
select (select id from public.employees where name = 'Cajera Prueba') caja, (select id from public.employees where name = 'Mesera Prueba') mesera,
       (select id from public.dishes where jsonb_array_length(coalesce(variants, '[]'::jsonb)) = 0 and available order by id limit 1) plato,
       not exists (select 1 from public.pos_sessions where status = 'abierta') hay_que_abrir \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
\if :hay_que_abrir
select public.pos_cash_open(:caja, '1111', 0, 0);
\endif
-- Un plato caro anulado después de ir a cocina
select public.pos_open(:mesera, '2222', null, 'Alerta') as o \gset
select public.pos_add(:mesera, '2222', :o, jsonb_build_array(jsonb_build_object('dish_id', :plato, 'qty', 3)));
select public.pos_send(:mesera, '2222', :o);
reset role;
select id as item, round(qty * unit_price, 2) as monto from public.pos_items where order_id = :o order by id desc limit 1 \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_void(:mesera, '2222', :item, 'Cliente se arrepintió');
-- Un descuento grande
select public.pos_add(:mesera, '2222', :o, jsonb_build_array(jsonb_build_object('dish_id', :plato, 'qty', 4)));
select public.pos_discount(:caja, '1111', :o, 18, 'Amigo de la casa');
reset role;
select prueba.ok(:monto >= 20 and exists (select 1 from public.pos_reports where data ->> 'clave' = 'anulado-' || :item and recipients = 'alertas@prueba.test'
                                         and data ->> 'titulo' like 'Se anuló un plato que ya estaba en cocina%' and data -> 'lineas' ->> 1 = 'Motivo: Cliente se arrepintió'),
  'anular un plato caro que ya estaba en cocina avisa al correo de alertas, con el motivo');
select prueba.ok(exists (select 1 from public.pos_reports where data ->> 'clave' like 'descuento-' || :o || '-%' and data ->> 'titulo' like 'Descuento grande: Ref 18%'
                         and data -> 'lineas' ->> 1 = 'Motivo: Amigo de la casa'), 'un descuento grande avisa con el monto y el motivo');
-- El tercer plato anulado del día después de cocina avisa con la lista
select count(*) as ya from public.pos_items where status = 'anulado' and sent_at is not null and (voided_at at time zone 'America/Caracas')::date = (now() at time zone 'America/Caracas')::date \gset
select :ya < 3 as faltan \gset
\if :faltan
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_add(:mesera, '2222', :o, jsonb_build_array(jsonb_build_object('dish_id', :plato, 'qty', 1))) from generate_series(1, 3 - :ya);
select public.pos_send(:mesera, '2222', :o);
reset role;
select string_agg(id::text, ',') as nuevos from (select id from public.pos_items where order_id = :o and status = 'enviado' and qty = 1 order by id desc limit 3 - :ya) x \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_void(:mesera, '2222', x::bigint, 'Error de la mesera') from unnest(string_to_array(:'nuevos', ',')) x;
reset role;
select prueba.ok(exists (select 1 from public.pos_reports where data ->> 'clave' = 'anulados-' || (now() at time zone 'America/Caracas')::date
                         and jsonb_array_length(data -> 'lineas') = 3), 'al tercer plato anulado del día después de cocina, avisa con la lista');
\else
select prueba.ok(true, 'al tercer plato anulado del día después de cocina, avisa con la lista (ya había 3 hoy)');
\endif
-- Laptop sin conexión con la caja abierta: avisa una sola vez
insert into public.pos_kv (key, value) values ('bridge_seen', '{}'::jsonb) on conflict (key) do nothing;
update public.pos_kv set updated_at = now() - interval '20 minutes' where key = 'bridge_seen';
select public.pos_alertas_revisar(); select public.pos_alertas_revisar();
select prueba.ok((select count(*) from public.pos_reports where data ->> 'clave' like 'laptop-%') = 1, 'si la laptop no se conecta con la caja abierta, avisa (una sola vez)');
update public.pos_kv set updated_at = now() where key = 'bridge_seen';
-- Cierre que no cuadra: se cierra una caja con Ref 25 de menos en efectivo
update public.pos_sessions set status = 'cerrada', closed_at = now() where status = 'abierta';
insert into public.pos_sessions (opened_by, status) values (:caja, 'abierta') returning id as ses \gset
update public.pos_sessions set status = 'cerrada', closed_at = now(), closed_by = :caja, notes = '',
       expected = '{"efectivo_usd": 100, "zelle": 20}'::jsonb, counted = '{"efectivo_usd": 75, "zelle": 20, "_inv": []}'::jsonb where id = :ses;
select prueba.ok(exists (select 1 from public.pos_reports where data ->> 'clave' = 'cierre-' || :ses and data ->> 'titulo' = 'El cierre de caja no cuadra: faltan Ref 25,00'
                         and data -> 'lineas' ->> 1 = 'Diferencia por método: Efectivo $: falta $ 25,00' and data -> 'lineas' ->> 2 = 'Nota del cierre: (sin nota)'),
  'un cierre que no cuadra por más de Ref 5 avisa con la diferencia por método y la nota');
insert into public.pos_sessions (opened_by, status) values (:caja, 'abierta') returning id as ses2 \gset
update public.pos_sessions set status = 'cerrada', closed_at = now(), closed_by = :caja,
       expected = '{"efectivo_usd": 100}'::jsonb, counted = '{"efectivo_usd": 95}'::jsonb where id = :ses2;
select prueba.ok(not exists (select 1 from public.pos_reports where data ->> 'clave' = 'cierre-' || :ses2), 'una diferencia de Ref 5 o menos no avisa');
select prueba.ok(not has_function_privilege('anon', 'public.alerta_cierre()', 'execute') and not has_function_privilege('authenticated', 'public.alerta_descuento()', 'execute'),
  'nadie de afuera puede llamar las funciones internas de las alertas');
-- La caja queda abierta para las pruebas que siguen
insert into public.pos_sessions (opened_by, status) values (:caja, 'abierta');
update public.gestion_settings set alert_emails = '';
select set_config('request.jwt.claims', '', false);
\echo 'TODAS LAS PRUEBAS DE ALERTAS PASARON'
