-- =====================================================================================
-- Servicio y bonos del personal (liquidación mensual, se hace el día 5)
-- Ejecutar después de pos.sql. Idempotente.
--
-- Lo que se cobra de servicio (10 %) en el mes se reparte en porcentajes:
--   · gastos (alcaldía/impuestos, transporte, bolsas de comida, almuerzo, alquiler…)
--   · personas (bono según rendimiento: puntualidad, ventas, velocidad de cocina)
-- Las propinas registradas al cobrar se reparten en partes iguales entre las personas con % > 0.
-- Las deudas del personal (cuentas en caja) se descuentan del bono hasta Ref 40 (max_from_bonus);
-- lo que pase se descuenta en la quincena. Con deduct_debts = false el mes se paga completo
-- y las deudas quedan pendientes en las cuentas para el siguiente pago.
-- =====================================================================================

create table if not exists public.svc_months (
  month          date primary key check (extract(day from month) = 1),
  service_manual numeric(12,2),            -- si el mes no está en el sistema de ventas (o para corregirlo)
  tips_manual    numeric(12,2),
  rate           numeric(14,4),            -- tasa BCV para pagar en Bs
  max_from_bonus numeric(10,2) not null default 50,
  status         text not null default 'borrador' check (status in ('borrador', 'liquidado')),
  notes          text not null default '',
  closed_at      timestamptz,
  closed_by      text not null default ''
);
create table if not exists public.svc_lines (
  id           bigint generated always as identity primary key,
  month        date not null references public.svc_months(month) on delete cascade,
  kind         text not null check (kind in ('gasto', 'persona')),
  employee_id  bigint references public.employees(id) on delete set null,
  label        text not null default '',
  pct          numeric(6,3) not null default 0 check (pct >= 0 and pct <= 100),
  damages      numeric(10,2) not null default 0,
  note         text not null default '',
  position     int not null default 0,
  -- se llenan al liquidar
  bonus_ref    numeric(12,2),
  tip_ref      numeric(12,2),
  debt_ref     numeric(12,2),
  from_bonus   numeric(12,2),
  to_payroll   numeric(12,2),
  pay_ref      numeric(12,2)
);
create index if not exists svc_lines_month on public.svc_lines (month);
alter table public.svc_months add column if not exists deduct_debts boolean not null default true;
alter table public.svc_months alter column max_from_bonus set default 40;
alter table public.svc_months enable row level security;
alter table public.svc_lines enable row level security;
do $$
declare t text;
begin
  foreach t in array array['svc_months', 'svc_lines', 'pos_tab_moves'] loop
    execute format('drop policy if exists manage_all on public.%I', t);
    execute format('create policy manage_all on public.%I for all to authenticated using (public.can_manage()) with check (public.can_manage())', t);
  end loop;
end $$;

-- Servicio y propinas cobrados por mes en el sistema de ventas (más los meses cargados a mano)
create or replace function public.svc_monthly() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage_or_service() then raise exception 'Sin permiso'; end if;
  return (with ord as (
      select date_trunc('month', o.closed_at at time zone 'America/Caracas')::date as m, count(*) as orders,
             sum(t.subtotal - t.discount) as sales, sum(t.service) as service_pos
      from public.pos_orders o, public.pos_totals(o.id) t where o.status = 'cobrada' group by 1),
    tip as (select date_trunc('month', created_at at time zone 'America/Caracas')::date as m, sum(amount_ref) as tips_pos
            from public.pos_payments where is_tip group by 1),
    hist as (select date_trunc('month', sale_date)::date as m, sum(service_amount) as service_hist, sum(total) as sales_hist
             from public.daily_sales where source <> 'pos' group by 1),
    allm as (select m from ord union select m from tip union select m from hist union select month from public.svc_months)
    select coalesce(jsonb_agg(jsonb_build_object('month', a.m, 'orders', coalesce(ord.orders, 0), 'sales', coalesce(ord.sales, 0),
             'service_pos', coalesce(ord.service_pos, 0), 'tips_pos', coalesce(tip.tips_pos, 0),
             'service_hist', coalesce(hist.service_hist, 0), 'sales_hist', coalesce(hist.sales_hist, 0),
             'service_manual', sm.service_manual, 'tips_manual', sm.tips_manual, 'status', sm.status) order by a.m desc), '[]'::jsonb)
    from allm a left join ord on ord.m = a.m left join tip on tip.m = a.m left join hist on hist.m = a.m left join public.svc_months sm on sm.month = a.m);
end $$;

-- Todo lo que hace falta para la liquidación de un mes (crea el borrador si no existe)
create or replace function public.svc_month(p_month date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date; last date; m_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
begin
  if not public.can_manage_or_service() then raise exception 'Sin permiso'; end if;
  if not exists (select 1 from public.svc_months where month = m) then
    insert into public.svc_months (month, rate) values (m, public.pos_rate());
    select max(month) into last from public.svc_months where month < m;
    if last is not null then  -- copia los porcentajes del mes anterior
      insert into public.svc_lines (month, kind, employee_id, label, pct, position)
      select m, l.kind, l.employee_id, l.label, l.pct, l.position from public.svc_lines l
      left join public.employees e on e.id = l.employee_id
      where l.month = last and (l.kind = 'gasto' or e.active or public.pos_tab_balance(e.id) <> 0);
    else
      insert into public.svc_lines (month, kind, label, pct, position) values
        (m, 'gasto', 'Alcaldía e impuestos', 20, 1), (m, 'gasto', 'Transporte', 5, 2), (m, 'gasto', 'Bolsas de comida', 10, 3),
        (m, 'gasto', 'Almuerzo', 20, 4), (m, 'gasto', 'Alquiler', 22, 5);
    end if;
    -- toda persona activa aparece (con 0 % si es nueva)
    insert into public.svc_lines (month, kind, employee_id, label, pct, position)
    select m, 'persona', e.id, e.name, 0, 100 + e.id from public.employees e
    where (e.active or public.pos_tab_balance(e.id) <> 0) and coalesce(e.job_title, '') not ilike 'soci%' and not exists (select 1 from public.svc_lines l where l.month = m and l.employee_id = e.id);
  end if;
  return jsonb_build_object(
    'month', m,
    'info', (select to_jsonb(x) from public.svc_months x where x.month = m),
    'service_pos', (select coalesce(sum(t.service), 0) from public.pos_orders o, public.pos_totals(o.id) t
                    where o.status = 'cobrada' and (o.closed_at at time zone 'America/Caracas')::date between m and m_end),
    'tips_pos', (select coalesce(sum(amount_ref), 0) from public.pos_payments where is_tip and (created_at at time zone 'America/Caracas')::date between m and m_end),
    'service_hist', (select coalesce(sum(service_amount), 0) from public.daily_sales where source <> 'pos' and sale_date between m and m_end),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'employee_id', l.employee_id,
                'label', coalesce(e.name, l.label), 'alias', case when e.id is not null then public.pos_emp_name(e.id) end,
                'job', e.job_title, 'active', e.active, 'pct', l.pct, 'damages', l.damages, 'note', l.note,
                'bonus_ref', l.bonus_ref, 'tip_ref', l.tip_ref, 'debt_ref', l.debt_ref, 'from_bonus', l.from_bonus, 'to_payroll', l.to_payroll, 'pay_ref', l.pay_ref,
                'debt_now', case when e.id is not null then public.pos_tab_balance(e.id) end,
                'sales', (select (r ->> 'sales')::numeric from jsonb_array_elements(public.pos_ranking(m, m_end)) r where (r ->> 'id')::bigint = e.id),
                'days', (select count(distinct (a.event_time at time zone 'America/Caracas')::date) from public.attendance_events a
                         where a.employee_id = e.id and (a.event_time at time zone 'America/Caracas')::date between m and m_end)
              ) order by l.kind, l.position, coalesce(e.name, l.label)), '[]'::jsonb)
              from public.svc_lines l left join public.employees e on e.id = l.employee_id where l.month = m),
    'employees', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]'::jsonb) from public.employees where active));
end $$;

-- Guardar el borrador: datos del mes + líneas (reemplaza las líneas)
create or replace function public.svc_month_save(p_month date, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date;
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  if (select status from public.svc_months where month = m) = 'liquidado' then raise exception 'Ese mes ya está liquidado'; end if;
  update public.svc_months set service_manual = nullif(p_data ->> 'service_manual', '')::numeric, tips_manual = nullif(p_data ->> 'tips_manual', '')::numeric,
    rate = coalesce(nullif(p_data ->> 'rate', '')::numeric, rate), notes = coalesce(p_data ->> 'notes', notes),
    deduct_debts = coalesce((p_data ->> 'deduct_debts')::boolean, deduct_debts),
    max_from_bonus = coalesce(abs(nullif(p_data ->> 'max_from_bonus', '')::numeric), max_from_bonus) where month = m;
  delete from public.svc_lines where month = m;
  insert into public.svc_lines (month, kind, employee_id, label, pct, damages, note, position)
  select m, x.kind, x.employee_id, coalesce(x.label, ''), coalesce(x.pct, 0), coalesce(x.damages, 0), coalesce(x.note, ''), coalesce(x.position, 0)
  from jsonb_to_recordset(coalesce(p_data -> 'lines', '[]'::jsonb)) as x(kind text, employee_id bigint, label text, pct numeric, damages numeric, note text, position int)
  where x.kind in ('gasto', 'persona');
end $$;

-- Liquidar: calcula bonos, propinas y descuentos; registra los descuentos en las cuentas del personal.
create or replace function public.svc_month_close(p_month date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date; mi record; svc numeric; tips numeric; n int; l record;
  bonus numeric; tip numeric; debt numeric; fb numeric; tp numeric; who text := coalesce(auth.jwt() ->> 'email', 'administración');
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  select * into mi from public.svc_months where month = m for update;
  if mi.month is null then raise exception 'Primero abre el mes'; end if;
  if mi.status = 'liquidado' then raise exception 'Ese mes ya está liquidado'; end if;
  if (select sum(pct) from public.svc_lines where month = m) > 100.0001 then raise exception 'Los porcentajes suman más de 100 %%'; end if;
  svc := coalesce(mi.service_manual, (select (x ->> 'service_pos')::numeric + (x ->> 'service_hist')::numeric from (select public.svc_month(m) x) z), 0);
  tips := coalesce(mi.tips_manual, (public.svc_month(m) ->> 'tips_pos')::numeric, 0);
  select count(*) into n from public.svc_lines where month = m and kind = 'persona' and pct > 0;
  for l in select * from public.svc_lines where month = m loop
    bonus := round(svc * l.pct / 100, 2);
    tip := case when l.kind = 'persona' and l.pct > 0 and n > 0 then round(tips / n, 2) else 0 end;
    debt := 0; fb := 0; tp := 0;
    if l.kind = 'persona' and l.employee_id is not null then
      debt := greatest(public.pos_tab_balance(l.employee_id), 0) + l.damages;
      if mi.deduct_debts then
        fb := least(debt, mi.max_from_bonus, bonus + tip);
        tp := debt - fb;
      end if;  -- si no se descuenta, la deuda queda pendiente en la cuenta
      if fb > 0 then insert into public.pos_tab_moves (employee_id, kind, amount_ref, month, note, created_by)
        values (l.employee_id, 'descuento_bono', -fb, m, 'Descontado del bono de servicio ' || to_char(m, 'MM/YYYY'), who); end if;
      if tp > 0 then insert into public.pos_tab_moves (employee_id, kind, amount_ref, month, note, created_by)
        values (l.employee_id, 'descuento_nomina', -tp, m, 'Pasa a la quincena (excede Ref ' || mi.max_from_bonus || ')', who); end if;
      if l.damages > 0 then  -- los daños se suman a la cuenta para que el descuento cuadre
        insert into public.pos_tab_moves (employee_id, kind, amount_ref, month, note, created_by) values (l.employee_id, 'ajuste', l.damages, m, 'Daños ' || to_char(m, 'MM/YYYY'), who);
      end if;
    end if;
    update public.svc_lines set bonus_ref = bonus, tip_ref = tip, debt_ref = debt, from_bonus = fb, to_payroll = tp, pay_ref = bonus + tip - fb where id = l.id;
  end loop;
  update public.svc_months set status = 'liquidado', closed_at = now(), closed_by = who,
    service_manual = coalesce(service_manual, svc), tips_manual = coalesce(tips_manual, tips) where month = m;
  return public.svc_month(m);
end $$;

-- Reabrir una liquidación (deshace los descuentos registrados en las cuentas)
create or replace function public.svc_month_reopen(p_month date) returns void
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date;
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  delete from public.pos_tab_moves where month = m and kind in ('descuento_bono', 'descuento_nomina', 'ajuste');
  update public.svc_lines set bonus_ref = null, tip_ref = null, debt_ref = null, from_bonus = null, to_payroll = null, pay_ref = null where month = m;
  update public.svc_months set status = 'borrador', closed_at = null, closed_by = '' where month = m;
end $$;

-- Cuentas del personal en Gestión
create or replace function public.svc_tabs() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage_or_service() then raise exception 'Sin permiso'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'alias', public.pos_emp_name(e.id), 'active', e.active,
            'limit', e.tab_limit, 'balance', public.pos_tab_balance(e.id),
            'moves', (select coalesce(jsonb_agg(jsonb_build_object('at', m.created_at, 'kind', m.kind, 'amount', m.amount_ref, 'note', m.note, 'by', m.created_by)
                       order by m.created_at desc), '[]'::jsonb) from (select * from public.pos_tab_moves where employee_id = e.id order by created_at desc limit 40) m))
          order by public.pos_tab_balance(e.id) desc, e.name), '[]'::jsonb)
          from public.employees e where e.active or exists (select 1 from public.pos_tab_moves where employee_id = e.id));
end $$;
create or replace function public.svc_tab_move(p_emp bigint, p_kind text, p_amount numeric, p_note text default '') returns numeric
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_or_service() then raise exception 'Sin permiso'; end if;
  if p_kind not in ('saldo_inicial', 'abono', 'descuento_nomina', 'ajuste', 'consumo') then raise exception 'Tipo no válido'; end if;
  insert into public.pos_tab_moves (employee_id, kind, amount_ref, note, created_by)
  values (p_emp, p_kind, case when p_kind in ('abono', 'descuento_nomina') then -abs(p_amount) when p_kind = 'ajuste' then p_amount else abs(p_amount) end,
          coalesce(p_note, ''), coalesce(auth.jwt() ->> 'email', 'administración'));
  return public.pos_tab_balance(p_emp);
end $$;

do $$
declare f text;
begin
  foreach f in array array['svc_monthly()', 'svc_month(date)', 'svc_month_save(date, jsonb)', 'svc_month_close(date)', 'svc_month_reopen(date)',
                           'svc_tabs()', 'svc_tab_move(bigint, text, numeric, text)'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
