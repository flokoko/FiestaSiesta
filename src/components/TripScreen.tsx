import { MapPin, Image, Map as MapIcon, FileText, StickyNote, ChevronRight } from 'lucide-react'
import type { TabView } from '../types'
import {
  TRIP, formatDayShort, formatDayLong, formatRange, tripDay, tripDays,
  tripPhase, daysUntilTrip, TRIP_LENGTH,
} from '../lib/trip'

interface TripScreenProps {
  onNavigate: (tab: TabView) => void
  notesCount: number
}

export default function TripScreen({ onNavigate, notesCount }: TripScreenProps) {
  const days = tripDays()
  const current = tripDay()
  const phase = tripPhase()
  const badge = current
    ? `Tag ${current}`
    : phase === 'before'
      ? `in ${daysUntilTrip()} Tagen`
      : 'vorbei'
  const planHint = current
    ? `${TRIP_LENGTH} Tage · Tag ${current} läuft`
    : `${TRIP_LENGTH} Tage · noch nichts geplant`

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
          <div className="trip-hub-row is-active">
            <span className="trip-hub-icon"><MapPin size={16} strokeWidth={2} /></span>
            <span className="trip-hub-text">
              <strong>Reiseplan</strong>
              <small>{planHint}</small>
            </span>
            <span className="trip-hub-badge">{badge}</span>
          </div>
          <button type="button" className="trip-hub-row" onClick={() => onNavigate('notes')}>
            <span className="trip-hub-icon"><StickyNote size={16} strokeWidth={2} /></span>
            <span className="trip-hub-text">
              <strong>Notizen</strong>
              <small>{notesCount === 1 ? '1 Eintrag' : `${notesCount} Einträge`}</small>
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
          <div className="trip-hub-row is-muted">
            <span className="trip-hub-icon"><FileText size={16} strokeWidth={2} /></span>
            <span className="trip-hub-text">
              <strong>Dokumente</strong>
              <small>kommt später</small>
            </span>
          </div>
        </div>
      </section>

      <section className="trip-section">
        <h2 className="trip-h2">Die Tage</h2>
        <div className="trip-days">
          {days.map((date, index) => {
            const isToday = current === index + 1
            return (
              <article key={date.toISOString()} className={`trip-day${isToday ? ' is-today' : ''}`}>
                <header className="trip-day-head">
                  <span className="trip-day-num">Tag {index + 1}</span>
                  <span className="trip-day-date">{isToday ? formatDayLong(date) : formatDayShort(date)}</span>
                </header>
                <p className="trip-day-empty">Noch nichts geplant</p>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
