-- ── Kalender-Abo: Token rotieren ────────────────────────────────────
-- Der Abo-Link ist ein Geheimnis in der URL. Wenn er weitergegeben wurde
-- (Chat, Screenshot, geteiltes Handy), muss er sterben können: neue UUID,
-- alter Link ⇒ 404.
--
-- Security definer, weil anon keine UPDATE-Rechte auf `lists` braucht; die
-- Berechtigung wird über den Join-Code im Header geprüft (wie login_participant).
-- Idempotent.

create or replace function public.rotate_ics_token(p_list_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  jc text;
  new_token uuid;
begin
  jc := (current_setting('request.headers', true)::json ->> 'x-join-code');
  if jc is null or jc = '' then
    raise exception 'kein Join-Code';
  end if;

  if not exists (
    select 1 from public.lists l where l.id = p_list_id and l.join_code = jc
  ) then
    raise exception 'nicht erlaubt';
  end if;

  update public.lists
     set ics_token = gen_random_uuid()
   where id = p_list_id
  returning ics_token into new_token;

  return new_token;
end;
$function$;

revoke all on function public.rotate_ics_token(uuid) from public;
grant execute on function public.rotate_ics_token(uuid) to anon, authenticated;
