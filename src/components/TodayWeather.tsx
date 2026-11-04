import { useMemo } from 'react'
import { Moon, CloudMoon } from 'lucide-react'
import WeatherScene from './WeatherScene'
import WeatherGlyph from './WeatherGlyph'
import { useLiveWeather } from '../hooks/useLiveWeather'
import { conditionLabel, skyTone } from '../lib/liveWeather'
import './TodayWeather.css'

/** Nachts sind Sonnen-Icons falsch — klarer Himmel = Mond, wolkig = Wolke/Mond. */
function CondGlyph({ code, isDay }: { code: number; isDay: boolean }) {
  if (!isDay && code <= 3) {
    const Icon = code === 0 ? Moon : CloudMoon
    return <Icon size={13} strokeWidth={2.2} className="wx-live-glyph" aria-hidden="true" />
  }
  return <WeatherGlyph code={code} size={13} className="wx-live-glyph" />
}

/**
 * Wetterkarte für den Heute-Screen: aktuelle Lage am Zielort, animiert.
 * Tippen öffnet den Wetter-Screen. Ohne Daten (erster Start offline) steht
 * die Karte als ruhiger Platzhalter da, damit das Cockpit nicht springt.
 */
export default function TodayWeather({ onOpen }: { onOpen: () => void }) {
  const data = useLiveWeather()
  const tone = data ? skyTone(data.code) : 'partly'
  const night = data ? !data.isDay : false
  const label = data ? conditionLabel(data.code, data.isDay) : 'Wetter wird geladen'
  const temp = data ? Math.round(data.temp) : null

  const aria = useMemo(() => {
    if (!data) return 'Wetter am Zielort wird geladen'
    const parts = [
      `${label}, ${temp} Grad in Temisas`,
      `gefühlt ${Math.round(data.feels)} Grad`,
      `heute ${Math.round(data.tMax)} bis ${Math.round(data.tMin)} Grad`,
      `Regen ${Math.round(data.rain)} Prozent`,
      `Wind ${Math.round(data.wind)} Kilometer pro Stunde`,
    ]
    return `${parts.join(', ')}. Wetter öffnen`
  }, [data, label, temp])

  return (
    <button
      type="button"
      className="wx-live"
      data-sky={tone}
      data-night={night ? 'true' : 'false'}
      onClick={onOpen}
      aria-label={aria}
    >
      <span className="wx-live-body">
        <span className="wx-live-kicker">
          Temisas <span className="wx-live-kicker-dot">·</span> {night ? 'Nacht' : 'jetzt'}
        </span>
        {temp === null ? (
          <span className="wx-live-skeleton" aria-hidden="true" />
        ) : (
          <span className="wx-live-temp">
            {temp}
            <span className="wx-live-deg">°</span>
          </span>
        )}
        <span className="wx-live-cond">
          {data ? <CondGlyph code={data.code} isDay={data.isDay} /> : null}
          {label}
        </span>
        {data && (
          <span className="wx-live-meta">
            <span className="wx-live-pill">
              <span className="wx-live-up">↑</span> {Math.round(data.tMax)}°
              <span className="wx-live-down">↓</span> {Math.round(data.tMin)}°
            </span>
            <span className="wx-live-pill">gefühlt {Math.round(data.feels)}°</span>
            <span className="wx-live-pill">Regen {Math.round(data.rain)} %</span>
            <span className="wx-live-pill">Wind {Math.round(data.wind)} km/h</span>
          </span>
        )}
      </span>
      <span className="wx-live-scene">
        <WeatherScene tone={tone} isDay={data ? data.isDay : true} />
      </span>
    </button>
  )
}
