// ═══════════════════════════════════════════════════════════════════
// Supabase Edge Function: reminder
// Fiesta Siesta — schickt die Wecker-Pushes für den bestätigten Reiseplan.
//
// Aufruf: pg_cron, alle 5 Minuten (sql/190_wake_alarm.sql).
//   Authorization: Bearer <anon key>   (verify_jwt bleibt true)
//   x-join-code: SIESTA26              (Autorisierung wie bei send-push)
//
// Regeln (Entscheidung 31.10.2026, Flo):
//   - Es klingelt NUR der bestätigte Plan (`confirmed_at is not null`). Ein
//     Vorschlag, der eine Abstimmung verliert, ist stumm — der Client rechnet gleich.
//   - Fällig ist `day + starts_at − remind_before`; ein Vorlauf über Mitternacht
//     gehört auf den Vortag (00:10 mit 30 Min → 23:40 des Vortags).
//   - Der Log-Eintrag wird VOR dem Senden geschrieben (Claim über den Unique-Index).
//     Kommt nichts an, wird der Claim zurückgenommen: lieber erneut versuchen als
//     einen Wecker still verlieren.
//
// Diagnose: `x-dry-run: 1` rechnet, ohne zu claimen oder zu senden;
//           `x-now: 2026-12-02T08:40:00Z` prüft einen anderen Zeitpunkt.
// Antwort: { due, sent, failed, at }
// ═══════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

webpush.setVapidDetails(
  VAPID_SUBJECT,
  Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
  Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
)

/** Bis zu 15 Minuten überfällig gilt noch als fällig — so holt der 5-Minuten-Cron
 *  einen ausgefallenen Lauf nach, ohne doppelt zu senden (Claim im Log). */
const GRACE_MINUTES = 15
const DEFAULT_LEAD = 20

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const ALLOWED_ORIGINS = [
  'https://flokoko.github.io',
  'http://127.0.0.1:5188',
  'http://localhost:5188',
]

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-join-code',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

interface ProposalRow {
  id: string
  day: string
  slot: string
  title: string
  place: string | null
  starts_at: string | null
  remind_before: number | null
  confirmed_at: string | null
}

/** Ortszeit der Kanaren als YYYY-MM-DD und Minuten seit Mitternacht. */
function canaryClock(now: Date): { day: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Atlantic/Canary',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
  }
}

/** Kanarische Wanduhr → absoluter Zeitpunkt (Winter UTC+0, Sommer UTC+1). */
function canaryWallToDate(day: string, minutesOfDay: number, ref: Date): Date {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Atlantic/Canary',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(ref)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const offsetMin = Math.round(
    (Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second')) -
      ref.getTime()) / 60000,
  )
  const [y, mo, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, (mo || 1) - 1, d || 1) + minutesOfDay * 60000 - offsetMin * 60000)
}

function shiftDay(day: string, delta: number): string {
  const [y, mo, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y, (mo || 1) - 1, d || 1))
  date.setUTCDate(date.getUTCDate() + delta)
  return date.toISOString().slice(0, 10)
}

function hhmm(value: string | null): string {
  return (value ?? '').slice(0, 5)
}

function minutesOf(value: string): number {
  const [h, m] = value.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Wann soll dieser Vorschlag klingeln? Inkl. Tagesüberlauf beim Vorlauf. */
function dueInstant(row: ProposalRow, ref: Date): Date | null {
  if (!row.starts_at) return null
  const lead = row.remind_before ?? DEFAULT_LEAD
  const dueMinutes = minutesOf(hhmm(row.starts_at)) - lead
  const dueDay = dueMinutes < 0 ? shiftDay(row.day, -1) : row.day
  const clock = ((dueMinutes % 1440) + 1440) % 1440
  return canaryWallToDate(dueDay, clock, ref)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsFor(req) })
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsFor(req), 'Content-Type': 'application/json' },
    })

  try {
    // ── Autorisierung ─────────────────────────────────────────────────
    const joinCode = req.headers.get('x-join-code') ?? ''
    if (!joinCode) return json({ error: 'x-join-code fehlt' }, 403)

    const { data: list, error: listError } = await supabase
      .from('lists').select('id, join_code').eq('join_code', joinCode).maybeSingle()
    if (listError || !list) return json({ error: 'Keine Berechtigung' }, 403)

    const dryRun = req.headers.get('x-dry-run') === '1'
    const nowHeader = req.headers.get('x-now') ?? ''
    const now = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(nowHeader) ? new Date(nowHeader) : new Date()
    const clock = canaryClock(now)

    // Gestern bis morgen: ein Vorlauf über Mitternacht ist heute fällig, und ein
    // Wecker von morgen früh kann heute Abend schon im Karenzfenster liegen.
    const { data, error } = await supabase
      .from('trip_proposals')
      .select('id, day, slot, title, place, starts_at, remind_before, confirmed_at')
      .eq('list_id', list.id)
      .eq('remind_enabled', true)
      .not('confirmed_at', 'is', null)
      .gte('day', shiftDay(clock.day, -1))
      .lte('day', shiftDay(clock.day, 1))
    if (error) return json({ error: error.message }, 500)

    const rows = (data ?? []) as ProposalRow[]

    const due = rows.filter((row) => {
      const at = dueInstant(row, now)
      if (!at) return false
      const late = (now.getTime() - at.getTime()) / 60000
      return late >= 0 && late <= GRACE_MINUTES
    })

    const atLabel = `${clock.day} ${String(Math.floor(clock.minutes / 60)).padStart(2, '0')}:${String(clock.minutes % 60).padStart(2, '0')}`

    if (due.length === 0) {
      return json({ due: 0, sent: 0, failed: 0, at: atLabel })
    }

    if (dryRun) {
      return json({
        due: due.map((row) => ({
          id: row.id, title: row.title, day: row.day,
          starts_at: hhmm(row.starts_at), remind_before: row.remind_before ?? DEFAULT_LEAD,
        })),
        sent: 0, failed: 0, dryRun, at: atLabel,
      })
    }

    const { data: subs, error: subsError } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('list_id', list.id)
    if (subsError) return json({ error: subsError.message }, 500)

    let sent = 0
    let failed = 0
    let claimed = 0

    for (const item of due) {
      // Claim VOR dem Senden: der Unique-Index (proposal_id, day) bremst zwei
      // überlappende Cron-Läufe. 23505 = ein anderer Lauf hat ihn schon.
      const { error: claimError } = await supabase
        .from('reminder_log')
        .insert({ list_id: list.id, proposal_id: item.id, day: item.day })
      if (claimError) {
        if ((claimError as { code?: string }).code === '23505') continue
        failed++
        continue
      }
      claimed++

      const start = hhmm(item.starts_at)
      const lead = item.remind_before ?? DEFAULT_LEAD
      const payload = JSON.stringify({
        title: lead === 0 ? `Jetzt los: ${item.title}` : `In ${lead} Min: ${item.title}`,
        body: `${start} los${item.place ? ` · ${item.place.split('·')[0].trim()}` : ''}. Rucksack, Wasser, Schlüssel.`,
        icon: '/FiestaSiesta/icon-192.png',
        tag: `fiesta-wake-${item.id}`,
        data: {
          url: '/FiestaSiesta/?tab=plan',
          kind: 'wake',
          proposalId: item.id,
          day: item.day,
        },
      })

      let sentForItem = 0
      for (const sub of subs ?? []) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
          )
          sentForItem++
          sent++
        } catch (err) {
          failed++
          const statusCode = (err as { statusCode?: number }).statusCode
          if (statusCode === 404 || statusCode === 410) {
            await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
          }
        }
      }

      // Nichts zugestellt? Claim zurücknehmen, damit der nächste Lauf es erneut
      // versucht (innerhalb der Karenz). Kein stiller Totalverlust.
      if (sentForItem === 0) {
        await supabase.from('reminder_log').delete()
          .eq('proposal_id', item.id).eq('day', item.day)
      }
    }

    return json({ due: claimed, sent, failed, at: atLabel })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})
