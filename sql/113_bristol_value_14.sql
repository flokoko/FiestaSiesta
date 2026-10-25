-- Bristol-Constraint: Stand der LIVE-Datenbank (Projekt aqmisgetzatbrvchbrkf).
-- Die alten Dateien in sql/ (005_bristol_modus.sql, supabase_bristol_13_migration.sql)
-- standen auf CHECK (value BETWEEN 1 AND 13) — der Code erlaubt aber 14 (Mega-Plasma)
-- und mehrere Einträge pro Tag. Live gilt:
--   bristol_entries_value_check: CHECK (value = ANY (ARRAY[1,2,3,4,5,6,7,13,14]))
--   bristol_entries_unique:      UNIQUE (list_id, participant_name, entry_date, entry_time)
-- Diese Datei ist die Referenz; bei Neuaufbau diese Definitionen verwenden.
ALTER TABLE public.bristol_entries DROP CONSTRAINT IF EXISTS bristol_entries_value_check;
ALTER TABLE public.bristol_entries
  ADD CONSTRAINT bristol_entries_value_check CHECK (value = ANY (ARRAY[1,2,3,4,5,6,7,13,14]));
ALTER TABLE public.bristol_entries DROP CONSTRAINT IF EXISTS bristol_entries_unique;
ALTER TABLE public.bristol_entries
  ADD CONSTRAINT bristol_entries_unique UNIQUE (list_id, participant_name, entry_date, entry_time);
