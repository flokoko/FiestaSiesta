import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, CircleMarker, useMap } from 'react-leaflet'
import { MoreHorizontal, MapPin, Radar } from 'lucide-react'
import { getWeatherInfo, fmtDay } from '../lib/weatherCodes'
import { getStoredLocation, setStoredLocation, geocodeCity, formatLocationName } from '../lib/weather'
import { useSheetFocus } from '../hooks/useSheetFocus'
import 'leaflet/dist/leaflet.css'
import './WeatherScreen.css'

interface WeatherData {
  current: {
    temperature: number
    apparentTemperature: number
    weatherCode: number
    humidity: number
    windSpeed: number
    uvIndex: number
    pressure: number
    visibility: number
    time: string
  }
  hourly: {
    time: string[]
    temperature: number[]
    weatherCode: number[]
    precipitationProbability: number[]
    windSpeed: number[]
  }
  daily: {
    time: string[]
    weatherCode: number[]
    tempMax: number[]
    tempMin: number[]
    precipitationProbabilityMax: number[]
    windSpeedMax: number[]
    sunrise: string[]
    sunset: string[]
  }
  locationName: string
}

interface RadarFrame {
  time: number
  path: string
}

// ── Wetter-Zwischenspeicher ────────────────────────────────────────────
// Der reine RAM-Cache (cacheRef) verlor bei jedem App-Start alle Daten: offline
// blieb nur „Wetterdaten konnten nicht geladen werden". Im Urlaub ist „App
// offline öffnen und Wetter checken" aber der Normalfall, deshalb persistiert
// der letzte erfolgreiche Abruf in localStorage (~10–20 kB).
const WEATHER_CACHE_KEY = 'fiesta-weather-cache'
const WEATHER_FRESH_MS = 10 * 60 * 1000

function readStoredWeather(): { data: WeatherData; ts: number } | null {
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { data?: WeatherData; ts?: number }
    if (!parsed?.data || typeof parsed.ts !== 'number') return null
    return { data: parsed.data, ts: parsed.ts }
  } catch {
    return null
  }
}

function writeStoredWeather(entry: { data: WeatherData; ts: number }) {
  try {
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(entry))
  } catch {
    // Quota voll oder Speicher gesperrt — der RAM-Cache reicht dann weiter
  }
}

/** fetch mit hartem Zeitlimit: halb offene Mobilfunkverbindungen hängen sonst
 *  bis zum Browser-Timeout und der Ladezustand bleibt ewig stehen. */
function fetchWithTimeout(url: string, ms: number, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  const forwardAbort = () => controller.abort()
  signal?.addEventListener('abort', forwardAbort, { once: true })
  return fetch(url, { signal: controller.signal }).finally(() => {
    clearTimeout(timer)
    signal?.removeEventListener('abort', forwardAbort)
  })
}

function fmtDayLong(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('de-DE', { weekday: 'long' })
}

function fmtTime(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

function fmtHour(dateStr: string) {
  const d = new Date(dateStr)
  return `${String(d.getHours()).padStart(2, '0')}:00`
}

function fmtRadarTime(ts: number) {
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

/** Tracks the resolved theme ('light' | 'dark'), reacting to both the manual
 *  toggle (data-theme on <html>) and system colour-scheme changes in auto mode. */
function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(
    () => document.documentElement.getAttribute('data-theme') === 'dark'
      || window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  useEffect(() => {
    const themeObserver = new MutationObserver(() => {
      setIsDark(document.documentElement.getAttribute('data-theme') === 'dark')
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => setIsDark(document.documentElement.getAttribute('data-theme') === 'dark')
    mql.addEventListener('change', handler)

    return () => {
      themeObserver.disconnect()
      mql.removeEventListener('change', handler)
    }
  }, [])

  return isDark
}

/** Component that updates the map view when coordinates change */
function MapUpdater({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap()
  useEffect(() => {
    map.setView([lat, lon], 7)
  }, [map, lat, lon])
  return null
}

export default function WeatherScreen() {
  const isDark = useIsDark()
  const [weather, setWeather] = useState<WeatherData | null>(() => readStoredWeather()?.data ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showLocationInput, setShowLocationInput] = useState(false)
  const [locationQuery, setLocationQuery] = useState('')
  const [geoLoading, setGeoLoading] = useState(false)
  const cacheRef = useRef<{ data: WeatherData; ts: number } | null>(readStoredWeather())
  // Sequenz-Guard wie in useListData: ein langsamer Antwort für Ort A darf den
  // frischen Zustand von Ort B nicht überschreiben.
  const fetchSeqRef = useRef(0)
  const fetchAbortRef = useRef<AbortController | null>(null)

  // ── Radar state ──
  const [radarFrames, setRadarFrames] = useState<RadarFrame[]>([])
  const [radarHost, setRadarHost] = useState('')
  const [radarPlaying, setRadarPlaying] = useState(true)
  const [radarIndex, setRadarIndex] = useState(0)
  const [radarError, setRadarError] = useState('')
  const radarIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Wurzel-Ref: Screens bleiben gemountet (nur display:none). Ohne diese Prüfung
  // wechselt die Radar-Animation im Verborgenen alle 500 ms das Frame und Leaflet
  // lädt jedes Mal das komplette Tile-Set — Akku und Datenvolumen für nichts.
  const rootRef = useRef<HTMLDivElement>(null)
  // Wetter/Radar veralteten bisher für die gesamte Sitzung: der Pane bleibt
  // gemountet, fetchWeather lief nur beim ersten Mount.
  const [radarTick, setRadarTick] = useState(0)
  const lastRadarTsRef = useRef(Date.now())

  // ── Ort als State, nicht als einmaliges Memo ──
  // Vorher `useMemo(getStoredLocation, [])`: nach „Ort ändern" zeigten Karte,
  // Radar-Zentrum und der 10-Minuten-Refresh weiter den alten Ort (der Pane
  // bleibt gemountet, das Memo lief nie wieder).
  const [storedLocation, setStoredLocationState] = useState(() => getStoredLocation())

  // ── Fetch weather data (rich API for screen) ──
  const fetchWeather = useCallback(async (lat: number, lon: number, name: string) => {
    if (cacheRef.current && Date.now() - cacheRef.current.ts < WEATHER_FRESH_MS) {
      setWeather(cacheRef.current.data)
      return
    }

    const mySeq = ++fetchSeqRef.current
    fetchAbortRef.current?.abort()
    const controller = new AbortController()
    fetchAbortRef.current = controller

    setLoading(true)
    setError('')
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,uv_index,pressure_msl,visibility&hourly=temperature_2m,weather_code,precipitation_probability,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset&timezone=auto&forecast_days=7`
      const res = await fetchWithTimeout(url, 10000, controller.signal)
      if (!res.ok) throw new Error('Wetterdaten konnten nicht geladen werden')
      const data = await res.json()
      if (mySeq !== fetchSeqRef.current) return

      const wd: WeatherData = {
        current: {
          temperature: data.current.temperature_2m,
          apparentTemperature: data.current.apparent_temperature,
          weatherCode: data.current.weather_code,
          humidity: data.current.relative_humidity_2m,
          windSpeed: data.current.wind_speed_10m,
          uvIndex: data.current.uv_index,
          pressure: data.current.pressure_msl,
          visibility: data.current.visibility,
          time: data.current.time,
        },
        hourly: {
          time: data.hourly.time,
          temperature: data.hourly.temperature_2m,
          weatherCode: data.hourly.weather_code,
          precipitationProbability: data.hourly.precipitation_probability,
          windSpeed: data.hourly.wind_speed_10m,
        },
        daily: {
          time: data.daily.time,
          weatherCode: data.daily.weather_code,
          tempMax: data.daily.temperature_2m_max,
          tempMin: data.daily.temperature_2m_min,
          precipitationProbabilityMax: data.daily.precipitation_probability_max,
          windSpeedMax: data.daily.wind_speed_10m_max,
          sunrise: data.daily.sunrise,
          sunset: data.daily.sunset,
        },
        locationName: name,
      }

      cacheRef.current = { data: wd, ts: Date.now() }
      writeStoredWeather(cacheRef.current)
      setWeather(wd)
    } catch (err) {
      if (mySeq !== fetchSeqRef.current) return
      const aborted = err instanceof DOMException && err.name === 'AbortError'
      const message = aborted
        ? 'Wetterdaten brauchen zu lange — bitte später erneut versuchen.'
        : err instanceof Error
          ? err.message
          : 'Fehler beim Laden'
      // Mit gespeicherten Daten lieber den letzten Stand zeigen als eine Fehlermeldung
      if (!cacheRef.current) setError(message)
    } finally {
      if (mySeq === fetchSeqRef.current) setLoading(false)
    }
  }, [])

  // ── Fetch when location is available ──
  useEffect(() => {
    if (storedLocation) {
      fetchWeather(storedLocation.lat, storedLocation.lon, storedLocation.name)
    }
  }, [storedLocation, fetchWeather])

  // ── Auffrischen: beim Zurückkehren in die App und alle 5 Min. ──
  // fetchWeather prüft selbst den 10-Minuten-Cache, ist also billig.
  useEffect(() => {
    if (!storedLocation) return
    const maybeRefresh = () => {
      if (document.hidden) return
      if (rootRef.current && rootRef.current.offsetParent === null) return
      void fetchWeather(storedLocation.lat, storedLocation.lon, storedLocation.name)
      if (Date.now() - lastRadarTsRef.current > 10 * 60 * 1000) {
        lastRadarTsRef.current = Date.now()
        setRadarTick(t => t + 1)
      }
    }
    const onVisible = () => maybeRefresh()
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(maybeRefresh, 5 * 60 * 1000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [storedLocation, fetchWeather])

  // ── Fetch radar data (RainViewer) ──
  // radarTick: die Frames veralten nach ~10 Minuten, der Pane lebt aber tagelang.
  useEffect(() => {
    let cancelled = false
    setRadarError('')
    fetchWithTimeout('https://api.rainviewer.com/public/weather-maps.json', 8000)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        const past: RadarFrame[] = (data.radar?.past ?? []) as RadarFrame[]
        const host = data.host as string
        setRadarHost(host)
        setRadarFrames(past)
        setRadarIndex(past.length - 1)
      })
      .catch(() => {
        if (!cancelled) setRadarError('Regenradar konnte nicht geladen werden')
      })
    return () => { cancelled = true }
  }, [radarTick])

  // ── Radar animation interval ──
  useEffect(() => {
    if (radarPlaying && radarFrames.length > 0) {
      radarIntervalRef.current = setInterval(() => {
        if (document.hidden) return
        if (rootRef.current && rootRef.current.offsetParent === null) return
        setRadarIndex(prev => (prev + 1) % radarFrames.length)
      }, 500)
    }
    return () => {
      if (radarIntervalRef.current) {
        clearInterval(radarIntervalRef.current)
        radarIntervalRef.current = null
      }
    }
  }, [radarPlaying, radarFrames.length])

  const toggleRadar = () => {
    navigator.vibrate?.(8)
    setRadarPlaying(prev => !prev)
  }

  const handleRadarSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const idx = Number(e.target.value)
    setRadarIndex(idx)
    setRadarPlaying(false)
  }

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
      setStoredLocationState({ lat: result.lat, lon: result.lon, name: displayName })
      cacheRef.current = null
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

  // ── Hourly forecast: next 24 hours from current time ──
  const hourlyForecast = useMemo(() => {
    if (!weather) return []
    const now = new Date()
    const currentHour = now.toISOString().slice(0, 13)
    const startIndex = weather.hourly.time.findIndex((t: string) => t.slice(0, 13) >= currentHour)
    const start = startIndex >= 0 ? startIndex : 0
    return weather.hourly.time.slice(start, start + 24).map((t: string, i: number) => ({
      time: t,
      temperature: weather.hourly.temperature[start + i],
      weatherCode: weather.hourly.weatherCode[start + i],
      precipitationProbability: weather.hourly.precipitationProbability[start + i],
      windSpeed: weather.hourly.windSpeed[start + i],
    }))
  }, [weather])

  // ── Daily forecast: 7 days ──
  const dailyForecast = useMemo(() => {
    if (!weather) return []
    return weather.daily.time.map((t: string, i: number) => ({
      date: t,
      weatherCode: weather.daily.weatherCode[i],
      tempMax: weather.daily.tempMax[i],
      tempMin: weather.daily.tempMin[i],
      precipitationProbability: weather.daily.precipitationProbabilityMax[i],
      windSpeed: weather.daily.windSpeedMax[i],
      sunrise: weather.daily.sunrise[i],
      sunset: weather.daily.sunset[i],
    }))
  }, [weather])

  // ── UV Index description ──
  const uvDesc = useMemo(() => {
    if (!weather) return ''
    const uv = weather.current.uvIndex
    if (uv <= 2) return 'Niedrig'
    if (uv <= 5) return 'Mäßig'
    if (uv <= 7) return 'Hoch'
    if (uv <= 10) return 'Sehr hoch'
    return 'Extrem'
  }, [weather])

  const [menuOpen, setMenuOpen] = useState(false)
  const [radarOpen, setRadarOpen] = useState(true)
  const menuSheetRef = useRef<HTMLDivElement | null>(null)
  useSheetFocus(menuSheetRef, menuOpen, () => setMenuOpen(false))

  // Laufenden Wetterabruf beim Ausbau des Screens abbrechen
  useEffect(() => {
    return () => fetchAbortRef.current?.abort()
  }, [])

  // ── No location set: prompt ──
  if (!storedLocation && !showLocationInput) {
    return (
      <div className="weather-screen weather-screen-prompt">
        <div className="weather-screen-prompt-content">
          <span className="weather-screen-prompt-emoji">🌤️</span>
          <h2 className="weather-screen-prompt-title">Wetter-Übersicht</h2>
          <p className="weather-screen-prompt-text">
            Tippe deinen Urlaubsort ein, um das Wetter zu sehen
          </p>
          <button
            className="weather-screen-set-btn"
            onClick={() => { navigator.vibrate?.(8); setShowLocationInput(true) }}
          >
            Ort festlegen
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="weather-screen" ref={rootRef}>
      <header className="list-head">
        <div className="list-head-text">
          <h1>Wetter</h1>
          <p>
            {weather && currentInfo
              ? `${weather.locationName} · ${Math.round(weather.current.temperature)}° ${currentInfo.desc}`
              : 'Lädt Wetterdaten …'}
          </p>
        </div>
        <button
          type="button"
          className="list-menu-btn"
          onClick={() => setMenuOpen(true)}
          aria-label="Optionen"
        >
          <MoreHorizontal size={20} strokeWidth={2.2} />
        </button>
      </header>

      {menuOpen && (
        <div className="list-menu-scrim" role="presentation" onClick={() => setMenuOpen(false)}>
          <div
            className="list-menu-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Wetter-Optionen"
            ref={menuSheetRef}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="more-grab" aria-hidden="true" />
            <button
              type="button"
              className="list-menu-item"
              onClick={() => { setShowLocationInput(true); setMenuOpen(false) }}
            >
              <MapPin size={17} strokeWidth={2} />
              <span>Ort ändern</span>
            </button>
            <button
              type="button"
              className="list-menu-item"
              onClick={() => { setRadarOpen(v => !v); setMenuOpen(false) }}
            >
              <Radar size={17} strokeWidth={2} />
              <span>{radarOpen ? 'Regenradar ausblenden' : 'Regenradar anzeigen'}</span>
            </button>
          </div>
        </div>
      )}

      {showLocationInput && (
        <div className="weather-screen-location-form">
          <input
            aria-label="Ort suchen"
            className="weather-screen-location-input"
            type="text"
            placeholder="Stadtname eingeben…"
            value={locationQuery}
            onChange={(e) => setLocationQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleGeocode()}
            autoFocus
          />
          <button
            className="weather-screen-geo-btn"
            onClick={() => { navigator.vibrate?.(8); handleGeocode() }}
            disabled={geoLoading || !locationQuery.trim()}
          >
            {geoLoading ? '…' : 'Suchen'}
          </button>
          <button
            className="weather-screen-geo-cancel"
            aria-label="Ortssuche schließen"
            onClick={() => { navigator.vibrate?.(8); setShowLocationInput(false); setLocationQuery(''); setError('') }}
          >
            ✕
          </button>
        </div>
      )}

      {error && <p className="weather-screen-error" role="alert">{error}</p>}
      {loading && !weather && (
        <div className="weather-screen-loading">
          <span className="weather-screen-loading-emoji">🌦️</span>
          <p>Lädt Wetterdaten…</p>
        </div>
      )}

      {weather && currentInfo && !showLocationInput && (
        <>
          <div className="wx-now">
            <span className="wx-now-emoji">{currentInfo.emoji}</span>
            <div className="wx-now-body">
              <span className="wx-now-temp">{Math.round(weather.current.temperature)}°</span>
              <span className="wx-now-desc">
                {currentInfo.desc} · gefühlt {Math.round(weather.current.apparentTemperature)}°
              </span>
            </div>
            <span className="wx-now-time">{fmtTime(weather.current.time)}</span>
          </div>

          <section className="wx-group">
            <h2 className="wx-group-title">Stündlich</h2>
            <div className="weather-hourly-scroll">
              {hourlyForecast.map((hour, i) => {
                const info = getWeatherInfo(hour.weatherCode)
                return (
                  <div key={i} className="weather-hourly-card">
                    <span className="weather-hourly-time">{fmtHour(hour.time)}</span>
                    <span className="weather-hourly-emoji">{info.emoji}</span>
                    <span className="weather-hourly-temp">{Math.round(hour.temperature)}°</span>
                    <span className="weather-hourly-rain">
                      {hour.precipitationProbability > 0 ? `${hour.precipitationProbability}%` : '–'}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="wx-group">
            <h2 className="wx-group-title">7 Tage</h2>
            <div className="wx-rows">
              {dailyForecast.map((day, i) => {
                const info = getWeatherInfo(day.weatherCode)
                return (
                  <div key={i} className="wx-day">
                    <span className="wx-day-name">
                      {i === 0 ? 'Heute' : i === 1 ? 'Morgen' : fmtDayLong(day.date)}
                      <em>{fmtDay(day.date)}</em>
                    </span>
                    <span className="wx-day-emoji">{info.emoji}</span>
                    <span className="wx-day-temps">
                      {Math.round(day.tempMax)}°<em>{Math.round(day.tempMin)}°</em>
                    </span>
                    <span className="wx-day-rain">
                      {day.precipitationProbability > 0 ? `${day.precipitationProbability}%` : ''}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="wx-group">
            <h2 className="wx-group-title">Details</h2>
            <div className="wx-rows">
              <div className="wx-row"><span>Luftfeuchtigkeit</span><b>{weather.current.humidity}%</b></div>
              <div className="wx-row"><span>Wind</span><b>{Math.round(weather.current.windSpeed)} km/h</b></div>
              <div className="wx-row"><span>UV-Index</span><b>{weather.current.uvIndex.toFixed(1)} · {uvDesc}</b></div>
              <div className="wx-row"><span>Sichtweite</span><b>{Math.round(weather.current.visibility / 1000)} km</b></div>
              <div className="wx-row"><span>Luftdruck</span><b>{Math.round(weather.current.pressure)} hPa</b></div>
            </div>
          </section>

          {radarOpen && storedLocation && radarError && (
            <section className="wx-group">
              <h2 className="wx-group-title">Regenradar</h2>
              <p className="weather-screen-error">{radarError}</p>
            </section>
          )}

          {radarOpen && storedLocation && !radarError && radarFrames.length > 0 && (
            <section className="wx-group">
              <h2 className="wx-group-title">
                Regenradar
                <span className="wx-radar-controls">
                  <span className="weather-radar-time">{fmtRadarTime(radarFrames[radarIndex]?.time ?? 0)}</span>
                  <button
                    className="weather-radar-play-btn"
                    onClick={toggleRadar}
                    aria-label={radarPlaying ? 'Pause' : 'Play'}
                  >
                    {radarPlaying ? '⏸' : '▶️'}
                  </button>
                </span>
              </h2>
              <div className="weather-radar-map">
                <MapContainer
                  center={[storedLocation.lat, storedLocation.lon]}
                  zoom={7}
                  maxZoom={7}
                  style={{ height: '100%', width: '100%' }}
                  zoomControl={true}
                  scrollWheelZoom={true}
                  dragging={true}
                >
                  {/* Basiskarte bewusst keyless: CARTO verlangt seit 2026 einen
                      API-Key und liefert sonst Kacheln mit „API KEY REQUIRED"
                      als Hintergrund (am 26.10.2026 geprüft). OpenStreetMap
                      braucht keinen Key; für den Dunkelmodus wird dieselbe
                      Kachel per CSS invertiert, damit es EINEN Anbieter gibt. */}
                  <TileLayer
                    key={isDark ? 'base-dark' : 'base-light'}
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende'
                    url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                    className={isDark ? 'wx-radar-basemap is-dark' : 'wx-radar-basemap'}
                    maxNativeZoom={7}
                  />
                  {radarHost && radarFrames[radarIndex] && (
                    <TileLayer
                      key={`${radarFrames[radarIndex].path}-${isDark ? 'd' : 'l'}`}
                      url={`${radarHost}${radarFrames[radarIndex].path}/256/{z}/{x}/{y}/2/1.png`}
                      opacity={isDark ? 0.55 : 0.65}
                      maxNativeZoom={7}
                    />
                  )}
                  <CircleMarker
                    center={[storedLocation.lat, storedLocation.lon]}
                    radius={10}
                    pathOptions={{ color: '#F39C12', fillColor: '#F39C12', fillOpacity: 0.8, weight: 2 }}
                  />
                  <MapUpdater lat={storedLocation.lat} lon={storedLocation.lon} />
                </MapContainer>
              </div>
              <div className="weather-radar-timeline">
                <input
                  type="range"
                  className="weather-radar-slider"
                  aria-label="Radar-Zeitpunkt"
                  min={0}
                  max={radarFrames.length - 1}
                  value={radarIndex}
                  onChange={handleRadarSlider}
                />
                <div className="weather-radar-timeline-labels">
                  <span className="weather-radar-timeline-label">{fmtRadarTime(radarFrames[0]?.time ?? 0)}</span>
                  <span className="weather-radar-timeline-label">{fmtRadarTime(radarFrames[radarFrames.length - 1]?.time ?? 0)}</span>
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
