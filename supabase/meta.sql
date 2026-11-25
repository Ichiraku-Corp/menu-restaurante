-- ============================================================================
-- Meta del día (Ichiraku)
--  · La meta de hoy es el promedio de ventas de ese mismo día de la semana en las últimas 8 semanas
--    (solo los días que hubo ventas: Syth y el sistema propio, en daily_sales), más el % que el dueño
--    indique en Gestión → Dinero → Ventas (Ajustes); 0 % si no se cambia. Se redondea hacia arriba a Ref 5.
--  · Se compara con lo cobrado hoy sin el servicio (igual que las ventas del día en Gestión → Ventas).
--  · La ve el dueño en Gestión → Inicio y, en la caja, quien tiene permiso de cobrar.
-- Se ejecuta después de gestion.sql y pos.sql. Se puede volver a ejecutar.
-- ============================================================================

alter table public.gestion_settings add column if not exists meta_pct numeric(5,1) not null default 0;
alter table public.gestion_settings drop constraint if exists gestion_settings_meta_pct_check;
alter table public.gestion_settings add constraint gestion_settings_meta_pct_check check (meta_pct between -50 and 200);

create or replace function public.meta_dia(p_dia date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date := coalesce(p_dia, (now() at time zone 'America/Caracas')::date); prom numeric; n int; pct numeric; v numeric; k int;
begin
  select avg(s.total), count(*) into prom, n from public.daily_sales s
   where s.sale_date between d - 56 and d - 1 and extract(isodow from s.sale_date) = extract(isodow from d) and s.total > 0;
  select coalesce(max(meta_pct), 0) into pct from public.gestion_settings;
  select coalesce(sum(t.subtotal - t.discount + t.delivery), 0), count(*) filter (where not o.premio) into v, k
    from public.pos_orders o cross join lateral public.pos_totals(o.id) t
   where o.status = 'cobrada' and o.closed_at >= (d::timestamp at time zone 'America/Caracas') and o.closed_at < ((d + 1)::timestamp at time zone 'America/Caracas');
  return jsonb_build_object('dia', d, 'vendido', round(v, 2), 'pedidos', k, 'promedio', round(prom, 2), 'dias', n, 'pct', pct,
    'meta', case when n > 0 then ceil(prom * (1 + pct / 100) / 5) * 5 end);
end $$;
revoke execute on function public.meta_dia(date) from anon, public, authenticated;

-- Gestión → Inicio (dueño/admin con 2FA)
create or replace function public.gestion_meta() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  return public.meta_dia(null);
end $$;
revoke execute on function public.gestion_meta() from anon, public;
grant execute on function public.gestion_meta() to authenticated;

-- La caja: solo quien tiene permiso de cobrar
create or replace function public.pos_meta(p_emp bigint, p_pin text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$   -- volatile: el freno de PIN cuenta los intentos
begin
  perform public.pos_auth_charge(p_emp, p_pin);
  return public.meta_dia(null);
end $$;
revoke execute on function public.pos_meta(bigint, text) from anon, public;
grant execute on function public.pos_meta(bigint, text) to authenticated;
