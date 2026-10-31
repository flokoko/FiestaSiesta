-- 190_wake_alarm.sql
-- Wecker am Reiseplan: Los-Zeit je Vorschlag, Vorlauf in Minuten, an/aus.
-- Zustellung über die Edge Function `reminder` (pg_cron, alle 5 Minuten), die
-- pro Vorschlag und Tag höchstens einmal sendet — dafür `reminder_log`.
--
-- Idempotent. RLS: die drei neuen Spalten hängen an `trip_proposals` und werden
-- von der bestehenden Join-Code-Policy mitgeschützt. `reminder_log` bekommt
-- bewusst KEINE Policy (nur service_role, also nur die Function).

alter table public.trip_proposals
  add column if not exists starts_at time,
  add column if not exists remind_before smallint,
  add column if not exists remind_enabled boolean not null default false;

alter table public.trip_proposals
  drop constraint if exists trip_proposals_remind_before_check;
alter table public.trip_proposals
  add constraint trip_proposals_remind_before_check
  check (remind_before is null or (remind_before >= 0 and remind_before <= 180));

create table if not exists public.reminder_log (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists(id) on delete cascade,
  proposal_id uuid not null,
  day date not null,
  sent_at timestamptz not null default now(),
  unique (proposal_id, day)
);

alter table public.reminder_log enable row level security;

-- ── Cron: alle 5 Minuten die fälligen Wecker prüfen ──────────────────
-- Der Aufruf authentifiziert sich wie die App (anon JWT + Join-Code); der
-- Platzhalter <ANON_KEY> wird beim Anwenden ersetzt.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('fiesta-reminder')
where exists (select 1 from cron.job where jobname = 'fiesta-reminder');

select cron.schedule(
  'fiesta-reminder',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://aqmisgetzatbrvchbrkf.supabase.co/functions/v1/reminder',
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
--   select count(*) from reminder_log;
