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
rollback;
\echo 'TODAS LAS PRUEBAS DE LA REVISIÓN DE SHIBU PASARON'
