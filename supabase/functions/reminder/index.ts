// ═══════════════════════════════════════════════════════════════════
// Supabase Edge Function: reminder
// Fiesta Siesta — schickt die Wecker-Pushes für den Reiseplan.
//
// Aufruf: pg_cron, alle 5 Minuten (sql/190_wake_alarm.sql).
//   Authorization: Bearer <anon key>   (verify_jwt bleibt true)
//   x-join-code: SIESTA26              (Autorisierung wie bei send-push)
//
// Fällig ist ein Wecker, wenn `day + starts_at − remind_before` erreicht ist.
// Gesendet wird höchstens einmal pro Vorschlag und Tag (`reminder_log`), auch
// wenn der Cron zweimal in dasselbe Fenster läuft.
//
// Diagnose: `x-dry-run: 1` rechnet ohne zu senden (und ohne zu loggen),
//           `x-now: 2026-12-02T08:40:00Z` prüft einen anderen Zeitpunkt.
// Antwort: { due: [...], sent, failed, skipped? }
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

/** Ein Wecker, der bis zu 15 Minuten überfällig ist, gilt noch als fällig —
 *  so holt der 5-Minuten-Cron einen ausgefallenen Lauf nach, ohne doppelt zu
 *  senden (das verhindert der Unique-Index in reminder_log). */
const GRACE_MINUTES = 15

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
  remind_enabled: boolean
  confirmed_at: string | null
}

/** Ortszeit der Kanaren als YYYY-MM-DD und HH:MM. */
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

function hhmm(value: string | null): string {
  return (value ?? '').slice(0, 5)
}

function minutesOf(value: string): number {
  const [h, m] = value.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
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

    // Nur heute und morgen können fällig sein (Vorlauf max. 180 Minuten).
    const tomorrow = new Date(`${clock.day}T12:00:00Z`)
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    const tomorrowIso = tomorrow.toISOString().slice(0, 10)

    const { data, error } = await supabase
      .from('trip_proposals')
      .select('id, day, slot, title, place, starts_at, remind_before, remind_enabled, confirmed_at')
      .eq('list_id', list.id)
      .eq('remind_enabled', true)
      .gte('day', clock.day)
      .lte('day', tomorrowIso)
    if (error) return json({ error: error.message }, 500)

    const rows = (data ?? []) as ProposalRow[]

    const due = rows.filter((row) => {
      if (!row.starts_at) return false
      if (row.day !== clock.day) return false
      const remindBefore = row.remind_before ?? 20
      const dueAt = minutesOf(hhmm(row.starts_at)) - remindBefore
      const late = clock.minutes - dueAt
      return late >= 0 && late <= GRACE_MINUTES
    })

    if (due.length === 0) {
      return json({ due: [], sent: 0, failed: 0, at: `${clock.day} ${Math.floor(clock.minutes / 60)}:${String(clock.minutes % 60).padStart(2, '0')}` })
    }

    // Bereits gesendete Wecker herausfiltern.
    const { data: alreadySent } = await supabase
      .from('reminder_log')
      .select('proposal_id')
      .in('proposal_id', due.map((d) => d.id))
      .eq('day', clock.day)
    const sentIds = new Set((alreadySent ?? []).map((r) => (r as { proposal_id: string }).proposal_id))
    const pending = due.filter((d) => !sentIds.has(d.id))

    if (pending.length === 0 || dryRun) {
      return json({
        due: pending.map((p) => ({
          id: p.id, title: p.title, day: p.day,
          starts_at: hhmm(p.starts_at), remind_before: p.remind_before ?? 20,
        })),
        sent: 0, failed: 0, dryRun,
      })
    }

    const { data: subs, error: subsError } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('list_id', list.id)
    if (subsError) return json({ error: subsError.message }, 500)

    let sent = 0
    let failed = 0

    for (const item of pending) {
      const start = hhmm(item.starts_at)
      const lead = item.remind_before ?? 20
      const payload = JSON.stringify({
        title: `In ${lead} Min: ${item.title}`,
        body: `${start} Uhr los${item.place ? ` · ${item.place}` : ''}. Rucksack, Wasser, Schlüssel.`,
        icon: '/FiestaSiesta/icon-192.png',
        tag: `fiesta-wake-${item.id}`,
        renotify: true,
        data: { url: '/FiestaSiesta/', kind: 'wake', proposalId: item.id, day: item.day },
      })

      for (const sub of subs ?? []) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
          )
          sent++
        } catch (err) {
          failed++
          const statusCode = (err as { statusCode?: number }).statusCode
          if (statusCode === 404 || statusCode === 410) {
            await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
          }
        }
      }

      // Nach dem ersten Erfolg loggen — schlägt der Insert fehl (Race mit einem
      // parallelen Lauf), ist der Unique-Index die Bremse, nicht der Fehler.
      if (sent > 0) {
        await supabase.from('reminder_log').insert({
          list_id: list.id, proposal_id: item.id, day: item.day,
        })
      }
    }

    return json({ due: pending.length, sent, failed })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})
