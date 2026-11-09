-- ============================================================================
-- Asistencia y rendimiento (Ichiraku)
--  · Marcas desde la tablet con el PIN de cada persona (llegada, descanso, salida)
--    hasta que llegue el terminal facial Hikvision; sus marcas entran a la misma tabla.
--  · Uniforme del día (a mano por la encargada; luego con las cámaras).
--  · Puntaje del mes por persona con las reglas del servicio por rendimiento.
-- Se ejecuta después de gestion.sql, pos.sql y servicio.sql. Se puede volver a ejecutar.
-- ============================================================================

alter table public.attendance_events drop constraint if exists attendance_events_kind_check;
alter table public.attendance_events add constraint attendance_events_kind_check
  check (kind in ('in', 'out', 'auto', 'break_start', 'break_end'));

alter table public.gestion_settings add column if not exists break_minutes int not null default 30 check (break_minutes between 0 and 240);
-- Reglas para cobrar servicio: máximo de llegadas tarde, faltas, descansos pasados y días sin uniforme en el mes
alter table public.gestion_settings add column if not exists perf_rules jsonb not null
  default '{"max_late": 3, "max_absent": 1, "max_break_over": 3, "max_no_uniform": 2}'::jsonb;

create table if not exists public.uniform_checks (
  id          bigint generated always as identity primary key,
  employee_id bigint not null references public.employees(id) on delete cascade,
  day         date not null,
  ok          boolean not null,
  note        text not null default '',
  source      text not null default 'manual' check (source in ('manual', 'camara', 'terminal')),
  created_by  text not null default '',
  created_at  timestamptz not null default now(),
  unique (employee_id, day)
);
create index if not exists uniform_checks_emp on public.uniform_checks (employee_id);
alter table public.uniform_checks enable row level security;
drop policy if exists manage_all on public.uniform_checks;
create policy manage_all on public.uniform_checks for all to authenticated using (public.can_manage()) with check (public.can_manage());
revoke all on public.uniform_checks from anon;

create or replace function public.att_today() returns date
language sql stable as $$ select (now() at time zone 'America/Caracas')::date $$;

-- Marcas de hoy de una persona y qué le toca marcar ahora
create or replace function public.pos_mark_status(p_emp bigint, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare evs jsonb; last_kind text;
begin
  perform public.pos_auth(p_emp, p_pin);
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'at', event_time) order by event_time), '[]'::jsonb),
         (array_agg(kind order by event_time desc))[1]
    into evs, last_kind
    from public.attendance_events where employee_id = p_emp and (event_time at time zone 'America/Caracas')::date = public.att_today();
  return jsonb_build_object('name', public.pos_emp_name(p_emp), 'events', evs,
    'next', case when last_kind is null or last_kind = 'out' then jsonb_build_array('in')
                 when last_kind = 'break_start' then jsonb_build_array('break_end')
                 else jsonb_build_array('break_start', 'out') end);
end $$;

create or replace function public.pos_mark(p_emp bigint, p_pin text, p_kind text, p_device text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.pos_auth(p_emp, p_pin);
  if p_kind not in ('in', 'out', 'break_start', 'break_end') then raise exception 'Marca no válida'; end if;
  insert into public.attendance_events (employee_id, event_time, kind, source, device_ref)
  values (p_emp, date_trunc('second', now()), p_kind, 'tablet', left(coalesce(p_device, ''), 30))
  on conflict (employee_id, event_time) do nothing;
  return public.pos_mark_status(p_emp, p_pin);
end $$;

-- Uniformes de hoy: quién marcó llegada y si vino con uniforme (lo anota quien puede cobrar)
create or replace function public.pos_uniform_list(p_emp bigint, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.pos_auth_charge(p_emp, p_pin);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', coalesce(public.pos_emp_name(e.id), e.name), 'full_name', e.name,
            'ok', u.ok, 'note', u.note) order by e.name), '[]'::jsonb)
          from public.employees e left join public.uniform_checks u on u.employee_id = e.id and u.day = public.att_today()
          where e.active and exists (select 1 from public.attendance_events a where a.employee_id = e.id
                                     and (a.event_time at time zone 'America/Caracas')::date = public.att_today()));
end $$;

create or replace function public.pos_uniform_set(p_emp bigint, p_pin text, p_target bigint, p_ok boolean, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.pos_auth_charge(p_emp, p_pin);
  insert into public.uniform_checks (employee_id, day, ok, note, source, created_by)
  values (p_target, public.att_today(), p_ok, left(coalesce(p_note, ''), 120), 'manual', coalesce(public.pos_emp_name(p_emp), ''))
  on conflict (employee_id, day) do update set ok = excluded.ok, note = excluded.note, created_by = excluded.created_by, created_at = now();
end $$;

-- Rendimiento del mes por persona, con las reglas de gestion_settings.perf_rules
create or replace function public.perf_month(p_month date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m0 date := date_trunc('month', p_month)::date; m1 date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  st record; rules jsonb; tol int; brk int; out jsonb := '[]'::jsonb; e record; d date; sc jsonb; sin int; fmin int;
  late int; absent int; bover int; nouni int; worked int; reasons jsonb; sales numeric; bsum int; since date;
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  select * into st from public.gestion_settings limit 1;
  rules := coalesce(st.perf_rules, '{}'::jsonb); tol := coalesce(st.late_tolerance_min, 5); brk := coalesce(st.break_minutes, 30);
  -- Solo se mide desde el primer día con marcas de asistencia: antes no hay con qué comparar
  select min((event_time at time zone 'America/Caracas')::date) into since from public.attendance_events;
  if since is null or since > m1 then
    return jsonb_build_object('month', m0, 'rules', rules, 'break_minutes', brk, 'no_data', true, 'people', '[]'::jsonb);
  end if;
  for e in select * from public.employees where active or exists (select 1 from public.attendance_events a where a.employee_id = employees.id
             and (a.event_time at time zone 'America/Caracas')::date between m0 and m1) order by name loop
    late := 0; absent := 0; bover := 0; worked := 0;
    d := greatest(m0, since);
    while d <= least(m1, public.att_today()) loop
      sc := e.schedule -> extract(isodow from d)::int::text;
      select min(extract(hour from event_time at time zone 'America/Caracas') * 60 + extract(minute from event_time at time zone 'America/Caracas'))::int
        into fmin from public.attendance_events where employee_id = e.id and (event_time at time zone 'America/Caracas')::date = d and kind <> 'break_end' and kind <> 'break_start';
      if fmin is not null then worked := worked + 1; end if;
      if sc is not null and sc ? 'in' then
        sin := split_part(sc ->> 'in', ':', 1)::int * 60 + split_part(sc ->> 'in', ':', 2)::int;
        if fmin is null and d < public.att_today() then absent := absent + 1;
        elsif fmin is not null and fmin > sin + tol then late := late + 1; end if;
      end if;
      -- Descanso del día: suma de cada salida a descanso hasta su regreso
      select coalesce(sum(extract(epoch from (select min(b.event_time) from public.attendance_events b where b.employee_id = e.id and b.kind = 'break_end' and b.event_time > a.event_time) - a.event_time) / 60), 0)::int
        into bsum from public.attendance_events a where a.employee_id = e.id and a.kind = 'break_start' and (a.event_time at time zone 'America/Caracas')::date = d;
      if bsum > brk + tol then bover := bover + 1; end if;
      d := d + 1;
    end loop;
    select count(*) into nouni from public.uniform_checks where employee_id = e.id and not ok and day between m0 and m1;
    select coalesce(sum(i.qty * i.unit_price), 0) into sales from public.pos_items i join public.pos_orders o on o.id = i.order_id
      where i.created_by = e.id and i.status <> 'anulado' and o.status = 'cobrada' and (o.closed_at at time zone 'America/Caracas')::date between m0 and m1;
    reasons := '[]'::jsonb;
    if late > coalesce((rules ->> 'max_late')::int, 999) then reasons := reasons || to_jsonb(late || ' llegadas tarde'); end if;
    if absent > coalesce((rules ->> 'max_absent')::int, 999) then reasons := reasons || to_jsonb(absent || ' faltas'); end if;
    if bover > coalesce((rules ->> 'max_break_over')::int, 999) then reasons := reasons || to_jsonb(bover || ' descansos pasados'); end if;
    if nouni > coalesce((rules ->> 'max_no_uniform')::int, 999) then reasons := reasons || to_jsonb(nouni || ' días sin uniforme'); end if;
    out := out || jsonb_build_object('employee_id', e.id, 'name', coalesce(public.pos_emp_name(e.id), e.name), 'worked', worked, 'late', late, 'absent', absent, 'break_over', bover,
      'no_uniform', nouni, 'sales', round(sales, 2), 'ok', jsonb_array_length(reasons) = 0, 'reasons', reasons);
  end loop;
  return jsonb_build_object('month', m0, 'rules', rules, 'break_minutes', brk, 'since', greatest(m0, since), 'people', out);
end $$;

create or replace function public.perf_rules_save(p_rules jsonb, p_break_minutes int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage() then raise exception 'Sin permiso'; end if;
  update public.gestion_settings set perf_rules = coalesce(p_rules, perf_rules), break_minutes = coalesce(p_break_minutes, break_minutes);
end $$;

do $$
declare f text;
begin
  foreach f in array array['pos_mark_status(bigint, text)', 'pos_mark(bigint, text, text, text)', 'pos_uniform_list(bigint, text)',
                           'pos_uniform_set(bigint, text, bigint, boolean, text)', 'perf_month(date)', 'perf_rules_save(jsonb, integer)'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke execute on function public.att_today() from anon;
