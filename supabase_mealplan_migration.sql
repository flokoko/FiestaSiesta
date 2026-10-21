-- Meal Planner tables
-- Run these in the Supabase Dashboard SQL Editor

-- Meals table (weekly plan entries)
CREATE TABLE IF NOT EXISTS meals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  day TEXT NOT NULL CHECK (day IN ('Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag')),
  meal_type TEXT NOT NULL CHECK (meal_type IN ('Frühstück','Mittagessen','Abendessen')),
  name TEXT NOT NULL,
  note TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Meal ideas table
CREATE TABLE IF NOT EXISTS meal_ideas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tags TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS Policies for meals (same x-join-code pattern as items)
ALTER TABLE meals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "meals_read_by_code" ON meals;
DROP POLICY IF EXISTS "meals_write_by_code" ON meals;
CREATE POLICY "meals_read_by_code" ON meals
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = meals.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  );
CREATE POLICY "meals_write_by_code" ON meals
  FOR ALL USING (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = meals.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = meals.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  );

-- RLS Policies for meal_ideas
ALTER TABLE meal_ideas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "meal_ideas_read_by_code" ON meal_ideas;
DROP POLICY IF EXISTS "meal_ideas_write_by_code" ON meal_ideas;
CREATE POLICY "meal_ideas_read_by_code" ON meal_ideas
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = meal_ideas.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  );
CREATE POLICY "meal_ideas_write_by_code" ON meal_ideas
  FOR ALL USING (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = meal_ideas.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM lists l WHERE l.id = meal_ideas.list_id
    AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code'))
  );

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE meals;
ALTER PUBLICATION supabase_realtime ADD TABLE meal_ideas;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';