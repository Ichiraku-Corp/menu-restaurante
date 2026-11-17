-- Mesa ocupada: el mapa dice quién está tomando el pedido; si otra persona entra, se le pregunta y, si entra igual,
-- a la primera se le cierra la mesa en su tablet (su próximo aviso le dice quién entró).
\set ON_ERROR_STOP 1
\set QUIET 1
select (select id from public.employees where name = 'Cajera Prueba') caja, (select id from public.employees where name = 'Mesera Prueba') mesera,
       (select t.id from public.pos_tables t where t.active and not exists (select 1 from public.pos_orders o where o.table_id = t.id and o.status = 'abierta') order by t.id limit 1) mesa,
       not exists (select 1 from public.pos_sessions where status = 'abierta') hay_que_abrir \gset
select public.pos_emp_name(:mesera) as nmesera, public.pos_emp_name(:caja) as ncaja \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
\if :hay_que_abrir
select public.pos_cash_open(:caja, '1111', 0, 0);
\endif
select public.pos_open(:mesera, '2222', :mesa, '') as o \gset

-- 1) La mesera abre la mesa: el mapa lo dice
select prueba.ok((public.pos_atender(:mesera, '2222', :o, 'Tablet Feria #a1', false) ->> 'ok')::boolean, 'la mesera abre la mesa y queda tomando el pedido');
select prueba.ok((select x -> 'atiende' ->> 'name' = :'nmesera' and x -> 'atiende' ->> 'dev' = 'Tablet Feria #a1'
                  from jsonb_array_elements(public.pos_state() -> 'orders') x where (x ->> 'id')::bigint = :o),
  'en el mapa, la mesa dice quién está tomando el pedido');
reset role;
select started_at as t0 from public.pos_atendiendo where order_id = :o \gset
update public.pos_atendiendo set started_at = started_at - interval '2 minutes', seen_at = seen_at - interval '5 seconds' where order_id = :o;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.ok((public.pos_atender(:mesera, '2222', :o, 'Tablet Feria #a1', false) ->> 'ok')::boolean, 'su tablet sigue avisando que está en la mesa');
reset role;
select prueba.ok((select started_at < :'t0'::timestamptz and seen_at > now() - interval '2 seconds' from public.pos_atendiendo where order_id = :o),
  'el aviso renueva la mesa sin cambiar desde cuándo la atiende');
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);

-- 2) Otra persona (u otra tablet) entra: se le avisa quién está
select public.pos_atender(:caja, '1111', :o, 'Caja #b2', false) as r1 \gset
select prueba.ok(not (:'r1'::jsonb ->> 'ok')::boolean and :'r1'::jsonb ->> 'por' = :'nmesera',
  'si otra persona entra, le avisa quién está tomando el pedido');
select prueba.ok(not (public.pos_atender(:mesera, '2222', :o, 'Tablet Barra #c3', false) ->> 'ok')::boolean,
  'la misma mesera desde otra tablet también recibe el aviso');

-- 3) «Entrar igual»: se la quita, queda en el registro, y a la primera su próximo aviso le dice quién entró
select public.pos_atender(:caja, '1111', :o, 'Caja #b2', true) as r2 \gset
select prueba.ok((:'r2'::jsonb ->> 'ok')::boolean and :'r2'::jsonb ->> 'quitada_a' = :'nmesera', 'al entrar igual, se le quita la mesa a la mesera');
select public.pos_atender(:mesera, '2222', :o, 'Tablet Feria #a1', false) as r3 \gset
select prueba.ok(not (:'r3'::jsonb ->> 'ok')::boolean and :'r3'::jsonb ->> 'por' = :'ncaja',
  'a la mesera su tablet le dice quién entró (y se le cierra la mesa)');
select prueba.ok((select x -> 'atiende' ->> 'name' = :'ncaja' from jsonb_array_elements(public.pos_state() -> 'orders') x where (x ->> 'id')::bigint = :o),
  'el mapa ahora dice que la atiende quien entró');
reset role;
select prueba.ok(exists (select 1 from public.pos_log where action = 'tomar_mesa' and order_id = :o and employee_id = :caja and detail ->> 'a' = :'nmesera'),
  'queda en el registro quién le quitó la mesa a quién');

-- 4) A los 30 segundos sin aviso (tablet apagada o sin señal), la mesa queda libre sola
update public.pos_atendiendo set seen_at = now() - interval '31 seconds' where order_id = :o;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.ok((select x -> 'atiende' is null or x -> 'atiende' = 'null'::jsonb from jsonb_array_elements(public.pos_state() -> 'orders') x where (x ->> 'id')::bigint = :o),
  'a los 30 segundos sin aviso, el mapa ya no dice que alguien la atiende');
select prueba.ok((public.pos_atender(:mesera, '2222', :o, 'Tablet Feria #a1', false) ->> 'ok')::boolean, 'y cualquiera puede entrar sin aviso');

-- 5) Volver al mapa la deja libre (solo la tablet que la tenía)
select public.pos_soltar(:caja, '1111', :o, 'Caja #b2');
select prueba.ok((select x -> 'atiende' ->> 'name' = :'nmesera' from jsonb_array_elements(public.pos_state() -> 'orders') x where (x ->> 'id')::bigint = :o),
  'otra tablet no puede soltar la mesa de la mesera');
select public.pos_soltar(:mesera, '2222', :o, 'Tablet Feria #a1');
select prueba.ok((select x -> 'atiende' is null or x -> 'atiende' = 'null'::jsonb from jsonb_array_elements(public.pos_state() -> 'orders') x where (x ->> 'id')::bigint = :o),
  'al volver al mapa, la mesa queda libre de inmediato');

-- 6) PIN, pedido cerrado y permisos
select prueba.falla($$select public.pos_atender($$ || :mesera || $$, '9999', $$ || :o || $$, 'x', false)$$, 'PIN incorrecto', 'sin el PIN correcto no se puede tomar una mesa');
select public.pos_cancel(:caja, '1111', :o, '');
select prueba.ok((public.pos_atender(:mesera, '2222', :o, 'Tablet Feria #a1', false) ->> 'cerrada')::boolean, 'un pedido ya cerrado no se toma (la tablet vuelve al mapa)');
reset role;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select prueba.falla('select public.pos_atender(1, ''1'', 1, ''x'', true)', 'permission denied', 'el público no puede tomar mesas');
select prueba.falla('select * from public.pos_atendiendo', 'permission denied', 'el público no ve quién atiende las mesas');
reset role;
select set_config('request.jwt.claims', '', false);

\echo 'TODAS LAS PRUEBAS DE MESA OCUPADA PASARON'
