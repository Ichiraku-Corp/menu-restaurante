-- Correos del cierre: el servidor aparta cada reporte para que la laptop no mande el mismo; la laptop respalda.
-- Mientras el servidor no esté enviando (por ejemplo, sin las claves del correo), la laptop envía al momento.
\set ON_ERROR_STOP 1
\set QUIET 1
insert into public.pos_reports (recipients, data) values ('dueno@prueba.test', '{"kind":"cierre"}') returning id as r1 \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"puente@prueba.test"}', false);
select prueba.ok((select count(*) from public.pos_report_next(600) where id = :r1) = 1, 'mientras el servidor no envíe, la laptop envía el cierre al momento (no espera 10 minutos)');
select public.pos_report_done(:r1, true);
reset role;
select prueba.ok((select status = 'enviado' and sent_by = 'laptop' from public.pos_reports where id = :r1), 'queda anotado que lo envió la laptop');
-- El servidor empieza a enviar (ya tiene las claves): desde ahí la laptop le deja los recién hechos
insert into public.pos_reports (recipients, data) values ('dueno@prueba.test', '{"kind":"cierre"}') returning id as r2 \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select prueba.ok((select count(*) from public.pos_report_next(0) where id = :r2) = 1, 'el servidor lo aparta para enviarlo');
select prueba.ok((select count(*) from public.pos_report_next(0) where id = :r2) = 0, 'apartado: nadie más lo envía a la vez');
select public.pos_report_done(:r2, true);
reset role;
select prueba.ok((select status = 'enviado' and claimed_at is null and sent_by = 'servidor' from public.pos_reports where id = :r2), 'queda marcado como enviado por el servidor');
insert into public.pos_reports (recipients, data) values ('dueno@prueba.test', '{"kind":"cierre"}') returning id as rid \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"puente@prueba.test"}', false);
select prueba.ok((select count(*) from public.pos_report_next(600) where id = :rid) = 0, 'con el servidor enviando, la laptop no toma un cierre recién hecho');
reset role;
update public.pos_reports set claimed_at = now() - interval '10 minutes', created_at = now() - interval '20 minutes' where id = :rid;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"puente@prueba.test"}', false);
select prueba.ok((select count(*) from public.pos_report_next(600) where id = :rid) = 1, 'si el servidor no pudo en 10 minutos, la laptop lo envía');
select public.pos_report_done(:rid, true);
reset role;
insert into public.pos_reports (recipients, data) values ('dueno@prueba.test', '{"kind":"cierre"}') returning id as r4 \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"puente@prueba.test"}', false);
select prueba.ok((select count(*) from public.pos_report_next(600) where id = :r4) = 1, 'si el último lo tuvo que enviar la laptop, el siguiente lo envía al momento');
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.falla('select public.pos_report_next(0)', 'Sin permiso', 'una tablet no puede tomar correos');
reset role;
select set_config('request.jwt.claims', '', false);
\echo 'TODAS LAS PRUEBAS DE CORREO PASARON'
