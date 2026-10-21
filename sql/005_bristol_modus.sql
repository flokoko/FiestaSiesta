-- Drop the deprecated shit_alerts table (feature removed)
DROP TABLE IF EXISTS shit_alerts CASCADE;

-- Block 1: Create tables
CREATE TABLE IF NOT EXISTS bristol_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  participant_name TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value >= 1 AND value <= 7),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint: one entry per person per day
ALTER TABLE bristol_entries DROP CONSTRAINT IF EXISTS bristol_entries_unique;
ALTER TABLE bristol_entries ADD CONSTRAINT bristol_entries_unique UNIQUE (list_id, participant_name, entry_date);

-- Block 2: Enable RLS
ALTER TABLE bristol_entries ENABLE ROW LEVEL SECURITY;

-- Block 3: RLS Policies (using join code header pattern like existing tables)
CREATE POLICY "bristol_entries_read_by_code" ON bristol_entries
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = bristol_entries.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  );

CREATE POLICY "bristol_entries_write_by_code" ON bristol_entries
  FOR ALL USING (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = bristol_entries.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = bristol_entries.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  );

-- Block 4: Verify
SELECT tablename, policyname FROM pg_policies WHERE tablename IN ('bristol_entries');