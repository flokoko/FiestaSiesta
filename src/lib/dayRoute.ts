// ── Tagesroute: Unterkunft → Programmpunkte des Tages ────────────────
// Grundlage für die Tageskarte. Zwei Quellen wie bei den Fahrzeiten:
//   1. OSRM (keylos) mit allen Wegpunkten in EINEM Request — liefert die
//      echte Linie für die Karte plus Gesamtzeit und Distanz. 30 Tage Cache.
//   2. Schätzung aus der Luftlinie (gestrichelte Luftlinie auf der Karte),
//      wenn OSRM schweigt (offline, Demo-Limit, Timeout). Nie als Route
//      ausgeben, was nur eine Schätzung ist — `source` steht in der UI.

import { TRIP_LAT, TRIP_LON } from './trip'
import { estimateMinutesBetween, airKm } from './driveTime'
import { SLOTS } from './tripPlan'
import type { DayPlan } from '../hooks/useTripPlan'

export interface RouteStop {
  id: string
  label: string
  lat: number
  lon: number
}

export interface DayRoute {
  /** [lat, lon] in Fahrtrichtung, Startpunkt ist die Unterkunft */
  points: Array<[number, number]>
  minutes: number
  km: number
  source: 'route' | 'estimate'
  /** Etappen zwischen den Wegpunkten (nur bei echter Route) */
  legs?: Array<{ minutes: number; km: number }>
}

export const HOME_POINT: [number, number] = [TRIP_LAT, TRIP_LON]

/** Halt Punkte des Tages in Slot-Reihenfolge (morgen → mittag → abend). */
export function buildDayStops(dayPlan: DayPlan | undefined): RouteStop[] {
  if (!dayPlan) return []
  const stops: RouteStop[] = []
  for (const slot of SLOTS) {
    const p = dayPlan[slot.key]
    if (!p || typeof p.place_lat !== 'number' || typeof p.place_lon !== 'number') continue
    stops.push({
      id: p.id,
      label: p.place ? p.place.split('·')[0].trim() : p.title,
      lat: p.place_lat,
      lon: p.place_lon,
    })
  }
  return stops
}

/** Etappen-Minuten zwischen zwei Punkten (Schätzung) — für die Liste unter der Karte. */
export function legMinutes(from: [number, number], to: RouteStop): number {
  return estimateMinutesBetween(from[0], from[1], to.lat, to.lon)
}

/** Luftlinie in km zwischen zwei Punkten. */
export function legKm(from: [number, number], to: RouteStop): number {
  return airKm(to.lat, to.lon, from[0], from[1])
}

/** Sofort verfügbare Route: Luftlinie + geschätzte Fahrzeit. */
export function quickDayRoute(stops: RouteStop[]): DayRoute {
  const points: Array<[number, number]> = [HOME_POINT, ...stops.map((s) => [s.lat, s.lon] as [number, number])]
  let minutes = 0
  let km = 0
  let from: [number, number] = HOME_POINT
  for (const stop of stops) {
    minutes += estimateMinutesBetween(from[0], from[1], stop.lat, stop.lon)
    km += airKm(stop.lat, stop.lon, from[0], from[1])
    from = [stop.lat, stop.lon]
  }
  return { points, minutes, km: Math.round(km), source: 'estimate' }
}

// v2: Einträge ohne `legs` (Etappen-Minuten) werden damit verworfen.
const CACHE_KEY = 'fiesta-day-routes-v2'
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const OSRM_TIMEOUT_MS = 6000
const MAX_CACHE_ENTRIES = 12

interface CacheEntry {
  at: number
  route: DayRoute
}
type Cache = Record<string, CacheEntry>

function routeKey(stops: RouteStop[]): string {
  return [HOME_POINT, ...stops.map((s) => [s.lat, s.lon] as [number, number])]
    .map(([lat, lon]) => `${lat.toFixed(3)},${lon.toFixed(3)}`)
    .join('|')
}

function readCache(): Cache {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as Cache) : {}
  } catch {
    return {}
  }
}

function writeCache(cache: Cache): void {
  try {
    const entries = Object.entries(cache)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_CACHE_ENTRIES)
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // voll oder gesperrt — die Schätzung reicht
  }
}

/** Zwischengespeicherte Route, falls vorhanden und nicht zu alt. */
export function cachedDayRoute(stops: RouteStop[]): DayRoute | null {
  if (stops.length === 0) return null
  const entry = readCache()[routeKey(stops)]
  if (!entry || Date.now() - entry.at > CACHE_TTL_MS) return null
  return entry.route
}

/**
 * Echte Route über OSRM. `overview=full` + `geometries=geojson` liefert die
 * Linie für die Karte; `null`, wenn der Dienst nicht antwortet — der Aufrufer
 * behält dann `quickDayRoute`.
 */
export async function fetchDayRoute(stops: RouteStop[]): Promise<DayRoute | null> {
  if (stops.length === 0) return null
  const cached = cachedDayRoute(stops)
  if (cached) return cached

  const coords = [HOME_POINT, ...stops.map((s) => [s.lat, s.lon] as [number, number])]
    .map(([lat, lon]) => `${lon},${lat}`)
    .join(';')
  const url =
    `https://router.project-osrm.org/route/v1/driving/${coords}` +
    `?overview=full&geometries=geojson&alternatives=false&steps=false`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    const json = (await res.json()) as {
      code?: string
      routes?: Array<{
        distance?: number
        duration?: number
        geometry?: { coordinates?: Array<[number, number]> }
        legs?: Array<{ distance?: number; duration?: number }>
      }>
    }
    const route = json.routes?.[0]
    const line = route?.geometry?.coordinates
    if (json.code !== 'Ok' || !route || !line || line.length < 2) return null

    const result: DayRoute = {
      // GeoJSON ist [lon, lat] — Leaflet will [lat, lon].
      points: line.map(([lon, lat]) => [lat, lon] as [number, number]),
      minutes: Math.max(1, Math.round((route.duration ?? 0) / 60)),
      km: Math.round(route.distance ?? 0) / 1000,
      source: 'route',
      legs: route.legs?.map((leg) => ({
        minutes: Math.max(1, Math.round((leg.duration ?? 0) / 60)),
        km: Math.round((leg.distance ?? 0) / 100) / 10,
      })),
    }
    const cache = readCache()
    cache[routeKey(stops)] = { at: Date.now(), route: result }
    writeCache(cache)
    return result
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Route für die Anzeige: Cache, sonst Schätzung. */
export function quickRouteFor(stops: RouteStop[]): DayRoute {
  return cachedDayRoute(stops) ?? quickDayRoute(stops)
}
