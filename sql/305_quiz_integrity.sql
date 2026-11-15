-- ── Quiz: Integrität — veraltete Antworten, Doppeltipps, Lauf-Rennen ──────
-- Warum: Der Client nennt beim Antworten jetzt die Stufe (p_step). Der Server
-- darf sie nur annehmen, wenn sie zur Stufe des Laufs passt — sonst schreibt
-- quiz_answer die Antwort still auf die Stufe, die die DB gerade hält (z. B.
-- nach dem Wiedereinstieg auf zweitem Gerät). Veraltete Antworten und
-- Doppeltipps kehren mit 'stale': true zurück; der Screen lädt dann den Lauf
-- still neu, statt einen Fehler zu zeigen.
--
-- Der partielle Unique-Index erzwingt auf DB-Ebene, was quiz_start nur
-- anwendungslogisch verspricht: ein offener Lauf pro (Liste, Teilnehmer,
-- Modus) — zwei gleichzeitige Starts (zwei Geräte) können sonst zwei
-- 'playing'-Läufe erzeugen. quiz_start liefert dann den schon laufenden
-- Lauf als 'resumed' zurück, statt roh zu sterben.
-- Idempotent.
--
-- Doppelläufe finden, VOR dem Anlegen des Index (Live-DB aktuell keine):
--   select list_id, participant, mode, count(*)
--     from public.quiz_runs
--    where outcome = 'playing'
--    group by list_id, participant, mode
--   having count(*) > 1;

create unique index if not exists quiz_runs_one_open_idx
  on public.quiz_runs (list_id, participant, mode) where outcome = 'playing';

-- ── quiz_answer: p_step (Stale-Schutz) + Doppeltipp-Schutz ───────────────
-- p_step hat den Default null: Alte Clients, die ihn nicht senden, brechen
-- nicht (die Stufenprüfung wird dann übersprungen). Alte Signaturen laufen
-- danach aus — bei zwei Signaturen kann PostgREST sonst nicht mehr wählen.

drop function if exists public.quiz_answer(uuid, text, smallint);
drop function if exists public.quiz_answer(uuid, text, integer);

create or replace function public.quiz_answer(
  p_run_id uuid, p_participant text, p_choice integer, p_step integer default null
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

  -- Veraltete Antwort: die Frage, auf die der Client zeigt, ist nicht mehr
  -- die aktuelle. Nach dem Fragen-Load prüfen zu wollen wäre zu spät.
  if p_step is not null and p_step <> v_run.step then
    return jsonb_build_object('error', 'Veraltete Antwort', 'stale', true);
  end if;

  if p_choice < -1 or p_choice > 3 then
    return jsonb_build_object('error', 'Ungültige Antwort');
  end if;
  if v_run.shown_at is null then
    return jsonb_build_object('error', 'Frage noch nicht angezeigt');
  end if;

  select * into v_q from public.quiz_questions q
   where q.id = v_run.question_ids[v_run.step];

  v_elapsed := greatest(
    0, least(30, coalesce(extract(epoch from (now() - v_run.shown_at))::integer, 30))
  );
  -- p_choice < 0 = der Client hat die Uhr ablaufen lassen und gibt ohne
  -- Antwort ab. Das ist ein Zeitablauf, auch wenn die 4-s-Kulanz noch läuft.
  v_timeout := v_run.shown_at is null
    or p_choice < 0
    or now() > v_run.shown_at + interval '34 seconds';
  v_ok := (not v_timeout) and p_choice = v_q.correct;

  begin
    insert into public.quiz_answers
      (run_id, list_id, question_id, step, choice, correct, seconds)
    values
      (p_run_id, v_run.list_id, v_q.id, v_run.step, p_choice::smallint, v_ok, v_elapsed);
  exception when unique_violation then
    -- Doppeltipp-Rennen: dieselbe (run, step) hat schon eine Antwort. Den
    -- ersten Treffer zählen lassen, den zweiten still ablehnen — der Screen
    -- lädt den Lauf neu statt einen rohen 23505 zu zeigen.
    return jsonb_build_object('error', 'Bereits beantwortet', 'stale', true);
  end;

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

revoke all on function public.quiz_answer(uuid, text, integer, integer) from public;
grant execute on function public.quiz_answer(uuid, text, integer, integer) to anon, authenticated;

-- ── quiz_start: Resümee statt roher Fehler ──────────────────────────────

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

  -- 15 Fragen, genau eine pro Stufe. Der Ausschluss (schon gespielte Fragen)
  -- gilt PRO STUFE: ist eine Stufe leer gespielt, wird nur dort wiederholt,
  -- nicht der ganze Stapel neu gezogen.
  select array_agg(x.id order by x.step) into v_ids
  from (
    select s.step,
           coalesce(
             (select qq.id
                from public.quiz_questions qq
               where qq.mode = p_mode and qq.active and qq.step = s.step
                 and qq.id not in (
                   select a.question_id from public.quiz_answers a
                    where a.list_id = v_list
                      and a.run_id in (
                        select r.id from public.quiz_runs r
                        where r.list_id = v_list and r.participant = p_participant
                      )
                 )
               order by random() limit 1),
             (select qq.id
                from public.quiz_questions qq
               where qq.mode = p_mode and qq.active and qq.step = s.step
               order by random() limit 1)
           ) as id
    from generate_series(1, 15) as s(step)
  ) x
  where x.id is not null;

  if v_ids is null or array_length(v_ids, 1) < 15 then
    return jsonb_build_object('error', 'Fragenpool unvollständig');
  end if;

  begin
    insert into public.quiz_runs (list_id, participant, mode, question_ids)
    values (v_list, p_participant, p_mode, v_ids)
    returning id into v_run;
  exception when unique_violation then
    -- Zwei Geräte haben gleichzeitig gestartet: quiz_runs_one_open_idx hat
    -- dem zweiten den Rang geklärt — den laufenden Run fortsetzen, nicht die
    -- Session mit einem rohen Fehler abschießen.
    select r.id into v_run
      from public.quiz_runs r
     where r.list_id = v_list and r.participant = p_participant
       and r.mode = p_mode and r.outcome = 'playing'
     order by r.started_at desc
     limit 1;
    return jsonb_build_object('run_id', v_run, 'mode', p_mode, 'steps', 15, 'resumed', true);
  end;

  return jsonb_build_object('run_id', v_run, 'mode', p_mode, 'steps', 15);
end;
$$;

revoke all on function public.quiz_start(text, text) from public;
grant execute on function public.quiz_start(text, text) to anon, authenticated;

NOTIFY pgrst, 'reload schema';
