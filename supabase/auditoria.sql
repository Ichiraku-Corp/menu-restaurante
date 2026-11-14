-- ============================================================================
-- Auditoría: quién cambió la carta y los permisos, cuándo y qué había antes (Ichiraku)
--  · Cada alta, cambio o borrado en platos, categorías, cuentas con acceso (staff) y en el
--    personal (PIN, permiso de cobrar) queda en audit_log con la cuenta y el antes/después.
--  · Si el cambio no viene de la página ni de la caja (panel de Supabase, SQL directo), se
--    anota como «SQL directo» con el usuario de la base.
--  · Solo dueño/admin con 2FA lo puede leer. Nadie lo puede editar ni borrar desde la app.
-- Se ejecuta después de schema.sql y gestion.sql. Se puede volver a ejecutar.
-- ============================================================================

create table if not exists public.audit_log (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  tbl       text not null,
  row_id    text not null default '',
  action    text not null check (action in ('alta', 'cambio', 'borrado')),
  who       text not null default '',
  via       text not null default '',
  old_data  jsonb,
  new_data  jsonb
);
create index if not exists audit_log_at on public.audit_log (at desc);
alter table public.audit_log enable row level security;
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (public.can_manage());
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb; o jsonb; n jsonb; k text;
begin
  o := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  -- No se guardan secretos: el PIN se anota solo como «cambió»
  if o ? 'pos_pin_hash' then o := o - 'pos_pin_hash' || jsonb_build_object('pos_pin', case when o ->> 'pos_pin_hash' is null then 'sin PIN' else 'con PIN' end); end if;
  if n ? 'pos_pin_hash' then n := n - 'pos_pin_hash' || jsonb_build_object('pos_pin', case when n ->> 'pos_pin_hash' is null then 'sin PIN'
                                   when tg_op = 'UPDATE' and old.pos_pin_hash is distinct from new.pos_pin_hash then 'PIN cambiado' else 'con PIN' end); end if;
  -- En cambios, solo los campos que cambiaron (y nada si lo único que cambió es la hora de actualización)
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if o -> k = n -> k then o := o - k; n := n - k; end if;
    end loop;
    o := o - 'updated_at'; n := n - 'updated_at';
    if n = '{}'::jsonb then return null; end if;
  end if;
  insert into public.audit_log (tbl, row_id, action, who, via, old_data, new_data)
  values (tg_table_name, coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id',
                                  (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'email', ''),
          case tg_op when 'INSERT' then 'alta' when 'UPDATE' then 'cambio' else 'borrado' end,
          coalesce(j ->> 'email', j ->> 'role', current_user),
          case when j is null then 'SQL directo (' || current_user || ')' else coalesce(j ->> 'role', '') || coalesce(' · ' || (j ->> 'aal'), '') end,
          o, n);
  return null;
end $$;
revoke execute on function public.audit_row() from anon, public, authenticated;

do $$
declare t text;
begin
  foreach t in array array['dishes', 'categories', 'staff', 'employees'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
    end if;
  end loop;
end $$;
