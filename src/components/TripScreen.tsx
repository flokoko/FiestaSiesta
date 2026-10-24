import { useEffect, useState } from 'react'
import { MapPin, Image, Map as MapIcon, FileText, StickyNote, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import SlotIcon from './SlotIcon'
import { SLOTS, isoDay, planFor, proposalsFor } from '../lib/tripPlan'
import type { TripProposal, TripSlot, TripVote, TabView } from '../types'
import {
  TRIP, formatDayShort, formatDayLong, formatRange, tripDay, tripDays,
  tripPhase, daysUntilTrip, TRIP_LENGTH,
} from '../lib/trip'

interface TripScreenProps {
  onNavigate: (tab: TabView) => void
  notesCount: number
  listId: string
}

type DayPlan = Partial<Record<TripSlot, string>>

export default function TripScreen({ onNavigate, notesCount, listId }: TripScreenProps) {
  const days = tripDays()
  const current = tripDay()
  const phase = tripPhase()
  const [plans, setPlans] = useState<Record<string, DayPlan>>({})
  const [proposalCount, setProposalCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [p, v] = await Promise.all([
        supabase.from('trip_proposals').select('*').eq('list_id', listId),
        supabase.from('trip_votes').select('*').eq('list_id', listId),
      ])
      if (cancelled || p.error || v.error) return
      const grouped: Record<string, string[]> = {}
      for (const row of (v.data ?? []) as TripVote[]) {
        grouped[row.proposal_id] = [...(grouped[row.proposal_id] ?? []), row.voter]
      }
      const rows = ((p.data ?? []) as TripProposal[]).map((row) => ({
        ...row,
        votes: grouped[row.id] ?? [],
      }))
      setProposalCount(rows.length)
      const next: Record<string, DayPlan> = {}
      for (const day of days) {
        const iso = isoDay(day)
        const entry: DayPlan = {}
        for (const slot of SLOTS) {
          const entryPlan = planFor(proposalsFor(rows, iso, slot.key))
          if (entryPlan) entry[slot.key] = entryPlan.title
        }
        if (Object.keys(entry).length > 0) next[iso] = entry
      }
      setPlans(next)
    }
    void load()
    return () => { cancelled = true }
  }, [listId, days])

  const badge = current
    ? `Tag ${current}`
    : phase === 'before'
      ? `in ${daysUntilTrip()} Tagen`
      : 'vorbei'
  const decidedSlots = Object.values(plans).reduce((n, day) => n + Object.keys(day).length, 0)
  const planHint = decidedSlots > 0
    ? `${decidedSlots} von ${TRIP_LENGTH * 3} Zeiten geplant · ${proposalCount} ${proposalCount === 1 ? 'Vorschlag' : 'Vorschläge'}`
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
            const iso = isoDay(date)
            const plan = plans[iso]
            return (
              <button
                type="button"
                key={iso}
                className={`trip-day${isToday ? ' is-today' : ''}`}
                onClick={() => onNavigate('plan')}
              >
                <header className="trip-day-head">
                  <span className="trip-day-num">Tag {index + 1}</span>
                  <span className="trip-day-date">{isToday ? formatDayLong(date) : formatDayShort(date)}</span>
                </header>
                {plan ? (
                  <ul className="trip-day-plan">
                    {SLOTS.filter((slot) => plan[slot.key]).map((slot) => (
                      <li key={slot.key}>
                        <SlotIcon slot={slot.key} size={10} className="trip-day-plan-emoji" />
                        {plan[slot.key]}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="trip-day-empty">Noch nichts geplant</p>
                )}
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
