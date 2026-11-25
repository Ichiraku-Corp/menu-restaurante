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
  select '{"activo": true, "juegos": true, "tope_juegos": 3, "plato_semana": "", "premios_top": [10, 6, 3],
           "tope_mes_usd": 60, "canjes_dia": 2, "grande_puntos": 15, "grandes_semana": 1,
           "rota_ventanas": 3, "rota_por_semana": 5, "premium_nivel": 2, "estrellas_niveles": [5, 15, 30, 60, 100],
           "comodines": {"activos": 2, "semana": 3, "suman": true, "uno_semana": [22, 23]},
           "mejoras": {"bronce": 1, "nombre": 1, "ventana": 2, "plata": 3, "oro": 4, "canje": 4, "gratis": 4, "animado": 5, "llavero": 5, "corona": 5}}'::jsonb
         || coalesce((select value from public.pos_kv where key = 'misiones'), '{}'::jsonb)
$$;
-- En qué nivel de estrellas se abre cada mejora (Edgar, 25/11; null = apagada): marcos bronce, plata, oro y animado; Shibu
-- la llama por su nombre; una ventana más que rota; un premio más al día; el premio gratis; el regalo de Leyenda (llavero
-- o pulsera) y la corona en el Top maid. La ventana premium sigue en premium_nivel.
create or replace function public.mis_mejora(p_clave text) returns int
language sql stable security definer set search_path = public as $$
  select case when p_clave = 'premium' then coalesce((public.mis_ajustes() ->> 'premium_nivel')::int, 2)
              else (public.mis_ajustes() -> 'mejoras' ->> p_clave)::int end $$;

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

-- ---------------------------------------------------------------- Comodines (Edgar, 25/11: página «Niveles y comodines»)
-- Objetos que la maid compra con puntos en la máquina y que mejoran su día: más puntos en sus misiones, misiones extra,
-- ayudas, juegos, equipo, la máquina y lucirse. Cada uno sale desde un nivel de estrellas (0 = desde el inicio).
-- Las funciones están más abajo (sección «Comodines: lo que hacen»).
create table if not exists public.com_catalogo (
  id         int primary key,                   -- número en la lista de Edgar (1 a 31)
  nombre     text not null,
  texto      text not null,                     -- lo que hace, como lo lee la maid en la máquina
  icono      text not null default '',
  efecto     text not null,
  nivel      smallint check (nivel between 0 and 5),   -- desde qué nivel de estrellas sale; null = no va en la máquina
  puntos     int not null check (puntos between 0 and 100),
  dias       int check (dias between 1 and 30),
  orden      int not null default 0,
  updated_at timestamptz not null default now());

create table if not exists public.com_compras (
  id          bigserial primary key,
  employee_id bigint not null references public.employees(id) on delete cascade,
  comodin_id  int not null references public.com_catalogo(id),
  efecto      text not null,
  puntos      int not null,
  desde       date not null,                    -- primer día en que vale
  hasta       date not null,                    -- último día en que vale
  usado       boolean not null default false,   -- los de una vez (Campanita, Ficha dorada, Carta, Cupón, Mapa, Duelo): ya se usó
  usado_at    timestamptz,
  datos       jsonb not null default '{}'::jsonb,   -- para quién (Regalo, Duelo), qué misión salió, la insignia, el resultado…
  at          timestamptz not null default now());
create index if not exists com_compras_emp on public.com_compras (employee_id, hasta);

-- Misiones propias de una maid: la que cambió con la Ficha de cambio o eligió con el Mapa (slot 1 a 3: reemplaza la
-- del día de ese nivel) y las de los pergaminos (slot 11 fácil, 12 y 14 medias, 13 difícil, 15 sorpresa).
-- Al cumplirlas, mis_logros guarda el slot en «nivel».
create table if not exists public.mis_personal (
  employee_id bigint not null references public.employees(id) on delete cascade,
  fecha       date not null,
  slot        smallint not null,
  nivel       smallint not null check (nivel between 1 and 3),
  catalogo_id bigint references public.mis_catalogo(id) on delete set null,
  texto       text not null,
  tipo        text not null,
  params      jsonb not null default '{}'::jsonb,
  puntos      int not null,
  origen      text not null,
  compra_id   bigint references public.com_compras(id) on delete set null,
  primary key (employee_id, fecha, slot));

-- Avisos chicos para la tablet: un regalo que le llegó, un duelo, la bandera del equipo
create table if not exists public.com_avisos (
  id          bigserial primary key,
  employee_id bigint not null references public.employees(id) on delete cascade,
  icono       text not null default '',
  texto       text not null,
  at          timestamptz not null default now(),
  visto       boolean not null default false);
create index if not exists com_avisos_emp on public.com_avisos (employee_id, visto);

-- Lo que sumaron los comodines a una misión cumplida (va aparte: el Top maid cuenta solo los puntos de la misión)
alter table public.mis_logros add column if not exists extra int not null default 0;

alter table public.com_catalogo enable row level security;
alter table public.com_compras enable row level security;
alter table public.mis_personal enable row level security;
alter table public.com_avisos enable row level security;

-- La lista de Edgar con lo que decidió el 25/11 (nivel null = no va). Gestión puede cambiar nivel, puntos y días.
insert into public.com_catalogo (id, nombre, texto, icono, efecto, nivel, puntos, dias, orden) values
  (1,  'Diadema dorada', 'Duplica los puntos de tus misiones', '👑', 'x2_todo', 3, 20, 7, 11),
  (2,  'Taza de Shibu', 'Duplica los puntos de tus misiones de hoy', '☕', 'x2_hoy', 0, 3, 1, 12),
  (3,  'Campanita de la suerte', 'Triplica los puntos de la próxima misión que cumplas', '🔔', 'x3_proxima', 0, 4, null, 13),
  (4,  'Delantal estrella', 'Duplica los puntos de tu misión difícil', '🌟', 'x2_dificil', 1, 8, 5, 14),
  (5,  'Abanico de fin de semana', 'Duplica los puntos de tus misiones el sábado y el domingo', '🎐', 'x2_finde', 2, 8, null, 15),
  (6,  'Lazo rosa', '+1 punto por cada misión que cumplas', '🎀', 'mas1_mision', 0, 6, 3, 16),
  (31, 'Hora feliz', 'De 3 a 5 p. m., cada comanda tuya de Ref 25 o más te da +1 punto (máximo 3 al día)', '🕒', 'hora_feliz', 0, 5, 3, 17),
  (7,  'Pergamino fácil', 'Una misión fácil más cada día (1 punto)', '📜', 'extra_facil', 1, 2, 3, 21),
  (8,  'Pergamino difícil', 'Una misión difícil más cada día (3 puntos)', '📜', 'extra_dificil', 2, 7, 3, 22),
  (9,  'Pergamino doble', 'Dos misiones medias más mañana (2 puntos cada una)', '📜', 'doble_media', 1, 3, null, 23),
  (10, 'Pergamino sorpresa', 'Una misión extra hoy, con premio sorpresa (1 a 5 puntos)', '🎲', 'sorpresa', 0, 3, null, 24),
  (11, 'Ficha de cambio', 'Cambia una misión de hoy por otra del mismo nivel', '🔄', 'cambio', 0, 2, null, 31),
  (12, 'Mapa de Shibu', 'Mañana eliges tu misión media entre 3', '🗺️', 'mapa', 1, 3, null, 32),
  (13, 'Reloj de arena', 'Si un día no cumples, tu racha no se corta (vale para un día, desde ayer hasta 6 días después)', '⏳', 'reloj', 2, 5, null, 33),
  (14, 'Paraguas', 'Si un día no cumples ninguna misión, igual ganas 1 punto y 1 ficha', '☂️', 'paraguas', null, 4, 5, 34),
  (15, 'Segunda oportunidad', 'La misión que quedó a menos del 20 % de la meta al cerrar la caja cuenta como cumplida', '🔁', 'segunda', null, 6, null, 35),
  (16, 'Bolsa de fichas', '3 fichas para jugar', '🪙', 'fichas3', 0, 3, null, 41),
  (17, 'Trébol de cuatro hojas', 'Hoy la ruleta gana 1 de cada 3 veces (normal: 1 de cada 5)', '🍀', 'trebol', 1, 7, 1, 42),
  (18, 'Tope abierto', 'Hoy puedes ganar hasta 5 puntos jugando, en vez de 3', '🔓', 'tope5', 3, 2, 1, 43),
  (19, 'Ficha dorada', 'En tu próxima jugada, si pierdes, te devuelve la ficha', '🟡', 'ficha_dorada', 0, 1, null, 44),
  (20, 'Carta bajo la manga', 'En tu próxima mano de blackjack ves la carta tapada del crupier', '🃏', 'carta', 1, 2, null, 45),
  (21, 'Bandera del equipo', 'Si hoy el local llega a la meta, todas las maids ganan +1 punto (la compra una, ganan todas)', '🚩', 'bandera', 0, 1, 1, 51),
  (22, 'Regalo para una compañera', 'Le regalas 3 puntos a otra maid', '🎁', 'regalo', 2, 4, null, 52),
  (23, 'Duelo amistoso', 'Retas a una compañera: si hoy vendes más que ella, ganas 4 puntos (ella no pierde nada)', '⚔️', 'duelo', 0, 2, 1, 53),
  (24, 'Cupón de Shibu', 'Tu próximo premio de la máquina cuesta 30 % menos', '🎟️', 'cupon', 2, 2, 7, 61),
  (25, 'Premio sorpresa', 'Un premio al azar de la máquina (a veces uno mejor que lo que pagaste)', '❓', 'premio_sorpresa', 1, 7, null, 62),
  (26, 'Té de la tarde', 'Un Té Verde gratis cada día', '🍵', 'te', null, 10, 3, 63),
  (27, 'Corona en Tops', 'Tu nombre sale con corona en «Tops»', '👑', 'corona', null, 5, 7, 71),
  (28, 'Marco dorado', 'Tu tarjeta de Shibu y tu chapita se ven doradas', '🖼️', 'marco', null, 3, 7, 72),
  (29, 'Ya no eres novata', 'Shibu te llama por tu nombre en vez de «novata»', '📛', 'nombre', null, 4, 7, 73),
  (30, 'Insignia de honor', 'Una insignia para siempre en tu carnet: estrella, ramen o taiyaki', '🏅', 'insignia', 4, 12, null, 74)
on conflict (id) do nothing;

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
-- Lo que una persona anotó en pedidos cobrados entre dos días (los dos incluidos). No cuentan los platos anulados,
-- los de Ref 0 (canjes y premios), Yummy ni el consumo de empleados. Es la regla de las misiones y de «Mis ventas».
create or replace function public.mis_items_rango(p_emp bigint, p_desde date, p_hasta date)
returns table (order_id bigint, qty numeric, monto numeric, dish_id bigint, nombre text, variant text, promo text,
               es_extra boolean, cat text, kind text, abierta timestamptz, cerrada timestamptz, enviada timestamptz,
               fecha date, mesa text, numero int)
language sql stable security definer set search_path = public as $$
  select i.order_id, i.qty, i.qty * i.unit_price, i.dish_id, coalesce(d.name, i.name), coalesce(i.variant, ''), coalesce(i.promo, ''),
         coalesce(c.es_extra, false) or i.extra_de is not null, coalesce(c.name, ''), o.kind, o.opened_at, o.closed_at, i.sent_at,
         (o.closed_at at time zone 'America/Caracas')::date,
         case when o.kind = 'delivery' then 'Delivery' when o.kind = 'llevar' then 'Para llevar'
              when t.id is not null then t.area || ' ' || t.number else 'Mesa' end,
         o.day_number
  from public.pos_orders o
  join public.pos_items i on i.order_id = o.id
  left join public.pos_tables t on t.id = o.table_id
  left join public.dishes d on d.id = i.dish_id
  left join public.categories c on c.id = d.category_id
  where o.status = 'cobrada'
    and o.closed_at >= (p_desde::timestamp at time zone 'America/Caracas') and o.closed_at < ((p_hasta + 1)::timestamp at time zone 'America/Caracas')
    and i.created_by = p_emp and i.status <> 'anulado' and i.unit_price > 0
    and coalesce(o.channel, 'propio') <> 'yummy'
    and not exists (select 1 from public.pos_payments p where p.order_id = o.id and p.method in ('cuenta', 'yummy'))
$$;

-- Comandas de una persona en un día: lo que ella anotó en pedidos cobrados ese día (con la misma regla)
create or replace function public.mis_items(p_emp bigint, p_fecha date)
returns table (order_id bigint, qty numeric, monto numeric, dish_id bigint, nombre text, variant text, promo text,
               es_extra boolean, cat text, kind text, abierta timestamptz, cerrada timestamptz, enviada timestamptz)
language sql stable security definer set search_path = public as $$
  select order_id, qty, monto, dish_id, nombre, variant, promo, es_extra, cat, kind, abierta, cerrada, enviada
  from public.mis_items_rango(p_emp, p_fecha, p_fecha)
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

-- Si trabajó ese día (anotó algo o cobró algo; pedir un premio de la máquina no cuenta): las misiones de equipo, las del
-- cierre y la Bandera del equipo solo se dan a quien trabajó
create or replace function public.mis_trabajo(p_emp bigint, p_fecha date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.mis_items(p_emp, p_fecha))
      or exists (select 1 from public.pos_orders o where o.closed_by = p_emp and o.status = 'cobrada' and not coalesce(o.premio, false)
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
    declare dia date; hoy_ok boolean := false; rid bigint; relojes bigint[] := '{}';
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
          -- Reloj de arena (comodín): un día sin cumplir no corta la racha si un reloj suyo cubre ese día (uno por reloj)
          select rj.id into rid from public.com_compras rj where rj.employee_id = p_emp and rj.efecto = 'reloj' and dia between rj.desde and rj.hasta
            and not (rj.id = any (relojes)) order by rj.id limit 1;
          exit when rid is null;
          relojes := relojes || rid;
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

-- Revisa las misiones de una persona y anota las que cumplió (cada una una sola vez): puntos + 1 ficha. Con comodines:
-- también sus misiones propias, lo que suman (×2, ×3, +1), la Hora feliz y la Bandera del equipo.
-- p_cierre = true al cerrar la caja (ahí se miden las que solo se saben al final del día).
create or replace function public.mis_revisar(p_emp bigint, p_fecha date, p_cierre boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare d record; r jsonb; lid bigint; nuevos int := 0;
begin
  if not public.mis_juega(p_emp) or not coalesce((public.mis_ajustes() ->> 'activo')::boolean, true) then return 0; end if;
  perform public.com_asignar(p_emp, p_fecha);   -- las misiones extra de los pergaminos de ese día
  for d in select * from public.com_misiones(p_emp, p_fecha) order by slot loop
    if exists (select 1 from public.mis_logros where employee_id = p_emp and fecha = p_fecha and nivel = d.slot) then continue; end if;
    if public.mis_tipo_cierre(d.tipo) and not p_cierre then continue; end if;
    if (d.tipo like 'equipo_%' or public.mis_tipo_cierre(d.tipo)) and not public.mis_trabajo(p_emp, p_fecha) then continue; end if;
    r := public.mis_medir(p_emp, p_fecha, d.tipo, d.params);
    if (r ->> 'actual')::numeric >= (r ->> 'meta')::numeric then
      insert into public.mis_logros (employee_id, fecha, nivel, texto, puntos) values (p_emp, p_fecha, d.slot, d.texto, d.puntos)
        on conflict do nothing returning id into lid;
      if lid is not null then
        insert into public.mis_puntos (employee_id, delta, motivo, ref_id) values (p_emp, d.puntos, 'mision', lid);
        insert into public.mis_fichas (employee_id, delta, motivo, ref_id) values (p_emp, 1, 'mision', lid);
        perform public.com_premiar(p_emp, p_fecha, d.nivel, d.puntos, lid);   -- comodines: ×2, ×3 y +1 (van aparte)
        nuevos := nuevos + 1;
      end if;
    end if;
  end loop;
  perform public.com_hora_feliz(p_emp, p_fecha);
  perform public.com_bandera(p_emp, p_fecha);
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
         where (exists (select 1 from public.mis_dia d where d.fecha = f and d.tipo like 'equipo_%')
                or exists (select 1 from public.com_compras c where c.efecto = 'bandera' and c.desde = f)) and public.mis_juega(emp.id)) z
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
    perform public.com_resolver_duelos(f);   -- Duelo amistoso: quién vendió más hoy
  exception when others then null;
  end;
  return null;
end $$;
drop trigger if exists mis_tras_cierre on public.pos_sessions;
create trigger mis_tras_cierre after update of status on public.pos_sessions
  for each row when (new.status = 'cerrada' and old.status is distinct from 'cerrada') execute function public.mis_tras_cierre();

-- ---------------------------------------------------------------- Para la tablet
-- Todo lo que la tablet muestra: misiones con su avance, puntos, fichas, tienda y misiones recién cumplidas (para celebrar).
-- ---------------------------------------------------------------- Estrellas de los clientes (Edgar, 25/11)
-- Cada opinión de 4 o 5 estrellas suma 1 estrella a cada maid que atendió la mesa (las mismas del recibo: «Te atendieron
-- Mei y Nami»); una de 1 o 2 resta 1; una de 3 no cambia nada. El total puede bajar, pero un nivel ganado no se pierde:
-- el nivel sale de lo más alto a lo que llegó. Niveles a las 5, 15, 30, 60 y 100 (pos_kv 'misiones' → estrellas_niveles).
create or replace function public.opinion_atendieron(p_order bigint) returns bigint[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(b.emp order by b.orden) filter (where b.orden <= 3), '{}') from (
    select a.emp, row_number() over (order by a.abrio desc, a.n desc, a.primero) as orden from (
      select i.created_by as emp, bool_or(i.created_by = o.opened_by) as abrio, count(*) as n, min(i.id) as primero
      from public.pos_items i join public.pos_orders o on o.id = i.order_id
      where i.order_id = p_order and i.status <> 'anulado' and i.created_by is not null
      group by i.created_by) a
    where coalesce(public.pos_emp_name(a.emp), '') <> '') b $$;

-- Las estrellas de cada maid: el total, las del mes (por la fecha en que el cliente respondió) y lo más alto que llegó
create or replace function public.mis_estrellas_todas(p_fecha date)
returns table (employee_id bigint, total int, mes int, maximo int)
language sql stable security definer set search_path = public as $$
  with f as (
    select x.emp, case when o.rating >= 4 then 1 when o.rating <= 2 then -1 else 0 end as d,
           coalesce(o.answered_at, o.updated_at, o.created_at) as at, o.order_id
    from public.opiniones o cross join lateral unnest(public.opinion_atendieron(o.order_id)) as x(emp)
    where o.rating is not null and o.order_id is not null),
  a as (select emp, d, at, sum(d) over (partition by emp order by at, order_id rows unbounded preceding) as acum from f)
  select emp, sum(d)::int,
         coalesce(sum(d) filter (where at >= (date_trunc('month', p_fecha)::timestamp at time zone 'America/Caracas')), 0)::int,
         greatest(0, max(acum))::int
  from a group by emp
$$;

-- Para la tablet: total, las del mes, el nivel (con su nombre) y cuántas faltan para el siguiente
create or replace function public.mis_estrellas(p_emp bigint, p_fecha date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; niv int[]; n int; sig int;
  nombres text[] := array['Debut', 'Idol del local', 'Estrella', 'Superestrella', 'Leyenda'];
begin
  select array_agg(x::int order by x::int) into niv
  from jsonb_array_elements_text(coalesce(public.mis_ajustes() -> 'estrellas_niveles', '[5, 15, 30, 60, 100]'::jsonb)) x;
  select * into r from public.mis_estrellas_todas(p_fecha) e where e.employee_id = p_emp;
  n := (select count(*) from unnest(niv) v where v <= coalesce(r.maximo, 0));
  sig := (select min(v) from unnest(niv) v where v > coalesce(r.maximo, 0));
  return jsonb_build_object('total', coalesce(r.total, 0), 'mes', coalesce(r.mes, 0), 'nivel', n,
    'nombre', case when n > 0 then nombres[least(n, 5)] else '' end,
    'siguiente', sig, 'siguiente_nombre', case when sig is not null then nombres[least(n + 1, 5)] end,
    'falta', case when sig is not null then greatest(1, sig - coalesce(r.total, 0)) end,
    'niveles', to_jsonb(niv), 'nombres', to_jsonb(nombres));
end $$;

-- Top maid del mes (pedido de Edgar, 24/11): las meseras que juegan, ordenadas por los puntos que ganaron con misiones
-- en el mes (por el día de la misión). No cuentan los juegos (son suerte) ni se resta lo que gastaron en la tienda.
-- Las cajeras no entran. Con empate, el mismo puesto.
create or replace function public.mis_ranking_filas(p_fecha date)
returns table (employee_id bigint, nombre text, puntos int, puesto int)
language sql stable security definer set search_path = public as $$
  select e.id, public.pos_emp_name(e.id), sum(l.puntos)::int, (rank() over (order by sum(l.puntos) desc))::int
  from public.mis_logros l join public.employees e on e.id = l.employee_id
  where l.fecha >= date_trunc('month', p_fecha)::date and l.fecha < (date_trunc('month', p_fecha) + interval '1 month')::date
    and public.mis_juega(e.id) and public.mis_grupo(e.id) = 'meseras'
  group by e.id
  having sum(l.puntos) > 0
$$;
-- Para la tablet: «yo» marca a quien pregunta
create or replace function public.mis_ranking(p_fecha date, p_emp bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('puesto', r.puesto, 'nombre', r.nombre, 'puntos', r.puntos, 'yo', r.employee_id = p_emp,
                                               'estrellas', coalesce(s.total, 0),
                                               'corona', public.mis_mejora('corona') is not null
                                                 and (select count(*) from jsonb_array_elements_text(coalesce(public.mis_ajustes() -> 'estrellas_niveles', '[5, 15, 30, 60, 100]'::jsonb)) x
                                                      where x::int <= coalesce(s.maximo, 0)) >= public.mis_mejora('corona'),
                                               'insignias', coalesce((select jsonb_agg(distinct c.datos ->> 'insignia') from public.com_compras c
                                                                      where c.employee_id = r.employee_id and c.efecto = 'insignia'), '[]'::jsonb))
                            order by r.puesto, r.nombre), '[]'::jsonb)
  from public.mis_ranking_filas(p_fecha) r left join public.mis_estrellas_todas(p_fecha) s on s.employee_id = r.employee_id
$$;

-- Premio del Top maid (Edgar, 24/11): al empezar un mes, las 3 primeras del mes anterior ganan puntos extra para la tienda
-- (+10, +6 y +3; se cambian en pos_kv 'misiones' → premios_top). Se reparte una sola vez, la primera vez que una tablet
-- revisa las misiones en el mes nuevo. Con empate, cada una gana el premio de su puesto. Queda como historia del Top maid.
create table if not exists public.mis_top_premios (
  id          bigserial primary key,
  mes         date not null,
  employee_id bigint not null references public.employees(id) on delete cascade,
  puesto      int not null,
  puntos      int not null,
  nombre      text not null,
  at          timestamptz not null default now(),
  visto       boolean not null default false,
  unique (mes, employee_id));
alter table public.mis_top_premios enable row level security;

create or replace function public.mis_top_revisar(p_fecha date) returns void
language plpgsql security definer set search_path = public as $$
declare v_mes date := (date_trunc('month', p_fecha) - interval '1 month')::date; premios jsonb := public.mis_ajustes() -> 'premios_top';
begin
  if exists (select 1 from public.pos_kv where key = 'top_maid' and (value ->> 'mes')::date >= v_mes) then return; end if;
  perform pg_advisory_xact_lock(hashtext('mis_top_revisar'));
  if exists (select 1 from public.pos_kv where key = 'top_maid' and (value ->> 'mes')::date >= v_mes) then return; end if;
  with ins as (
    insert into public.mis_top_premios (mes, employee_id, puesto, puntos, nombre)
    select v_mes, r.employee_id, r.puesto, (premios ->> (r.puesto - 1))::int, r.nombre
    from public.mis_ranking_filas(v_mes) r
    where r.puesto <= 3 and coalesce((premios ->> (r.puesto - 1))::int, 0) > 0
    on conflict (mes, employee_id) do nothing
    returning id, employee_id, puntos)
  insert into public.mis_puntos (employee_id, delta, motivo, ref_id) select employee_id, puntos, 'top_maid', id from ins;
  insert into public.pos_kv (key, value) values ('top_maid', jsonb_build_object('mes', v_mes))
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- La ganadora ya vio su premio (la tablet se lo celebra una sola vez)
create or replace function public.mis_top_visto(p_emp bigint, p_pin text, p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.pos_auth(p_emp, p_pin);
  update public.mis_top_premios set visto = true where id = p_id and employee_id = p_emp;
end $$;

-- ---------------------------------------------------------------- Economía de la expendedora (Edgar, 25/11)
-- Doc «Economía de puntos y estrellas de las maids». Lo que eligió Edgar:
--  · Cada premio cuesta en puntos el doble de su precio en la carta (mínimo 3): 1 punto = medio dólar de carta.
--  · Tope del mes: $60 en insumos (costo de la receta). Al llegar, la máquina «se recarga» y vuelve el día 1.
--  · Los puntos no vencen.
-- Y además: 2 premios al día por maid, 1 premio grande (15 puntos o más) por semana, y la máquina con ventanas fijas,
-- 3 que rotan cada lunes (5 unidades por semana para todas) y 1 premium que cambia cada 2 semanas y se abre con el
-- nivel 2 de estrellas. Todo se cambia en pos_kv 'misiones' (gestion_misiones_ajustes).
alter table public.tienda_items add column if not exists ventana text not null default 'fija';
alter table public.tienda_items add column if not exists por_semana int;
do $$
begin
  alter table public.tienda_items drop constraint if exists tienda_items_ventana_check;
  alter table public.tienda_items add constraint tienda_items_ventana_check check (ventana in ('fija', 'rota', 'premium'));
end $$;
alter table public.tienda_canjes add column if not exists costo numeric(10,2) not null default 0;
alter table public.tienda_canjes add column if not exists regalo boolean not null default false;

-- Precio de un plato (y tamaño) en la carta
create or replace function public.tienda_precio_carta(p_dish bigint, p_variant text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select (e.x ->> 'price')::numeric from public.dishes d
       cross join lateral jsonb_array_elements(case when jsonb_typeof(d.variants) = 'array' then d.variants else '[]'::jsonb end) e(x)
      where d.id = p_dish and coalesce(p_variant, '') <> '' and e.x ->> 'label' = p_variant limit 1),
    (select d.price from public.dishes d where d.id = p_dish))
$$;
-- Puntos de un premio: el doble de su precio en la carta, mínimo 3. Los que no son de la carta, los que se anotaron.
create or replace function public.tienda_puntos(p_item bigint) returns int
language sql stable security definer set search_path = public as $$
  select case when t.dish_id is not null and coalesce(public.tienda_precio_carta(t.dish_id, t.variant), 0) > 0
              then greatest(3, round(2 * public.tienda_precio_carta(t.dish_id, t.variant))::int) else t.puntos end
  from public.tienda_items t where t.id = p_item
$$;
-- Lo que le cuesta a Ichiraku en insumos: la receta; sin receta, la meta de insumos de Gestión (35 %) sobre el precio
create or replace function public.tienda_costo(p_item bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select round(coalesce(public.kpi_costo_unidad(t.dish_id, t.variant),
                        coalesce((select g.meta_insumos_pct from public.gestion_settings g limit 1), 35) / 100.0
                          * coalesce(public.tienda_precio_carta(t.dish_id, t.variant), 0)), 2)
  from public.tienda_items t where t.id = p_item
$$;
-- La semana va de lunes a domingo; la ventana premium cambia cada 2 semanas (desde el lunes 5 de enero de 2026)
create or replace function public.tienda_lunes(p_fecha date) returns date language sql immutable as $$
  select (p_fecha - (extract(isodow from p_fecha)::int - 1))::date $$;
create or replace function public.tienda_quincena(p_fecha date) returns date language sql immutable as $$
  select (date '2026-01-05' + ((public.tienda_lunes(p_fecha) - date '2026-01-05') / 14) * 14)::date $$;
-- Lo que hay en la máquina esa semana: todas las fijas, 3 de las que rotan y 1 premium. La elección es la misma para
-- todas durante la semana (sale de la fecha, no de quién mira)
create or replace function public.tienda_vitrina(p_fecha date)
returns table (item_id bigint, ventana text)
language sql stable security definer set search_path = public as $$
  select t.id, t.ventana from public.tienda_items t where t.activo and t.ventana = 'fija'
  union all
  (select t.id, t.ventana from public.tienda_items t where t.activo and t.ventana = 'rota'
   order by md5(public.tienda_lunes(p_fecha)::text || '#' || t.id::text)
   limit greatest(0, coalesce((public.mis_ajustes() ->> 'rota_ventanas')::int, 3)))
  union all
  (select t.id, t.ventana from public.tienda_items t where t.activo and t.ventana = 'premium'
   order by md5(public.tienda_quincena(p_fecha)::text || '#' || t.id::text) limit 1)
$$;
-- La ventana extra (mejora de nivel 2 de estrellas, Edgar 25/11): la que sigue a las que rotan esa semana
create or replace function public.tienda_vitrina_extra(p_fecha date) returns bigint
language sql stable security definer set search_path = public as $$
  select t.id from public.tienda_items t where t.activo and t.ventana = 'rota'
  order by md5(public.tienda_lunes(p_fecha)::text || '#' || t.id::text)
  offset greatest(0, coalesce((public.mis_ajustes() ->> 'rota_ventanas')::int, 3)) limit 1
$$;
-- Unidades que quedan esta semana de un premio que rota (null: los demás no se acaban)
create or replace function public.tienda_quedan(p_item bigint, p_fecha date) returns int
language sql stable security definer set search_path = public as $$
  select case when t.ventana = 'rota' then greatest(0,
           coalesce(t.por_semana, (public.mis_ajustes() ->> 'rota_por_semana')::int, 5)
           - (select count(*) from public.tienda_canjes c where c.item_id = t.id and c.estado <> 'rechazado'
                and (c.at at time zone 'America/Caracas')::date between public.tienda_lunes(p_fecha) and public.tienda_lunes(p_fecha) + 6)::int) end
  from public.tienda_items t where t.id = p_item
$$;
-- Lo que llevan gastado todas en el mes (insumos de los premios que salieron)
create or replace function public.tienda_gasto_mes(p_fecha date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(c.costo), 0) from public.tienda_canjes c
  where c.estado <> 'rechazado' and c.at >= (date_trunc('month', p_fecha)::timestamp at time zone 'America/Caracas')
    and c.at < ((date_trunc('month', p_fecha) + interval '1 month')::timestamp at time zone 'America/Caracas')
$$;
-- Cómo va una maid con los topes de la máquina
create or replace function public.tienda_limites(p_emp bigint, p_fecha date) returns jsonb
language sql stable security definer set search_path = public as $$
  with aj as (select public.mis_ajustes() a),
  c as (select * from public.tienda_canjes where employee_id = p_emp and estado <> 'rechazado')
  select jsonb_build_object(
    'canjes_hoy', (select count(*) from c where (c.at at time zone 'America/Caracas')::date = p_fecha),
    -- Mejora de nivel (Edgar, 25/11): desde el nivel 4 de estrellas, un premio más al día
    'canjes_dia', (select coalesce((a ->> 'canjes_dia')::int, 2) from aj)
                  + case when public.mis_mejora('canje') is not null
                          and coalesce((public.mis_estrellas(p_emp, p_fecha) ->> 'nivel')::int, 0) >= public.mis_mejora('canje') then 1 else 0 end,
    'grande_puntos', (select coalesce((a ->> 'grande_puntos')::int, 15) from aj),
    'grande_semana', (select count(*) from c where not c.regalo
                        and coalesce(public.tienda_puntos(c.item_id), c.puntos) >= (select coalesce((a ->> 'grande_puntos')::int, 15) from aj)
                        and (c.at at time zone 'America/Caracas')::date between public.tienda_lunes(p_fecha) and public.tienda_lunes(p_fecha) + 6),
    'grandes_semana', (select coalesce((a ->> 'grandes_semana')::int, 1) from aj),
    'gasto_mes', public.tienda_gasto_mes(p_fecha),
    'tope_mes', (select nullif(coalesce((a ->> 'tope_mes_usd')::numeric, 0), 0) from aj),
    -- Nivel 4 de estrellas (mejora «gratis»): un premio gratis, una sola vez
    'regalo', coalesce((public.mis_estrellas(p_emp, p_fecha) ->> 'nivel')::int, 0) >= coalesce(public.mis_mejora('gratis'), 99)
              and not exists (select 1 from public.tienda_canjes x where x.employee_id = p_emp and x.regalo and x.estado <> 'rechazado'))
$$;
-- Por qué un premio no se puede pedir ahora (sin contar los puntos): null si se puede
create or replace function public.tienda_bloqueo(p_item bigint, p_fecha date, p_lim jsonb, p_est jsonb) returns text
language sql stable security definer set search_path = public as $$
  select case
    when (p_lim ->> 'tope_mes') is not null and (p_lim ->> 'gasto_mes')::numeric + public.tienda_costo(t.id) > (p_lim ->> 'tope_mes')::numeric then 'recarga'
    when (p_lim ->> 'canjes_hoy')::int >= (p_lim ->> 'canjes_dia')::int then 'hoy'
    when not coalesce((p_lim ->> 'regalo')::boolean, false) and public.tienda_puntos(t.id) >= (p_lim ->> 'grande_puntos')::int
         and (p_lim ->> 'grande_semana')::int >= (p_lim ->> 'grandes_semana')::int then 'grande'
    when t.ventana = 'premium' and coalesce((p_est ->> 'nivel')::int, 0) < coalesce((public.mis_ajustes() ->> 'premium_nivel')::int, 2) then 'nivel'
    when t.id = public.tienda_vitrina_extra(p_fecha) and coalesce((p_est ->> 'nivel')::int, 0) < coalesce(public.mis_mejora('ventana'), 99) then 'nivel'
    when t.ventana = 'rota' and public.tienda_quedan(t.id, p_fecha) <= 0 then 'agotado'
  end
  from public.tienda_items t where t.id = p_item
$$;

-- ---------------------------------------------------------------- Comodines: lo que hacen (Edgar, 25/11)
-- Reglas (pos_kv 'misiones' → comodines): 2 activos a la vez, 3 comprados por semana, los que duplican se suman
-- (×2 y ×2 = ×4) y el Regalo y el Duelo, uno por semana cada uno. El mismo comodín no se tiene dos veces activo.
-- Los que se usan al comprarlos (fichas, regalo, premio sorpresa, insignia, ficha de cambio) y el Reloj de arena, que
-- solo guarda la racha, no ocupan lugar entre los activos.
create or replace function public.mis_nivel(p_emp bigint, p_fecha date) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((public.mis_estrellas(p_emp, p_fecha) ->> 'nivel')::int, 0) $$;
create or replace function public.com_listo(p_efecto text) returns boolean language sql immutable as $$
  select p_efecto in ('x2_todo', 'x2_hoy', 'x3_proxima', 'x2_dificil', 'x2_finde', 'mas1_mision', 'hora_feliz', 'extra_facil', 'extra_dificil',
                      'doble_media', 'sorpresa', 'cambio', 'mapa', 'reloj', 'fichas3', 'trebol', 'tope5', 'ficha_dorada', 'carta', 'bandera',
                      'regalo', 'duelo', 'cupon', 'premio_sorpresa', 'insignia') $$;
create or replace function public.com_instantaneo(p_efecto text) returns boolean language sql immutable as $$
  select p_efecto in ('fichas3', 'regalo', 'premio_sorpresa', 'insignia', 'cambio', 'reloj') $$;
create or replace function public.com_reglas() returns jsonb
language sql stable security definer set search_path = public as $$
  select '{"activos": 2, "semana": 3, "suman": true, "uno_semana": [22, 23]}'::jsonb || coalesce(public.mis_ajustes() -> 'comodines', '{}'::jsonb) $$;

-- Los que valen ese día (los de una vez, mientras no se usen)
create or replace function public.com_activas(p_emp bigint, p_fecha date) returns setof public.com_compras
language sql stable security definer set search_path = public as $$
  select * from public.com_compras where employee_id = p_emp and not usado and p_fecha between desde and hasta $$;
-- Los que ocupan lugar: comprados y sin terminar (también los que empiezan después, como el Abanico o el Mapa)
create or replace function public.com_ocupados(p_emp bigint, p_fecha date) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.com_compras
  where employee_id = p_emp and not usado and hasta >= p_fecha and not public.com_instantaneo(efecto) $$;

-- Las misiones de una maid ese día: las de su grupo (con la que cambió o eligió con el Mapa en su lugar) y las de los
-- pergaminos. slot = lo que se guarda en mis_logros.nivel; nivel = 0 la extra del día, 1 fácil, 2 media, 3 difícil.
create or replace function public.com_misiones(p_emp bigint, p_fecha date)
returns table (slot smallint, nivel smallint, texto text, tipo text, params jsonb, puntos int, origen text)
language sql stable security definer set search_path = public as $$
  select d.nivel, d.nivel, coalesce(p.texto, d.texto), coalesce(p.tipo, d.tipo), coalesce(p.params, d.params), coalesce(p.puntos, d.puntos),
         coalesce(p.origen, 'dia')
  from public.mis_dia d
  left join public.mis_personal p on p.employee_id = p_emp and p.fecha = d.fecha and p.slot = d.nivel
  where d.fecha = p_fecha and d.grupo = public.mis_grupo(p_emp)
  union all
  select p.slot, p.nivel, p.texto, p.tipo, p.params, p.puntos, p.origen
  from public.mis_personal p where p.employee_id = p_emp and p.fecha = p_fecha and p.slot >= 10
$$;

-- Misiones que le pueden tocar con un comodín: activas, de su grupo y del tipo de día, que se midan solas, que no sean
-- de equipo ni rachas, y que no tenga ya ese día. El orden sale de «p_sal» (fijo: siempre las mismas para lo mismo).
create or replace function public.com_candidatas(p_emp bigint, p_fecha date, p_nivel int, p_sal text) returns setof public.mis_catalogo
language sql stable security definer set search_path = public as $$
  select x.* from public.mis_catalogo x
  where x.activa and not x.extra and x.para in ('todas', public.mis_grupo(p_emp)) and x.dias in ('todos', public.mis_tipo_dia(p_fecha))
    and public.mis_tipo_medible(x.tipo) and x.tipo not like 'equipo\_%' and x.tipo <> 'racha'
    and (p_nivel = 0 or x.nivel = p_nivel)
    and (not coalesce((x.params ->> 'semana')::boolean, false) or coalesce(public.mis_ajustes() ->> 'plato_semana', '') <> '')
    and (not coalesce((x.params ->> 'promo')::boolean, false) or public.mis_hay_promo(p_fecha))
    and not exists (select 1 from public.mis_dia d where d.fecha = p_fecha and d.grupo = public.mis_grupo(p_emp) and d.catalogo_id = x.id)
    and not exists (select 1 from public.mis_personal p where p.employee_id = p_emp and p.fecha = p_fecha and p.catalogo_id = x.id)
  order by md5(p_sal || '-' || x.id::text)
$$;

-- Le pone una misión propia (o la cambia, con p_reemplazar). El Pergamino sorpresa da de 1 a 5 puntos (sale de la compra).
create or replace function public.com_poner_mision(p_emp bigint, p_fecha date, p_slot int, p_nivel int, p_origen text, p_compra bigint,
  p_reemplazar boolean default false, p_catalogo bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k record; pts int; txt text; plato text := coalesce(public.mis_ajustes() ->> 'plato_semana', '');
begin
  if not p_reemplazar and exists (select 1 from public.mis_personal where employee_id = p_emp and fecha = p_fecha and slot = p_slot) then return null; end if;
  select x.* into k from public.com_candidatas(p_emp, p_fecha, p_nivel, p_fecha::text || '-' || p_emp::text || '-' || p_slot::text || '-' || coalesce(p_compra, 0)::text) x
  where p_catalogo is null or x.id = p_catalogo limit 1;
  if k.id is null then return null; end if;
  pts := case when p_origen = 'sorpresa' then 1 + (('x' || substr(md5(coalesce(p_compra, 0)::text || '#sorpresa'), 1, 7))::bit(28)::int % 5) else k.nivel end;
  txt := k.texto || case when coalesce((k.params ->> 'semana')::boolean, false) then ' (' || plato || ')' else '' end;
  insert into public.mis_personal (employee_id, fecha, slot, nivel, catalogo_id, texto, tipo, params, puntos, origen, compra_id)
  values (p_emp, p_fecha, p_slot, k.nivel, k.id, txt, k.tipo,
          k.params || case when p_origen = 'sorpresa' then '{"sorpresa": true}'::jsonb else '{}'::jsonb end, pts, p_origen, p_compra)
  on conflict (employee_id, fecha, slot) do update set nivel = excluded.nivel, catalogo_id = excluded.catalogo_id, texto = excluded.texto,
    tipo = excluded.tipo, params = excluded.params, puntos = excluded.puntos, origen = excluded.origen, compra_id = excluded.compra_id;
  return jsonb_build_object('slot', p_slot, 'nivel', k.nivel, 'texto', txt, 'puntos', pts);
end $$;

-- Las misiones de los pergaminos que valen ese día (se ponen la primera vez que la tablet pregunta)
create or replace function public.com_asignar(p_emp bigint, p_fecha date) returns void
language plpgsql security definer set search_path = public as $$
declare c record; s record;
begin
  for c in select * from public.com_activas(p_emp, p_fecha) where efecto in ('extra_facil', 'extra_dificil', 'doble_media', 'sorpresa') order by id loop
    for s in select * from (values ('extra_facil', 11, 1), ('doble_media', 12, 2), ('extra_dificil', 13, 3), ('doble_media', 14, 2), ('sorpresa', 15, 0)) v(efecto, slot, nivel)
             where v.efecto = c.efecto loop
      perform public.com_poner_mision(p_emp, p_fecha, s.slot, s.nivel, c.efecto, c.id);
    end loop;
  end loop;
end $$;

-- Cuánto multiplican los comodines activos una misión de ese nivel ese día, y cuánto suman (+1 del Lazo rosa).
-- La Campanita (×3 a la próxima) solo entra al cumplir (p_campanita); en la tablet se muestra aparte.
create or replace function public.com_efecto(p_emp bigint, p_fecha date, p_nivel int, p_campanita boolean default false) returns jsonb
language sql stable security definer set search_path = public as $$
  with m as (
    select (case c.efecto when 'x2_todo' then 2 when 'x2_hoy' then 2
                          when 'x3_proxima' then case when p_campanita then 3 else 1 end
                          when 'x2_dificil' then case when p_nivel = 3 then 2 else 1 end
                          when 'x2_finde' then case when extract(isodow from p_fecha) in (6, 7) then 2 else 1 end
                          else 1 end)::numeric as x,
           case when c.efecto = 'mas1_mision' then 1 else 0 end as mas
    from public.com_activas(p_emp, p_fecha) c)
  select jsonb_build_object(
    'mult', case when coalesce((public.com_reglas() ->> 'suman')::boolean, true) then coalesce((select round(exp(sum(ln(x)))) from m), 1)
                 else coalesce((select max(x) from m), 1) end,
    'mas', coalesce((select sum(mas) from m), 0),
    'campanita', exists (select 1 from public.com_activas(p_emp, p_fecha) c where c.efecto = 'x3_proxima'))
$$;

-- Al cumplir una misión: lo que suman los comodines va aparte (motivo «comodin») y la Campanita se gasta
create or replace function public.com_premiar(p_emp bigint, p_fecha date, p_nivel int, p_base int, p_logro bigint) returns int
language plpgsql security definer set search_path = public as $$
declare e jsonb := public.com_efecto(p_emp, p_fecha, p_nivel, true); v_extra int; camp bigint;
begin
  v_extra := (round(p_base * (e ->> 'mult')::numeric) - p_base)::int + (e ->> 'mas')::int;
  select c.id into camp from public.com_activas(p_emp, p_fecha) c where c.efecto = 'x3_proxima' order by c.id limit 1;
  if camp is not null then
    update public.com_compras set usado = true, usado_at = now(), datos = datos || jsonb_build_object('logro', p_logro) where id = camp;
  end if;
  if v_extra > 0 then
    update public.mis_logros set extra = v_extra where id = p_logro;
    insert into public.mis_puntos (employee_id, delta, motivo, ref_id) values (p_emp, v_extra, 'comodin', p_logro);
  end if;
  return v_extra;
end $$;

-- Hora feliz: de 3 a 5 p. m., cada comanda suya (lo que ella anotó) de Ref 25 o más da +1, máximo 3 al día
create or replace function public.com_hora_feliz(p_emp bigint, p_fecha date) returns void
language plpgsql security definer set search_path = public as $$
declare c record; n int; ya int;
begin
  select * into c from public.com_activas(p_emp, p_fecha) x where x.efecto = 'hora_feliz' order by x.id limit 1;
  if c.id is null then return; end if;
  perform pg_advisory_xact_lock(hashtext('hora_feliz'), p_emp::int);
  select least(3, count(*))::int into n from public.mis_comandas(p_emp, p_fecha) m
  where m.monto >= 25 and extract(hour from m.cerrada at time zone 'America/Caracas') between 15 and 16;
  select coalesce(sum(delta), 0)::int into ya from public.mis_puntos where employee_id = p_emp and motivo = 'hora_feliz:' || p_fecha::text;
  if n > ya then insert into public.mis_puntos (employee_id, delta, motivo, ref_id) values (p_emp, n - ya, 'hora_feliz:' || p_fecha::text, c.id); end if;
end $$;

-- Bandera del equipo: si hoy el local llega a la meta del día, cada maid que trabajó gana +1 (una vez)
create or replace function public.com_bandera(p_emp bigint, p_fecha date) returns void
language plpgsql security definer set search_path = public as $$
declare c record; m jsonb;
begin
  select * into c from public.com_compras x where x.efecto = 'bandera' and x.desde = p_fecha order by x.id limit 1;
  if c.id is null or not public.mis_juega(p_emp) or not public.mis_trabajo(p_emp, p_fecha) then return; end if;
  perform pg_advisory_xact_lock(hashtext('bandera'), p_emp::int);
  if exists (select 1 from public.mis_puntos where employee_id = p_emp and motivo = 'bandera' and ref_id = c.id) then return; end if;
  m := public.meta_dia(p_fecha);
  if (m ->> 'meta') is null or coalesce((m ->> 'vendido')::numeric, 0) < (m ->> 'meta')::numeric then return; end if;
  insert into public.mis_puntos (employee_id, delta, motivo, ref_id) values (p_emp, 1, 'bandera', c.id);
  insert into public.com_avisos (employee_id, icono, texto)
  values (p_emp, '🚩', '¡El local llegó a la meta! La bandera de ' || coalesce(public.pos_emp_name(c.employee_id), 'una compañera') || ' te dio +1 punto');
end $$;

-- Duelos: al cerrar la caja (o al día siguiente) se comparan las ventas del día. Si la retada no trabajó, se devuelven los puntos.
create or replace function public.com_resolver_duelos(p_fecha date) returns void
language plpgsql security definer set search_path = public as $$
declare c record; va numeric; vb numeric; rival bigint; nom text;
begin
  for c in select * from public.com_compras where efecto = 'duelo' and not usado and desde <= p_fecha order by id for update loop
    rival := (c.datos ->> 'rival')::bigint; nom := coalesce(public.pos_emp_name(rival), 'tu compañera');
    va := public.mis_venta_dia(c.employee_id, c.desde); vb := public.mis_venta_dia(rival, c.desde);
    if not public.mis_trabajo(rival, c.desde) then
      update public.com_compras set usado = true, usado_at = now(), datos = datos || jsonb_build_object('resultado', 'no_trabajo') where id = c.id;
      if c.puntos > 0 then insert into public.mis_puntos (employee_id, delta, motivo, ref_id) values (c.employee_id, c.puntos, 'comodin_devuelto', c.id); end if;
      insert into public.com_avisos (employee_id, icono, texto)
      values (c.employee_id, '⚔️', nom || ' no trabajó el día del duelo: te devolvimos ' || c.puntos || ' puntos');
    else
      update public.com_compras set usado = true, usado_at = now(),
        datos = datos || jsonb_build_object('resultado', case when va > vb then 'gano' else 'perdio' end, 'ventas', va, 'ventas_rival', vb) where id = c.id;
      if va > vb then
        insert into public.mis_puntos (employee_id, delta, motivo, ref_id) values (c.employee_id, 4, 'duelo', c.id);
        insert into public.com_avisos (employee_id, icono, texto) values (c.employee_id, '⚔️', '¡Ganaste el duelo contra ' || nom || '! +4 puntos');
      else
        insert into public.com_avisos (employee_id, icono, texto) values (c.employee_id, '⚔️', 'El duelo contra ' || nom || ' fue para ella esta vez');
      end if;
    end if;
  end loop;
end $$;

-- Por qué un comodín no se puede comprar ahora (sin contar los puntos): null si se puede
create or replace function public.com_bloqueo(p_emp bigint, p_fecha date, p_comodin int, p_nivel int) returns text
language sql stable security definer set search_path = public as $$
  with r as (select public.com_reglas() j),
  sem as (select c.* from public.com_compras c where c.employee_id = p_emp
            and (c.at at time zone 'America/Caracas')::date between public.tienda_lunes(p_fecha) and public.tienda_lunes(p_fecha) + 6)
  select case
    when k.nivel is null or not public.com_listo(k.efecto) then 'no'
    when coalesce(p_nivel, 0) < k.nivel then 'nivel'
    when (select count(*) from sem) >= coalesce((select (j ->> 'semana')::int from r), 3) then 'semana'
    when exists (select 1 from jsonb_array_elements_text(coalesce((select j -> 'uno_semana' from r), '[]'::jsonb)) u where u::int = k.id)
         and exists (select 1 from sem where sem.comodin_id = k.id) then 'uno_semana'
    when not public.com_instantaneo(k.efecto)
         and exists (select 1 from public.com_compras c where c.employee_id = p_emp and c.comodin_id = k.id and not c.usado and c.hasta >= p_fecha) then 'activo'
    when not public.com_instantaneo(k.efecto) and public.com_ocupados(p_emp, p_fecha) >= coalesce((select (j ->> 'activos')::int from r), 2) then 'activos'
    when k.efecto = 'bandera' and exists (select 1 from public.com_compras c where c.efecto = 'bandera' and c.desde = p_fecha) then 'bandera'
    when k.efecto = 'insignia'
         and (select count(distinct c.datos ->> 'insignia') from public.com_compras c where c.employee_id = p_emp and c.efecto = 'insignia') >= 3 then 'insignias'
    when k.efecto = 'cambio' and not exists (
           select 1 from public.com_misiones(p_emp, p_fecha) d
           where d.slot between 1 and 3
             and not exists (select 1 from public.mis_logros l where l.employee_id = p_emp and l.fecha = p_fecha and l.nivel = d.slot)) then 'sin_misiones'
  end
  from public.com_catalogo k where k.id = p_comodin
$$;

-- Todo lo de los comodines para la tablet
create or replace function public.com_estado(p_emp bigint, p_fecha date, p_nivel int) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'catalogo', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'nombre', k.nombre, 'texto', k.texto, 'icono', k.icono, 'efecto', k.efecto,
                    'nivel', k.nivel, 'puntos', k.puntos, 'dias', k.dias, 'bloqueo', public.com_bloqueo(p_emp, p_fecha, k.id, p_nivel),
                    'elige', case when k.efecto in ('regalo', 'duelo') then 'companera' when k.efecto = 'insignia' then 'insignia'
                                  when k.efecto = 'cambio' then 'mision' end)
                  order by k.nivel, k.orden)
                from public.com_catalogo k where k.nivel is not null and public.com_listo(k.efecto)), '[]'::jsonb),
    'activos', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'comodin', c.comodin_id, 'nombre', k.nombre, 'icono', k.icono, 'efecto', c.efecto,
                    'desde', c.desde, 'hasta', c.hasta, 'empieza', c.desde > p_fecha, 'dias', c.hasta - greatest(c.desde, p_fecha) + 1,
                    'ocupa', not public.com_instantaneo(c.efecto),
                    'con', case when c.efecto = 'duelo' then public.pos_emp_name((c.datos ->> 'rival')::bigint) end)
                  order by c.desde, c.hasta, c.id)
                from public.com_compras c join public.com_catalogo k on k.id = c.comodin_id
                where c.employee_id = p_emp and not c.usado and c.hasta >= p_fecha), '[]'::jsonb),
    'reglas', public.com_reglas(),
    'semana', (select count(*) from public.com_compras c where c.employee_id = p_emp
                 and (c.at at time zone 'America/Caracas')::date between public.tienda_lunes(p_fecha) and public.tienda_lunes(p_fecha) + 6),
    'ocupados', public.com_ocupados(p_emp, p_fecha),
    'insignias', coalesce((select jsonb_agg(distinct c.datos ->> 'insignia') from public.com_compras c where c.employee_id = p_emp and c.efecto = 'insignia'), '[]'::jsonb),
    'companeras', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', public.pos_emp_name(e.id)) order by public.pos_emp_name(e.id))
                  from public.employees e where e.id <> p_emp and public.mis_juega(e.id)), '[]'::jsonb),
    'avisos', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'icono', a.icono, 'texto', a.texto) order by a.at)
                from public.com_avisos a where a.employee_id = p_emp and not a.visto), '[]'::jsonb),
    'hora_feliz', (select coalesce(sum(p.delta), 0) from public.mis_puntos p where p.employee_id = p_emp and p.motivo = 'hora_feliz:' || p_fecha::text),
    'bandera', (select jsonb_build_object('de', public.pos_emp_name(c.employee_id), 'mia', c.employee_id = p_emp,
                  'cumplida', exists (select 1 from public.mis_puntos p where p.motivo = 'bandera' and p.ref_id = c.id and p.employee_id = p_emp))
                from public.com_compras c where c.efecto = 'bandera' and c.desde = p_fecha order by c.id limit 1),
    'duelos', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'reta', c.employee_id = p_emp,
                  'con', public.pos_emp_name(case when c.employee_id = p_emp then (c.datos ->> 'rival')::bigint else c.employee_id end)) order by c.id)
                from public.com_compras c where c.efecto = 'duelo' and c.desde = p_fecha and not c.usado
                  and (c.employee_id = p_emp or (c.datos ->> 'rival')::bigint = p_emp)), '[]'::jsonb),
    'mapa', (select jsonb_build_object('compra', c.id,
                'actual', (select d.texto from public.com_misiones(p_emp, p_fecha) d where d.slot = 2),
                'hecha', exists (select 1 from public.mis_logros l where l.employee_id = p_emp and l.fecha = p_fecha and l.nivel = 2),
                'opciones', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'texto', o.texto
                                || case when coalesce((o.params ->> 'semana')::boolean, false) then ' (' || coalesce(public.mis_ajustes() ->> 'plato_semana', '') || ')' else '' end))
                              from (select x.* from public.com_candidatas(p_emp, p_fecha, 2, 'mapa-' || c.id::text) x limit 3) o), '[]'::jsonb))
             from public.com_compras c
             where c.employee_id = p_emp and c.efecto = 'mapa' and not c.usado and p_fecha between c.desde and c.hasta order by c.id limit 1))
$$;

-- Saca un premio de la máquina a cocina (Ref 0, como pedido para llevar marcado como premio) y lo deja en el cierre.
-- p_descontar: si descuenta los puntos aquí (el Premio sorpresa ya los pagó como comodín).
create or replace function public.tienda_entregar(p_emp bigint, p_pin text, p_item bigint, p_pts int, p_regalo boolean, p_nota text, p_descontar boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it record; cid bigint; oid bigint; sess bigint; quien text; nota text;
begin
  select * into it from public.tienda_items where id = p_item;
  select id into sess from public.pos_sessions where status = 'abierta' order by id desc limit 1;
  if sess is null then raise exception 'La caja está cerrada: los premios se piden con la caja abierta'; end if;
  select name into quien from public.employees where id = p_emp;
  insert into public.tienda_canjes (employee_id, item_id, nombre, puntos, estado, resuelto_at, resuelto_por, costo, regalo, nota)
  values (p_emp, it.id, it.nombre, p_pts, 'entregado', now(), p_emp, public.tienda_costo(it.id), p_regalo, coalesce(p_nota, ''))
  returning id into cid;
  if p_descontar and p_pts > 0 then insert into public.mis_puntos (employee_id, delta, motivo, ref_id) values (p_emp, -p_pts, 'canje', cid); end if;
  if it.dish_id is not null then
    nota := case when p_regalo then 'Premio gratis (nivel ' || coalesce(public.mis_mejora('gratis'), 4) || ' de estrellas) de '
                 when p_nota = 'Premio sorpresa' then 'Premio sorpresa de ' else 'Premio de misiones de ' end || coalesce(quien, '');
    oid := public.pos_open(p_emp, p_pin, null, left('Premio: ' || coalesce(quien, ''), 40));
    perform public.pos_add(p_emp, p_pin, oid, jsonb_build_array(jsonb_build_object('dish_id', it.dish_id, 'variant', it.variant, 'qty', 1, 'notes', nota)));
    -- Ref 0, pero con lo que vale en la carta (list_price) para el cierre
    update public.pos_items set list_price = coalesce(list_price, unit_price), unit_price = 0, promo = 'Premio de misiones' where order_id = oid;
    perform public.pos_send(p_emp, p_pin, oid);
    update public.pos_orders set status = 'cobrada', premio = true, closed_by = p_emp, closed_at = now(), session_id = sess, rate = public.pos_rate()
    where id = oid;
    update public.tienda_canjes set order_id = oid where id = cid;
  end if;
  insert into public.pos_log (employee_id, action, order_id, detail)
  values (p_emp, 'canje_entregado', oid, jsonb_build_object('canje', cid, 'premio', it.nombre, 'puntos', p_pts, 'regalo', p_regalo, 'nota', coalesce(p_nota, '')));
  return jsonb_build_object('id', cid, 'nombre', it.nombre, 'order_id', oid, 'item_id', it.id, 'dish_id', it.dish_id);
end $$;

-- Premio sorpresa: uno al azar de los que hay hoy en la máquina (también la premium o la ventana extra aunque no tenga el
-- nivel), sin pasar los topes del día, de la semana y del mes
create or replace function public.tienda_sorpresa(p_emp bigint, p_pin text, p_pts int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f date := public.mis_hoy(); lim jsonb; est jsonb; it record;
begin
  perform pg_advisory_xact_lock(hashtext('tienda'), 0);
  lim := public.tienda_limites(p_emp, f); est := public.mis_estrellas(p_emp, f);
  if (lim ->> 'canjes_hoy')::int >= (lim ->> 'canjes_dia')::int then raise exception 'Ya pediste % premios hoy: vuelve mañana', lim ->> 'canjes_dia'; end if;
  select t.* into it from public.tienda_items t
  where t.id in (select v.item_id from public.tienda_vitrina(f) v union select public.tienda_vitrina_extra(f))
    and coalesce(public.tienda_bloqueo(t.id, f, lim, est), 'nivel') = 'nivel'
    and (t.ventana <> 'rota' or public.tienda_quedan(t.id, f) > 0)
  order by random() limit 1;
  if it.id is null then raise exception 'Ahora la máquina no tiene premios para sorprenderte: prueba otro día'; end if;
  return public.tienda_entregar(p_emp, p_pin, it.id, p_pts, false, 'Premio sorpresa', false);
end $$;

create or replace function public.mis_estado(p_emp bigint, p_pin text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare f date := public.mis_hoy(); aj jsonb := public.mis_ajustes(); juega boolean; est jsonb; lim jsonb; niv int; extra_id bigint; cupon boolean;
begin
  perform public.pos_auth(p_emp, p_pin);
  juega := public.mis_juega(p_emp);
  if not juega or not coalesce((aj ->> 'activo')::boolean, true) then
    return jsonb_build_object('juega', false, 'activo', coalesce((aj ->> 'activo')::boolean, true));
  end if;
  perform public.mis_asignar(f);
  perform public.com_resolver_duelos(f - 1);   -- los duelos de días anteriores que no se cerraron con la caja
  perform public.mis_revisar(p_emp, f, false);
  perform public.mis_top_revisar(f);
  est := public.mis_estrellas(p_emp, f); niv := coalesce((est ->> 'nivel')::int, 0);
  lim := public.tienda_limites(p_emp, f);
  extra_id := case when public.mis_mejora('ventana') is not null then public.tienda_vitrina_extra(f) end;
  cupon := not coalesce((lim ->> 'regalo')::boolean, false) and exists (select 1 from public.com_activas(p_emp, f) x where x.efecto = 'cupon');
  return jsonb_build_object(
    'juega', true, 'activo', true, 'fecha', f, 'tipo_dia', public.mis_tipo_dia(f),
    'nombre', (select name from public.employees where id = p_emp),
    'saludo_hoy', exists (select 1 from public.mis_saludos where employee_id = p_emp and fecha = f),
    -- Sus misiones (las del grupo, la que cambió y las de los pergaminos) con su avance y lo que les suman los comodines
    'misiones', coalesce((select jsonb_agg(jsonb_build_object('nivel', d.nivel, 'slot', d.slot, 'origen', d.origen, 'texto', d.texto, 'puntos', d.puntos,
                  'sorpresa', coalesce((d.params ->> 'sorpresa')::boolean, false), 'tipo', d.tipo,
                  'actual', (m ->> 'actual')::numeric, 'meta', (m ->> 'meta')::numeric, 'al_cierre', public.mis_tipo_cierre(d.tipo),
                  'equipo', d.tipo like 'equipo_%', 'extra', d.slot = 0, 'hecha', l.id is not null, 'comodin', coalesce(l.extra, 0),
                  'efecto', case when l.id is null then public.com_efecto(p_emp, f, d.nivel) end)
                  order by d.slot = 0, d.slot)
                from public.com_misiones(p_emp, f) d
                left join public.mis_logros l on l.employee_id = p_emp and l.fecha = f and l.nivel = d.slot
                cross join lateral (select public.mis_medir(p_emp, f, d.tipo, d.params) m) z), '[]'::jsonb),
    'grupo', public.mis_grupo(p_emp),
    'nuevos', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'nivel', coalesce(p.nivel, l.nivel), 'slot', l.nivel, 'texto', l.texto,
                  'puntos', l.puntos, 'comodin', l.extra, 'origen', p.origen) order by l.at)
                from public.mis_logros l
                left join public.mis_personal p on p.employee_id = l.employee_id and p.fecha = l.fecha and p.slot = l.nivel and l.nivel >= 10
                where l.employee_id = p_emp and not l.visto), '[]'::jsonb),
    'puntos', public.mis_saldo(p_emp), 'fichas', public.mis_fichas_saldo(p_emp),
    -- La máquina de esta semana: precio en puntos (carta × 2; con el Cupón, 30 % menos), ventana (y la extra de nivel 2),
    -- unidades que quedan, por qué no se puede pedir y en qué nivel se abre
    'tienda', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'nombre', t.nombre, 'puntos', public.tienda_puntos(t.id),
                  'precio', case when cupon then greatest(1, round(public.tienda_puntos(t.id) * 0.7))::int else public.tienda_puntos(t.id) end,
                  'dish_id', t.dish_id, 'ventana', t.ventana, 'extra', v.extra, 'quedan', public.tienda_quedan(t.id, f),
                  'bloqueo', public.tienda_bloqueo(t.id, f, lim, est),
                  'abre', case when t.ventana = 'premium' then public.mis_mejora('premium') when v.extra then public.mis_mejora('ventana') end)
                order by case t.ventana when 'fija' then 0 when 'rota' then 1 else 2 end, v.extra, t.orden, t.nombre)
                from (select x.item_id, false as extra from public.tienda_vitrina(f) x
                      union all select extra_id, true where extra_id is not null) v
                join public.tienda_items t on t.id = v.item_id), '[]'::jsonb),
    'cupon', cupon,
    'regalo', coalesce((lim ->> 'regalo')::boolean, false),
    'canjes_hoy', (lim ->> 'canjes_hoy')::int, 'canjes_dia', (lim ->> 'canjes_dia')::int,
    'premium_nivel', coalesce((aj ->> 'premium_nivel')::int, 2),
    'mejoras', coalesce(aj -> 'mejoras', '{}'::jsonb) || jsonb_build_object('premium', public.mis_mejora('premium')),
    'estrellas', est,
    'comodines', public.com_estado(p_emp, f, niv),
    'canjes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'puntos', c.puntos, 'estado', c.estado, 'at', c.at,
                  'regalo', c.regalo, 'nota', c.nota) order by c.at desc)
                from (select * from public.tienda_canjes where employee_id = p_emp order by at desc limit 10) c), '[]'::jsonb),
    'ranking', public.mis_ranking(f, p_emp),
    'premios_top', coalesce(aj -> 'premios_top', '[10, 6, 3]'::jsonb),
    'top_premio', (select jsonb_build_object('id', t.id, 'mes', t.mes, 'puesto', t.puesto, 'puntos', t.puntos)
                   from public.mis_top_premios t where t.employee_id = p_emp and not t.visto order by t.mes desc limit 1),
    'campeona', (select jsonb_build_object('mes', t.mes, 'nombre', t.nombre) from public.mis_top_premios t
                 where t.mes = (date_trunc('month', f) - interval '1 month')::date and t.puesto = 1 order by t.nombre limit 1),
    'juegos', jsonb_build_object('activo', coalesce((aj ->> 'juegos')::boolean, true), 'tope_dia', public.jgo_tope(p_emp),
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
declare it record; f date := public.mis_hoy(); lim jsonb; est jsonb; pts int; regalo boolean; bloqueo text; cup bigint; r jsonb; n_abre int;
begin
  perform public.pos_auth(p_emp, p_pin);
  if not public.mis_juega(p_emp) then raise exception 'La tienda es para las meseras y cajeras'; end if;
  select * into it from public.tienda_items where id = p_item and activo;
  if it.id is null then raise exception 'Ese premio ya no está en la tienda'; end if;
  if not exists (select 1 from public.tienda_vitrina(f) v where v.item_id = it.id)
     and not (public.mis_mejora('ventana') is not null and it.id = public.tienda_vitrina_extra(f)) then
    raise exception 'Ese premio no está en la máquina esta semana'; end if;
  -- Un candado para todas: las unidades de la semana y el tope del mes son de todas
  perform pg_advisory_xact_lock(hashtext('tienda'), 0);
  est := public.mis_estrellas(p_emp, f);
  lim := public.tienda_limites(p_emp, f);
  pts := public.tienda_puntos(it.id); regalo := coalesce((lim ->> 'regalo')::boolean, false);
  bloqueo := public.tienda_bloqueo(it.id, f, lim, est);
  n_abre := case when it.ventana = 'premium' then public.mis_mejora('premium') else public.mis_mejora('ventana') end;
  if bloqueo = 'recarga' then raise exception 'La máquina se está recargando: vuelve el día 1'; end if;
  if bloqueo = 'hoy' then raise exception 'Ya pediste % premios hoy: vuelve mañana', lim ->> 'canjes_dia'; end if;
  if bloqueo = 'grande' then raise exception 'Ya pediste tu premio grande de la semana: vuelve el lunes'; end if;
  if bloqueo = 'nivel' then raise exception 'Este premio se abre con el nivel % de estrellas (% ⭐)', n_abre, (est -> 'niveles') ->> (n_abre - 1); end if;
  if bloqueo = 'agotado' then raise exception 'Se agotó esta semana: vuelve el lunes'; end if;
  -- Cupón de Shibu (comodín): el próximo premio cuesta 30 % menos
  if not regalo then
    select x.id into cup from public.com_activas(p_emp, f) x where x.efecto = 'cupon' order by x.id limit 1;
    if cup is not null then pts := greatest(1, round(pts * 0.7))::int; end if;
  end if;
  if not regalo and public.mis_saldo(p_emp) < pts then
    raise exception 'Te faltan % puntos para %', pts - public.mis_saldo(p_emp), it.nombre;
  end if;
  if regalo then pts := 0; end if;
  r := public.tienda_entregar(p_emp, p_pin, it.id, pts, regalo, case when cup is not null then 'Con cupón' else '' end, true);
  if cup is not null then
    update public.com_compras set usado = true, usado_at = now(), datos = datos || jsonb_build_object('canje', r -> 'id') where id = cup;
  end if;
  return jsonb_build_object('id', r -> 'id', 'nombre', it.nombre, 'order_id', r -> 'order_id', 'puntos', public.mis_saldo(p_emp), 'regalo', regalo,
                            'pagado', pts, 'cupon', cup is not null);
end $$;
-- Antes la cajera aprobaba cada premio; ya no hace falta (la compra es directa)
drop function if exists public.tienda_pendientes(bigint, text);
drop function if exists public.tienda_resolver(bigint, text, bigint, boolean, text);

-- ---------------------------------------------------------------- Comprar un comodín (desde la máquina de la tablet)
-- p_datos: {"para": id} para el Regalo y el Duelo, {"insignia": "estrella" | "ramen" | "taiyaki"}, {"nivel": 1-3} para la
-- Ficha de cambio. Si algo falla, no se cobra nada (todo va en una sola operación).
create or replace function public.com_comprar(p_emp bigint, p_pin text, p_comodin int, p_datos jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f date := public.mis_hoy(); k record; est jsonb; niv int; b text; cid bigint; v_desde date := f; v_hasta date := f;
  v_usado boolean := false; dat jsonb := '{}'::jsonb; otra bigint; quien text; msg text; mis jsonb; ent jsonb; dow int := extract(isodow from f)::int;
  v_datos jsonb := coalesce(p_datos, '{}'::jsonb); nv int;
begin
  perform public.pos_auth(p_emp, p_pin);
  if not public.mis_juega(p_emp) then raise exception 'Los comodines son para las meseras y cajeras'; end if;
  select * into k from public.com_catalogo where id = p_comodin;
  if k.id is null then raise exception 'Ese comodín no está en la máquina'; end if;
  perform pg_advisory_xact_lock(hashtext('comodines'), p_emp::int);
  if k.efecto = 'bandera' then perform pg_advisory_xact_lock(hashtext('comodines'), 0); end if;
  est := public.mis_estrellas(p_emp, f); niv := coalesce((est ->> 'nivel')::int, 0);
  b := public.com_bloqueo(p_emp, f, k.id, niv);
  if b = 'no' then raise exception 'Ese comodín no está en la máquina'; end if;
  if b = 'nivel' then raise exception 'Este comodín se abre con el nivel % de estrellas (% ⭐)', k.nivel, (est -> 'niveles') ->> (k.nivel - 1); end if;
  if b = 'semana' then raise exception 'Ya compraste % comodines esta semana: vuelve el lunes', public.com_reglas() ->> 'semana'; end if;
  if b = 'uno_semana' then raise exception 'Este comodín es uno por semana: vuelve el lunes'; end if;
  if b = 'activo' then raise exception 'Ya tienes este comodín activo'; end if;
  if b = 'activos' then raise exception 'Ya tienes % comodines activos: espera a que se acabe uno', public.com_reglas() ->> 'activos'; end if;
  if b = 'bandera' then raise exception 'Hoy ya hay bandera del equipo: otra compañera la compró'; end if;
  if b = 'insignias' then raise exception 'Ya tienes las 3 insignias'; end if;
  if b = 'sin_misiones' then raise exception 'No te quedan misiones por cambiar hoy'; end if;
  if public.mis_saldo(p_emp) < k.puntos then raise exception 'Te faltan % puntos para %', k.puntos - public.mis_saldo(p_emp), k.nombre; end if;
  -- Lo que hay que elegir antes de comprar
  if k.efecto in ('regalo', 'duelo') then
    otra := case when coalesce(v_datos ->> 'para', '') ~ '^\d+$' then (v_datos ->> 'para')::bigint end;
    if otra is null or otra = p_emp or not public.mis_juega(otra) then raise exception 'Elige a una compañera'; end if;
    dat := jsonb_build_object(case when k.efecto = 'regalo' then 'para' else 'rival' end, otra);
  elsif k.efecto = 'insignia' then
    if coalesce(v_datos ->> 'insignia', '') not in ('estrella', 'ramen', 'taiyaki') then raise exception 'Elige tu insignia: estrella, ramen o taiyaki'; end if;
    if exists (select 1 from public.com_compras c where c.employee_id = p_emp and c.efecto = 'insignia' and c.datos ->> 'insignia' = v_datos ->> 'insignia') then
      raise exception 'Ya tienes esa insignia'; end if;
    dat := jsonb_build_object('insignia', v_datos ->> 'insignia');
  elsif k.efecto = 'cambio' then
    nv := case when coalesce(v_datos ->> 'nivel', '') ~ '^[1-3]$' then (v_datos ->> 'nivel')::int end;
    if nv is null or not exists (select 1 from public.com_misiones(p_emp, f) d where d.slot = nv) then raise exception 'Elige la misión que quieres cambiar'; end if;
    if exists (select 1 from public.mis_logros l where l.employee_id = p_emp and l.fecha = f and l.nivel = nv) then raise exception 'Esa misión ya la cumpliste'; end if;
    dat := jsonb_build_object('nivel', nv);
  end if;
  -- Cuándo vale
  if k.efecto in ('x2_todo', 'x2_dificil', 'mas1_mision', 'hora_feliz', 'extra_facil', 'extra_dificil', 'cupon') then v_hasta := f + coalesce(k.dias, 1) - 1;
  elsif k.efecto in ('x3_proxima', 'ficha_dorada', 'carta') then v_hasta := f + 6;
  elsif k.efecto = 'x2_finde' then
    v_desde := case when dow >= 6 then f else f + (6 - dow) end;
    v_hasta := case when dow = 7 then f else v_desde + 1 end;
  elsif k.efecto in ('doble_media', 'mapa') then v_desde := f + 1; v_hasta := f + 1;
  elsif k.efecto = 'reloj' then v_desde := f - 1; v_hasta := f + 6;
  elsif k.efecto in ('fichas3', 'regalo', 'premio_sorpresa', 'insignia', 'cambio') then v_usado := true;
  end if;
  insert into public.com_compras (employee_id, comodin_id, efecto, puntos, desde, hasta, usado, usado_at, datos)
  values (p_emp, k.id, k.efecto, k.puntos, v_desde, v_hasta, v_usado, case when v_usado then now() end, dat) returning id into cid;
  if k.puntos > 0 then insert into public.mis_puntos (employee_id, delta, motivo, ref_id) values (p_emp, -k.puntos, 'comodin_compra', cid); end if;
  quien := coalesce(public.pos_emp_name(p_emp), 'Una compañera');
  -- Lo que pasa al comprarlo
  if k.efecto = 'fichas3' then
    insert into public.mis_fichas (employee_id, delta, motivo, ref_id) values (p_emp, 3, 'comodin', cid);
    msg := '+3 fichas para jugar';
  elsif k.efecto = 'regalo' then
    insert into public.mis_puntos (employee_id, delta, motivo, ref_id) values (otra, 3, 'regalo', cid);
    insert into public.com_avisos (employee_id, icono, texto) values (otra, '🎁', quien || ' te regaló 3 puntos');
    msg := 'Le regalaste 3 puntos a ' || coalesce(public.pos_emp_name(otra), 'tu compañera');
  elsif k.efecto = 'duelo' then
    insert into public.com_avisos (employee_id, icono, texto) values (otra, '⚔️', quien || ' te retó a un duelo de ventas hoy: ¡que gane la mejor!');
    msg := 'Duelo con ' || coalesce(public.pos_emp_name(otra), 'tu compañera') || ': si hoy vendes más que ella, ganas 4 puntos';
  elsif k.efecto = 'cambio' then
    mis := public.com_poner_mision(p_emp, f, nv, nv, 'cambio', cid, true);
    if mis is null then raise exception 'No hay otra misión de ese nivel para hoy'; end if;
    update public.com_compras set datos = datos || jsonb_build_object('mision', mis) where id = cid;
    msg := 'Tu nueva misión: ' || (mis ->> 'texto');
  elsif k.efecto = 'premio_sorpresa' then
    ent := public.tienda_sorpresa(p_emp, p_pin, k.puntos);
    update public.com_compras set datos = datos || jsonb_build_object('canje', ent -> 'id', 'premio', ent ->> 'nombre') where id = cid;
    msg := '¡Te salió ' || (ent ->> 'nombre') || '! Va a cocina';
  elsif k.efecto = 'insignia' then
    msg := 'Tu insignia ya brilla en tu carnet';
  elsif k.efecto in ('extra_facil', 'extra_dificil', 'sorpresa') then
    perform public.com_asignar(p_emp, f);
    msg := 'Ya tienes tu misión extra de hoy';
  elsif k.efecto in ('doble_media', 'mapa') then
    msg := 'Vale para mañana';
  elsif k.efecto = 'x2_finde' then
    msg := case when v_desde = f then 'Vale este fin de semana' else 'Vale el sábado y el domingo' end;
  elsif k.efecto = 'bandera' then
    msg := 'Si hoy el local llega a la meta, todas ganan +1';
  else
    msg := case when v_hasta > f then 'Vale hasta el ' || to_char(v_hasta, 'DD/MM') else 'Vale hoy' end;
  end if;
  return jsonb_build_object('id', cid, 'comodin', k.id, 'nombre', k.nombre, 'icono', k.icono, 'mensaje', msg,
                            'puntos', public.mis_saldo(p_emp), 'fichas', public.mis_fichas_saldo(p_emp), 'premio', ent, 'mision', mis);
end $$;

-- Mapa de Shibu: el día que vale, la maid elige su misión media entre 3 (o se queda con la suya: p_catalogo null)
create or replace function public.com_elegir_mapa(p_emp bigint, p_pin text, p_compra bigint, p_catalogo bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; f date := public.mis_hoy(); mis jsonb;
begin
  perform public.pos_auth(p_emp, p_pin);
  select * into c from public.com_compras where id = p_compra and employee_id = p_emp and efecto = 'mapa' for update;
  if c.id is null or c.usado or f not between c.desde and c.hasta then raise exception 'Ese mapa ya no vale'; end if;
  if p_catalogo is not null then
    if exists (select 1 from public.mis_logros l where l.employee_id = p_emp and l.fecha = f and l.nivel = 2) then raise exception 'Ya cumpliste tu misión media de hoy'; end if;
    if not exists (select 1 from (select x.id from public.com_candidatas(p_emp, f, 2, 'mapa-' || c.id::text) x limit 3) o where o.id = p_catalogo) then
      raise exception 'Esa misión no está en tu mapa'; end if;
    mis := public.com_poner_mision(p_emp, f, 2, 2, 'mapa', c.id, true, p_catalogo);
  end if;
  update public.com_compras set usado = true, usado_at = now(), datos = datos || jsonb_build_object('mision', mis) where id = c.id;
  return coalesce(mis, '{}'::jsonb);
end $$;

-- La tablet ya mostró estos avisos
create or replace function public.com_visto(p_emp bigint, p_pin text, p_ids bigint[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.pos_auth(p_emp, p_pin);
  update public.com_avisos set visto = true where employee_id = p_emp and id = any (coalesce(p_ids, '{}'));
end $$;

-- ---------------------------------------------------------------- Juegos (el resultado lo decide la base, nunca la tablet)
-- Tope del día jugando: con el comodín «Tope abierto», 2 más
create or replace function public.jgo_tope(p_emp bigint) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((public.mis_ajustes() ->> 'tope_juegos')::int, 3)
       + case when exists (select 1 from public.com_activas(p_emp, public.mis_hoy()) x where x.efecto = 'tope5') then 2 else 0 end $$;
-- Ficha dorada (comodín): se gasta en la próxima jugada; si perdió, le devuelve la ficha
create or replace function public.jgo_dorada(p_emp bigint, p_perdio boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare cid bigint;
begin
  select x.id into cid from public.com_activas(p_emp, public.mis_hoy()) x where x.efecto = 'ficha_dorada' order by x.id limit 1;
  if cid is null then return false; end if;
  update public.com_compras set usado = true, usado_at = now(), datos = datos || jsonb_build_object('perdio', p_perdio) where id = cid;
  if p_perdio then insert into public.mis_fichas (employee_id, delta, motivo, ref_id) values (p_emp, 1, 'ficha_dorada', cid); end if;
  return p_perdio;
end $$;
-- Gasta 1 ficha. Frena si los juegos están apagados, si ya ganó el tope de hoy o si no tiene fichas.
create or replace function public.jgo_gastar_ficha(p_emp bigint, p_juego text) returns void
language plpgsql security definer set search_path = public as $$
declare aj jsonb := public.mis_ajustes(); tope int := public.jgo_tope(p_emp);
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
declare tope int := public.jgo_tope(p_emp); gana int;
begin
  gana := greatest(least(coalesce(p_premio, 0), tope - public.jgo_ganado_hoy(p_emp)), 0);
  if gana > 0 then insert into public.mis_puntos (employee_id, delta, motivo, ref_id) values (p_emp, gana, 'juego:' || p_juego, p_partida); end if;
  update public.jgo_partidas set premio = gana where id = p_partida;
  return gana;
end $$;

create or replace function public.jgo_contadores(p_emp bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('fichas', public.mis_fichas_saldo(p_emp), 'puntos', public.mis_saldo(p_emp), 'ganado_hoy', public.jgo_ganado_hoy(p_emp),
                            'tope_dia', public.jgo_tope(p_emp))
$$;

create or replace function public.jgo_estado(p_emp bigint, p_pin text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.pos_auth(p_emp, p_pin);
  return public.jgo_contadores(p_emp) || jsonb_build_object('activo', public.mis_juega(p_emp) and coalesce((public.mis_ajustes() ->> 'juegos')::boolean, true),
                                                            'casillas', to_jsonb(public.jgo_casillas(p_emp)));
end $$;

-- Tragamonedas: 3 iguales = 3 puntos, 2 iguales = 1 punto
create or replace function public.jgo_tragamonedas(p_emp bigint, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare simb text[] := array['shibu', 'ramen', 'sushi', 'taiyaki', 'dango', 'estrella']; r text[]; premio int; pid bigint; gana int; msg text; dorada boolean;
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
  dorada := public.jgo_dorada(p_emp, premio = 0);
  if dorada then msg := msg || ' · La ficha dorada te devolvió la ficha'; end if;
  return jsonb_build_object('carretes', to_jsonb(r), 'premio', gana, 'al_tope', gana < premio, 'mensaje', msg, 'dorada', dorada) || public.jgo_contadores(p_emp);
end $$;

-- Ruleta (pedido de Edgar, 24/11): una rueda de premios de 15 casillas. 12 tienen la cara de Shibu (sin premio) y 3
-- pagan x1, x2 y x3 (1, 2 o 3 puntos): se gana 3 de cada 15 veces, el 20 %. Cada casilla sale con la misma probabilidad,
-- así la rueda que se ve dice la verdad. La tablet la dibuja con esta misma lista (jgo_estado la manda).
create or replace function public.jgo_ruleta_casillas() returns int[] language sql immutable as $$
  select array[3, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0] $$;
-- Con el Trébol de cuatro hojas (comodín), la rueda de ese día tiene la mitad de caras de Shibu: gana 1 de cada 3 veces
create or replace function public.jgo_casillas(p_emp bigint) returns int[]
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from public.com_activas(p_emp, public.mis_hoy()) x where x.efecto = 'trebol')
              then array[3, 0, 0, 1, 0, 0, 2, 0, 0] else public.jgo_ruleta_casillas() end $$;
drop function if exists public.jgo_ruleta(bigint, text, text);   -- la de casino (con apuesta) que hubo en la prueba
create or replace function public.jgo_ruleta(p_emp bigint, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c int[] := public.jgo_casillas(p_emp); k int; premio int; pid bigint; gana int; msg text; dorada boolean;
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
  dorada := public.jgo_dorada(p_emp, premio = 0);
  if dorada then msg := msg || ' · La ficha dorada te devolvió la ficha'; end if;
  return jsonb_build_object('casilla', k, 'mult', premio, 'premio', gana, 'al_tope', gana < premio, 'mensaje', msg, 'dorada', dorada,
                            'casillas', to_jsonb(c)) || public.jgo_contadores(p_emp);
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
declare p record; j jsonb; c jsonb; fin boolean; espia boolean;
begin
  select * into p from public.jgo_partidas where id = p_id;
  j := p.resultado -> 'jugador'; c := p.resultado -> 'crupier'; fin := p.estado = 'terminada';
  espia := coalesce((p.resultado ->> 'espia')::boolean, false);   -- Carta bajo la manga: ve la carta tapada del crupier
  return jsonb_build_object('id', p.id, 'jugador', j, 'total', public.jgo_bj_total(j),
      'crupier', case when fin or espia then c else jsonb_build_array(c -> 0, null) end, 'espia', espia,
      'dorada', coalesce((p.resultado ->> 'dorada')::boolean, false),
      'estado', coalesce(p.resultado ->> 'final', 'jugando'), 'premio', p.premio)
    || case when fin then jsonb_build_object('total_crupier', public.jgo_bj_total(c),
         -- ganó, pero el tope del día recortó el premio (otros juegos lo llenaron mientras la mano seguía abierta)
         'al_tope', p.premio < case p.resultado ->> 'final' when 'blackjack' then 2 when 'gano' then 1 else 0 end) else '{}'::jsonb end;
end $$;

-- Termina la mano: juega el crupier (si hace falta), decide y paga
create or replace function public.jgo_bj_terminar(p_id bigint, p_final text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p record; j jsonb; c jsonb; mazo jsonb; tj int; tc int; fin text := p_final; premio int := 0; dorada boolean;
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
  dorada := public.jgo_dorada(p.employee_id, fin = 'perdio');   -- la Ficha dorada devuelve la ficha si perdió
  update public.jgo_partidas set estado = 'terminada', mazo = null,
    resultado = p.resultado || jsonb_build_object('jugador', j, 'crupier', c, 'final', fin, 'dorada', dorada) where id = p_id;
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
declare mazo jsonb; j jsonb; c jsonb; pid bigint; v jsonb; carta bigint;
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
  else
    -- Carta bajo la manga (comodín): en esta mano ve la carta tapada del crupier
    select x.id into carta from public.com_activas(p_emp, public.mis_hoy()) x where x.efecto = 'carta' order by x.id limit 1;
    if carta is not null then
      update public.com_compras set usado = true, usado_at = now(), datos = datos || jsonb_build_object('partida', pid) where id = carta;
      update public.jgo_partidas set resultado = resultado || '{"espia": true}'::jsonb where id = pid;
    end if;
  end if;
  v := public.jgo_bj_vista(pid);
  return v || jsonb_build_object('mensaje', public.jgo_bj_mensaje(v ->> 'estado', (v ->> 'premio')::int)
                                   || case when (v ->> 'dorada')::boolean then ' · La ficha dorada te devolvió la ficha' else '' end) || public.jgo_contadores(p_emp);
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
  return v || jsonb_build_object('mensaje', public.jgo_bj_mensaje(v ->> 'estado', (v ->> 'premio')::int)
                                   || case when (v ->> 'dorada')::boolean then ' · La ficha dorada te devolvió la ficha' else '' end) || public.jgo_contadores(p_emp);
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
                            'puntos_mes', (select coalesce(sum(p.delta), 0) from public.mis_puntos p where p.employee_id = e.id and p.delta > 0 and p.at >= (m0::timestamp at time zone 'America/Caracas')),
                            'estrellas', public.mis_estrellas(e.id, f))
                          order by e.name) from public.employees e where public.mis_juega(e.id)), '[]'::jsonb),
    'canjes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'quien', e.name, 'nombre', c.nombre, 'puntos', c.puntos, 'estado', c.estado, 'at', c.at) order by c.at desc)
                        from (select * from public.tienda_canjes order by at desc limit 50) c join public.employees e on e.id = c.employee_id), '[]'::jsonb),
    'tienda', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('puntos_carta', public.tienda_puntos(t.id), 'costo', public.tienda_costo(t.id),
                          'en_maquina', exists (select 1 from public.tienda_vitrina(f) v where v.item_id = t.id), 'quedan', public.tienda_quedan(t.id, f))
                        order by t.orden, t.puntos) from public.tienda_items t), '[]'::jsonb),
    'gasto_mes', public.tienda_gasto_mes(f),
    'comodines', coalesce((select jsonb_agg(to_jsonb(k) order by k.nivel nulls last, k.orden) from public.com_catalogo k), '[]'::jsonb),
    'com_compras', coalesce((select jsonb_agg(jsonb_build_object('quien', e.name, 'nombre', k.nombre, 'puntos', c.puntos, 'at', c.at) order by c.at desc)
                  from (select * from public.com_compras order by at desc limit 50) c join public.employees e on e.id = c.employee_id
                  join public.com_catalogo k on k.id = c.comodin_id), '[]'::jsonb));
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

-- Un premio de la máquina. Los de la carta cuestan el doble de su precio (tienda_puntos); p_puntos vale para los demás.
-- ventana: 'fija', 'rota' (cambia cada lunes; p_por_semana unidades por semana) o 'premium' (cada 2 semanas, nivel 2)
drop function if exists public.gestion_tienda_guardar(bigint, text, integer, bigint, text, boolean);
create or replace function public.gestion_tienda_guardar(p_id bigint, p_nombre text, p_puntos int, p_dish bigint default null,
  p_variant text default '', p_activo boolean default true, p_ventana text default 'fija', p_por_semana int default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare nid bigint;
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  if coalesce(trim(p_nombre), '') = '' or coalesce(p_puntos, 0) < 1 or p_puntos > 1000 then raise exception 'Escribe el premio y sus puntos (1 a 1000)'; end if;
  if coalesce(p_ventana, 'fija') not in ('fija', 'rota', 'premium') then raise exception 'La ventana es fija, rota o premium'; end if;
  if p_por_semana is not null and p_por_semana not between 1 and 50 then raise exception 'Las unidades por semana van de 1 a 50'; end if;
  if p_id is null then
    insert into public.tienda_items (nombre, puntos, dish_id, variant, activo, ventana, por_semana)
    values (trim(p_nombre), p_puntos, p_dish, coalesce(p_variant, ''), coalesce(p_activo, true), coalesce(p_ventana, 'fija'), p_por_semana)
    returning id into nid;
  else
    update public.tienda_items set nombre = trim(p_nombre), puntos = p_puntos, dish_id = p_dish, variant = coalesce(p_variant, ''), activo = coalesce(p_activo, true),
      ventana = coalesce(p_ventana, 'fija'), por_semana = p_por_semana
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
                                                                          where k not in ('activo', 'juegos', 'tope_juegos', 'plato_semana', 'tope_mes_usd',
                                                                                          'canjes_dia', 'grande_puntos', 'grandes_semana', 'rota_ventanas',
                                                                                          'rota_por_semana', 'premium_nivel', 'comodines', 'mejoras')));
  if (v ->> 'tope_juegos')::int not between 0 and 10 then raise exception 'El tope de los juegos va de 0 a 10 puntos'; end if;
  if coalesce((v ->> 'tope_mes_usd')::numeric, 0) not between 0 and 1000 then raise exception 'El tope del mes va de $0 (sin tope) a $1000'; end if;
  if (v ->> 'canjes_dia')::int not between 1 and 10 then raise exception 'Los premios por día van de 1 a 10'; end if;
  if (v ->> 'grande_puntos')::int not between 1 and 1000 or (v ->> 'grandes_semana')::int not between 0 and 7 then
    raise exception 'Revisa el premio grande: de 1 a 1000 puntos y de 0 a 7 por semana'; end if;
  if (v ->> 'rota_ventanas')::int not between 0 and 8 or (v ->> 'rota_por_semana')::int not between 1 and 50 then
    raise exception 'Revisa las ventanas que rotan: de 0 a 8, con 1 a 50 unidades por semana'; end if;
  if (v ->> 'premium_nivel')::int not between 0 and 5 then raise exception 'El nivel de la ventana premium va de 0 a 5'; end if;
  if jsonb_typeof(v -> 'comodines') <> 'object' or coalesce((v #>> '{comodines,activos}')::int, 0) not between 1 and 5
     or coalesce((v #>> '{comodines,semana}')::int, 0) not between 1 and 14 then
    raise exception 'Revisa los comodines: de 1 a 5 activos y de 1 a 14 por semana'; end if;
  if jsonb_typeof(v -> 'mejoras') <> 'object' then raise exception 'Revisa los niveles de las mejoras'; end if;
  insert into public.pos_kv (key, value) values ('misiones', v) on conflict (key) do update set value = excluded.value, updated_at = now();
  return v;
end $$;

-- ---------------------------------------------------------------- Mis ventas (Mi perfil, pedido de Edgar del 24/11)
-- Lo que la maid vendió hoy, en la semana (desde el lunes) y en el mes; sus últimos 14 días; sus comandas de los
-- últimos 7 días con lo que llevaba cada una, y sus platos más vendidos del mes. Cuenta igual que las misiones.
create or replace function public.mis_ventas(p_emp bigint, p_pin text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  f date := public.mis_hoy();
  lunes date := f - (extract(isodow from f)::int - 1);
  mes0 date := date_trunc('month', f)::date;
  r jsonb;
begin
  perform public.pos_auth(p_emp, p_pin);
  with it as (select * from public.mis_items_rango(p_emp, least(f - 13, mes0), f)),
  com as (select order_id, min(fecha) fecha, sum(monto) monto, coalesce(sum(qty) filter (where not es_extra), 0) platos,
                 max(cerrada) cerrada, min(mesa) mesa, min(numero) numero, min(kind) kind
          from it group by order_id),
  dia as (select fecha, sum(monto) monto, count(*) n from com group by fecha)
  select jsonb_build_object(
    'fecha', f, 'lunes', lunes, 'mes', mes0,
    'hoy', (select jsonb_build_object('monto', coalesce(sum(monto), 0), 'comandas', count(*), 'platos', coalesce(sum(platos), 0)) from com where fecha = f),
    'semana', (select jsonb_build_object('monto', coalesce(sum(monto), 0), 'comandas', count(*)) from com where fecha >= lunes),
    -- La semana pasada hasta el mismo día (para comparar parejo)
    'semana_pasada', (select jsonb_build_object('monto', coalesce(sum(monto), 0), 'comandas', count(*)) from com where fecha between lunes - 7 and f - 7),
    'mes_total', (select jsonb_build_object('monto', coalesce(sum(monto), 0), 'comandas', count(*), 'platos', coalesce(sum(platos), 0),
                                            'dias', count(distinct fecha)) from com where fecha >= mes0),
    'dias', (select jsonb_agg(jsonb_build_object('fecha', g::date, 'monto', coalesce(dia.monto, 0), 'comandas', coalesce(dia.n, 0)) order by g)
             from generate_series(f - 13, f, interval '1 day') g left join dia on dia.fecha = g::date),
    'mejor_dia', (select jsonb_build_object('fecha', fecha, 'monto', monto) from dia where fecha >= mes0 order by monto desc, fecha desc limit 1),
    'platos_top', coalesce((select jsonb_agg(jsonb_build_object('nombre', nombre, 'qty', q, 'monto', m) order by q desc, m desc, nombre)
                            from (select nombre, sum(qty) q, sum(monto) m from it where fecha >= mes0 and not es_extra
                                  group by nombre order by sum(qty) desc, sum(monto) desc, nombre limit 5) p), '[]'::jsonb),
    'comandas', coalesce((select jsonb_agg(jsonb_build_object('id', c.order_id, 'fecha', c.fecha, 'cerrada', c.cerrada, 'mesa', c.mesa,
                            'numero', c.numero, 'kind', c.kind, 'monto', c.monto, 'platos', c.platos,
                            'detalle', (select string_agg(case when z.q = 1 then z.nombre else trim_scale(z.q)::text || '× ' || z.nombre end, ' · '
                                                          order by z.q desc, z.nombre)
                                        from (select i.nombre || case when i.variant <> '' then ' ' || i.variant else '' end nombre, sum(i.qty) q
                                              from it i where i.order_id = c.order_id group by 1) z)) order by c.cerrada desc)
                          from (select * from com where fecha >= f - 6 order by cerrada desc limit 40) c), '[]'::jsonb)
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------- Permisos: las funciones internas no se llaman desde afuera
revoke execute on function public.mis_ajustes(), public.mis_juega(bigint), public.mis_saldo(bigint), public.mis_fichas_saldo(bigint),
  public.jgo_ganado_hoy(bigint), public.mis_items(bigint, date), public.mis_items_rango(bigint, date, date), public.mis_comandas(bigint, date), public.mis_venta_dia(bigint, date),
  public.mis_trabajo(bigint, date), public.mis_medir(bigint, date, text, jsonb), public.mis_asignar(date), public.mis_revisar(bigint, date, boolean),
  public.mis_tras_cobro(), public.mis_tras_cierre(), public.jgo_gastar_ficha(bigint, text), public.jgo_pagar(bigint, text, int, bigint),
  public.jgo_contadores(bigint), public.jgo_bj_vista(bigint), public.jgo_bj_terminar(bigint, text), public.jgo_ruleta_casillas(),
  public.mis_grupo(bigint), public.mis_azar(date, bigint), public.mis_hay_promo(date), public.mis_ranking(date, bigint),
  public.mis_ranking_filas(date), public.mis_top_revisar(date),
  public.opinion_atendieron(bigint), public.mis_estrellas_todas(date), public.mis_estrellas(bigint, date),
  public.tienda_precio_carta(bigint, text), public.tienda_puntos(bigint), public.tienda_costo(bigint), public.tienda_lunes(date),
  public.tienda_quincena(date), public.tienda_vitrina(date), public.tienda_quedan(bigint, date), public.tienda_gasto_mes(date),
  public.tienda_limites(bigint, date), public.tienda_bloqueo(bigint, date, jsonb, jsonb),
  public.mis_mejora(text), public.mis_nivel(bigint, date), public.com_listo(text), public.com_instantaneo(text), public.com_reglas(),
  public.com_activas(bigint, date), public.com_ocupados(bigint, date), public.com_misiones(bigint, date), public.com_candidatas(bigint, date, int, text),
  public.com_poner_mision(bigint, date, int, int, text, bigint, boolean, bigint), public.com_asignar(bigint, date),
  public.com_efecto(bigint, date, int, boolean), public.com_premiar(bigint, date, int, int, bigint), public.com_hora_feliz(bigint, date),
  public.com_bandera(bigint, date), public.com_resolver_duelos(date), public.com_bloqueo(bigint, date, int, int), public.com_estado(bigint, date, int),
  public.tienda_vitrina_extra(date), public.tienda_entregar(bigint, text, bigint, int, boolean, text, boolean), public.tienda_sorpresa(bigint, text, int),
  public.jgo_tope(bigint), public.jgo_casillas(bigint), public.jgo_dorada(bigint, boolean)
  from anon, public, authenticated;

-- Las de la tablet y Gestión: solo con sesión (adentro verifican el PIN o el permiso de Gestión)
do $$
declare f text;
begin
  foreach f in array array['mis_estado(bigint, text)', 'mis_marcar(bigint, text, boolean, bigint[])', 'tienda_canjear(bigint, text, bigint)',
                           'com_comprar(bigint, text, integer, jsonb)', 'com_elegir_mapa(bigint, text, bigint, bigint)', 'com_visto(bigint, text, bigint[])',
                           'mis_top_visto(bigint, text, bigint)', 'mis_ventas(bigint, text)',
                           'jgo_estado(bigint, text)',
                           'jgo_tragamonedas(bigint, text)', 'jgo_ruleta(bigint, text)', 'jgo_bj_empezar(bigint, text)',
                           'jgo_bj_accion(bigint, text, bigint, text)', 'gestion_misiones()', 'gestion_mision_guardar(bigint, boolean, text, integer, text, jsonb)',
                           'gestion_tienda_guardar(bigint, text, integer, bigint, text, boolean, text, integer)', 'gestion_misiones_ajustes(jsonb)'] loop
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

-- Premios de la máquina para empezar (doc «Economía de puntos y estrellas», 25/11): 2 fijas, 7 que rotan cada lunes
-- (5 unidades por semana) y 2 premium. Los puntos de aquí son de referencia: los de la carta cuestan el doble de su precio.
insert into public.tienda_items (nombre, puntos, dish_id, variant, orden, ventana, por_semana)
select x.nombre, x.puntos, d.id, x.variant, x.orden, x.ventana, x.por_semana
from (values ('Refresco', 5, 'Refresco', 'Lata', 1, 'fija', null::int), ('Taiyaki', 5, 'Taiyaki', '', 2, 'fija', null),
             ('Té Verde', 3, 'Té Verde', '', 3, 'rota', 5), ('Jugo Sakura', 4, 'Jugo Sakura', '', 4, 'rota', 5),
             ('Limonada rosa', 4, 'Limonada rosa', '', 5, 'rota', 5), ('Dorayaki', 6, 'Dorayaki', '', 6, 'rota', 5),
             ('Bubble Tea', 8, 'Bubble Tea', '', 7, 'rota', 5), ('Gyozas', 10, 'Gyozas', '', 8, 'rota', 5),
             ('Dangos', 10, 'Dangos', '', 9, 'rota', 5),
             ('Milk Tea', 10, 'Milk Tea', '', 10, 'premium', null), ('Amaterasu', 20, 'Amaterasu', 'Peq', 11, 'premium', null))
     x(nombre, puntos, plato, variant, orden, ventana, por_semana)
join public.dishes d on d.name = x.plato
on conflict (nombre) do nothing;
