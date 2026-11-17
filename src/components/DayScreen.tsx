import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight, ArrowRight, MapPin, Map, StickyNote, ChefHat, Clock, ShieldAlert,
  CalendarPlus, Sunset, CloudRain, Activity,
} from 'lucide-react'
import type { TabView } from '../types'
import type { TripPlanMap } from '../hooks/useTripPlan'
import type { TripForecast } from '../lib/tripWeather'
import { SLOTS, isoDay } from '../lib/tripPlan'
import { sunWarning } from '../lib/sunWarning'
import { useLiveWeather } from '../hooks/useLiveWeather'
import { useCanaryClock } from '../hooks/useCanaryClock'
import { hhmm, readDefaultLead, reminderClock } from '../lib/wake'
import { buildIcs, downloadIcs, eventsFromPlan } from '../lib/ics'
import SlotIcon from './SlotIcon'
import TodayWeather from './TodayWeather'
import './DayScreen.css'
import { TRIP, TRIP_START, TRIP_LENGTH, formatDayLong, formatDayShort, formatRange, tripDay, tripDays, tripPhase, daysUntilTrip } from '../lib/trip'

interface DayScreenProps {
  participantCount: number
  shoppingCount: number
  shoppingChecked: number
  bringCount: number
  expenseTotal: number
  userBalance: number
  notesCount: number
  proposalCount: number
  /** gilt der Plan pro Tag (aus useTripPlan in App.tsx) */
  plan: TripPlanMap
  /** Tagesvorschau für die Reisetage, leer außerhalb des 16-Tage-Fensters */
  weather: TripForecast
  /** gewählter Tag (ISO), geteilt mit dem Reiseplan */
  dayIso: string
  onPickDay: (iso: string) => void
  onNavigate: (tab: TabView) => void
  onEmergency: () => void
}

function euro(value: number): string {
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

/**
 * Tag-Screen: Heute-Karte und Reise-Tage in EINEM Screen. Die Tagesleiste oben
 * wählt den Tag; die Karte zeigt Datum, Phase, Wetter, Plan und Ziele des
 * gewählten Tages. Ersetzt TodayScreen + TripScreen (Phase 2), damit der
 * Reiseplan nicht mehr zwei Taps tief liegt.
 */
export default function DayScreen({
  participantCount, shoppingCount, shoppingChecked, bringCount,
  expenseTotal, userBalance, notesCount, proposalCount,
  plan, weather, dayIso, onPickDay, onNavigate, onEmergency,
}: DayScreenProps) {
  const today = new Date()
  const phase = tripPhase(today)
  const day = tripDay(today)
  const localClock = useCanaryClock()
  const liveWeather = useLiveWeather()
  const days = useMemo(() => tripDays(), [])

  // Gewählter Tag: kommt aus App.tsx (dort auch persistiert), damit Tag-Screen
  // und Reiseplan nie auf verschiedenen Tagen stehen.
  const foundIndex = days.findIndex((d) => isoDay(d) === dayIso)
  const selectedIndex = foundIndex >= 0 ? foundIndex : phase === 'during' && day ? day - 1 : 0

  // Die Tagesleiste klebt unter der Kopfzeile — deren Höhe ist nicht konstant
  // (Font-Tausch, Rotation), deshalb messen statt einen festen Wert raten.
  // Sie ist außerdem nur im geklebten Zustand eine Fläche: am Seitenanfang
  // liegen die Chips wie auf den anderen Screens direkt auf der Aurora, erst
  // beim Scrollen bekommt das Band die Glasfläche der Kopfzeile.
  const stripRef = useRef<HTMLDivElement | null>(null)
  const [stripStuck, setStripStuck] = useState(false)
  useEffect(() => {
    const header = document.querySelector('.app-header')
    const el = stripRef.current
    if (!header || !el) return
    let top = Math.round(header.getBoundingClientRect().height)
    const sync = () => {
      const stuck = el.getBoundingClientRect().top <= top + 1
      setStripStuck((prev) => (prev === stuck ? prev : stuck))
    }
    const apply = () => {
      top = Math.round(header.getBoundingClientRect().height)
      el.style.setProperty('--day-strip-top', `${top}px`)
      sync()
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(header)
    window.addEventListener('scroll', sync, { passive: true })
    window.addEventListener('resize', sync)
    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', sync)
      window.removeEventListener('resize', sync)
    }
  }, [])
  const selectedDate = days[selectedIndex] ?? TRIP_START
  const selectedIso = isoDay(selectedDate)
  const isToday = day !== null && selectedIndex + 1 === day
  const wx = weather[selectedIso]
  const dayPlan = plan[selectedIso]
  const slots = dayPlan ? SLOTS.filter((slot) => dayPlan[slot.key]) : []
  const open = Math.max(0, shoppingCount - shoppingChecked)
  const decidedSlots = Object.values(plan).reduce((n, d) => n + Object.keys(d).length, 0)

  // Rückweg im Dunkeln? Nur der letzte Punkt des Tages mit Koordinaten zählt,
  // und nur wenn die Heimfahrt eine Bergstraße ist (≥ 20 Min) und nach dem
  // Sonnenuntergang ankommt. Der Hinweis steht als Badge in der Plan-Sektion.
  const sunWarn = useMemo(
    () => (dayPlan ? sunWarning({ sunsetIso: wx?.sunset ?? null, plan: dayPlan, day: selectedIso }) : null),
    [dayPlan, selectedIso, wx?.sunset],
  )

  const kicker = isToday
    ? `Tag ${day} von ${TRIP_LENGTH}`
    : phase === 'before'
      ? `Noch ${daysUntilTrip(today)} Tage`
      : phase === 'after'
        ? 'Reise vorbei'
        : `Tag ${selectedIndex + 1} von ${TRIP_LENGTH}`

  // Regen-Hinweis nur für morgen, gleiche Schwelle wie der Push-Alarm (50 %).
  const tomorrowWx = useMemo(() => {
    if (!isToday) return null
    const next = days[selectedIndex + 1]
    if (!next) return null
    const entry = weather[isoDay(next)]
    return entry && entry.rain >= 50 ? entry : null
  }, [isToday, days, selectedIndex, weather])

  const icsEvents = useMemo(() => eventsFromPlan(plan), [plan])

  const planTitle = isToday ? 'Heute geplant' : `Tag ${selectedIndex + 1} · ${formatDayShort(selectedDate)}`
  const emptyTitle = isToday
    ? 'Für heute steht nichts im Plan'
    : phase === 'before'
      ? 'Noch nichts geplant'
      : 'Kein Plan für diesen Tag'
  const emptyHint = isToday
    ? 'Öffne den Reiseplan und schlag etwas für heute vor.'
    : 'Im Reiseplan vorschlagen, alle stimmen ab — der Favorit wird übernommen.'

  const hub: Array<{ label: string; icon: typeof MapPin; onClick: () => void }> = [
    { label: 'Reiseplan', icon: MapPin, onClick: () => onNavigate('plan') },
    { label: 'Karte', icon: Map, onClick: () => onNavigate('karte') },
    { label: 'Küche', icon: ChefHat, onClick: () => onNavigate('recipes') },
    { label: `Notizen${notesCount > 0 ? ` ${notesCount}` : ''}`, icon: StickyNote, onClick: () => onNavigate('notes') },
    { label: 'Offen jetzt', icon: Clock, onClick: () => onNavigate('offen') },
    // Bristol bleibt fester Bestandteil des Cockpits (Flo-Entscheid): ohne
    // Modus zeigt der Bristol-Tab wie bisher das Gate.
    { label: 'Bristol', icon: Activity, onClick: () => onNavigate('bristol') },
    { label: 'Notfall', icon: ShieldAlert, onClick: onEmergency },
  ]

  const pickDay = (index: number) => {
    navigator.vibrate?.(6)
    const date = days[index]
    if (date) onPickDay(isoDay(date))
  }

  // Die Tagesleiste horizontal auf den gewählten Tag ziehen — ab Tag 5 liegt
  // er sonst außerhalb des sichtbaren Bereichs. Nur die Leiste scrollen, nie
  // die Seite (scrollIntoView würde beides tun).
  useEffect(() => {
    const strip = stripRef.current?.querySelector('.day-strip') as HTMLElement | null
    const chip = strip?.querySelector('.cat-chip.active') as HTMLElement | null
    if (!strip || !chip) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    strip.scrollTo({
      left: Math.max(0, chip.offsetLeft - strip.clientWidth / 2 + chip.offsetWidth / 2),
      behavior: reduce ? 'auto' : 'smooth',
    })
  }, [selectedIndex])

  return (
    <div className="day-screen">
      <div className={`day-strip-wrap${stripStuck ? ' is-stuck' : ''}`} ref={stripRef}>
        {/* Tabs per WAI-ARIA: Pfeiltasten wandern UND wählen (Auswahl folgt dem
            Fokus), Home/End an die Ränder — den Chips außen ist mit roving
            tabindex der Tab-Pol weggenommen. Die Auswahl geht über pickDay,
            der Scroll-Effekt unten reagiert wie auf den Klick. */}
        <div
          className="cat-strip day-strip"
          role="tablist"
          aria-label="Reisetage"
          onKeyDown={(e) => {
            let idx = selectedIndex
            if (e.key === 'ArrowRight') idx += 1
            else if (e.key === 'ArrowLeft') idx -= 1
            else if (e.key === 'Home') idx = 0
            else if (e.key === 'End') idx = days.length - 1
            else return
            e.preventDefault()
            idx = Math.max(0, Math.min(days.length - 1, idx))
            if (idx !== selectedIndex) pickDay(idx)
            e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[idx]?.focus()
          }}
        >
          {days.map((date, index) => {
            const isSel = index === selectedIndex
            const isRealToday = day !== null && index + 1 === day
            return (
              <button
                key={isoDay(date)}
                type="button"
                role="tab"
                aria-selected={isSel}
                className={`cat-chip${isSel ? ' active' : ''}${isRealToday ? ' is-today' : ''}`}
                tabIndex={isSel ? 0 : -1}
                onClick={() => pickDay(index)}
              >
                {formatDayShort(date)}
              </button>
            )
          })}
        </div>
      </div>

      <section className="today-hero">
        <div className="today-hero-glow" aria-hidden="true" />
        <div className="today-topline">
          <span className="today-kicker">{kicker}</span>
          <span className="today-local">
            <span className="today-local-dot" aria-hidden="true" />
            vor Ort {localClock.date} · {localClock.time}
          </span>
        </div>
        <h1 className="today-date">{formatDayLong(selectedDate)}</h1>
        <div className="today-sub">
          {TRIP.place} · {formatRange()} · {participantCount === 1 ? 'du allein' : `${participantCount} dabei`}
        </div>
        <div className="today-progress" aria-hidden="true">
          {days.map((date, index) => {
            const past = phase === 'after' || (day !== null && index + 1 < day)
            return (
              <span
                key={isoDay(date)}
                className={`today-progress-dot${past ? ' is-past' : ''}${index === selectedIndex ? ' is-now' : ''}${day !== null && index + 1 === day ? ' is-today' : ''}`}
              />
            )
          })}
        </div>

        <TodayWeather
          data={isToday ? liveWeather : null}
          forecast={isToday ? null : wx ?? null}
          // Heute zeigt den Lade-Hinweis der Karte; der 16-Tage-Satz gehört nur
          // zu Reisetagen außerhalb der Vorhersage-Reichweite.
          emptyHint={isToday ? null : 'Vorhersage folgt 16 Tage vorher'}
          onOpen={() => onNavigate('weather')}
        />
      </section>

      <div className="today-chips">
        <button type="button" className="today-chip" onClick={() => onNavigate('list')}>
          <span className="today-chip-num">{open}</span>
          <span className="today-chip-label">offen</span>
        </button>
        <button type="button" className="today-chip" onClick={() => onNavigate('bring')}>
          <span className="today-chip-num">{bringCount}</span>
          <span className="today-chip-label">mitbringen</span>
        </button>
        <button type="button" className="today-chip is-warm" onClick={() => onNavigate('expenses')}>
          <span className="today-chip-num">{euro(expenseTotal)}</span>
          <span className="today-chip-label">ausgaben €</span>
        </button>
      </div>

      {expenseTotal > 0 && (
        <div className="today-balance">
          {userBalance >= 0
            ? `Dir stehen ${euro(userBalance)} € zu`
            : `Du schuldest ${euro(Math.abs(userBalance))} €`}
        </div>
      )}

      <div className="day-hub">
        {hub.map(({ label, icon: Icon, onClick }) => (
          <button key={label} type="button" className="day-hub-chip" onClick={onClick}>
            <Icon size={14} strokeWidth={2} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <section className="today-section">
        <div className="today-section-head">
          <h2>{planTitle}</h2>
          <div className="day-plan-actions">
            {icsEvents.length > 0 && (
              <button
                type="button"
                className="day-ics"
                aria-label="Ganze Reise in den Kalender"
                title="Ganze Reise als Kalenderdatei"
                onClick={() => {
                  downloadIcs(
                    `fiesta-siesta-${TRIP.start}.ics`,
                    buildIcs({ calendarName: `Fiesta Siesta · ${TRIP.name}`, events: icsEvents }),
                  )
                  navigator.vibrate?.(8)
                }}
              >
                <CalendarPlus size={13} strokeWidth={2} />
              </button>
            )}
            <button type="button" className="today-link" onClick={() => onNavigate('plan')}>
              Reiseplan <ArrowRight size={13} strokeWidth={2.4} />
            </button>
          </div>
        </div>
        <p className="day-plan-hint">
          {decidedSlots > 0
            ? `${decidedSlots} von ${TRIP_LENGTH * 3} Zeiten fest · ${proposalCount} ${proposalCount === 1 ? 'Vorschlag' : 'Vorschläge'}`
            : `${TRIP_LENGTH} Tage · noch nichts festgelegt`}
        </p>

        {sunWarn && (
          <p className="day-plan-warn">
            <Sunset size={12} strokeWidth={2} aria-hidden="true" />
            {/* Icon und Text als EIN Span: Flex soll den Satz in sich
                umbrechen, nicht auf zwei Spalten verteilen. */}
            <span>
              Rückweg von {sunWarn.place} im Dunkeln — Sonnenuntergang {sunWarn.sunsetClock}, {sunWarn.minutes} Min. Fahrt.
            </span>
          </p>
        )}

        {slots.length > 0 ? (
          <button type="button" className="today-plan" onClick={() => onNavigate('plan')}>
            {slots.map((slot) => {
              const p = dayPlan?.[slot.key]
              return (
                <span className="today-plan-row" key={slot.key}>
                  <span className="today-plan-slot">
                    <SlotIcon slot={slot.key} size={10} className="today-plan-icon" />
                    {slot.label}
                  </span>
                  <span className="today-plan-title">{p?.title}</span>
                  {p?.starts_at && (
                    <span className="day-plan-time">
                      {hhmm(p.starts_at)}
                      {p.remind_enabled && (
                        <span className="day-plan-alarm" title="Wecker aktiv">
                          {reminderClock(p.starts_at, p.remind_before ?? readDefaultLead())}
                        </span>
                      )}
                    </span>
                  )}
                </span>
              )
            })}
          </button>
        ) : (
          <button type="button" className="today-empty" onClick={() => onNavigate('plan')}>
            <span className="today-empty-title">{emptyTitle}</span>
            <span className="today-empty-hint">{emptyHint}</span>
            <ChevronRight size={16} strokeWidth={2} className="today-empty-chevron" />
          </button>
        )}
      </section>

      {tomorrowWx && (
        <p className="day-rain">
          <CloudRain size={13} strokeWidth={2} aria-hidden="true" />
          <span>
            Morgen Regen: {tomorrowWx.rain} % · Regenjacke einpacken, Ausflug mit Dach einplanen
          </span>
        </p>
      )}
    </div>
  )
}
