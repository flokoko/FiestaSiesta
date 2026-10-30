// ── Ortskoordinaten für Reiseziele ───────────────────────────────────
// Zwei Wege zu einem Punkt auf der Insel:
//   1. ein eingefügter Google-Maps-Link (exakt, was Flo in Maps markiert hat)
//   2. der Ortsname → Open-Meteo-Geocoding, auf Gran Canaria gebiaset
// Der Link gewinnt immer. Ohne Koordinaten gibt es kein Ziel-Wetter — dann
// bleibt es beim Tageswetter der Unterkunft, statt einen falschen Ort zu raten.

import { TRIP_LAT, TRIP_LON } from './trip'

export interface Coords {
  lat: number
  lon: number
  /** 'link' = aus Maps-Link gelesen, 'name' = geokodiert */
  source: 'link' | 'name'
}

const GEOCODE_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search'
const GEOCODE_CACHE = 'fiesta-geocode'

/** Grobe Prüfung, ob der Text als Maps-Link gemeint ist. */
export function isMapsUrl(input: string): boolean {
  const value = input.trim()
  if (!/^https?:\/\//i.test(value)) return false
  return /(^|\.)google\.[a-z.]+$|(^|\.)goo\.gl$|maps\.app\.goo\.gl$|(^|\.)maps\.google\./i.test(
    safeHost(value),
  )
}

function safeHost(value: string): string {
  try {
    return new URL(value).hostname
  } catch {
    return ''
  }
}

function valid(lat: number, lon: number): Coords | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  // 0/0 liegt im Atlantik — das ist immer ein Parse-Unfall, kein Ziel.
  if (Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001) return null
  return { lat, lon, source: 'link' }
}

/**
 * Koordinaten aus einem Google-Maps-Link. Abgedeckte Formen:
 *   .../@27.90937,-15.50733,15z          (Kartenausschnitt)
 *   ...!3d27.90937!4d-15.50733           (markierter Ort)
 *   ...?q=27.90937,-15.50733             (Suche)
 *   ...?ll=… | ?query=… | ?daddr=… | ?destination=… | ?center=…
 *   .../place/27.90937,-15.50733
 * Kurzlinks (maps.app.goo.gl/…) lösen erst im Browser auf und enthalten keine
 * Zahlen — sie liefern null und fallen auf den Ortsnamen zurück.
 */
export function coordsFromMapsUrl(input: string | null | undefined): Coords | null {
  if (!input) return null
  const value = input.trim()
  if (!isMapsUrl(value)) return null

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }

  const at = url.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
  if (at) return valid(Number(at[1]), Number(at[2]))

  const d3 = url.pathname.match(/!3d(-?\d+(?:\.\d+)?)/)
  const d4 = url.pathname.match(/!4d(-?\d+(?:\.\d+)?)/)
  if (d3 && d4) return valid(Number(d3[1]), Number(d4[1]))

  for (const key of ['q', 'query', 'll', 'center', 'destination', 'daddr', 'viewpoint']) {
    const raw = url.searchParams.get(key)
    if (!raw) continue
    const pair = raw.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
    if (pair) return valid(Number(pair[1]), Number(pair[2]))
  }

  const pair = url.pathname.match(/\/(-?\d{1,2}\.\d{3,}),(-?\d{1,3}\.\d{3,})(?:[/,]|$)/)
  if (pair) return valid(Number(pair[1]), Number(pair[2]))

  return null
}

interface GeocodeHit {
  latitude: number
  longitude: number
  name: string
  country_code?: string
  admin1?: string
}

type GeocodeCache = Record<string, Coords | { lat: number; lon: number; name: string }>

function readGeocodeCache(): GeocodeCache {
  try {
    return JSON.parse(localStorage.getItem(GEOCODE_CACHE) ?? '{}') as GeocodeCache
  } catch {
    return {}
  }
}

function writeGeocodeCache(next: GeocodeCache): void {
  try {
    localStorage.setItem(GEOCODE_CACHE, JSON.stringify(next))
  } catch {
    // voller Speicher ist hier egal — dann wird beim nächsten Mal neu gefragt
  }
}

/**
 * Ortsname → Koordinaten. Ohne Ergebnis auf Gran Canaria (z. B. „Temisas"
 * kennt die API nicht) wird auf den nächsten Treffer in Spanien zurückgefallen,
 * aber nur wenn er plausibel in der Nähe liegt — sonst lieber kein Wetter.
 */
export async function geocodePlace(name: string): Promise<Coords | null> {
  const query = name.trim()
  if (query.length < 3) return null

  const cache = readGeocodeCache()
  const cached = cache[query]
  if (cached && 'source' in cached) return cached

  const url = `${GEOCODE_ENDPOINT}?name=${encodeURIComponent(query)}&count=5&language=de&format=json`
  let hits: GeocodeHit[] = []
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const data = (await res.json()) as { results?: GeocodeHit[] }
    hits = data.results ?? []
  } catch {
    return null
  }
  if (hits.length === 0) return null

  const distance = (hit: GeocodeHit) => {
    const dLat = hit.latitude - TRIP_LAT
    const dLon = (hit.longitude - TRIP_LON) * Math.cos((TRIP_LAT * Math.PI) / 180)
    return Math.hypot(dLat, dLon)
  }
  // Nur Treffer innerhalb ~1,5 Breitengrade (~170 km) gelten als „auf den Kanaren".
  const nearby = hits
    .filter((hit) => hit.country_code === 'ES' && distance(hit) < 1.5)
    .sort((a, b) => distance(a) - distance(b))
  const best = nearby[0]
  if (!best) return null

  const coords: Coords = { lat: best.latitude, lon: best.longitude, source: 'name' }
  writeGeocodeCache({ ...cache, [query]: coords })
  return coords
}

/**
 * Ortsname zu Koordinaten (Nominatim-Reverse). Damit bekommt eine eingefügte
 * Maps-URL einen lesbaren Namen statt einer 200-Zeichen-URL in der Planzeile.
 * Scheitert still: dann bleibt der Name, den Flo getippt hat.
 */
export async function reverseLabel(lat: number, lon: number): Promise<string | null> {
  const key = `rev:${lat.toFixed(3)},${lon.toFixed(3)}`
  const cache = readGeocodeCache()
  const cached = cache[key]
  if (cached && 'name' in cached) return cached.name

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=de&lat=${lat}&lon=${lon}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const data = (await res.json()) as {
      name?: string
      address?: Record<string, string>
    }
    const address = data.address ?? {}
    const label =
      data.name ||
      address.village ||
      address.town ||
      address.city ||
      address.hamlet ||
      address.municipality ||
      null
    if (!label) return null
    writeGeocodeCache({ ...cache, [key]: { ...{ lat, lon }, name: label } })
    return label
  } catch {
    return null
  }
}

/**
 * Koordinaten für einen Vorschlag bestimmen: der Maps-Link gewinnt, sonst der
 * Ortsname. Gibt zusätzlich zurück, ob der Link brauchbar war (dann wird er
 * als place_url gespeichert).
 */
export async function resolvePlaceCoords(place: string | null, link?: string | null): Promise<{
  coords: Coords | null
  url: string | null
}> {
  const fromLink = coordsFromMapsUrl(link) ?? coordsFromMapsUrl(place)
  if (fromLink) return { coords: fromLink, url: link?.trim() || (place?.trim() || null) }

  const name = (place ?? '').split('·')[0].trim()
  if (!name || isMapsUrl(name)) return { coords: null, url: null }
  return { coords: await geocodePlace(name), url: link?.trim() || null }
}
