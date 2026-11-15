-- ═══════════════════════════════════════════════════════════════════════════
-- 310 — Doppelzahlung an der Quelle abfangen
--
-- Der Client prüft „Betrag ≤ offene Schuld" (ExpenseSettlement.tsx) — das
-- schützt aber nur EIN Gerät. Zwei Geräte, die dieselbe Forderung gleichzeitig
-- begleichen (beide sehen den alten Rest), schrieben bisher zwei Zeilen: die
-- Salden sind danach überzogen und niemand merkt, warum.
--
-- Bewusst KEIN unique(list_id, payer, payee): Teilzahlungen an dieselbe Person
-- sind legitim. Gefangen wird der echte Fall — dieselbe Zahlung (gleicher
-- Betrag, gleicher Zahltag) innerhalb von drei Minuten doppelt abgeschickt.
-- Ein zweiter legitimer Betrag über exakt denselben Cent-Betrag am selben Tag
-- nach drei Minuten bleibt erlaubt.
-- ═══════════════════════════════════════════════════════════════════════════

create index if not exists settlements_dup_lookup_idx
  on public.settlements (list_id, payer, payee, settled_at, created_at);

create or replace function public.settlements_block_duplicate()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if exists (
    select 1
      from public.settlements s
     where s.list_id   = new.list_id
       and s.payer     = new.payer
       and s.payee     = new.payee
       and s.amount    = new.amount
       and s.settled_at = new.settled_at
       and s.created_at > now() - interval '3 minutes'
  ) then
    raise exception 'Diese Zahlung wurde gerade eben schon erfasst — bitte die Liste neu laden.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists settlements_block_duplicate_trg on public.settlements;
create trigger settlements_block_duplicate_trg
  before insert on public.settlements
  for each row execute function public.settlements_block_duplicate();
