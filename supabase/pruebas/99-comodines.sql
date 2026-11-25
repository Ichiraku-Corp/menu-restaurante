-- Comodines y mejoras por nivel (Edgar, 25/11, página «Niveles y comodines»): se compran con puntos en la máquina, cada
-- uno desde un nivel de estrellas; reglas de 2 activos y 3 por semana; los que duplican se suman; misiones propias
-- (pergaminos, ficha de cambio, mapa), juegos (trébol, tope, ficha dorada, carta), equipo (bandera, regalo, duelo),
-- la máquina (cupón, premio sorpresa) y las mejoras de nivel (ventana extra, un premio más al día, corona).
-- Todo en una transacción que se deshace al final.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;
select setseed(0.31);
insert into public.employees (name, job_title, pos_can_charge, pos_pin_hash) values
  ('Mei Comodín', 'Maid', false, extensions.crypt('8101', extensions.gen_salt('bf'))),
  ('Nami Comodín', 'Maid', false, extensions.crypt('8102', extensions.gen_salt('bf'))),
  ('Luz Comodín', 'Maid', false, extensions.crypt('8103', extensions.gen_salt('bf'))),
  ('Sol Comodín', 'Maid', false, extensions.crypt('8105', extensions.gen_salt('bf'))),
  ('Caja Comodín', 'Caja', true, extensions.crypt('8104', extensions.gen_salt('bf')));
select (select id from public.employees where name = 'Mei Comodín') mei, (select id from public.employees where name = 'Nami Comodín') nami,
       (select id from public.employees where name = 'Luz Comodín') luz, (select id from public.employees where name = 'Sol Comodín') sol,
       (select id from public.employees where name = 'Caja Comodín') caja, public.mis_hoy() hoy \gset
insert into public.pos_sessions (opened_by) select :caja where not exists (select 1 from public.pos_sessions where status = 'abierta');
insert into public.mis_puntos (employee_id, delta, motivo) select e, 200, 'prueba' from unnest(array[:mei, :nami, :luz, :sol]::bigint[]) e;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false) \gset x_
create function pg_temp.a_las(p_dia date, p_hora int) returns timestamptz language sql immutable as $$
  select (p_dia + make_time(p_hora, 0, 0)) at time zone 'America/Caracas' $$;
-- Un pedido cobrado de una maid (cada plato a Ref 5)
create function pg_temp.pedido(p_emp bigint, p_cuando timestamptz, p_platos text[]) returns bigint
language plpgsql as $$
declare oid bigint; d text;
begin
  insert into public.pos_orders (kind, label, status, opened_by, opened_at, closed_by, closed_at)
  values ('mesa', 'Prueba', 'cobrada', p_emp, p_cuando - interval '25 minutes', p_emp, p_cuando) returning id into oid;
  foreach d in array p_platos loop
    insert into public.pos_items (order_id, dish_id, name, qty, unit_price, status, created_by, created_at, sent_at)
    select oid, x.id, x.name, 1, 5, 'enviado', p_emp, p_cuando - interval '24 minutes', p_cuando - interval '22 minutes'
    from public.dishes x where x.name = d;
  end loop;
  return oid;
end $$;
-- Las misiones de hoy, fijas: fácil = 1 postre (1 punto), media = 1 comanda de Ref 10 (2), difícil = 4 postres (3)
delete from public.mis_dia where fecha = :'hoy';
insert into public.mis_dia (fecha, grupo, nivel, texto, tipo, params, puntos) values
  (:'hoy', 'meseras', 1, 'Vende 1 postre', 'unidades', '{"n": 1, "cat": "Postres"}', 1),
  (:'hoy', 'meseras', 2, 'Cierra 1 comanda de $10 o más', 'comandas', '{"n": 1, "monto": 10}', 2),
  (:'hoy', 'meseras', 3, 'Vende 4 postres', 'unidades', '{"n": 4, "cat": "Postres"}', 3),
  (:'hoy', 'meseras', 0, 'Vende 1 Taiyaki', 'unidades', '{"n": 1, "nombres": ["Taiyaki"]}', 1);
insert into public.pos_kv (key, value) values ('misiones', '{}'::jsonb) on conflict (key) do nothing;
update public.pos_kv set value = value - 'comodines' - 'mejoras' - 'estrellas_niveles' where key = 'misiones';
-- La máquina con todos los comodines (vitrina 0); el sorteo de 3 por maid se prueba al final (17)
update public.pos_kv set value = value || '{"comodines": {"vitrina": 0}}'::jsonb where key = 'misiones';

-- 1) La lista de Edgar y lo que ve la tablet
select prueba.ok((select count(*) from public.com_catalogo) = 31 and (select count(*) from public.com_catalogo where nivel is not null) = 25
  and (select nivel = 3 and puntos = 20 and dias = 7 from public.com_catalogo where id = 1)
  and (select array_agg(id order by id) from public.com_catalogo where nivel is null) = array[14, 15, 26, 27, 28, 29],
  'los 31 comodines: 25 en la máquina como decidió Edgar (la Diadema: nivel 3, 20 puntos, 7 días) y 6 fuera');
set role authenticated;
select public.mis_estado(:mei, '8101') as e0 \gset
reset role;
select prueba.ok(jsonb_array_length(:'e0'::jsonb -> 'comodines' -> 'catalogo') = 25
  and (select count(*) from jsonb_array_elements(:'e0'::jsonb -> 'comodines' -> 'catalogo') k where k ->> 'bloqueo' is null) = 10
  and (select k ->> 'bloqueo' from jsonb_array_elements(:'e0'::jsonb -> 'comodines' -> 'catalogo') k where (k ->> 'id')::int = 1) = 'nivel'
  and (:'e0'::jsonb -> 'mejoras' ->> 'ventana')::int = 2 and (:'e0'::jsonb -> 'mejoras' ->> 'premium')::int = 2,
  'sin estrellas ve los 25: 10 abiertos desde el inicio y los demás con candado de nivel; y en qué nivel abre cada mejora');
select prueba.falla(format('select public.com_comprar(%s, %L, 1)', :mei, '8101'), 'se abre con el nivel 3', 'la Diadema no se compra sin el nivel 3 de estrellas');
select prueba.falla(format('select public.com_comprar(%s, %L, 14)', :mei, '8101'), 'no está en la máquina', 'el Paraguas (rechazado) no se vende');

-- 2) Taza (×2 hoy) y Lazo rosa (+1 por misión): lo extra va aparte y el Top maid cuenta solo la misión
select public.mis_saldo(:mei) s0 \gset
set role authenticated;
select public.com_comprar(:mei, '8101', 2) as r1 \gset
select public.com_comprar(:mei, '8101', 6) as r2 \gset
reset role;
select prueba.ok(public.mis_saldo(:mei) = :s0 - 3 - 6 and (:'r2'::jsonb ->> 'puntos')::int = :s0 - 9
  and (select desde = :'hoy' and hasta = :'hoy'::date + 2 from public.com_compras where id = (:'r2'::jsonb ->> 'id')::bigint),
  'comprar descuenta sus puntos (Taza 3 + Lazo 6) y el Lazo vale 3 días');
select pg_temp.pedido(:mei, pg_temp.a_las(:'hoy', 12), array['Dorayaki']);
select public.mis_revisar(:mei, :'hoy');
select prueba.ok((select puntos = 1 and extra = 2 from public.mis_logros where employee_id = :mei and fecha = :'hoy' and nivel = 1)
  and public.mis_saldo(:mei) = :s0 - 9 + 3
  and (select sum(delta) = 2 from public.mis_puntos where employee_id = :mei and motivo = 'comodin'),
  'con la Taza (×2) y el Lazo (+1), la misión fácil de 1 punto da 3: 1 de la misión y 2 de los comodines');
select prueba.ok((select puntos from public.mis_ranking_filas(:'hoy') where employee_id = :mei) = 1, 'el Top maid cuenta solo el punto de la misión');
set role authenticated;
select public.mis_estado(:mei, '8101') as e1 \gset
reset role;
select prueba.ok((select (m ->> 'comodin')::int from jsonb_array_elements(:'e1'::jsonb -> 'misiones') m where (m ->> 'slot')::int = 1) = 2
  and (select (m -> 'efecto' ->> 'mult')::int = 2 and (m -> 'efecto' ->> 'mas')::int = 1 from jsonb_array_elements(:'e1'::jsonb -> 'misiones') m where (m ->> 'slot')::int = 2)
  and (select (n ->> 'comodin')::int from jsonb_array_elements(:'e1'::jsonb -> 'nuevos') n) = 2
  and jsonb_array_length(:'e1'::jsonb -> 'comodines' -> 'activos') = 2,
  'la tablet ve lo que sumaron los comodines, cuánto valdrán las que faltan (×2 y +1) y sus 2 comodines activos');

-- 3) Reglas: 2 activos, no el mismo dos veces, los instantáneos no ocupan lugar, 3 por semana
select prueba.falla(format('select public.com_comprar(%s, %L, 2)', :mei, '8101'), 'ya tienes esta carta activa', 'la misma Taza no se compra dos veces mientras dura');
select prueba.falla(format('select public.com_comprar(%s, %L, 3)', :mei, '8101'), 'ya tienes 2 cartas activas', 'con 2 activos no se compra otro (la Campanita)');
select public.mis_fichas_saldo(:mei) f0 \gset
set role authenticated;
select public.com_comprar(:mei, '8101', 16) as r3 \gset
reset role;
select prueba.ok(public.mis_fichas_saldo(:mei) = :f0 + 3, 'la Bolsa de fichas no ocupa lugar: da 3 fichas al momento');
select prueba.falla(format('select public.com_comprar(%s, %L, 19)', :mei, '8101'), 'ya compraste 3 cartas esta semana', 'el cuarto comodín de la semana no sale');

-- Desde aquí: todas con el nivel 5 de estrellas y reglas más amplias (las reglas por defecto ya se probaron)
update public.pos_kv set value = value || '{"estrellas_niveles": [0, 0, 0, 0, 0], "comodines": {"activos": 10, "semana": 20, "suman": true, "uno_semana": [22, 23], "vitrina": 0}}'::jsonb
where key = 'misiones';

-- 4) Diadema (×2, 7 días) + Campanita (×3 a la próxima): se suman (×6) y la Campanita se gasta en una sola misión
set role authenticated;
select public.com_comprar(:nami, '8102', 1);
select public.com_comprar(:nami, '8102', 3);
reset role;
select pg_temp.pedido(:nami, pg_temp.a_las(:'hoy', 13), array['Teuchi', 'Teuchi']);
select public.mis_revisar(:nami, :'hoy');
select pg_temp.pedido(:nami, pg_temp.a_las(:'hoy', 14), array['Dorayaki']);
select public.mis_revisar(:nami, :'hoy');
select prueba.ok((select extra from public.mis_logros where employee_id = :nami and fecha = :'hoy' and nivel = 2) = 10
  and (select extra from public.mis_logros where employee_id = :nami and fecha = :'hoy' and nivel = 1) = 1
  and (select usado from public.com_compras where employee_id = :nami and efecto = 'x3_proxima'),
  'Diadema y Campanita se suman: la media de 2 puntos da 12 (×6); la siguiente, solo ×2; la Campanita se gastó');
set role authenticated;
select public.com_comprar(:nami, '8102', 2);
reset role;
select prueba.ok((public.com_efecto(:nami, :'hoy', 3) ->> 'mult')::int = 4, 'con Diadema y Taza, la difícil vale ×4 (se suman)');
update public.pos_kv set value = jsonb_set(value, '{comodines,suman}', 'false') where key = 'misiones';
select prueba.ok((public.com_efecto(:nami, :'hoy', 3) ->> 'mult')::int = 2, 'si Gestión dice que no se suman, vale el mayor (×2)');
update public.pos_kv set value = jsonb_set(value, '{comodines,suman}', 'true') where key = 'misiones';

-- 5) Delantal (×2 la difícil) y Abanico (×2 sábado y domingo)
select prueba.ok(true, 'preparando el Delantal y el Abanico');
set role authenticated;
select public.com_comprar(:sol, '8105', 4) as rdel \gset
select public.com_comprar(:sol, '8105', 5) as raba \gset
reset role;
select prueba.ok((public.com_efecto(:sol, :'hoy', 3) ->> 'mult')::int = 2 * case when extract(isodow from :'hoy'::date) >= 6 then 2 else 1 end
  and (public.com_efecto(:sol, :'hoy', 1) ->> 'mult')::int = case when extract(isodow from :'hoy'::date) >= 6 then 2 else 1 end
  and (select extract(isodow from desde) in (6, 7) and extract(isodow from hasta) = 7 from public.com_compras where id = (:'raba'::jsonb ->> 'id')::bigint)
  and (public.com_efecto(:sol, (select desde from public.com_compras where id = (:'raba'::jsonb ->> 'id')::bigint), 1) ->> 'mult')::int = 2,
  'el Delantal duplica solo la difícil; el Abanico vale el sábado y el domingo (este o el que viene)');

-- 6) Pergaminos: misiones propias que suman a las del día
set role authenticated;
select public.com_comprar(:luz, '8103', 7) as rpf \gset
select public.com_comprar(:luz, '8103', 9) as rpd \gset
select public.com_comprar(:luz, '8103', 10) as rps \gset
select public.mis_estado(:luz, '8103') as el \gset
reset role;
select prueba.ok((select count(*) from jsonb_array_elements(:'el'::jsonb -> 'misiones') m where m ->> 'origen' = 'extra_facil' and (m ->> 'nivel')::int = 1 and (m ->> 'slot')::int = 11) = 1
  and (select count(*) from jsonb_array_elements(:'el'::jsonb -> 'misiones') m where m ->> 'origen' = 'sorpresa' and (m ->> 'sorpresa')::boolean
         and (m ->> 'puntos')::int between 1 and 5 and (m ->> 'slot')::int = 15) = 1
  and not exists (select 1 from jsonb_array_elements(:'el'::jsonb -> 'misiones') m where m ->> 'origen' = 'doble_media')
  and (select count(*) from public.mis_personal where employee_id = :luz and fecha = :'hoy') = 2,
  'el Pergamino fácil y el sorpresa le dan hoy una misión más cada uno (la sorpresa, de 1 a 5 puntos); el doble es para mañana');
select public.com_asignar(:luz, :'hoy'::date + 1);
select prueba.ok((select count(*) = 3 and count(*) filter (where nivel = 2 and slot in (12, 14)) = 2 from public.mis_personal where employee_id = :luz and fecha = :'hoy'::date + 1),
  'mañana tendrá las 2 medias del Pergamino doble y la fácil del Pergamino fácil (que dura 3 días)');
select prueba.ok((select bool_and(n = d) from (select fecha, count(*) n, count(distinct catalogo_id) d from public.mis_personal
                   where employee_id = :luz group by fecha) z),
  'las misiones de los pergaminos de un mismo día no se repiten entre sí');
-- Cumplir una misión del pergamino da sus puntos y su ficha, como las del día
update public.mis_personal set tipo = 'unidades', params = '{"n": 1, "cat": "Postres"}', texto = 'Vende 1 postre (pergamino)'
where employee_id = :luz and fecha = :'hoy' and slot = 11;
select pg_temp.pedido(:luz, pg_temp.a_las(:'hoy', 12), array['Dorayaki']);
select public.mis_revisar(:luz, :'hoy');
select prueba.ok(exists (select 1 from public.mis_logros where employee_id = :luz and fecha = :'hoy' and nivel = 11 and puntos = 1)
  and exists (select 1 from public.mis_logros where employee_id = :luz and fecha = :'hoy' and nivel = 1),
  'la fácil del pergamino se cumple aparte de la fácil del día (cada una con su punto)');

-- 7) Ficha de cambio: otra misión del mismo nivel en lugar de la de hoy
set role authenticated;
select public.com_comprar(:luz, '8103', 11, '{"nivel": 3}') as rcam \gset
reset role;
select prueba.ok((select origen = 'cambio' and nivel = 3 and texto <> 'Vende 4 postres' from public.com_misiones(:luz, :'hoy') where slot = 3)
  and (:'rcam'::jsonb ->> 'mensaje') like 'Tu nueva misión:%'
  and (select usado from public.com_compras where id = (:'rcam'::jsonb ->> 'id')::bigint),
  'la Ficha de cambio le pone otra difícil en lugar de la del día');
select prueba.falla(format('select public.com_comprar(%s, %L, 11, %L)', :luz, '8103', '{"nivel": 1}'), 'ya la cumpliste', 'no se cambia una misión ya cumplida');

-- 8) Mapa de Shibu: al día siguiente elige su media entre 3
set role authenticated;
select public.com_comprar(:luz, '8103', 12) as rmap \gset
reset role;
select prueba.ok((select desde = :'hoy'::date + 1 from public.com_compras where id = (:'rmap'::jsonb ->> 'id')::bigint), 'el Mapa vale para mañana');
update public.com_compras set desde = :'hoy', hasta = :'hoy' where id = (:'rmap'::jsonb ->> 'id')::bigint;   -- llegó el día
set role authenticated;
select public.mis_estado(:luz, '8103') as em \gset
reset role;
select prueba.ok(jsonb_array_length(:'em'::jsonb -> 'comodines' -> 'mapa' -> 'opciones') = 3
  and (:'em'::jsonb -> 'comodines' -> 'mapa' ->> 'actual') = 'Cierra 1 comanda de $10 o más',
  'ese día la tablet le muestra su media de hoy y 3 opciones para cambiarla');
select (:'em'::jsonb -> 'comodines' -> 'mapa' -> 'opciones' -> 1 ->> 'id')::bigint as opc \gset
select prueba.falla(format('select public.com_elegir_mapa(%s, %L, %s, %s)', :luz, '8103', :'rmap'::jsonb ->> 'id', (select max(id) + 1000 from public.mis_catalogo)),
  'no está en tu mapa', 'no puede elegir una misión que no está en su mapa');
set role authenticated;
select public.com_elegir_mapa(:luz, '8103', (:'rmap'::jsonb ->> 'id')::bigint, :opc);
reset role;
select prueba.ok((select catalogo_id = :opc and origen = 'mapa' from public.mis_personal where employee_id = :luz and fecha = :'hoy' and slot = 2)
  and (select usado from public.com_compras where id = (:'rmap'::jsonb ->> 'id')::bigint),
  'elige una de las 3 y queda como su misión media de hoy');

-- 9) Reloj de arena: un día de trabajo sin cumplir no corta la racha
insert into public.mis_logros (employee_id, fecha, nivel, texto, puntos) values (:sol, :'hoy'::date - 2, 1, 'Fácil', 1), (:sol, :'hoy', 1, 'Fácil', 1);
select pg_temp.pedido(:sol, pg_temp.a_las(:'hoy'::date - 1, 12), array['Teuchi']);
select pg_temp.pedido(:sol, pg_temp.a_las(:'hoy'::date - 2, 12), array['Teuchi']);
select prueba.ok((public.mis_medir(:sol, :'hoy', 'racha', '{"dias": 2, "nivel": 1}') ->> 'actual')::int = 1, 'sin reloj, ayer sin cumplir corta la racha');
set role authenticated;
select public.com_comprar(:sol, '8105', 13);
reset role;
select prueba.ok((public.mis_medir(:sol, :'hoy', 'racha', '{"dias": 2, "nivel": 1}') ->> 'actual')::int = 2
  and public.com_ocupados(:sol, :'hoy') = 2,
  'con el Reloj de arena, ayer no corta la racha (hoy y anteayer suman 2) y el reloj no ocupa lugar');

-- 10) Hora feliz: de 3 a 5 p. m., cada comanda suya de Ref 25 o más da +1 (máximo 3 al día)
set role authenticated;
select public.com_comprar(:nami, '8102', 31);
reset role;
select public.mis_saldo(:nami) as hn0 \gset
select pg_temp.pedido(:nami, pg_temp.a_las(:'hoy', 15), array['Teuchi', 'Teuchi', 'Teuchi', 'Teuchi', 'Teuchi']) from generate_series(1, 4);
select pg_temp.pedido(:nami, pg_temp.a_las(:'hoy', 18), array['Teuchi', 'Teuchi', 'Teuchi', 'Teuchi', 'Teuchi']);
select pg_temp.pedido(:nami, pg_temp.a_las(:'hoy', 16), array['Teuchi', 'Teuchi']);
select public.mis_revisar(:nami, :'hoy');
select public.mis_revisar(:nami, :'hoy');
select prueba.ok((select coalesce(sum(delta), 0) from public.mis_puntos where employee_id = :nami and motivo = 'hora_feliz:' || :'hoy') = 3,
  'la Hora feliz da +1 por cada comanda de Ref 25 o más de 3 a 5 p. m., hasta 3 (no cuenta la de las 6 ni la chica)');

-- 11) Juegos: Trébol (la ruleta gana 1 de cada 3), Tope abierto (5), Ficha dorada (devuelve la ficha) y Carta bajo la manga
select prueba.ok(array_length(public.jgo_casillas(:luz), 1) = 15 and public.jgo_tope(:luz) = 3, 'sin comodines, la ruleta tiene 15 casillas y el tope es 3');
set role authenticated;
select public.com_comprar(:luz, '8103', 17);
select public.com_comprar(:luz, '8103', 18);
select public.jgo_estado(:luz, '8103') as je \gset
reset role;
select prueba.ok(jsonb_array_length(:'je'::jsonb -> 'casillas') = 9 and (select count(*) from jsonb_array_elements_text(:'je'::jsonb -> 'casillas') c where c::int > 0) = 3
  and (:'je'::jsonb ->> 'tope_dia')::int = 5,
  'con el Trébol la rueda tiene 9 casillas y 3 premios (1 de cada 3); con el Tope abierto puede ganar 5 hoy');
select prueba.ok(exists (select 1 from public.com_activas(:luz, :'hoy'::date + 2) x where x.efecto = 'trebol')
  and not exists (select 1 from public.com_activas(:luz, :'hoy'::date + 3) x where x.efecto = 'trebol')
  and not exists (select 1 from public.com_activas(:luz, :'hoy'::date + 1) x where x.efecto = 'tope5'),
  'el Trébol dura 3 días (Edgar, 25/11: hoy, mañana y pasado); el Tope abierto, solo hoy');
insert into public.mis_fichas (employee_id, delta, motivo) values (:luz, 10, 'prueba');
set role authenticated;
select public.com_comprar(:luz, '8103', 19);
reset role;
select public.mis_fichas_saldo(:luz) as lf0 \gset
select public.jgo_dorada(:luz, true) as dor \gset
select prueba.ok(:'dor'::boolean and public.mis_fichas_saldo(:luz) = :lf0 + 1
  and (select usado from public.com_compras where employee_id = :luz and efecto = 'ficha_dorada') and not public.jgo_dorada(:luz, true),
  'la Ficha dorada: si la jugada pierde, le devuelve la ficha y se gasta (una sola vez)');
set role authenticated;
select public.com_comprar(:luz, '8103', 19);
select public.jgo_tragamonedas(:luz, '8103') as tg \gset
reset role;
select prueba.ok((:'tg'::jsonb ->> 'dorada')::boolean = ((:'tg'::jsonb ->> 'premio')::int = 0)
  and ((:'tg'::jsonb ->> 'dorada')::boolean is false or :'tg'::jsonb ->> 'mensaje' like '%ficha dorada te devolvió la ficha%')
  and not exists (select 1 from public.com_compras where employee_id = :luz and efecto = 'ficha_dorada' and not usado),
  'en el tragamonedas la Ficha dorada se gasta en la jugada y avisa si devolvió la ficha');
set role authenticated;
select public.com_comprar(:luz, '8103', 20);
select public.jgo_bj_empezar(:luz, '8103') as bj \gset
reset role;
select prueba.ok(case when :'bj'::jsonb ->> 'estado' = 'jugando'
                      then (:'bj'::jsonb ->> 'espia')::boolean and (:'bj'::jsonb -> 'crupier' -> 1) <> 'null'::jsonb
                      else true end,
  'con la Carta bajo la manga, en la mano de blackjack ve la carta tapada del crupier');

-- 12) Equipo: Bandera (una por día para todas), Regalo (3 puntos a otra) y Duelo (si vende más, +4)
set role authenticated;
select public.com_comprar(:mei, '8101', 21) as rban \gset
reset role;
select prueba.falla(format('select public.com_comprar(%s, %L, 21)', :nami, '8102'), 'hoy ya hay bandera', 'la Bandera es una por día para todo el equipo');
select public.mis_revisar(:nami, :'hoy');
select prueba.ok(not exists (select 1 from public.mis_puntos where motivo = 'bandera' and ref_id = (:'rban'::jsonb ->> 'id')::bigint)
  or (public.meta_dia(:'hoy') ->> 'meta') is not null, 'sin meta pasada, la bandera espera');
-- Una meta de prueba que el local ya pasó (la de verdad sale de las ventas de las semanas anteriores)
create or replace function public.meta_dia(p_dia date default null) returns jsonb language sql stable as $$ select '{"meta": 10, "vendido": 500}'::jsonb $$;
select public.mis_revisar(e, :'hoy') from unnest(array[:mei, :nami, :mei]::bigint[]) e;
select prueba.ok((select count(*) from public.mis_puntos where motivo = 'bandera' and ref_id = (:'rban'::jsonb ->> 'id')::bigint and employee_id in (:mei, :nami)) = 2
  and exists (select 1 from public.com_avisos where employee_id = :nami and texto like '%llegó a la meta%'),
  'cuando el local pasa la meta, cada maid que trabajó gana +1 una sola vez (y le avisa)');
create or replace function public.meta_dia(p_dia date default null) returns jsonb language sql stable as $$ select '{"meta": null}'::jsonb $$;
select public.mis_saldo(:sol) as so0 \gset
set role authenticated;
select public.com_comprar(:luz, '8103', 22, jsonb_build_object('para', :sol)) as rreg \gset
reset role;
select prueba.ok(public.mis_saldo(:sol) = :so0 + 3 and exists (select 1 from public.com_avisos where employee_id = :sol and texto like '%te regaló 3 puntos%'),
  'el Regalo le da 3 puntos a la compañera y le avisa');
select prueba.falla(format('select public.com_comprar(%s, %L, 22, %L)', :luz, '8103', jsonb_build_object('para', :mei)), 'una por semana', 'el Regalo es uno por semana');
select prueba.falla(format('select public.com_comprar(%s, %L, 23, %L)', :luz, '8103', jsonb_build_object('para', :luz)), 'elige a una compañera', 'no se reta a sí misma');
set role authenticated;
select public.com_comprar(:luz, '8103', 23, jsonb_build_object('para', :mei)) as rdue \gset
reset role;
select public.mis_saldo(:luz) as lu0 \gset
-- Luz vendió más que Mei hoy (5 Teuchi contra 1 Dorayaki)
select pg_temp.pedido(:luz, pg_temp.a_las(:'hoy', 20), array['Teuchi', 'Teuchi', 'Teuchi', 'Teuchi', 'Teuchi']);
select public.com_resolver_duelos(:'hoy');
select prueba.ok(public.mis_saldo(:luz) = :lu0 + 4 and (select datos ->> 'resultado' = 'gano' from public.com_compras where id = (:'rdue'::jsonb ->> 'id')::bigint)
  and exists (select 1 from public.com_avisos where employee_id = :mei and texto like '%te retó a un duelo%')
  and exists (select 1 from public.com_avisos where employee_id = :luz and texto like '%Ganaste el duelo%'),
  'el Duelo: al cerrar, si vendió más que su rival gana 4 puntos (y a la rival le llegó el aviso del reto)');
-- Si la retada no trabajó ese día, se devuelven los puntos
insert into public.com_compras (employee_id, comodin_id, efecto, puntos, desde, hasta, datos)
values (:nami, 23, 'duelo', 2, :'hoy'::date - 3, :'hoy'::date - 3, jsonb_build_object('rival', :caja)) returning id as dvoid \gset
select public.mis_saldo(:nami) as na0 \gset
select public.com_resolver_duelos(:'hoy');
select prueba.ok(public.mis_saldo(:nami) = :na0 + 2 and (select datos ->> 'resultado' = 'no_trabajo' from public.com_compras where id = :dvoid),
  'si la retada no trabajó ese día, el duelo no cuenta y le devuelven los puntos');
select (select id from public.com_avisos where employee_id = :sol order by id limit 1) as av \gset
set role authenticated;
select public.com_visto(:sol, '8105', array[:av]::bigint[]);
reset role;
select prueba.ok((select visto from public.com_avisos where id = :av), 'la tablet marca el aviso como visto');

-- 13) La máquina: Cupón (30 % menos en el próximo premio) y Premio sorpresa
select (select id from public.tienda_items where nombre = 'Taiyaki') taiyaki \gset
insert into public.tienda_canjes (employee_id, item_id, nombre, puntos, estado, regalo, at)
select e, :taiyaki, 'Taiyaki', 0, 'entregado', true, now() - interval '20 days' from unnest(array[:sol, :nami]::bigint[]) e;
set role authenticated;
select public.com_comprar(:sol, '8105', 24);
select public.mis_estado(:sol, '8105') as ec \gset
reset role;
select prueba.ok((:'ec'::jsonb ->> 'cupon')::boolean
  and (select (t ->> 'precio')::int = 4 and (t ->> 'puntos')::int = 5 from jsonb_array_elements(:'ec'::jsonb -> 'tienda') t where (t ->> 'id')::bigint = :taiyaki),
  'con el Cupón la máquina muestra los precios con 30 % menos (Taiyaki: 5 → 4)');
select public.mis_saldo(:sol) as sc0 \gset
set role authenticated;
select public.tienda_canjear(:sol, '8105', :taiyaki) as cj \gset
reset role;
select prueba.ok(public.mis_saldo(:sol) = :sc0 - 4 and (:'cj'::jsonb ->> 'cupon')::boolean
  and (select usado from public.com_compras where employee_id = :sol and efecto = 'cupon'),
  'el premio sale con el descuento y el Cupón se gasta');
set role authenticated;
select public.com_comprar(:nami, '8102', 25) as rsor \gset
reset role;
select prueba.ok((:'rsor'::jsonb -> 'premio' ->> 'id') is not null
  and (select nota = 'Premio sorpresa' and puntos = 7 and order_id is not null from public.tienda_canjes where id = (:'rsor'::jsonb -> 'premio' ->> 'id')::bigint),
  'el Premio sorpresa saca un premio al azar de la máquina y lo manda a cocina');

-- 14) Insignia de honor (nivel 4): para siempre, una de cada
set role authenticated;
select public.com_comprar(:mei, '8101', 30, '{"insignia": "ramen"}');
reset role;
select prueba.falla(format('select public.com_comprar(%s, %L, 30, %L)', :mei, '8101', '{"insignia": "ramen"}'), 'ya tienes esa insignia', 'la misma insignia no se compra dos veces');
select prueba.falla(format('select public.com_comprar(%s, %L, 30, %L)', :mei, '8101', '{"insignia": "pizza"}'), 'elige tu insignia', 'solo hay estrella, ramen o taiyaki');
select prueba.ok((select r -> 'insignias' from jsonb_array_elements(public.mis_ranking(:'hoy', :mei)) r where (r ->> 'yo')::boolean) is null
  or (select (r -> 'insignias') ? 'ramen' from jsonb_array_elements(public.mis_ranking(:'hoy', :mei)) r where (r ->> 'yo')::boolean),
  'el Top maid muestra sus insignias');

-- 15) Mejoras de nivel: un premio más al día (nivel 4), la ventana extra que rota (nivel 2) y la corona de Leyenda (nivel 5)
select prueba.ok((public.tienda_limites(:mei, :'hoy') ->> 'canjes_dia')::int = 3, 'con el nivel 4 puede pedir 3 premios al día (1 más)');
select public.tienda_vitrina_extra(:'hoy') as extra \gset
set role authenticated;
select public.mis_estado(:mei, '8101') as ev \gset
reset role;
select prueba.ok((select (t ->> 'extra')::boolean and t ->> 'bloqueo' is null from jsonb_array_elements(:'ev'::jsonb -> 'tienda') t where (t ->> 'id')::bigint = :extra),
  'con el nivel 2 se abre la ventana extra que rota');
select prueba.ok((select bool_and((r ->> 'corona')::boolean) from jsonb_array_elements(public.mis_ranking(:'hoy', :mei)) r), 'en el Top maid, las de nivel 5 llevan corona');
update public.pos_kv set value = value - 'estrellas_niveles' where key = 'misiones';
select prueba.ok((public.tienda_limites(:mei, :'hoy') ->> 'canjes_dia')::int = 2
  and public.tienda_bloqueo(:extra, :'hoy', public.tienda_limites(:mei, :'hoy'), public.mis_estrellas(:mei, :'hoy')) = 'nivel',
  'sin estrellas vuelve a 2 premios al día y la ventana extra queda cerrada');
select prueba.falla(format('select public.tienda_canjear(%s, %L, %s)', :mei, '8101', :extra), 'se abre con el nivel 2', 'la ventana extra no se compra sin el nivel 2');

-- 17) El sorteo de la máquina (Edgar, 25/11): cada maid ve cada día sus 3 comodines, sacados de todos (los de un nivel que no
-- tiene salen con candado); el que compra queda «Comprado» hasta el sorteo de mañana
update public.pos_kv set value = jsonb_set(value, '{comodines,vitrina}', '3') where key = 'misiones';
insert into public.employees (name, job_title, pos_can_charge, pos_pin_hash) values ('Rin Comodín', 'Maid', false, extensions.crypt('8106', extensions.gen_salt('bf')));
select id as rin from public.employees where name = 'Rin Comodín' \gset
insert into public.mis_puntos (employee_id, delta, motivo) values (:rin, 200, 'prueba');
select prueba.ok(cardinality(public.com_sorteo(:rin, :'hoy')) = 3 and (select count(distinct x) from unnest(public.com_sorteo(:rin, :'hoy')) x) = 3
  and public.com_sorteo(:rin, :'hoy') = public.com_sorteo(:rin, :'hoy')
  and (select count(distinct public.com_sorteo(:rin, :'hoy'::date + d)) from generate_series(0, 6) d) >= 5
  and (select count(distinct public.com_sorteo(e, :'hoy')) from unnest(array[:mei, :nami, :luz, :sol, :rin]::bigint[]) e) >= 4,
  'cada maid tiene su sorteo de 3 comodines distintos, el mismo todo el día y otro al día siguiente');
select prueba.ok((select count(distinct x) from generate_series(0, 89) d, unnest(public.com_sorteo(:rin, :'hoy'::date + d)) x) = 25,
  'el sorteo sale de todos los comodines de la máquina (en 90 días le salen los 25)');
set role authenticated;
select public.mis_estado(:rin, '8106') as es \gset
reset role;
select prueba.ok(jsonb_array_length(:'es'::jsonb -> 'comodines' -> 'catalogo') = 3 and (:'es'::jsonb -> 'comodines' ->> 'vitrina')::int = 3
  and (select array_agg((k ->> 'id')::int order by (k ->> 'id')::int) from jsonb_array_elements(:'es'::jsonb -> 'comodines' -> 'catalogo') k)
      = (select array_agg(x order by x) from unnest(public.com_sorteo(:rin, :'hoy')) x)
  and not exists (select 1 from jsonb_array_elements(:'es'::jsonb -> 'comodines' -> 'catalogo') k
                  where ((k ->> 'nivel')::int > 0) <> (k ->> 'bloqueo' is not distinct from 'nivel')),
  'la tablet ve solo sus 3 del día; los de un nivel que no tiene salen con candado');
-- Con todos los niveles abiertos, compra uno de los suyos (el primero que no sea la Bandera ni la Ficha de cambio)
update public.pos_kv set value = value || '{"estrellas_niveles": [0, 0, 0, 0, 0]}'::jsonb where key = 'misiones';
select x as dentro from unnest(public.com_sorteo(:rin, :'hoy')) with ordinality u(x, o) join public.com_catalogo k on k.id = u.x
where k.efecto not in ('bandera', 'cambio') order by u.o limit 1 \gset
select k.id as fuera from public.com_catalogo k where k.nivel is not null and public.com_listo(k.efecto)
  and not (k.id = any (public.com_sorteo(:rin, :'hoy'))) order by k.id limit 1 \gset
select prueba.falla(format('select public.com_comprar(%s, %L, %s)', :rin, '8106', :fuera), 'no te salió hoy', 'el que no le salió hoy no se compra');
set role authenticated;
select public.com_comprar(:rin, '8106', :dentro, jsonb_build_object('para', :mei, 'insignia', 'estrella'));
select public.mis_estado(:rin, '8106') as es2 \gset
reset role;
select prueba.ok(jsonb_array_length(:'es2'::jsonb -> 'comodines' -> 'catalogo') = 3
  and (select k ->> 'bloqueo' from jsonb_array_elements(:'es2'::jsonb -> 'comodines' -> 'catalogo') k where (k ->> 'id')::int = :dentro) = 'comprado'
  and public.com_bloqueo(:rin, :'hoy'::date + 1, :dentro, 5) is distinct from 'comprado',
  'el que compró queda «Comprado» en su lugar hasta el sorteo de mañana');
select prueba.falla(format('select public.com_comprar(%s, %L, %s, %L)', :rin, '8106', :dentro, jsonb_build_object('para', :mei, 'insignia', 'ramen')),
  'ya lo compraste hoy', 'no se compra dos veces el mismo día');
update public.pos_kv set value = value - 'estrellas_niveles' where key = 'misiones';

-- 16) Permisos y Gestión
set role authenticated;
select prueba.falla(format('select public.com_premiar(%s, %L, 1, 1, 1)', :mei, :'hoy'), 'permission denied', 'la tablet no llama a las funciones internas de los comodines');
select prueba.falla(format('select public.com_comprar(%s, %L, 2)', :mei, '0000'), 'PIN', 'sin el PIN correcto no se compra');
reset role;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false) \gset x_
select public.gestion_misiones() as g \gset
select prueba.ok(jsonb_array_length(:'g'::jsonb -> 'comodines') = 31 and jsonb_array_length(:'g'::jsonb -> 'com_compras') > 10,
  'Gestión ve el catálogo de comodines y las últimas compras');
select prueba.falla($q$select public.gestion_misiones_ajustes('{"comodines": {"activos": 2, "semana": 3, "vitrina": 40}}')$q$, 'de 0 a 30 en la vitrina',
  'en Gestión la vitrina de comodines va de 0 (todos) a 30');
rollback;
\echo 'TODAS LAS PRUEBAS DE COMODINES PASARON'
