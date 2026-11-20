// ── Luft am Zielort: Staub (Calima) & UV ─────────────────────────────
// Calima ist auf den Kanaren ein eigenes Wetter, kein Nebeneffekt: Der Passat
// dreht und fegt Saharastaub über die Inseln — der Himmel wird gelblich, die
// Sicht fällt auf wenige Kilometer, Atemwege und Herz spüren den Feinstaub.
// Ein Bergtag (Roque Nublo) verschiebt sich dann von selbst.
// Wichtig: Diese Werte sind MODELliert (Copernicus/CAMS), nicht gemessen —
// in Temisas steht kein Sensor. Für „wird es morgen trüb?" reicht die
// Größenordnung, für Luftreinhaltebeschlüsse nicht.

import { TRIP_LAT, TRIP_LON } from './trip'

export interface AirNow {
  /** Saharafeinstaub in µg/m³ (modelliert), aktuell */
  dust: number
  /** PM10 in µg/m³ */
  pm10: number
  /** PM2.5 in µg/m³ */
  pm2_5: number
  /** UV-Index, aktuell */
  uv: number
  /** European AQI, aktuell */
  aqi: number
  /** Maximum des Staubwerts der nächsten 24 Stunden (aus `hourly`) */
  dustNext24: number
  /** Zeitpunkt des Abrufs (ms) */
  at: number
}

const CACHE_KEY = 'fiesta-air-quality'
const FRESH_MS = 60 * 60 * 1000

function readCache(): AirNow | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AirNow
    if (!parsed || typeof parsed.dust !== 'number' || typeof parsed.at !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(entry: AirNow) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry))
  } catch {
    // Quota voll oder Speicher gesperrt — der RAM-Zustand reicht weiter
  }
}

/** Zuletzt gespeicherte Luftlage, ohne Netz. */
export function cachedAirNow(): AirNow | null {
  return readCache()
}

/** ISO-String ('YYYY-MM-DDTHH:MM' Ortszeit) um Stunden verschieben — beide
 *  Seiten derselben (Geräte-)Zeitzonen-Deutung, nur relativ verglichen. */
function isoPlusHours(iso: string, hours: number): string {
  const base = new Date(iso)
  if (Number.isNaN(base.getTime())) return iso
  const end = new Date(base.getTime() + hours * 3_600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${end.getFullYear()}-${p(end.getMonth() + 1)}-${p(end.getDate())}T${p(end.getHours())}:${p(end.getMinutes())}`
}

/**
 * Höchster Staubwert in den nächsten 24 Stunden. Die API liefert Ortszeit
 * (Atlantic/Canary, 'YYYY-MM-DDTHH:MM') — gleiche Form links und rechts,
 * daher darf hier String-Vergleich arbeiten. Ohne Zukunfts-Werte: 0.
 */
export function maxNext24(
  times: string[],
  values: Array<number | null | undefined>,
  nowIso: string,
): number {
  const now = (nowIso ?? '').slice(0, 16)
  const end = isoPlusHours(now, 24)
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < times.length; i += 1) {
    const t = (times[i] ?? '').slice(0, 16)
    if (!t || t <= now || t > end) continue
    const value = values[i]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    if (value > max) max = value
  }
  return Number.isFinite(max) ? max : 0
}

/** Saharastaub — Band beginnt je an der Schwelle (wie bei uvLevel). */
export function dustLevel(dust: number): 'klar' | 'etwas Staub' | 'Calima' {
  if (dust >= 50) return 'Calima'
  if (dust >= 25) return 'etwas Staub'
  return 'klar'
}

/** UV-Skala der WHO: Band „mäßig" beginnt bei 3, „hoch" bei 6 usw. */
export function uvLevel(uv: number): 'niedrig' | 'mäßig' | 'hoch' | 'sehr hoch' | 'extrem' {
  if (uv >= 11) return 'extrem'
  if (uv >= 8) return 'sehr hoch'
  if (uv >= 6) return 'hoch'
  if (uv >= 3) return 'mäßig'
  return 'niedrig'
}

/**
 * Aktuelle Luftlage (Staub, UV) am Zielort. Gibt bei Fehlern den letzten
 * gespeicherten Stand zurück — Beiwerk darf keinen Screen blockieren.
 */
export async function fetchAirNow(force = false): Promise<AirNow | null> {
  const cached = readCache()
  if (!force && cached && Date.now() - cached.at < FRESH_MS) return cached

  const url =
    'https://air-quality-api.open-meteo.com/v1/air-quality'
    + `?latitude=${TRIP_LAT}&longitude=${TRIP_LON}`
    + '&current=pm10,pm2_5,dust,uv_index,european_aqi'
    + '&hourly=dust,uv_index&forecast_days=3'
    // Atlantic/Canary, wie überall in der App — die Kanaren liegen eine
    // Stunde hinter Madrid, sonst wandern Stundenreihen um 1.
    + '&timezone=Atlantic%2FCanary'

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`Luft: HTTP ${res.status}`)
    const data = (await res.json()) as {
      current?: {
        time?: string
        dust?: number | null
        pm10?: number | null
        pm2_5?: number | null
        uv_index?: number | null
        european_aqi?: number | null
      }
      hourly?: {
        time?: string[]
        dust?: Array<number | null>
      }
    } | null
    const current = data?.current
    if (!current || typeof current.dust !== 'number') return cached

    const next: AirNow = {
      dust: current.dust,
      pm10: Number(current.pm10 ?? current.dust),
      pm2_5: Number(current.pm2_5 ?? 0),
      uv: Number(current.uv_index ?? 0),
      aqi: Number(current.european_aqi ?? 0),
      dustNext24: maxNext24(data?.hourly?.time ?? [], data?.hourly?.dust ?? [], current.time ?? ''),
      at: Date.now(),
    }
    writeCache(next)
    return next
  } catch {
    return cached
  }
}
