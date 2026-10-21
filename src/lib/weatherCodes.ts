// ── Shared weather code mapping (Fix #2) ─────────────────────────────
// Extracted from WeatherWidget.tsx and WeatherScreen.tsx to eliminate
// duplication of the 30-entry WEATHER_CODE_MAP + helpers.

export const WEATHER_CODE_MAP: Record<number, { emoji: string; desc: string }> = {
  0: { emoji: '☀️', desc: 'Sonnig' },
  1: { emoji: '🌤️', desc: 'Heiter' },
  2: { emoji: '⛅', desc: 'Bewölkt' },
  3: { emoji: '☁️', desc: 'Bedeckt' },
  45: { emoji: '🌫️', desc: 'Nebel' },
  48: { emoji: '🌫️', desc: 'Reifnebel' },
  51: { emoji: '🌧️', desc: 'Nieselregen' },
  53: { emoji: '🌧️', desc: 'Nieselregen' },
  55: { emoji: '🌧️', desc: 'Nieselregen' },
  56: { emoji: '🌧️', desc: 'Gefrierender Niesel' },
  57: { emoji: '🌧️', desc: 'Gefrierender Niesel' },
  61: { emoji: '🌧️', desc: 'Regen' },
  63: { emoji: '🌧️', desc: 'Regen' },
  65: { emoji: '🌧️', desc: 'Starker Regen' },
  66: { emoji: '🌧️', desc: 'Gefrierender Regen' },
  67: { emoji: '🌧️', desc: 'Gefrierender Regen' },
  71: { emoji: '❄️', desc: 'Schnee' },
  73: { emoji: '❄️', desc: 'Schnee' },
  75: { emoji: '❄️', desc: 'Starker Schneefall' },
  77: { emoji: '❄️', desc: 'Schneegriesel' },
  80: { emoji: '🌧️', desc: 'Regenschauer' },
  81: { emoji: '🌧️', desc: 'Regenschauer' },
  82: { emoji: '🌧️', desc: 'Heftige Schauer' },
  85: { emoji: '❄️', desc: 'Schneeschauer' },
  86: { emoji: '❄️', desc: 'Schneeschauer' },
  95: { emoji: '⛈️', desc: 'Gewitter' },
  96: { emoji: '⛈️', desc: 'Gewitter mit Hagel' },
  99: { emoji: '⛈️', desc: 'Schweres Gewitter' },
}

export function getWeatherInfo(code: number) {
  return WEATHER_CODE_MAP[code] ?? { emoji: '🌡️', desc: 'Unbekannt' }
}

export function fmtDay(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('de-DE', { weekday: 'short' })
}