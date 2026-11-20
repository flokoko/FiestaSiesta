// ── Wikipedia am Weg ─────────────────────────────────────────────────
// Zu den Stopps des Tages fragt die deutsche Wikipedia per geosearch, was in
// 2,5 km Umkreis liegt, und holt dazu die Kurz-Zusammenfassung. Zwecklos ohne
// `origin=*` — die API schickt sonst keine CORS-Antwort (geprüft). Ein Eintrag
// pro Tag (Key `fiesta-geowiki:<dayIso>`, 12 h frisch): dieselben drei
// Geosearch-Stopps und Zusammenfassungen sollen nicht bei jedem Öffnen der
// Karte neu laufen. Bei Fehlern: leeres Array, kein Throw — die Karte rendert
// zuerst, der Abschnitt erscheint nach.

import { airKm } from './driveTime'

export interface GeoPoint {
  lat: number
  lon: number
}

export interface WikiPlace {
  title: string
  /** Luftlinie zum Stopp, an dem der Artikel gefunden wurde */
  km: number
  /** Zusammenfassung, auf ~220 Zeichen gekürzt */
  extract: string
  url: string
}

interface GeoHit {
  pageid: number
  title: string
  lat: number
  lon: number
}

/** Max 3 Stopps pro Tag abfragen, höchstens 4 Orte zeigen. */
const STOP_LIMIT = 3
const PLACE_LIMIT = 4
const FRESH_MS = 12 * 60 * 60 * 1000
const CACHE_KEY = 'fiesta-geowiki'

function cacheKey(dayIso: string): string {
  return `${CACHE_KEY}:${dayIso}`
}

function readCache(dayIso: string): { places: WikiPlace[]; at: number } | null {
  try {
    const raw = localStorage.getItem(cacheKey(dayIso))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { places?: unknown; at?: unknown }
    if (!parsed || !Array.isArray(parsed.places) || typeof parsed.at !== 'number') return null
    return { places: parsed.places as WikiPlace[], at: parsed.at }
  } catch {
    return null
  }
}

function writeCache(dayIso: string, places: WikiPlace[]) {
  try {
    localStorage.setItem(cacheKey(dayIso), JSON.stringify({ places, at: Date.now() }))
  } catch {
    // Quota voll oder Speicher gesperrt — der RAM-Zustand reicht weiter
  }
}

/** Zuletzt gespeicherte Orte des Tages, ohne Netz (null = nichts vorhanden). */
export function cachedGeoWiki(dayIso: string): WikiPlace[] | null {
  return readCache(dayIso)?.places ?? null
}

/**
 * Kürzt einen Wikipedia-Extrakt auf `max` Zeichen: an der letzten Satzgrenze
 * (Satzzeichen gefolgt von Leerraum oder Ende), sonst harten Schnitt.
 */
export function shortExtract(text: string, max = 220): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const head = clean.slice(0, max)
  for (let i = head.length - 1; i >= 1; i -= 1) {
    const ch = head[i]
    if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '…') continue
    const after = i + 1 < head.length ? head[i + 1] : ''
    // Satzende: Satzzeichen am Zeilenende oder vor Leerraum/Anführungszeichen.
    if (after === '' || after === ' ' || after === '"' || after === '”') {
      return head.slice(0, i + 1).trim()
    }
  }
  return head.trimEnd()
}

async function geosearch(point: GeoPoint): Promise<GeoHit[]> {
  const url =
    'https://de.wikipedia.org/w/api.php?action=query&format=json&list=geosearch'
    + `&gscoord=${point.lat}|${point.lon}&gsradius=2500&gslimit=4&origin=*`
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) return []
  const data = (await res.json()) as {
    query?: {
      geosearch?: Array<{
        pageid?: unknown
        title?: unknown
        lat?: unknown
        lon?: unknown
      }>
    }
  } | null
  const hits = data?.query?.geosearch
  if (!Array.isArray(hits)) return []
  return hits.filter(
    (hit): hit is GeoHit & { pageid: number; title: string } =>
      typeof hit.pageid === 'number' &&
      typeof hit.title === 'string' &&
      typeof hit.lat === 'number' &&
      typeof hit.lon === 'number',
  )
}

async function summaryFor(title: string): Promise<{ extract: string; url: string } | null> {
  const res = await fetch(
    `https://de.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
    { signal: AbortSignal.timeout(10_000) },
  )
  if (!res.ok) return null // 404 u. a. für Artikel, die es (noch) nicht gibt
  const data = (await res.json()) as {
    extract?: unknown
    content_urls?: { desktop?: { page?: unknown } }
  } | null
  const extract = typeof data?.extract === 'string' ? data.extract : ''
  if (!extract.trim()) return null
  const url =
    typeof data?.content_urls?.desktop?.page === 'string'
      ? data.content_urls.desktop.page
      : `https://de.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
  return { extract, url }
}

/**
 * Wikipedia-Orte zu den Tagesstopps. Gibt bei irgendeinem Fehler das Array
 * zurück, das es gibt — am liebsten den letzten Stand des Tages, sonst [].
 */
export async function fetchGeoWiki(dayIso: string, points: GeoPoint[]): Promise<WikiPlace[]> {
  const cached = readCache(dayIso)
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.places
  try {
    const seen = new Set<number>() // pageid als Dedupe-Schlüssel
    const candidates: Array<GeoHit & { km: number }> = []
    for (const point of points.slice(0, STOP_LIMIT)) {
      for (const hit of await geosearch(point)) {
        if (seen.has(hit.pageid)) continue
        seen.add(hit.pageid)
        candidates.push({ ...hit, km: airKm(hit.lat, hit.lon, point.lat, point.lon) })
      }
    }
    candidates.sort((a, b) => a.km - b.km)

    const places: WikiPlace[] = []
    for (const hit of candidates.slice(0, PLACE_LIMIT)) {
      const summary = await summaryFor(hit.title)
      if (!summary) continue
      places.push({
        title: hit.title,
        km: hit.km,
        extract: shortExtract(summary.extract),
        url: summary.url,
      })
    }
    if (places.length > 0) writeCache(dayIso, places)
    return places
  } catch {
    return cached?.places ?? []
  }
}
