-- ── Kalender-Abo: stabiler Token pro Liste ───────────────────────────
-- Die Edge Function `ics-feed` liest den Plan ohne Login (Kalender-Apps können
-- keine Header schicken). Der Token in der URL ist das Geheimnis: 122 Bit
-- Zufall, nur über die App sichtbar (RLS auf lists), nicht ratbar.
-- Idempotent.

alter table public.lists
  add column if not exists ics_token uuid not null default gen_random_uuid();

create unique index if not exists lists_ics_token_key
  on public.lists (ics_token);
