-- ════════════════════════════════════════════════════════════════════
-- Reiseplan: Ortsangabe + fest bestätigter Plan
-- place       — optionaler Ort, in der App antippbar (Google Maps)
-- confirmed_* — Sieger wurde übernommen; pro Tag+Tageszeit nur einer
-- ════════════════════════════════════════════════════════════════════

alter table public.trip_proposals add column if not exists place text;
alter table public.trip_proposals add column if not exists confirmed_at timestamptz;
alter table public.trip_proposals add column if not exists confirmed_by text;

create unique index if not exists trip_proposals_one_confirmed_idx
  on public.trip_proposals (list_id, day, slot)
  where confirmed_at is not null;
