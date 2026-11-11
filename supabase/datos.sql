-- ============================================================================
-- Carga de datos, ventas por plato y ficha de cliente (Ichiraku)
--  · import_data: carga insumos, proveedores, recetas y clientes desde una planilla.
--    Con p_dry = true solo revisa y dice qué haría (no guarda nada).
--  · menu_sales: unidades vendidas por plato en un período (para costo y margen).
--  · Clientes de delivery: se reconocen por el teléfono y se ve su historial en la caja.
-- Se ejecuta después de gestion.sql y pos.sql. Se puede volver a ejecutar.
-- ============================================================================

alter table public.customers add column if not exists address text not null default '';

-- Texto comparable: minúsculas, sin acentos y sin espacios repetidos
create or replace function public.imp_norm(p text) returns text
language sql immutable set search_path = public as $$
  select regexp_replace(trim(translate(lower(coalesce(p, '')), 'áéíóúüàèìòùñ', 'aeiouuaeioun')), '\s+', ' ', 'g')
$$;

-- Teléfono comparable: los últimos 10 dígitos (0414-123.45.67, +58 414 1234567 y 4141234567 son el mismo)
create or replace function public.phone_key(p text) returns text
language sql immutable set search_path = public as $$
  select case when length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) >= 10 then right(regexp_replace(p, '\D', '', 'g'), 10) end
$$;
create index if not exists customers_phone_key on public.customers (public.phone_key(phone));
create index if not exists pos_orders_customer on public.pos_orders (customer_id) where customer_id is not null;

create or replace function public.imp_unit(p text) returns text
language sql immutable set search_path = public as $$
  select case public.imp_norm(p)
    when 'kg' then 'kg' when 'kilo' then 'kg' when 'kilos' then 'kg' when 'kilogramo' then 'kg' when 'kilogramos' then 'kg'
    when 'g' then 'g' when 'gr' then 'g' when 'grs' then 'g' when 'gramo' then 'g' when 'gramos' then 'g'
    when 'l' then 'l' when 'lt' then 'l' when 'lts' then 'l' when 'litro' then 'l' when 'litros' then 'l'
    when 'ml' then 'ml' when 'mililitro' then 'ml' when 'mililitros' then 'ml' when 'cc' then 'ml'
    when 'unidad' then 'unidad' when 'unidades' then 'unidad' when 'und' then 'unidad' when 'u' then 'unidad' when 'un' then 'unidad' when 'pza' then 'unidad'
  end
$$;
create or replace function public.imp_family(u text) returns text
language sql immutable as $$ select case when u in ('kg', 'g') then 'peso' when u in ('l', 'ml') then 'volumen' when u = 'unidad' then 'unidad' end $$;
-- Números escritos «12,50», «1.234,5» o «1,234.5»
create or replace function public.imp_num(p text) returns numeric
language plpgsql immutable set search_path = public as $$
declare s text := regexp_replace(coalesce(p, ''), '[^0-9,.\-]', '', 'g');
begin
  if s = '' then return null; end if;
  if s ~ ',' and s ~ '\.' then
    if position(',' in reverse(s)) < position('.' in reverse(s)) then s := replace(replace(s, '.', ''), ',', '.'); else s := replace(s, ',', ''); end if;
  else s := replace(s, ',', '.'); end if;
  return s::numeric;
exception when others then return null;
end $$;

-- Aplica una fila por vez y devuelve qué pasó con cada una
create or replace function public.imp_apply(p_kind text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; i int := 0; res jsonb := '[]'::jsonb; st text; msg text; id_ bigint; u text; q numeric; pr numeric; sid bigint;
  grp record; dish record; ing record; vlabel text; bad text; key text; ph text; doc text;
begin
  if p_kind = 'proveedores' then
    for r in select * from jsonb_array_elements(p_rows) loop
      i := i + 1;
      if length(trim(coalesce(r ->> 'nombre', ''))) < 2 then res := res || jsonb_build_object('n', i, 'st', 'error', 'msg', 'Falta el nombre'); continue; end if;
      select id into id_ from public.suppliers where public.imp_norm(name) = public.imp_norm(r ->> 'nombre');
      if id_ is null then
        insert into public.suppliers (name, whatsapp, notes) values (left(trim(r ->> 'nombre'), 80), left(trim(coalesce(r ->> 'whatsapp', '')), 30), left(coalesce(r ->> 'notas', ''), 300));
        st := 'nuevo';
      else
        update public.suppliers set whatsapp = coalesce(nullif(left(trim(coalesce(r ->> 'whatsapp', '')), 30), ''), whatsapp),
          notes = coalesce(nullif(left(coalesce(r ->> 'notas', ''), 300), ''), notes) where id = id_;
        st := 'actualiza';
      end if;
      res := res || jsonb_build_object('n', i, 'st', st, 'msg', trim(r ->> 'nombre'));
    end loop;

  elsif p_kind = 'insumos' then
    for r in select * from jsonb_array_elements(p_rows) loop
      i := i + 1; msg := null;
      u := public.imp_unit(r ->> 'unidad'); q := coalesce(public.imp_num(r ->> 'cantidad_compra'), 1); pr := public.imp_num(r ->> 'precio');
      if length(trim(coalesce(r ->> 'nombre', ''))) < 2 then msg := 'Falta el nombre';
      elsif u is null then msg := 'Unidad no reconocida: «' || coalesce(r ->> 'unidad', '') || '» (usa kg, g, l, ml o unidad)';
      elsif q <= 0 then msg := 'La cantidad de compra debe ser mayor que 0';
      elsif pr is null or pr < 0 then msg := 'Falta el precio (en Ref)';
      elsif coalesce(public.imp_num(r ->> 'merma'), 0) not between 0 and 89 then msg := 'La merma va de 0 a 89 %';
      end if;
      if msg is not null then res := res || jsonb_build_object('n', i, 'st', 'error', 'msg', msg); continue; end if;
      sid := null;
      if length(trim(coalesce(r ->> 'proveedor', ''))) >= 2 then
        select id into sid from public.suppliers where public.imp_norm(name) = public.imp_norm(r ->> 'proveedor');
        if sid is null then insert into public.suppliers (name) values (left(trim(r ->> 'proveedor'), 80)) returning id into sid; end if;
      end if;
      select id, buy_unit into ing from public.ingredients where public.imp_norm(name) = public.imp_norm(r ->> 'nombre');
      if ing.id is null then
        insert into public.ingredients (name, buy_unit, buy_qty, buy_price, waste_pct, supplier, supplier_id, min_qty, zone)
        values (left(trim(r ->> 'nombre'), 80), u, q, pr, coalesce(public.imp_num(r ->> 'merma'), 0), coalesce(left(trim(r ->> 'proveedor'), 80), ''), sid,
                greatest(coalesce(public.imp_num(r ->> 'minimo'), 0), 0), case when public.imp_norm(r ->> 'zona') = 'afuera' then 'afuera' else 'cocina' end);
        st := 'nuevo';
      else
        if public.imp_family(ing.buy_unit) <> public.imp_family(u) and exists (select 1 from public.recipe_items where ingredient_id = ing.id) then
          res := res || jsonb_build_object('n', i, 'st', 'error', 'msg', 'Ya está en recetas en ' || ing.buy_unit || '; no se puede cambiar a ' || u); continue;
        end if;
        update public.ingredients set buy_unit = u, buy_qty = q, buy_price = pr,
          waste_pct = coalesce(public.imp_num(r ->> 'merma'), waste_pct),
          supplier = coalesce(nullif(left(trim(coalesce(r ->> 'proveedor', '')), 80), ''), supplier), supplier_id = coalesce(sid, supplier_id),
          min_qty = coalesce(greatest(public.imp_num(r ->> 'minimo'), 0), min_qty),
          zone = case public.imp_norm(r ->> 'zona') when 'afuera' then 'afuera' when 'cocina' then 'cocina' else zone end
        where id = ing.id;
        st := 'actualiza';
      end if;
      res := res || jsonb_build_object('n', i, 'st', st, 'msg', trim(r ->> 'nombre') || ' · ' || q || ' ' || u || ' a Ref ' || pr);
    end loop;

  elsif p_kind = 'recetas' then
    -- Cada plato (y variante) se reemplaza completo; si una línea falla, ese plato no se toca
    for grp in
      select public.imp_norm(x ->> 'plato') as pk, public.imp_norm(coalesce(x ->> 'variante', '')) as vk,
             jsonb_agg(x || jsonb_build_object('_n', n) order by n) as lines
      from jsonb_array_elements(p_rows) with ordinality as t(x, n) group by 1, 2 order by min(n)
    loop
      bad := null; dish := null; vlabel := '';
      select d.id, d.name, d.variants into dish from public.dishes d where public.imp_norm(d.name) = grp.pk limit 1;
      if grp.pk = '' then bad := 'Falta el plato';
      elsif dish.id is null then bad := 'No está en la carta: «' || (grp.lines -> 0 ->> 'plato') || '»';
      elsif jsonb_typeof(dish.variants) = 'array' and jsonb_array_length(dish.variants) > 0 then
        select v ->> 'label' into vlabel from jsonb_array_elements(dish.variants) v where public.imp_norm(v ->> 'label') = grp.vk;
        if vlabel is null then
          bad := case when grp.vk = '' then 'Este plato tiene variantes: escribe cuál (' else 'Variante no encontrada (' end ||
                 (select string_agg(v ->> 'label', ', ') from jsonb_array_elements(dish.variants) v) || ')';
        end if;
      elsif grp.vk <> '' then bad := 'Este plato no tiene variantes';
      end if;
      if bad is null then
        for r in select * from jsonb_array_elements(grp.lines) loop
          select id, name, buy_unit into ing from public.ingredients where public.imp_norm(name) = public.imp_norm(r ->> 'insumo');
          u := public.imp_unit(r ->> 'unidad'); q := public.imp_num(r ->> 'cantidad');
          if ing.id is null then bad := 'Línea ' || (r ->> '_n') || ': el insumo «' || coalesce(r ->> 'insumo', '') || '» no existe (cárgalo primero en Insumos)';
          elsif u is null then bad := 'Línea ' || (r ->> '_n') || ': unidad no reconocida «' || coalesce(r ->> 'unidad', '') || '»';
          elsif public.imp_family(u) <> public.imp_family(ing.buy_unit) then bad := 'Línea ' || (r ->> '_n') || ': ' || ing.name || ' se compra en ' || ing.buy_unit || ', no se puede medir en ' || u;
          elsif q is null or q <= 0 then bad := 'Línea ' || (r ->> '_n') || ': falta la cantidad';
          end if;
          exit when bad is not null;
        end loop;
      end if;
      if bad is null then
        delete from public.recipe_items where dish_id = dish.id and variant = vlabel;
        insert into public.recipe_items (dish_id, variant, ingredient_id, qty, unit, position)
        select dish.id, vlabel, (select id from public.ingredients where public.imp_norm(name) = public.imp_norm(x ->> 'insumo')),
               public.imp_num(x ->> 'cantidad'), public.imp_unit(x ->> 'unidad'), (row_number() over ())::int
        from jsonb_array_elements(grp.lines) x;
      end if;
      for r in select * from jsonb_array_elements(grp.lines) loop
        res := res || jsonb_build_object('n', (r ->> '_n')::int, 'st', case when bad is null then 'nuevo' else 'error' end,
          'msg', case when bad is null then dish.name || case when vlabel <> '' then ' (' || vlabel || ')' else '' end || ' · ' || (r ->> 'insumo') else bad end);
      end loop;
    end loop;

  elsif p_kind = 'clientes' then
    for r in select * from jsonb_array_elements(p_rows) loop
      i := i + 1; id_ := null;
      doc := public.pos_doc(r ->> 'cedula'); ph := regexp_replace(coalesce(r ->> 'telefono', ''), '[^0-9+]', '', 'g'); key := public.phone_key(ph);
      if length(trim(coalesce(r ->> 'nombre', ''))) < 2 then res := res || jsonb_build_object('n', i, 'st', 'error', 'msg', 'Falta el nombre'); continue; end if;
      if doc is null and key is null then res := res || jsonb_build_object('n', i, 'st', 'error', 'msg', 'Hace falta la cédula/RIF o un teléfono completo'); continue; end if;
      if doc is not null then id_ := public.pos_customer_id(doc); end if;
      if id_ is null and key is not null then select id into id_ from public.customers where public.phone_key(phone) = key order by id limit 1; end if;
      if id_ is null then
        insert into public.customers (doc_id, name, phone, email, address, notes, registered_at, source)
        values (doc, left(trim(r ->> 'nombre'), 80), left(ph, 20), left(lower(trim(coalesce(r ->> 'correo', ''))), 120), left(trim(coalesce(r ->> 'direccion', '')), 200),
                left(coalesce(r ->> 'notas', ''), 300), (now() at time zone 'America/Caracas')::date, 'importado');
        st := 'nuevo';
      else
        update public.customers set name = left(trim(r ->> 'nombre'), 80), doc_id = coalesce(doc_id, doc),
          phone = coalesce(nullif(left(ph, 20), ''), phone), email = coalesce(nullif(left(lower(trim(coalesce(r ->> 'correo', ''))), 120), ''), email),
          address = coalesce(nullif(left(trim(coalesce(r ->> 'direccion', '')), 200), ''), address), notes = coalesce(nullif(left(coalesce(r ->> 'notas', ''), 300), ''), notes)
        where id = id_;
        st := 'actualiza';
      end if;
      res := res || jsonb_build_object('n', i, 'st', st, 'msg', trim(r ->> 'nombre'));
    end loop;
  else
    raise exception 'Tipo de datos no válido';
  end if;
  return res;
end $$;

-- Revisar (p_dry) o cargar. Al revisar se hace todo y luego se deshace, así la vista previa dice exactamente lo que pasará.
create or replace function public.import_data(p_kind text, p_rows jsonb, p_dry boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'No hay filas para cargar'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Máximo 5000 filas por vez'; end if;
  begin
    res := public.imp_apply(p_kind, p_rows);
    if p_dry then raise exception using errcode = 'P0099', message = 'solo revisar'; end if;
  exception when sqlstate 'P0099' then null;
  end;
  return jsonb_build_object('dry', p_dry, 'rows', res,
    'nuevo', (select count(*) from jsonb_array_elements(res) x where x ->> 'st' = 'nuevo'),
    'actualiza', (select count(*) from jsonb_array_elements(res) x where x ->> 'st' = 'actualiza'),
    'error', (select count(*) from jsonb_array_elements(res) x where x ->> 'st' = 'error'));
end $$;

-- Unidades vendidas por plato y variante en un período (pedidos cobrados, sin anulados)
create or replace function public.menu_sales(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('dish_id', dish_id, 'variant', variant, 'units', units, 'revenue', revenue)), '[]'::jsonb)
          from (select i.dish_id, i.variant, sum(i.qty) as units, sum(i.qty * i.unit_price) as revenue
                from public.pos_items i join public.pos_orders o on o.id = i.order_id
                where i.status <> 'anulado' and o.status = 'cobrada' and i.dish_id is not null
                  and (o.closed_at at time zone 'America/Caracas')::date between p_from and p_to
                group by 1, 2) s);
end $$;

-- Ficha del cliente por teléfono (al crear un delivery): datos, dirección e historial
create or replace function public.pos_customer_by_phone(p_emp bigint, p_pin text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare key text := public.phone_key(p_phone); c record; h jsonb;
begin
  perform public.pos_auth(p_emp, p_pin);
  if key is null then return null; end if;
  select * into c from public.customers where public.phone_key(phone) = key order by id limit 1;
  select jsonb_build_object(
      'orders', count(*), 'spent', coalesce(round(sum(t.total), 2), 0), 'last_at', max(o.closed_at),
      'last_address', (select o2.address from public.pos_orders o2 where o2.kind = 'delivery' and o2.address <> ''
                       and (o2.customer_id = c.id or public.phone_key(o2.phone) = key) order by o2.opened_at desc limit 1),
      'top', (select coalesce(jsonb_agg(x.name order by x.n desc), '[]'::jsonb) from (
                select i.name, sum(i.qty) n from public.pos_items i join public.pos_orders o3 on o3.id = i.order_id
                where o3.status = 'cobrada' and i.status <> 'anulado' and (o3.customer_id = c.id or public.phone_key(o3.phone) = key)
                group by i.name order by 2 desc limit 3) x))
    into h
    from public.pos_orders o cross join lateral public.pos_totals(o.id) t
    where o.status = 'cobrada' and (o.customer_id = c.id or public.phone_key(o.phone) = key);
  if c.id is null and coalesce((h ->> 'orders')::int, 0) = 0 then return null; end if;
  return jsonb_build_object('id', c.id, 'name', coalesce(c.name, (select label from public.pos_orders where public.phone_key(phone) = key order by opened_at desc limit 1)),
    'address', coalesce(nullif(h ->> 'last_address', ''), c.address, ''), 'notes', coalesce(c.notes, '')) || h;
end $$;

-- Cada delivery con teléfono queda unido a su cliente (lo crea si es nuevo)
create or replace function public.pos_delivery_customer() returns trigger
language plpgsql security definer set search_path = public as $$
declare key text := public.phone_key(new.phone); cid bigint;
begin
  if new.kind <> 'delivery' or key is null then return new; end if;
  if new.customer_id is not null and tg_op = 'UPDATE' and public.phone_key(old.phone) is not distinct from key then return new; end if;
  select id into cid from public.customers where public.phone_key(phone) = key order by id limit 1;
  if cid is null then
    insert into public.customers (name, phone, address, registered_at, source)
    values (left(new.label, 80), left(regexp_replace(new.phone, '[^0-9+]', '', 'g'), 20), coalesce(new.address, ''), (now() at time zone 'America/Caracas')::date, 'delivery')
    returning id into cid;
  elsif coalesce(new.address, '') <> '' then
    update public.customers set address = new.address where id = cid and address is distinct from new.address;
  end if;
  new.customer_id := cid;
  return new;
end $$;
drop trigger if exists pos_delivery_customer on public.pos_orders;
create trigger pos_delivery_customer before insert or update of phone, address on public.pos_orders
  for each row execute function public.pos_delivery_customer();

do $$
declare f text;
begin
  foreach f in array array['import_data(text, jsonb, boolean)', 'menu_sales(date, date)', 'pos_customer_by_phone(bigint, text, text)'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['imp_apply(text, jsonb)', 'pos_delivery_customer()'] loop
    execute format('revoke execute on function public.%s from anon, public, authenticated', f);
  end loop;
end $$;
revoke execute on function public.imp_norm(text), public.phone_key(text), public.imp_unit(text), public.imp_family(text), public.imp_num(text) from anon;
