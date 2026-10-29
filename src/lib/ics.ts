// ── ICS-Export des Reiseplans ───────────────────────────────────────
// Bewusst ohne Bibliothek: eine ICS-Datei ist ein paar Textzeilen. Wichtig sind
// drei Dinge, an denen selbstgebaute Exporte sonst scheitern:
//   1. Zeilenumbruch ist CRLF, gefaltet wird nach 75 OKTETTEN (nicht Zeichen).
//   2. Text wird escaped: Backslash, Semikolon, Komma, Zeilenumbruch.
//   3. Europe/Madrid braucht eine VTIMEZONE-Definition, sonst legt Outlook die
//      Termine eine Stunde falsch, weil es den TZID nicht kennt.

import type { TripPlanMap } from '../hooks/useTripPlan'
import type { TripSlot } from '../types'
import { SLOTS, isoDay } from './tripPlan'
import { tripDays } from './trip'

export interface IcsEvent {
  /** eindeutige ID, stabil über Exporte hinweg (verhindert Dubletten beim Reimport) */
  uid: string
  /** 'YYYY-MM-DD' (lokal) */
  day: string
  /** 'HH:MM' (Europe/Madrid) */
  time: string
  durationMin: number
  title: string
  description?: string
  location?: string
}

/** Startzeiten je Tageszeit — bewusst grob, es ist ein Urlaubsplan. */
export const SLOT_TIME: Record<TripSlot, string> = {
  morning: '09:00',
  noon: '13:00',
  evening: '19:00',
}

const SLOT_DURATION: Record<TripSlot, number> = {
  morning: 120,
  noon: 120,
  evening: 150,
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 'HH:MM' + Minuten → 'HH:MM' (über Mitternacht wird umgebrochen) */
export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = ((h * 60 + m + minutes) % (24 * 60) + 24 * 60) % (24 * 60)
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

/** ICS-Text escapen (RFC 5545, Abschnitt 3.3.11) */
export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * Zeile auf 75 Oktetten falten. Fortsetzungszeilen beginnen mit einem Leerzeichen.
 * Oktette, nicht Zeichen: Umlaute belegen in UTF-8 zwei Bytes.
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) return line
  const out: string[] = []
  let current = ''
  let bytes = 0
  for (const char of line) {
    const size = encoder.encode(char).length
    // 75 minus das führende Leerzeichen der Fortsetzungszeile
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

/** Europe/Madrid: MEZ (letzter Sonntag im Oktober) und MESZ (letzter Sonntag im März).
 *  Als Zeilenliste, NICHT als ein Block: `foldIcsLine` arbeitet zeilenweise, ein
 *  zusammengeklebter Block wurde mitten in `BEGIN:DAYLIGHT` gefaltet. */
const VTIMEZONE_LINES = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Madrid',
  'X-LIC-LOCATION:Europe/Madrid',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
]

/** '2026-11-29' + '09:00' → '20261129T090000' */
export function icsStamp(day: string, time: string): string {
  return `${day.replace(/-/g, '')}T${time.replace(':', '')}00`
}

/** UTC-Stempel für DTSTAMP: '20261029T041500Z' */
function utcStamp(now: Date): string {
  return [
    now.getUTCFullYear(), pad(now.getUTCMonth() + 1), pad(now.getUTCDate()),
  ].join('') + 'T' + [pad(now.getUTCHours()), pad(now.getUTCMinutes()), pad(now.getUTCSeconds())].join('') + 'Z'
}

export interface BuildIcsOptions {
  calendarName: string
  events: IcsEvent[]
  /** Zeitstempel für DTSTAMP (Tests setzen ihn fest) */
  now?: Date
}

export function buildIcs({ calendarName, events, now = new Date() }: BuildIcsOptions): string {
  const stamp = utcStamp(now)
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Fiesta Siesta//Reiseplan//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    'X-WR-TIMEZONE:Europe/Madrid',
    ...VTIMEZONE_LINES,
  ]

  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Europe/Madrid:${icsStamp(event.day, event.time)}`,
      `DTEND;TZID=Europe/Madrid:${icsStamp(event.day, addMinutes(event.time, event.durationMin))}`,
      `SUMMARY:${escapeIcsText(event.title)}`,
    )
    if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`)
    if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.map(foldIcsLine).join('\r\n') + '\r\n'
}

/**
 * Termine aus dem (bestätigten) Plan bauen. `only` beschränkt auf einen Tag —
 * damit exportiert die Reiseplanung einzelne Tage.
 */
export function eventsFromPlan(plan: TripPlanMap, only?: string): IcsEvent[] {
  const events: IcsEvent[] = []
  for (const day of tripDays()) {
    const iso = isoDay(day)
    if (only && iso !== only) continue
    const dayPlan = plan[iso]
    if (!dayPlan) continue
    for (const slot of SLOTS) {
      const entry = dayPlan[slot.key]
      if (!entry) continue
      const parts = [entry.note, entry.place ? `Ort: ${entry.place}` : ''].filter(Boolean)
      events.push({
        uid: `${iso}-${slot.key}@fiesta-siesta`,
        day: iso,
        time: SLOT_TIME[slot.key],
        durationMin: SLOT_DURATION[slot.key],
        title: entry.title,
        description: parts.length > 0 ? parts.join('\n') : undefined,
        location: entry.place || undefined,
      })
    }
  }
  return events
}

/** Datei im Browser anstoßen (PWA-tauglich, kein Server nötig) */
export function downloadIcs(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Erst im nächsten Tick freigeben, sonst bricht Safari den Download ab.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
