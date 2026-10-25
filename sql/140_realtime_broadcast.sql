-- ── Realtime über Datenbank-Broadcast (v0.37.0) ──────────────────────────
-- Warum: Alle Policies hängen an `request.headers ->> 'x-join-code'`.
-- `postgres_changes` wertet RLS beim Abo OHNE diese Header aus, also autorisiert
-- kein einziges Abo und es kommen keine Events (am 25.10.2026 mit `items` und
-- `trip_proposals` nachgewiesen). Lösung: ein Trigger schickt die Änderung per
-- `realtime.broadcast_changes()` auf einen privaten Kanal. Die Topic enthält
-- Listen-UUID UND Join-Code; die Policy auf `realtime.messages` prüft beides
-- gegen `public.lists` — wer den Join-Code nicht kennt, darf nicht zuhören.
-- Die Tabellen-RLS bleibt unangetastet.
--
-- Idempotent: policyname/Trigger werden vorher gedroppt.

create or replace function public.rt_topic_allowed(t text) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lists l
    where t like 'list:' || l.id::text || ':' || l.join_code || '%'
  )
$$;

revoke all on function public.rt_topic_allowed(text) from public;
grant execute on function public.rt_topic_allowed(text) to anon, authenticated;

drop policy if exists fiesta_broadcast_read on realtime.messages;
create policy fiesta_broadcast_read on realtime.messages
for select
to anon, authenticated
using (extension = 'broadcast' and public.rt_topic_allowed(topic));

-- Ein Trigger-Funktion für alle Tabellen. list_id kommt aus der Zeile;
-- `expense_splits` hat keine eigene list_id und wird über die Ausgabe aufgelöst.
create or replace function public.rt_broadcast_row() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  lid uuid;
  jc text;
begin
  if tg_table_name = 'expense_splits' then
    select e.list_id into lid
    from public.expenses e
    where e.id = coalesce(
      (to_jsonb(new) ->> 'expense_id')::uuid,
      (to_jsonb(old) ->> 'expense_id')::uuid
    );
  else
    lid := coalesce(
      (to_jsonb(new) ->> 'list_id')::uuid,
      (to_jsonb(old) ->> 'list_id')::uuid
    );
  end if;

  if lid is null then
    return null;
  end if;

  select l.join_code into jc from public.lists l where l.id = lid;
  if jc is null then
    return null;
  end if;

  perform realtime.broadcast_changes(
    'list:' || lid::text || ':' || jc,
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old,
    'row'
  );
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'items', 'categories', 'notes', 'expenses', 'expense_splits',
    'expense_quotas', 'participants', 'settlements', 'bristol_entries',
    'packlist_items', 'trip_proposals', 'trip_votes'
  ] loop
    execute format('drop trigger if exists rt_broadcast_row on public.%I', t);
    execute format(
      'create trigger rt_broadcast_row after insert or update or delete on public.%I
         for each row execute function public.rt_broadcast_row()', t);
  end loop;
end;
$$;

-- Prototyp aus der Machbarkeitsprüfung (25.10.2026) entfernen
drop trigger if exists rt_broadcast_proposals on public.trip_proposals;
drop function if exists public.rt_broadcast_proposal();

select count(*) as broadcast_trigger
from pg_trigger
where tgname = 'rt_broadcast_row' and not tgisinternal;
