-- Meta del día: promedio del mismo día de la semana (8 semanas, solo días con ventas) contra lo cobrado hoy
\set ON_ERROR_STOP 1
\set QUIET 1
select (select id from public.employees where name = 'Cajera Prueba') caja, (select id from public.employees where name = 'Mesera Prueba') mesera,
       (now() at time zone 'America/Caracas')::date hoy \gset
-- Mismo día de la semana: hace 1, 2, 4 semanas (400, 500, 600) y uno cerrado (0); otro día y uno de hace 9 semanas no cuentan
insert into public.daily_sales (sale_date, total, source) values
  (:'hoy'::date - 7, 400, 'prueba'), (:'hoy'::date - 14, 500, 'prueba'), (:'hoy'::date - 21, 0, 'prueba'), (:'hoy'::date - 28, 600, 'prueba'),
  (:'hoy'::date - 1, 9999, 'prueba'), (:'hoy'::date - 63, 10000, 'prueba')
on conflict (sale_date) do update set total = excluded.total, source = excluded.source;
select coalesce(sum(t.subtotal - t.discount + t.delivery), 0) as vendido from public.pos_orders o cross join lateral public.pos_totals(o.id) t
 where o.status = 'cobrada' and (o.closed_at at time zone 'America/Caracas')::date = :'hoy'::date \gset

set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_meta(:caja, '1111') as m \gset
select prueba.ok((:'m'::jsonb ->> 'meta')::numeric = 500 and (:'m'::jsonb ->> 'dias')::int = 3 and (:'m'::jsonb ->> 'promedio')::numeric = 500,
  'la meta es el promedio de ese día de la semana (Ref 400, 500 y 600 → Ref 500), sin días cerrados ni otros días');
select prueba.ok((:'m'::jsonb ->> 'vendido')::numeric = round(:vendido, 2), 'compara con lo cobrado hoy sin servicio (Ref ' || round(:vendido, 2) || ')');
select prueba.falla(format('select public.pos_meta(%s, %L)', :mesera, '2222'), 'permiso para cobrar', 'en la caja la ve solo quien cobra');
select prueba.falla(format('select public.pos_meta(%s, %L)', :caja, '9999'), 'PIN incorrecto', 'pide el PIN correcto');
select prueba.falla('select public.gestion_meta()', 'Sin permiso', 'una tablet no la pide por Gestión');
select prueba.falla('select public.meta_dia(null)', 'permission denied', 'el cálculo interno no se llama desde afuera');

select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
update public.gestion_settings set meta_pct = 10;
select prueba.ok((public.gestion_meta() ->> 'meta')::numeric = 550, 'con «promedio + 10 %» la meta sube a Ref 550 (redondeada a Ref 5)');
update public.gestion_settings set meta_pct = 3;
select prueba.ok((public.gestion_meta() ->> 'meta')::numeric = 515, 'redondea hacia arriba a Ref 5 (Ref 515 con 3 %)');
select prueba.falla('update public.gestion_settings set meta_pct = 500', 'meta_pct_check', 'el % de la meta tiene un límite razonable');
select prueba.ok((public.gestion_inicio() ->> 'ventas')::numeric = (public.gestion_meta() ->> 'vendido')::numeric,
  'Inicio y la meta muestran la misma venta de hoy (sin el servicio)');
update public.gestion_settings set meta_pct = 0;
reset role;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select prueba.falla(format('select public.pos_meta(%s, %L)', :caja, '1111'), 'permission denied', 'el público no ve la meta');
reset role;
delete from public.daily_sales where source = 'prueba';
-- Sin historia de ese día de la semana no hay meta
select prueba.ok(public.meta_dia(null) ->> 'meta' is null and (public.meta_dia(null) ->> 'dias')::int = 0, 'sin ventas de ese día en 8 semanas, no hay meta');
select set_config('request.jwt.claims', '', false);
\echo 'TODAS LAS PRUEBAS DE LA META DEL DÍA PASARON'
