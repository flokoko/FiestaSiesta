-- ═══════════════════════════════════════════════════════════════
-- Bella Mozzarella: Bristol-Skala auf 1-13 erweitern
-- ═══════════════════════════════════════════════════════════════
-- Im Supabase Dashboard → SQL Editor → New Query → dies ausführen
-- ═══════════════════════════════════════════════════════════════

-- CHECK-Constraint von 1-7 auf 1-13 ändern
ALTER TABLE bristol_entries DROP CONSTRAINT IF EXISTS bristol_entries_value_check;
ALTER TABLE bristol_entries ADD CONSTRAINT bristol_entries_value_check CHECK (value >= 1 AND value <= 13);
