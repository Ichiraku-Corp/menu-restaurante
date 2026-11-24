-- ============================================================================
-- Misiones de Shibu (pedido de Edgar, 24/11/2026)
-- Cada día Shibu da 3 misiones a las meseras y cajeras: fácil (1 punto), media (2) y difícil (3).
-- El sistema las mide solo con lo que cada una anota y cobra. Cada misión cumplida da sus puntos (para la
-- tienda de premios: la maid compra y el premio sale a cocina) y 1 ficha para los juegos. Jugando se ganan como máximo
-- 3 puntos al día.
-- Las tablets solo llegan aquí por funciones con PIN (pos_auth); Gestión, con can_manage.
-- ============================================================================

-- ---------------------------------------------------------------- Ajustes y quién juega
-- pos_kv 'misiones': {"activo": true, "juegos": true, "tope_juegos": 3, "plato_semana": "Tonkotsu"}
create or replace function public.mis_ajustes() returns jsonb
language sql stable security definer set search_path = public as $$
  select '{"activo": true, "juegos": true, "tope_juegos": 3, "plato_semana": ""}'::jsonb
         || coalesce((select value from public.pos_kv where key = 'misiones'), '{}'::jsonb)
$$;

-- Juegan las meseras (Maid…) y las cajeras; se puede forzar por persona con employees.juega_misiones
alter table public.employees add column if not exists juega_misiones boolean;
create or replace function public.mis_juega(p_emp bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select e.active and coalesce(e.juega_misiones, coalesce(e.job_title, '') ~* '^\s*(maid|meser|cajer)')
                   from public.employees e where e.id = p_emp), false)
$$;

-- Meseras o cajeras: cada grupo tiene sus misiones del día (las de caja solo las puede cumplir quien cobra)
create or replace function public.mis_grupo(p_emp bigint) returns text
language sql stable security definer set search_path = public as $$
  select case when coalesce((select e.job_title from public.employees e where e.id = p_emp), '') ~* '^\s*caj' then 'cajeras' else 'meseras' end
$$;
-- Un número del 0 al 99, fijo para cada día y misión (para las que salen con una frecuencia, como la #43 al 40 %)
create or replace function public.mis_azar(p_fecha date, p_id bigint) returns int language sql immutable as $$
  select (('x' || substr(md5(p_fecha::text || '#' || p_id::text), 1, 7))::bit(28)::int % 100) $$;
-- ¿Hay una promoción activa ese día? (las misiones de «la promo del día» solo salen así)
create or replace function public.mis_hay_promo(p_fecha date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.promos p where p.active and extract(isodow from p_fecha)::int = any (p.days)
                 and (p.date_from is null or p.date_from <= p_fecha) and (p.date_to is null or p.date_to >= p_fecha)) $$;

-- Hoy en Venezuela, y qué tipo de día es (con los datos de noviembre: martes y miércoles flojos, sábado y domingo fuertes)
create or replace function public.mis_hoy() returns date language sql stable as $$ select (now() at time zone 'America/Caracas')::date $$;
create or replace function public.mis_tipo_dia(p_fecha date) returns text language sql immutable as $$
  select case extract(isodow from p_fecha)::int when 2 then 'flojos' when 3 then 'flojos' when 6 then 'fuertes' when 7 then 'fuertes' else 'normales' end
$$;

-- ---------------------------------------------------------------- Tablas
create table if not exists public.mis_catalogo (
  id         bigserial primary key,
  numero     int unique,                       -- número en la lista de Edgar (1 a 100)
  texto      text not null,
  nivel      smallint not null check (nivel between 1 and 3),
  dias       text not null default 'todos' check (dias in ('todos', 'flojos', 'normales', 'fuertes')),
  tipo       text not null,
  params     jsonb not null default '{}'::jsonb,
  activa     boolean not null default false,
  updated_at timestamptz not null default now());
-- Para quién es (todas, solo meseras o solo cajeras) y si es la misión extra que sale todos los días (la 4.ª)
alter table public.mis_catalogo add column if not exists para  text not null default 'todas' check (para in ('todas', 'meseras', 'cajeras'));
alter table public.mis_catalogo add column if not exists extra boolean not null default false;

-- Las misiones de cada día: 3 (fácil, media y difícil) + la extra (nivel 0), unas para las meseras y otras para las cajeras
create table if not exists public.mis_dia (
  fecha       date not null,
  grupo       text not null default 'meseras' check (grupo in ('meseras', 'cajeras')),
  nivel       smallint not null check (nivel between 0 and 3),
  catalogo_id bigint references public.mis_catalogo(id) on delete set null,
  texto       text not null,
  tipo        text not null,
  params      jsonb not null default '{}'::jsonb,
  puntos      int not null,
  primary key (fecha, grupo, nivel));
-- (por si la tabla venía de antes, con las mismas 3 para todas)
alter table public.mis_dia add column if not exists grupo text not null default 'meseras';
do $$
begin
  if (select array_length(conkey, 1) from pg_constraint where conname = 'mis_dia_pkey' and conrelid = 'public.mis_dia'::regclass) <> 3 then
    alter table public.mis_dia drop constraint mis_dia_pkey;
    alter table public.mis_dia add primary key (fecha, grupo, nivel);
  end if;
  alter table public.mis_dia drop constraint if exists mis_dia_nivel_check;
  alter table public.mis_dia add constraint mis_dia_nivel_check check (nivel between 0 and 3);
end $$;

create table if not exists public.mis_logros (
  id          bigserial primary key,
  employee_id bigint not null references public.employees(id) on delete cascade,
  fecha       date not null,
  nivel       smallint not null,
  texto       text not null,
  puntos      int not null,
  at          timestamptz not null default now(),
  visto       boolean not null default false,
  unique (employee_id, fecha, nivel));

-- La bienvenida de Shibu sale la primera vez del día
create table if not exists public.mis_saludos (
  employee_id bigint not null references public.employees(id) on delete cascade,
  fecha       date not null,
  primary key (employee_id, fecha));

-- Movimientos: el saldo es la suma (misiones y juegos suman; canjes restan; un canje rechazado devuelve)
create table if not exists public.mis_puntos (
  id          bigserial primary key,
  employee_id bigint not null references public.employees(id) on delete cascade,
  delta       int not null,
  motivo      text not null,
  ref_id      bigint,
  at          timestamptz not null default now());
create table if not exists public.mis_fichas (
  id          bigserial primary key,
  employee_id bigint not null references public.employees(id) on delete cascade,
  delta       int not null,
  motivo      text not null,
  ref_id      bigint,
  at          timestamptz not null default now());
create index if not exists mis_puntos_emp on public.mis_puntos (employee_id, at);
create index if not exists mis_fichas_emp on public.mis_fichas (employee_id, at);

create table if not exists public.tienda_items (
  id         bigserial primary key,
  nombre     text not null unique,
  puntos     int not null check (puntos between 1 and 1000),
  dish_id    bigint references public.dishes(id) on delete set null,
  variant    text not null default '',
  activo     boolean not null default true,
  orden      int not null default 0,
  created_at timestamptz not null default now());

create table if not exists public.tienda_canjes (
  id           bigserial primary key,
  employee_id  bigint not null references public.employees(id) on delete cascade,
  item_id      bigint references public.tienda_items(id) on delete set null,
  nombre       text not null,
  puntos       int not null,
  estado       text not null default 'pendiente' check (estado in ('pendiente', 'entregado', 'rechazado')),
  at           timestamptz not null default now(),
  resuelto_at  timestamptz,
  resuelto_por bigint references public.employees(id) on delete set null,
  order_id     bigint references public.pos_orders(id) on delete set null,
  nota         text not null default '');

create table if not exists public.jgo_partidas (
  id          bigserial primary key,
  employee_id bigint not null references public.employees(id) on delete cascade,
  juego       text not null check (juego in ('tragamonedas', 'ruleta', 'blackjack')),
  apuesta     text not null default '',
  resultado   jsonb not null default '{}'::jsonb,
  premio      int not null default 0,
  estado      text not null default 'terminada' check (estado in ('jugando', 'terminada')),
  mazo        jsonb,                              -- blackjack: cartas que quedan (nunca sale a la tablet)
  at          timestamptz not null default now());

alter table public.mis_catalogo enable row level security;
alter table public.mis_dia enable row level security;
alter table public.mis_logros enable row level security;
alter table public.mis_saludos enable row level security;
alter table public.mis_puntos enable row level security;
alter table public.mis_fichas enable row level security;
alter table public.tienda_items enable row level security;
alter table public.tienda_canjes enable row level security;
alter table public.jgo_partidas enable row level security;

-- ---------------------------------------------------------------- Saldos
create or replace function public.mis_saldo(p_emp bigint) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(delta), 0)::int from public.mis_puntos where employee_id = p_emp $$;
create or replace function public.mis_fichas_saldo(p_emp bigint) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(delta), 0)::int from public.mis_fichas where employee_id = p_emp $$;
create or replace function public.jgo_ganado_hoy(p_emp bigint) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(delta), 0)::int from public.mis_puntos
  where employee_id = p_emp and motivo like 'juego:%' and delta > 0 and (at at time zone 'America/Caracas')::date = public.mis_hoy() $$;

-- ---------------------------------------------------------------- Lo que cuenta para las misiones
-- Comandas de una persona en un día: lo que ella anotó en pedidos cobrados ese día. No cuentan los platos anulados,
-- los de Ref 0 (canjes y premios), Yummy ni el consumo de empleados.
create or replace function public.mis_items(p_emp bigint, p_fecha date)
returns table (order_id bigint, qty numeric, monto numeric, dish_id bigint, nombre text, variant text, promo text,
               es_extra boolean, cat text, kind text, abierta timestamptz, cerrada timestamptz, enviada timestamptz)
language sql stable security definer set search_path = public as $$
  select i.order_id, i.qty, i.qty * i.unit_price, i.dish_id, coalesce(d.name, i.name), coalesce(i.variant, ''), coalesce(i.promo, ''),
         coalesce(c.es_extra, false) or i.extra_de is not null, coalesce(c.name, ''), o.kind, o.opened_at, o.closed_at, i.sent_at
  from public.pos_orders o
  join public.pos_items i on i.order_id = o.id
  left join public.dishes d on d.id = i.dish_id
  left join public.categories c on c.id = d.category_id
  where o.status = 'cobrada'
    and o.closed_at >= (p_fecha::timestamp at time zone 'America/Caracas') and o.closed_at < ((p_fecha + 1)::timestamp at time zone 'America/Caracas')
    and i.created_by = p_emp and i.status <> 'anulado' and i.unit_price > 0
    and coalesce(o.channel, 'propio') <> 'yummy'
    and not exists (select 1 from public.pos_payments p where p.order_id = o.id and p.method in ('cuenta', 'yummy'))
$$;

create or replace function public.mis_comandas(p_emp bigint, p_fecha date)
returns table (order_id bigint, monto numeric, platos numeric, postres numeric, bebida boolean, ramen boolean, entrada boolean,
               kind text, abierta timestamptz, cerrada timestamptz, enviada timestamptz)
language sql stable security definer set search_path = public as $$
  select order_id, sum(monto), coalesce(sum(qty) filter (where not es_extra), 0), coalesce(sum(qty) filter (where cat = 'Postres'), 0),
         bool_or(cat = 'Bebidas'), bool_or(cat = 'Ramen'), bool_or(cat = 'Entradas'), min(kind), min(abierta), max(cerrada), min(enviada)
  from public.mis_items(p_emp, p_fecha) group by order_id
$$;

-- Venta de una persona en un día (para comparar con ayer o con la semana)
create or replace function public.mis_venta_dia(p_emp bigint, p_fecha date) returns numeric
language sql stable security definer set search_path = public as $$ select coalesce(sum(monto), 0) from public.mis_items(p_emp, p_fecha) $$;

-- Si trabajó ese día (anotó algo o cobró algo): las misiones de equipo y las del cierre solo se dan a quien trabajó
create or replace function public.mis_trabajo(p_emp bigint, p_fecha date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.mis_items(p_emp, p_fecha))
      or exists (select 1 from public.pos_orders o where o.closed_by = p_emp and o.status = 'cobrada'
                 and o.closed_at >= (p_fecha::timestamp at time zone 'America/Caracas') and o.closed_at < ((p_fecha + 1)::timestamp at time zone 'America/Caracas'))
$$;

-- Tipos que se pueden medir hoy; los demás quedan «pendiente» (no se pueden activar)
create or replace function public.mis_tipo_medible(p_tipo text) returns boolean language sql immutable as $$
  select p_tipo in ('comandas', 'atendidas', 'ventas', 'unidades', 'distintos', 'secciones', 'comandas_con', 'promedio', 'primera',
                    'platos_comanda', 'vs_ayer', 'vs_semana', 'top_ventas', 'equipo_meta', 'equipo_unidades', 'sellos', 'clientes_nuevos',
                    'para_llevar', 'delivery', 'rapidas', 'express', 'sin_anulaciones', 'sin_bajas', 'proporcion', 'vuelven', 'opiniones',
                    'nombrada', 'sin_quejas', 'racha', 'cierre_cuadrado')
$$;
-- Las que solo se saben al cerrar la caja
create or replace function public.mis_tipo_cierre(p_tipo text) returns boolean language sql immutable as $$
  select p_tipo in ('top_ventas', 'sin_anulaciones', 'sin_bajas', 'proporcion', 'sin_quejas', 'cierre_cuadrado') $$;

-- Cuánto lleva y cuánto pide la misión: {"actual": 2, "meta": 3}
create or replace function public.mis_medir(p_emp bigint, p_fecha date, p_tipo text, p_params jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare n numeric := coalesce((p_params ->> 'n')::numeric, 1); v_monto numeric := coalesce((p_params ->> 'monto')::numeric, 0);
  a numeric := 0; m numeric := n; x record; nombres text[]; desde int := (p_params ->> 'desde')::int; hasta int := (p_params ->> 'hasta')::int;
  dia0 timestamptz := p_fecha::timestamp at time zone 'America/Caracas'; dia1 timestamptz := (p_fecha + 1)::timestamp at time zone 'America/Caracas';
  meta numeric; previo numeric;
begin
  if p_params ? 'nombres' then select array_agg(value) into nombres from jsonb_array_elements_text(p_params -> 'nombres'); end if;
  if coalesce((p_params ->> 'semana')::boolean, false) then
    nombres := array[nullif(public.mis_ajustes() ->> 'plato_semana', '')];
  end if;
  case p_tipo
  when 'comandas' then
    select count(*) into a from public.mis_comandas(p_emp, p_fecha) c
    where c.monto >= v_monto
      and (desde is null or extract(hour from c.cerrada at time zone 'America/Caracas') >= desde)
      and (hasta is null or extract(hour from c.cerrada at time zone 'America/Caracas') < hasta);
  when 'atendidas' then select count(*) into a from public.mis_comandas(p_emp, p_fecha);
  when 'ventas' then a := round(public.mis_venta_dia(p_emp, p_fecha), 2); m := v_monto;
  when 'unidades' then
    select coalesce(sum(i.qty), 0) into a from public.mis_items(p_emp, p_fecha) i
    where (not p_params ? 'cat' or i.cat = p_params ->> 'cat')
      and (not coalesce((p_params ->> 'grande')::boolean, false) or i.variant ilike 'gr%')
      and (not coalesce((p_params ->> 'extras')::boolean, false) or i.es_extra)
      and (not coalesce((p_params ->> 'promo')::boolean, false) or i.promo <> '')
      and (nombres is null or i.nombre = any (nombres));
  when 'distintos' then
    select count(distinct i.dish_id) into a from public.mis_items(p_emp, p_fecha) i where i.cat = p_params ->> 'cat';
  when 'secciones' then
    select count(distinct i.cat) into a from public.mis_items(p_emp, p_fecha) i
    where i.cat in ('Entradas', 'Ramen', 'Sushi', 'Especiales', 'Postres', 'Bebidas');
  when 'comandas_con' then
    select count(*) into a from public.mis_comandas(p_emp, p_fecha) c
    where case p_params ->> 'con' when 'postre' then c.postres >= 1 when '2postres' then c.postres >= 2
               when 'postres' then c.postres >= coalesce((p_params ->> 'min')::numeric, 2)
               when 'bebida_ramen' then c.bebida and c.ramen when 'completa' then c.entrada and c.ramen and c.bebida and c.postres >= 1 else false end;
  when 'promedio' then
    select case when count(*) >= coalesce((p_params ->> 'minimo')::int, 1) then round(avg(c.monto), 2) else 0 end into a
    from public.mis_comandas(p_emp, p_fecha) c;
    m := v_monto;
  when 'primera' then
    select coalesce((select c.monto from public.mis_comandas(p_emp, p_fecha) c order by c.cerrada limit 1), 0) into a; m := v_monto;
  when 'platos_comanda' then
    select count(*) into a from public.mis_comandas(p_emp, p_fecha) c where c.platos >= coalesce((p_params ->> 'platos')::numeric, 1);
  when 'vs_ayer' then
    -- el último día anterior en que vendió algo (máximo una semana atrás)
    select z.v into previo from (select g, public.mis_venta_dia(p_emp, p_fecha - g) v from generate_series(1, 7) g) z where z.v > 0 order by z.g limit 1;
    a := public.mis_venta_dia(p_emp, p_fecha); m := coalesce(previo, 0) + 0.01;
  when 'vs_semana' then
    select avg(v) into previo from (select public.mis_venta_dia(p_emp, p_fecha - g) v from generate_series(1, 7) g) z where v > 0;
    a := public.mis_venta_dia(p_emp, p_fecha); m := round(coalesce(previo, 0), 2) + 0.01;
  when 'top_ventas' then
    a := public.mis_venta_dia(p_emp, p_fecha);
    select coalesce(max(public.mis_venta_dia(e.id, p_fecha)), 0) into m from public.employees e where public.mis_juega(e.id) and e.id <> p_emp;
    m := greatest(m + 0.01, 0.01);
  when 'equipo_meta' then
    meta := (public.meta_dia(p_fecha) ->> 'meta')::numeric;
    a := coalesce((public.meta_dia(p_fecha) ->> 'vendido')::numeric, 0);
    m := case when meta is null then 1e12 else round(meta * coalesce((p_params ->> 'pct')::numeric, 100) / 100, 2) end;
  when 'equipo_unidades' then
    select coalesce(sum(i.qty), 0) into a from public.employees e cross join lateral public.mis_items(e.id, p_fecha) i
    where public.mis_juega(e.id) and (not p_params ? 'cat' or i.cat = p_params ->> 'cat');
  when 'sellos' then
    select count(*) into a from public.pos_orders o where o.closed_by = p_emp and o.status = 'cobrada' and o.sello
      and o.closed_at >= dia0 and o.closed_at < dia1;
  when 'clientes_nuevos' then
    select count(distinct o.customer_id) into a from public.pos_orders o join public.customers k on k.id = o.customer_id
    where o.status = 'cobrada' and o.closed_at >= dia0 and o.closed_at < dia1 and k.created_at >= dia0 and k.created_at < dia1
      and (o.closed_by = p_emp or exists (select 1 from public.pos_items i where i.order_id = o.id and i.created_by = p_emp and i.status <> 'anulado'));
  when 'para_llevar' then select count(*) into a from public.mis_comandas(p_emp, p_fecha) c where c.kind = 'llevar';
  when 'delivery' then
    select count(*) into a from public.pos_orders o where o.kind = 'delivery' and coalesce(o.channel, 'propio') = 'propio' and o.status = 'cobrada'
      and (o.opened_by = p_emp or o.closed_by = p_emp) and o.closed_at >= dia0 and o.closed_at < dia1;
  when 'rapidas' then
    select count(*) into a from public.mis_comandas(p_emp, p_fecha) c
    where c.enviada is not null and c.enviada - c.abierta <= make_interval(mins => coalesce((p_params ->> 'minutos')::int, 5));
  when 'express' then
    select count(*) into a from public.mis_comandas(p_emp, p_fecha) c
    where c.cerrada - c.abierta <= make_interval(mins => coalesce((p_params ->> 'minutos')::int, 30));
  when 'sin_anulaciones' then
    -- 1 si trabajó y no le anularon nada en el día
    select case when exists (select 1 from public.mis_items(p_emp, p_fecha)) and not exists (
             select 1 from public.pos_items i where i.created_by = p_emp and i.status = 'anulado' and i.voided_at >= dia0 and i.voided_at < dia1)
           then 1 else 0 end into a;
    m := 1;
  when 'proporcion' then
    -- al cierre: postre en al menos «pct» % de sus comandas, con un mínimo de comandas (la 45)
    select case when count(*) >= coalesce((p_params ->> 'minimo')::int, 1)
                 and count(*) filter (where c.postres >= 1) * 100 >= coalesce((p_params ->> 'pct')::numeric, 50) * count(*) then 1 else 0 end
      into a from public.mis_comandas(p_emp, p_fecha) c;
    m := 1;
  when 'vuelven' then
    -- clientes que ya habían venido antes (con «visitas»: los que llegan a esa visita o más), en los pedidos de hoy donde ella
    -- anotó (las 63, 64 y 65; los clientes salen de los datos que se piden al cobrar)
    select count(distinct o.customer_id) into a from public.pos_orders o
    where o.customer_id is not null and o.status = 'cobrada' and o.closed_at >= dia0 and o.closed_at < dia1
      and exists (select 1 from public.pos_items i where i.order_id = o.id and i.created_by = p_emp and i.status <> 'anulado')
      and (select count(*) from public.pos_orders o2 where o2.customer_id = o.customer_id and o2.status = 'cobrada' and o2.closed_at < o.closed_at)
          >= coalesce((p_params ->> 'visitas')::int, 2) - 1;
  when 'opiniones' then
    -- opiniones que los clientes respondieron hoy (QR del recibo), con «estrellas» o más, de pedidos donde ella anotó (la 69)
    select count(*) into a from public.opiniones op
    where op.answered_at >= dia0 and op.answered_at < dia1 and op.rating >= coalesce((p_params ->> 'estrellas')::int, 5)
      and exists (select 1 from public.pos_items i where i.order_id = op.order_id and i.created_by = p_emp and i.status <> 'anulado');
  when 'nombrada' then
    -- una opinión de hoy, de un pedido suyo, que dice su nombre (el primero, como palabra entera) (la 72)
    select count(*) into a from public.opiniones op
    where op.answered_at >= dia0 and op.answered_at < dia1 and op.comment <> ''
      and exists (select 1 from public.pos_items i where i.order_id = op.order_id and i.created_by = p_emp and i.status <> 'anulado')
      and op.comment ~* ('\m' || regexp_replace(split_part(trim(coalesce((select e.name from public.employees e where e.id = p_emp), '')), ' ', 1),
                                                 '([^[:alnum:]])', '\\\1', 'g') || '\M');
  when 'sin_quejas' then
    -- al cierre: al menos «minimo» opiniones de hoy en sus pedidos y ninguna de 3 estrellas o menos (la 73)
    select case when count(*) >= coalesce((p_params ->> 'minimo')::int, 2) and count(*) filter (where op.rating <= 3) = 0 then 1 else 0 end
      into a from public.opiniones op
    where op.answered_at >= dia0 and op.answered_at < dia1 and op.rating is not null
      and exists (select 1 from public.pos_items i where i.order_id = op.order_id and i.created_by = p_emp and i.status <> 'anulado');
    m := 1;
  when 'racha' then
    -- días de trabajo seguidos, hasta hoy, en que cumplió la misión de «nivel» (o al menos una, si no dice nivel) (las 91 y 92).
    -- Cuenta como día de trabajo el día en que anotó o cobró algo; la racha se completa cuando hoy también está cumplido.
    m := coalesce((p_params ->> 'dias')::numeric, 3);
    declare dia date; hoy_ok boolean := false;
    begin
      for dia in
        select z.d from (
          select (i.created_at at time zone 'America/Caracas')::date d from public.pos_items i
          where i.created_by = p_emp and i.status <> 'anulado' and i.created_at >= ((p_fecha - 30)::timestamp at time zone 'America/Caracas') and i.created_at < dia1
          union
          select (o.closed_at at time zone 'America/Caracas')::date from public.pos_orders o
          where o.closed_by = p_emp and o.status = 'cobrada' and o.closed_at >= ((p_fecha - 30)::timestamp at time zone 'America/Caracas') and o.closed_at < dia1
          union select p_fecha) z
        order by z.d desc
      loop
        if exists (select 1 from public.mis_logros l where l.employee_id = p_emp and l.fecha = dia
                   and (not p_params ? 'nivel' or l.nivel = (p_params ->> 'nivel')::int)) then
          a := a + 1;
          if dia = p_fecha then hoy_ok := true; end if;
        elsif dia <> p_fecha then
          exit;
        end if;
        exit when a >= m;
      end loop;
      if not hoy_ok then a := least(a, m - 1); end if;
    end;
  when 'cierre_cuadrado' then
    -- al cierre (cajera): cerró la caja de ese día, contó algo y la diferencia total quedó por debajo de «monto» Ref (la 97)
    select case when exists (
             select 1 from public.pos_sessions s
             where s.closed_by = p_emp and s.status = 'cerrada' and (s.opened_at at time zone 'America/Caracas')::date = p_fecha
               and exists (select 1 from jsonb_object_keys(s.counted) k where k not like '\_%' and jsonb_typeof(s.counted -> k) = 'number')
               and (select coalesce(sum(abs((s.counted ->> k)::numeric - coalesce((s.expected ->> k)::numeric, 0))
                              / case when k in ('efectivo_bs', 'pago_movil', 'punto_debito', 'punto_credito') then nullif(public.pos_rate(), 0) else 1 end), 0)
                    from jsonb_object_keys(s.counted) k where k not like '\_%' and jsonb_typeof(s.counted -> k) = 'number')
                   < coalesce((p_params ->> 'monto')::numeric, 1))
           then 1 else 0 end into a;
    m := 1;
  when 'sin_bajas' then
    -- al cierre: 1 si cerró al menos «minimo» comandas y ninguna suya quedó por debajo de «monto»
    select case when count(*) >= coalesce((p_params ->> 'minimo')::int, 1) and min(c.monto) >= v_monto then 1 else 0 end into a
    from public.mis_comandas(p_emp, p_fecha) c;
    m := 1;
  else a := 0; m := 1e12;  -- todavía no se puede medir
  end case;
  return jsonb_build_object('actual', coalesce(a, 0), 'meta', m);
end $$;

-- ---------------------------------------------------------------- Las misiones del día
-- Se eligen la primera vez que alguien las pide, para las meseras y para las cajeras por separado: una por nivel (1, 2 y 3)
-- y la extra (nivel 0), entre las activas para ese grupo y ese tipo de día, sin repetir la de ayer si hay otra. Las de un
-- tipo de día concreto van primero ese día. Las que tienen «frecuencia» salen ese porcentaje de los días (y ese día
-- van primero); las del plato de la semana, solo si hay plato elegido; las de la promo del día, solo si hay promo.
create or replace function public.mis_asignar(p_fecha date) returns void
language plpgsql security definer set search_path = public as $$
declare t text := public.mis_tipo_dia(p_fecha); g text; n int; c record;
  plato text := coalesce(public.mis_ajustes() ->> 'plato_semana', ''); promo boolean := public.mis_hay_promo(p_fecha);
begin
  foreach g in array array['meseras', 'cajeras'] loop
    for n in 0..3 loop
      if exists (select 1 from public.mis_dia where fecha = p_fecha and grupo = g and nivel = n) then continue; end if;
      select k.* into c from public.mis_catalogo k
      where k.activa and k.para in ('todas', g) and k.dias in ('todos', t) and public.mis_tipo_medible(k.tipo)
        and case when n = 0 then k.extra else not k.extra and k.nivel = n end
        and (not coalesce((k.params ->> 'semana')::boolean, false) or plato <> '')
        and (not coalesce((k.params ->> 'promo')::boolean, false) or promo)
        and (not k.params ? 'frecuencia' or public.mis_azar(p_fecha, k.id) < (k.params ->> 'frecuencia')::int)
      order by (k.params ? 'frecuencia') desc,
               (k.id is not distinct from (select d.catalogo_id from public.mis_dia d where d.fecha = p_fecha - 1 and d.grupo = g and d.nivel = n)),
               (k.dias = t) desc, md5(p_fecha::text || '-' || g || '-' || k.id::text)
      limit 1;
      if c.id is null then continue; end if;
      insert into public.mis_dia (fecha, grupo, nivel, catalogo_id, texto, tipo, params, puntos)
      values (p_fecha, g, n, c.id,
              c.texto || case when coalesce((c.params ->> 'semana')::boolean, false) then ' (' || plato || ')' else '' end,
              c.tipo, c.params, c.nivel)
      on conflict do nothing;
    end loop;
  end loop;
end $$;

-- Revisa las misiones de una persona y anota las que cumplió (cada una una sola vez): puntos + 1 ficha.
-- p_cierre = true al cerrar la caja (ahí se miden las que solo se saben al final del día).
create or replace function public.mis_revisar(p_emp bigint, p_fecha date, p_cierre boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare d record; r jsonb; lid bigint; nuevos int := 0;
begin
  if not public.mis_juega(p_emp) or not coalesce((public.mis_ajustes() ->> 'activo')::boolean, true) then return 0; end if;
  for d in select * from public.mis_dia where fecha = p_fecha and grupo = public.mis_grupo(p_emp) order by nivel loop
    if exists (select 1 from public.mis_logros where employee_id = p_emp and fecha = p_fecha and nivel = d.nivel) then continue; end if;
    if public.mis_tipo_cierre(d.tipo) and not p_cierre then continue; end if;
    if (d.tipo like 'equipo_%' or public.mis_tipo_cierre(d.tipo)) and not public.mis_trabajo(p_emp, p_fecha) then continue; end if;
    r := public.mis_medir(p_emp, p_fecha, d.tipo, d.params);
    if (r ->> 'actual')::numeric >= (r ->> 'meta')::numeric then
      insert into public.mis_logros (employee_id, fecha, nivel, texto, puntos) values (p_emp, p_fecha, d.nivel, d.texto, d.puntos)
        on conflict do nothing returning id into lid;
      if lid is not null then
        insert into public.mis_puntos (employee_id, delta, motivo, ref_id) values (p_emp, d.puntos, 'mision', lid);
        insert into public.mis_fichas (employee_id, delta, motivo, ref_id) values (p_emp, 1, 'mision', lid);
        nuevos := nuevos + 1;
      end if;
    end if;
  end loop;
  return nuevos;
end $$;

-- Al cobrar un pedido: se revisan las misiones de quienes anotaron, abrieron o cobraron (y de todas si hoy hay una de equipo).
-- Nunca frena un cobro: cualquier problema aquí se ignora.
create or replace function public.mis_tras_cobro() returns trigger
language plpgsql security definer set search_path = public as $$
declare f date; e bigint;
begin
  begin
    f := (new.closed_at at time zone 'America/Caracas')::date;
    perform public.mis_asignar(f);
    for e in
      select distinct x from (
        select i.created_by x from public.pos_items i where i.order_id = new.id
        union select new.opened_by union select new.closed_by
        union select emp.id from public.employees emp
         where exists (select 1 from public.mis_dia d where d.fecha = f and d.tipo like 'equipo_%') and public.mis_juega(emp.id)) z
      where x is not null
    loop
      perform public.mis_revisar(e, f, false);
    end loop;
  exception when others then null;
  end;
  return null;
end $$;
drop trigger if exists mis_tras_cobro on public.pos_orders;
create trigger mis_tras_cobro after update of status on public.pos_orders
  for each row when (new.status = 'cobrada' and old.status is distinct from 'cobrada') execute function public.mis_tras_cobro();

-- Al cerrar la caja: se miden las misiones del final del día para todas las que trabajaron
create or replace function public.mis_tras_cierre() returns trigger
language plpgsql security definer set search_path = public as $$
declare f date; e bigint;
begin
  begin
    f := (new.opened_at at time zone 'America/Caracas')::date;
    for e in select id from public.employees where public.mis_juega(id) loop
      perform public.mis_revisar(e, f, true);
    end loop;
  exception when others then null;
  end;
  return null;
end $$;
drop trigger if exists mis_tras_cierre on public.pos_sessions;
create trigger mis_tras_cierre after update of status on public.pos_sessions
  for each row when (new.status = 'cerrada' and old.status is distinct from 'cerrada') execute function public.mis_tras_cierre();

-- ---------------------------------------------------------------- Para la tablet
-- Todo lo que la tablet muestra: misiones con su avance, puntos, fichas, tienda y misiones recién cumplidas (para celebrar).
create or replace function public.mis_estado(p_emp bigint, p_pin text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare f date := public.mis_hoy(); aj jsonb := public.mis_ajustes(); juega boolean;
begin
  perform public.pos_auth(p_emp, p_pin);
  juega := public.mis_juega(p_emp);
  if not juega or not coalesce((aj ->> 'activo')::boolean, true) then
    return jsonb_build_object('juega', false, 'activo', coalesce((aj ->> 'activo')::boolean, true));
  end if;
  perform public.mis_asignar(f);
  perform public.mis_revisar(p_emp, f, false);
  return jsonb_build_object(
    'juega', true, 'activo', true, 'fecha', f, 'tipo_dia', public.mis_tipo_dia(f),
    'nombre', (select name from public.employees where id = p_emp),
    'saludo_hoy', exists (select 1 from public.mis_saludos where employee_id = p_emp and fecha = f),
    'misiones', coalesce((select jsonb_agg(jsonb_build_object('nivel', d.nivel, 'texto', d.texto, 'puntos', d.puntos, 'tipo', d.tipo,
                  'actual', (m ->> 'actual')::numeric, 'meta', (m ->> 'meta')::numeric, 'al_cierre', public.mis_tipo_cierre(d.tipo),
                  'equipo', d.tipo like 'equipo_%', 'extra', d.nivel = 0, 'hecha', l.id is not null) order by d.nivel = 0, d.nivel)
                from public.mis_dia d
                left join public.mis_logros l on l.employee_id = p_emp and l.fecha = d.fecha and l.nivel = d.nivel
                cross join lateral (select public.mis_medir(p_emp, f, d.tipo, d.params) m) z
                where d.fecha = f and d.grupo = public.mis_grupo(p_emp)), '[]'::jsonb),
    'grupo', public.mis_grupo(p_emp),
    'nuevos', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'nivel', l.nivel, 'texto', l.texto, 'puntos', l.puntos) order by l.at)
                from public.mis_logros l where l.employee_id = p_emp and not l.visto), '[]'::jsonb),
    'puntos', public.mis_saldo(p_emp), 'fichas', public.mis_fichas_saldo(p_emp),
    'tienda', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'nombre', t.nombre, 'puntos', t.puntos) order by t.orden, t.puntos, t.nombre)
                from public.tienda_items t where t.activo), '[]'::jsonb),
    'canjes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'puntos', c.puntos, 'estado', c.estado, 'at', c.at) order by c.at desc)
                from (select * from public.tienda_canjes where employee_id = p_emp order by at desc limit 10) c), '[]'::jsonb),
    'juegos', jsonb_build_object('activo', coalesce((aj ->> 'juegos')::boolean, true), 'tope_dia', coalesce((aj ->> 'tope_juegos')::int, 3),
                                 'ganado_hoy', public.jgo_ganado_hoy(p_emp)));
end $$;

-- La tablet avisa que ya mostró la bienvenida de hoy y las celebraciones
create or replace function public.mis_marcar(p_emp bigint, p_pin text, p_saludo boolean default false, p_logros bigint[] default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.pos_auth(p_emp, p_pin);
  if coalesce(p_saludo, false) then
    insert into public.mis_saludos (employee_id, fecha) values (p_emp, public.mis_hoy()) on conflict do nothing;
  end if;
  if p_logros is not null then
    update public.mis_logros set visto = true where employee_id = p_emp and id = any (p_logros);
  end if;
end $$;

-- ---------------------------------------------------------------- Tienda de premios
-- Compra directa (pedido de Edgar, 24/11): si le alcanzan los puntos, el premio sale a cocina en Ref 0 como un pedido
-- para llevar marcado como premio (se imprime su comanda y descuenta el inventario) y queda en el cierre de esta caja.
create or replace function public.tienda_canjear(p_emp bigint, p_pin text, p_item bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it record; cid bigint; oid bigint; sess bigint; quien text;
begin
  perform public.pos_auth(p_emp, p_pin);
  if not public.mis_juega(p_emp) then raise exception 'La tienda es para las meseras y cajeras'; end if;
  select * into it from public.tienda_items where id = p_item and activo;
  if it.id is null then raise exception 'Ese premio ya no está en la tienda'; end if;
  perform pg_advisory_xact_lock(hashtext('tienda'), p_emp::int);
  if public.mis_saldo(p_emp) < it.puntos then
    raise exception 'Te faltan % puntos para %', it.puntos - public.mis_saldo(p_emp), it.nombre;
  end if;
  select id into sess from public.pos_sessions where status = 'abierta' order by id desc limit 1;
  if sess is null then raise exception 'La caja está cerrada: los premios se piden con la caja abierta'; end if;
  select name into quien from public.employees where id = p_emp;
  insert into public.tienda_canjes (employee_id, item_id, nombre, puntos, estado, resuelto_at, resuelto_por)
  values (p_emp, it.id, it.nombre, it.puntos, 'entregado', now(), p_emp) returning id into cid;
  insert into public.mis_puntos (employee_id, delta, motivo, ref_id) values (p_emp, -it.puntos, 'canje', cid);
  if it.dish_id is not null then
    oid := public.pos_open(p_emp, p_pin, null, left('Premio: ' || coalesce(quien, ''), 40));
    perform public.pos_add(p_emp, p_pin, oid, jsonb_build_array(jsonb_build_object('dish_id', it.dish_id, 'variant', it.variant, 'qty', 1,
                                                                                   'notes', 'Premio de misiones de ' || coalesce(quien, ''))));
    -- Ref 0, pero con lo que vale en la carta (list_price) para el cierre
    update public.pos_items set list_price = coalesce(list_price, unit_price), unit_price = 0, promo = 'Premio de misiones' where order_id = oid;
    perform public.pos_send(p_emp, p_pin, oid);
    update public.pos_orders set status = 'cobrada', premio = true, closed_by = p_emp, closed_at = now(), session_id = sess, rate = public.pos_rate()
    where id = oid;
    update public.tienda_canjes set order_id = oid where id = cid;
  end if;
  insert into public.pos_log (employee_id, action, order_id, detail)
  values (p_emp, 'canje_entregado', oid, jsonb_build_object('canje', cid, 'premio', it.nombre, 'puntos', it.puntos));
  return jsonb_build_object('id', cid, 'nombre', it.nombre, 'order_id', oid, 'puntos', public.mis_saldo(p_emp));
end $$;
-- Antes la cajera aprobaba cada premio; ya no hace falta (la compra es directa)
drop function if exists public.tienda_pendientes(bigint, text);
drop function if exists public.tienda_resolver(bigint, text, bigint, boolean, text);

-- ---------------------------------------------------------------- Juegos (el resultado lo decide la base, nunca la tablet)
-- Gasta 1 ficha. Frena si los juegos están apagados, si ya ganó el tope de hoy o si no tiene fichas.
create or replace function public.jgo_gastar_ficha(p_emp bigint, p_juego text) returns void
language plpgsql security definer set search_path = public as $$
declare aj jsonb := public.mis_ajustes(); tope int := coalesce((aj ->> 'tope_juegos')::int, 3);
begin
  if not public.mis_juega(p_emp) then raise exception 'Los juegos son para las meseras y cajeras'; end if;
  if not coalesce((aj ->> 'juegos')::boolean, true) then raise exception 'Los juegos están apagados por hoy'; end if;
  perform pg_advisory_xact_lock(hashtext('juegos'), p_emp::int);
  if public.jgo_ganado_hoy(p_emp) >= tope then raise exception 'Ya ganaste el tope de hoy (% puntos). ¡Vuelve mañana!', tope; end if;
  if public.mis_fichas_saldo(p_emp) < 1 then raise exception 'No tienes fichas: cumple una misión para ganar una'; end if;
  insert into public.mis_fichas (employee_id, delta, motivo) values (p_emp, -1, 'juego:' || p_juego);
end $$;

-- Anota el premio sin pasar el tope del día; devuelve lo que de verdad ganó
create or replace function public.jgo_pagar(p_emp bigint, p_juego text, p_premio int, p_partida bigint) returns int
language plpgsql security definer set search_path = public as $$
declare tope int := coalesce((public.mis_ajustes() ->> 'tope_juegos')::int, 3); gana int;
begin
  gana := greatest(least(coalesce(p_premio, 0), tope - public.jgo_ganado_hoy(p_emp)), 0);
  if gana > 0 then insert into public.mis_puntos (employee_id, delta, motivo, ref_id) values (p_emp, gana, 'juego:' || p_juego, p_partida); end if;
  update public.jgo_partidas set premio = gana where id = p_partida;
  return gana;
end $$;

create or replace function public.jgo_contadores(p_emp bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('fichas', public.mis_fichas_saldo(p_emp), 'puntos', public.mis_saldo(p_emp), 'ganado_hoy', public.jgo_ganado_hoy(p_emp),
                            'tope_dia', coalesce((public.mis_ajustes() ->> 'tope_juegos')::int, 3))
$$;

create or replace function public.jgo_estado(p_emp bigint, p_pin text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.pos_auth(p_emp, p_pin);
  return public.jgo_contadores(p_emp) || jsonb_build_object('activo', public.mis_juega(p_emp) and coalesce((public.mis_ajustes() ->> 'juegos')::boolean, true),
                                                            'casillas', to_jsonb(public.jgo_ruleta_casillas()));
end $$;

-- Tragamonedas: 3 iguales = 3 puntos, 2 iguales = 1 punto
create or replace function public.jgo_tragamonedas(p_emp bigint, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare simb text[] := array['shibu', 'ramen', 'sushi', 'taiyaki', 'dango', 'estrella']; r text[]; premio int; pid bigint; gana int; msg text;
begin
  perform public.pos_auth(p_emp, p_pin);
  perform public.jgo_gastar_ficha(p_emp, 'tragamonedas');
  r := array[simb[1 + floor(random() * 6)::int], simb[1 + floor(random() * 6)::int], simb[1 + floor(random() * 6)::int]];
  premio := case when r[1] = r[2] and r[2] = r[3] then 3 when r[1] = r[2] or r[2] = r[3] or r[1] = r[3] then 1 else 0 end;
  insert into public.jgo_partidas (employee_id, juego, resultado) values (p_emp, 'tragamonedas', jsonb_build_object('carretes', to_jsonb(r))) returning id into pid;
  gana := public.jgo_pagar(p_emp, 'tragamonedas', premio, pid);
  -- Lo que salió (premio) y lo que de verdad suma (gana): con el tope casi lleno, tres iguales pueden sumar menos de 3
  msg := case when premio = 0 then 'Sin premio esta vez'
              when gana = 0 then 'Ganaste, pero ya llegaste al tope de hoy'
              else case when premio = 3 and r[1] = 'shibu' then '¡Tres Shibu!' when premio = 3 then '¡Tres iguales!' else '¡Dos iguales!' end
                   || ' +' || gana || ' punto' || case when gana > 1 then 's' else '' end
                   || case when gana < premio then ' (llegaste al tope de hoy)' else '' end end;
  return jsonb_build_object('carretes', to_jsonb(r), 'premio', gana, 'al_tope', gana < premio, 'mensaje', msg) || public.jgo_contadores(p_emp);
end $$;

-- Ruleta (pedido de Edgar, 24/11): una rueda de premios de 15 casillas. 12 tienen la cara de Shibu (sin premio) y 3
-- pagan x1, x2 y x3 (1, 2 o 3 puntos): se gana 3 de cada 15 veces, el 20 %. Cada casilla sale con la misma probabilidad,
-- así la rueda que se ve dice la verdad. La tablet la dibuja con esta misma lista (jgo_estado la manda).
create or replace function public.jgo_ruleta_casillas() returns int[] language sql immutable as $$
  select array[3, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0] $$;
drop function if exists public.jgo_ruleta(bigint, text, text);   -- la de casino (con apuesta) que hubo en la prueba
create or replace function public.jgo_ruleta(p_emp bigint, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c int[] := public.jgo_ruleta_casillas(); k int; premio int; pid bigint; gana int; msg text;
begin
  perform public.pos_auth(p_emp, p_pin);
  perform public.jgo_gastar_ficha(p_emp, 'ruleta');
  k := floor(random() * array_length(c, 1))::int;   -- la casilla (0 = la de arriba), todas con la misma probabilidad
  premio := c[k + 1];
  insert into public.jgo_partidas (employee_id, juego, resultado) values (p_emp, 'ruleta', jsonb_build_object('casilla', k, 'mult', premio))
  returning id into pid;
  gana := public.jgo_pagar(p_emp, 'ruleta', premio, pid);
  msg := case when premio = 0 then 'Salió Shibu: sin premio esta vez'
              when gana = 0 then '¡x' || premio || '! Pero ya llegaste al tope de hoy'
              else '¡x' || premio || '! +' || gana || ' punto' || case when gana > 1 then 's' else '' end
                   || case when gana < premio then ' (llegaste al tope de hoy)' else '' end end;
  return jsonb_build_object('casilla', k, 'mult', premio, 'premio', gana, 'al_tope', gana < premio, 'mensaje', msg) || public.jgo_contadores(p_emp);
end $$;

-- Blackjack: el crupier se planta en 17. Ganar = 1 punto, blackjack = 2, empate = devuelve la ficha.
create or replace function public.jgo_bj_total(p_cartas jsonb) returns int language plpgsql immutable as $$
declare t int := 0; ases int := 0; c text; r text;
begin
  for c in select jsonb_array_elements_text(coalesce(p_cartas, '[]'::jsonb)) loop
    r := regexp_replace(c, '[^0-9AJQK]', '', 'g');
    if r = 'A' then t := t + 11; ases := ases + 1; elsif r in ('J', 'Q', 'K') then t := t + 10; else t := t + coalesce(nullif(r, '')::int, 0); end if;
  end loop;
  while t > 21 and ases > 0 loop t := t - 10; ases := ases - 1; end loop;
  return t;
end $$;

create or replace function public.jgo_bj_vista(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p record; j jsonb; c jsonb; fin boolean;
begin
  select * into p from public.jgo_partidas where id = p_id;
  j := p.resultado -> 'jugador'; c := p.resultado -> 'crupier'; fin := p.estado = 'terminada';
  return jsonb_build_object('id', p.id, 'jugador', j, 'total', public.jgo_bj_total(j),
      'crupier', case when fin then c else jsonb_build_array(c -> 0, null) end,
      'estado', coalesce(p.resultado ->> 'final', 'jugando'), 'premio', p.premio)
    || case when fin then jsonb_build_object('total_crupier', public.jgo_bj_total(c),
         -- ganó, pero el tope del día recortó el premio (otros juegos lo llenaron mientras la mano seguía abierta)
         'al_tope', p.premio < case p.resultado ->> 'final' when 'blackjack' then 2 when 'gano' then 1 else 0 end) else '{}'::jsonb end;
end $$;

-- Termina la mano: juega el crupier (si hace falta), decide y paga
create or replace function public.jgo_bj_terminar(p_id bigint, p_final text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p record; j jsonb; c jsonb; mazo jsonb; tj int; tc int; fin text := p_final; premio int := 0;
begin
  select * into p from public.jgo_partidas where id = p_id for update;
  j := p.resultado -> 'jugador'; c := p.resultado -> 'crupier'; mazo := p.mazo; tj := public.jgo_bj_total(j);
  if fin is null then
    if tj > 21 then fin := 'perdio';
    else
      while public.jgo_bj_total(c) < 17 loop c := c || jsonb_build_array(mazo -> 0); mazo := mazo - 0; end loop;
      tc := public.jgo_bj_total(c);
      fin := case when tc > 21 or tj > tc then 'gano' when tj = tc then 'empate' else 'perdio' end;
    end if;
  end if;
  premio := case fin when 'blackjack' then 2 when 'gano' then 1 else 0 end;
  update public.jgo_partidas set estado = 'terminada', mazo = null,
    resultado = jsonb_build_object('jugador', j, 'crupier', c, 'final', fin) where id = p_id;
  if fin = 'empate' then insert into public.mis_fichas (employee_id, delta, motivo, ref_id) values (p.employee_id, 1, 'empate', p_id); end if;
  perform public.jgo_pagar(p.employee_id, 'blackjack', premio, p_id);
end $$;

create or replace function public.jgo_bj_mensaje(p_estado text, p_premio int) returns text language sql immutable as $$
  select case p_estado when 'blackjack' then case when p_premio > 1 then '¡Blackjack! +' || p_premio || ' puntos'
                                                  when p_premio = 1 then '¡Blackjack! +1 punto (llegaste al tope de hoy)'
                                                  else '¡Blackjack! (ya llegaste al tope de hoy)' end
                       when 'gano' then case when p_premio > 0 then '¡Le ganaste al crupier! +1 punto' else 'Ganaste (ya llegaste al tope de hoy)' end
                       when 'empate' then 'Empate: vuelve tu ficha' when 'perdio' then 'Ganó la casa: sin premio esta vez'
                       else '¿Pides otra carta o te plantas?' end
$$;

create or replace function public.jgo_bj_empezar(p_emp bigint, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare mazo jsonb; j jsonb; c jsonb; pid bigint; v jsonb;
begin
  perform public.pos_auth(p_emp, p_pin);
  if exists (select 1 from public.jgo_partidas where employee_id = p_emp and juego = 'blackjack' and estado = 'jugando') then
    select id into pid from public.jgo_partidas where employee_id = p_emp and juego = 'blackjack' and estado = 'jugando' order by id desc limit 1;
    v := public.jgo_bj_vista(pid);
    return v || jsonb_build_object('mensaje', 'Termina esta mano primero') || public.jgo_contadores(p_emp);
  end if;
  perform public.jgo_gastar_ficha(p_emp, 'blackjack');
  select jsonb_agg(r.v || s.p order by random()) into mazo
  from unnest(array['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']) as r(v) cross join unnest(array['♠', '♥', '♦', '♣']) as s(p);
  j := jsonb_build_array(mazo -> 0, mazo -> 2); c := jsonb_build_array(mazo -> 1, mazo -> 3);
  mazo := mazo - 0 - 0 - 0 - 0;
  insert into public.jgo_partidas (employee_id, juego, estado, resultado, mazo)
  values (p_emp, 'blackjack', 'jugando', jsonb_build_object('jugador', j, 'crupier', c), mazo) returning id into pid;
  if public.jgo_bj_total(j) = 21 then
    perform public.jgo_bj_terminar(pid, case when public.jgo_bj_total(c) = 21 then 'empate' else 'blackjack' end);
  end if;
  v := public.jgo_bj_vista(pid);
  return v || jsonb_build_object('mensaje', public.jgo_bj_mensaje(v ->> 'estado', (v ->> 'premio')::int)) || public.jgo_contadores(p_emp);
end $$;

create or replace function public.jgo_bj_accion(p_emp bigint, p_pin text, p_id bigint, p_accion text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p record; j jsonb; v jsonb;
begin
  perform public.pos_auth(p_emp, p_pin);
  select * into p from public.jgo_partidas where id = p_id and employee_id = p_emp and juego = 'blackjack' for update;
  if p.id is null then raise exception 'Mano no encontrada'; end if;
  if p.estado = 'jugando' then
    if p_accion = 'pedir' then
      j := (p.resultado -> 'jugador') || jsonb_build_array(p.mazo -> 0);
      update public.jgo_partidas set resultado = jsonb_set(resultado, '{jugador}', j), mazo = mazo - 0 where id = p.id;
      if public.jgo_bj_total(j) >= 21 then perform public.jgo_bj_terminar(p.id); end if;
    elsif p_accion = 'plantarse' then
      perform public.jgo_bj_terminar(p.id);
    else
      raise exception 'Acción no válida';
    end if;
  end if;
  v := public.jgo_bj_vista(p.id);
  return v || jsonb_build_object('mensaje', public.jgo_bj_mensaje(v ->> 'estado', (v ->> 'premio')::int)) || public.jgo_contadores(p_emp);
end $$;

-- ---------------------------------------------------------------- Gestión
create or replace function public.gestion_misiones() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f date := public.mis_hoy(); m0 date := date_trunc('month', public.mis_hoy())::date;
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  return jsonb_build_object(
    'ajustes', public.mis_ajustes(), 'tipo_dia', public.mis_tipo_dia(f),
    'hoy', coalesce((select jsonb_agg(to_jsonb(d) order by d.nivel) from public.mis_dia d where d.fecha = f), '[]'::jsonb),
    'catalogo', coalesce((select jsonb_agg(to_jsonb(k) || jsonb_build_object('medible', public.mis_tipo_medible(k.tipo)) order by k.numero nulls last, k.id)
                          from public.mis_catalogo k), '[]'::jsonb),
    'personas', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.name, 'puntos', public.mis_saldo(e.id), 'fichas', public.mis_fichas_saldo(e.id),
                            'misiones_mes', (select count(*) from public.mis_logros l where l.employee_id = e.id and l.fecha >= m0),
                            'puntos_mes', (select coalesce(sum(p.delta), 0) from public.mis_puntos p where p.employee_id = e.id and p.delta > 0 and p.at >= (m0::timestamp at time zone 'America/Caracas')))
                          order by e.name) from public.employees e where public.mis_juega(e.id)), '[]'::jsonb),
    'canjes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'quien', e.name, 'nombre', c.nombre, 'puntos', c.puntos, 'estado', c.estado, 'at', c.at) order by c.at desc)
                        from (select * from public.tienda_canjes order by at desc limit 50) c join public.employees e on e.id = c.employee_id), '[]'::jsonb),
    'tienda', coalesce((select jsonb_agg(to_jsonb(t) order by t.orden, t.puntos) from public.tienda_items t), '[]'::jsonb));
end $$;

create or replace function public.gestion_mision_guardar(p_id bigint, p_activa boolean, p_texto text default null, p_nivel int default null,
  p_dias text default null, p_params jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare k record;
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  select * into k from public.mis_catalogo where id = p_id;
  if k.id is null then raise exception 'Misión no encontrada'; end if;
  if coalesce(p_activa, false) and not public.mis_tipo_medible(k.tipo) then raise exception 'Esa misión todavía no se puede medir sola'; end if;
  update public.mis_catalogo set activa = coalesce(p_activa, activa), texto = coalesce(nullif(trim(p_texto), ''), texto),
    nivel = coalesce(p_nivel, nivel), dias = coalesce(p_dias, dias), params = coalesce(p_params, params), updated_at = now() where id = p_id;
end $$;

create or replace function public.gestion_tienda_guardar(p_id bigint, p_nombre text, p_puntos int, p_dish bigint default null,
  p_variant text default '', p_activo boolean default true) returns bigint
language plpgsql security definer set search_path = public as $$
declare nid bigint;
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  if coalesce(trim(p_nombre), '') = '' or coalesce(p_puntos, 0) < 1 or p_puntos > 1000 then raise exception 'Escribe el premio y sus puntos (1 a 1000)'; end if;
  if p_id is null then
    insert into public.tienda_items (nombre, puntos, dish_id, variant, activo) values (trim(p_nombre), p_puntos, p_dish, coalesce(p_variant, ''), coalesce(p_activo, true))
    returning id into nid;
  else
    update public.tienda_items set nombre = trim(p_nombre), puntos = p_puntos, dish_id = p_dish, variant = coalesce(p_variant, ''), activo = coalesce(p_activo, true)
    where id = p_id returning id into nid;
  end if;
  return nid;
end $$;

create or replace function public.gestion_misiones_ajustes(p_ajustes jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  v := public.mis_ajustes() || (coalesce(p_ajustes, '{}'::jsonb) - array(select k from jsonb_object_keys(coalesce(p_ajustes, '{}'::jsonb)) k
                                                                          where k not in ('activo', 'juegos', 'tope_juegos', 'plato_semana')));
  if (v ->> 'tope_juegos')::int not between 0 and 10 then raise exception 'El tope de los juegos va de 0 a 10 puntos'; end if;
  insert into public.pos_kv (key, value) values ('misiones', v) on conflict (key) do update set value = excluded.value, updated_at = now();
  return v;
end $$;

-- ---------------------------------------------------------------- Permisos: las funciones internas no se llaman desde afuera
revoke execute on function public.mis_ajustes(), public.mis_juega(bigint), public.mis_saldo(bigint), public.mis_fichas_saldo(bigint),
  public.jgo_ganado_hoy(bigint), public.mis_items(bigint, date), public.mis_comandas(bigint, date), public.mis_venta_dia(bigint, date),
  public.mis_trabajo(bigint, date), public.mis_medir(bigint, date, text, jsonb), public.mis_asignar(date), public.mis_revisar(bigint, date, boolean),
  public.mis_tras_cobro(), public.mis_tras_cierre(), public.jgo_gastar_ficha(bigint, text), public.jgo_pagar(bigint, text, int, bigint),
  public.jgo_contadores(bigint), public.jgo_bj_vista(bigint), public.jgo_bj_terminar(bigint, text), public.jgo_ruleta_casillas(),
  public.mis_grupo(bigint), public.mis_azar(date, bigint), public.mis_hay_promo(date)
  from anon, public, authenticated;

-- Las de la tablet y Gestión: solo con sesión (adentro verifican el PIN o el permiso de Gestión)
do $$
declare f text;
begin
  foreach f in array array['mis_estado(bigint, text)', 'mis_marcar(bigint, text, boolean, bigint[])', 'tienda_canjear(bigint, text, bigint)',
                           'jgo_estado(bigint, text)',
                           'jgo_tragamonedas(bigint, text)', 'jgo_ruleta(bigint, text)', 'jgo_bj_empezar(bigint, text)',
                           'jgo_bj_accion(bigint, text, bigint, text)', 'gestion_misiones()', 'gestion_mision_guardar(bigint, boolean, text, integer, text, jsonb)',
                           'gestion_tienda_guardar(bigint, text, integer, bigint, text, boolean)', 'gestion_misiones_ajustes(jsonb)'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- Las 100 misiones de la lista (todas apagadas hasta que Edgar las apruebe)
insert into public.mis_catalogo (numero, texto, nivel, dias, tipo, params) values
  (1, 'Cierra 2 comandas de $30 o más', 1, 'todos', 'comandas', '{"n": 2, "monto": 30}'),
  (2, 'Cierra 3 comandas de $30 o más', 2, 'todos', 'comandas', '{"n": 3, "monto": 30}'),
  (3, 'Cierra 5 comandas de $30 o más', 3, 'fuertes', 'comandas', '{"n": 5, "monto": 30}'),
  (4, 'Cierra 1 comanda de $50 o más', 2, 'todos', 'comandas', '{"n": 1, "monto": 50}'),
  (5, 'Cierra 2 comandas de $50 o más', 3, 'todos', 'comandas', '{"n": 2, "monto": 50}'),
  (6, 'Cierra 3 comandas de $50 o más', 3, 'fuertes', 'comandas', '{"n": 3, "monto": 50}'),
  (7, 'Cierra 1 comanda de $100 o más', 3, 'todos', 'comandas', '{"n": 1, "monto": 100}'),
  (8, 'Atiende 10 comandas en el turno', 1, 'normales', 'atendidas', '{"n": 10}'),
  (9, 'Atiende 15 comandas en el turno', 2, 'todos', 'atendidas', '{"n": 15}'),
  (10, 'Atiende 22 comandas en el turno', 3, 'fuertes', 'atendidas', '{"n": 22}'),
  (11, 'Vende $120 en el turno', 1, 'flojos', 'ventas', '{"monto": 120}'),
  (12, 'Vende $160 en el turno', 1, 'normales', 'ventas', '{"monto": 160}'),
  (13, 'Vende $250 en el turno', 2, 'todos', 'ventas', '{"monto": 250}'),
  (14, 'Vende $400 en el turno', 3, 'todos', 'ventas', '{"monto": 400}'),
  (15, 'Vende $600 en el turno', 3, 'fuertes', 'ventas', '{"monto": 600}'),
  (16, 'Tu primera comanda del día llega a $25', 1, 'todos', 'primera', '{"monto": 25}'),
  (17, 'Cierra una comanda de $40 o más antes de las 3 p. m.', 2, 'todos', 'comandas', '{"n": 1, "monto": 40, "hasta": 15}'),
  (18, 'Cierra 2 comandas de $30 o más después de las 8 p. m.', 2, 'todos', 'comandas', '{"n": 2, "monto": 30, "desde": 20}'),
  (19, 'Vende más que tu promedio de la semana pasada', 2, 'todos', 'vs_semana', '{}'),
  (20, 'Comanda promedio de $18 o más (mínimo 8 comandas)', 2, 'todos', 'promedio', '{"monto": 18, "minimo": 8}'),
  (21, 'Comanda promedio de $25 o más (mínimo 8 comandas)', 3, 'todos', 'promedio', '{"monto": 25, "minimo": 8}'),
  (22, 'Ninguna comanda tuya por debajo de $8 (mínimo 8 comandas)', 2, 'flojos', 'sin_bajas', '{"monto": 8, "minimo": 8}'),
  (23, 'Cierra una comanda con 8 platos o más', 2, 'todos', 'platos_comanda', '{"n": 1, "platos": 8}'),
  (24, 'Cierra 3 comandas con 5 platos o más', 2, 'normales', 'platos_comanda', '{"n": 3, "platos": 5}'),
  (25, 'Sé quien más vende del día', 3, 'todos', 'top_ventas', '{}'),
  (26, 'Vende 3 postres', 1, 'todos', 'unidades', '{"n": 3, "cat": "Postres"}'),
  (27, 'Vende 5 postres', 2, 'todos', 'unidades', '{"n": 5, "cat": "Postres"}'),
  (28, 'Vende 8 postres', 3, 'todos', 'unidades', '{"n": 8, "cat": "Postres"}'),
  (29, 'Vende 2 postres en una misma comanda', 1, 'todos', 'comandas_con', '{"n": 1, "con": "2postres"}'),
  (30, 'Vende postre en 4 comandas distintas', 2, 'todos', 'comandas_con', '{"n": 4, "con": "postre"}'),
  (31, 'Vende 12 bebidas', 1, 'normales', 'unidades', '{"n": 12, "cat": "Bebidas"}'),
  (32, 'Vende 18 bebidas', 2, 'todos', 'unidades', '{"n": 18, "cat": "Bebidas"}'),
  (33, 'Vende 25 bebidas', 3, 'fuertes', 'unidades', '{"n": 25, "cat": "Bebidas"}'),
  (34, 'En 5 comandas, vende bebida junto al ramen', 2, 'todos', 'comandas_con', '{"n": 5, "con": "bebida_ramen"}'),
  (35, 'Vende 2 especiales', 1, 'todos', 'unidades', '{"n": 2, "cat": "Especiales"}'),
  (36, 'Vende 4 especiales', 2, 'todos', 'unidades', '{"n": 4, "cat": "Especiales"}'),
  (37, 'Vende 6 especiales', 3, 'fuertes', 'unidades', '{"n": 6, "cat": "Especiales"}'),
  (38, 'Vende 2 sushis', 1, 'todos', 'unidades', '{"n": 2, "cat": "Sushi"}'),
  (39, 'Vende 4 sushis', 2, 'todos', 'unidades', '{"n": 4, "cat": "Sushi"}'),
  (40, 'Vende 6 entradas', 1, 'normales', 'unidades', '{"n": 6, "cat": "Entradas"}'),
  (41, 'Vende 10 entradas', 2, 'todos', 'unidades', '{"n": 10, "cat": "Entradas"}'),
  (42, 'Vende 15 entradas', 3, 'fuertes', 'unidades', '{"n": 15, "cat": "Entradas"}'),
  (43, 'Una comanda completa: entrada, ramen, bebida y postre', 2, 'todos', 'comandas_con', '{"n": 1, "con": "completa"}'),
  (44, '3 comandas completas en el día', 3, 'todos', 'comandas_con', '{"n": 3, "con": "completa"}'),
  (45, 'Postre en la mitad de tus comandas (mínimo 6)', 3, 'flojos', 'pendiente', '{}'),
  (46, 'Vende 3 ramen grandes', 1, 'todos', 'unidades', '{"n": 3, "cat": "Ramen", "grande": true}'),
  (47, 'Vende 8 ramen grandes', 2, 'todos', 'unidades', '{"n": 8, "cat": "Ramen", "grande": true}'),
  (48, 'Vende 15 ramen grandes', 3, 'fuertes', 'unidades', '{"n": 15, "cat": "Ramen", "grande": true}'),
  (49, 'Vende 5 extras en los platos', 1, 'todos', 'unidades', '{"n": 5, "extras": true}'),
  (50, 'Vende 10 extras', 2, 'todos', 'unidades', '{"n": 10, "extras": true}'),
  (51, 'Vende 18 extras', 3, 'fuertes', 'unidades', '{"n": 18, "extras": true}'),
  (52, 'Vende 3 del plato de la semana', 1, 'todos', 'unidades', '{"n": 3, "semana": true}'),
  (53, 'Vende 6 del plato de la semana', 2, 'todos', 'unidades', '{"n": 6, "semana": true}'),
  (54, 'Vende 4 platos de la promo del día', 1, 'flojos', 'unidades', '{"n": 4, "promo": true}'),
  (55, 'Vende 8 platos de la promo del día', 2, 'flojos', 'unidades', '{"n": 8, "promo": true}'),
  (56, 'Vende uno de cada sección: entrada, ramen, sushi, especial, postre y bebida', 3, 'todos', 'secciones', '{"n": 6}'),
  (57, 'Vende 3 especiales distintos', 2, 'todos', 'distintos', '{"n": 3, "cat": "Especiales"}'),
  (58, 'Vende 2 artículos de la tienda del menú', 2, 'todos', 'unidades', '{"n": 2, "cat": "Tienda"}'),
  (59, 'Vende 5 platos estrella', 2, 'todos', 'unidades', '{"n": 5, "nombres": ["Dorayaki", "Taiyaki", "Dangos", "Gyozas", "Pollo Saiyan", "Tonkotsu", "Té Verde"]}'),
  (60, 'Vende 10 platos estrella', 3, 'todos', 'unidades', '{"n": 10, "nombres": ["Dorayaki", "Taiyaki", "Dangos", "Gyozas", "Pollo Saiyan", "Tonkotsu", "Té Verde"]}'),
  (61, 'Registra los datos de 3 clientes nuevos', 1, 'todos', 'clientes_nuevos', '{"n": 3}'),
  (62, 'Registra 6 clientes nuevos', 2, 'todos', 'clientes_nuevos', '{"n": 6}'),
  (63, 'Atiende a 2 clientes que vuelven', 1, 'todos', 'pendiente', '{}'),
  (64, 'Atiende a 5 clientes que vuelven', 2, 'todos', 'pendiente', '{}'),
  (65, 'Atiende a un cliente que viene por 5.ª vez o más', 2, 'todos', 'pendiente', '{}'),
  (66, 'Entrega 3 sellos de la tarjeta de puntos', 1, 'todos', 'sellos', '{"n": 3}'),
  (67, 'Entrega 6 sellos', 2, 'todos', 'sellos', '{"n": 6}'),
  (68, 'Atiende un canje de premio de la tarjeta', 1, 'todos', 'pendiente', '{}'),
  (69, 'Consigue 1 opinión de 5 estrellas', 1, 'todos', 'pendiente', '{}'),
  (70, 'Consigue 3 opiniones de 5 estrellas', 2, 'todos', 'pendiente', '{}'),
  (71, 'Consigue 5 opiniones de 5 estrellas', 3, 'todos', 'pendiente', '{}'),
  (72, 'Que un cliente te nombre en su opinión', 3, 'todos', 'pendiente', '{}'),
  (73, 'Ninguna opinión de 3 estrellas o menos en tus mesas (mínimo 2)', 2, 'todos', 'pendiente', '{}'),
  (74, 'Atiende a un cliente en su cumpleaños', 2, 'todos', 'pendiente', '{}'),
  (75, 'Atiende 3 pedidos para llevar', 1, 'todos', 'para_llevar', '{"n": 3}'),
  (76, 'En 5 mesas, manda la comanda a cocina antes de 5 minutos', 2, 'todos', 'rapidas', '{"n": 5, "minutos": 5}'),
  (77, 'En 10 mesas, manda la comanda antes de 5 minutos', 3, 'fuertes', 'rapidas', '{"n": 10, "minutos": 5}'),
  (78, 'Ninguna mesa tuya pasa 10 minutos sin atender', 2, 'todos', 'pendiente', '{}'),
  (79, 'Ninguna anulación de platos en tu turno', 1, 'todos', 'sin_anulaciones', '{}'),
  (80, 'Ninguna anulación por error al anotar', 2, 'todos', 'pendiente', '{}'),
  (81, 'Todas tus mesas cobradas antes del cierre de caja', 1, 'todos', 'pendiente', '{}'),
  (82, 'Manda la primera comanda del local en el día', 1, 'todos', 'pendiente', '{}'),
  (83, 'Mesa express: de abrir a cobrar en menos de 30 minutos, 3 veces', 2, 'normales', 'express', '{"n": 3, "minutos": 30}'),
  (84, 'Atiende 3 mesas a la vez sin que ninguna espere más de 10 minutos', 3, 'fuertes', 'pendiente', '{}'),
  (85, 'Entrega 10 platos listos en menos de 2 minutos', 2, 'todos', 'pendiente', '{}'),
  (86, 'Equipo: el local llega a la meta del día', 2, 'todos', 'equipo_meta', '{"pct": 100}'),
  (87, 'Equipo: el local pasa la meta del día por 20 %', 3, 'todos', 'equipo_meta', '{"pct": 120}'),
  (88, 'Equipo: entre todas venden 15 postres', 1, 'todos', 'equipo_unidades', '{"n": 15, "cat": "Postres"}'),
  (89, 'Equipo: entre todas venden 30 postres', 3, 'fuertes', 'equipo_unidades', '{"n": 30, "cat": "Postres"}'),
  (90, 'Equipo: ninguna mesa pasa 10 minutos sin atender en todo el día', 2, 'todos', 'pendiente', '{}'),
  (91, 'Racha: 3 días seguidos cumpliendo la misión fácil', 2, 'todos', 'pendiente', '{}'),
  (92, 'Racha: 5 días seguidos con al menos una misión', 3, 'todos', 'pendiente', '{}'),
  (93, 'Racha: una semana sin anulaciones por error', 3, 'todos', 'pendiente', '{}'),
  (94, 'Vende más que ayer', 1, 'todos', 'vs_ayer', '{}'),
  (95, 'Atiende 3 mesas fuera de tu área', 1, 'fuertes', 'pendiente', '{}'),
  (96, 'Cobra 20 comandas sin anular ningún cobro', 1, 'todos', 'pendiente', '{}'),
  (97, 'Cierre de caja con diferencia menor a Ref 1', 2, 'todos', 'pendiente', '{}'),
  (98, 'Registra los datos de 5 clientes al cobrar', 1, 'todos', 'clientes_nuevos', '{"n": 5}'),
  (99, 'Despacha 5 pedidos de delivery propio', 2, 'todos', 'delivery', '{"n": 5}'),
  (100, 'Cierra la caja sin pedidos abiertos y con todos los para llevar entregados', 1, 'todos', 'pendiente', '{}')
on conflict (numero) do nothing;

-- Premios de la tienda para empezar (los ejemplos de Edgar; la economía se ajusta con los costos)
insert into public.tienda_items (nombre, puntos, dish_id, variant, orden)
select x.nombre, x.puntos, d.id, x.variant, x.orden
from (values ('Refresco', 6, 'Refresco', 'Lata', 1), ('Taiyaki', 7, 'Taiyaki', '', 2), ('Amaterasu', 10, 'Amaterasu', 'Peq', 3)) x(nombre, puntos, plato, variant, orden)
join public.dishes d on d.name = x.plato
on conflict (nombre) do nothing;
