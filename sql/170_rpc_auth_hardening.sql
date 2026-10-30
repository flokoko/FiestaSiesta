-- 170_rpc_auth_hardening.sql
-- Angewendet auf aqmisgetzatbrvchbrkf am 2026-10-30 (Management-API).
--
-- Befund des Multi-Modell-Reviews vom 30.10.2026, live nachgewiesen:
--   * set_admin_password war für JEDEN mit dem öffentlichen anon-Key aufrufbar und
--     setzte lists.admin_password ohne Join-Code und ohne altes Passwort.
--     Live-Test: POST /rest/v1/rpc/set_admin_password {"p_list_id":"…","p_password":"…"}
--     -> true, admin_password danach bcrypt. Wer die Listen-UUID kennt, übernimmt Admin.
--   * change_admin_password, change_participant_password und verify_admin_password
--     prüften den x-join-code-Header ebenfalls nicht.
--   * rename_participant war doppelt kaputt: (a) ohne Guard, (b) legte erst eine neue
--     participants-Zeile an und löschte dann die alte — der Trigger
--     participants_limit_trigger (BEFORE INSERT, COUNT(*) >= 3) warf deshalb bei einer
--     vollen Liste (dem Normalzustand: 3 Personen) "Diese Reise ist voll".
--     Live nachgestellt mit einer Wegwerf-Liste. Außerdem fehlten vier Tabellen
--     (bristol_entries, packlist_items, trip_votes, trip_proposals.created_by).
--
-- Fix: gleiche Muster wie sql/130 und sql/150 — Guard gegen public.lists, search_path
-- festgenagelt, rename arbeitet mit UPDATE in place (gleiche id, kein Trigger, kein
-- Zeilen-Tanz). Der Client schickt den x-join-code ohnehin bei jedem Request
-- (customFetch in src/lib/supabase.ts), die App-Flows bleiben unverändert.

-- ── 1) rename_participant: Guard + UPDATE in place + alle Namens-Referenzen ──
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

  -- Nicht-Geld-Referenzen (fehlten vorher komplett)
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

  -- Urheber-Angaben (Attribution bleibt sonst unter dem alten Namen hängen)
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

-- ── 2) change_admin_password: Guard ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.change_admin_password(p_list_id uuid, p_old_password text, p_new_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'extensions', 'public'
AS $function$
DECLARE
  v_admin_password TEXT;
  v_join_code TEXT;
BEGIN
  SELECT join_code, admin_password INTO v_join_code, v_admin_password
    FROM lists WHERE id = p_list_id;

  IF v_join_code IS NULL OR
     (current_setting('request.headers', true)::json ->> 'x-join-code') IS DISTINCT FROM v_join_code THEN
    RETURN jsonb_build_object('error', 'Keine Berechtigung für diese Liste.');
  END IF;

  IF v_admin_password IS NULL THEN
    RETURN jsonb_build_object('error', 'Falsches Passwort.');
  END IF;

  -- Altes Passwort prüfen — bcrypt-Hash oder alter Klartext.
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

  UPDATE lists
     SET admin_password = crypt(p_new_password, gen_salt('bf', 10))
   WHERE id = p_list_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ── 3) set_admin_password: Guard (App-Flow bleibt: x-join-code ist immer im Header) ──
CREATE OR REPLACE FUNCTION public.set_admin_password(p_list_id uuid, p_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'extensions', 'public'
AS $function$
DECLARE
  v_join_code TEXT;
BEGIN
  SELECT join_code INTO v_join_code FROM lists WHERE id = p_list_id;

  IF v_join_code IS NULL OR
     (current_setting('request.headers', true)::json ->> 'x-join-code') IS DISTINCT FROM v_join_code THEN
    RETURN false;
  END IF;

  IF length(p_password) < 3 THEN
    RETURN false;
  END IF;

  UPDATE lists
     SET admin_password = crypt(p_password, gen_salt('bf', 10))
   WHERE id = p_list_id;

  RETURN FOUND;
END;
$function$;

-- ── 4) verify_admin_password: Guard (war ein Orakel ohne Berechtigungsprüfung) ──
CREATE OR REPLACE FUNCTION public.verify_admin_password(p_list_id uuid, p_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'extensions', 'public'
AS $function$
DECLARE
  v_admin_password TEXT;
  v_join_code TEXT;
BEGIN
  SELECT join_code, admin_password INTO v_join_code, v_admin_password
    FROM lists WHERE id = p_list_id;

  IF v_join_code IS NULL OR
     (current_setting('request.headers', true)::json ->> 'x-join-code') IS DISTINCT FROM v_join_code THEN
    RETURN false;
  END IF;

  IF v_admin_password IS NULL THEN
    RETURN false;
  END IF;

  IF v_admin_password LIKE '$2a$%' OR v_admin_password LIKE '$2b$%' THEN
    RETURN v_admin_password = crypt(p_password, v_admin_password);
  END IF;

  -- Alter Klartext: bei Erfolg direkt auf bcrypt heben.
  IF v_admin_password = p_password THEN
    UPDATE lists SET admin_password = crypt(p_password, gen_salt('bf', 10))
     WHERE id = p_list_id;
    RETURN true;
  END IF;

  RETURN false;
END;
$function$;

-- ── 5) change_participant_password: Guard über participant -> list ──
CREATE OR REPLACE FUNCTION public.change_participant_password(
  p_participant_id uuid, p_old_password text, p_new_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'extensions', 'public'
AS $function$
DECLARE
  v_participant RECORD;
  v_join_code TEXT;
BEGIN
  SELECT p.*, l.join_code AS list_join_code
    INTO v_participant
    FROM participants p JOIN lists l ON l.id = p.list_id
   WHERE p.id = p_participant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Teilnehmer nicht gefunden');
  END IF;

  v_join_code := v_participant.list_join_code;
  IF v_join_code IS NULL OR
     (current_setting('request.headers', true)::json ->> 'x-join-code') IS DISTINCT FROM v_join_code THEN
    RETURN jsonb_build_object('error', 'Keine Berechtigung für diese Liste.');
  END IF;

  -- Altes Passwort prüfen (alte SHA-256-Hashes und neue bcrypt-Hashes)
  IF v_participant.password_hash NOT LIKE '$2a$%' AND v_participant.password_hash NOT LIKE '$2b$%' THEN
    IF v_participant.password_hash != encode(digest(p_old_password::bytea, 'sha256'::text), 'hex') THEN
      RETURN jsonb_build_object('error', 'Altes Passwort falsch');
    END IF;
  ELSIF v_participant.password_hash != crypt(p_old_password, v_participant.password_hash) THEN
    RETURN jsonb_build_object('error', 'Altes Passwort falsch');
  END IF;

  IF length(p_new_password) < 3 THEN
    RETURN jsonb_build_object('error', 'Passwort muss mindestens 3 Zeichen lang sein.');
  END IF;

  UPDATE participants
     SET password_hash = crypt(p_new_password, gen_salt('bf', 10))
   WHERE id = p_participant_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;
