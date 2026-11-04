// ═══════════════════════════════════════════════════════════════════
// Edge Function: ics-feed
// Fiesta Siesta — Kalender-Abo des bestätigten Reiseplans
// ═══════════════════════════════════════════════════════════════════
//
// GET /functions/v1/ics-feed/<ics_token>.ics   (oder ?token=<uuid>)
//
// Kalender-Apps (iOS, Google, Outlook) schicken keine Header und können sich
// nicht anmelden — deshalb ist der Token in der URL das Geheimnis. Er steht in
// `lists.ics_token` (122 Bit Zufall) und wird in der App angezeigt.
//
// Antwort: text/calendar. Unbekannter Token → 404.
// verify_jwt MUSS false sein, sonst antwortet die Function ohne JWT mit 401.
//
// Die ICS-Erzeugung ist eine bewusste Kopie von src/lib/ics.ts: Deno kann aus
// dem App-Bundle nicht importieren. Wird dort etwas an Faltung/Zeitzone
// geändert, hier nachziehen (Tests: src/lib/__tests__/ics.test.ts).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const SLOT_TIME: Record<string, string> = { morning: '09:00', noon: '13:00', evening: '19:00' }
const SLOT_DURATION: Record<string, number> = { morning: 120, noon: 120, evening: 150 }

const VTIMEZONE_LINES = [
  'BEGIN:VTIMEZONE',
  'TZID:Atlantic/Canary',
  'X-LIC-LOCATION:Atlantic/Canary',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0000',
  'TZOFFSETTO:+0100',
  'TZNAME:WEST',
  'DTSTART:19700329T010000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0000',
  'TZNAME:WET',
  'DTSTART:19701025T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
]

const pad = (n: number) => String(n).padStart(2, '0')

function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** Zeilen auf 75 Oktette falten (Umlaute zählen zwei Bytes). */
function foldIcsLine(line: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) return line
  const out: string[] = []
  let current = ''
  let bytes = 0
  for (const char of line) {
    const size = encoder.encode(char).length
    if (bytes + size > (out.length === 0 ? 75 : 74)) {
      out.push(current)
      current = ''
      bytes = 0
    }
    current += char
    bytes += size
  }
  if (current) out.push(current)
  return out.join('\r\n ')
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

const icsStamp = (day: string, time: string) => `${day.replace(/-/g, '')}T${time.replace(':', '')}00`

function utcStamp(now: Date): string {
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
}

interface ProposalRow {
  id: string
  day: string
  slot: string
  title: string
  note: string | null
  place: string | null
  starts_at: string | null
}

function buildCalendar(calendarName: string, rows: ProposalRow[], now = new Date()): string {
  const stamp = utcStamp(now)
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Fiesta Siesta//Reiseplan//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + escapeIcsText(calendarName),
    'X-WR-TIMEZONE:Atlantic/Canary',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
    ...VTIMEZONE_LINES,
  ]

  for (const row of rows) {
    const time = row.starts_at ? row.starts_at.slice(0, 5) : SLOT_TIME[row.slot] ?? '09:00'
    const duration = SLOT_DURATION[row.slot] ?? 120
    const description = [row.note, row.place ? `Ort: ${row.place}` : ''].filter(Boolean).join('\n')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${row.day}-${row.slot}@fiesta-siesta`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Atlantic/Canary:${icsStamp(row.day, time)}`,
      `DTEND;TZID=Atlantic/Canary:${icsStamp(row.day, addMinutes(time, duration))}`,
      `SUMMARY:${escapeIcsText(row.title)}`,
    )
    if (row.place) lines.push(`LOCATION:${escapeIcsText(row.place)}`)
    if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.map(foldIcsLine).join('\r\n') + '\r\n'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
    })
  }

  const url = new URL(req.url)
  const fromQuery = url.searchParams.get('token')
  const lastSegment = url.pathname.split('/').filter(Boolean).pop() ?? ''
  const token = (fromQuery ?? lastSegment).replace(/\.ics$/i, '')

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return new Response('Ungültiger Kalender-Link.', { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

  const { data: list, error: listError } = await supabase
    .from('lists')
    .select('id, name')
    .eq('ics_token', token)
    .maybeSingle()

  if (listError) {
    return new Response(`Fehler: ${listError.message}`, { status: 500 })
  }
  if (!list) {
    // Kein Orakel: unbekannter Token ist einfach 404.
    return new Response('Kalender nicht gefunden.', { status: 404 })
  }

  const { data: rows, error: planError } = await supabase
    .from('trip_proposals')
    .select('id, day, slot, title, note, place, starts_at')
    .eq('list_id', list.id)
    .not('confirmed_at', 'is', null)
    .order('day', { ascending: true })
    .order('slot', { ascending: true })

  if (planError) {
    return new Response(`Fehler: ${planError.message}`, { status: 500 })
  }

  // Kalendername = Listenname: „Fiesta Siesta · Fiesta Siesta" wäre doppelt.
  const calendar = buildCalendar(list.name || 'Fiesta Siesta', (rows ?? []) as ProposalRow[])

  return new Response(calendar, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="fiesta-siesta.ics"',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  })
})
