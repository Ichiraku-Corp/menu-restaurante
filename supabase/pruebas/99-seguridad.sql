-- Revisión general de permisos: lo público es solo la carta, y nada con permisos elevados queda sin verificar quién lo llama.
-- 00-entorno.sql imita a Supabase, donde cada función nueva nace ejecutable por anon; por eso hay que revocarla también de anon.
\set ON_ERROR_STOP 1
\set QUIET 1

-- 1) Las únicas funciones con permisos elevados que el público (sin sesión) puede llamar
select prueba.ok(
  (select coalesce(array_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' order by p.proname), '{}')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('anon', p.oid, 'execute'))
  = array['menu_promos()', 'menu_tasa()', 'opinion_enviar(p_token text, p_rating integer, p_comment text, p_name text, p_phone text)',
          'opinion_ver(p_token text)', 'wa_cart_create(p_items jsonb)'],
  'el público solo puede llamar a la carta (menu_promos, menu_tasa), a la página de opinión del recibo y al carrito de WhatsApp');

-- 2) Las demás, si las puede llamar una cuenta con sesión, verifican quién es (dueño, admin, tablet, PIN…)
select prueba.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
     and has_function_privilege('authenticated', p.oid, 'execute')
     and p.proname not in ('menu_promos', 'menu_tasa', 'wa_cart_create', 'opinion_ver', 'opinion_enviar')  -- públicas a propósito (la de opinión pide el código del recibo)
     and p.prosrc !~* '(can_manage|pos_is_device|pos_auth|staff_role|auth\.jwt|auth\.uid|Sin permiso)'),
  'toda función con permisos elevados que pueden llamar las cuentas verifica quién la llama');

-- 3) Todas las tablas tienen seguridad por filas
select prueba.ok(not exists (
  select 1 from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity),
  'todas las tablas tienen seguridad por filas (RLS)');

-- 4) Ninguna vista salta la seguridad por filas para el público
select prueba.ok(not exists (
  select 1 from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
     and has_table_privilege('anon', c.oid, 'select')
     and not coalesce('security_invoker=true' = any (c.reloptions), false)),
  'ninguna vista deja al público leer saltándose la seguridad por filas');

-- 5) El público llama a la carta, pero no a las funciones internas
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select prueba.ok(jsonb_typeof(public.menu_promos()) = 'array', 'el público ve las promociones de hoy en la carta');
select prueba.falla('select public.promos_de_hoy()', 'permission denied', 'el público no llama a la función interna de promociones');
select prueba.falla('select public.promo_de(1)', 'permission denied', 'el público no llama al cálculo interno de una promoción');
reset role;
select set_config('request.jwt.claims', '', false);

-- 6) Las fotos de facturas no son públicas
select prueba.ok((select not public from storage.buckets where id = 'facturas'), 'las fotos de facturas son privadas');

\echo 'TODAS LAS PRUEBAS DE SEGURIDAD PASARON'
