-- ============================================================================
-- Alertas al correo del dueño (Ichiraku)
--  · Cierre de caja que no cuadra por más de lo indicado en Gestión → Dinero → Ventas (Ajustes); Ref 5 si no se cambia
--    (igual que la regla del cierre: si pasa de Ref 5, se explica en la nota).
--  · Platos anulados después de ir a cocina: uno caro (Ref 20 o más) o el tercero del día.
--  · Descuentos grandes: Ref 15 o más, o más del 25 % de la cuenta.
--  · La laptop de caja sin conectarse 15 minutos con la caja abierta.
--  Van por la misma cola de correos del cierre (pos_reports): las envía el servidor (función «correo») y,
--  de respaldo, la laptop. La de «laptop sin conexión» solo la puede enviar el servidor (necesita las
--  claves del correo en Supabase → Edge Functions → Secrets).
-- Se ejecuta después de pos.sql y correo.sql. Se puede volver a ejecutar.
-- ============================================================================

alter table public.gestion_settings add column if not exists alert_emails text not null default '';
alter table public.gestion_settings add column if not exists alert_cash_diff numeric(10,2) not null default 5;

-- Encola una alerta. La misma clave no se repite en 12 horas. Sin correos configurados, no hace nada.
create or replace function public.pos_alerta(p_clave text, p_titulo text, p_lineas text[]) returns boolean
language plpgsql security definer set search_path = public as $$
declare rcp text;
begin
  select coalesce(nullif(trim(alert_emails), ''), trim(report_emails)) into rcp from public.gestion_settings limit 1;
  if coalesce(rcp, '') = '' then return false; end if;
  if exists (select 1 from public.pos_reports where data ->> 'kind' = 'alerta' and data ->> 'clave' = p_clave
             and created_at > now() - interval '12 hours') then return false; end if;
  insert into public.pos_reports (session_id, recipients, data)
  values ((select id from public.pos_sessions where status = 'abierta' limit 1), rcp,
          jsonb_build_object('kind', 'alerta', 'clave', p_clave, 'titulo', p_titulo, 'lineas', to_jsonb(coalesce(p_lineas, '{}'::text[])), 'at', now()));
  return true;
end $$;
revoke execute on function public.pos_alerta(text, text, text[]) from anon, public, authenticated;

create or replace function public.pos_metodo_nombre(k text) returns text
language sql immutable set search_path = public as $$
  select case k when 'efectivo_usd' then 'Efectivo $' when 'efectivo_bs' then 'Efectivo Bs' when 'pago_movil' then 'Pago móvil'
                when 'punto_debito' then 'Punto débito' when 'punto_credito' then 'Punto crédito' when 'zelle' then 'Zelle'
                when 'binance' then 'Binance' when 'paypal' then 'PayPal' else k end
$$;
create or replace function public.pos_hora(t timestamptz) returns text
language sql stable set search_path = public as $$ select to_char(t at time zone 'America/Caracas', 'DD/MM HH24:MI') $$;
-- Montos como en los correos del cierre: 1.234,56
create or replace function public.pos_dinero(x numeric) returns text
language sql immutable set search_path = public as $$ select translate(to_char(coalesce(x, 0), 'FM999G999G990D00'), ',.', '.,') $$;

-- 1) Cierre que no cuadra
create or replace function public.alerta_cierre() returns trigger
language plpgsql security definer set search_path = public as $$
declare rt numeric; dif numeric; lim numeric; det text;
begin
  if new.status <> 'cerrada' or old.status = 'cerrada' or new.counted is null then return null; end if;
  select coalesce((select eur from public.pos_rates where rate_date <= (new.closed_at at time zone 'America/Caracas')::date order by rate_date desc limit 1), public.pos_rate()) into rt;
  select coalesce(round(sum(((new.counted ->> k)::numeric - coalesce((new.expected ->> k)::numeric, 0))
                            / case when k in ('efectivo_bs', 'pago_movil', 'punto_debito', 'punto_credito') then nullif(rt, 0) else 1 end), 2), 0),
         string_agg(public.pos_metodo_nombre(k) || ': ' || case when (new.counted ->> k)::numeric >= coalesce((new.expected ->> k)::numeric, 0) then 'sobra ' else 'falta ' end ||
                    case when k in ('efectivo_bs', 'pago_movil', 'punto_debito', 'punto_credito') then 'Bs ' else '$ ' end ||
                    public.pos_dinero(abs((new.counted ->> k)::numeric - coalesce((new.expected ->> k)::numeric, 0))), ' · ')
           filter (where abs((new.counted ->> k)::numeric - coalesce((new.expected ->> k)::numeric, 0)) >= 0.01)
    into dif, det
  from jsonb_object_keys(new.counted) k where k not like '\_%' and jsonb_typeof(new.counted -> k) = 'number';
  select alert_cash_diff into lim from public.gestion_settings limit 1;
  if abs(dif) <= coalesce(lim, 5) then return null; end if;
  perform public.pos_alerta('cierre-' || new.id,
    'El cierre de caja no cuadra: ' || case when dif > 0 then 'sobran' else 'faltan' end || ' Ref ' || public.pos_dinero(abs(dif)),
    array['Cerró: ' || coalesce(public.pos_emp_name(new.closed_by), '—') || ' · ' || public.pos_hora(new.closed_at),
          'Diferencia por método: ' || coalesce(det, '—'),
          'Nota del cierre: ' || coalesce(nullif(trim(new.notes), ''), '(sin nota)')]);
  return null;
end $$;
drop trigger if exists alerta_cierre on public.pos_sessions;
create trigger alerta_cierre after update of status on public.pos_sessions for each row execute function public.alerta_cierre();
revoke execute on function public.alerta_cierre() from anon, public, authenticated;

-- 2) Platos anulados después de ir a cocina
create or replace function public.alerta_anulado() returns trigger
language plpgsql security definer set search_path = public as $$
declare monto numeric := round(new.qty * new.unit_price, 2); hoy date := (now() at time zone 'America/Caracas')::date; n int; lista text[];
begin
  if new.status <> 'anulado' or old.status <> 'enviado' then return null; end if;
  if monto >= 20 then
    perform public.pos_alerta('anulado-' || new.id, 'Se anuló un plato que ya estaba en cocina (Ref ' || public.pos_dinero(monto) || ')',
      array[trim_scale(new.qty)::text || ' × ' || new.name || case when new.variant <> '' then ' ' || new.variant else '' end || ' · ' || public.pos_order_label(new.order_id),
            'Motivo: ' || coalesce(nullif(trim(new.void_reason), ''), '—'), 'Lo anuló: ' || coalesce(public.pos_emp_name(new.voided_by), '—') || ' · ' || public.pos_hora(coalesce(new.voided_at, now()))]);
  end if;
  select count(*), array_agg(trim_scale(i.qty)::text || ' × ' || i.name || ' · ' || public.pos_order_label(i.order_id) || ' · ' || coalesce(nullif(trim(i.void_reason), ''), 'sin motivo')
                             || ' (' || coalesce(public.pos_emp_name(i.voided_by), '—') || ')' order by i.voided_at)
    into n, lista
  from public.pos_items i where i.status = 'anulado' and i.sent_at is not null and (coalesce(i.voided_at, now()) at time zone 'America/Caracas')::date = hoy;
  if n = 3 then
    perform public.pos_alerta('anulados-' || hoy, 'Ya van 3 platos anulados hoy después de ir a cocina', lista);
  end if;
  return null;
end $$;
drop trigger if exists alerta_anulado on public.pos_items;
create trigger alerta_anulado after update of status on public.pos_items for each row execute function public.alerta_anulado();
revoke execute on function public.alerta_anulado() from anon, public, authenticated;

-- 3) Descuentos grandes
create or replace function public.alerta_descuento() returns trigger
language plpgsql security definer set search_path = public as $$
declare sub numeric;
begin
  if new.discount <= coalesce(old.discount, 0) then return null; end if;
  select subtotal into sub from public.pos_totals(new.id);
  if new.discount < 15 and new.discount <= coalesce(sub, 0) * 0.25 then return null; end if;
  perform public.pos_alerta('descuento-' || new.id || '-' || new.discount,
    'Descuento grande: Ref ' || public.pos_dinero(new.discount) || case when sub > 0 then ' (' || round(new.discount / sub * 100) || ' % de la cuenta)' else '' end,
    array[public.pos_order_label(new.id) || ' · cuenta de Ref ' || public.pos_dinero(sub),
          'Motivo: ' || coalesce(nullif(trim(new.discount_reason), ''), '—'), 'Lo hizo: ' || coalesce(public.pos_emp_name(new.discount_by), '—') || ' · ' || public.pos_hora(now())]);
  return null;
end $$;
drop trigger if exists alerta_descuento on public.pos_orders;
create trigger alerta_descuento after update of discount on public.pos_orders for each row execute function public.alerta_descuento();
revoke execute on function public.alerta_descuento() from anon, public, authenticated;

-- 4) Laptop sin conexión con la caja abierta (se revisa cada 5 minutos)
create or replace function public.pos_alertas_revisar() returns void
language plpgsql security definer set search_path = public as $$
declare visto timestamptz; abiertos int;
begin
  if not exists (select 1 from public.pos_sessions where status = 'abierta') then return; end if;
  select updated_at into visto from public.pos_kv where key = 'bridge_seen';
  if visto is null or visto > now() - interval '15 minutes' then return; end if;
  select count(*) into abiertos from public.pos_orders where status = 'abierta';
  perform public.pos_alerta('laptop-' || extract(epoch from visto)::bigint,
    'La laptop de caja no se conecta desde ' || to_char(visto at time zone 'America/Caracas', 'HH24:MI'),
    array['La caja sigue abierta' || case when abiertos > 0 then ' y hay ' || abiertos || ' pedido' || case when abiertos = 1 then '' else 's' end || ' abierto' || case when abiertos = 1 then '' else 's' end else '' end || '.',
          'Mientras tanto no salen comandas ni tickets por la impresora.',
          'Revisa que la laptop esté encendida, con internet y con el puente abierto.']);
end $$;
revoke execute on function public.pos_alertas_revisar() from anon, public, authenticated;
grant execute on function public.pos_alertas_revisar() to service_role;
do $$
begin
  if to_regclass('cron.job') is not null then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ichiraku-alertas';
    perform cron.schedule('ichiraku-alertas', '*/5 * * * *', 'select public.pos_alertas_revisar()');
  end if;
end $$;
