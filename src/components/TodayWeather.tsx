import { ChevronRight, CloudMoon, Moon } from 'lucide-react'
import WeatherScene from './WeatherScene'
import WeatherGlyph from './WeatherGlyph'
import { conditionLabel, skyTone } from '../lib/liveWeather'
import type { LiveWeather } from '../lib/liveWeather'
import './TodayWeather.css'

/** Nachts sind Sonnen-Icons falsch — klarer Himmel = Mond, wolkig = Wolke/Mond. */
function CondGlyph({ code, isDay }: { code: number; isDay: boolean }) {
  if (!isDay && code <= 3) {
    const Icon = code === 0 ? Moon : CloudMoon
    return <Icon size={13} strokeWidth={2.2} className="today-wx-glyph" aria-hidden="true" />
  }
  return <WeatherGlyph code={code} size={13} className="today-wx-glyph" />
}

interface TodayWeatherProps {
  data: LiveWeather | null
  onOpen: () => void
}

/**
 * Wetter-Zeile in der Heute-Karte: Blick aus dem Fenster (animierte Szene),
 * Temperatur und Tageswerte. Tippen öffnet den Wetter-Screen. Datum und
 * Uhrzeit an der Unterkunft stehen eine Zeile höher in der Karte.
 */
export default function TodayWeather({ data, onOpen }: TodayWeatherProps) {
  const tone = data ? skyTone(data.code) : 'partly'
  const night = data ? !data.isDay : false
  const label = data ? conditionLabel(data.code, data.isDay) : 'Wetter wird geladen'
  const temp = data ? Math.round(data.temp) : null

  const aria = data
    ? `${label}, ${temp} Grad in Temisas. Gefühlt ${Math.round(data.feels)} Grad, heute ${Math.round(data.tMax)} bis `
      + `${Math.round(data.tMin)} Grad, Regen ${Math.round(data.rain)} Prozent, Wind ${Math.round(data.wind)} `
      + 'Kilometer pro Stunde. Wetter öffnen'
    : 'Wetter am Zielort wird geladen'

  return (
    <button type="button" className="today-wx" onClick={onOpen} aria-label={aria}>
      <span className="today-wx-port" data-sky={tone} data-night={night ? 'true' : 'false'}>
        <WeatherScene tone={tone} isDay={data ? data.isDay : true} fit="meet" />
      </span>

      <span className="today-wx-body">
        <span className="today-wx-head">
          {temp === null
            ? <span className="today-wx-skeleton" aria-hidden="true" />
            : <span className="today-wx-temp">{temp}<span className="today-wx-deg">°</span></span>}
          <span className="today-wx-cond">
            {data ? <CondGlyph code={data.code} isDay={data.isDay} /> : null}
            {label}
          </span>
        </span>

        {data && (
          <span className="today-wx-meta">
            <span>↑{Math.round(data.tMax)}° ↓{Math.round(data.tMin)}°</span>
            <span>Regen {Math.round(data.rain)} %</span>
            <span>Wind {Math.round(data.wind)} km/h</span>
          </span>
        )}
      </span>

      <ChevronRight size={16} strokeWidth={2.2} className="today-wx-chevron" aria-hidden="true" />
    </button>
  )
}
