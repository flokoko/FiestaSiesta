-- ═══════════════════════════════════════════════════════════════
-- Bella Mozzarella: Benutzername + Passwort statt Join-Code
-- ═══════════════════════════════════════════════════════════════
-- Im Supabase Dashboard → SQL Editor → New Query → dies ausführen
-- ═══════════════════════════════════════════════════════════════

-- 0. pgcrypto Extension aktivieren (für bcrypt/crypt)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. password_hash Spalte zu participants hinzufügen
ALTER TABLE participants ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- 2. Login-RPC: Benutzername + Passwort → prüft/erstellt Teilnehmer
CREATE OR REPLACE FUNCTION login_participant(
  p_join_code TEXT,
  p_name TEXT,
  p_password TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = extensions, public
AS $$
DECLARE
  v_list RECORD;
  v_participant RECORD;
  v_password_hash TEXT;
  v_is_new BOOLEAN := false;
BEGIN
  -- Liste anhand des internen Join-Codes finden
  SELECT id, name, join_code, admin_password INTO v_list
  FROM lists WHERE UPPER(join_code) = UPPER(p_join_code);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Liste nicht gefunden');
  END IF;

  -- Teilnehmer suchen (case-insensitive)
  SELECT * INTO v_participant
  FROM participants
  WHERE list_id = v_list.id AND LOWER(name) = LOWER(p_name);

  IF NOT FOUND THEN
    -- Neuer Teilnehmer: Maximal 14 prüfen
    IF (SELECT COUNT(*) FROM participants WHERE list_id = v_list.id) >= 14 THEN
      RETURN jsonb_build_object('error', 'Maximum von 14 Teilnehmern erreicht');
    END IF;

    -- Mit Initial-Passwort anlegen
    v_password_hash := crypt(p_password, gen_salt('bf', 10));
    INSERT INTO participants (list_id, name, password_hash, is_admin)
    VALUES (
      v_list.id,
      p_name,
      v_password_hash,
      (SELECT COUNT(*) FROM participants WHERE list_id = v_list.id) = 0
    )
    RETURNING * INTO v_participant;
    v_is_new := true;
  ELSE
    -- Existierender Teilnehmer: Passwort prüfen
    IF v_participant.password_hash IS NULL OR v_participant.password_hash = '' THEN
      -- Erstes Login: Passwort setzen (bcrypt)
      v_password_hash := crypt(p_password, gen_salt('bf', 10));
      UPDATE participants SET password_hash = v_password_hash
      WHERE id = v_participant.id;
    ELSIF v_participant.password_hash NOT LIKE '$2a$%' AND v_participant.password_hash NOT LIKE '$2b$%' THEN
      -- Alter SHA-256 Hash (vor bcrypt-Migration)
      IF v_participant.password_hash = encode(digest(p_password::bytea, 'sha256'::text), 'hex') THEN
        -- Korrekt! Upgrade auf bcrypt
        v_password_hash := crypt(p_password, gen_salt('bf', 10));
        UPDATE participants SET password_hash = v_password_hash
        WHERE id = v_participant.id;
      ELSE
        RETURN jsonb_build_object('error', 'Falsches Passwort');
      END IF;
    ELSIF v_participant.password_hash != crypt(p_password, v_participant.password_hash) THEN
      RETURN jsonb_build_object('error', 'Falsches Passwort');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'list_id', v_list.id,
    'list_name', v_list.name,
    'join_code', v_list.join_code,
    'participant_id', v_participant.id,
    'participant_name', v_participant.name,
    'is_admin', v_participant.is_admin,
    'is_new', v_is_new
  );
END;
$$;

-- 3. Passwort ändern RPC
CREATE OR REPLACE FUNCTION change_participant_password(
  p_participant_id UUID,
  p_old_password TEXT,
  p_new_password TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = extensions, public
AS $$
DECLARE
  v_participant RECORD;
  v_old_hash TEXT;
  v_new_hash TEXT;
BEGIN
  SELECT * INTO v_participant FROM participants WHERE id = p_participant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Teilnehmer nicht gefunden');
  END IF;

  -- Prüfe altes Passwort (unterstützt alte SHA-256 und neue bcrypt Hashes)
  IF v_participant.password_hash NOT LIKE '$2a$%' AND v_participant.password_hash NOT LIKE '$2b$%' THEN
    -- Alter SHA-256 Hash
    IF v_participant.password_hash != encode(digest(p_old_password::bytea, 'sha256'::text), 'hex') THEN
      RETURN jsonb_build_object('error', 'Altes Passwort falsch');
    END IF;
  ELSIF v_participant.password_hash != crypt(p_old_password, v_participant.password_hash) THEN
    RETURN jsonb_build_object('error', 'Altes Passwort falsch');
  END IF;

  IF length(p_new_password) < 3 THEN
    RETURN jsonb_build_object('error', 'Passwort muss mindestens 3 Zeichen lang sein');
  END IF;

  v_new_hash := crypt(p_new_password, gen_salt('bf', 10));
  UPDATE participants SET password_hash = v_new_hash WHERE id = p_participant_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 4. Session-Wiederherstellung RPC
CREATE OR REPLACE FUNCTION restore_participant_session(
  p_participant_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = extensions, public
AS $$
DECLARE
  v_participant_id UUID;
  v_participant_name TEXT;
  v_participant_is_admin BOOLEAN;
  v_participant_list_id UUID;
  v_list_name TEXT;
  v_list_join_code TEXT;
BEGIN
  SELECT p.id, p.name, p.is_admin, p.list_id, l.name, l.join_code
  INTO v_participant_id, v_participant_name, v_participant_is_admin,
       v_participant_list_id, v_list_name, v_list_join_code
  FROM participants p
  JOIN lists l ON l.id = p.list_id
  WHERE p.id = p_participant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Session nicht gefunden');
  END IF;

  RETURN jsonb_build_object(
    'list_id', v_participant_list_id,
    'list_name', v_list_name,
    'join_code', v_list_join_code,
    'participant_id', v_participant_id,
    'participant_name', v_participant_name,
    'is_admin', v_participant_is_admin
  );
END;
$$;

-- 5. Schema-Cache neu laden
NOTIFY pgrst, 'reload schema';
