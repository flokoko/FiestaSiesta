-- 151_confirm_trip_proposal.sql
-- Angewendet auf aqmisgetzatbrvchbrkf am 2026-10-29 (Management-API).
--
-- Vorher setzte der Client die Bestätigung in ZWEI Statements: erst
-- `confirmed_at = null` für alle Vorschläge des Slots, dann `confirmed_at = now()`
-- für den neuen. Bricht die Verbindung dazwischen ab, bleibt der Slot ohne
-- Plan zurück; zwei gleichzeitige Clients konnten sich gegenseitig die
-- Bestätigung wegräumen. Jetzt eine Transaktion, serverseitig autorisiert.

CREATE OR REPLACE FUNCTION public.confirm_trip_proposal(
  p_list_id uuid,
  p_proposal_id uuid,
  p_confirmed_by text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'extensions', 'public'
AS $function$
DECLARE
  v_join_code TEXT;
  v_day date;
  v_slot text;
BEGIN
  -- Zugriffsschutz wie in sql/130: Join-Code im Header muss zur Liste passen.
  SELECT join_code INTO v_join_code FROM public.lists WHERE id = p_list_id;
  IF v_join_code IS NULL OR
     (current_setting('request.headers', true)::json ->> 'x-join-code') IS DISTINCT FROM v_join_code THEN
    RETURN jsonb_build_object('error', 'Keine Berechtigung für diese Liste.');
  END IF;

  SELECT day, slot INTO v_day, v_slot
  FROM public.trip_proposals
  WHERE id = p_proposal_id AND list_id = p_list_id;

  IF v_day IS NULL THEN
    RETURN jsonb_build_object('error', 'Vorschlag nicht gefunden.');
  END IF;

  -- Alte Bestätigung desselben Slots zuerst lösen (Unique-Index greift sonst),
  -- dann die neue setzen — beides in einer Transaktion.
  UPDATE public.trip_proposals
     SET confirmed_at = NULL, confirmed_by = NULL
   WHERE list_id = p_list_id
     AND day = v_day
     AND slot = v_slot
     AND confirmed_at IS NOT NULL
     AND id <> p_proposal_id;

  UPDATE public.trip_proposals
     SET confirmed_at = now(), confirmed_by = p_confirmed_by
   WHERE id = p_proposal_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;
