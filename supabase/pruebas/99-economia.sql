-- Economía de la expendedora y estrellas de los clientes (Edgar, 25/11; doc «Economía de puntos y estrellas»):
-- precio = carta × 2 (mínimo 3), 2 premios al día, 1 grande por semana, ventanas fijas / que rotan / premium, unidades
-- por semana, tope del mes en insumos y estrellas de las opiniones con sus niveles (que no se pierden).
-- Todo en una transacción que se deshace al final.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;
insert into public.employees (name, job_title, pos_can_charge, pos_pin_hash) values
  ('Mei Economía', 'Maid', false, extensions.crypt('7101', extensions.gen_salt('bf'))),
  ('Nami Economía', 'Maid', false, extensions.crypt('7102', extensions.gen_salt('bf'))),
  ('Luz Economía', 'Maid', false, extensions.crypt('7103', extensions.gen_salt('bf'))),
  ('Sol Economía', 'Maid', false, extensions.crypt('7105', extensions.gen_salt('bf'))),
  ('Caja Economía', 'Caja', true, extensions.crypt('7104', extensions.gen_salt('bf')));
select (select id from public.employees where name = 'Mei Economía') mei, (select id from public.employees where name = 'Nami Economía') nami,
       (select id from public.employees where name = 'Luz Economía') luz, (select id from public.employees where name = 'Sol Economía') sol,
       (select id from public.employees where name = 'Caja Economía') caja, public.mis_hoy() hoy \gset
-- Una caja abierta: los premios salen a cocina y quedan en el cierre de una caja
insert into public.pos_sessions (opened_by) select :caja where not exists (select 1 from public.pos_sessions where status = 'abierta');
insert into public.mis_puntos (employee_id, delta, motivo) select e, 500, 'prueba' from unnest(array[:mei, :nami, :luz, :sol]::bigint[]) e;
-- Las llamadas de la tablet van con la cuenta de una tablet autorizada
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false) \gset x_

-- 1) Precio: el doble de la carta, mínimo 3; los premios que no son de la carta cuestan lo que se anotó
select (select id from public.tienda_items where nombre = 'Refresco') refresco, (select id from public.tienda_items where nombre = 'Taiyaki') taiyaki,
       (select id from public.tienda_items where nombre = 'Té Verde') te, (select id from public.tienda_items where nombre = 'Amaterasu') amaterasu \gset
insert into public.tienda_items (nombre, puntos, ventana) values ('Llavero de prueba', 12, 'fija') returning id as llavero \gset
select prueba.ok(public.tienda_puntos(:refresco) = 5 and public.tienda_puntos(:te) = 3 and public.tienda_puntos(:amaterasu) = 20
  and public.tienda_puntos(:llavero) = 12,
  'cada premio cuesta el doble de su precio en la carta (Refresco 5, Amaterasu pequeño 20), mínimo 3 (Té Verde); el llavero, lo anotado');
update public.dishes set price = 3.00, variants = '[{"label": "Lata", "price": 3}]' where name = 'Refresco';
select prueba.ok(public.tienda_puntos(:refresco) = 6, 'si sube el precio en la carta, el premio sube solo');
update public.dishes set price = 2.50, variants = '[{"label": "Lata", "price": 2.5}]' where name = 'Refresco';
update public.tienda_items set activo = false where id = :llavero;

-- 2) La máquina de la semana: las 2 fijas, 3 de las 7 que rotan y 1 de las 2 premium; igual toda la semana
select public.tienda_lunes(:'hoy') lunes \gset
select prueba.ok((select count(*) filter (where ventana = 'fija') = 2 and count(*) filter (where ventana = 'rota') = 3
                  and count(*) filter (where ventana = 'premium') = 1 from public.tienda_vitrina(:'hoy')),
  'en la máquina hay 2 fijas, 3 de las que rotan y 1 premium');
select prueba.ok((select array_agg(item_id order by item_id) from public.tienda_vitrina(:'lunes'))
                 = (select array_agg(item_id order by item_id) from public.tienda_vitrina(:'lunes'::date + 6)),
  'la máquina es la misma de lunes a domingo');
select prueba.ok((select array_agg(item_id) from public.tienda_vitrina(public.tienda_quincena(:'lunes')) where ventana = 'premium')
                 = (select array_agg(item_id) from public.tienda_vitrina(public.tienda_quincena(:'lunes') + 13) where ventana = 'premium'),
  'la ventana premium dura 2 semanas');
select prueba.ok((select count(distinct x.ids) > 1 from (
                    select string_agg(v.item_id::text, ',' order by v.item_id) ids from generate_series(0, 7) w
                    cross join lateral public.tienda_vitrina(:'lunes'::date + 7 * w) v where v.ventana = 'rota' group by w) x),
  'las que rotan cambian de una semana a otra');

-- 3) La tablet ve la máquina con precio, ventana, unidades y por qué no se puede pedir
set role authenticated;
select public.mis_estado(:mei, '7101') as e0 \gset
reset role;
select prueba.ok(jsonb_array_length(:'e0'::jsonb -> 'tienda') = 7
  and (select bool_and((t ->> 'quedan')::int = 5) from jsonb_array_elements(:'e0'::jsonb -> 'tienda') t where t ->> 'ventana' = 'rota')
  and (select t ->> 'bloqueo' from jsonb_array_elements(:'e0'::jsonb -> 'tienda') t where t ->> 'ventana' = 'premium') = 'nivel'
  and (select string_agg((t ->> 'bloqueo') || '/' || (t ->> 'abre'), ',') from jsonb_array_elements(:'e0'::jsonb -> 'tienda') t where (t ->> 'extra')::boolean) = 'nivel/2'
  and (select (t ->> 'puntos')::int from jsonb_array_elements(:'e0'::jsonb -> 'tienda') t where (t ->> 'id')::bigint = :refresco) = 5
  and (:'e0'::jsonb -> 'estrellas' ->> 'total')::int = 0 and (:'e0'::jsonb ->> 'canjes_dia')::int = 2,
  'la tablet ve las 7 ventanas con su precio, 5 unidades en las que rotan, la 4.ª que rota y la premium cerradas hasta el nivel 2 y sus estrellas en 0');

-- 4) Comprar: se descuentan los puntos de la carta × 2; 2 premios al día como máximo
select item_id as rota1 from public.tienda_vitrina(:'hoy') where ventana = 'rota' order by item_id limit 1 \gset
select public.mis_saldo(:mei) as s0 \gset
set role authenticated;
select public.tienda_canjear(:mei, '7101', :refresco) as c1 \gset
select public.tienda_canjear(:mei, '7101', :rota1) as c2 \gset
select prueba.falla(format('select public.tienda_canjear(%s, %L, %s)', :mei, '7101', :refresco), 'Ya pediste 2 premios hoy', 'el tercer premio del día no sale');
reset role;
select prueba.ok(public.mis_saldo(:mei) = :s0 - 5 - public.tienda_puntos(:rota1)
  and (select costo > 0 and puntos = 5 from public.tienda_canjes where id = (:'c1'::jsonb ->> 'id')::bigint)
  and public.tienda_quedan(:rota1, :'hoy') = 4,
  'se descuentan los puntos de la carta × 2, cada premio guarda lo que cuesta en insumos y baja una unidad de la semana');

-- 5) Un premio grande (15 puntos o más) por semana
insert into public.tienda_items (nombre, puntos, dish_id, variant, ventana)
select 'Teuchi grande de prueba', 1, id, 'Gr', 'fija' from public.dishes where name = 'Teuchi' returning id as grande \gset
set role authenticated;
select public.tienda_canjear(:nami, '7102', :grande) as g1 \gset
select prueba.falla(format('select public.tienda_canjear(%s, %L, %s)', :nami, '7102', :grande), 'premio grande de la semana', 'el segundo premio grande de la semana no sale');
reset role;
select prueba.ok(public.tienda_puntos(:grande) = 30 and (:'g1'::jsonb ->> 'id') is not null, 'un ramen grande de $15 cuesta 30 puntos y sale el primero de la semana');

-- 6) Las que rotan tienen unidades por semana para todas
update public.tienda_items set por_semana = 2 where id = :rota1;
set role authenticated;
select public.tienda_canjear(:nami, '7102', :rota1) as c3 \gset
select prueba.falla(format('select public.tienda_canjear(%s, %L, %s)', :luz, '7103', :rota1), 'Se agotó esta semana', 'cuando se acaban las unidades de la semana no sale más');
select public.mis_estado(:luz, '7103') as e1 \gset
reset role;
select prueba.ok((select (t ->> 'quedan')::int = 0 and t ->> 'bloqueo' = 'agotado' from jsonb_array_elements(:'e1'::jsonb -> 'tienda') t where (t ->> 'id')::bigint = :rota1),
  'la tablet lo muestra agotado');

-- 7) Estrellas: las opiniones de 4 o 5 suman 1 a cada maid que atendió; las de 1 o 2 restan 1; las de 3 no cuentan
create function pg_temp.opinion(p_emps bigint[], p_estrellas int, p_cuando timestamptz default now()) returns bigint language plpgsql as $$
declare oid bigint; e bigint;
begin
  insert into public.pos_orders (kind, label, status, opened_by, opened_at, closed_by, closed_at)
  values ('mesa', 'Opinión de prueba', 'cobrada', p_emps[1], p_cuando - interval '30 minutes', p_emps[1], p_cuando - interval '5 minutes') returning id into oid;
  foreach e in array p_emps loop
    insert into public.pos_items (order_id, dish_id, name, qty, unit_price, status, created_by, created_at, sent_at)
    select oid, x.id, x.name, 1, 5, 'enviado', e, p_cuando - interval '28 minutes', p_cuando - interval '27 minutes' from public.dishes x where x.name = 'Taiyaki';
  end loop;
  insert into public.opiniones (order_id, token, rating, answered_at, created_at) values (oid, 'prueba-' || oid, p_estrellas, p_cuando, p_cuando - interval '5 minutes');
  return oid;
end $$;
select pg_temp.opinion(array[:mei]::bigint[], 5), pg_temp.opinion(array[:mei]::bigint[], 4), pg_temp.opinion(array[:mei]::bigint[], 3),
       pg_temp.opinion(array[:mei, :nami]::bigint[], 5) \gset x_
select prueba.ok((public.mis_estrellas(:mei, :'hoy') ->> 'total')::int = 3 and (public.mis_estrellas(:nami, :'hoy') ->> 'total')::int = 1,
  'cada opinión de 4 o 5 estrellas suma 1 a cada maid que atendió la mesa (las de 3 no cuentan)');
select pg_temp.opinion(array[:mei]::bigint[], 2) \gset x_
select prueba.ok((public.mis_estrellas(:mei, :'hoy') ->> 'total')::int = 2, 'una opinión de 1 o 2 estrellas resta 1');
select count(pg_temp.opinion(array[:mei]::bigint[], 5)) from generate_series(1, 3) \gset x_
select public.mis_estrellas(:mei, :'hoy') as est \gset
select prueba.ok((:'est'::jsonb ->> 'nivel')::int = 1 and :'est'::jsonb ->> 'nombre' = 'Debut' and (:'est'::jsonb ->> 'siguiente')::int = 15
  and (:'est'::jsonb ->> 'falta')::int = 10 and :'est'::jsonb ->> 'siguiente_nombre' = 'Idol del local',
  'con 5 estrellas llega al nivel 1 (Debut); el siguiente, Idol del local, es a las 15');
select pg_temp.opinion(array[:mei]::bigint[], 1) \gset x_
select prueba.ok((public.mis_estrellas(:mei, :'hoy') ->> 'total')::int = 4 and (public.mis_estrellas(:mei, :'hoy') ->> 'nivel')::int = 1,
  'si el total baja, el nivel ganado no se pierde');
select pg_temp.opinion(array[:luz]::bigint[], 5, now() - interval '40 days'), pg_temp.opinion(array[:luz]::bigint[], 5) \gset x_
select prueba.ok((public.mis_estrellas(:luz, :'hoy') ->> 'total')::int = 2 and (public.mis_estrellas(:luz, :'hoy') ->> 'mes')::int = 1,
  '«este mes» cuenta solo las opiniones del mes; el total, todas');

-- 8) La ventana premium se abre con el nivel 2 y el nivel 4 regala un premio, una sola vez
-- (para la prueba los niveles van de 1 en 1)
update public.pos_kv set value = value || '{"estrellas_niveles": [1, 2, 3, 4, 5]}' where key = 'misiones';
insert into public.pos_kv (key, value) select 'misiones', '{"estrellas_niveles": [1, 2, 3, 4, 5]}' where not exists (select 1 from public.pos_kv where key = 'misiones');
select item_id as premium from public.tienda_vitrina(:'hoy') where ventana = 'premium' \gset
set role authenticated;
select prueba.falla(format('select public.tienda_canjear(%s, %L, %s)', :sol, '7105', :premium), 'se abre con el nivel 2 de estrellas', 'sin el nivel 2 la ventana premium no se abre');
select public.tienda_canjear(:luz, '7103', :premium) as c4 \gset
reset role;
select prueba.ok((:'c4'::jsonb ->> 'id') is not null, 'con el nivel 2 de estrellas se abre la ventana premium');
update public.tienda_canjes set at = at - interval '1 day' where employee_id = :mei;
select public.mis_saldo(:mei) as s1 \gset
set role authenticated;
select (public.mis_estado(:mei, '7101') ->> 'regalo')::boolean as regalo_antes \gset
select public.tienda_canjear(:mei, '7101', :refresco) as c5 \gset
select public.tienda_canjear(:mei, '7101', :refresco) as c6 \gset
reset role;
select prueba.ok(:'regalo_antes'::boolean and (:'c5'::jsonb ->> 'regalo')::boolean and not (:'c6'::jsonb ->> 'regalo')::boolean
  and public.mis_saldo(:mei) = :s1 - 5 and (select puntos = 0 and regalo from public.tienda_canjes where id = (:'c5'::jsonb ->> 'id')::bigint),
  'el nivel 4 regala un premio una sola vez: el primero no cuesta puntos, el siguiente sí');

-- 9) Tope del mes en insumos: al llegar, la máquina se recarga hasta el día 1 (0 = sin tope)
select round(public.tienda_gasto_mes(:'hoy') + public.tienda_costo(:taiyaki) + 0.001, 3) as tope \gset
update public.pos_kv set value = value || jsonb_build_object('tope_mes_usd', :tope) where key = 'misiones';
set role authenticated;
select public.tienda_canjear(:sol, '7105', :taiyaki) as c7 \gset
select prueba.falla(format('select public.tienda_canjear(%s, %L, %s)', :sol, '7105', :refresco), 'se está recargando', 'al llegar al tope del mes la máquina se recarga');
select public.mis_estado(:sol, '7105') as e2 \gset
reset role;
select prueba.ok((select bool_and(t ->> 'bloqueo' = 'recarga') from jsonb_array_elements(:'e2'::jsonb -> 'tienda') t), 'la tablet ve la máquina recargando');
update public.pos_kv set value = value || '{"tope_mes_usd": 0}' where key = 'misiones';
set role authenticated;
select public.tienda_canjear(:sol, '7105', :refresco) as c8 \gset
reset role;
select prueba.ok((:'c8'::jsonb ->> 'id') is not null, 'con el tope en 0 no hay tope');

-- 10) El Top maid muestra las estrellas de cada una
insert into public.mis_logros (employee_id, fecha, nivel, texto, puntos, visto) values (:mei, :'hoy', 1, 'Prueba', 3, true), (:nami, :'hoy', 1, 'Prueba', 1, true)
on conflict do nothing;
set role authenticated;
select public.mis_estado(:mei, '7101') -> 'ranking' as rk \gset
reset role;
select prueba.ok((select (r ->> 'estrellas')::int from jsonb_array_elements(:'rk'::jsonb) r where (r ->> 'yo')::boolean) = 4,
  'el Top maid muestra las estrellas de cada una');

-- 11) Las funciones internas no se llaman desde afuera; Gestión ve el gasto, la máquina y las estrellas, con límites
set role authenticated;
select prueba.falla('select * from public.tienda_vitrina(current_date)', 'permission denied', 'la tablet no llama a las funciones internas de la máquina');
select prueba.falla('select public.mis_estrellas_todas(current_date)', 'permission denied', 'ni a las de las estrellas');
reset role;
insert into public.staff (email, role) values ('dueno@prueba.test', 'dueño') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
select public.gestion_misiones() as g \gset
select prueba.falla($$select public.gestion_misiones_ajustes('{"tope_mes_usd": 5000}')$$, 'tope del mes', 'el tope del mes tiene límite');
select prueba.falla($$select public.gestion_misiones_ajustes('{"canjes_dia": 0}')$$, 'premios por día', 'los premios por día tienen límite');
select public.gestion_misiones_ajustes('{"tope_mes_usd": 60, "canjes_dia": 3}') \gset x_
select prueba.falla(format('select public.gestion_tienda_guardar(null, %L, 5, null, %L, true, %L)', 'Mal', '', 'otra'), 'fija, rota o premium',
  'la ventana tiene que ser fija, rota o premium');
reset role;
select set_config('request.jwt.claims', '', false);
select prueba.ok((:'g'::jsonb ->> 'gasto_mes')::numeric > 0
  and (select count(*) from jsonb_array_elements(:'g'::jsonb -> 'tienda') t where (t ->> 'en_maquina')::boolean) >= 6
  and (select (p -> 'estrellas' ->> 'total')::int from jsonb_array_elements(:'g'::jsonb -> 'personas') p where (p ->> 'id')::bigint = :mei) = 4,
  'Gestión ve lo gastado en el mes, qué hay en la máquina y las estrellas de cada maid');
select prueba.ok((public.mis_ajustes() ->> 'canjes_dia')::int = 3 and (public.mis_ajustes() ->> 'tope_mes_usd')::numeric = 60,
  'Gestión cambia el tope del mes y los premios por día');
rollback;
\echo TODAS LAS PRUEBAS DE LA ECONOMÍA PASARON
