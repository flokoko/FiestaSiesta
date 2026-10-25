// ── Wetter-Vorschau für die Reisetage ────────────────────────────────
// Open-Meteo liefert 16 Tage im Voraus. Der Reiseplan zeigt pro Tageskarte
// ein kleines Wetter-Abzeichen, sobald der Tag in diesem Fenster liegt.
// Der letzte erfolgreiche Abruf liegt in localStorage: Im Urlaub ist die
// App oft offline, dann sollen die zuletzt bekannten Werte stehen bleiben.

import { TRIP_LAT, TRIP_LON } from './trip'

export interface DayWeather {
  /** WMO-Code */
  code: number
  tMax: number
  tMin: number
  /** Regenwahrscheinlichkeit in Prozent */
  rain: number
  /** Windspitze in km/h */
  wind: number
}

/** Schlüssel: ISO-Datum (YYYY-MM-DD) */
export type TripForecast = Record<string, DayWeather>

const CACHE_KEY = 'fiesta-trip-weather'
/** Vorschau veraltet langsam — stündlich reicht völlig. */
const FRESH_MS = 60 * 60 * 1000

interface CacheEntry {
  at: number
  days: TripForecast
}

function readCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry
    if (!parsed?.days || typeof parsed.at !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(entry: CacheEntry) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry))
  } catch {
    // Quota voll oder Speicher gesperrt — dann bleibt nur der RAM-Zustand
  }
}

/** Zuletzt gespeicherte Vorschau, ohne Netz. */
export function cachedTripForecast(): TripForecast {
  return readCache()?.days ?? {}
}

/** fetch mit Zeitlimit — halb offene Mobilfunkverbindungen hängen sonst ewig. */
async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Tagesvorschau für den Unterkunftsort. Gibt die zwischengespeicherten Werte
 * zurück, wenn der Abruf scheitert (offline, 429, Timeout) — nie einen Fehler
 * nach außen, das Wetter ist Beiwerk und darf keinen Screen blockieren.
 */
export async function fetchTripForecast(force = false): Promise<TripForecast> {
  const cached = readCache()
  if (!force && cached && Date.now() - cached.at < FRESH_MS) return cached.days

  const url =
    'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${TRIP_LAT}&longitude=${TRIP_LON}`
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max'
    + '&timezone=Europe%2FMadrid&forecast_days=16'

  try {
    const res = await fetchWithTimeout(url, 10000)
    if (!res.ok) throw new Error(`Wetter-Vorschau: HTTP ${res.status}`)
    const data = await res.json()
    const time: string[] = data?.daily?.time ?? []
    if (time.length === 0) return cached?.days ?? {}

    const days: TripForecast = {}
    time.forEach((iso, i) => {
      days[iso] = {
        code: Number(data.daily.weather_code?.[i] ?? 0),
        tMax: Number(data.daily.temperature_2m_max?.[i] ?? 0),
        tMin: Number(data.daily.temperature_2m_min?.[i] ?? 0),
        rain: Number(data.daily.precipitation_probability_max?.[i] ?? 0),
        wind: Number(data.daily.wind_speed_10m_max?.[i] ?? 0),
      }
    })
    writeCache({ at: Date.now(), days })
    return days
  } catch {
    return cached?.days ?? {}
  }
}
