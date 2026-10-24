// ── Reise-Metadaten ─────────────────────────────────────────────────
// Phase 1: statisch. In Phase 3 kommen Tage und Programmpunkte aus der DB.

export interface TripInfo {
  name: string
  place: string
  /** erster Reisetag, ISO (YYYY-MM-DD) */
  start: string
  /** letzter Reisetag, ISO, inklusive */
  end: string
}

export const TRIP: TripInfo = {
  name: 'Gran Canaria',
  place: 'Norden · Las Palmas',
  start: '2026-11-29',
  end: '2026-12-06',
}

export type TripPhase = 'before' | 'during' | 'after'

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/** Mitternacht des übergebenen Tages (lokale Zeit) */
export function atMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export const TRIP_START = atMidnight(parseIso(TRIP.start))
export const TRIP_END = atMidnight(parseIso(TRIP.end))

const DAY_MS = 24 * 60 * 60 * 1000

function diffDays(a: Date, b: Date): number {
  return Math.round((atMidnight(b).getTime() - atMidnight(a).getTime()) / DAY_MS)
}

/** Anzahl Reisetage inklusive An- und Abreisetag */
export const TRIP_LENGTH = diffDays(TRIP_START, TRIP_END) + 1

export function tripPhase(today: Date = new Date()): TripPhase {
  const d = atMidnight(today)
  if (d < TRIP_START) return 'before'
  if (d > TRIP_END) return 'after'
  return 'during'
}

/** 1-basierter Reisetag, oder null außerhalb der Reise */
export function tripDay(today: Date = new Date()): number | null {
  if (tripPhase(today) !== 'during') return null
  return diffDays(TRIP_START, today) + 1
}

/** Tage bis zur Abreise; 0 wenn es heute losgeht, negativ danach */
export function daysUntilTrip(today: Date = new Date()): number {
  return diffDays(today, TRIP_START)
}

/** Alle Reisetage als Datum, inklusive An- und Abreisetag */
export function tripDays(): Date[] {
  const out: Date[] = []
  for (let i = 0; i < TRIP_LENGTH; i += 1) {
    out.push(new Date(TRIP_START.getTime() + i * DAY_MS))
  }
  return out
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const
const LONG_DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'] as const
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August',
  'September', 'Oktober', 'November', 'Dezember'] as const

/** 'Mo 30.11.' */
export function formatDayShort(date: Date): string {
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()}.${date.getMonth() + 1}.`
}

/** 'Montag, 1. Dezember' */
export function formatDayLong(date: Date): string {
  return `${LONG_DAYS[date.getDay()]}, ${date.getDate()}. ${MONTHS[date.getMonth()]}`
}

/** '29.11. – 06.12.' */
export function formatRange(): string {
  const f = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`
  return `${f(TRIP_START)} – ${f(TRIP_END)}`
}
