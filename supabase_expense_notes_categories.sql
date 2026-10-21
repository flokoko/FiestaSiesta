-- ═══════════════════════════════════════════════════════════════
-- Bella Mozzarella: Expense Notes & Categories
-- ═══════════════════════════════════════════════════════════════
-- Im Supabase Dashboard → SQL Editor → New Query → dies ausführen
-- ═══════════════════════════════════════════════════════════════

-- 1. note Spalte zur expenses Tabelle hinzufügen
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS note TEXT DEFAULT NULL;

-- 2. category Spalte zur expenses Tabelle hinzufügen
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS category TEXT DEFAULT NULL;

-- ═══════════════════════════════════════════════════════════════
-- FERTIG! Nach dem Ausführen: Schema-Cache aktualisieren mit:
--   NOTIFY pgrst, 'reload schema';
-- oder im Dashboard: Settings → API → "Reload schema cache"
-- ═══════════════════════════════════════════════════════════════
