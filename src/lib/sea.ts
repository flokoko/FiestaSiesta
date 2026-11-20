// ── Meer & Gezeiten an der Südküste ──────────────────────────────────
// Die Kanaren sind der Atlantik: kühle Dünung, im Dezember 19–24 °C Wasser —
// keine Badewanne wie das Mittelmeer, aber zum Schwimmen gut. An der Nordküste
// (Las Palmas, Gáldar) fällt die See deutlich rauer aus; der Punkt hier liegt
// an der geschützten Südküste bei Playa del Inglés/Maspalomas (Punkt
// COAST_POINT). Die Gezeiten kommen aus der Vorhersage der Wassersäule (msl);
// die API liefert bereits ORTSZEIT — nicht umrechnen.

/** Punkt an der Südküste (Playa del Inglés), von dem Wellen und Wasser gelten. */
export const COAST_POINT = { lat: 27.756, lon: -15.578 }

export interface TideEvent {
  label: 'Hochwasser' | 'Niedrigwasser'
  /** 'HH:MM' Ortszeit — unverändert aus der API, nicht umgerechnet */
  clock: string
}

export interface SeaNow {
  /** Wellenhöhe in m, aktuell */
  wave: number
  /** Wellenperiode in s */
  period: number
  /** Wassertemperatur in °C */
  water: number
  /** die nächsten Gezeiten, höchstens `max` (Standard 2) */
  tide: TideEvent[]
  /** Zeitpunkt des Abrufs (ms) */
  at: number
}

const CACHE_KEY = 'fiesta-sea'
const FRESH_MS = 60 * 60 * 1000

function readCache(): SeaNow | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SeaNow
    if (!parsed || typeof parsed.wave !== 'number' || typeof parsed.at !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(entry: SeaNow) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry))
  } catch {
    // Quota voll oder Speicher gesperrt — der RAM-Zustand reicht weiter
  }
}

/** Zuletzt gespeicherte Seelage, ohne Netz. */
export function cachedSeaNow(): SeaNow | null {
  return readCache()
}

/** Wellenhöhe — Band beginnt je an der Schwelle. */
export function waveLevel(m: number): 'ruhig' | 'mäßig' | 'rau' | 'sehr rau' {
  if (m >= 2) return 'sehr rau'
  if (m >= 1.2) return 'rau'
  if (m >= 0.5) return 'mäßig'
  return 'ruhig'
}

/**
 * Lokale Minima/Maxima der Stundenreihe der msl-Wassersäule: ein High/Low ist
 * der Punkt, an dem die Differenz zum Vorpunkt ein Vorzeichen wechselt. Nur
 * Ereignisse nach `nowIso` (Zeitreihe und `nowIso` sind Ortszeit), höchstens
 * `max`, Uhrzeit als 'HH:MM' direkt aus dem ISO-String.
 */
export function tideExtremes(
  times: string[],
  heights: Array<number | null | undefined>,
  nowIso: string,
  max = 2,
): TideEvent[] {
  const now = (nowIso ?? '').slice(0, 16)
  const future: Array<{ t: string; h: number }> = []
  for (let i = 0; i < times.length; i += 1) {
    const h = Number(heights[i])
    if (!Number.isFinite(h)) continue
    const t = (times[i] ?? '').slice(0, 16)
    if (!t || t <= now) continue
    future.push({ t, h })
  }

  const out: TideEvent[] = []
  for (let i = 1; i < future.length - 1 && out.length < max; i += 1) {
    const rise = future[i].h - future[i - 1].h
    const fall = future[i + 1].h - future[i].h
    if (rise > 0 && fall <= 0) out.push({ label: 'Hochwasser', clock: future[i].t.slice(11, 16) })
    else if (rise <= 0 && fall > 0) out.push({ label: 'Niedrigwasser', clock: future[i].t.slice(11, 16) })
  }
  return out
}

/**
 * Wellen, Wassertemperatur und Gezeiten an der Südküste. Gibt bei Fehlern
 * den letzten gespeicherten Stand zurück — Beiwerk darf keinen Screen
 * blockieren.
 */
export async function fetchSeaNow(force = false): Promise<SeaNow | null> {
  const cached = readCache()
  if (!force && cached && Date.now() - cached.at < FRESH_MS) return cached

  const url =
    'https://marine-api.open-meteo.com/v1/marine'
    + `?latitude=${COAST_POINT.lat}&longitude=${COAST_POINT.lon}`
    + '&current=wave_height,wave_period,sea_surface_temperature'
    + '&hourly=sea_level_height_msl&forecast_days=3'
    + '&timezone=Atlantic%2FCanary'

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`Meer: HTTP ${res.status}`)
    const data = (await res.json()) as {
      current?: {
        time?: string
        wave_height?: number | null
        wave_period?: number | null
        sea_surface_temperature?: number | null
      }
      hourly?: {
        time?: string[]
        sea_level_height_msl?: Array<number | null>
      }
    } | null
    const current = data?.current
    const wave = current?.wave_height
    const water = current?.sea_surface_temperature
    // Ohne beide Kernwerte (Modell-Lücke) lieber den alten Stand zeigen
    // als „0,0 m · 0 °C".
    if (!current || typeof wave !== 'number' || typeof water !== 'number') return cached

    const next: SeaNow = {
      wave,
      period: Number(current.wave_period ?? 0),
      water,
      tide: tideExtremes(
        data?.hourly?.time ?? [],
        data?.hourly?.sea_level_height_msl ?? [],
        current.time ?? '',
        2,
      ),
      at: Date.now(),
    }
    writeCache(next)
    return next
  } catch {
    return cached
  }
}
