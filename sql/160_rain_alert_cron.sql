-- 160_rain_alert_cron.sql
-- Täglicher Regen-Alarm: pg_cron ruft die Edge Function `rain-alert` auf.
-- Angewendet auf aqmisgetzatbrvchbrkf am 2026-10-29.
--
-- Zeitpunkt: 17:00 UTC = 18:00 Europe/Madrid (Winterzeit, gilt für die Reise
-- Ende November). Im Sommer wäre 16:00 UTC richtig — dann den Cron-Ausdruck
-- anpassen (`0 16 * * *`).
--
-- Der Aufruf authentifiziert sich wie die App: anon JWT + `x-join-code`.
-- Der anon key ist ohnehin im ausgelieferten Bundle (Schutz kommt aus RLS und
-- dem Join-Code, nicht aus dem Key). Er steht deshalb hier als Platzhalter —
-- beim Anwenden durch den Wert aus `.env.public` ersetzen.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Alten Job gleichen Namens entfernen, damit die Datei wiederholbar ist.
select cron.unschedule('fiesta-rain-alert')
where exists (select 1 from cron.job where jobname = 'fiesta-rain-alert');

select cron.schedule(
  'fiesta-rain-alert',
  '0 17 * * *',
  $job$
  select net.http_post(
    url := 'https://aqmisgetzatbrvchbrkf.supabase.co/functions/v1/rain-alert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <ANON_KEY>',
      'x-join-code', 'SIESTA26'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $job$
);

-- Kontrolle:
--   select jobname, schedule, active from cron.job;
--   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
