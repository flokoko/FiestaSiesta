-- ── Quiz „Wer wird Siesta-Millionär" ────────────────────────────────────
-- Phase 1: Tabellen + RPCs. Der Antwortschlüssel (`correct`) verlässt den
-- Server NIEMALS: quiz_questions hat bewusst KEINE Policy für anon, der
-- Client bekommt Fragen ausschließlich über die RPCs unten, und die liefern
-- nur Text + die vier Antworten.
--
-- Async-Leiter: 15 Stufen, Sicherheitsstufen bei 5 (500 €) und 10 (32.000 €).
-- Timer: harte Wanduhr, 30 s ab Anzeige, serverseitig mit 4 s Kulanz
-- (shown_at wird beim ersten quiz_current gesetzt, quiz_answer prüft gegen
-- die Uhr — nicht gegen den Client).
-- Frei spielbar: beliebig viele Läufe, aber Fragen werden pro Teilnehmer
-- nicht wiederholt, solange der Pool reicht.

create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('general', 'island')),
  step smallint not null check (step between 1 and 15),
  question text not null,
  options jsonb not null check (jsonb_array_length(options) = 4),
  correct smallint not null check (correct between 0 and 3),
  explanation text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists quiz_questions_pool_idx
  on public.quiz_questions (mode, step) where active;

-- Absichtlich keine Policy: nur service_role (Seeds) und SECURITY-DEFINER-RPCs.
alter table public.quiz_questions enable row level security;

create table if not exists public.quiz_runs (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  participant text not null,
  mode text not null check (mode in ('general', 'island')),
  question_ids uuid[] not null,
  step smallint not null default 1,
  reached smallint not null default 0,
  bank integer not null default 0,
  jokers jsonb not null default '{"fifty": true, "audience": true, "call": true}'::jsonb,
  seconds integer not null default 0,
  shown_at timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text not null default 'playing'
    check (outcome in ('playing', 'won', 'lost', 'banked', 'abandoned'))
);

create index if not exists quiz_runs_board_idx
  on public.quiz_runs (list_id, mode, participant, started_at desc);

create table if not exists public.quiz_answers (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.quiz_runs (id) on delete cascade,
  list_id uuid not null references public.lists (id) on delete cascade,
  question_id uuid not null,
  step smallint not null,
  choice smallint not null,
  correct boolean not null,
  seconds smallint not null default 0,
  answered_at timestamptz not null default now(),
  unique (run_id, step)
);

create index if not exists quiz_answers_played_idx
  on public.quiz_answers (list_id, question_id);

-- RLS an, keine Policies: Zugriff nur über die RPCs (die prüfen den Join-Code).
alter table public.quiz_runs enable row level security;
alter table public.quiz_answers enable row level security;

-- ── Helfer ───────────────────────────────────────────────────────────────

create or replace function public.quiz_current_list() returns uuid
language sql stable security definer set search_path = public as $$
  select l.id
  from public.lists l
  where l.join_code = (
    nullif(current_setting('request.headers', true), '')::json ->> 'x-join-code'
  )
$$;

revoke all on function public.quiz_current_list() from public;
grant execute on function public.quiz_current_list() to anon, authenticated;

-- Leiter in Siesta-Euro.
create or replace function public.quiz_ladder() returns integer[]
language sql immutable as $$
  select array[50, 100, 200, 300, 500, 1000, 2000, 4000, 8000,
               16000, 32000, 64000, 125000, 500000, 1000000]::integer[]
$$;

revoke all on function public.quiz_ladder() from public;
grant execute on function public.quiz_ladder() to anon, authenticated;

-- Mitgenommenes Geld, wenn man bei Stufe `s` (die man gerade beantwortet)
-- scheitert: die letzte Sicherheitsstufe (5 → 500 €, 10 → 32.000 €).
create or replace function public.quiz_safe_bank(s integer) returns integer
language sql immutable as $$
  select case
           when s > 10 then 32000
           when s > 5 then 500
           else 0
         end::integer
$$;

revoke all on function public.quiz_safe_bank(integer) from public;
grant execute on function public.quiz_safe_bank(integer) to anon, authenticated;

-- ── Lauf starten ─────────────────────────────────────────────────────────

create or replace function public.quiz_start(p_mode text, p_participant text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_list uuid := public.quiz_current_list();
  v_ids uuid[];
  v_run uuid;
begin
  if v_list is null then
    return jsonb_build_object('error', 'Keine Berechtigung');
  end if;
  if p_mode not in ('general', 'island') then
    return jsonb_build_object('error', 'Unbekannter Modus');
  end if;
  if not exists (
    select 1 from public.participants p
    where p.list_id = v_list and p.name = p_participant
  ) then
    return jsonb_build_object('error', 'Unbekannter Teilnehmer');
  end if;

  -- Nur ein offener Lauf pro Modus; ein alter bleibt als 'abandoned' stehen.
  update public.quiz_runs
     set outcome = 'abandoned', finished_at = now()
   where list_id = v_list and participant = p_participant
     and mode = p_mode and outcome = 'playing';

  -- 15 Fragen, eine pro Stufe, ohne Wiederholung für diesen Teilnehmer.
  select array_agg(q.id order by q.step) into v_ids
  from (
    select distinct on (qq.step) qq.id, qq.step
    from public.quiz_questions qq
    where qq.mode = p_mode and qq.active
      and qq.id not in (
        select a.question_id
        from public.quiz_answers a
        where a.list_id = v_list
          and a.run_id in (
            select r.id from public.quiz_runs r
            where r.list_id = v_list and r.participant = p_participant
          )
      )
    order by qq.step, random()
  ) q;

  -- Pool für diesen Teilnehmer erschöpft → ohne Ausschluss neu ziehen.
  if v_ids is null or array_length(v_ids, 1) < 15 then
    select array_agg(q.id order by q.step) into v_ids
    from (
      select distinct on (qq.step) qq.id, qq.step
      from public.quiz_questions qq
      where qq.mode = p_mode and qq.active
      order by qq.step, random()
    ) q;
  end if;

  if v_ids is null or array_length(v_ids, 1) < 15 then
    return jsonb_build_object('error', 'Fragenpool unvollständig');
  end if;

  insert into public.quiz_runs (list_id, participant, mode, question_ids)
  values (v_list, p_participant, p_mode, v_ids)
  returning id into v_run;

  return jsonb_build_object('run_id', v_run, 'mode', p_mode, 'steps', 15);
end;
$$;

revoke all on function public.quiz_start(text, text) from public;
grant execute on function public.quiz_start(text, text) to anon, authenticated;

-- ── Aktuelle Frage ───────────────────────────────────────────────────────

create or replace function public.quiz_current(p_run_id uuid, p_participant text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run public.quiz_runs;
  v_q public.quiz_questions;
  v_deadline timestamptz;
begin
  select * into v_run from public.quiz_runs r
   where r.id = p_run_id
     and r.list_id = public.quiz_current_list()
     and r.participant = p_participant;

  if not found then
    return jsonb_build_object('error', 'Lauf nicht gefunden');
  end if;

  if v_run.outcome <> 'playing' then
    return jsonb_build_object(
      'outcome', v_run.outcome, 'reached', v_run.reached, 'bank', v_run.bank
    );
  end if;

  select * into v_q from public.quiz_questions q
   where q.id = v_run.question_ids[v_run.step];

  if v_q.id is null then
    return jsonb_build_object('error', 'Frage fehlt');
  end if;

  -- Uhr startet beim ersten Anzeigen dieser Frage.
  if v_run.shown_at is null then
    update public.quiz_runs set shown_at = now() where id = p_run_id;
    v_deadline := now() + interval '30 seconds';
  else
    v_deadline := v_run.shown_at + interval '34 seconds';
  end if;

  return jsonb_build_object(
    'step', v_run.step,
    'step_count', 15,
    'question', v_q.question,
    'options', v_q.options,
    'bank', public.quiz_safe_bank(v_run.step),
    'value', (public.quiz_ladder())[v_run.step],
    'jokers', v_run.jokers,
    'deadline', v_deadline,
    'seconds', 30
  );
end;
$$;

revoke all on function public.quiz_current(uuid, text) from public;
grant execute on function public.quiz_current(uuid, text) to anon, authenticated;

-- ── Antworten ────────────────────────────────────────────────────────────

drop function if exists public.quiz_answer(uuid, text, smallint);
create or replace function public.quiz_answer(
  p_run_id uuid, p_participant text, p_choice integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run public.quiz_runs;
  v_q public.quiz_questions;
  v_ok boolean;
  v_timeout boolean;
  v_elapsed integer;
begin
  select * into v_run from public.quiz_runs r
   where r.id = p_run_id
     and r.list_id = public.quiz_current_list()
     and r.participant = p_participant;

  if not found then
    return jsonb_build_object('error', 'Lauf nicht gefunden');
  end if;
  if v_run.outcome <> 'playing' then
    return jsonb_build_object(
      'outcome', v_run.outcome, 'reached', v_run.reached, 'bank', v_run.bank
    );
  end if;

  select * into v_q from public.quiz_questions q
   where q.id = v_run.question_ids[v_run.step];

  v_elapsed := greatest(
    0, least(30, coalesce(extract(epoch from (now() - v_run.shown_at))::integer, 30))
  );
  v_timeout := v_run.shown_at is null
    or now() > v_run.shown_at + interval '34 seconds';
  v_ok := (not v_timeout) and p_choice = v_q.correct;

  insert into public.quiz_answers
    (run_id, list_id, question_id, step, choice, correct, seconds)
  values
    (p_run_id, v_run.list_id, v_q.id, v_run.step, p_choice::smallint, v_ok, v_elapsed);

  if not v_ok then
    update public.quiz_runs
       set outcome = 'lost',
           reached = v_run.step - 1,
           bank = public.quiz_safe_bank(v_run.step),
           seconds = seconds + v_elapsed,
           finished_at = now()
     where id = p_run_id;
    return jsonb_build_object(
      'correct', false,
      'timeout', v_timeout,
      'correct_index', v_q.correct,
      'explanation', v_q.explanation,
      'outcome', 'lost',
      'reached', v_run.step - 1,
      'bank', public.quiz_safe_bank(v_run.step)
    );
  end if;

  if v_run.step = 15 then
    update public.quiz_runs
       set outcome = 'won', reached = 15, bank = 1000000,
           seconds = seconds + v_elapsed, finished_at = now()
     where id = p_run_id;
    return jsonb_build_object(
      'correct', true, 'timeout', false,
      'correct_index', v_q.correct, 'explanation', v_q.explanation,
      'outcome', 'won', 'reached', 15, 'bank', 1000000
    );
  end if;

  update public.quiz_runs
     set step = v_run.step + 1,
         reached = v_run.step,
         seconds = seconds + v_elapsed,
         shown_at = null
   where id = p_run_id;

  return jsonb_build_object(
    'correct', true, 'timeout', false,
    'correct_index', v_q.correct, 'explanation', v_q.explanation,
    'outcome', 'playing', 'step', v_run.step + 1,
    'value', (public.quiz_ladder())[v_run.step + 1]
  );
end;
$$;

revoke all on function public.quiz_answer(uuid, text, integer) from public;
grant execute on function public.quiz_answer(uuid, text, integer) to anon, authenticated;

-- ── Aufhören und mitnehmen ───────────────────────────────────────────────

create or replace function public.quiz_bank(p_run_id uuid, p_participant text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run public.quiz_runs;
  v_bank integer;
begin
  select * into v_run from public.quiz_runs r
   where r.id = p_run_id
     and r.list_id = public.quiz_current_list()
     and r.participant = p_participant;

  if not found then
    return jsonb_build_object('error', 'Lauf nicht gefunden');
  end if;
  if v_run.outcome <> 'playing' then
    return jsonb_build_object(
      'outcome', v_run.outcome, 'reached', v_run.reached, 'bank', v_run.bank
    );
  end if;

  -- Man nimmt den Wert mit, den man bereits erreicht hat.
  v_bank := case when v_run.step > 1
                 then (public.quiz_ladder())[v_run.step - 1]
                 else 0 end;

  update public.quiz_runs
     set outcome = 'banked', reached = v_run.step - 1, bank = v_bank,
         finished_at = now()
   where id = p_run_id;

  return jsonb_build_object(
    'outcome', 'banked', 'reached', v_run.step - 1, 'bank', v_bank
  );
end;
$$;

revoke all on function public.quiz_bank(uuid, text) from public;
grant execute on function public.quiz_bank(uuid, text) to anon, authenticated;

-- ── Joker ────────────────────────────────────────────────────────────────

create or replace function public.quiz_joker(
  p_run_id uuid, p_participant text, p_kind text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run public.quiz_runs;
  v_q public.quiz_questions;
  v_wrong smallint[];
  v_dist jsonb;
  v_jokers jsonb;
  v_correct_share integer;
begin
  select * into v_run from public.quiz_runs r
   where r.id = p_run_id
     and r.list_id = public.quiz_current_list()
     and r.participant = p_participant;

  if not found then
    return jsonb_build_object('error', 'Lauf nicht gefunden');
  end if;
  if v_run.outcome <> 'playing' then
    return jsonb_build_object('error', 'Lauf ist beendet');
  end if;
  if v_run.shown_at is null then
    return jsonb_build_object('error', 'Frage noch nicht angezeigt');
  end if;
  if not coalesce((v_run.jokers ->> p_kind)::boolean, false) then
    return jsonb_build_object('error', 'Joker bereits benutzt');
  end if;

  select * into v_q from public.quiz_questions q
   where q.id = v_run.question_ids[v_run.step];

  if p_kind = 'fifty' then
    select array_agg(i::smallint) into v_wrong
    from (
      select i from generate_series(0, 3) i
      where i <> v_q.correct
      order by random()
      limit 2
    ) w;
    v_jokers := jsonb_set(v_run.jokers, '{fifty}', 'false'::jsonb);
    update public.quiz_runs set jokers = v_jokers where id = p_run_id;
    return jsonb_build_object('eliminated', to_jsonb(v_wrong), 'jokers', v_jokers);
  end if;

  if p_kind = 'audience' then
    v_correct_share := 45 + floor(random() * 40)::integer;   -- 45–84 %
    v_dist := (
      select jsonb_object_agg(i::text, case
               when i = v_q.correct then v_correct_share
               else greatest(0, (100 - v_correct_share) / 3 + (floor(random() * 7)::integer - 3))
             end)
      from generate_series(0, 3) i
    );
    v_jokers := jsonb_set(v_run.jokers, '{audience}', 'false'::jsonb);
    update public.quiz_runs set jokers = v_jokers where id = p_run_id;
    return jsonb_build_object('distribution', v_dist, 'jokers', v_jokers);
  end if;

  if p_kind = 'call' then
    return jsonb_build_object('error', 'Telefonjoker kommt in Phase 3');
  end if;

  return jsonb_build_object('error', 'Unbekannter Joker');
end;
$$;

revoke all on function public.quiz_joker(uuid, text, text) from public;
grant execute on function public.quiz_joker(uuid, text, text) to anon, authenticated;

-- ── Rangliste (beste Runde pro Person) ───────────────────────────────────

create or replace function public.quiz_leaderboard(p_mode text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_list uuid := public.quiz_current_list();
  v_rows jsonb;
begin
  if v_list is null then
    return jsonb_build_object('error', 'Keine Berechtigung');
  end if;

  select coalesce(jsonb_agg(row order by (row ->> 'reached')::int desc,
                                        (row ->> 'seconds')::int asc), '[]'::jsonb)
    into v_rows
  from (
    select jsonb_build_object(
             'participant', r.participant,
             'reached', max(r.reached),
             'best_bank', max(r.bank),
             'seconds', min(r.seconds),
             'runs', count(*),
             'won', count(*) filter (where r.outcome = 'won')
           ) as row
    from public.quiz_runs r
    where r.list_id = v_list
      and r.mode = p_mode
      and r.outcome in ('won', 'lost', 'banked')
    group by r.participant
  ) s;

  return jsonb_build_object('mode', p_mode, 'rows', v_rows);
end;
$$;

revoke all on function public.quiz_leaderboard(text) from public;
grant execute on function public.quiz_leaderboard(text) to anon, authenticated;

-- ── Offener Lauf (Wiedereinstieg nach App-Neustart) ──────────────────────

create or replace function public.quiz_open_run(p_mode text, p_participant text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_list uuid := public.quiz_current_list();
  v_id uuid;
begin
  if v_list is null then
    return jsonb_build_object('error', 'Keine Berechtigung');
  end if;

  select r.id into v_id
  from public.quiz_runs r
  where r.list_id = v_list and r.participant = p_participant
    and r.mode = p_mode and r.outcome = 'playing'
  order by r.started_at desc
  limit 1;

  if v_id is null then
    return jsonb_build_object('run_id', null);
  end if;
  return jsonb_build_object('run_id', v_id);
end;
$$;

revoke all on function public.quiz_open_run(text, text) from public;
grant execute on function public.quiz_open_run(text, text) to anon, authenticated;
