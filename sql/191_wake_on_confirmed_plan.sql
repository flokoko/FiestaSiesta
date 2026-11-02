-- 191_wake_on_confirmed_plan.sql
-- Entscheidung 31.10.2026 (Flo): Der Wecker hängt NUR am bestätigten Plan.
--
-- 1. Bestätigen schaltet den Wecker des Vorschlags scharf (wenn eine Los-Zeit
--    gesetzt ist) und macht die Verlierer desselben Slots stumm. Damit klingelt
--    nie ein Vorschlag, der die Abstimmung verloren hat.
-- 2. `reminder_log` bekommt einen FK mit Cascade (keine Waisen) und
--    `trip_proposals` einen passenden Teilindex für die 5-Minuten-Abfrage.
-- 3. Hausputz: Wecker auf unbestätigten Zeilen ausschalten (Altbestand).

alter table public.reminder_log
  drop constraint if exists reminder_log_proposal_fk;
alter table public.reminder_log
  add constraint reminder_log_proposal_fk
  foreign key (proposal_id) references public.trip_proposals(id) on delete cascade;

create index if not exists trip_proposals_remind_day_idx
  on public.trip_proposals (list_id, day)
  where remind_enabled and confirmed_at is not null;

-- Alte Wecker auf unbestätigten Vorschlägen sind mit der neuen Regel wirkungslos.
update public.trip_proposals
   set remind_enabled = false
 where remind_enabled and confirmed_at is null;

create or replace function public.confirm_trip_proposal(
  p_list_id uuid,
  p_proposal_id uuid,
  p_confirmed_by text
)
returns jsonb
language plpgsql
security definer
set search_path to 'extensions', 'public'
as $function$
declare
  v_join_code text;
  v_day date;
  v_slot text;
begin
  select join_code into v_join_code from public.lists where id = p_list_id;
  if v_join_code is null or
     (current_setting('request.headers', true)::json ->> 'x-join-code') is distinct from v_join_code then
    return jsonb_build_object('error', 'Keine Berechtigung für diese Liste.');
  end if;

  select day, slot into v_day, v_slot
  from public.trip_proposals
  where id = p_proposal_id and list_id = p_list_id;

  if v_day is null then
    return jsonb_build_object('error', 'Vorschlag nicht gefunden.');
  end if;

  -- Alte Bestätigung desselben Slots lösen (Unique-Index greift sonst).
  update public.trip_proposals
     set confirmed_at = null, confirmed_by = null, remind_enabled = false
   where list_id = p_list_id
     and day = v_day
     and slot = v_slot
     and confirmed_at is not null
     and id <> p_proposal_id;

  update public.trip_proposals
     set confirmed_at = now(),
         confirmed_by = p_confirmed_by,
         -- Wecker hängt am Plan: mit der Bestätigung wird er scharf, sofern eine
         -- Los-Zeit hinterlegt ist. Ohne Los-Zeit bleibt er aus (kein Falschalarm).
         remind_enabled = (starts_at is not null)
   where id = p_proposal_id;

  -- Verlierer des Slots klingeln nicht.
  update public.trip_proposals
     set remind_enabled = false
   where list_id = p_list_id
     and day = v_day
     and slot = v_slot
     and id <> p_proposal_id
     and remind_enabled;

  return jsonb_build_object('ok', true);
end;
$function$;

-- Kontrolle:
--   select id, day, slot, starts_at, remind_enabled, confirmed_at is not null as fest
--     from trip_proposals order by day, slot;
