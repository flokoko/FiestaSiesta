/**
 * Datums-Helfer in LOKALER Zeit.
 *
 * `new Date().toISOString().slice(0, 10)` liefert das UTC-Datum. In Deutschland
 * (UTC+1/+2) ist das zwischen 00:00 und 01:00/02:00 noch der Vortag — Bristol- und
 * Ausgaben-Einträge landeten dann auf dem falschen Tag, und „Heute"-Filter laufen
 * ins Leere. Überall `todayIso()` / `isoDay()` benutzen, nie `toISOString()` für
 * reine Kalendertage.
 */

const pad = (n: number) => String(n).padStart(2, '0')

/** Lokales Datum als YYYY-MM-DD. */
export function isoDay(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Heutiges lokales Datum als YYYY-MM-DD. */
export function todayIso(): string {
  return isoDay(new Date())
}

/** Tage addieren (negativ = zurück), lokal gerechnet. */
export function addDaysIso(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00`)
  d.setDate(d.getDate() + days)
  return isoDay(d)
}
