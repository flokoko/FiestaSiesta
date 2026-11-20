// ── Spritpreise, Gemeinde Agüimes (5234) ─────────────────────────────
// Quelle: offene REST-Schnittstelle des spanischen Industrieministeriums
// (SEDEA „Precios de carburantes" — kein Schlüssel, kein Backend). Der
// Gemeinde-Filter liefert nur die ~20 Stationen von Agüimes (~20 kB); die
// Gesamtdatei aller Stationen Spaniens ist 12 MB groß und wird NIE geladen.
//
// Fallstricke der API (bewusst so belassen):
//   * Schlüssel enthalten Leerzeichen, Punkte und Akzente — nur per
//     Klammerzugriff, z. B. e['Precio Gasoleo A'] oder e['Longitud (WGS84)'].
//   * Preise kommen als String mit Komma („1,609") und können leer sein;
//     Koordinaten ebenfalls mit Komma.

import { TRIP_LAT, TRIP_LON } from './trip'
import { airKm } from './driveTime'

export interface FuelStation {
  name: string
  address: string
  /** Diesel (Gasoleo A) — null, wenn die Station keinen Preis meldet */
  diesel: number | null
  /** Normalbenzin 95 */
  petrol95: number | null
  /** Luftlinie zur Unterkunft in km */
  km: number
}

export interface FuelData {
  stations: FuelStation[]
  /** Feld `Fecha` der Antwort, Tag + Uhrzeit */
  updated: string | null
  /** Höchster Dieselpreis der Gemeinde — Bezugsgröße für das Delta */
  maxDiesel: number | null
  /** Zeitpunkt des Abrufs (ms) */
  at: number
}

export const FUEL_MUNICIPIO_URL =
  'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/FiltroMunicipio/5234'

const CACHE_KEY = 'fiesta-fuel'
const FRESH_MS = 60 * 60 * 1000

/** '1,609' → 1.609 (Punkt-Komplement '1.609' funktioniert auch); leer/kaputt/0 → null. */
export function parsePrice(raw?: string): number | null {
  if (!raw) return null
  const normalized = raw.trim().replace(',', '.')
  if (!normalized || normalized === '.') return null
  const value = Number(normalized)
  if (!Number.isFinite(value) || value <= 0) return null
  return value
}

/** Koordinaten-Zeilen kommen ebenfalls mit Komma ('27,899167'). */
function parseCoord(raw?: string): number | null {
  if (!raw) return null
  const value = Number(raw.trim().replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

/**
 * Die `limit` günstigsten Stationen der Antwort, sortiert nach Dieselpreis —
 * Stationen ohne Dieselpreis (leeres Feld) gehen nach hinten. `raw` darf das
 * geparste JSON oder ein JSON-String sein; kaputte Angaben liefern [] statt
 * zu werfen.
 */
export function nearestStations(raw: unknown, lat: number, lon: number, limit = 3): FuelStation[] {
  if (raw === null || raw === undefined) return []
  let data: unknown = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      return []
    }
  }
  const list = (data as { ListaEESSPrecio?: unknown } | null)?.ListaEESSPrecio
  if (!Array.isArray(list)) return []

  const stations: FuelStation[] = []
  for (const source of list as Array<Record<string, unknown>>) {
    const sLat = parseCoord(source['Latitud'] as string | undefined)
    const sLon = parseCoord(source['Longitud (WGS84)'] as string | undefined)
    // Ohne Koordinate keine sinnvolle Nähe — überspringen statt 999 km raten.
    if (sLat === null || sLon === null) continue
    stations.push({
      name: String(source['Rótulo'] ?? '').trim() || 'Tankstelle',
      address: String(source['Dirección'] ?? '').trim(),
      diesel: parsePrice(source['Precio Gasoleo A'] as string | undefined),
      petrol95: parsePrice(source['Precio Gasolina 95 E5'] as string | undefined),
      km: airKm(sLat, sLon, lat, lon),
    })
  }
  return stations
    .sort((a, b) =>
      (a.diesel ?? Number.POSITIVE_INFINITY) - (b.diesel ?? Number.POSITIVE_INFINITY))
    .slice(0, Math.max(0, limit))
}

/** Höchster Dieselpreis der GEMEINDE (nicht nur der drei günstigsten) —
 *  Bezugsgröße für „−16 ct". Ohne diesen Wert wäre das Delta bei drei
 *  gleich teuren Stationen überall 0 und damit nutzlos. */
export function dieselMax(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  let data: unknown = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      return null
    }
  }
  const list = (data as { ListaEESSPrecio?: unknown } | null)?.ListaEESSPrecio
  if (!Array.isArray(list)) return null
  let max: number | null = null
  for (const source of list as Array<Record<string, unknown>>) {
    const price = parsePrice(source['Precio Gasoleo A'] as string | undefined)
    if (price !== null && (max === null || price > max)) max = price
  }
  return max
}

/** '20/11/2026 15:45:45' → 'Fr 20.11. 15:45' — Anzeige-Text für die Anmerkung. */
export function formatFuelUpdated(raw: string): string {
  const match = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::\d{2})?/.exec(raw)
  if (!match) return raw
  const [, d, m, y, h, min] = match
  // Nur Wochentag lokal — Zone spielt für die Anzeige der Tagesform keine Rolle.
  const weekdays = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
  const weekday = weekdays[new Date(Number(y), Number(m) - 1, Number(d)).getDay()]
  const p = (n: number) => String(n).padStart(2, '0')
  return `${weekday} ${p(Number(d))}.${p(Number(m))}. ${p(Number(h))}:${min}`
}

function readCache(): FuelData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as FuelData
    if (!parsed || !Array.isArray(parsed.stations) || typeof parsed.at !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(entry: FuelData) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry))
  } catch {
    // Quota voll oder Speicher gesperrt — der RAM-Zustand reicht weiter
  }
}

/** Zuletzt gespeicherte Preise, ohne Netz. */
export function cachedFuel(): FuelData | null {
  return readCache()
}

/**
 * Spritpreise der Gemeinde Agüimes. Gibt bei Fehlern den letzten gespeicherten
 * Stand zurück — die Preisliste ist Beiwerk und darf keinen Screen blockieren.
 */
export async function fetchFuel(force = false): Promise<FuelData | null> {
  const cached = readCache()
  if (!force && cached && Date.now() - cached.at < FRESH_MS) return cached

  try {
    const res = await fetch(FUEL_MUNICIPIO_URL, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`Sprit: HTTP ${res.status}`)
    const data = (await res.json()) as {
      Fecha?: unknown
      ListaEESSPrecio?: unknown
    } | null
    // `Fecha` als Formale: ist das Feld weg, ist die Antwort anders gebaut
    // als heute — dann lieber den alten Stand behalten.
    if (!data || typeof data.Fecha !== 'string' || !Array.isArray(data.ListaEESSPrecio)) {
      return cached
    }

    const next: FuelData = {
      stations: nearestStations(data, TRIP_LAT, TRIP_LON),
      updated: data.Fecha,
      maxDiesel: dieselMax(data),
      at: Date.now(),
    }
    writeCache(next)
    return next
  } catch {
    return cached
  }
}
