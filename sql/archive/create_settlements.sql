-- ═══════════════════════════════════════════════════════════════════
-- Settlements — "Schulden begleichen" (persisted settlement payments)
-- Einzeln als Blöcke ausführbar. Jeder Block endet mit NOTIFY.
-- ═══════════════════════════════════════════════════════════════════

-- ── Block 1: CREATE TABLE + ENABLE RLS ──────────────────────────────
-- Hinweis: Ein "tables without RLS" Warning ist hier erwartet und harmlos —
-- die Policies werden im nächsten Block erstellt.
CREATE TABLE IF NOT EXISTS settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  payer TEXT NOT NULL,
  payee TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  settled_at DATE NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- ── Block 2: RLS Policies ───────────────────────────────────────────
-- verify_list_access als SECURITY DEFINER (gleicher Trick wie categories)
-- nur anlegen, falls sie noch nicht existiert.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'verify_list_access') THEN
    CREATE FUNCTION verify_list_access(
      p_list_id UUID,
      p_join_code TEXT
    ) RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $sql$
      SELECT EXISTS(
        SELECT 1 FROM lists
        WHERE id = p_list_id AND UPPER(join_code) = UPPER(p_join_code)
      );
    $sql$;
  END IF;
END $$;

DROP POLICY IF EXISTS "settlements_read_by_code" ON settlements;
DROP POLICY IF EXISTS "settlements_insert_by_code" ON settlements;
DROP POLICY IF EXISTS "settlements_update_by_code" ON settlements;
DROP POLICY IF EXISTS "settlements_delete_by_code" ON settlements;

CREATE POLICY "settlements_read_by_code" ON settlements
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = settlements.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  );

CREATE POLICY "settlements_insert_by_code" ON settlements
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = settlements.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  );

CREATE POLICY "settlements_update_by_code" ON settlements
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = settlements.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = settlements.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  );

CREATE POLICY "settlements_delete_by_code" ON settlements
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = settlements.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  );

NOTIFY pgrst, 'reload schema';

-- ── Block 3: Realtime ────────────────────────────────────────────────
-- "already member of publication" ist harmlos und kann ignoriert werden.
ALTER PUBLICATION supabase_realtime ADD TABLE settlements;

NOTIFY pgrst, 'reload schema';

-- ── Block 4: Verify ──────────────────────────────────────────────────
SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename = 'settlements';
SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'settlements';

NOTIFY pgrst, 'reload schema';