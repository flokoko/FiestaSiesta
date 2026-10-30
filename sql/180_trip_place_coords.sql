-- 180: Koordinaten am Reise-Vorschlag
-- Damit das Ziel-Wetter nicht raten muss, wo „Roque Nublo" liegt: Beim Speichern
-- werden die Koordinaten mitgeschrieben — aus einem eingefügten Google-Maps-Link
-- oder (Fallback) aus der Open-Meteo-Ortsauflösung. Der Link selbst bleibt für
-- den Routen-Knopf erhalten.
--
-- Idempotent, keine Policy-Änderung: die Spalten hängen an derselben Zeile und
-- werden von der bestehenden Join-Code-RLS mitgeschützt.

alter table public.trip_proposals
  add column if not exists place_lat double precision,
  add column if not exists place_lon double precision,
  add column if not exists place_url text;
