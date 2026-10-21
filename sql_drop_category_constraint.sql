-- ═══════════════════════════════════════════════════════════════
-- Bella Mozzarella: CHECK Constraint 'valid_category' entfernen
-- ═══════════════════════════════════════════════════════════════
-- Im Supabase Dashboard → SQL Editor → New Query → dies ausführen
-- ═══════════════════════════════════════════════════════════════
--
-- Problem: Die items-Tabelle hat einen CHECK Constraint 'valid_category',
-- der nur die ursprünglichen Kategorien (Essen, Getränke, Snacks,
-- Equipment, Sonstiges) erlaubt. Seit Kategorien dynamisch aus der
-- DB verwaltet werden, blockiert dieser Constraint neue Kategorien.
--
-- Lösung: Constraint entfernen.

ALTER TABLE items DROP CONSTRAINT IF EXISTS valid_category;

-- Schema-Cache aktualisieren
NOTIFY pgrst, 'reload schema';