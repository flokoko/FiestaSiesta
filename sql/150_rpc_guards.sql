-- 150_rpc_guards.sql
-- Angewendet auf aqmisgetzatbrvchbrkf am 2026-10-28 (Management-API).
--
-- Befund des Multi-Modell-Reviews: vier SECURITY-DEFINER-RPCs liefen ohne jede
-- Berechtigungsprüfung. Mit dem öffentlichen anon-Key aus dem Bundle war
--   POST /rest/v1/rpc/batch_delete_items {"item_ids":[]}  ->  204
-- möglich, also Löschen beliebiger items/notes ALLER Listen des Projekts
-- (SECURITY DEFINER umgeht RLS vollständig). Dazu kam `verify_join_code` als
-- Orakel, das zu einem Code die list_id liefert.
--
-- Fix: jede Funktion prüft jetzt selbst den x-join-code-Header gegen
-- public.lists (gleiches Muster wie delete_participant in sql/130) und
-- arbeitet ausschließlich auf Zeilen der eigenen Liste. Zusätzlich
-- search_path festnageln (Search-Path-Hijacking bei SECURITY DEFINER).
-- verify_join_code wird für Clients gesperrt — die App nutzt es nicht.

-- ── 1) batch_delete_items ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.batch_delete_items(item_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  DELETE FROM public.items i
   USING public.lists l
   WHERE i.id = ANY(item_ids)
     AND l.id = i.list_id
     AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code');
$function$;

-- ── 2) batch_reorder_items ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.batch_reorder_items(item_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.items i
     SET sort_order = new.sort_order
    FROM (SELECT unnest(item_ids) AS id,
                 generate_subscripts(item_ids, 1) - 1 AS sort_order) AS new,
         public.lists l
   WHERE i.id = new.id
     AND l.id = i.list_id
     AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code');
$function$;

-- ── 3) batch_reorder_notes ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.batch_reorder_notes(note_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.notes n
     SET sort_order = new.sort_order
    FROM (SELECT unnest(note_ids) AS id,
                 generate_subscripts(note_ids, 1) - 1 AS sort_order) AS new,
         public.lists l
   WHERE n.id = new.id
     AND l.id = n.list_id
     AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code');
$function$;

-- ── 4) batch_reorder_categories ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.batch_reorder_categories(category_data jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  rec JSONB;
  v_code TEXT := (current_setting('request.headers', true)::json ->> 'x-join-code');
BEGIN
  FOR rec IN SELECT * FROM jsonb_array_elements(category_data) LOOP
    UPDATE public.categories c
       SET sort_order = (rec->>'sort_order')::INT
      FROM public.lists l
     WHERE c.id = (rec->>'id')::UUID
       AND l.id = c.list_id
       AND l.join_code = v_code;
  END LOOP;
END;
$function$;

-- ── 5) toggle_note_favorite ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.toggle_note_favorite(note_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_value BOOLEAN;
BEGIN
  UPDATE public.notes n
     SET is_favorite = NOT n.is_favorite
    FROM public.lists l
   WHERE n.id = note_id
     AND l.id = n.list_id
     AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code')
  RETURNING n.is_favorite INTO new_value;

  IF new_value IS NULL THEN
    RAISE EXCEPTION 'Notiz nicht gefunden' USING ERRCODE = '42501';
  END IF;
  RETURN new_value;
END;
$function$;

-- ── 6) verify_join_code für Clients sperren (Orakel) ─────────────────
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'verify_join_code'
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.verify_join_code(text) FROM PUBLIC, anon, authenticated';
    EXECUTE 'ALTER FUNCTION public.verify_join_code(text) SET search_path TO ''public''';
  END IF;
END;
$do$;

-- ── 7) Fehlende Indizes (Review-Optimierung, alle Filter laufen über list_id) ──
CREATE INDEX IF NOT EXISTS idx_items_list_id           ON public.items (list_id);
CREATE INDEX IF NOT EXISTS idx_notes_list_id           ON public.notes (list_id);
CREATE INDEX IF NOT EXISTS idx_expenses_list_id        ON public.expenses (list_id);
CREATE INDEX IF NOT EXISTS idx_expense_splits_expense  ON public.expense_splits (expense_id);
CREATE INDEX IF NOT EXISTS idx_trip_votes_list_id      ON public.trip_votes (list_id);
