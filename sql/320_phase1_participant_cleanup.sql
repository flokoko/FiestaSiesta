-- 320_phase1_participant_cleanup.sql
-- Review r8, Phase 1 (19.11.2026). Idempotent, kann mehrfach laufen.
--
-- 1) rename_participant zieht jetzt auch die Namens-Referenzen nach, die seit
--    v0.61/v0.63 dazukamen: trip_comments.author (Kommentare an Vorschlaegen)
--    und quiz_runs.participant (Leaderboard gruppiert nach Namen). Ohne das
--    stehen nach einer Umbenennung Kommentare und Quiz-Laeufe unter dem alten
--    Namen — zwei Leaderboard-Zeilen fuer dieselbe Person.
-- 2) delete_participant raeumt trip_comments und quiz_runs der Person mit auf
--    (quiz_answers haengt per FK cascade an quiz_runs).
-- Beide Funktionen behalten Guard + search_path unveraendert.

-- ── 1) rename_participant ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rename_participant(p_list_id uuid, p_old_name text, p_new_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'extensions', 'public'
AS $function$
DECLARE
  v_join_code TEXT;
  v_trimmed   TEXT := btrim(p_new_name);
  v_id        UUID;
BEGIN
  -- Zugriffsschutz: der Join-Code im Header muss zur Liste gehören.
  SELECT join_code INTO v_join_code FROM lists WHERE id = p_list_id;
  IF v_join_code IS NULL OR
     (current_setting('request.headers', true)::json ->> 'x-join-code') IS DISTINCT FROM v_join_code THEN
    RETURN jsonb_build_object('error', 'Keine Berechtigung für diese Liste.');
  END IF;

  IF v_trimmed IS NULL OR length(v_trimmed) = 0 THEN
    RETURN jsonb_build_object('error', 'Name darf nicht leer sein.');
  END IF;

  -- Neuer Name darf nicht bereits existieren (case-insensitive)
  IF EXISTS (
    SELECT 1 FROM participants
    WHERE list_id = p_list_id AND LOWER(name) = LOWER(v_trimmed)
  ) THEN
    RETURN jsonb_build_object('error', 'Dieser Name wird bereits verwendet.');
  END IF;

  -- UPDATE in place: gleiche participant_id, kein INSERT, damit der
  -- participants_limit_trigger nicht feuert (er zählt VOR dem Insert).
  UPDATE participants
     SET name = v_trimmed
   WHERE list_id = p_list_id AND name = p_old_name
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Teilnehmer nicht gefunden.');
  END IF;

  -- Geld-Referenzen
  UPDATE expenses SET paid_by = v_trimmed
   WHERE list_id = p_list_id AND paid_by = p_old_name;
  UPDATE items SET assigned_to = v_trimmed
   WHERE list_id = p_list_id AND assigned_to = p_old_name;
  UPDATE expense_splits SET person_name = v_trimmed
   WHERE person_name = p_old_name
     AND expense_id IN (SELECT id FROM expenses WHERE list_id = p_list_id);
  UPDATE settlements SET payer = v_trimmed
   WHERE list_id = p_list_id AND payer = p_old_name;
  UPDATE settlements SET payee = v_trimmed
   WHERE list_id = p_list_id AND payee = p_old_name;
  UPDATE expense_quotas SET person_name = v_trimmed
   WHERE list_id = p_list_id AND person_name = p_old_name;

  -- Nicht-Geld-Referenzen
  UPDATE bristol_entries SET participant_name = v_trimmed
   WHERE list_id = p_list_id AND participant_name = p_old_name;
  UPDATE packlist_items SET participant_name = v_trimmed
   WHERE list_id = p_list_id AND participant_name = p_old_name;
  UPDATE trip_votes SET voter = v_trimmed
   WHERE list_id = p_list_id AND voter = p_old_name;
  UPDATE trip_proposals SET created_by = v_trimmed
   WHERE list_id = p_list_id AND created_by = p_old_name;
  UPDATE trip_proposals SET confirmed_by = v_trimmed
   WHERE list_id = p_list_id AND confirmed_by = p_old_name;

  -- Seit v0.61/v0.63 neu: Kommentare und Quiz-Laeufe tragen den Namen ebenfalls.
  UPDATE trip_comments SET author = v_trimmed
   WHERE list_id = p_list_id AND author = p_old_name;
  UPDATE quiz_runs SET participant = v_trimmed
   WHERE list_id = p_list_id AND participant = p_old_name;
  UPDATE recipes SET created_by = v_trimmed
   WHERE list_id = p_list_id AND created_by = p_old_name;

  -- Urheber-Angaben
  UPDATE items SET created_by = v_trimmed
   WHERE list_id = p_list_id AND created_by = p_old_name;
  UPDATE notes SET created_by = v_trimmed
   WHERE list_id = p_list_id AND created_by = p_old_name;
  UPDATE expenses SET created_by = v_trimmed
   WHERE list_id = p_list_id AND created_by = p_old_name;
  UPDATE settlements SET created_by = v_trimmed
   WHERE list_id = p_list_id AND created_by = p_old_name;

  RETURN jsonb_build_object('success', true, 'participant_id', v_id);
END;
$function$;

-- ── 2) delete_participant ────────────────────────────────────────────
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

  -- Kommentare an Vorschlägen: sonst bleiben Geister-Kommentare eines
  -- gelöschten Teilnehmers stehen (Name hängt als Text, kein FK).
  DELETE FROM trip_comments
  WHERE list_id = p_list_id AND author = p_name;

  -- Quiz-Läufe: Leaderboard gruppiert nach Namen; quiz_answers hängt cascade.
  DELETE FROM quiz_runs
  WHERE list_id = p_list_id AND participant = p_name;

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

GRANT EXECUTE ON FUNCTION public.rename_participant(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_participant(uuid, text) TO anon, authenticated;
