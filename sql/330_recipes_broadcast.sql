-- 330_recipes_broadcast.sql
-- Review r8, Phase 2 (19.11.2026). Idempotent, mehrfach ausführbar.
--
-- Rezepte waren die einzige Inhaltstabelle ohne Broadcast-Trigger (sql/140
-- listet 12 Tabellen, recipes kam erst mit sql/200 dazu). Folge: legt einer
-- ein Rezept an, sahen die anderen es erst nach einem Neuladen des Küchen-
-- Screens. Der Client hört seit v0.67.0 über useRealtimeSync auf 'recipes'.
--
-- Bewusst als eigene Datei statt sql/140 neu zu fassen: die dortige DO-Schleife
-- würde alle 12 Trigger neu anlegen; hier reicht der eine. Wer sql/140 später
-- erweitert, muss 'recipes' dort mit aufnehmen und diese Datei kann bleiben
-- (gleicher Trigger-Name, drop+create ist idempotent).

drop trigger if exists rt_broadcast_row on public.recipes;
create trigger rt_broadcast_row
  after insert or update or delete on public.recipes
  for each row execute function public.rt_broadcast_row();
