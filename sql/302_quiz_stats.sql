-- ── Quiz: Übersicht für den Startbildschirm ─────────────────────────────
-- Liefert pro Modus: Anzahl der Fragen im Pool, beste erreichte Stufe des
-- Teilnehmers und einen eventuell noch offenen Lauf (Wiedereinstieg).

create or replace function public.quiz_overview(p_participant text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_list uuid := public.quiz_current_list();
  v_modes jsonb;
begin
  if v_list is null then
    return jsonb_build_object('error', 'Keine Berechtigung');
  end if;

  select jsonb_agg(jsonb_build_object(
           'mode', m.mode,
           'questions', (
             select count(*) from public.quiz_questions q
             where q.mode = m.mode and q.active
           ),
           -- Spielbar ist ein Modus nur, wenn JEDE Stufe 1-15 besetzt ist;
           -- die reine Fragenzahl sagt darüber nichts.
           'steps', (
             select count(distinct q.step) from public.quiz_questions q
             where q.mode = m.mode and q.active
           ),
           'best', coalesce((
             select max(r.reached) from public.quiz_runs r
             where r.mode = m.mode and r.list_id = v_list
               and r.participant = p_participant
               and r.outcome in ('won', 'lost', 'banked')
           ), 0),
           'runs', (
             select count(*) from public.quiz_runs r
             where r.mode = m.mode and r.list_id = v_list
               and r.participant = p_participant
               and r.outcome in ('won', 'lost', 'banked')
           ),
           'open_run', (
             select r.id from public.quiz_runs r
             where r.mode = m.mode and r.list_id = v_list
               and r.participant = p_participant and r.outcome = 'playing'
             order by r.started_at desc limit 1
           )
         ) order by m.mode)
    into v_modes
  from (values ('general'), ('island')) as m(mode);

  return jsonb_build_object('modes', coalesce(v_modes, '[]'::jsonb));
end;
$$;

revoke all on function public.quiz_overview(text) from public;
grant execute on function public.quiz_overview(text) to anon, authenticated;
