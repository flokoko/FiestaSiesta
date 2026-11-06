-- ── Quiz: Fragen eindeutig über (Modus, Text) ───────────────────────────
-- Ohne diesen Schlüssel konnten die Seeds nur einfügen (where not exists) —
-- Korrekturen an einer bestehenden Frage kamen nie in der DB an.
-- Mit dem Index sind die Seed-Dateien echte Upserts: Text gleich = Update.

create unique index if not exists quiz_questions_mode_question_key
  on public.quiz_questions (mode, question);
