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
  /** Live-Lage am Zielort (Heute). */
  data?: LiveWeather | null
  /** Tagesvorschau für einen anderen Reisetag — gleiche Zeile, gleiche Höhe. */
  forecast?: { code: number; tMax: number; tMin: number; rain: number; wind: number } | null
  /** Text, wenn für diesen Tag (noch) keine Vorhersage vorliegt. */
  emptyHint?: string | null
  onOpen: () => void
}

/**
 * Wetter-Zeile in der Tageskarte: Blick aus dem Fenster (animierte Szene),
 * Temperatur und Tageswerte. Tippen öffnet den Wetter-Screen. Datum und
 * Uhrzeit an der Unterkunft stehen eine Zeile höher in der Karte.
 *
 * Mit `forecast` zeigt dieselbe Zeile die Vorhersage eines anderen Reisetags —
 * identische Geometrie, damit der Tag-Pager beim Wischen nicht springt.
 */
export default function TodayWeather({ data, forecast, emptyHint, onOpen }: TodayWeatherProps) {
  const live = data ?? null
  const fc = live ? null : (forecast ?? null)
  const code = live ? live.code : fc?.code ?? null
  const isDay = live ? live.isDay : true
  const tone = code !== null ? skyTone(code) : 'partly'
  const night = live ? !live.isDay : false
  const label = code !== null ? conditionLabel(code, isDay) : 'Wetter wird geladen'
  const temp = live ? Math.round(live.temp) : fc ? Math.round(fc.tMax) : null
  const tMax = live ? live.tMax : fc?.tMax
  const tMin = live ? live.tMin : fc?.tMin
  const rain = live ? live.rain : fc?.rain
  const wind = live ? live.wind : fc?.wind

  const aria = temp === null
    ? 'Wetter am Zielort wird geladen'
    : live
      ? `${label}, ${temp} Grad in Temisas. Gefühlt ${Math.round(live.feels)} Grad, heute ${Math.round(live.tMax)} bis `
        + `${Math.round(live.tMin)} Grad, Regen ${Math.round(live.rain)} Prozent, Wind ${Math.round(live.wind)} `
        + 'Kilometer pro Stunde. Wetter öffnen'
      : `${label}, bis ${Math.round(tMax ?? 0)} Grad, ${Math.round(tMin ?? 0)} Grad in der Nacht, `
        + `Regen ${Math.round(rain ?? 0)} Prozent. Wetter öffnen`

  return (
    <button type="button" className="today-wx" onClick={onOpen} aria-label={aria}>
      <span className="today-wx-port" data-sky={tone} data-night={night ? 'true' : 'false'}>
        <WeatherScene tone={tone} isDay={isDay} fit="meet" />
      </span>

      <span className="today-wx-body">
        <span className="today-wx-head">
          {temp === null
            ? <span className="today-wx-skeleton" aria-hidden="true" />
            : <span className="today-wx-temp">{temp}<span className="today-wx-deg">°</span></span>}
          <span className="today-wx-cond">
            {code !== null ? <CondGlyph code={code} isDay={isDay} /> : null}
            {temp === null && emptyHint ? emptyHint : label}
          </span>
        </span>

        {tMax !== undefined && tMin !== undefined && rain !== undefined && wind !== undefined && (
          <span className="today-wx-meta">
            <span>↑{Math.round(tMax)}° ↓{Math.round(tMin)}°</span>
            <span>Regen {Math.round(rain)} %</span>
            <span>Wind {Math.round(wind)} km/h</span>
          </span>
        )}
      </span>

      <ChevronRight size={16} strokeWidth={2.2} className="today-wx-chevron" aria-hidden="true" />
    </button>
  )
}
