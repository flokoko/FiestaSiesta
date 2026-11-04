-- ── Kommentare an Reiseplan-Vorschlägen ──────────────────────────────
-- Flos Befund nach Phase 2: „warum nicht mittags?" landet sonst im Chat.
-- Ein Kommentar hängt am Vorschlag (nicht am Tag), damit die Begründung dort
-- steht, wo entschieden wird.
--
-- Idempotent: mehrfach ausführbar.

create table if not exists public.trip_comments (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  proposal_id uuid not null references public.trip_proposals (id) on delete cascade,
  author text not null check (char_length(btrim(author)) between 1 and 60),
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists trip_comments_proposal_idx
  on public.trip_comments (proposal_id, created_at);
create index if not exists trip_comments_list_idx
  on public.trip_comments (list_id, created_at);

alter table public.trip_comments enable row level security;

-- RLS exakt wie trip_proposals/trip_votes: alles hängt am Join-Code im Header.
drop policy if exists trip_comments_by_code on public.trip_comments;
create policy trip_comments_by_code on public.trip_comments
  for all
  to anon, authenticated
  using (
    exists (
      select 1 from public.lists l
      where l.id = trip_comments.list_id
        and l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code')
    )
  )
  with check (
    exists (
      select 1 from public.lists l
      where l.id = trip_comments.list_id
        and l.join_code = (current_setting('request.headers', true)::json ->> 'x-join-code')
    )
  );

-- Realtime über den Broadcast-Bus (nie postgres_changes, siehe Skill).
drop trigger if exists rt_trip_comments on public.trip_comments;
create trigger rt_trip_comments
  after insert or update or delete on public.trip_comments
  for each row execute function public.rt_broadcast_row();
