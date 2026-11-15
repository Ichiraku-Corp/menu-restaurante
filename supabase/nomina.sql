-- ============================================================================
-- Nómina: faltas y descuentos de cada quincena (Ichiraku)
--  · El dueño los anota en Gestión › Personal › Nómina, hasta que Nex los cargue solo (source = 'nex').
--  · Una falta descuenta por defecto quincena ÷ 15 por día; el monto se puede cambiar.
--  · Lo que la cuenta del empleado pasa «a la quincena» (consumos que exceden el bono del servicio, o lo
--    anotado como «Descontado en nómina») se muestra en la quincena en que se registró, sin repetirlo aquí.
--  · gestion_nomina(desde) trae la tasa euro BCV de hoy (y la próxima, si el BCV ya la publicó) para
--    pasar a bolívares lo que hay que pagar.
--  · Al marcar «pagado» queda cuánto se pagó, a qué tasa, en Bs, quién y cuándo (payroll_payments).
-- Se ejecuta después de gestion.sql, pos.sql y auditoria.sql. Se puede volver a ejecutar.
-- ============================================================================

create table if not exists public.payroll_adjustments (
  id          bigint generated always as identity primary key,
  employee_id bigint not null references public.employees(id) on delete cascade,
  period      date not null check (extract(day from period) in (1, 16)),   -- inicio de la quincena
  kind        text not null check (kind in ('falta', 'descuento')),
  days        numeric(4,1) not null default 0 check (days >= 0 and days <= 16),
  amount_ref  numeric(12,2) not null check (amount_ref > 0 and amount_ref < 100000),
  reason      text not null default '' check (length(reason) <= 120),
  source      text not null default 'manual' check (source in ('manual', 'nex')),
  created_by  text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists payroll_adjustments_period on public.payroll_adjustments (period, employee_id);

-- Quién lo anotó y cuándo: lo pone la base (no se puede escribir a mano ni cambiar después)
create or replace function public.payroll_adj_who() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by; new.created_at := old.created_at;
  else
    new.created_by := coalesce(nullif(auth.jwt() ->> 'email', ''), current_user); new.created_at := now();
  end if;
  return new;
end $$;
revoke execute on function public.payroll_adj_who() from anon, public, authenticated;
drop trigger if exists payroll_adj_who on public.payroll_adjustments;
create trigger payroll_adj_who before insert or update on public.payroll_adjustments for each row execute function public.payroll_adj_who();

alter table public.payroll_adjustments enable row level security;
drop policy if exists manage_all on public.payroll_adjustments;
create policy manage_all on public.payroll_adjustments for all to authenticated using (public.can_manage()) with check (public.can_manage());
revoke all on public.payroll_adjustments from anon;

-- Queda en la auditoría quién anotó o borró cada falta o descuento
do $$
begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists audit_payroll_adjustments on public.payroll_adjustments;
    create trigger audit_payroll_adjustments after insert or update or delete on public.payroll_adjustments for each row execute function public.audit_row();
  end if;
end $$;

-- Pagos de la quincena: uno por persona; desmarcar el pago lo borra
create table if not exists public.payroll_payments (
  employee_id bigint not null references public.employees(id) on delete cascade,
  period      date not null check (extract(day from period) in (1, 16)),
  amount_ref  numeric(12,2) not null check (amount_ref >= 0 and amount_ref < 100000),
  rate        numeric(14,4) check (rate > 0),
  amount_bs   numeric(16,2) check (amount_bs >= 0),
  paid_by     text not null default '',
  paid_at     timestamptz not null default now(),
  primary key (employee_id, period)
);
create or replace function public.payroll_pay_who() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then new.paid_by := old.paid_by; new.paid_at := old.paid_at;
  else new.paid_by := coalesce(nullif(auth.jwt() ->> 'email', ''), current_user); new.paid_at := now(); end if;
  return new;
end $$;
revoke execute on function public.payroll_pay_who() from anon, public, authenticated;
drop trigger if exists payroll_pay_who on public.payroll_payments;
create trigger payroll_pay_who before insert or update on public.payroll_payments for each row execute function public.payroll_pay_who();
alter table public.payroll_payments enable row level security;
drop policy if exists manage_all on public.payroll_payments;
create policy manage_all on public.payroll_payments for all to authenticated using (public.can_manage()) with check (public.can_manage());
revoke all on public.payroll_payments from anon;
do $$
begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists audit_payroll_payments on public.payroll_payments;
    create trigger audit_payroll_payments after insert or update or delete on public.payroll_payments for each row execute function public.audit_row();
  end if;
end $$;

-- Todo lo de una quincena: tasa del día, faltas y descuentos anotados, lo que viene de las cuentas de empleados y lo ya pagado
create or replace function public.gestion_nomina(p_desde date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d0 date; d1 date; hoy date := (now() at time zone 'America/Caracas')::date;
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  p_desde := coalesce(p_desde, hoy);
  d0 := date_trunc('month', p_desde)::date + case when extract(day from p_desde) >= 16 then 15 else 0 end;
  d1 := case when extract(day from d0) = 1 then d0 + 14 else (date_trunc('month', d0) + interval '1 month - 1 day')::date end;
  return jsonb_build_object(
    'desde', d0, 'hasta', d1,
    'tasa', (select jsonb_build_object('fecha', rate_date, 'eur', eur) from public.pos_rates where rate_date <= hoy order by rate_date desc limit 1),
    'proxima', (select jsonb_build_object('fecha', rate_date, 'eur', eur) from public.pos_rates where rate_date > hoy order by rate_date limit 1),
    'ajustes', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'employee_id', a.employee_id, 'kind', a.kind, 'days', a.days, 'amount', a.amount_ref,
                 'reason', a.reason, 'source', a.source, 'por', a.created_by, 'at', a.created_at) order by a.created_at, a.id)
               from public.payroll_adjustments a where a.period = d0), '[]'::jsonb),
    'cuentas', coalesce((select jsonb_agg(jsonb_build_object('employee_id', m.employee_id, 'amount', -m.amount_ref, 'note', m.note, 'at', m.created_at) order by m.created_at, m.id)
               from public.pos_tab_moves m where m.kind = 'descuento_nomina' and m.amount_ref < 0
                 and (m.created_at at time zone 'America/Caracas')::date between d0 and d1), '[]'::jsonb),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object('employee_id', p.employee_id, 'amount', p.amount_ref, 'rate', p.rate, 'bs', p.amount_bs,
                 'por', p.paid_by, 'at', p.paid_at) order by p.paid_at)
               from public.payroll_payments p where p.period = d0), '[]'::jsonb));
end $$;
revoke execute on function public.gestion_nomina(date) from anon, public;
grant execute on function public.gestion_nomina(date) to authenticated;
