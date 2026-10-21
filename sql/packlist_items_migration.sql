-- ─────────────────────────────────────────────────────────────────────
-- Personal Packing List ("Packliste") — packlist_items table
-- ─────────────────────────────────────────────────────────────────────
-- Each participant manages their OWN packing items, scoped by
-- participant_name. RLS uses the same x-join-code header pattern as all
-- other tables (see sql/005_bristol_modus.sql). Per-user visibility
-- (each user only sees their own items) is enforced CLIENT-SIDE by
-- filtering on participant_name — consistent with how the app handles
-- per-user data elsewhere (e.g. bristol_entries, shopping list
-- assigned_to). The RLS policies below allow read/write for anyone who
-- holds the list's join code; the client simply requests only the
-- rows belonging to the current userName.

-- ════════════════════════════════════════════════════════════════════
-- Block 1: Create table
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS packlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  participant_name TEXT NOT NULL,
  name TEXT NOT NULL,
  quantity TEXT,
  is_checked BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_packlist_items_list_id ON packlist_items(list_id);
CREATE INDEX IF NOT EXISTS idx_packlist_items_participant_name ON packlist_items(participant_name);

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════
-- Block 2: Enable RLS + read/write policies (x-join-code pattern)
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE packlist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "packlist_items_read_by_code" ON packlist_items;
CREATE POLICY "packlist_items_read_by_code" ON packlist_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = packlist_items.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  );

DROP POLICY IF EXISTS "packlist_items_write_by_code" ON packlist_items;
CREATE POLICY "packlist_items_write_by_code" ON packlist_items
  FOR ALL USING (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = packlist_items.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = packlist_items.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  );

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════
-- Block 3: Add to realtime publication
-- ════════════════════════════════════════════════════════════════════
ALTER PUBLICATION supabase_realtime ADD TABLE packlist_items;

NOTIFY pgrst, 'reload schema';