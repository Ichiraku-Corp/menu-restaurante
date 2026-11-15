-- ============================================================================
-- Correos del cierre y del resumen semanal desde el servidor (Ichiraku)
--  · Al guardar un reporte (cierre de caja), la base llama a la función «correo», que lo envía
--    al momento aunque la laptop se apague. Cada 5 minutos se reintenta lo que haya quedado
--    pendiente y se arma el resumen semanal de los lunes.
--  · La laptop sigue como respaldo: solo envía lo que lleve más de 10 minutos sin salir.
--  · Las claves del correo van en Supabase → Edge Functions → Secrets (SMTP_HOST, SMTP_PORT,
--    SMTP_USER, SMTP_PASS), nunca aquí.
-- Se ejecuta después de pos.sql. Se puede volver a ejecutar. Si el servidor no tiene pg_net
-- o pg_cron (por ejemplo en las pruebas), esta parte se salta y la laptop sigue enviando.
-- ============================================================================

grant execute on function public.pos_report_next(integer), public.pos_report_done(bigint, boolean, text), public.pos_week_queue() to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
end $$;

-- Llama a la función «correo» (no lleva datos: la función busca en la base lo que haya por enviar)
create or replace function public.correo_avisar() returns void
language plpgsql security definer set search_path = public as $$
begin
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null then return; end if;
  perform net.http_post(url := 'https://krjryvtnzgwwhanmbdrn.supabase.co/functions/v1/correo',
                        body := '{}'::jsonb, headers := '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds := 30000);
exception when others then null;  -- si falla el aviso, la laptop o el reintento lo envían
end $$;
revoke execute on function public.correo_avisar() from anon, public, authenticated;

create or replace function public.correo_al_guardar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.correo_avisar();
  return null;
end $$;
revoke execute on function public.correo_al_guardar() from anon, public, authenticated;
drop trigger if exists correo_al_guardar on public.pos_reports;
create trigger correo_al_guardar after insert on public.pos_reports for each statement execute function public.correo_al_guardar();

-- Reintento y resumen semanal cada 5 minutos
do $$
begin
  if to_regclass('cron.job') is not null then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ichiraku-correo';
    perform cron.schedule('ichiraku-correo', '*/5 * * * *', 'select public.correo_avisar()');
  end if;
end $$;
