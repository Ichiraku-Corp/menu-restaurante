-- ============================================================================
-- Ventas por WhatsApp (Ichiraku). Plan: docs/whatsapp-ventas.md
--  · La carta guarda el carrito (wa_cart_create) y el cliente lo manda por WhatsApp con un código.
--  · La función «whatsapp» (Edge Function, service_role) recibe los mensajes, arma el pedido y lo
--    deja «por aceptar». Caja lo acepta con su PIN y entra al sistema de ventas como cualquier
--    Delivery o Para llevar (misma comanda, inventario y cliente).
--  · Los avisos al cliente se dejan en wa_outbox y la función los envía.
-- Ejecutar en Supabase → SQL Editor DESPUÉS de pos.sql. Se puede ejecutar más de una vez.
-- Nada de esto cambia cómo funciona hoy la caja: solo añade tablas, columnas y funciones.
-- ============================================================================

-- ---------------------------------------------------------------- Ajustes
create table if not exists public.wa_settings (
  id            int primary key default 1 check (id = 1),
  bot_active    boolean not null default true,
  welcome       text not null default '¡Irasshaimase! 🍜 Bienvenido a Ichiraku Ramen. ¿En qué te ayudamos?',
  menu_url      text not null default 'https://ichiraku-corp.github.io/menu-restaurante/',
  -- Horario por día de la semana (0 = domingo): {"0": ["12:00", "22:00"], ...}; día sin clave = cerrado
  hours         jsonb not null default '{"0":["11:30","20:30"],"1":["12:30","21:30"],"2":["11:30","20:30"],"3":["11:30","20:30"],"4":["11:30","20:30"],"5":["11:30","20:30"],"6":["11:30","20:30"]}'::jsonb,
  address_text  text not null default 'San Diego – Centro Comercial Metrópolis – Nivel Sol – Feria de comida',
  maps_url      text not null default 'https://maps.google.com/?cid=13659344647129244749',
  -- Punto exacto del local: el bot lo manda como «ubicación» de WhatsApp (se abre en el mapa del teléfono)
  lat           numeric(9,6) default 10.184187,
  lng           numeric(9,6) default -67.973961,
  -- Datos de pago que el bot envía (pago móvil, Zelle, Binance, PayPal). Van aquí y no en el código: el repositorio es público.
  payment_info  text not null default '',
  delivery_min  numeric(10,2) not null default 10 check (delivery_min >= 0),   -- pedido mínimo de delivery, sin el envío
  allow_cash    boolean not null default false,                                -- efectivo al recibir
  auto_accept   boolean not null default false,                                -- pasar a cocina sin caja si el pago está comprobado (más adelante)
  updated_at    timestamptz not null default now()
);
insert into public.wa_settings (id) values (1) on conflict do nothing;
alter table public.wa_settings add column if not exists maps_url text not null default 'https://maps.google.com/?cid=13659344647129244749';
alter table public.wa_settings add column if not exists lat numeric(9,6) default 10.184187;
alter table public.wa_settings add column if not exists lng numeric(9,6) default -67.973961;

create table if not exists public.wa_zones (
  id       bigint generated always as identity primary key,
  name     text not null check (length(trim(name)) between 2 and 60),
  fee      numeric(10,2) not null default 0 check (fee >= 0),
  active   boolean not null default true,
  position int not null default 0
);

-- ---------------------------------------------------------------- Conversaciones y mensajes
create table if not exists public.wa_conversations (
  id           bigint generated always as identity primary key,
  phone        text not null unique,                 -- solo dígitos con código de país: 58414…
  name         text not null default '',             -- nombre del perfil de WhatsApp
  customer_id  bigint references public.customers(id) on delete set null,
  last_in_at   timestamptz,                          -- último mensaje del cliente (ventana de 24 h)
  last_msg_at  timestamptz not null default now(),
  unread       int not null default 0,
  bot_paused   boolean not null default false,       -- una persona atiende esta conversación
  referral     jsonb,                                -- anuncio «Click to WhatsApp» de origen (primer contacto)
  created_at   timestamptz not null default now()
);

create table if not exists public.wa_messages (
  id              bigint generated always as identity primary key,
  conversation_id bigint not null references public.wa_conversations(id) on delete cascade,
  direction       text not null check (direction in ('in', 'out')),
  wa_id           text unique,                       -- id de Meta: si Meta reenvía el mismo mensaje no se duplica
  type            text not null default 'text',
  body            text not null default '',
  payload         jsonb,
  status          text not null default 'recibido' check (status in ('recibido', 'pendiente', 'enviado', 'entregado', 'leido', 'error')),
  error           text not null default '',
  sent_by         text not null default '',          -- 'bot', 'nex' o el nombre de quien respondió
  created_at      timestamptz not null default now()
);
create index if not exists wa_messages_conv on public.wa_messages (conversation_id, id);

-- ---------------------------------------------------------------- Carritos de la carta y pedidos
create table if not exists public.wa_carts (
  code       text primary key,
  items      jsonb not null,
  subtotal   numeric(12,2) not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours',
  used_at    timestamptz
);
create index if not exists wa_carts_created on public.wa_carts (created_at);

create table if not exists public.wa_orders (
  id              bigint generated always as identity primary key,
  conversation_id bigint not null references public.wa_conversations(id) on delete cascade,
  cart_code       text,
  items           jsonb not null,                    -- [{dish_id, name, variant, option, notes, qty, unit_price}]
  subtotal        numeric(12,2) not null,
  kind            text check (kind in ('llevar', 'delivery')),
  zone_id         bigint references public.wa_zones(id) on delete set null,
  delivery_fee    numeric(10,2) not null default 0,
  address         text not null default '',
  location        jsonb,                             -- ubicación enviada por WhatsApp {latitude, longitude}
  customer_name   text not null default '',
  doc_id          text not null default '',          -- cédula o RIF
  scheduled_for   timestamptz,                       -- pedido para más tarde (fuera de horario)
  payment_method  text not null default '',
  payment_ref     text not null default '',
  payment_media   text not null default '',          -- id de la captura del pago en Meta
  status          text not null default 'borrador'
                  check (status in ('borrador', 'por_aceptar', 'aceptado', 'rechazado', 'cancelado')),
  reject_reason   text not null default '',
  pos_order_id    bigint references public.pos_orders(id) on delete set null,
  handled_by      bigint references public.employees(id) on delete set null,
  created_at      timestamptz not null default now(),
  submitted_at    timestamptz,
  handled_at      timestamptz
);
create index if not exists wa_orders_status on public.wa_orders (status, submitted_at);
alter table public.wa_orders add column if not exists ready_at timestamptz;   -- se avisó «listo» o «en camino»
create unique index if not exists wa_orders_one_draft on public.wa_orders (conversation_id) where status = 'borrador';

create table if not exists public.wa_reservations (
  id              bigint generated always as identity primary key,
  conversation_id bigint not null references public.wa_conversations(id) on delete cascade,
  name            text not null,
  people          int not null check (people between 1 and 40),
  reserved_for    timestamptz not null,
  area            text not null default '',          -- preferencia: Feria, Tokio, Edo
  notes           text not null default '',
  status          text not null default 'pendiente' check (status in ('pendiente', 'confirmada', 'rechazada', 'cancelada')),
  handled_by      bigint references public.employees(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists wa_reservations_when on public.wa_reservations (reserved_for);

-- ---------------------------------------------------------------- Salida y medición
create table if not exists public.wa_outbox (
  id              bigint generated always as identity primary key,
  conversation_id bigint not null references public.wa_conversations(id) on delete cascade,
  kind            text not null default 'texto' check (kind in ('texto', 'plantilla')),
  body            text not null default '',
  template        text not null default '',
  params          jsonb not null default '[]'::jsonb,
  sent_by         text not null default 'bot',
  status          text not null default 'pendiente' check (status in ('pendiente', 'enviado', 'error')),
  attempts        int not null default 0,
  error           text not null default '',
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index if not exists wa_outbox_pending on public.wa_outbox (id) where status = 'pendiente';

create table if not exists public.wa_events (
  id              bigint generated always as identity primary key,
  conversation_id bigint references public.wa_conversations(id) on delete cascade,
  event           text not null,                     -- conversacion, carrito, pedido_enviado, aceptado, rechazado, reserva…
  detail          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists wa_events_when on public.wa_events (created_at);

-- ---------------------------------------------------------------- Columnas nuevas en tablas existentes
alter table public.customers  add column if not exists wa_phone text;
create unique index if not exists customers_wa_phone on public.customers (wa_phone) where wa_phone is not null;
alter table public.pos_orders add column if not exists origin text not null default 'pos';
alter table public.pos_orders drop constraint if exists pos_orders_origin_check;
alter table public.pos_orders add constraint pos_orders_origin_check check (origin in ('pos', 'whatsapp'));

-- Tablas internas: nadie entra directo (ni el público ni las tablets), solo a través de las funciones.
do $$
declare t text;
begin
  foreach t in array array['wa_settings', 'wa_zones', 'wa_conversations', 'wa_messages', 'wa_carts', 'wa_orders',
                           'wa_reservations', 'wa_outbox', 'wa_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
-- Gestión (dueño/admin con 2FA) edita ajustes y zonas desde el panel.
drop policy if exists manage_all on public.wa_settings;
create policy manage_all on public.wa_settings for all to authenticated using (public.can_manage()) with check (public.can_manage());
grant select, update on public.wa_settings to authenticated;
drop policy if exists manage_all on public.wa_zones;
create policy manage_all on public.wa_zones for all to authenticated using (public.can_manage()) with check (public.can_manage());
grant select, insert, update, delete on public.wa_zones to authenticated;

-- ---------------------------------------------------------------- Ayudantes
-- Teléfono a formato de WhatsApp: solo dígitos y con código de país (0414… → 58414…).
create or replace function public.wa_phone_norm(p text) returns text
language sql immutable set search_path = public as $$
  select case when d ~ '^0[0-9]{10}$' then '58' || substr(d, 2) else nullif(d, '') end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x
$$;

-- Valida los platos con los precios y la disponibilidad ACTUALES (nunca confía en lo que manda el cliente).
-- p_items: [{"dish_id": 1, "variant": "Gr", "option": "Fresa", "notes": "sin cebollín", "qty": 2}]
create or replace function public.wa_check_items(p_items jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare it record; d record; price numeric; opt text; out jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'El pedido está vacío'; end if;
  if jsonb_array_length(p_items) > 30 then raise exception 'Demasiados platos en un pedido'; end if;
  for it in select * from jsonb_to_recordset(p_items) as x(dish_id bigint, variant text, option text, notes text, qty numeric) loop
    select * into d from public.dishes where id = it.dish_id;
    if d.id is null then raise exception 'Plato no encontrado'; end if;
    if not d.available then raise exception '% está agotado', d.name; end if;
    if it.qty is null or it.qty <> trunc(it.qty) or it.qty < 1 or it.qty > 20 then raise exception 'Cantidad no válida para %', d.name; end if;
    price := d.price;
    if jsonb_typeof(d.variants) = 'array' and jsonb_array_length(d.variants) > 0 then
      select (v ->> 'price')::numeric into price from jsonb_array_elements(d.variants) v where v ->> 'label' = coalesce(it.variant, '');
      if price is null then raise exception 'Elige el tamaño de %', d.name; end if;
    end if;
    opt := left(trim(coalesce(it.option, '')), 40);
    if opt <> '' and not (opt = any (d.options)) then raise exception 'Opción no válida para %', d.name; end if;
    out := out || jsonb_build_object('dish_id', d.id, 'name', d.name, 'variant', coalesce(it.variant, ''), 'option', opt,
                                     'notes', left(trim(coalesce(it.notes, '')), 120), 'qty', it.qty, 'unit_price', price);
  end loop;
  return out;
end $$;

create or replace function public.wa_items_total(p_items jsonb) returns numeric
language sql immutable set search_path = public as $$
  select coalesce(sum((x ->> 'qty')::numeric * (x ->> 'unit_price')::numeric), 0) from jsonb_array_elements(p_items) x
$$;

create or replace function public.wa_event(p_conv bigint, p_event text, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.wa_events (conversation_id, event, detail) values (p_conv, p_event, coalesce(p_detail, '{}'::jsonb))
$$;

create or replace function public.wa_queue(p_conv bigint, p_body text, p_sent_by text default 'bot') returns bigint
language sql security definer set search_path = public as $$
  insert into public.wa_outbox (conversation_id, body, sent_by) values (p_conv, p_body, coalesce(p_sent_by, 'bot')) returning id
$$;

-- ¿Está abierto el local a esa hora (hora de Venezuela)?
create or replace function public.wa_is_open(p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select (t.l::time >= (x.h ->> 0)::time and t.l::time < (x.h ->> 1)::time)
    from public.wa_settings s,
         lateral (select p_at at time zone 'America/Caracas' as l) t,
         lateral (select s.hours -> extract(dow from t.l)::int::text as h) x
    where s.id = 1 and x.h is not null), false)
$$;

-- Resumen de un pedido para el cliente y para caja.
create or replace function public.wa_order_json(p_order bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', o.id, 'status', o.status, 'items', o.items, 'subtotal', o.subtotal, 'kind', o.kind,
    'zone', z.name, 'delivery_fee', o.delivery_fee, 'total', o.subtotal + o.delivery_fee,
    'total_bs', round((o.subtotal + o.delivery_fee) * public.pos_rate(), 2), 'rate', public.pos_rate(),
    'address', o.address, 'location', o.location, 'customer_name', o.customer_name, 'doc_id', o.doc_id,
    'scheduled_for', o.scheduled_for, 'payment_method', o.payment_method, 'payment_ref', o.payment_ref,
    'has_payment_media', o.payment_media <> '', 'payment_media', o.payment_media, 'ready_at', o.ready_at, 'phone', c.phone, 'wa_name', c.name, 'submitted_at', o.submitted_at,
    'pos_order_id', o.pos_order_id, 'reject_reason', o.reject_reason)
  from public.wa_orders o join public.wa_conversations c on c.id = o.conversation_id
  left join public.wa_zones z on z.id = o.zone_id where o.id = p_order
$$;

-- ---------------------------------------------------------------- Carta (público)
-- Guarda el carrito de la carta y devuelve un código corto que el cliente manda por WhatsApp.
create or replace function public.wa_cart_create(p_items jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare items jsonb; new_code text; alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; i int; tries int := 0;
begin
  -- Freno contra abusos: muchos carritos en un minuto desde cualquier lado.
  if (select count(*) from public.wa_carts where created_at > now() - interval '1 minute') >= 60 then
    raise exception 'Demasiados pedidos seguidos. Intenta en un minuto.';
  end if;
  items := public.wa_check_items(p_items);
  delete from public.wa_carts where expires_at < now() - interval '7 days';
  loop
    new_code := '';
    for i in 1..5 loop new_code := new_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from public.wa_carts c where c.code = new_code);
    tries := tries + 1;
    if tries > 10 then raise exception 'No se pudo crear el pedido, intenta de nuevo'; end if;
  end loop;
  insert into public.wa_carts (code, items, subtotal) values (new_code, items, public.wa_items_total(items));
  return jsonb_build_object('code', new_code, 'subtotal', public.wa_items_total(items));
end $$;

-- ---------------------------------------------------------------- Función «whatsapp» (service_role)
-- Guarda un mensaje entrante. Devuelve la conversación y si es repetido (Meta a veces reenvía).
create or replace function public.wa_ingest(p_phone text, p_name text, p_wa_id text, p_type text, p_body text,
  p_payload jsonb default null, p_referral jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ph text := public.wa_phone_norm(p_phone); cid bigint; is_new boolean := false; mid bigint; conv record;
begin
  if ph is null then raise exception 'Teléfono no válido'; end if;
  if p_wa_id is not null then
    select conversation_id into cid from public.wa_messages where wa_id = p_wa_id;
    if cid is not null then return jsonb_build_object('conversation_id', cid, 'duplicate', true); end if;
  end if;
  select id into cid from public.wa_conversations where phone = ph;
  if cid is null then
    insert into public.wa_conversations (phone, name, referral, customer_id)
    values (ph, left(coalesce(p_name, ''), 80), p_referral, (select id from public.customers where wa_phone = ph))
    on conflict (phone) do nothing returning id into cid;
    if cid is not null then
      is_new := true;
      perform public.wa_event(cid, 'conversacion', case when p_referral is null then '{}'::jsonb else jsonb_build_object('anuncio', p_referral) end);
    else
      select id into cid from public.wa_conversations where phone = ph;
    end if;
  end if;
  update public.wa_conversations set last_in_at = now(), last_msg_at = now(), unread = unread + 1,
    name = coalesce(nullif(left(coalesce(p_name, ''), 80), ''), name),
    referral = coalesce(referral, p_referral)
  where id = cid returning * into conv;
  insert into public.wa_messages (conversation_id, direction, wa_id, type, body, payload)
  values (cid, 'in', p_wa_id, coalesce(nullif(p_type, ''), 'text'), left(coalesce(p_body, ''), 4000), p_payload)
  on conflict (wa_id) do nothing
  returning id into mid;
  if mid is null then return jsonb_build_object('conversation_id', cid, 'duplicate', true); end if;
  return jsonb_build_object('conversation_id', cid, 'message_id', mid, 'duplicate', false, 'new', is_new,
    'bot_paused', conv.bot_paused, 'customer_id', conv.customer_id, 'name', conv.name);
end $$;

-- Registra un mensaje que la función ya envió (respuesta del bot o de la cola).
create or replace function public.wa_log_out(p_conv bigint, p_wa_id text, p_type text, p_body text, p_payload jsonb default null,
  p_sent_by text default 'bot', p_ok boolean default true, p_error text default '')
returns bigint language plpgsql security definer set search_path = public as $$
declare mid bigint;
begin
  insert into public.wa_messages (conversation_id, direction, wa_id, type, body, payload, status, error, sent_by)
  values (p_conv, 'out', nullif(p_wa_id, ''), coalesce(nullif(p_type, ''), 'text'), left(coalesce(p_body, ''), 4000), p_payload,
          case when p_ok then 'enviado' else 'error' end, left(coalesce(p_error, ''), 500), coalesce(p_sent_by, 'bot'))
  returning id into mid;
  update public.wa_conversations set last_msg_at = now() where id = p_conv;
  return mid;
end $$;

-- Estados que avisa Meta: enviado, entregado, leído o error. Nunca retrocede (leído no vuelve a entregado).
create or replace function public.wa_status(p_wa_id text, p_status text, p_error text default '') returns void
language sql security definer set search_path = public as $$
  update public.wa_messages m set
    status = n.st,
    error = case when n.st = 'error' then left(coalesce(p_error, ''), 500) else m.error end
  from (select case p_status when 'sent' then 'enviado' when 'delivered' then 'entregado' when 'read' then 'leido'
                             when 'failed' then 'error' end as st) n
  where m.wa_id = p_wa_id and m.direction = 'out' and n.st is not null
    and array_position(array['pendiente', 'enviado', 'entregado', 'leido'], n.st) >=
        coalesce(array_position(array['pendiente', 'enviado', 'entregado', 'leido'], m.status), 0)
$$;

-- Lo que necesita el bot para responder.
create or replace function public.wa_context() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('bot_active', s.bot_active, 'welcome', s.welcome, 'menu_url', s.menu_url, 'hours', s.hours,
    'address', s.address_text, 'maps_url', s.maps_url, 'lat', s.lat, 'lng', s.lng, 'payment_info', s.payment_info, 'delivery_min', s.delivery_min, 'allow_cash', s.allow_cash,
    'open_now', public.wa_is_open(), 'rate', public.pos_rate(),
    'zones', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'fee', z.fee) order by z.position, z.name)
                       from public.wa_zones z where z.active), '[]'::jsonb))
  from public.wa_settings s where s.id = 1
$$;

-- Busca la zona de delivery por lo que escribe el cliente («vivo en Valle de Oro», «guacara»…), sin importar
-- acentos ni mayúsculas. Hasta 10 coincidencias (lo que cabe en una lista de WhatsApp), las más exactas primero.
create or replace function public.wa_norm(t text) returns text
language sql immutable set search_path = public as $$
  select trim(regexp_replace(regexp_replace(translate(lower(coalesce(t, '')), 'áàäâéèëêíìïîóòöôúùüûñ', 'aaaaeeeeiiiioooouuuun'),
         '[^a-z0-9 ]', ' ', 'g'), '\s+', ' ', 'g'))
$$;

create or replace function public.wa_zone_search(p_text text) returns jsonb
language sql stable security definer set search_path = public as $$
  with q as (select ' ' || public.wa_norm(p_text) || ' ' as t),
  z as (
    select z.id, z.name, z.fee, ' ' || public.wa_norm(z.name) || ' ' as n from public.wa_zones z where z.active),
  scored as (
    select z.*, case
      when position(z.n in q.t) > 0 then 1                                    -- escribió el nombre completo
      when length(trim(q.t)) >= 4 and position(q.t in z.n) > 0 then 2         -- escribió parte del nombre
      when exists (select 1 from regexp_split_to_table(trim(q.t), ' ') w
                   where length(w) >= 5 and position(' ' || w || ' ' in z.n) > 0) then 3   -- coincide una palabra
    end as score
    from z, q)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'fee', fee) order by score, fee, name), '[]'::jsonb)
  from (select * from scored where score is not null order by score, fee, name limit 10) s
$$;

-- El cliente manda el código de la carta: se crea (o reemplaza) su pedido en borrador.
create or replace function public.wa_order_from_cart(p_conv bigint, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cart record; items jsonb; oid bigint;
begin
  select * into cart from public.wa_carts where code = upper(trim(coalesce(p_code, ''))) for update;
  if cart.code is null then raise exception 'No encontramos ese código de pedido'; end if;
  if cart.expires_at < now() then raise exception 'Ese pedido venció. Vuelve a armarlo en la carta, por favor'; end if;
  items := public.wa_check_items(cart.items);   -- precios y agotados al momento
  delete from public.wa_orders where conversation_id = p_conv and status = 'borrador';
  insert into public.wa_orders (conversation_id, cart_code, items, subtotal, customer_name)
  values (p_conv, cart.code, items, public.wa_items_total(items),
          coalesce((select cu.name from public.wa_conversations c join public.customers cu on cu.id = c.customer_id where c.id = p_conv), ''))
  returning id into oid;
  update public.wa_carts set used_at = coalesce(used_at, now()) where code = cart.code;
  perform public.wa_event(p_conv, 'carrito', jsonb_build_object('pedido', oid, 'subtotal', public.wa_items_total(items)));
  return public.wa_order_json(oid);
end $$;

-- Completa el pedido en borrador. p_fields: {kind, zone_id, address, location, customer_name, doc_id,
-- scheduled_for, payment_method, payment_ref, payment_media}. Solo cambia lo que viene.
create or replace function public.wa_order_set(p_conv bigint, p_fields jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o record; f jsonb := coalesce(p_fields, '{}'::jsonb); z record;
begin
  select * into o from public.wa_orders where conversation_id = p_conv and status = 'borrador' for update;
  if o.id is null then raise exception 'No hay un pedido en curso'; end if;
  if f ? 'kind' then
    if coalesce(f ->> 'kind', '') not in ('llevar', 'delivery') then raise exception 'Tipo de pedido no válido'; end if;
    update public.wa_orders set kind = f ->> 'kind' where id = o.id;
    if f ->> 'kind' = 'llevar' then update public.wa_orders set zone_id = null, delivery_fee = 0 where id = o.id; end if;
  end if;
  if f ? 'zone_id' then
    select * into z from public.wa_zones where id = (f ->> 'zone_id')::bigint and active;
    if z.id is null then raise exception 'Zona no válida'; end if;
    update public.wa_orders set zone_id = z.id, delivery_fee = z.fee where id = o.id;
  end if;
  if f ? 'address' then update public.wa_orders set address = left(trim(coalesce(f ->> 'address', '')), 200) where id = o.id; end if;
  if f ? 'location' then update public.wa_orders set location = f -> 'location' where id = o.id; end if;
  if f ? 'customer_name' then update public.wa_orders set customer_name = left(trim(coalesce(f ->> 'customer_name', '')), 80) where id = o.id; end if;
  if f ? 'doc_id' then update public.wa_orders set doc_id = coalesce(public.pos_doc(f ->> 'doc_id'), '') where id = o.id; end if;
  if f ? 'scheduled_for' then
    if nullif(f ->> 'scheduled_for', '') is not null and (f ->> 'scheduled_for')::timestamptz < now() then
      raise exception 'La hora del pedido ya pasó';
    end if;
    update public.wa_orders set scheduled_for = nullif(f ->> 'scheduled_for', '')::timestamptz where id = o.id;
  end if;
  if f ? 'payment_method' then
    if coalesce(f ->> 'payment_method', '') not in ('pago_movil', 'zelle', 'binance', 'paypal', 'efectivo') then
      raise exception 'Método de pago no válido';
    end if;
    if f ->> 'payment_method' = 'efectivo' and not (select allow_cash from public.wa_settings where id = 1) then
      raise exception 'Por ahora solo aceptamos pago antes de preparar el pedido';
    end if;
    update public.wa_orders set payment_method = f ->> 'payment_method' where id = o.id;
  end if;
  if f ? 'payment_ref' then update public.wa_orders set payment_ref = left(trim(coalesce(f ->> 'payment_ref', '')), 40) where id = o.id; end if;
  if f ? 'payment_media' then update public.wa_orders set payment_media = left(coalesce(f ->> 'payment_media', ''), 200) where id = o.id; end if;
  return public.wa_order_json(o.id);
end $$;

-- El cliente confirma: el pedido pasa a «por aceptar» y aparece en caja.
create or replace function public.wa_order_submit(p_conv bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o record; s record;
begin
  select * into o from public.wa_orders where conversation_id = p_conv and status = 'borrador' for update;
  if o.id is null then raise exception 'No hay un pedido en curso'; end if;
  select * into s from public.wa_settings where id = 1;
  if o.kind is null then raise exception 'Falta elegir si es para retirar o delivery'; end if;
  if length(o.customer_name) < 2 then raise exception 'Falta el nombre de quien recibe'; end if;
  if o.kind = 'delivery' then
    if o.zone_id is null then raise exception 'Falta elegir la zona del delivery'; end if;
    if length(o.address) < 5 and o.location is null then raise exception 'Falta la dirección del delivery'; end if;
    if o.subtotal < s.delivery_min then raise exception 'El pedido mínimo para delivery es Ref %', s.delivery_min; end if;
  end if;
  if o.payment_method = '' then raise exception 'Falta el método de pago'; end if;
  if o.payment_method <> 'efectivo' and o.payment_ref = '' and o.payment_media = '' then
    raise exception 'Falta la referencia o la captura del pago';
  end if;
  update public.wa_orders set status = 'por_aceptar', submitted_at = now() where id = o.id;
  perform public.wa_event(p_conv, 'pedido_enviado', jsonb_build_object('pedido', o.id, 'total', o.subtotal + o.delivery_fee));
  return public.wa_order_json(o.id);
end $$;

-- El cliente pide una reserva (queda pendiente hasta que caja la confirme).
create or replace function public.wa_reservation_create(p_conv bigint, p_name text, p_people int, p_when timestamptz,
  p_area text default '', p_notes text default '')
returns bigint language plpgsql security definer set search_path = public as $$
declare rid bigint;
begin
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Falta el nombre de la reserva'; end if;
  if p_people is null or p_people < 1 or p_people > 40 then raise exception 'Número de personas no válido'; end if;
  if p_when is null or p_when < now() then raise exception 'La fecha de la reserva ya pasó'; end if;
  if p_when > now() + interval '60 days' then raise exception 'Solo tomamos reservas hasta 60 días antes'; end if;
  if not public.wa_is_open(p_when) then raise exception 'A esa hora el local está cerrado'; end if;
  insert into public.wa_reservations (conversation_id, name, people, reserved_for, area, notes)
  values (p_conv, left(trim(p_name), 80), p_people, p_when, left(coalesce(p_area, ''), 20), left(coalesce(p_notes, ''), 200))
  returning id into rid;
  perform public.wa_event(p_conv, 'reserva', jsonb_build_object('reserva', rid, 'personas', p_people));
  return rid;
end $$;

-- Cola de salida: la función toma lo pendiente, lo envía y avisa cómo le fue.
create or replace function public.wa_outbox_next(p_limit int default 20) returns jsonb
language sql security definer set search_path = public as $$
  with picked as (
    update public.wa_outbox o set attempts = attempts + 1
    where o.id in (select id from public.wa_outbox where status = 'pendiente' and attempts < 5 order by id
                   limit greatest(1, least(coalesce(p_limit, 20), 50)) for update skip locked)
    returning o.*)
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'conversation_id', p.conversation_id, 'phone', c.phone, 'kind', p.kind,
    'body', p.body, 'template', p.template, 'params', p.params, 'sent_by', p.sent_by,
    'in_window', coalesce(c.last_in_at > now() - interval '24 hours', false)) order by p.id), '[]'::jsonb)
  from picked p join public.wa_conversations c on c.id = p.conversation_id
$$;

create or replace function public.wa_outbox_done(p_id bigint, p_ok boolean, p_wa_id text default '', p_error text default '')
returns void language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select * into o from public.wa_outbox where id = p_id for update;
  if o.id is null or o.status <> 'pendiente' then return; end if;
  update public.wa_outbox set status = case when p_ok then 'enviado' when o.attempts >= 5 then 'error' else 'pendiente' end,
    sent_at = case when p_ok then now() end, error = left(coalesce(p_error, ''), 500)
  where id = p_id;
  if p_ok then
    perform public.wa_log_out(o.conversation_id, p_wa_id, case when o.kind = 'plantilla' then 'template' else 'text' end,
      coalesce(nullif(o.body, ''), o.template), case when o.kind = 'plantilla' then jsonb_build_object('params', o.params) end, o.sent_by);
  end if;
end $$;

-- Paso de la conversación: qué le preguntó el bot por última vez (dirección, nombre, referencia…) y datos sueltos
-- de una reserva en curso. Así un texto libre del cliente se entiende según la pregunta.
alter table public.wa_conversations add column if not exists step text not null default '';
alter table public.wa_conversations add column if not exists step_data jsonb not null default '{}'::jsonb;

create or replace function public.wa_set_step(p_conv bigint, p_step text, p_data jsonb default null) returns void
language sql security definer set search_path = public as $$
  update public.wa_conversations set step = coalesce(p_step, ''),
    step_data = case when p_data is null then step_data else p_data end
  where id = p_conv
$$;

-- Estado de la conversación para el bot: paso, datos y pedido en borrador (si hay).
create or replace function public.wa_state(p_conv bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('step', c.step, 'step_data', c.step_data, 'bot_paused', c.bot_paused, 'name', c.name,
    'customer_name', (select cu.name from public.customers cu where cu.id = c.customer_id),
    'draft', (select public.wa_order_json(o.id) from public.wa_orders o where o.conversation_id = c.id and o.status = 'borrador'))
  from public.wa_conversations c where c.id = p_conv
$$;

-- El cliente pide hablar con una persona: el bot se calla en esa conversación hasta que caja lo reactive.
create or replace function public.wa_handoff(p_conv bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.wa_conversations set bot_paused = true, step = '' where id = p_conv;
  perform public.wa_event(p_conv, 'humano');
end $$;

create or replace function public.wa_order_cancel(p_conv bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.wa_orders set status = 'cancelado', handled_at = now() where conversation_id = p_conv and status = 'borrador';
  update public.wa_conversations set step = '' where id = p_conv;
  perform public.wa_event(p_conv, 'cancelado');
end $$;

-- ---------------------------------------------------------------- Caja (tablet o laptop, con PIN)
-- Pedidos por aceptar, reservas pendientes y conversaciones sin leer.
create or replace function public.wa_pending(p_emp bigint, p_pin text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.pos_auth(p_emp, p_pin);
  return jsonb_build_object(
    'orders', coalesce((select jsonb_agg(public.wa_order_json(id) order by coalesce(scheduled_for, submitted_at))
                        from public.wa_orders where status = 'por_aceptar'), '[]'::jsonb),
    'reservations', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'people', r.people,
                        'reserved_for', r.reserved_for, 'area', r.area, 'notes', r.notes, 'phone', c.phone) order by r.reserved_for)
                        from public.wa_reservations r join public.wa_conversations c on c.id = r.conversation_id
                        where r.status = 'pendiente' and r.reserved_for > now() - interval '2 hours'), '[]'::jsonb),
    'active', coalesce((select jsonb_agg(public.wa_order_json(w.id) || jsonb_build_object('label', public.pos_order_label(w.pos_order_id))
                        order by w.handled_at)
                        from public.wa_orders w join public.pos_orders p on p.id = w.pos_order_id
                        where w.status = 'aceptado' and w.ready_at is null and p.status <> 'anulada'
                          and w.handled_at > now() - interval '12 hours'), '[]'::jsonb),
    'unread', (select coalesce(sum(unread), 0) from public.wa_conversations));
end $$;

-- Acepta: abre el pedido en caja (Delivery o Para llevar), carga los platos y los envía a cocina.
-- Usa las mismas funciones que la caja (pos_open_delivery, pos_open, pos_add, pos_send): mismo camino ya probado.
create or replace function public.wa_accept(p_emp bigint, p_pin text, p_order bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare o record; conv record; pid bigint; items jsonb; cust bigint;
begin
  perform public.pos_auth(p_emp, p_pin);
  select * into o from public.wa_orders where id = p_order for update;
  if o.id is null or o.status <> 'por_aceptar' then raise exception 'Este pedido ya fue atendido'; end if;
  select * into conv from public.wa_conversations where id = o.conversation_id;
  -- Revalida al aceptar: si algo se agotó mientras tanto, caja lo ve y lo resuelve con el cliente.
  items := public.wa_check_items(o.items);
  if o.kind = 'delivery' then
    pid := public.pos_open_delivery(p_emp, p_pin, coalesce(nullif(o.customer_name, ''), nullif(conv.name, ''), 'WhatsApp'), conv.phone,
             trim(o.address || case when o.location is not null then ' (ubicación en WhatsApp)' else '' end), o.delivery_fee, 'propio');
  else
    pid := public.pos_open(p_emp, p_pin, null, 'WA ' || coalesce(nullif(o.customer_name, ''), nullif(conv.name, ''), conv.phone));
    update public.pos_orders set phone = left(conv.phone, 30) where id = pid;
  end if;
  update public.pos_orders set origin = 'whatsapp' where id = pid;
  perform public.pos_add(p_emp, p_pin, pid, items);
  perform public.pos_send(p_emp, p_pin, pid);
  if o.doc_id <> '' then
    perform public.pos_set_customer(p_emp, p_pin, pid, o.doc_id, coalesce(nullif(o.customer_name, ''), conv.name), conv.phone, '', false);
    select customer_id into cust from public.pos_orders where id = pid;
    update public.customers set wa_phone = conv.phone
    where id = cust and wa_phone is null and not exists (select 1 from public.customers x where x.wa_phone = conv.phone);
    update public.wa_conversations set customer_id = cust where id = conv.id;
  end if;
  update public.wa_orders set status = 'aceptado', pos_order_id = pid, handled_by = p_emp, handled_at = now() where id = o.id;
  perform public.wa_queue(conv.id, '✅ ¡Pedido confirmado! Ya lo estamos preparando 🍜' ||
    case when o.kind = 'delivery' then E'\nTe avisamos cuando salga el delivery.' else E'\nTe avisamos cuando esté listo para retirar.' end);
  perform public.wa_event(conv.id, 'aceptado', jsonb_build_object('pedido', o.id, 'pos_order', pid, 'total', o.subtotal + o.delivery_fee));
  insert into public.pos_log (employee_id, action, order_id, detail) values (p_emp, 'whatsapp_aceptar', pid, jsonb_build_object('wa_order', o.id));
  return pid;
end $$;

create or replace function public.wa_reject(p_emp bigint, p_pin text, p_order bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare o record;
begin
  perform public.pos_auth(p_emp, p_pin);
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Escribe el motivo (se le envía al cliente)'; end if;
  select * into o from public.wa_orders where id = p_order for update;
  if o.id is null or o.status <> 'por_aceptar' then raise exception 'Este pedido ya fue atendido'; end if;
  update public.wa_orders set status = 'rechazado', reject_reason = trim(p_reason), handled_by = p_emp, handled_at = now() where id = o.id;
  perform public.wa_queue(o.conversation_id, 'Lo sentimos, no pudimos tomar tu pedido: ' || trim(p_reason) ||
    E'\nSi ya pagaste, te devolvemos el dinero. Escríbenos si necesitas ayuda 🙏');
  perform public.wa_event(o.conversation_id, 'rechazado', jsonb_build_object('pedido', o.id, 'motivo', trim(p_reason)));
  insert into public.pos_log (employee_id, action, detail) values (p_emp, 'whatsapp_rechazar', jsonb_build_object('wa_order', o.id, 'motivo', trim(p_reason)));
end $$;

-- Avisa al cliente que su pedido salió (delivery) o está listo para retirar.
create or replace function public.wa_notify_ready(p_emp bigint, p_pin text, p_pos_order bigint) returns void
language plpgsql security definer set search_path = public as $$
declare o record;
begin
  perform public.pos_auth(p_emp, p_pin);
  select w.id, w.conversation_id, p.kind as pos_kind into o
  from public.wa_orders w join public.pos_orders p on p.id = w.pos_order_id where w.pos_order_id = p_pos_order;
  if o.id is null then raise exception 'Este pedido no vino por WhatsApp'; end if;
  update public.wa_orders set ready_at = now() where id = o.id;
  perform public.wa_queue(o.conversation_id, case when o.pos_kind = 'delivery' then '🛵 ¡Tu pedido va en camino!'
                                                  else '🍜 ¡Tu pedido está listo para retirar! Te esperamos.' end);
  perform public.wa_event(o.conversation_id, case when o.pos_kind = 'delivery' then 'en_camino' else 'listo' end, jsonb_build_object('pedido', o.id));
end $$;

create or replace function public.wa_reservation_set(p_emp bigint, p_pin text, p_id bigint, p_status text, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform public.pos_auth(p_emp, p_pin);
  if p_status not in ('confirmada', 'rechazada', 'cancelada') then raise exception 'Estado no válido'; end if;
  update public.wa_reservations set status = p_status, handled_by = p_emp where id = p_id and status = 'pendiente' returning * into r;
  if r.id is null then raise exception 'Esta reserva ya fue atendida'; end if;
  perform public.wa_queue(r.conversation_id, case p_status
    when 'confirmada' then '✅ Reserva confirmada: ' || r.people || ' persona(s), ' ||
                           to_char(r.reserved_for at time zone 'America/Caracas', 'DD/MM "a las" HH24:MI') || '. ¡Te esperamos!'
    else 'Lo sentimos, no podemos confirmar tu reserva' || case when trim(coalesce(p_note, '')) <> '' then ': ' || trim(p_note) else '.' end ||
         ' Escríbenos para buscar otra hora 🙏' end);
  perform public.wa_event(r.conversation_id, 'reserva_' || p_status, jsonb_build_object('reserva', r.id));
end $$;

-- ---------------------------------------------------------------- Bandeja (caja, con PIN)
create or replace function public.wa_inbox(p_emp bigint, p_pin text, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.pos_auth(p_emp, p_pin);
  return coalesce((select jsonb_agg(x order by (x ->> 'last_msg_at')::timestamptz desc) from (
    select jsonb_build_object('id', c.id, 'phone', c.phone, 'name', c.name, 'unread', c.unread, 'bot_paused', c.bot_paused,
      'last_msg_at', c.last_msg_at, 'in_window', coalesce(c.last_in_at > now() - interval '24 hours', false),
      'last', (select left(m.body, 80) from public.wa_messages m where m.conversation_id = c.id order by m.id desc limit 1)) x
    from public.wa_conversations c order by c.last_msg_at desc limit greatest(1, least(coalesce(p_limit, 50), 200))) t), '[]'::jsonb);
end $$;

create or replace function public.wa_thread(p_emp bigint, p_pin text, p_conv bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.pos_auth(p_emp, p_pin);
  update public.wa_conversations set unread = 0 where id = p_conv;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'direction', direction, 'type', type, 'body', body,
    'status', status, 'sent_by', sent_by, 'created_at', created_at) order by id)
    from (select * from public.wa_messages where conversation_id = p_conv order by id desc limit 100) m), '[]'::jsonb);
end $$;

-- Respuesta a mano: pausa el bot en esa conversación para que no se cruce con la persona.
create or replace function public.wa_reply(p_emp bigint, p_pin text, p_conv bigint, p_text text) returns bigint
language plpgsql security definer set search_path = public as $$
declare oid bigint;
begin
  perform public.pos_auth(p_emp, p_pin);
  if length(trim(coalesce(p_text, ''))) = 0 then raise exception 'Escribe el mensaje'; end if;
  if not exists (select 1 from public.wa_conversations where id = p_conv and last_in_at > now() - interval '24 hours') then
    raise exception 'Pasaron más de 24 horas desde el último mensaje del cliente: WhatsApp solo permite plantillas aprobadas';
  end if;
  oid := public.wa_queue(p_conv, left(trim(p_text), 4000), coalesce(public.pos_emp_name(p_emp), 'caja'));
  update public.wa_conversations set bot_paused = true, unread = 0 where id = p_conv;
  return oid;
end $$;

create or replace function public.wa_set_paused(p_emp bigint, p_pin text, p_conv bigint, p_paused boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.pos_auth(p_emp, p_pin);
  update public.wa_conversations set bot_paused = coalesce(p_paused, false), step = case when coalesce(p_paused, false) then step else '' end where id = p_conv;
end $$;

-- ---------------------------------------------------------------- Gestión (dueño/admin con 2FA)
-- Embudo de WhatsApp de los últimos días y de qué anuncio vino cada venta (Gestión → WhatsApp).
create or replace function public.wa_stats(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 366)));
begin
  if not public.can_manage() then raise exception 'Solo el dueño o un administrador con verificación en dos pasos'; end if;
  return jsonb_build_object(
    'days', greatest(1, least(coalesce(p_days, 30), 366)),
    'funnel', (select jsonb_build_object(
        'conversaciones', count(*) filter (where event = 'conversacion'),
        'carritos', count(*) filter (where event = 'carrito'),
        'pedidos', count(*) filter (where event = 'pedido_enviado'),
        'aceptados', count(*) filter (where event = 'aceptado'),
        'rechazados', count(*) filter (where event = 'rechazado'),
        'reservas', count(*) filter (where event = 'reserva'),
        'humano', count(*) filter (where event = 'humano'))
      from public.wa_events where created_at >= since),
    'ventas', (select coalesce(sum(subtotal + delivery_fee), 0) from public.wa_orders where status = 'aceptado' and handled_at >= since),
    'ticket', (select coalesce(round(avg(subtotal + delivery_fee), 2), 0) from public.wa_orders where status = 'aceptado' and handled_at >= since),
    'anuncios', coalesce((select jsonb_agg(x order by (x ->> 'ventas')::numeric desc, (x ->> 'conversaciones')::int desc) from (
        select jsonb_build_object(
          'anuncio', coalesce(nullif(c.referral ->> 'headline', ''), 'Anuncio ' || coalesce(c.referral ->> 'source_id', '?')),
          'source_id', c.referral ->> 'source_id',
          'conversaciones', count(distinct c.id),
          'pedidos', count(o.id) filter (where o.status = 'aceptado'),
          'ventas', coalesce(sum(o.subtotal + o.delivery_fee) filter (where o.status = 'aceptado'), 0)) x
        from public.wa_conversations c
        left join public.wa_orders o on o.conversation_id = c.id and o.handled_at >= since
        where c.referral is not null and c.created_at >= since
        group by c.referral ->> 'source_id', coalesce(nullif(c.referral ->> 'headline', ''), 'Anuncio ' || coalesce(c.referral ->> 'source_id', '?'))) t), '[]'::jsonb),
    'sin_anuncio', (select count(*) from public.wa_conversations where referral is null and created_at >= since));
end $$;

-- ---------------------------------------------------------------- Permisos de las funciones
do $$
declare f text;
begin
  -- Ayudantes internos: nadie los llama directo.
  foreach f in array array['wa_check_items(jsonb)', 'wa_items_total(jsonb)', 'wa_event(bigint, text, jsonb)', 'wa_queue(bigint, text, text)',
                           'wa_is_open(timestamptz)', 'wa_order_json(bigint)', 'wa_phone_norm(text)', 'wa_norm(text)'] loop
    execute format('revoke execute on function public.%s from anon, public, authenticated', f);
  end loop;
  -- Solo la función «whatsapp» (service_role).
  foreach f in array array['wa_ingest(text, text, text, text, text, jsonb, jsonb)', 'wa_log_out(bigint, text, text, text, jsonb, text, boolean, text)',
                           'wa_status(text, text, text)', 'wa_context()', 'wa_order_from_cart(bigint, text)', 'wa_order_set(bigint, jsonb)',
                           'wa_order_submit(bigint)', 'wa_reservation_create(bigint, text, integer, timestamptz, text, text)',
                           'wa_outbox_next(integer)', 'wa_outbox_done(bigint, boolean, text, text)',
                           'wa_set_step(bigint, text, jsonb)', 'wa_state(bigint)', 'wa_handoff(bigint)', 'wa_order_cancel(bigint)',
                           'wa_zone_search(text)'] loop
    execute format('revoke execute on function public.%s from anon, public, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- Caja: con sesión de dispositivo y PIN (lo comprueba cada función).
  foreach f in array array['wa_pending(bigint, text)', 'wa_accept(bigint, text, bigint)', 'wa_reject(bigint, text, bigint, text)',
                           'wa_notify_ready(bigint, text, bigint)', 'wa_reservation_set(bigint, text, bigint, text, text)',
                           'wa_inbox(bigint, text, integer)', 'wa_thread(bigint, text, bigint)', 'wa_reply(bigint, text, bigint, text)',
                           'wa_set_paused(bigint, text, bigint, boolean)'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  revoke execute on function public.wa_stats(integer) from anon, public;
  grant execute on function public.wa_stats(integer) to authenticated;
  -- La carta (sin sesión) solo puede crear carritos.
  revoke execute on function public.wa_cart_create(jsonb) from public;
  grant execute on function public.wa_cart_create(jsonb) to anon, authenticated;
end $$;
