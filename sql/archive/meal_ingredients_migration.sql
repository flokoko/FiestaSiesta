-- Meal ingredients table (per-meal ingredient list for shopping list export)
-- Run these blocks individually in the Supabase Dashboard SQL Editor.
-- Each block is self-contained and ends with NOTIFY pgrst, 'reload schema'.

-- ── Block 1: Create table ──
CREATE TABLE IF NOT EXISTS meal_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id UUID NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Prevent duplicate ingredient names per meal
CREATE UNIQUE INDEX IF NOT EXISTS meal_ingredients_meal_id_name_key
  ON meal_ingredients (meal_id, name);

-- Fast lookup by meal
CREATE INDEX IF NOT EXISTS meal_ingredients_meal_id_idx
  ON meal_ingredients (meal_id);

NOTIFY pgrst, 'reload schema';

-- ── Block 2: Enable RLS + policies (x-join-code pattern) ──
ALTER TABLE meal_ingredients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meal_ingredients_read_by_code" ON meal_ingredients;
DROP POLICY IF EXISTS "meal_ingredients_write_by_code" ON meal_ingredients;

CREATE POLICY "meal_ingredients_read_by_code" ON meal_ingredients
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM lists l
      JOIN meals m ON m.id = meal_ingredients.meal_id
      WHERE l.id = m.list_id
      AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code')
    )
  );

CREATE POLICY "meal_ingredients_write_by_code" ON meal_ingredients
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM lists l
      JOIN meals m ON m.id = meal_ingredients.meal_id
      WHERE l.id = m.list_id
      AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM lists l
      JOIN meals m ON m.id = meal_ingredients.meal_id
      WHERE l.id = m.list_id
      AND l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code')
    )
  );

NOTIFY pgrst, 'reload schema';

-- ── Block 3: Enable realtime ──
ALTER PUBLICATION supabase_realtime ADD TABLE meal_ingredients;

NOTIFY pgrst, 'reload schema';