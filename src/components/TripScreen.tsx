import { useMemo } from 'react'
import { MapPin, Image, Map as MapIcon, ChevronRight, ShieldAlert, StickyNote } from 'lucide-react'
import SlotIcon from './SlotIcon'
import WeatherGlyph from './WeatherGlyph'
import { isoDay, SLOTS } from '../lib/tripPlan'
import { buildIcs, downloadIcs, eventsFromPlan } from '../lib/ics'
import type { TripPlanMap } from '../hooks/useTripPlan'
import type { TripForecast } from '../lib/tripWeather'
import { sunClock } from '../lib/tripWeather'
import { getWeatherInfo } from '../lib/weatherCodes'
import { Sunrise, Sunset, CalendarPlus, CloudRain } from 'lucide-react'
import type { TabView } from '../types'
import {
  TRIP, formatDayShort, formatDayLong, formatRange, tripDay, tripDays,
  tripPhase, daysUntilTrip, TRIP_LENGTH,
} from '../lib/trip'

interface TripScreenProps {
  onNavigate: (tab: TabView) => void
  onEmergency: () => void
  notesCount: number
  /** gilt der Plan pro Tag (aus useTripPlan in App.tsx) */
  plan: TripPlanMap
  proposalCount: number
  /** Tagesvorschau für die Reisetage, leer außerhalb des 16-Tage-Fensters */
  weather: TripForecast
}

export default function TripScreen({
  onNavigate, onEmergency, notesCount, plan, proposalCount, weather,
}: TripScreenProps) {
  // tripDays() liefert bei jedem Render ein neues Array — deshalb memoisiert.
  const days = useMemo(() => tripDays(), [])
  // Ganze Reise als Kalenderdatei — die Termine kommen aus dem bestätigten Plan.
  const icsEvents = useMemo(() => eventsFromPlan(plan), [plan])
  // Regen-Hinweis für morgen — dieselbe Schwelle wie der Push-Alarm (50 %).
  const tomorrowWx = useMemo(() => {
    const today = new Date()
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
    const iso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
    const entry = weather[iso]
    return entry && entry.rain >= 50 ? entry : null
  }, [weather])
  const current = tripDay()
  const phase = tripPhase()

  const badge = current
    ? `Tag ${current}`
    : phase === 'before'
      ? `in ${daysUntilTrip()} Tagen`
      : 'vorbei'
  const decidedSlots = Object.values(plan).reduce((n, day) => n + Object.keys(day).length, 0)
  const planHint = decidedSlots > 0
    ? `${decidedSlots} von ${TRIP_LENGTH * 3} Zeiten geplant · ${proposalCount} ${proposalCount === 1 ? 'Vorschlag' : 'Vorschläge'}`
    : `${TRIP_LENGTH} Tage · noch nichts geplant`
  // Vorschau nur für Tage anzeigen, die wirklich in der Reise liegen —
  // Open-Meteo liefert 16 Tage ab heute, das kann vor dem Reisebeginn enden.
  const lastTripWeatherDay = days.filter((d) => weather[isoDay(d)]).pop()
  const weatherHint = lastTripWeatherDay
    ? `Wetter bis ${formatDayShort(lastTripWeatherDay)}`
    : phase === 'after' ? null : 'Wetter folgt 16 Tage vorher'

  return (
    <div className="trip">
      <section className="trip-hero">
        <div className="trip-hero-glow" aria-hidden="true" />
        <div className="trip-kicker">Reise</div>
        <h1 className="trip-title">{TRIP.name}</h1>
        <div className="trip-range">{formatRange()} · {days.length} Tage · {TRIP.place}</div>
      </section>

      <section className="trip-section">
        <h2 className="trip-h2">Dazu gehören</h2>
        <div className="trip-hub">
          <button type="button" className="trip-hub-row is-active" onClick={() => onNavigate('plan')}>
            <span className="trip-hub-icon"><MapPin size={16} strokeWidth={2} /></span>
            <span className="trip-hub-text">
              <strong>Reiseplan</strong>
              <small>{planHint}</small>
            </span>
            <span className="trip-hub-badge">{badge}</span>
            <ChevronRight size={15} strokeWidth={2} className="trip-hub-chevron" />
          </button>
          <button type="button" className="trip-hub-row" onClick={() => onNavigate('notes')}>
            <span className="trip-hub-icon"><StickyNote size={16} strokeWidth={2} /></span>
            <span className="trip-hub-text">
              <strong>Notizen</strong>
              <small>{notesCount === 1 ? '1 Eintrag' : `${notesCount} Einträge`}</small>
            </span>
            <ChevronRight size={15} strokeWidth={2} className="trip-hub-chevron" />
          </button>
          <button type="button" className="trip-hub-row" onClick={onEmergency}>
            <span className="trip-hub-icon"><ShieldAlert size={16} strokeWidth={2} /></span>
            <span className="trip-hub-text">
              <strong>Notfall &amp; Adressen</strong>
              <small>Notruf, Arzt, Adresse — offline</small>
            </span>
            <ChevronRight size={15} strokeWidth={2} className="trip-hub-chevron" />
          </button>
          <div className="trip-hub-row is-muted">
            <span className="trip-hub-icon"><Image size={16} strokeWidth={2} /></span>
            <span className="trip-hub-text">
              <strong>Fotos</strong>
              <small>kommt später</small>
            </span>
          </div>
          <div className="trip-hub-row is-muted">
            <span className="trip-hub-icon"><MapIcon size={16} strokeWidth={2} /></span>
            <span className="trip-hub-text">
              <strong>Karte</strong>
              <small>kommt später</small>
            </span>
          </div>
        </div>
      </section>

      <section className="trip-section">
        <div className="trip-section-head">
          <h2 className="trip-h2">Die Tage</h2>
          <div className="trip-section-actions">
            {weatherHint && <span className="trip-weather-hint">{weatherHint}</span>}
            {icsEvents.length > 0 && (
              <button
                type="button"
                className="trip-ics-btn"
                onClick={() => {
                  downloadIcs(
                    `fiesta-siesta-${TRIP.start}.ics`,
                    buildIcs({ calendarName: `Fiesta Siesta · ${TRIP.name}`, events: icsEvents }),
                  )
                  navigator.vibrate?.(8)
                }}
              >
                <CalendarPlus size={13} strokeWidth={2} />
                Kalender
              </button>
            )}
          </div>
        </div>
        {tomorrowWx && (
          <p className="trip-rain-hint">
            <CloudRain size={13} strokeWidth={2} />
            Morgen Regen: {tomorrowWx.rain} %
            <span className="trip-rain-hint-sep">·</span>
            Regenjacke einpacken, Ausflug mit Dach einplanen
          </p>
        )}
        <div className="trip-days">
          {days.map((date, index) => {
            const isToday = current === index + 1
            const iso = isoDay(date)
            const dayPlan = plan[iso]
            const wx = weather[iso]
            return (
              <button
                type="button"
                key={iso}
                className={`trip-day${isToday ? ' is-today' : ''}`}
                onClick={() => onNavigate('plan')}
              >
                <header className="trip-day-head">
                  <span className="trip-day-num">Tag {index + 1}</span>
                  <span className="trip-day-meta">
                    {wx && (
                      <span
                        className={`trip-day-weather${wx.rain >= 40 ? ' is-wet' : ''}`}
                        title={`${getWeatherInfo(wx.code).desc} · ${Math.round(wx.tMax)}° / ${Math.round(wx.tMin)}° · Regen ${wx.rain}%`}
                      >
                        <WeatherGlyph code={wx.code} size={12} className="trip-day-weather-icon" />
                        {Math.round(wx.tMax)}°
                        {wx.rain >= 30 && <em>{wx.rain}%</em>}
                      </span>
                    )}
                    <span className="trip-day-date">{isToday ? formatDayLong(date) : formatDayShort(date)}</span>
                  </span>
                </header>
                {dayPlan ? (
                  <ul className="trip-day-plan">
                    {SLOTS.filter((slot) => dayPlan[slot.key]).map((slot) => (
                      <li key={slot.key}>
                        <SlotIcon slot={slot.key} size={10} className="trip-day-plan-emoji" />
                        {dayPlan[slot.key]?.title}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="trip-day-empty">Noch nichts geplant</p>
                )}
                {wx && wx.sunrise && wx.sunset && (
                  <p className="trip-day-sun">
                    <Sunrise size={11} strokeWidth={2} className="trip-day-sun-icon" />
                    <span>{sunClock(wx.sunrise)}</span>
                    <span className="trip-day-sun-sep">·</span>
                    <Sunset size={11} strokeWidth={2} className="trip-day-sun-icon" />
                    <span>{sunClock(wx.sunset)}</span>
                  </p>
                )}
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
