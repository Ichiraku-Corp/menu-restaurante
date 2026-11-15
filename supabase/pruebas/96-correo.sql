-- Correos del cierre: el servidor aparta cada reporte para que la laptop no mande el mismo; la laptop solo respalda
\set ON_ERROR_STOP 1
\set QUIET 1
insert into public.pos_reports (recipients, data) values ('dueno@prueba.test', '{"kind":"cierre"}') returning id as rid \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"puente@prueba.test"}', false);
select prueba.ok((select count(*) from public.pos_report_next(600) where id = :rid) = 0, 'la laptop no toma un cierre recién hecho (lo envía el servidor)');
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select prueba.ok((select count(*) from public.pos_report_next(0) where id = :rid) = 1, 'el servidor lo aparta para enviarlo');
select prueba.ok((select count(*) from public.pos_report_next(0) where id = :rid) = 0, 'apartado: nadie más lo envía a la vez');
select public.pos_report_done(:rid, true);
reset role;
select prueba.ok((select status = 'enviado' and claimed_at is null from public.pos_reports where id = :rid), 'queda marcado como enviado');
update public.pos_reports set status = 'pendiente', claimed_at = now() - interval '10 minutes', created_at = now() - interval '20 minutes' where id = :rid;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"puente@prueba.test"}', false);
select prueba.ok((select count(*) from public.pos_report_next(600) where id = :rid) = 1, 'si el servidor no pudo en 10 minutos, la laptop lo envía');
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.falla('select public.pos_report_next(0)', 'Sin permiso', 'una tablet no puede tomar correos');
reset role;
select set_config('request.jwt.claims', '', false);
\echo 'TODAS LAS PRUEBAS DE CORREO PASARON'
