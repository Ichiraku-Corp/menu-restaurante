-- Indicador de la tablet: la laptop deja su latido al buscar tickets y la tablet lo ve en pos_state
\set ON_ERROR_STOP 1
\set QUIET 1
delete from public.pos_kv where key = 'bridge_seen';
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"puente@prueba.test"}', false);
select count(*) from public.pos_print_next(5);
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.ok((public.pos_state() ->> 'bridge_seen')::timestamptz > now() - interval '1 minute', 'la tablet ve que la laptop se conectó hace un momento');
select prueba.ok((public.pos_state() ? 'printer_error'), 'la tablet sabe si la impresora dio error');
reset role;
select set_config('request.jwt.claims', '', false);
-- La carta pública (sin sesión) lee solo la tasa del día para mostrar los precios en bolívares
set role anon;
select prueba.ok((public.menu_tasa() ->> 'rate')::numeric > 0, 'la carta pública ve la tasa del día');
select prueba.ok((select array_agg(k order by k) from jsonb_object_keys(public.menu_tasa()) k) = array['date', 'rate'], 'la carta solo ve la tasa y su fecha');
reset role;
\echo 'TODAS LAS PRUEBAS DEL INDICADOR PASARON'
