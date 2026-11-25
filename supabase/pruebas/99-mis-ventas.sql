-- «Mis ventas» en Mi perfil (pedido de Edgar, 24/11): lo que la maid vendió hoy, en la semana y en el mes, sus últimos
-- 14 días, sus comandas de la última semana y sus platos más vendidos. Cuenta igual que las misiones: solo lo que ella
-- anotó, en pedidos cobrados, sin anulados, sin premios de Ref 0, sin Yummy y sin lo de otras.
-- Todo en una transacción que se deshace al final.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;

insert into public.employees (name, job_title, pos_can_charge, pos_pin_hash) values
  ('Mei Prueba', 'Maid · Mei', false, extensions.crypt('8181', extensions.gen_salt('bf'))),
  ('Nami Prueba', 'Maid · Nami', false, extensions.crypt('8282', extensions.gen_salt('bf')));
select (select id from public.employees where name = 'Mei Prueba') mei, (select id from public.employees where name = 'Nami Prueba') nami,
       public.mis_hoy() hoy, (select id from public.pos_tables order by area, number limit 1) mesa1,
       (select area || ' ' || number from public.pos_tables order by area, number limit 1) mesa1_nombre \gset
-- Horas fijas en Venezuela (la prueba no depende de la hora a la que corre)
create function pg_temp.a_las(p_dia date, p_hora int) returns timestamptz language sql immutable as $$
  select (p_dia + make_time(p_hora, 0, 0)) at time zone 'America/Caracas' $$;
create function pg_temp.pedido(p_emp bigint, p_cuando timestamptz, p_platos text[], p_kind text default 'mesa', p_mesa bigint default null,
                               p_num int default null, p_estado text default 'cobrada', p_canal text default null) returns bigint
language plpgsql as $$
declare oid bigint; d text;
begin
  insert into public.pos_orders (kind, table_id, label, status, opened_by, opened_at, closed_by, closed_at, day_number)
  values (p_kind, p_mesa, 'Cliente Prueba', p_estado, p_emp, p_cuando - interval '25 minutes', p_emp,
          case when p_estado = 'cobrada' then p_cuando end, p_num) returning id into oid;
  if p_canal is not null then update public.pos_orders set channel = p_canal where id = oid; end if;
  foreach d in array p_platos loop
    insert into public.pos_items (order_id, dish_id, name, qty, unit_price, status, created_by, created_at, sent_at)
    select oid, x.id, x.name, 1, 5, 'enviado', p_emp, p_cuando - interval '24 minutes', p_cuando - interval '22 minutes'
    from public.dishes x where x.name = d;
  end loop;
  return oid;
end $$;

-- Hoy: una mesa (Teuchi + Té Verde = 10) y un para llevar #7 (2 Dorayaki = 10). En el para llevar también hay un plato
-- de Nami, uno anulado de Mei y un premio de Ref 0 de Mei: ninguno de esos cuenta para Mei.
select pg_temp.pedido(:mei, pg_temp.a_las(:'hoy', 10), array['Teuchi', 'Té Verde'], 'mesa', :mesa1) as oa \gset
select pg_temp.pedido(:mei, pg_temp.a_las(:'hoy', 12), array['Dorayaki', 'Dorayaki'], 'llevar', null, 7) as ob \gset
insert into public.pos_items (order_id, dish_id, name, qty, unit_price, status, created_by, created_at, sent_at)
select :ob, x.id, x.name, 1, 5, 'enviado', :nami, now(), now() from public.dishes x where x.name = 'Taiyaki';
insert into public.pos_items (order_id, dish_id, name, qty, unit_price, status, created_by, created_at, sent_at)
select :ob, x.id, x.name, 1, 5, 'anulado', :mei, now(), now() from public.dishes x where x.name = 'Teuchi';
insert into public.pos_items (order_id, dish_id, name, qty, unit_price, status, created_by, created_at, sent_at)
select :ob, x.id, x.name, 1, 0, 'enviado', :mei, now(), now() from public.dishes x where x.name = 'Dorayaki';
-- Ayer: un Teuchi (5). Hace 20 días: 3 Teuchi (15). Hoy también: un pedido de Yummy y uno abierto (no cuentan).
select pg_temp.pedido(:mei, pg_temp.a_las(:'hoy'::date - 1, 13), array['Teuchi']) as oc \gset
select pg_temp.pedido(:mei, pg_temp.a_las(:'hoy'::date - 20, 12), array['Teuchi', 'Teuchi', 'Teuchi']);
select pg_temp.pedido(:mei, pg_temp.a_las(:'hoy', 14), array['Teuchi'], 'delivery', null, null, 'cobrada', 'yummy');
select pg_temp.pedido(:mei, pg_temp.a_las(:'hoy', 15), array['Teuchi'], 'mesa', null, null, 'abierta');

-- La tablet le pregunta con su PIN
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.mis_ventas(:mei, '8181') as v \gset
select public.mis_ventas(:nami, '8282') as vn \gset
reset role;
select (:'hoy'::date - (extract(isodow from :'hoy'::date)::int - 1)) lunes, date_trunc('month', :'hoy'::date)::date mes0 \gset

-- 1) Hoy, la semana y el mes
select prueba.ok((:'v'::jsonb -> 'hoy' ->> 'monto')::numeric = 20 and (:'v'::jsonb -> 'hoy' ->> 'comandas')::int = 2
  and (:'v'::jsonb -> 'hoy' ->> 'platos')::numeric = 4,
  'hoy vendió Ref 20 en 2 comandas con 4 platos (sin el anulado, el premio de Ref 0, Yummy, el abierto ni el plato de otra)');
select prueba.ok((:'v'::jsonb -> 'semana' ->> 'monto')::numeric = 20 + case when :'hoy'::date - 1 >= :'lunes'::date then 5 else 0 end
  and :'v'::jsonb ->> 'lunes' = :'lunes',
  'la semana cuenta desde el lunes');
select prueba.ok((:'v'::jsonb -> 'mes_total' ->> 'monto')::numeric = 20 + case when :'hoy'::date - 1 >= :'mes0'::date then 5 else 0 end
                                                                        + case when :'hoy'::date - 20 >= :'mes0'::date then 15 else 0 end
  and (:'v'::jsonb -> 'mejor_dia' ->> 'fecha') = :'hoy' and (:'v'::jsonb -> 'mejor_dia' ->> 'monto')::numeric = 20,
  'el mes suma todo lo del mes y su mejor día es hoy (Ref 20)');

-- 2) Los últimos 14 días, uno por uno (también los días sin ventas), iguales a lo que miden las misiones
select prueba.ok(jsonb_array_length(:'v'::jsonb -> 'dias') = 14
  and :'v'::jsonb -> 'dias' -> 13 ->> 'fecha' = :'hoy' and (:'v'::jsonb -> 'dias' -> 13 ->> 'monto')::numeric = 20
  and (:'v'::jsonb -> 'dias' -> 12 ->> 'monto')::numeric = 5 and (:'v'::jsonb -> 'dias' -> 12 ->> 'comandas')::int = 1
  and (:'v'::jsonb -> 'dias' -> 0 ->> 'monto')::numeric = 0,
  'los últimos 14 días: hoy Ref 20, ayer Ref 5 y los días sin ventas en 0');
select prueba.ok(not exists (select 1 from jsonb_array_elements(:'v'::jsonb -> 'dias') d
                             where (d ->> 'monto')::numeric <> public.mis_venta_dia(:mei, (d ->> 'fecha')::date)),
  'cada día da lo mismo que miden las misiones (mis_venta_dia)');

-- 3) Las comandas de la última semana: la más nueva primero, con su mesa, número y lo que llevaba
select prueba.ok(jsonb_array_length(:'v'::jsonb -> 'comandas') = 3
  and (:'v'::jsonb -> 'comandas' -> 0 ->> 'id')::bigint = :ob and (:'v'::jsonb -> 'comandas' -> 1 ->> 'id')::bigint = :oa
  and (:'v'::jsonb -> 'comandas' -> 2 ->> 'id')::bigint = :oc,
  'salen sus 3 comandas de la semana, la más nueva primero (la de hace 20 días no sale en la lista)');
select prueba.ok(:'v'::jsonb -> 'comandas' -> 0 ->> 'mesa' = 'Para llevar' and (:'v'::jsonb -> 'comandas' -> 0 ->> 'numero')::int = 7
  and :'v'::jsonb -> 'comandas' -> 0 ->> 'detalle' = '2× Dorayaki' and (:'v'::jsonb -> 'comandas' -> 0 ->> 'monto')::numeric = 10
  and :'v'::jsonb -> 'comandas' -> 1 ->> 'mesa' = :'mesa1_nombre'
  and :'v'::jsonb -> 'comandas' -> 1 ->> 'detalle' ~ 'Teuchi' and :'v'::jsonb -> 'comandas' -> 1 ->> 'detalle' ~ 'Té Verde'
  and :'v'::jsonb -> 'comandas' -> 2 ->> 'detalle' = 'Teuchi',
  'cada comanda dice su mesa («' || :'mesa1_nombre' || '» o «Para llevar» #7), lo que llevaba («2× Dorayaki») y su total, sin el nombre del cliente');
select prueba.ok(position('Cliente' in (:'v'::jsonb -> 'comandas')::text) = 0,
  'el nombre del cliente de un para llevar no sale en el historial');

-- 4) Los platos más vendidos del mes son solo los suyos
select prueba.ok(exists (select 1 from jsonb_array_elements(:'v'::jsonb -> 'platos_top') p where p ->> 'nombre' = 'Dorayaki' and (p ->> 'qty')::numeric = 2)
  and not exists (select 1 from jsonb_array_elements(:'v'::jsonb -> 'platos_top') p where p ->> 'nombre' = 'Taiyaki')
  and jsonb_array_length(:'v'::jsonb -> 'platos_top') <= 5,
  'sus platos más vendidos del mes: 2 Dorayaki (el premio de Ref 0 no suma) y nada de lo que anotó otra');

-- 5) Cada una ve lo suyo: Nami solo tiene su Taiyaki en el para llevar
select prueba.ok((:'vn'::jsonb -> 'hoy' ->> 'monto')::numeric = 5 and jsonb_array_length(:'vn'::jsonb -> 'comandas') = 1
  and :'vn'::jsonb -> 'comandas' -> 0 ->> 'detalle' = 'Taiyaki',
  'en una comanda compartida, a cada una le cuenta solo lo que anotó ella');

-- 6) Con el PIN equivocado no se ve nada, y desde afuera tampoco
set role authenticated;
select prueba.falla(format('select public.mis_ventas(%s, %L)', :mei, '0000'), 'PIN', 'con el PIN equivocado no se ven las ventas');
reset role;
select prueba.ok(not has_function_privilege('anon', 'public.mis_ventas(bigint, text)', 'execute')
  and has_function_privilege('authenticated', 'public.mis_ventas(bigint, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.mis_items_rango(bigint, date, date)', 'execute')
  and not has_function_privilege('anon', 'public.mis_items_rango(bigint, date, date)', 'execute'),
  'solo la tablet con sesión puede pedir «Mis ventas»; la función interna no se llama desde afuera');

select set_config('request.jwt.claims', '', false);
rollback;
\echo TODAS LAS PRUEBAS DE MIS VENTAS PASARON
