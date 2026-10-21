-- Quick Notes table
CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  title TEXT,
  content TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS Policies (same x-join-code pattern)
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notes_read_by_code" ON notes;
DROP POLICY IF EXISTS "notes_write_by_code" ON notes;
CREATE POLICY "notes_read_by_code" ON notes
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = notes.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  );
CREATE POLICY "notes_write_by_code" ON notes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = notes.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = notes.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  );

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE notes;
NOTIFY pgrst, 'reload schema';