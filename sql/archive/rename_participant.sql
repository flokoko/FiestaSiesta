-- Teilnehmer umbenennen: atomare Transaktion
CREATE OR REPLACE FUNCTION rename_participant(
  p_list_id UUID,
  p_old_name TEXT,
  p_new_name TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = extensions, public
AS $$
DECLARE
  v_old_participant_id UUID;
BEGIN
  -- Prüfen ob neuer Name bereits existiert
  IF EXISTS (SELECT 1 FROM participants WHERE list_id = p_list_id AND LOWER(name) = LOWER(p_new_name)) THEN
    RETURN jsonb_build_object('error', 'Dieser Name wird bereits verwendet.');
  END IF;

  BEGIN
    -- 1. Neuen Participant inserten
    INSERT INTO participants (list_id, name)
    VALUES (p_list_id, p_new_name)
    RETURNING id INTO v_old_participant_id;

    -- 2. Referenzen updaten
    UPDATE expenses SET paid_by = p_new_name WHERE list_id = p_list_id AND paid_by = p_old_name;
    UPDATE items SET assigned_to = p_new_name WHERE list_id = p_list_id AND assigned_to = p_old_name;
    UPDATE expense_splits SET person_name = p_new_name WHERE person_name = p_old_name;

    -- 3. Alten Participant löschen
    DELETE FROM participants WHERE list_id = p_list_id AND name = p_old_name;

    RETURN jsonb_build_object('success', true);
  EXCEPTION WHEN OTHERS THEN
    -- Bei Fehler: neuen Participant löschen falls er schon existiert
    DELETE FROM participants WHERE list_id = p_list_id AND name = p_new_name;
    RETURN jsonb_build_object('error', 'Fehler beim Umbenennen: ' || SQLERRM);
  END;
END;
$$;