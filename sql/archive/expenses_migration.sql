-- Block 1: Tables
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  paid_by TEXT NOT NULL,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  split_mode TEXT NOT NULL DEFAULT 'equal' CHECK (split_mode IN ('equal', 'exact')),
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expense_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  person_name TEXT NOT NULL,
  share_amount NUMERIC(10,2) NOT NULL CHECK (share_amount >= 0),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Block 2: RLS (same pattern as items — join_code via request.headers)
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_splits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expenses_read_by_code" ON expenses;
DROP POLICY IF EXISTS "expenses_write_by_code" ON expenses;
DROP POLICY IF EXISTS "splits_read_by_code" ON expense_splits;
DROP POLICY IF EXISTS "splits_write_by_code" ON expense_splits;

CREATE POLICY "expenses_read_by_code" ON expenses
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = expenses.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  );

CREATE POLICY "expenses_write_by_code" ON expenses
  FOR ALL USING (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = expenses.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = expenses.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  );

CREATE POLICY "splits_read_by_code" ON expense_splits
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM expenses e
    JOIN lists l ON l.id = e.list_id
    WHERE e.id = expense_splits.expense_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  );

CREATE POLICY "splits_write_by_code" ON expense_splits
  FOR ALL USING (
    EXISTS (SELECT 1 FROM expenses e
    JOIN lists l ON l.id = e.list_id
    WHERE e.id = expense_splits.expense_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM expenses e
    JOIN lists l ON l.id = e.list_id
    WHERE e.id = expense_splits.expense_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  );

-- Block 3: Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE expenses;
ALTER PUBLICATION supabase_realtime ADD TABLE expense_splits;

-- Block 4: Verify
SELECT policyname FROM pg_policies WHERE tablename IN ('expenses', 'expense_splits');