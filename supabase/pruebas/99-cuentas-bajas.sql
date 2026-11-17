-- Gestión › Servicio › Cuentas del personal: quien ya no trabaja aquí (inactivo) solo aparece mientras deba algo
\set ON_ERROR_STOP 1
\set QUIET 1
insert into public.staff (email, role) values ('dueno@prueba.test', 'dueño') on conflict do nothing;
insert into public.employees (name, job_title, active) values ('Baja Sin Deuda', 'Mesonera', false), ('Baja Con Deuda', 'Mesonera', false) on conflict do nothing;
select (select id from public.employees where name = 'Baja Sin Deuda') sin, (select id from public.employees where name = 'Baja Con Deuda') con \gset
insert into public.pos_tab_moves (employee_id, kind, amount_ref, note, created_by)
values (:sin, 'saldo_inicial', 12.5, 'prueba', 'prueba'), (:sin, 'descuento_bono', -12.5, 'prueba', 'prueba'), (:con, 'consumo', 14, 'prueba', 'prueba');
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
select public.svc_tabs() as t \gset
reset role;
select set_config('request.jwt.claims', '', false);
select prueba.ok(not exists (select 1 from jsonb_array_elements(:'t'::jsonb) x where (x ->> 'id')::bigint = :sin),
  'quien ya no trabaja aquí y no debe nada no aparece en las cuentas del personal');
select prueba.ok(exists (select 1 from jsonb_array_elements(:'t'::jsonb) x where (x ->> 'id')::bigint = :con and (x ->> 'balance')::numeric = 14),
  'quien ya no trabaja aquí pero todavía debe sigue apareciendo, con lo que debe');
-- Un mes nuevo de servicio no incluye a quien ya no trabaja aquí, aunque deba (su deuda queda en su cuenta)
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
select public.svc_month('2030-01-01') as mes \gset
reset role;
select set_config('request.jwt.claims', '', false);
select prueba.ok(not exists (select 1 from public.svc_lines where month = '2030-01-01' and employee_id in (:sin, :con))
                 and exists (select 1 from public.svc_lines l join public.employees e on e.id = l.employee_id where l.month = '2030-01-01' and e.active),
  'un mes nuevo de servicio trae solo al personal activo (quien se fue debiendo no entra)');
select prueba.ok(public.pos_tab_balance(:con) = 14, 'y su deuda sigue en su cuenta, sin pasarse a una nómina');
delete from public.svc_months where month = '2030-01-01';
\echo 'TODAS LAS PRUEBAS DE CUENTAS DE BAJAS PASARON'
