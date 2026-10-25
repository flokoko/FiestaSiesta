-- 130_delete_participant_cleanup.sql
-- Applied to project aqmisgetzatbrvchbrkf on 2026-10-25 (via Management API).
--
-- 1) delete_participant räumt jetzt auch die Referenzen auf, die NICHT Geld sind:
--    trip_votes.voter, bristol_entries.participant_name, items.assigned_to,
--    packlist_items.participant_name. Vorher blieben Stimmen eines gelöschten
--    Teilnehmers stehen und beeinflussten weiter den Gewinner des Reiseplans.
-- 2) delete_participant prüft zusätzlich den x-join-code-Header (SECURITY DEFINER
--    umgeht RLS; ohne diesen Abgleich wäre die Funktion allein über die list_id
--    aufrufbar). Muster wie in sql/112_restore_session_join_code.sql.
-- 3) Trigger: harte Servergrenze von 3 Teilnehmern pro Liste. login_participant
--    prüft das schon, der direkte Insert aus den Einstellungen (Admin legt Platz
--    für einen Freund an) umging die Grenze bisher komplett.

CREATE OR REPLACE FUNCTION public.delete_participant(p_list_id uuid, p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'extensions', 'public'
AS $function$
DECLARE
  v_expense_count INTEGER;
  v_split_count INTEGER;
  v_settlement_count INTEGER;
  v_join_code TEXT;
BEGIN
  -- Zugriffsschutz: der Join-Code im Header muss zur Liste gehören.
  SELECT join_code INTO v_join_code FROM lists WHERE id = p_list_id;
  IF v_join_code IS NULL OR
     (current_setting('request.headers', true)::json ->> 'x-join-code') IS DISTINCT FROM v_join_code THEN
    RETURN jsonb_build_object('error', 'Keine Berechtigung für diese Liste.');
  END IF;

  -- Geld-Referenzen zählen: bezahlte Ausgaben, Split-Zeilen, Settlement-Zeilen
  SELECT COUNT(*) INTO v_expense_count
  FROM expenses
  WHERE list_id = p_list_id AND paid_by = p_name;

  SELECT COUNT(*) INTO v_split_count
  FROM expense_splits
  WHERE person_name = p_name
    AND expense_id IN (SELECT id FROM expenses WHERE list_id = p_list_id);

  SELECT COUNT(*) INTO v_settlement_count
  FROM settlements
  WHERE list_id = p_list_id AND (payer = p_name OR payee = p_name);

  -- Noch offene Geldbezüge → nicht löschen, Hinweis zurückgeben
  IF v_expense_count > 0 OR v_split_count > 0 OR v_settlement_count > 0 THEN
    RETURN jsonb_build_object(
      'error',
      p_name || ' hat noch ' || v_expense_count || ' Ausgaben, '
        || v_split_count || ' Aufteilungen und '
        || v_settlement_count
        || ' offene Zahlungen. Erst Ausgaben löschen oder umbuchen.'
    );
  END IF;

  -- Quoten der Person löschen (kein Geld-Blocker, nur Stammdaten)
  DELETE FROM expense_quotas
  WHERE list_id = p_list_id AND person_name = p_name;

  -- Reiseplan: Stimmen der Person entfernen, sonst zählen sie weiter für den Gewinner
  DELETE FROM trip_votes
  WHERE list_id = p_list_id AND voter = p_name;

  -- Bristol-Tagebuch: Einträge der Person entfernen (persönliche Daten)
  DELETE FROM bristol_entries
  WHERE list_id = p_list_id AND participant_name = p_name;

  -- Persönliche Packliste: Zeilen der Person entfernen
  DELETE FROM packlist_items
  WHERE list_id = p_list_id AND participant_name = p_name;

  -- Zuweisungen aufheben, Daten bleiben erhalten
  UPDATE items
  SET assigned_to = NULL
  WHERE list_id = p_list_id AND assigned_to = p_name;

  -- Participant-Zeile löschen
  DELETE FROM participants
  WHERE list_id = p_list_id AND name = p_name;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Servergrenze: maximal 3 Teilnehmer pro Liste (die Reise hat drei Personen).
CREATE OR REPLACE FUNCTION public.enforce_participant_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF (SELECT COUNT(*) FROM participants WHERE list_id = NEW.list_id) >= 3 THEN
    RAISE EXCEPTION 'Diese Reise ist voll (maximal 3 Personen)';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS participants_limit_trigger ON public.participants;
CREATE TRIGGER participants_limit_trigger
  BEFORE INSERT ON public.participants
  FOR EACH ROW EXECUTE FUNCTION public.enforce_participant_limit();

-- Rechte wie bei den übrigen RPCs
GRANT EXECUTE ON FUNCTION public.delete_participant(uuid, text) TO anon, authenticated;
