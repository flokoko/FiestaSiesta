-- ═══════════════════════════════════════════════════════════════
-- Bella Mozzarella: Expense Categories (in bestehender categories-Tabelle)
-- ═══════════════════════════════════════════════════════════════
-- Im Supabase Dashboard → SQL Editor → New Query → dies ausführen
-- ═══════════════════════════════════════════════════════════════

-- 1. note + category Spalten (falls noch nicht vorhanden)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS note TEXT DEFAULT NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS category TEXT DEFAULT NULL;

-- 2. Default Expense-Kategorien seeden (in die bestehende categories-Tabelle)
--    Passe die list_id auf DEINE Listen-ID an!
--    (zu finden unter: SELECT id FROM lists LIMIT 1;)
INSERT INTO categories (list_id, list_type, name, icon, color, bg, sort_order)
SELECT id, 'expense', 'Supermarkt', '🛒', '#009246', '#e0f2e0', 1 FROM lists
ON CONFLICT (list_id, list_type, name) DO NOTHING;

INSERT INTO categories (list_id, list_type, name, icon, color, bg, sort_order)
SELECT id, 'expense', 'Restaurant', '🍝', '#ce2b37', '#fce8e8', 2 FROM lists
ON CONFLICT (list_id, list_type, name) DO NOTHING;

INSERT INTO categories (list_id, list_type, name, icon, color, bg, sort_order)
SELECT id, 'expense', 'Benzin', '⛽', '#4a90d9', '#e0ecf7', 3 FROM lists
ON CONFLICT (list_id, list_type, name) DO NOTHING;

INSERT INTO categories (list_id, list_type, name, icon, color, bg, sort_order)
SELECT id, 'expense', 'Aktivitäten', '🎯', '#e8a83a', '#fdf2d6', 4 FROM lists
ON CONFLICT (list_id, list_type, name) DO NOTHING;

INSERT INTO categories (list_id, list_type, name, icon, color, bg, sort_order)
SELECT id, 'expense', 'Sonstiges', '📦', '#9b6dd9', '#e8dcf7', 5 FROM lists
ON CONFLICT (list_id, list_type, name) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- FERTIG! Nach dem Ausführen: Schema-Cache aktualisieren mit:
--   NOTIFY pgrst, 'reload schema';
-- ═══════════════════════════════════════════════════════════════
