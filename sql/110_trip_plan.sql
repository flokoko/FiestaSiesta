-- ════════════════════════════════════════════════════════════════════
-- Reiseplan: Vorschläge zu drei Tageszeiten + Abstimmung
-- Jeder Teilnehmer darf beliebig viele Vorschläge pro Tag/Tageszeit machen.
-- Der Vorschlag mit den meisten Stimmen ist der Plan (Gleichstand: früherer).
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.trip_proposals (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid not null references public.lists(id) on delete cascade,
  day         date not null,
  slot        text not null check (slot in ('morning', 'noon', 'evening')),
  title       text not null check (length(btrim(title)) > 0),
  note        text,
  created_by  text not null,
  created_at  timestamptz not null default now()
);

create index if not exists trip_proposals_list_day_idx
  on public.trip_proposals (list_id, day, slot, created_at);

create table if not exists public.trip_votes (
  id           uuid primary key default gen_random_uuid(),
  list_id      uuid not null references public.lists(id) on delete cascade,
  proposal_id  uuid not null references public.trip_proposals(id) on delete cascade,
  voter        text not null,
  created_at   timestamptz not null default now(),
  unique (proposal_id, voter)
);

create index if not exists trip_votes_proposal_idx on public.trip_votes (proposal_id);

alter table public.trip_proposals enable row level security;
alter table public.trip_votes     enable row level security;

drop policy if exists trip_proposals_by_code on public.trip_proposals;
create policy trip_proposals_by_code on public.trip_proposals
  for all
  using (exists (
    select 1 from public.lists l
    where l.id = trip_proposals.list_id
      and l.join_code = (current_setting('request.headers', true))::json ->> 'x-join-code'
  ))
  with check (exists (
    select 1 from public.lists l
    where l.id = trip_proposals.list_id
      and l.join_code = (current_setting('request.headers', true))::json ->> 'x-join-code'
  ));

drop policy if exists trip_votes_by_code on public.trip_votes;
create policy trip_votes_by_code on public.trip_votes
  for all
  using (exists (
    select 1 from public.lists l
    where l.id = trip_votes.list_id
      and l.join_code = (current_setting('request.headers', true))::json ->> 'x-join-code'
  ))
  with check (exists (
    select 1 from public.lists l
    where l.id = trip_votes.list_id
      and l.join_code = (current_setting('request.headers', true))::json ->> 'x-join-code'
  ));

-- Realtime
do $$
begin
  begin
    alter publication supabase_realtime add table public.trip_proposals;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.trip_votes;
  exception when duplicate_object then null;
  end;
end $$;
