-- Gestión → Ventas por hora y día: promedios por día de la semana y hora, solo para dueño/admin con 2FA
\set ON_ERROR_STOP 1
\set QUIET 1
-- Hoy es un día a medias y no cuenta: las ventas de prueba pasan a ayer
update public.pos_orders set opened_at = opened_at - interval '1 day', closed_at = closed_at - interval '1 day' where status = 'cobrada';
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
select public.gestion_ventas_hora(8) as r \gset
select prueba.ok((:'r'::jsonb ->> 'hasta')::date = (now() at time zone 'America/Caracas')::date - 1, 'cuenta hasta ayer (hoy va a medias)');
select prueba.ok(jsonb_array_length(:'r'::jsonb -> 'celdas') >= 1 and (:'r'::jsonb ->> 'semanas')::int = 8, 'trae las celdas de día y hora de las últimas 8 semanas');
select prueba.ok(not exists (select 1 from jsonb_array_elements(:'r'::jsonb -> 'celdas') c
                             where (c ->> 'dow')::int not between 1 and 7 or (c ->> 'hora')::int not between 0 and 23), 'cada celda tiene día (1 a 7) y hora (0 a 23)');
reset role;
-- Promedio × días con ventas = lo vendido en ese día de la semana (sin el servicio, como Ventas, Inicio y la meta)
select prueba.ok(abs(
  (select sum((c ->> 'ventas')::numeric * (:'r'::jsonb -> 'dias' ->> (c ->> 'dow'))::int) from jsonb_array_elements(:'r'::jsonb -> 'celdas') c)
  - (select coalesce(sum(tt.subtotal - tt.discount + tt.delivery), 0) from public.pos_orders o cross join lateral public.pos_totals(o.id) tt
     where o.status = 'cobrada' and (o.opened_at at time zone 'America/Caracas')::date between (now() at time zone 'America/Caracas')::date - 56
                                                                                          and (now() at time zone 'America/Caracas')::date - 1)) < 0.1,
  'los promedios cuadran con lo vendido (sin el servicio)');
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.falla('select public.gestion_ventas_hora(8)', 'Sin permiso', 'una tablet no ve las ventas por hora');
reset role;
select set_config('request.jwt.claims', '', false);
\echo 'TODAS LAS PRUEBAS DE REPORTES PASARON'
