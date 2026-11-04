// ── Wetter am Zielort, jetzt ─────────────────────────────────────────
// Der Heute-Screen zeigt eine Wetterkarte mit der aktuellen Lage in
// Temisas. Anders als die Reisevorschau (16-Tage-Fenster) braucht sie
// kein Vorlaufdatum: Open-Meteo liefert `current` immer. Ein Abruf,
// 20 Minuten frisch, letzter Stand in localStorage (im Urlaub ist die
// App oft offline — dann steht die zuletzt bekannte Lage weiter da).

import { TRIP_LAT, TRIP_LON } from './trip'
import { sunClock } from './tripWeather'

export interface LiveWeather {
  /** °C, aktuell */
  temp: number
  /** °C, gefühlt */
  feels: number
  /** WMO-Code */
  code: number
  /** km/h */
  wind: number
  /** Tag oder Nacht am Zielort (Open-Meteo `is_day`) */
  isDay: boolean
  /** Tageshöchst- und -tiefstwert in °C */
  tMax: number
  tMin: number
  /** Regenwahrscheinlichkeit für heute in Prozent */
  rain: number
  /** 'HH:MM' Ortszeit Kanaren */
  sunrise: string
  sunset: string
  /** Zeitpunkt des Abrufs (ms) */
  at: number
}

export type SkyTone = 'clear' | 'partly' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm'

const CACHE_KEY = 'fiesta-live-weather'
const FRESH_MS = 20 * 60 * 1000

function readCache(): LiveWeather | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LiveWeather
    if (!parsed || typeof parsed.temp !== 'number' || typeof parsed.code !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(entry: LiveWeather) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry))
  } catch {
    // Quota voll oder Speicher gesperrt — der RAM-Zustand reicht weiter
  }
}

/** Zuletzt gespeicherte Lage, ohne Netz. */
export function cachedLiveWeather(): LiveWeather | null {
  return readCache()
}

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
 * Aktuelle Lage am Zielort. Gibt bei Fehlern den letzten gespeicherten
 * Stand zurück — Wetter ist Beiwerk und darf keinen Screen blockieren.
 */
export async function fetchLiveWeather(force = false): Promise<LiveWeather | null> {
  const cached = readCache()
  if (!force && cached && Date.now() - cached.at < FRESH_MS) return cached

  const url =
    'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${TRIP_LAT}&longitude=${TRIP_LON}`
    + '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day'
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset'
    // Atlantic/Canary: Temisas liegt eine Stunde hinter Madrid. Mit Europe/Madrid
    // kamen Sonnenzeiten und die Tag/Nacht-Grenze eine Stunde falsch an.
    + '&timezone=Atlantic%2FCanary&forecast_days=1'

  try {
    const res = await fetchWithTimeout(url, 10000)
    if (!res.ok) throw new Error(`Wetter jetzt: HTTP ${res.status}`)
    const data = await res.json()
    const current = data?.current
    if (!current || typeof current.temperature_2m !== 'number') return cached

    const next: LiveWeather = {
      temp: Number(current.temperature_2m),
      feels: Number(current.apparent_temperature ?? current.temperature_2m),
      code: Number(current.weather_code ?? 0),
      wind: Number(current.wind_speed_10m ?? 0),
      isDay: Number(current.is_day ?? 1) === 1,
      tMax: Number(data?.daily?.temperature_2m_max?.[0] ?? current.temperature_2m),
      tMin: Number(data?.daily?.temperature_2m_min?.[0] ?? current.temperature_2m),
      rain: Number(data?.daily?.precipitation_probability_max?.[0] ?? 0),
      sunrise: sunClock(data?.daily?.sunrise?.[0]),
      sunset: sunClock(data?.daily?.sunset?.[0]),
      at: Date.now(),
    }
    writeCache(next)
    return next
  } catch {
    return cached
  }
}

/** WMO-Code → welche Szene die Karte zeigt. */
export function skyTone(code: number): SkyTone {
  if (code === 0) return 'clear'
  if (code === 1 || code === 2) return 'partly'
  if (code === 3) return 'cloudy'
  if (code === 45 || code === 48) return 'fog'
  if (code === 71 || code === 73 || code === 75 || code === 77 || code === 85 || code === 86) return 'snow'
  if (code === 95 || code === 96 || code === 99) return 'storm'
  return 'rain'
}
