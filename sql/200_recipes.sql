-- ── Rezepte für die Ferienküche ──────────────────────────────────────
-- Zutaten liegen als jsonb-Liste am Rezept: [{name, qty, unit, category}]
-- `category` entspricht der Kategorie in `items`, damit ein Rezept die
-- Einkaufsliste auf einen Schlag füllen kann.

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  title text not null,
  note text,
  servings smallint not null default 3 check (servings between 1 and 12),
  minutes smallint check (minutes between 1 and 480),
  ingredients jsonb not null default '[]'::jsonb,
  steps text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recipes_list_idx on public.recipes (list_id, created_at desc);

alter table public.recipes enable row level security;

-- Gleiches Muster wie items/notes: Zugriff nur mit passendem Join-Code.
drop policy if exists recipes_read_by_code on public.recipes;
create policy recipes_read_by_code on public.recipes
  for select using (
    exists (
      select 1 from public.lists l
      where l.id = recipes.list_id
        and l.join_code = ((current_setting('request.headers'::text, true))::json ->> 'x-join-code'::text)
    )
  );

drop policy if exists recipes_write_by_code on public.recipes;
create policy recipes_write_by_code on public.recipes
  for all using (
    exists (
      select 1 from public.lists l
      where l.id = recipes.list_id
        and l.join_code = ((current_setting('request.headers'::text, true))::json ->> 'x-join-code'::text)
    )
  ) with check (
    exists (
      select 1 from public.lists l
      where l.id = recipes.list_id
        and l.join_code = ((current_setting('request.headers'::text, true))::json ->> 'x-join-code'::text)
    )
  );

create or replace function public.touch_recipe_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists recipes_touch on public.recipes;
create trigger recipes_touch before update on public.recipes
  for each row execute function public.touch_recipe_updated_at();
