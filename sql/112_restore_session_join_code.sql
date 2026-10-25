CREATE OR REPLACE FUNCTION public.restore_participant_session(p_participant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'extensions', 'public'
AS $function$
DECLARE
  v_participant_id UUID;
  v_participant_name TEXT;
  v_participant_is_admin BOOLEAN;
  v_participant_list_id UUID;
  v_list_name TEXT;
  v_list_join_code TEXT;
  v_header_join_code TEXT;
BEGIN
  -- Der Join-Code kommt als x-join-code-Header (wie bei allen RLS-Policies).
  -- Ohne diesen Abgleich war die RPC allein durch die Kenntnis einer
  -- participant_id (Klartext in localStorage) nutzbar: sie lieferte list_id,
  -- join_code, Name und is_admin ohne jede weitere Prüfung.
  v_header_join_code := (current_setting('request.headers', true)::json ->> 'x-join-code');

  SELECT p.id, p.name, p.is_admin, p.list_id, l.name, l.join_code
  INTO v_participant_id, v_participant_name, v_participant_is_admin,
       v_participant_list_id, v_list_name, v_list_join_code
  FROM participants p
  JOIN lists l ON l.id = p.list_id
  WHERE p.id = p_participant_id
    AND l.join_code = v_header_join_code;

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
$function$;
