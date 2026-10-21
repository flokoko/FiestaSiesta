-- ═══════════════════════════════════════════════════════════════════
-- Expense Quotas Migration — Prozentuale Aufteilung pro Kategorie
-- Einzeln als Blöcke ausführbar. Jeder Block endet mit NOTIFY.
-- ═══════════════════════════════════════════════════════════════════

-- ── Block 1: CREATE TABLE ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  person_name TEXT NOT NULL,
  percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (percent >= 0 AND percent <= 100),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(list_id, category, person_name)
);

-- Index für schnelle Lookups pro Liste + Kategorie
CREATE INDEX IF NOT EXISTS idx_expense_quotas_list_cat ON expense_quotas(list_id, category);

NOTIFY pgrst, 'reload schema';

-- ── Block 2: RLS + Policies ────────────────────────────────────────
ALTER TABLE expense_quotas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expense_quotas_read_by_code" ON expense_quotas;
DROP POLICY IF EXISTS "expense_quotas_write_by_code" ON expense_quotas;
DROP POLICY IF EXISTS "expense_quotas_update_by_code" ON expense_quotas;
DROP POLICY IF EXISTS "expense_quotas_delete_by_code" ON expense_quotas;

CREATE POLICY "expense_quotas_read_by_code" ON expense_quotas
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = expense_quotas.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  );

CREATE POLICY "expense_quotas_write_by_code" ON expense_quotas
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = expense_quotas.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  );

CREATE POLICY "expense_quotas_update_by_code" ON expense_quotas
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = expense_quotas.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = expense_quotas.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  );

CREATE POLICY "expense_quotas_delete_by_code" ON expense_quotas
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = expense_quotas.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  );

NOTIFY pgrst, 'reload schema';

-- ── Block 3: Realtime ──────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE expense_quotas;

NOTIFY pgrst, 'reload schema';

-- ── Block 4: Verify ────────────────────────────────────────────────
SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename = 'expense_quotas';
SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'expense_quotas';

NOTIFY pgrst, 'reload schema';