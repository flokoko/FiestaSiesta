// ── Fahrzeit von der Unterkunft zum Programmpunkt ────────────────────
// Temisas liegt 11 km Bergstraße über Agüimes; ein Vorlauf von 20 Minuten
// reicht für ein Ziel im Süden nicht. Diese Datei liefert die Zahl, die im
// Wecker-Editor steht — bewusst als NÄHERUNG, nie als Ankunftsversprechen.
//
// Zwei Quellen:
//   1. OSRM (keylos, `router.project-osrm.org`) — echte Route, Ergebnis 30 Tage
//      im localStorage zwischengespeichert.
//   2. Schätzung aus der Luftlinie, wenn OSRM nicht antwortet (offline, Timeout,
//      Demo-Limit). Sie ist absichtlich konservativ: lieber zu früh losfahren.
//
// Der Bergfaktor ist Erfahrungswert für die Barrancos: Serpentinen, enge
// Ortsdurchfahrten, selten über 50 km/h.

import { TRIP_LAT, TRIP_LON } from './trip'

export type DriveSource = 'route' | 'estimate'

export interface DriveTime {
  /** Minuten, auf 5 gerundet */
  minutes: number
  /** 'route' = OSRM, 'estimate' = aus der Luftlinie gerechnet */
  source: DriveSource
}

const CACHE_KEY = 'fiesta-drive-times'
/** 30 Tage: Straßen ändern sich nicht, und OSRM soll nicht bei jedem Öffnen gefragt werden. */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const OSRM_TIMEOUT_MS = 4500

/** Luftlinie in km (Haversine). */
export function airKm(lat: number, lon: number, fromLat = TRIP_LAT, fromLon = TRIP_LON): number {
  const R = 6371
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat - fromLat)
  const dLon = toRad(lon - fromLon)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(fromLat)) * Math.cos(toRad(lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Schätzung aus der Luftlinie: Straßenfaktor 1,6 plus 2 km Ortsdurchfahrt,
 * 32 km/h Schnitt, 3 Minuten für Auto/Parkplatz, ab 8 km Luftlinie 10 % Zuschlag
 * für Serpentinen.
 *
 * Bewusst nach oben gerundet: gegen die echten OSRM-Werte (Arinaga 33 Min,
 * Roque Nublo 70 Min) liegt die Schätzung teils deutlich daneben — bei einem
 * Wecker ist „zu früh losfahren" der harmlosere Fehler als „zu spät".
 */
export function estimateDriveMinutes(lat: number, lon: number): number {
  const air = airKm(lat, lon)
  // Weniger als 1 km Luftlinie: kein Fahrziel, sondern die Unterkunft selbst.
  if (air < 1) return 5
  const km = air * 1.6 + 2
  // Weite Ziele (Las Palmas, Flughafen) laufen über die GC-1 — dort sind
  // 32 km/h genauso falsch wie der Bergzuschlag.
  if (air > 20) return Math.max(5, Math.round((km / 55) * 60 + 3))
  const base = (km / 32) * 60 + 3
  const mountain = air > 8 ? base * 1.1 : base
  return Math.max(5, Math.round(mountain))
}

function round5(minutes: number): number {
  return Math.max(5, Math.round(minutes / 5) * 5)
}

interface CacheEntry {
  minutes: number
  at: number
}
type Cache = Record<string, CacheEntry>

function key(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`
}

function readCache(): Cache {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Cache
  } catch {
    return {}
  }
}

function writeCache(cache: Cache): void {
  try {
    // Nur die jüngsten 50 Einträge behalten, sonst wächst der Eintrag sinnlos.
    const entries = Object.entries(cache)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 50)
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // voll oder gesperrt — die Schätzung reicht
  }
}

/** Zwischengespeicherte Route, falls vorhanden und nicht zu alt. */
export function cachedDriveTime(lat: number, lon: number): DriveTime | null {
  const entry = readCache()[key(lat, lon)]
  if (!entry) return null
  if (Date.now() - entry.at > CACHE_TTL_MS) return null
  return { minutes: entry.minutes, source: 'route' }
}

/** Sofort verfügbarer Wert: Cache, sonst Schätzung. */
export function quickDriveTime(lat: number, lon: number): DriveTime {
  return cachedDriveTime(lat, lon) ?? { minutes: estimateDriveMinutes(lat, lon), source: 'estimate' }
}

/**
 * Schätzung zwischen zwei beliebigen Punkten (Etappen einer Tagesroute).
 * Dieselbe Heuristik wie `estimateDriveMinutes`, nur ohne festen Startpunkt.
 */
export function estimateMinutesBetween(fromLat: number, fromLon: number, lat: number, lon: number): number {
  const air = airKm(lat, lon, fromLat, fromLon)
  if (air < 0.4) return 0
  const km = air * 1.6 + 2
  const base = (km / 32) * 60 + 3
  const mountain = air > 8 ? base * 1.1 : base
  return Math.max(5, Math.round(mountain))
}

/**
 * Echte Route über OSRM. Gibt `null` zurück, wenn der Dienst nicht antwortet —
 * der Aufrufer behält dann die Schätzung.
 */
export async function fetchDriveTime(lat: number, lon: number): Promise<DriveTime | null> {
  const cached = cachedDriveTime(lat, lon)
  if (cached) return cached

  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${TRIP_LON},${TRIP_LAT};${lon},${lat}?overview=false&alternatives=false`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    const data = (await res.json()) as {
      code?: string
      routes?: Array<{ duration: number }>
    }
    const seconds = data.routes?.[0]?.duration
    if (data.code !== 'Ok' || typeof seconds !== 'number' || !Number.isFinite(seconds)) return null
    const minutes = round5(seconds / 60)
    const cache = readCache()
    cache[key(lat, lon)] = { minutes, at: Date.now() }
    writeCache(cache)
    return { minutes, source: 'route' }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Reicht der Vorlauf? 5 Minuten Puffer für Schuhe, Rucksack, Parkplatz.
 * `minutes` ist die Fahrzeit, `lead` der eingestellte Wecker-Vorlauf.
 */
export function leadIsTight(lead: number, minutes: number): boolean {
  return lead < minutes + 5
}

/** Empfohlener Vorlauf: Fahrzeit plus 5 Minuten Puffer, auf 5 aufgerundet. */
export function recommendedLead(minutes: number): number {
  return Math.ceil((minutes + 5) / 5) * 5
}
