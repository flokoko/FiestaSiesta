-- ═══════════════════════════════════════════════════════════════
-- Bella Mozzarella: Trennung der Listen & bearbeitbare Kategorien
-- ═══════════════════════════════════════════════════════════════
-- Im Supabase Dashboard → SQL Editor → New Query → dies ausführen
-- ═══════════════════════════════════════════════════════════════

-- 1. list_type Spalte zur items Tabelle hinzufügen
ALTER TABLE items ADD COLUMN IF NOT EXISTS list_type TEXT NOT NULL DEFAULT 'shopping';

-- 2. Neue Tabelle: categories (pro Liste, pro Typ)
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  list_type TEXT NOT NULL DEFAULT 'shopping',
  name TEXT NOT NULL,
  icon TEXT DEFAULT '📦',
  color TEXT DEFAULT '#9b6dd9',
  bg TEXT DEFAULT '#e8dcf7',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Eindeutige Kategorienamen pro Liste + Typ (keine Duplikate)
CREATE UNIQUE INDEX IF NOT EXISTS categories_unique_name
  ON categories (list_id, list_type, name);

-- 4. RLS für categories aktivieren
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies für categories
--    Wir nutzen eine SECURITY DEFINER Funktion um Rekursion zu vermeiden
--    (gleicher Trick wie bei verify_join_code)

CREATE OR REPLACE FUNCTION verify_list_access(
  p_list_id UUID,
  p_join_code TEXT
) RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM lists
    WHERE id = p_list_id AND UPPER(join_code) = UPPER(p_join_code)
  );
$$;

-- Alte policies droppen falls vorhanden
DROP POLICY IF EXISTS categories_read_by_code ON categories;
DROP POLICY IF EXISTS categories_write_by_code ON categories;
DROP POLICY IF EXISTS categories_update_by_code ON categories;
DROP POLICY IF EXISTS categories_delete_by_code ON categories;

-- Neue policies mit verify_list_access (keine Rekursion!)
CREATE POLICY categories_read_by_code ON categories FOR SELECT
  USING (verify_list_access(list_id, current_setting('request.headers', true)::json ->> 'x-join-code'));

CREATE POLICY categories_write_by_code ON categories FOR INSERT
  WITH CHECK (verify_list_access(list_id, current_setting('request.headers', true)::json ->> 'x-join-code'));

CREATE POLICY categories_update_by_code ON categories FOR UPDATE
  USING (verify_list_access(list_id, current_setting('request.headers', true)::json ->> 'x-join-code'));

CREATE POLICY categories_delete_by_code ON categories FOR DELETE
  USING (verify_list_access(list_id, current_setting('request.headers', true)::json ->> 'x-join-code'));

-- 6. Realtime für categories aktivieren
ALTER PUBLICATION supabase_realtime ADD TABLE categories;

-- 7. Default-Kategorien für Einkaufsliste (shopping) seeden
INSERT INTO categories (list_id, list_type, name, icon, color, bg, sort_order) VALUES
  ('407cc996-abbe-4d79-b2ca-33277b24097c', 'shopping', 'Essen', '🍽️', '#e07856', '#fde8dc', 1),
  ('407cc996-abbe-4d79-b2ca-33277b24097c', 'shopping', 'Getränke', '🥤', '#4a90d9', '#d4e8f7', 2),
  ('407cc996-abbe-4d79-b2ca-33277b24097c', 'shopping', 'Snacks', '🍿', '#e8a83a', '#fdf2d6', 3),
  ('407cc996-abbe-4d79-b2ca-33277b24097c', 'shopping', 'Equipment', '🎒', '#6b8e5a', '#dce8d2', 4),
  ('407cc996-abbe-4d79-b2ca-33277b24097c', 'shopping', 'Sonstiges', '📦', '#9b6dd9', '#e8dcf7', 5)
ON CONFLICT (list_id, list_type, name) DO NOTHING;

-- 8. Default-Kategorien für Mitbringen-Liste (bring) seeden
INSERT INTO categories (list_id, list_type, name, icon, color, bg, sort_order) VALUES
  ('407cc996-abbe-4d79-b2ca-33277b24097c', 'bring', 'Essen', '🍽️', '#e07856', '#fde8dc', 1),
  ('407cc996-abbe-4d79-b2ca-33277b24097c', 'bring', 'Getränke', '🥤', '#4a90d9', '#d4e8f7', 2),
  ('407cc996-abbe-4d79-b2ca-33277b24097c', 'bring', 'Snacks', '🍿', '#e8a83a', '#fdf2d6', 3),
  ('407cc996-abbe-4d79-b2ca-33277b24097c', 'bring', 'Equipment', '🎒', '#6b8e5a', '#dce8d2', 4),
  ('407cc996-abbe-4d79-b2ca-33277b24097c', 'bring', 'Sonstiges', '📦', '#9b6dd9', '#e8dcf7', 5)
ON CONFLICT (list_id, list_type, name) DO NOTHING;

-- 9. Items RLS Policies aktualisieren (optional: list_type filter)
--    Die bestehenden items_read_by_code und items_write_by_code Policies
--    funktionieren weiterhin, da list_type nur ein zusätzliches Feld ist.
--    Keine Änderung nötig — items werden per list_type im Frontend gefiltert.

-- ═══════════════════════════════════════════════════════════════
-- FERTIG! Nach dem Ausführen: Schema-Cache aktualisieren mit:
--   NOTIFY pgrst, 'reload schema';
-- oder im Dashboard: Settings → API → "Reload schema cache"
-- ═══════════════════════════════════════════════════════════════