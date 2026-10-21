import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { getWeatherInfo, fmtDay } from '../lib/weatherCodes'
import { getStoredLocation, setStoredLocation, geocodeCity, formatLocationName } from '../lib/weather'
import './WeatherWidget.css'

interface WeatherData {
  current: {
    temperature: number
    weatherCode: number
  }
  daily: {
    date: string
    weatherCode: number
    tempMax: number
    tempMin: number
  }[]
  locationName: string
}

interface WeatherWidgetProps {
  onNavigate?: () => void
}

export default function WeatherWidget({ onNavigate }: WeatherWidgetProps = {}) {
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showLocationInput, setShowLocationInput] = useState(false)
  const [locationQuery, setLocationQuery] = useState('')
  const [geoLoading, setGeoLoading] = useState(false)
  const cacheRef = useRef<{ data: WeatherData; ts: number } | null>(null)

  // ── Collapsible state from localStorage ──
  const [expanded, setExpanded] = useState(() => {
    return localStorage.getItem('weather_expanded') === 'true'
  })

  const toggleExpanded = () => {
    setExpanded(prev => {
      const next = !prev
      localStorage.setItem('weather_expanded', String(next))
      return next
    })
  }

  // ── Read stored location from localStorage ──
  const storedLocation = useMemo(() => getStoredLocation(), [])

  // ── Fetch weather data ──
  const fetchWeather = useCallback(async (lat: number, lon: number, name: string) => {
    // Check 10-minute cache
    if (cacheRef.current && Date.now() - cacheRef.current.ts < 10 * 60 * 1000) {
      setWeather(cacheRef.current.data)
      return
    }

    setLoading(true)
    setError('')
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=4`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Wetterdaten konnten nicht geladen werden')
      const data = await res.json()

      const wd: WeatherData = {
        current: {
          temperature: data.current.temperature_2m,
          weatherCode: data.current.weather_code,
        },
        daily: data.daily.time.slice(1, 4).map((t: string, i: number) => ({
          date: t,
          weatherCode: data.daily.weather_code[i + 1],
          tempMax: data.daily.temperature_2m_max[i + 1],
          tempMin: data.daily.temperature_2m_min[i + 1],
        })),
        locationName: name,
      }

      cacheRef.current = { data: wd, ts: Date.now() }
      setWeather(wd)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Laden')
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Fetch when location is available ──
  useEffect(() => {
    if (storedLocation) {
      fetchWeather(storedLocation.lat, storedLocation.lon, storedLocation.name)
    }
  }, [storedLocation, fetchWeather])

  // ── Geocode city name ──
  const handleGeocode = async () => {
    const query = locationQuery.trim()
    if (!query) return
    setGeoLoading(true)
    setError('')
    try {
      const result = await geocodeCity(query)
      const displayName = formatLocationName(result)
      setStoredLocation(result.lat, result.lon, displayName)
      cacheRef.current = null // force refetch
      setShowLocationInput(false)
      setLocationQuery('')
      fetchWeather(result.lat, result.lon, displayName)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler bei der Suche')
    } finally {
      setGeoLoading(false)
    }
  }

  // ── Memoized current weather info ──
  const currentInfo = useMemo(() => {
    if (!weather) return null
    return getWeatherInfo(weather.current.weatherCode)
  }, [weather])

  // ── No location set: prompt ──
  if (!storedLocation && !showLocationInput) {
    return (
      <div className="weather-widget weather-widget-prompt">
        <div className="weather-prompt-text">
          <span className="weather-emoji-large">🌤️</span>
          <p>Tippe deinen Urlaubsort ein, um das Wetter zu sehen</p>
        </div>
        <button
          className="weather-location-btn"
          onClick={() => setShowLocationInput(true)}
        >
          Ort ändern
        </button>
      </div>
    )
  }

  return (
    <div className="weather-widget" onClick={toggleExpanded}>
      {/* Location input overlay */}
      {showLocationInput && (
        <div className="weather-location-form" onClick={(e) => e.stopPropagation()}>
          <input
            className="weather-location-input"
            type="text"
            placeholder="Stadtname eingeben…"
            value={locationQuery}
            onChange={(e) => setLocationQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleGeocode()}
            autoFocus
          />
          <button
            className="weather-geo-btn"
            onClick={handleGeocode}
            disabled={geoLoading || !locationQuery.trim()}
          >
            {geoLoading ? '…' : 'Suchen'}
          </button>
          <button
            className="weather-geo-cancel"
            onClick={() => { setShowLocationInput(false); setLocationQuery(''); setError('') }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Error message */}
      {error && <p className="weather-error">{error}</p>}

      {/* Loading state */}
      {loading && !weather && <p className="weather-loading">Lädt Wetter…</p>}

      {/* Weather display */}
      {weather && currentInfo && !showLocationInput && (
        <>
          <div className="weather-compact-row">
            <span className="weather-emoji">{currentInfo.emoji}</span>
            <span className="weather-temp">
              {Math.round(weather.current.temperature)}°C
            </span>
            <span className="weather-desc">{currentInfo.desc}</span>
            <span className="weather-location-name">{weather.locationName}</span>
            <button
              className="weather-change-btn"
              onClick={(e) => { e.stopPropagation(); setShowLocationInput(true) }}
            >
              Ort ändern
            </button>
            <span className="weather-chevron">{expanded ? '▲' : '▼'}</span>
          </div>

          {expanded && weather.daily.length > 0 && (
            <div className="weather-forecast">
              {weather.daily.map((day, i) => {
                const info = getWeatherInfo(day.weatherCode)
                return (
                  <div key={i} className="weather-forecast-day">
                    <span className="weather-forecast-dayname">
                      {fmtDay(day.date)}
                    </span>
                    <span className="weather-forecast-emoji">{info.emoji}</span>
                    <span className="weather-forecast-temps">
                      <span className="weather-temp-max">{Math.round(day.tempMax)}°</span>
                      <span className="weather-temp-min">{Math.round(day.tempMin)}°</span>
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {expanded && onNavigate && (
            <button
              className="weather-open-btn"
              onClick={(e) => { e.stopPropagation(); navigator.vibrate?.(8); onNavigate() }}
            >
              🌤️ Zur Wetter-Übersicht ›
            </button>
          )}
        </>
      )}
    </div>
  )
}
