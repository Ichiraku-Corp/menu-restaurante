-- Gestión → Inicio: lo del día solo para dueño/admin con 2FA
\set ON_ERROR_STOP 1
\set QUIET 1
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
select public.gestion_inicio() as r \gset
select prueba.ok((:'r'::jsonb ? 'ventas') and (:'r'::jsonb ? 'ventas_semana_pasada') and (:'r'::jsonb ? 'ultimo_cierre') and jsonb_typeof(:'r'::jsonb -> 'top_hoy') = 'array',
  'Inicio trae ventas de hoy, la semana pasada, el último cierre y lo más pedido');
select prueba.ok((:'r'::jsonb ->> 'pedidos')::int >= 1, 'cuenta los pedidos cobrados hoy');
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.falla('select public.gestion_inicio()', 'Sin permiso', 'una tablet no ve el Inicio de Gestión');
reset role;
select set_config('request.jwt.claims', '', false);
\echo 'TODAS LAS PRUEBAS DE INICIO PASARON'
