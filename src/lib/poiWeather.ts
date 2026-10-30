// ── Ziel-Wetter: Vorhersage am Ort des Ausflugs, nicht in Temisas ────
// Ein Tag im Bergdorf kann 19 °C haben, während auf dem Roque Nublo 8 °C und
// 45 km/h Wind herrschen. Open-Meteo liefert dieselbe Tagesvorhersage für einen
// beliebigen Punkt — und die Modell-Höhe gleich mit, die wir als Höhenmeter
// anzeigen. Mehrere Punkte gehen in EINEM Request (latitude=…,lon=…,lat=…).

import { TRIP_LAT, TRIP_LON } from './trip'

/** Open-Meteo liefert 16 Tage im Voraus — dieselbe Grenze wie das Tageswetter. */
export const POI_FORECAST_WINDOW_DAYS = 16

export interface PoiDayWeather {
  /** WMO-Code */
  code: number
  tMax: number
  tMin: number
  /** Regenwahrscheinlichkeit in Prozent */
  rain: number
  /** Windspitze km/h */
  wind: number
}

export interface PoiWeather {
  /** Modell-Höhe über NN in Metern (null, wenn die API nichts liefert) */
  elevation: number | null
  /** Schlüssel: ISO-Datum */
  days: Record<string, PoiDayWeather>
}

/** Schlüssel = gerundete Koordinaten, siehe pointKey() */
export type PoiForecast = Record<string, PoiWeather>

const CACHE_KEY = 'fiesta-poi-weather'
const FRESH_MS = 60 * 60 * 1000
const ENDPOINT = 'https://api.open-meteo.com/v1/forecast'

export interface PoiPoint {
  lat: number
  lon: number
}

/** 3 Nachkommastellen ≈ 110 m — genauer braucht kein Wettermodell zu sein. */
export function pointKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`
}

interface CacheEntry {
  at: number
  byPoint: PoiForecast
}

function readCacheEntry(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry
    if (!parsed?.byPoint || typeof parsed.at !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

/** Letzter Stand aus dem Cache — im Funkloch besser als kein Wert. */
export function readPoiCache(): PoiForecast {
  return readCacheEntry()?.byPoint ?? {}
}

function isoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Liegt der Tag im 16-Tage-Fenster von Open-Meteo? */
export function dayInForecastWindow(iso: string): boolean {
  const target = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(target.getTime())) return false
  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const end = new Date(start)
  end.setDate(end.getDate() + POI_FORECAST_WINDOW_DAYS)
  return target >= start && target <= end
}

/**
 * Vorhersage für mehrere Punkte. Tage außerhalb des API-Fensters lassen wir
 * weg — sonst antwortet Open-Meteo mit 400 und wir verlieren auch die Tage,
 * die gegangen wären. Rückgabe wird mit dem Cache verschmolzen.
 */
export async function fetchPoiWeather(
  points: PoiPoint[],
  days: string[],
): Promise<PoiForecast> {
  const cached = readCacheEntry()
  const byPoint: PoiForecast = { ...(cached?.byPoint ?? {}) }

  const wanted = Array.from(new Set(days.filter(dayInForecastWindow))).sort()
  const unique = new Map<string, PoiPoint>()
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue
    unique.set(pointKey(p.lat, p.lon), p)
  }
  if (wanted.length === 0 || unique.size === 0) return byPoint

  const list = Array.from(unique.entries())
  const params = new URLSearchParams({
    latitude: list.map(([, p]) => p.lat.toFixed(4)).join(','),
    longitude: list.map(([, p]) => p.lon.toFixed(4)).join(','),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',
    timezone: 'Atlantic/Canary',
    start_date: wanted[0],
    end_date: wanted[wanted.length - 1],
  })

  let payload: unknown
  try {
    const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return byPoint
    payload = await res.json()
  } catch {
    return byPoint
  }

  const locations = (Array.isArray(payload) ? payload : [payload]) as Array<{
    elevation?: number
    daily?: {
      time?: string[]
      weather_code?: number[]
      temperature_2m_max?: number[]
      temperature_2m_min?: number[]
      precipitation_probability_max?: Array<number | null>
      wind_speed_10m_max?: number[]
    }
  }>

  locations.forEach((loc, index) => {
    const key = list[index]?.[0]
    const daily = loc.daily
    if (!key || !daily?.time) return
    const daysOut: Record<string, PoiDayWeather> = {}
    daily.time.forEach((iso, i) => {
      const tMax = daily.temperature_2m_max?.[i]
      const tMin = daily.temperature_2m_min?.[i]
      if (typeof tMax !== 'number' || typeof tMin !== 'number') return
      daysOut[iso] = {
        code: daily.weather_code?.[i] ?? 0,
        tMax,
        tMin,
        rain: daily.precipitation_probability_max?.[i] ?? 0,
        wind: daily.wind_speed_10m_max?.[i] ?? 0,
      }
    })
    if (Object.keys(daysOut).length === 0) return
    byPoint[key] = {
      elevation: typeof loc.elevation === 'number' ? loc.elevation : null,
      // vorhandene Tage des Punktes behalten, neue überschreiben
      days: { ...(byPoint[key]?.days ?? {}), ...daysOut },
    }
  })

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), byPoint }))
  } catch {
    // Speicher voll: Cache ist Komfort, kein Muss
  }
  return byPoint
}

/** Ist der Cache älter als eine Stunde? */
export function poiCacheStale(): boolean {
  const entry = readCacheEntry()
  if (!entry) return true
  return Date.now() - entry.at > FRESH_MS
}

/** Mittelpunkt der Insel als Referenz für „ist das weit weg?"-Vergleiche. */
export const ISLAND_CENTER = { lat: TRIP_LAT, lon: TRIP_LON }

export { isoDay }
