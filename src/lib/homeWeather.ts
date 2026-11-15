// ── Wetter zu Hause ──────────────────────────────────────────────────
// Der Tag-Screen zeigt, wie warm es vor Ort ist — der Vergleich dazu, wie
// kalt die Heimat gerade friert, macht den Urlaub erst greifbar. Der
// Heimatort ist eine Geräteeinstellung (localStorage), das Wetter kommt
// von Open-Meteo für `current` plus die Regenwahrscheinlichkeit des Tages.
//
// Alles ist Nebensache: Fehler → null, die Zeile verschwindet einfach.
// Kein Toast, kein Retry-Karussell. Abruf mit 10-s-Zeitlimit (halb offene
// Mobilfunkverbindungen hängen sonst ewig), Ergebnis 60 Minuten im
// localStorage, damit das Öffnen der App nicht jedes Mal fragt.

const HOME_KEY = 'fiesta_home_place'
const CACHE_KEY = 'fiesta-home-weather'
/** Ein Abruf pro Stunde reicht — das Wetter „zu Hause" ändert sich langsam. */
const FRESH_MS = 60 * 60 * 1000
const TIMEOUT_MS = 10_000

export interface HomePlace {
  lat: number
  lon: number
  name: string
}

export interface HomeWeather {
  /** °C, aktuell am Heimatort */
  temp: number
  /** WMO-Code */
  code: number
  /** Regenwahrscheinlichkeit für heute, in Prozent */
  rain: number
}

const round2 = (value: number): number => Number(value.toFixed(2))

/** Gespeicherten Heimatort lesen — null bei fehlenden oder kaputten Daten. */
export function readHomePlace(): HomePlace | null {
  try {
    const raw = localStorage.getItem(HOME_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<HomePlace> | null
    if (!parsed) return null
    const lat = Number(parsed.lat)
    const lon = Number(parsed.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''
    if (!name) return null
    return { lat, lon, name }
  } catch {
    return null
  }
}

/** Heimatort speichern (null entfernt ihn). Scheitern ist hier egal. */
export function writeHomePlace(place: HomePlace | null): void {
  try {
    if (!place) {
      localStorage.removeItem(HOME_KEY)
      return
    }
    if (
      !Number.isFinite(place.lat) ||
      !Number.isFinite(place.lon) ||
      !place.name.trim()
    ) {
      return
    }
    const next: HomePlace = { lat: place.lat, lon: place.lon, name: place.name.trim() }
    localStorage.setItem(HOME_KEY, JSON.stringify(next))
  } catch {
    // Voll oder gesperrt — die Einstellung ist nur für dieses Gerät.
  } finally {
    // Der Tag-Screen bleibt als Pane gemountet: ohne dieses Signal sähe er
    // eine Änderung aus den Einstellungen erst beim nächsten Sichtbarwerden.
    notifyHomeChange()
  }
}

/** Ereignis, auf das `useHomeWeather` hört (gleiche Idee wie ein Store-Event). */
export const HOME_CHANGE_EVENT = 'fiesta-home-change'

function notifyHomeChange(): void {
  try {
    window.dispatchEvent(new Event(HOME_CHANGE_EVENT))
  } catch {
    // Kein window (Node-Tests) — dann gibt es auch keine Zuhörer.
  }
}

/**
 * Standard-Heimatorte je Teilnehmer. Die drei Mitreisenden wohnen nicht am
 * selben Ort — ohne diese Zuordnung müsste jeder seinen Ort selbst eintragen,
 * bevor die Vergleichszeile zum ersten Mal erscheint.
 *
 * Koordinaten einmalig über Open-Meteo-Geocoding geholt (Stadtmitte).
 */
const HOME_DEFAULTS: Record<string, HomePlace> = {
  floko: { name: 'München', lat: 48.13743, lon: 11.57549 },
  peter: { name: 'München', lat: 48.13743, lon: 11.57549 },
  andrésito: { name: 'Landshut', lat: 48.52961, lon: 12.16179 },
}

/** Namensschlüssel: getrimmt, klein, NFC — „Andrésito" und „andresito" sind nicht dasselbe, aber Leerzeichen und Groß-/Kleinschreibung sollen egal sein. */
function nameKey(value: string): string {
  return value.trim().toLowerCase().normalize('NFC')
}

/** Standard-Heimatort zur Teilnehmer-Name — null, wenn keiner hinterlegt ist. */
export function defaultHomePlace(userName: string): HomePlace | null {
  if (!userName) return null
  return HOME_DEFAULTS[nameKey(userName)] ?? null
}

/**
 * Effektiver Heimatort: eine eigene Einstellung auf dem Gerät gewinnt, sonst
 * der Standard des Namens. So funktioniert die Zeile ab dem ersten Login, und
 * wer umzieht oder woanders wohnt, überschreibt sie einmal in den Einstellungen.
 */
export function effectiveHomePlace(userName: string): HomePlace | null {
  return readHomePlace() ?? defaultHomePlace(userName)
}

/**
 * Ortsname → Koordinaten für den Heimatort.
 *
 * NICHT `geocodePlace` aus lib/poiCoords: das ist auf Gran Canaria geeicht
 * (nur Treffer in Spanien innerhalb ~170 km um Temisas) und liefert für
 * „Landshut" oder „München" immer null. Hier zählt der erste plausible Treffer
 * weltweit — der Heimatort liegt in Deutschland, nicht auf der Insel.
 */
export async function geocodeHomePlace(name: string): Promise<HomePlace | null> {
  const query = name.trim()
  if (query.length < 3) return null
  const url =
    'https://geocoding-api.open-meteo.com/v1/search'
    + `?name=${encodeURIComponent(query)}&count=1&language=de&format=json`
  try {
    const res = await fetchWithTimeout(url, TIMEOUT_MS)
    if (!res.ok) return null
    const data = (await res.json()) as {
      results?: Array<{ name?: string; latitude?: number; longitude?: number }>
    }
    const hit = data.results?.[0]
    if (!hit || typeof hit.latitude !== 'number' || typeof hit.longitude !== 'number') return null
    if (!Number.isFinite(hit.latitude) || !Number.isFinite(hit.longitude)) return null
    return {
      lat: hit.latitude,
      lon: hit.longitude,
      name: (hit.name || query).trim(),
    }
  } catch {
    return null
  }
}

interface CacheEntry {
  /** Koordinaten auf 2 Dezimalstellen — ein Haus bewegt sich nicht. */
  lat: number
  lon: number
  at: number
  data: HomeWeather
}

function readCache(): CacheEntry | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as CacheEntry | null
    if (!parsed || typeof parsed.at !== 'number') return null
    if (!Number.isFinite(parsed.lat) || !Number.isFinite(parsed.lon)) return null
    const data = parsed.data
    if (
      !data ||
      typeof data.temp !== 'number' ||
      typeof data.code !== 'number' ||
      typeof data.rain !== 'number'
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/** fetch mit Zeitlimit — gleiche Technik wie in lib/liveWeather.ts (privat dort). */
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
 * Aktuelle Lage am Heimatort. Cache nur, wenn die Koordinaten auf zwei
 * Dezimalstellen übereinstimmen — sonst stünde Bonn dort, obwohl jetzt
 * Hamburg eingetragen ist. Bei Fehlschlag null, ohne Netzwerkrest.
 */
export async function fetchHomeWeather(place: HomePlace, force = false): Promise<HomeWeather | null> {
  const lat = round2(place.lat)
  const lon = round2(place.lon)
  const cached = readCache()
  if (!force && cached && cached.lat === lat && cached.lon === lon && Date.now() - cached.at < FRESH_MS) {
    return cached.data
  }

  const url =
    'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${lat}&longitude=${lon}`
    + '&current=temperature_2m,weather_code'
    + '&daily=precipitation_probability_max'
    + '&forecast_days=1&timezone=auto'

  try {
    const res = await fetchWithTimeout(url, TIMEOUT_MS)
    if (!res.ok) return null
    const data = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number }
      daily?: { precipitation_probability_max?: number[] }
    }
    const temp = Number(data?.current?.temperature_2m)
    if (!Number.isFinite(temp)) return null

    const weather: HomeWeather = {
      temp,
      code: Number(data?.current?.weather_code ?? 0),
      rain: Number(data?.daily?.precipitation_probability_max?.[0] ?? 0),
    }
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ lat, lon, at: Date.now(), data: weather }))
    } catch {
      // Quota voll — der Abruf gilt trotzdem.
    }
    return weather
  } catch {
    return null
  }
}
