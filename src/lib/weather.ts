// ── Shared geocoding + location storage (Fix #16) ────────────────────
// Extracted from WeatherWidget.tsx and WeatherScreen.tsx to eliminate
// duplication of handleGeocode + localStorage location read/write.

export interface GeoResult {
  lat: number
  lon: number
  name: string
  country?: string
}

/** Default-Speicherpunkt: Maspalomas, Gran Canaria (Fallback, wenn nichts gespeichert ist). */
export const DEFAULT_LOCATION: { lat: number; lon: number; name: string } = {
  lat: 27.7610,
  lon: -15.5860,
  name: 'Maspalomas, Gran Canaria',
}

/** Read the stored location from localStorage. Falls back to the default
 *  storage point (Maspalomas, Gran Canaria) when nothing is stored. */
export function getStoredLocation(): { lat: number; lon: number; name: string } {
  const lat = localStorage.getItem('weather_lat')
  const lon = localStorage.getItem('weather_lon')
  const name = localStorage.getItem('weather_name')
  if (lat && lon && name) return { lat: parseFloat(lat), lon: parseFloat(lon), name }
  return DEFAULT_LOCATION
}

/** Persist location coordinates + display name to localStorage. */
export function setStoredLocation(lat: number, lon: number, name: string): void {
  localStorage.setItem('weather_lat', String(lat))
  localStorage.setItem('weather_lon', String(lon))
  localStorage.setItem('weather_name', name)
}

/**
 * Geocode a city name via the open-meteo geocoding API.
 * Returns the first match or throws an Error if nothing is found.
 */
export async function geocodeCity(query: string): Promise<GeoResult> {
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1`,
  )
  if (!res.ok) throw new Error('Ort nicht gefunden')
  const data = await res.json()
  if (!data.results || data.results.length === 0) {
    throw new Error(`"${query}" nicht gefunden`)
  }
  return {
    lat: data.results[0].latitude,
    lon: data.results[0].longitude,
    name: data.results[0].name,
    country: data.results[0].country,
  }
}

/** Build a display name from a GeoResult (e.g. "Maspalomas, Spanien"). */
export function formatLocationName(result: GeoResult): string {
  return result.country ? `${result.name}, ${result.country}` : result.name
}
