-- ═══════════════════════════════════════════════════════════════════
-- 120_participant_admin_fixes.sql
-- Phase 1 — Daten & Korrektheit (Server + Einstellungen)
--
-- 1. rename_participant   (ersetzt die Fassung aus sql/rename_participant.sql)
--    Fixes:
--      * expense_splits-UPDATE hatte KEINEN Listenfilter → fremde Listen
--        wurden mit umbenannt. Jetzt: expense_id → expenses.list_id.
--      * settlements.payer/payee und expense_quotas.person_name wurden
--        nicht umbenannt → jetzt mit list_id-Filter aktualisiert.
--      * is_admin (und password_hash) des alten Participants ging verloren
--        → werden in den neuen kopiert.
--      * RPC liefert jetzt die ID des neuen Participants zurück.
-- 2. delete_participant   (sicher statt korrumpierend)
-- 3. change_admin_password (bcrypt wie set_admin_password / verify_admin_password)
--
-- Idempotent: CREATE OR REPLACE. Am Stück im SQL-Editor ausführbar.
-- ═══════════════════════════════════════════════════════════════════

-- pgcrypto für bcrypt (crypt/gen_salt) — idempotent
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. Teilnehmer umbenennen ────────────────────────────────────────
CREATE OR REPLACE FUNCTION rename_participant(
  p_list_id UUID,
  p_old_name TEXT,
  p_new_name TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = extensions, public
AS $$
DECLARE
  v_old RECORD;
  v_new_id UUID;
BEGIN
  -- Neuer Name darf nicht bereits existieren (case-insensitive)
  IF EXISTS (
    SELECT 1 FROM participants
    WHERE list_id = p_list_id AND LOWER(name) = LOWER(p_new_name)
  ) THEN
    RETURN jsonb_build_object('error', 'Dieser Name wird bereits verwendet.');
  END IF;

  -- Alten Participant laden (is_admin + password_hash für den neuen übernehmen)
  SELECT * INTO v_old
  FROM participants
  WHERE list_id = p_list_id AND name = p_old_name;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Teilnehmer nicht gefunden.');
  END IF;

  -- Neuen Participant mit übernommenen Rechten anlegen
  INSERT INTO participants (list_id, name, is_admin, password_hash)
  VALUES (p_list_id, p_new_name, v_old.is_admin, v_old.password_hash)
  RETURNING id INTO v_new_id;

  -- Referenzen aktualisieren — jede mit Listenfilter, damit fremde Listen
  -- unberührt bleiben.
  UPDATE expenses
    SET paid_by = p_new_name
    WHERE list_id = p_list_id AND paid_by = p_old_name;

  UPDATE items
    SET assigned_to = p_new_name
    WHERE list_id = p_list_id AND assigned_to = p_old_name;

  -- expense_splits hat keine eigene list_id → über die zugehörige Ausgabe
  UPDATE expense_splits
    SET person_name = p_new_name
    WHERE person_name = p_old_name
      AND expense_id IN (SELECT id FROM expenses WHERE list_id = p_list_id);

  UPDATE settlements
    SET payer = p_new_name
    WHERE list_id = p_list_id AND payer = p_old_name;

  UPDATE settlements
    SET payee = p_new_name
    WHERE list_id = p_list_id AND payee = p_old_name;

  UPDATE expense_quotas
    SET person_name = p_new_name
    WHERE list_id = p_list_id AND person_name = p_old_name;

  -- Alten Participant löschen
  DELETE FROM participants
  WHERE list_id = p_list_id AND name = p_old_name;

  RETURN jsonb_build_object('success', true, 'participant_id', v_new_id);
END;
$$;

-- ── 2. Teilnehmer löschen (sicher statt korrumpierend) ─────────────
CREATE OR REPLACE FUNCTION delete_participant(
  p_list_id UUID,
  p_name TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = extensions, public
AS $$
DECLARE
  v_expense_count INTEGER;
  v_split_count INTEGER;
  v_settlement_count INTEGER;
BEGIN
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

  -- Participant-Zeile löschen
  DELETE FROM participants
  WHERE list_id = p_list_id AND name = p_name;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ── 3. Admin-Passwort ändern (bcrypt wie set/verify_admin_password) ─
CREATE OR REPLACE FUNCTION change_admin_password(
  p_list_id UUID,
  p_old_password TEXT,
  p_new_password TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = extensions, public
AS $$
DECLARE
  v_admin_password TEXT;
BEGIN
  SELECT admin_password INTO v_admin_password
  FROM lists WHERE id = p_list_id;

  IF v_admin_password IS NULL THEN
    RETURN jsonb_build_object('error', 'Falsches Passwort.');
  END IF;

  -- Altes Passwort prüfen — gleiches Verfahren wie verify_admin_password
  -- (bcrypt-Hash oder alter Klartext).
  IF v_admin_password LIKE '$2a$%' OR v_admin_password LIKE '$2b$%' THEN
    IF v_admin_password != crypt(p_old_password, v_admin_password) THEN
      RETURN jsonb_build_object('error', 'Falsches Passwort.');
    END IF;
  ELSE
    IF v_admin_password != p_old_password THEN
      RETURN jsonb_build_object('error', 'Falsches Passwort.');
    END IF;
  END IF;

  IF length(p_new_password) < 3 THEN
    RETURN jsonb_build_object('error', 'Passwort muss mindestens 3 Zeichen lang sein.');
  END IF;

  -- Neues Passwort bcrypt-hashen — exakt wie set_admin_password
  UPDATE lists
  SET admin_password = crypt(p_new_password, gen_salt('bf', 10))
  WHERE id = p_list_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

NOTIFY pgrst, 'reload schema';
