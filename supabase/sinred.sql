-- ============================================================================
-- Modo sin internet, parte 1: pedidos y comandas por la laptop de caja (Ichiraku)
--  · Si se cae el internet, las tablets mandan los pedidos al puente de la laptop por el
--    wifi del local; el puente imprime la comanda y los guarda.
--  · Cuando vuelve el internet, el puente sube cada pedido con pos_offline_sync.
--  · pos_lan_token: llave que comparten tablets y puente para que nadie más en el wifi
--    pueda mandar pedidos a la laptop.
-- Se ejecuta después de pos.sql. Se puede volver a ejecutar.
-- ============================================================================

create table if not exists public.pos_offline_entries (
  uuid       text primary key check (uuid ~ '^[A-Za-z0-9_-]{8,64}$'),
  tmp_ref    text not null default '',       -- pedido creado sin internet («sr-…»), para unir sus envíos
  order_id   bigint references public.pos_orders(id) on delete set null,
  employee_id bigint references public.employees(id) on delete set null,
  device     text not null default '',
  sent_at    timestamptz not null,           -- cuándo se mandó a cocina (hora de la tablet)
  payload    jsonb not null,
  note       text not null default '',
  synced_at  timestamptz not null default now()
);
create index if not exists pos_offline_entries_tmp on public.pos_offline_entries (tmp_ref) where tmp_ref <> '';
alter table public.pos_offline_entries enable row level security;
revoke all on public.pos_offline_entries from anon, authenticated;

-- Llave de la red local (se crea una sola vez)
create or replace function public.pos_lan_token() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare t text;
begin
  if not (public.pos_is_device() or coalesce(public.staff_role(), '') = 'impresora') then raise exception 'Sin permiso'; end if;
  select value ->> 'token' into t from public.pos_kv where key = 'lan_token';
  if t is null then
    t := encode(extensions.gen_random_bytes(18), 'hex');
    insert into public.pos_kv (key, value) values ('lan_token', jsonb_build_object('token', t)) on conflict (key) do nothing;
    select value ->> 'token' into t from public.pos_kv where key = 'lan_token';
  end if;
  -- También la dirección de la laptop en el wifi (la informa el puente), para ofrecer el enlace local
  return jsonb_build_object('token', t,
    'ips', (select value -> 'ips' from public.pos_kv where key = 'bridge_status'),
    'port', (select value -> 'app' -> 'port' from public.pos_kv where key = 'bridge_status'));
end $$;

-- Sube un envío a cocina hecho sin internet. Idempotente: el mismo uuid no se carga dos veces.
-- p_entry: {uuid, at, device, emp, pin, order: {id | tmp, kind, table_id, label, phone, address}, items: [{dish_id, variant, option, notes, qty}]}
create or replace function public.pos_offline_sync(p_entry jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare e jsonb := p_entry; o jsonb := p_entry -> 'order'; uid text := p_entry ->> 'uuid'; tmp text := coalesce(p_entry -> 'order' ->> 'tmp', '');
  oid bigint; iid bigint; emp bigint; pin_ok boolean; at timestamptz; it record; d record; price numeric; n int := 0; svc numeric; note text := ''; done record;
begin
  if coalesce(public.staff_role(), '') not in ('impresora', 'dueño', 'admin') then raise exception 'Sin permiso'; end if;
  select * into done from public.pos_offline_entries where uuid = uid;
  if done.uuid is not null then return jsonb_build_object('order_id', done.order_id, 'repetido', true); end if;
  emp := nullif(e ->> 'emp', '')::bigint;
  at := least(coalesce(nullif(e ->> 'at', '')::timestamptz, now()), now());
  select exists (select 1 from public.employees x where x.id = emp and x.pos_pin_hash is not null
                 and x.pos_pin_hash = extensions.crypt(coalesce(e ->> 'pin', ''), x.pos_pin_hash)) into pin_ok;
  if not pin_ok then note := 'PIN no verificado'; end if;
  if not exists (select 1 from public.employees where id = emp) then emp := null; end if;

  -- 1) ¿A qué pedido va? Uno que ya existía, uno creado antes sin internet, o uno nuevo.
  if nullif(o ->> 'id', '') is not null then
    select id into oid from public.pos_orders where id = (o ->> 'id')::bigint and status = 'abierta';
    if oid is null then note := trim(note || ' · el pedido original ya estaba cerrado'); end if;
  end if;
  if oid is null and tmp <> '' then
    select x.order_id into oid from public.pos_offline_entries x join public.pos_orders p on p.id = x.order_id
    where x.tmp_ref = tmp and p.status = 'abierta' order by x.synced_at limit 1;
  end if;
  if oid is null and o ->> 'kind' = 'mesa' and nullif(o ->> 'table_id', '') is not null then
    select id into oid from public.pos_orders where table_id = (o ->> 'table_id')::bigint and status = 'abierta';
    if oid is null and exists (select 1 from public.pos_tables where id = (o ->> 'table_id')::bigint) then
      select coalesce(service_pct, 10) into svc from public.gestion_settings limit 1;
      insert into public.pos_orders (kind, table_id, service_pct, opened_by, opened_at, day_number)
      values ('mesa', (o ->> 'table_id')::bigint, coalesce(svc, 10), emp, at, public.pos_next_number()) returning id into oid;
    end if;
  end if;
  if oid is null then
    insert into public.pos_orders (kind, label, phone, address, service_pct, opened_by, opened_at, day_number)
    values (case when o ->> 'kind' = 'delivery' then 'delivery' else 'llevar' end,
            left(coalesce(nullif(trim(o ->> 'label'), ''), 'Sin internet'), 40), left(coalesce(o ->> 'phone', ''), 30), left(coalesce(o ->> 'address', ''), 200),
            0, emp, at, public.pos_next_number()) returning id into oid;
  end if;

  -- 2) Los platos ya salieron en cocina: entran como enviados, con el precio de la carta
  for it in select * from jsonb_to_recordset(coalesce(e -> 'items', '[]'::jsonb)) as x(dish_id bigint, variant text, option text, notes text, qty numeric) loop
    select * into d from public.dishes where id = it.dish_id;
    if d.id is null or coalesce(it.qty, 0) <= 0 or it.qty > 99 then continue; end if;
    price := d.price;
    if jsonb_typeof(d.variants) = 'array' and jsonb_array_length(d.variants) > 0 then
      select (v ->> 'price')::numeric into price from jsonb_array_elements(d.variants) v where v ->> 'label' = coalesce(it.variant, '');
      price := coalesce(price, d.price);
    end if;
    insert into public.pos_items (order_id, dish_id, name, variant, option, notes, qty, unit_price, created_by, created_at, status, sent_at)
    values (oid, d.id, d.name, coalesce(it.variant, ''), left(coalesce(it.option, ''), 40), left(coalesce(trim(it.notes), ''), 120), it.qty, price, emp, at, 'enviado', at)
    returning id into iid;
    perform public.inv_consume_item(iid, -1);
    n := n + 1;
  end loop;

  insert into public.pos_offline_entries (uuid, tmp_ref, order_id, employee_id, device, sent_at, payload, note)
  values (uid, tmp, oid, emp, left(coalesce(e ->> 'device', ''), 30), at, e - 'pin', note);
  insert into public.pos_log (employee_id, action, order_id, detail)
  values (emp, 'enviar_sin_internet', oid, jsonb_build_object('platos', n, 'nota', note, 'equipo', e ->> 'device'));
  return jsonb_build_object('order_id', oid, 'platos', n, 'nota', note);
end $$;

do $$
begin
  revoke execute on function public.pos_lan_token() from anon, public;
  grant execute on function public.pos_lan_token() to authenticated;
  revoke execute on function public.pos_offline_sync(jsonb) from anon, public;
  grant execute on function public.pos_offline_sync(jsonb) to authenticated;
end $$;
