# sql/archive — Historie, NICHT ausführen

Die Dateien hier sind der Bootstrap-Verlauf des Projekts (erste Tabellen, erste
Fassung der RPCs). Mehrere davon enthalten **überholte und unsichere** Definitionen:

- `rename_participant.sql` — benennt Splits listenübergreifend um (Fix in `120`).
- `set_admin_password.sql` / `verify_admin_password.sql` — alte Signaturen (Fix in `120`).
- `batch_delete_items.sql` — ohne Join-Code-Guard (Fix in `150`).
- `*_migration.sql` — Erst-Anlage der Tabellen; die Live-DB ist weiter.

Maßgeblich ist ausschließlich die laufende Datenbank. Wer den Aufbau nachlesen will:
`select pg_get_functiondef(oid) from pg_proc where proname = '...'`.

Die aktuellen Migrationen liegen eine Ebene höher und sind in der Reihenfolge
100 → 110 → 111 → 112 → 113 → 120 → 130 → 140 → 150 → 151 anzuwenden.
