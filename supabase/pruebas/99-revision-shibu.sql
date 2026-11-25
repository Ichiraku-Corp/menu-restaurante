-- Revisión completa antes de publicar Shibu (25/11): lo que la auditoría encontró y se arregló. El freno de PIN cuenta
-- los intentos en todas las funciones de la tablet, lo que el cierre no alcanzó a revisar lo termina la tablet, los
-- premios en Ref 0 no cuentan como pedidos en los reportes y Gestión no deja guardar ajustes que tumben a Shibu.
-- Todo en una transacción que se deshace al final.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;
insert into public.employees (name, job_title, pos_can_charge, pos_pin_hash) values
  ('Kai Revisión', 'Maid', false, extensions.crypt('8201', extensions.gen_salt('bf')));
select (select id from public.employees where name = 'Kai Revisión') kai, public.mis_hoy() hoy \gset
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false) \gset x_

-- 1) Llamada sola, una función «stable» corre en solo lectura y el freno de PIN no anota el intento: las que piden PIN
--    y la tablet puede llamar escriben. (wa_inbox y wa_pending son de WhatsApp: se le avisó a Edgar.)
select prueba.ok(not exists (
  select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.provolatile <> 'v'
    and (p.prosrc ~ 'pos_auth(_charge)?\(' or p.proname in ('pos_auth', 'pos_auth_charge'))
    and p.proname not in ('wa_inbox', 'wa_pending')
    and has_function_privilege('authenticated', p.oid, 'execute')),
  'todas las funciones de la tablet que piden PIN escriben: el freno cuenta cada PIN equivocado');

-- 2) Las misiones del final del día que el cierre no alcanzó a revisar las termina la tablet de la maid
insert into public.mis_pendientes (employee_id, fecha) values (:kai, :'hoy'::date - 1);
set role authenticated;
select public.mis_estado(:kai, '8201') as e1 \gset
reset role;
select prueba.ok((:'e1'::jsonb ->> 'juega')::boolean and not exists (select 1 from public.mis_pendientes where employee_id = :kai),
  'lo que el cierre de caja dejó pendiente lo revisa la tablet de la maid y queda hecho');
select prueba.ok(public.mis_candado('mis_revisar', :kai) and has_table_privilege('authenticated', 'public.mis_pendientes', 'select') = false
  and has_table_privilege('anon', 'public.com_compras', 'select') = false and has_table_privilege('authenticated', 'public.mis_puntos', 'insert') = false,
  'las tablas de Shibu no se tocan directo desde afuera (solo por las funciones)');

-- 3) Un premio de misiones (pedido en Ref 0) no cuenta como pedido en la meta, el ranking ni el resumen semanal
select (public.meta_dia(:'hoy') ->> 'pedidos')::int as meta_antes,
       coalesce((select sum((r ->> 'orders')::int) from jsonb_array_elements(public.pos_ranking(:'hoy', :'hoy')) r), 0) as rank_antes,
       (public.pos_week_report(:'hoy') -> 'totals' ->> 'orders')::int as semana_antes \gset
with o as (insert into public.pos_orders (kind, label, status, opened_by, opened_at, closed_by, closed_at, premio)
           values ('llevar', 'Premio: Kai', 'cobrada', :kai, now(), :kai, now(), true) returning id)
insert into public.pos_items (order_id, dish_id, name, qty, unit_price, status, created_by, sent_at)
select o.id, d.id, d.name, 1, 0, 'enviado', :kai, now() from o, (select id, name from public.dishes order by id limit 1) d;
select prueba.ok((public.meta_dia(:'hoy') ->> 'pedidos')::int = :meta_antes
  and coalesce((select sum((r ->> 'orders')::int) from jsonb_array_elements(public.pos_ranking(:'hoy', :'hoy')) r), 0) = :rank_antes
  and (public.pos_week_report(:'hoy') -> 'totals' ->> 'orders')::int = :semana_antes,
  'un premio en Ref 0 no suma pedidos en la meta del día, en «Mejores vendedores» ni en el resumen semanal');

-- 4) Gestión no deja guardar ajustes que tumbarían a Shibu en todas las tablets
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false) \gset x_
select prueba.falla($q$select public.gestion_misiones_ajustes('{"mejoras": {"canje": "cuatro"}}')$q$, 'niveles de las mejoras',
  'un texto donde va el nivel de una mejora no se guarda');
select prueba.falla($q$select public.gestion_misiones_ajustes('{"comodines": {"activos": 2, "semana": 3, "uno_semana": 5}}')$q$, 'uno por semana',
  '«uno por semana» tiene que ser una lista');
select prueba.ok((public.gestion_misiones_ajustes('{"comodines": {"activos": 2, "semana": 3}}') -> 'comodines' ->> 'activos')::int = 2,
  'unos comodines a medias (sin la lista) sí se guardan: lo que falta toma lo de siempre');
select prueba.falla(format('select public.gestion_mision_guardar(%s, null, null, null, null, %L::jsonb)',
  (select id from public.mis_catalogo order by id limit 1), '{"n": "tres"}'), 'los números van como números',
  'en una misión, un número escrito como texto no se guarda');
-- 5) Tercer revisor: Gestión tampoco guarda «activo» ni «juegos» que no sean sí o no, ni datos de misión con otro tipo
select prueba.falla($q$select public.gestion_misiones_ajustes('{"activo": "garbage"}')$q$, '«activo» y «juegos»',
  '«activo» escrito como texto no se guarda (dejaría a todas las maids sin Shibu)');
select prueba.falla($q$select public.gestion_misiones_ajustes('{"juegos": "nope"}')$q$, '«activo» y «juegos»',
  '«juegos» escrito como texto no se guarda');
select prueba.falla(format('select public.gestion_mision_guardar(%s, null, null, null, null, %L::jsonb)',
  (select id from public.mis_catalogo order by id limit 1), '{"n": 1, "monto": 40, "hasta": "3pm"}'), 'los números van como números',
  'una hora escrita como texto («3pm») no se guarda');
select prueba.falla(format('select public.gestion_mision_guardar(%s, null, null, null, null, %L::jsonb)',
  (select id from public.mis_catalogo order by id limit 1), '{"desde": 14.5}'), 'sin decimales',
  'una hora con decimales no se guarda');
select prueba.falla(format('select public.gestion_mision_guardar(%s, null, null, null, null, %L::jsonb)',
  (select id from public.mis_catalogo order by id limit 1), '{"sorpresa": "si"}'), 'true o false',
  'un sí o no escrito como texto no se guarda');
select public.gestion_mision_guardar((select id from public.mis_catalogo order by id limit 1), null, null, null, null,
  '{"n": 2, "monto": 12.5, "desde": 14, "semana": false, "nombres": ["Gyozas"]}'::jsonb);
select prueba.ok(true, 'una misión con sus datos bien escritos sí se guarda');

-- 6) Una misión mal escrita directo en la base (sin pasar por Gestión) sale sin avance: no tumba la pantalla de la maid
--    ni le quita las otras misiones
select min(slot) as sa, max(slot) as sb from (select slot from public.com_misiones(:kai, :'hoy') where slot < 10 order by slot limit 2) x \gset
update public.mis_dia set params = params || '{"n": "abc"}' where fecha = :'hoy' and grupo = public.mis_grupo(:kai) and nivel = :sa;
update public.mis_dia set tipo = 'atendidas', params = '{"n": 0}' where fecha = :'hoy' and grupo = public.mis_grupo(:kai) and nivel = :sb;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false) \gset x_
set role authenticated;
select public.mis_estado(:kai, '8201') as e2 \gset
reset role;
select prueba.ok((:'e2'::jsonb ->> 'juega')::boolean
  and exists (select 1 from jsonb_array_elements(:'e2'::jsonb -> 'misiones') m where (m ->> 'slot')::int = :sa and (m ->> 'actual')::numeric = 0)
  and exists (select 1 from public.mis_logros where employee_id = :kai and fecha = :'hoy' and nivel = :sb),
  'una misión mal escrita sale sin avance y la maid igual ve y cumple las demás');

-- 7) Si la revisión de una maid falla en el cobro o en el cierre, las demás igual quedan revisadas y la suya queda
--    pendiente para su tablet (se cambia mis_revisar por una que falla solo con Kai; todo se deshace al final)
insert into public.employees (name, job_title, pos_can_charge, pos_pin_hash) values
  ('Rin Revisión', 'Maid', true, extensions.crypt('8202', extensions.gen_salt('bf')));
select id as rin from public.employees where name = 'Rin Revisión' \gset
create temp table revisadas (emp bigint);
create or replace function public.mis_revisar(p_emp bigint, p_fecha date, p_cierre boolean default false) returns int
language plpgsql as $f$
begin
  insert into pg_temp.revisadas values (p_emp);
  if (select name from public.employees where id = p_emp) = 'Kai Revisión' then raise exception 'falla a propósito'; end if;
  return 0;
end $f$;
insert into public.pos_orders (kind, label, status, opened_by, opened_at) values ('llevar', 'Prueba del revisor', 'abierta', :kai, now())
returning id as ord \gset
insert into public.pos_items (order_id, dish_id, name, qty, unit_price, status, created_by, sent_at)
select :ord, d.id, d.name, 1, 5, 'enviado', :kai, now() from (select id, name from public.dishes order by id limit 1) d;
update public.pos_orders set status = 'cobrada', closed_by = :rin, closed_at = now() where id = :ord;
select prueba.ok(exists (select 1 from pg_temp.revisadas where emp = :rin),
  'si la revisión de una maid falla al cobrar, la otra que tocó el pedido igual queda revisada');
update public.pos_sessions set status = 'cerrada', closed_at = now() where status = 'abierta';
delete from pg_temp.revisadas;
delete from public.mis_pendientes where fecha = :'hoy';
insert into public.pos_sessions (opened_by, status) values (:rin, 'abierta') returning id as ses \gset
update public.pos_sessions set status = 'cerrada', closed_at = now(), closed_by = :rin, notes = '' where id = :ses;
select prueba.ok(exists (select 1 from public.mis_pendientes where employee_id = :kai and fecha = :'hoy')
  and exists (select 1 from pg_temp.revisadas where emp = :rin)
  and not exists (select 1 from public.mis_pendientes where employee_id = :rin and fecha = :'hoy'),
  'si falla la de una maid al cerrar la caja, las demás igual quedan revisadas y la suya queda pendiente para su tablet');
rollback;
\echo 'TODAS LAS PRUEBAS DE LA REVISIÓN DE SHIBU PASARON'
