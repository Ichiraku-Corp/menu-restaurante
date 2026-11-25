-- Misiones elegidas por Edgar (24/11): lo que aprobó está prendido con sus cambios; meseras y cajeras tienen sus misiones;
-- la de la tienda es la extra de todos los días; la #43 sale el 40 % de los días; el plato de la semana y la promo del
-- día; y las formas nuevas de medir (clientes que vuelven, opiniones, rachas, cierre de caja cuadrado…).
-- Todo en una transacción que se deshace al final.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;
select setseed(0.24);

-- 1) La selección quedó como la decidió Edgar
select prueba.ok((select value ->> 'fecha' from public.pos_kv where key = 'misiones_elegidas') = '2026-11-24'
  and (select count(*) from public.mis_catalogo where activa) = 75,
  'la selección de Edgar está aplicada: 75 misiones prendidas');
select prueba.ok(not exists (select 1 from public.mis_catalogo where activa and numero in
    (4, 6, 38, 39, 49, 50, 51, 57, 66, 67, 68, 70, 71, 74, 78, 79, 80, 81, 82, 84, 85, 90, 93, 95, 96, 100)),
  'las rechazadas, las pendientes y las que esperan (semanales #70 y #71, anulación por error #80) quedan apagadas');
select prueba.ok(not exists (select 1 from public.mis_catalogo where activa and not public.mis_tipo_medible(tipo)),
  'todas las prendidas se pueden medir');
select prueba.ok((select texto = 'Cierra 3 comandas de $30 o más' and params ->> 'n' = '3' from public.mis_catalogo where numero = 1)
  and (select dias = 'todos' from public.mis_catalogo where numero = 3)
  and (select nivel = 1 from public.mis_catalogo where numero = 23)
  and (select params ->> 'monto' = '20' from public.mis_catalogo where numero = 20)
  and (select texto = 'Vende 4 postres en una misma comanda' from public.mis_catalogo where numero = 29)
  and (select params -> 'nombres' = '["Gyozas"]'::jsonb from public.mis_catalogo where numero = 40)
  and (select nivel = 3 from public.mis_catalogo where numero = 94),
  'los cambios de Edgar están: 3 comandas en la #1, todos los días en la #3, nivel 1 en la #23, $20 en la #20, 4 postres en la #29, Gyozas en la #40, nivel 3 en la #94');
select prueba.ok((select activa and nivel = 3 and tipo = 'equipo_meta' and params ->> 'pct' = '150' and para = 'todas' from public.mis_catalogo where numero = 101),
  'la #101 que pidió Edgar (el local pasa la meta por 50 % = 3 puntos) está prendida para todas');
select prueba.ok((select array_agg(numero order by numero) from public.mis_catalogo where activa and para = 'cajeras') = '{75,97,98,99}'
  and (select array_agg(numero) from public.mis_catalogo where extra) = '{58}'
  and public.mis_ajustes() ->> 'plato_semana' = 'Tonkotsu',
  'las de caja son para las cajeras, la extra de todos los días es la de la tienda (#58) y el plato de la semana es Tonkotsu');
-- Cada tipo de día, las meseras y las cajeras tienen misión fácil, media y difícil (sin contar las que dependen de algo)
select prueba.ok(not exists (
    select 1 from unnest(array['flojos', 'normales', 'fuertes']) t cross join unnest(array['meseras', 'cajeras']) g cross join generate_series(1, 3) n
    where not exists (select 1 from public.mis_catalogo k
                      where k.activa and not k.extra and k.nivel = n and k.para in ('todas', g) and k.dias in ('todos', t)
                        and not k.params ? 'frecuencia' and not coalesce((k.params ->> 'promo')::boolean, false)
                        and not coalesce((k.params ->> 'semana')::boolean, false))),
  'todos los días, meseras y cajeras tienen para elegir misión fácil, media y difícil');

-- 2) Cada grupo recibe las suyas, más la extra de la tienda
select '2031-03-04'::date as dia \gset
select public.mis_asignar(:'dia');
select prueba.ok((select count(*) from public.mis_dia where fecha = :'dia' and grupo = 'meseras') = 4
  and (select count(*) from public.mis_dia where fecha = :'dia' and grupo = 'cajeras') = 4
  and (select bool_and(d.catalogo_id = (select id from public.mis_catalogo where numero = 58) and d.puntos = 1)
       from public.mis_dia d where d.fecha = :'dia' and d.nivel = 0),
  'cada día, las meseras y las cajeras tienen 3 misiones más la extra de la tienda (1 punto)');
select prueba.ok(not exists (select 1 from public.mis_dia d join public.mis_catalogo k on k.id = d.catalogo_id
                             where d.fecha = :'dia' and ((d.grupo = 'meseras' and k.para = 'cajeras') or (d.grupo = 'cajeras' and k.para = 'meseras'))),
  'a las meseras no les tocan misiones de caja ni a las cajeras las de mesera');
select prueba.ok(public.mis_grupo((select id from public.employees where job_title ~* '^\s*caj' limit 1)) = 'cajeras'
  and public.mis_grupo((select id from public.employees where coalesce(job_title, '') !~* '^\s*caj' limit 1)) = 'meseras',
  'quien tiene cargo de caja va con las cajeras; las demás, con las meseras');

-- 3) La #43 (la favorita de Edgar) sale el 40 % de los días
select id as m43 from public.mis_catalogo where numero = 43 \gset
select prueba.ok((select count(*) filter (where public.mis_azar(d::date, :m43) < 40) between 100 and 140
                  from generate_series('2031-01-01'::date, '2031-10-27'::date, interval '1 day') d),
  'la #43 toca en unos 40 de cada 100 días');
select min(d::date) as dia_si from generate_series('2032-01-01'::date, '2032-03-01'::date, interval '1 day') d
  where public.mis_azar(d::date, :m43) < 40 and public.mis_tipo_dia(d::date) = 'normales' \gset
select min(d::date) as dia_no from generate_series('2032-01-01'::date, '2032-03-01'::date, interval '1 day') d
  where public.mis_azar(d::date, :m43) >= 40 \gset
select public.mis_asignar(:'dia_si');
select public.mis_asignar(:'dia_no');
select prueba.ok((select catalogo_id = :m43 from public.mis_dia where fecha = :'dia_si' and grupo = 'meseras' and nivel = 2)
  and (select catalogo_id is distinct from :m43 from public.mis_dia where fecha = :'dia_no' and grupo = 'meseras' and nivel = 2),
  'el día que le toca, la #43 sale como misión media de las meseras; el día que no, no sale');

-- 4) El plato de la semana va en el texto; sin plato no sale. La promo del día solo sale con una promo activa.
update public.mis_catalogo set activa = false where numero <> 52 and nivel = 1 and not extra;
select public.mis_asignar('2031-05-06');
select prueba.ok((select texto from public.mis_dia where fecha = '2031-05-06' and grupo = 'meseras' and nivel = 1) = 'Vende 3 del plato de la semana (Tonkotsu)',
  'la misión del plato de la semana dice cuál es: «Vende 3 del plato de la semana (Tonkotsu)»');
update public.pos_kv set value = value || '{"plato_semana": ""}' where key = 'misiones';
select public.mis_asignar('2031-05-07');
select prueba.ok(not exists (select 1 from public.mis_dia where fecha = '2031-05-07' and grupo = 'meseras' and nivel = 1),
  'sin plato de la semana elegido, esa misión no sale');
update public.mis_catalogo set activa = (numero = 54) where nivel = 1 and not extra;
delete from public.promos;
select public.mis_asignar('2031-05-13');   -- martes (flojo) sin promo
insert into public.promos (name, percent, days, start_time, end_time, category_ids)
values ('Martes de prueba', 10, '{2}', '12:00', '22:00', array[(select id from public.categories where name = 'Ramen')]);
select public.mis_asignar('2031-05-20');   -- martes con promo
select prueba.ok(not exists (select 1 from public.mis_dia where fecha = '2031-05-13' and grupo = 'meseras' and nivel = 1)
  and (select k.numero from public.mis_dia d join public.mis_catalogo k on k.id = d.catalogo_id where d.fecha = '2031-05-20' and d.grupo = 'meseras' and d.nivel = 1) = 54,
  'la misión de la promo del día solo sale el día que hay una promo activa');

-- 5) Las formas nuevas de medir, con pedidos de prueba de una maid y una cajera nuevas
insert into public.employees (name, job_title, pos_can_charge, pos_pin_hash) values
  ('Sakura Prueba', 'Maid nivel 2', false, extensions.crypt('7171', extensions.gen_salt('bf'))),
  ('Caja Prueba', 'Caja', true, extensions.crypt('7272', extensions.gen_salt('bf')));
select (select id from public.employees where name = 'Sakura Prueba') maid, (select id from public.employees where name = 'Caja Prueba') caja,
       public.mis_hoy() hoy \gset
-- La cajera de prueba no se llama «Cajera…»: se le activa a mano (en producción entra sola por su cargo)
update public.employees set juega_misiones = true where id = :caja;
-- Horas fijas del día de hoy en Venezuela (así la prueba no depende de la hora a la que corre)
create function pg_temp.a_las(p_dia date, p_hora int) returns timestamptz language sql immutable as $$
  select (p_dia + make_time(p_hora, 0, 0)) at time zone 'America/Caracas' $$;
create function pg_temp.pedido(p_emp bigint, p_cuando timestamptz, p_platos text[], p_cliente bigint default null) returns bigint
language plpgsql as $$
declare oid bigint; d text;
begin
  insert into public.pos_orders (kind, label, status, opened_by, opened_at, closed_by, closed_at, customer_id)
  values ('mesa', 'Prueba', 'cobrada', p_emp, p_cuando - interval '25 minutes', p_emp, p_cuando, p_cliente) returning id into oid;
  foreach d in array p_platos loop
    insert into public.pos_items (order_id, dish_id, name, qty, unit_price, status, created_by, created_at, sent_at)
    select oid, x.id, x.name, 1, 5, 'enviado', p_emp, p_cuando - interval '24 minutes', p_cuando - interval '22 minutes'
    from public.dishes x where x.name = d;
  end loop;
  return oid;
end $$;
-- La #29: 4 postres en una misma comanda
select pg_temp.pedido(:maid, pg_temp.a_las(:'hoy', 11), array['Dorayaki', 'Taiyaki', 'Dangos', 'Dorayaki', 'Teuchi']) as o1 \gset
select prueba.ok((public.mis_medir(:maid, :'hoy', 'comandas_con', '{"n": 1, "con": "postres", "min": 4}') ->> 'actual')::int = 1
  and (public.mis_medir(:maid, :'hoy', 'comandas_con', '{"n": 1, "con": "postres", "min": 5}') ->> 'actual')::int = 0,
  'la #29 cuenta la comanda con 4 postres (y no si pide 5)');
-- La #45: postre en la mitad de sus comandas (con mínimo de comandas)
select pg_temp.pedido(:maid, pg_temp.a_las(:'hoy', 12), array['Teuchi', 'Té Verde']) as o2 \gset
select prueba.ok((public.mis_medir(:maid, :'hoy', 'proporcion', '{"con": "postre", "pct": 50, "minimo": 2}') ->> 'actual')::int = 1
  and (public.mis_medir(:maid, :'hoy', 'proporcion', '{"con": "postre", "pct": 60, "minimo": 2}') ->> 'actual')::int = 0
  and (public.mis_medir(:maid, :'hoy', 'proporcion', '{"con": "postre", "pct": 50, "minimo": 6}') ->> 'actual')::int = 0
  and public.mis_tipo_cierre('proporcion'),
  'la #45: postre en la mitad de sus comandas (1 de 2 = 50 %), con el mínimo de comandas, al cerrar la caja');
-- Las #63–65: clientes que vuelven
insert into public.customers (name, phone) values ('Cliente que vuelve', '04140000001') returning id as cli \gset
select pg_temp.pedido(:maid, pg_temp.a_las(:'hoy'::date - 10, 12), array['Teuchi'], :cli);
select pg_temp.pedido(:maid, pg_temp.a_las(:'hoy'::date - 5, 12), array['Teuchi'], :cli);
select pg_temp.pedido(:maid, pg_temp.a_las(:'hoy', 13), array['Teuchi'], :cli) as o3 \gset
select prueba.ok((public.mis_medir(:maid, :'hoy', 'vuelven', '{"n": 2}') ->> 'actual')::int = 1
  and (public.mis_medir(:maid, :'hoy', 'vuelven', '{"n": 1, "visitas": 3}') ->> 'actual')::int = 1
  and (public.mis_medir(:maid, :'hoy', 'vuelven', '{"n": 1, "visitas": 5}') ->> 'actual')::int = 0,
  'las #63–65 cuentan al cliente que vuelve (es su 3.ª visita: no llega a la 5.ª)');
-- Las #69, #72 y #73: opiniones que los clientes respondieron hoy, en pedidos donde ella anotó
insert into public.opiniones (order_id, token, rating, comment, answered_at) values
  (:o1, 'tok-prueba-1', 5, 'Sakura nos atendió increíble', now()),
  (:o2, 'tok-prueba-2', 4, 'Muy rico todo', now());
select prueba.ok((public.mis_medir(:maid, :'hoy', 'opiniones', '{"n": 1, "estrellas": 5}') ->> 'actual')::int = 1
  and (public.mis_medir(:maid, :'hoy', 'nombrada', '{"n": 1}') ->> 'actual')::int = 1
  and (public.mis_medir(:maid, :'hoy', 'sin_quejas', '{"minimo": 2}') ->> 'actual')::int = 1,
  'la #69 cuenta la opinión de 5 estrellas, la #72 la que la nombra y la #73 se cumple sin opiniones de 3 estrellas o menos');
insert into public.opiniones (order_id, token, rating, comment, answered_at) values (:o3, 'tok-prueba-3', 3, 'Tardó un poco', now());
select prueba.ok((public.mis_medir(:maid, :'hoy', 'sin_quejas', '{"minimo": 2}') ->> 'actual')::int = 0
  and (public.mis_medir(:caja, :'hoy', 'nombrada', '{"n": 1}') ->> 'actual')::int = 0,
  'con una opinión de 3 estrellas ya no se cumple la #73; y nadie gana por una opinión que nombra a otra');
-- Las #91 y #92: rachas de días de trabajo seguidos
insert into public.mis_logros (employee_id, fecha, nivel, texto, puntos)
select :maid, :'hoy'::date - g, 1, 'Fácil de prueba', 1 from generate_series(1, 2) g;
select pg_temp.pedido(:maid, pg_temp.a_las(:'hoy'::date - 1, 12), array['Teuchi']);
select pg_temp.pedido(:maid, pg_temp.a_las(:'hoy'::date - 2, 12), array['Teuchi']);
select prueba.ok((public.mis_medir(:maid, :'hoy', 'racha', '{"dias": 3, "nivel": 1}') ->> 'actual')::int = 2,
  'la racha de la #91 lleva 2 de 3 mientras hoy no cumpla la fácil');
insert into public.mis_logros (employee_id, fecha, nivel, texto, puntos) values (:maid, :'hoy', 1, 'Fácil de hoy', 1);
select prueba.ok((public.mis_medir(:maid, :'hoy', 'racha', '{"dias": 3, "nivel": 1}') ->> 'actual')::int = 3
  and (public.mis_medir(:maid, :'hoy', 'racha', '{"dias": 5}') ->> 'actual')::int = 3,
  'con la fácil de hoy, la #91 llega a 3 días seguidos; la #92 lleva 3 de 5');
-- Un día que trabajó sin cumplir corta la racha (los días que no trabajó no cuentan)
delete from public.mis_logros where employee_id = :maid and fecha = :'hoy'::date - 2;
select prueba.ok((public.mis_medir(:maid, :'hoy', 'racha', '{"dias": 3, "nivel": 1}') ->> 'actual')::int = 2,
  'un día de trabajo sin cumplir corta la racha');
-- La #97: cierre de caja cuadrado (la cajera)
insert into public.pos_sessions (opened_by, opened_at, status, closed_by, closed_at, expected, counted)
values (:caja, pg_temp.a_las(:'hoy', 9), 'cerrada', :caja, pg_temp.a_las(:'hoy', 22), '{"efectivo_usd": 100, "pago_movil": 5000}', '{"efectivo_usd": 100.5, "pago_movil": 5000, "_inv": {}}');
select prueba.ok((public.mis_medir(:caja, :'hoy', 'cierre_cuadrado', '{"monto": 1}') ->> 'actual')::int = 1
  and (public.mis_medir(:caja, :'hoy', 'cierre_cuadrado', '{"monto": 0.5}') ->> 'actual')::int = 0
  and (public.mis_medir(:maid, :'hoy', 'cierre_cuadrado', '{"monto": 1}') ->> 'actual')::int = 0
  and public.mis_tipo_cierre('cierre_cuadrado'),
  'la #97: la cajera que cerró con diferencia menor a Ref 1 la cumple (al cerrar la caja); con Ref 0,50 de diferencia no llega a Ref 0,50');

-- 6) La tablet ve las de su grupo y la extra al final
delete from public.mis_dia where fecha = :'hoy';
update public.mis_catalogo set activa = true where numero in (1, 2, 3, 58, 75, 97, 98);
select public.mis_asignar(:'hoy');
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.mis_estado(:maid, '7171') as em \gset
select public.mis_estado(:caja, '7272') as ec \gset
reset role;
select prueba.ok(:'em'::jsonb ->> 'grupo' = 'meseras' and :'ec'::jsonb ->> 'grupo' = 'cajeras'
  and jsonb_array_length(:'em'::jsonb -> 'misiones') = 4
  and (:'em'::jsonb -> 'misiones' -> 3 ->> 'extra')::boolean and :'em'::jsonb -> 'misiones' -> 3 ->> 'texto' = 'Vende 3 artículos de la tienda del menú'
  and not exists (select 1 from jsonb_array_elements(:'em'::jsonb -> 'misiones') x
                  where x ->> 'texto' in (select texto from public.mis_catalogo where para = 'cajeras')),
  'la tablet de la maid muestra sus 3 misiones y la extra de la tienda al final, sin las de caja');

-- 7) Top maid del mes: las meseras por los puntos de misiones del mes (sin juegos, sin el mes pasado y sin cajeras)
delete from public.mis_logros where employee_id in (:maid, :caja);
insert into public.employees (name, job_title, pos_can_charge, pos_pin_hash) values
  ('Hana Prueba', 'Maid · Hana', false, extensions.crypt('7373', extensions.gen_salt('bf')));
select (select id from public.employees where name = 'Hana Prueba') hana, date_trunc('month', :'hoy'::date)::date ini \gset
insert into public.mis_logros (employee_id, fecha, nivel, texto, puntos) values
  (:maid, :'ini', 1, 'Fácil', 1), (:maid, :'ini', 3, 'Difícil', 3),
  (:hana, :'ini', 2, 'Media', 2), (:hana, :'ini'::date - 1, 3, 'Del mes pasado', 3),
  (:caja, :'ini', 3, 'Difícil de caja', 3);
insert into public.mis_puntos (employee_id, delta, motivo) values (:hana, 3, 'juego:ruleta');
create function pg_temp.del_top(p_rk jsonb, p_nombre text) returns jsonb language sql immutable as $$
  select x from jsonb_array_elements(p_rk) x where x ->> 'nombre' = p_nombre $$;
select public.mis_ranking(:'hoy', :hana) as rk \gset
select prueba.ok((pg_temp.del_top(:'rk', 'Sakura') ->> 'puntos')::int = 4 and (pg_temp.del_top(:'rk', 'Hana') ->> 'puntos')::int = 2
  and (pg_temp.del_top(:'rk', 'Sakura') ->> 'puesto')::int < (pg_temp.del_top(:'rk', 'Hana') ->> 'puesto')::int
  and (pg_temp.del_top(:'rk', 'Hana') ->> 'yo')::boolean and not (pg_temp.del_top(:'rk', 'Sakura') ->> 'yo')::boolean
  and pg_temp.del_top(:'rk', 'Caja') is null,
  'el Top maid ordena a las meseras por los puntos de misiones del mes; no cuentan los juegos, el mes pasado ni la cajera');
insert into public.mis_logros (employee_id, fecha, nivel, texto, puntos) values (:hana, :'hoy', 1, 'Fácil de hoy', 2);
select public.mis_ranking(:'hoy', :hana) as rk \gset
select prueba.ok((pg_temp.del_top(:'rk', 'Hana') ->> 'puesto')::int = (pg_temp.del_top(:'rk', 'Sakura') ->> 'puesto')::int,
  'con los mismos puntos, las dos comparten el puesto');
set role authenticated;
select public.mis_estado(:hana, '7373') as eh \gset
reset role;
select prueba.ok((pg_temp.del_top(:'eh'::jsonb -> 'ranking', 'Hana') ->> 'yo')::boolean,
  'la tablet recibe el Top maid con su puesto marcado');
select set_config('request.jwt.claims', '', false);
rollback;
\echo TODAS LAS PRUEBAS DE LAS MISIONES ELEGIDAS PASARON
