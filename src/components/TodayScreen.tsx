import { useMemo } from 'react'
import { ShoppingCart, Backpack, Wallet, Activity, ChevronRight, ArrowRight } from 'lucide-react'
import type { TabView } from '../types'
import type { TripPlanMap } from '../hooks/useTripPlan'
import { SLOTS, isoDay } from '../lib/tripPlan'
import SlotIcon from './SlotIcon'
import {
  TRIP, TRIP_START, TRIP_LENGTH, formatDayLong, formatDayShort, formatRange,
  tripDay, tripDays, tripPhase, daysUntilTrip,
} from '../lib/trip'

interface TodayScreenProps {
  userName: string
  listName: string
  participantCount: number
  shoppingCount: number
  shoppingChecked: number
  bringCount: number
  expenseTotal: number
  userBalance: number
  bristolEnabled: boolean
  /** gilt der Plan pro Tag (aus useTripPlan in App.tsx) */
  plan: TripPlanMap
  onNavigate: (tab: TabView) => void
}

function euro(value: number): string {
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(value)
}

export default function TodayScreen({
  userName, participantCount, shoppingCount, shoppingChecked, bringCount,
  expenseTotal, userBalance, bristolEnabled, plan, onNavigate,
}: TodayScreenProps) {
  const today = new Date()
  const phase = tripPhase(today)
  const day = tripDay(today)
  const open = Math.max(0, shoppingCount - shoppingChecked)
  const days = useMemo(() => tripDays(), [])

  const kicker = phase === 'during'
    ? `Tag ${day} von ${TRIP_LENGTH}`
    : phase === 'before'
      ? `Noch ${daysUntilTrip(today)} Tage`
      : 'Reise vorbei'

  // Vor der Reise zeigt die Karte den ersten Tag mit Plan, während der Reise
  // den heutigen, danach den letzten geplanten — nie eine leere Karte.
  const focusIndex = useMemo(() => {
    if (phase === 'during' && day) return day - 1
    const filled = days
      .map((d, i) => (plan[isoDay(d)] ? i : -1))
      .filter((i) => i >= 0)
    if (filled.length === 0) return phase === 'after' ? days.length - 1 : 0
    return phase === 'before' ? filled[0] : filled[filled.length - 1]
  }, [phase, day, days, plan])

  const focusDate = days[focusIndex] ?? TRIP_START
  const focusPlan = plan[isoDay(focusDate)]
  const focusSlots = focusPlan ? SLOTS.filter((slot) => focusPlan[slot.key]) : []
  const isToday = phase === 'during' && focusIndex === (day ?? 0) - 1

  const planTitle = isToday
    ? 'Heute geplant'
    : `Tag ${focusIndex + 1} · ${formatDayShort(focusDate)}`
  const emptyTitle = isToday
    ? 'Für heute steht nichts im Plan'
    : phase === 'before'
      ? 'Noch nichts geplant'
      : 'Kein Plan für diesen Tag'
  const emptyHint = isToday
    ? 'Öffne den Reiseplan und schlag etwas für heute vor.'
    : 'Im Reiseplan vorschlagen, alle stimmen ab — der Favorit wird übernommen.'

  const quickTiles: Array<{ key: TabView; label: string; hint: string; icon: typeof ShoppingCart }> = [
    { key: 'list', label: 'Einkaufen', hint: `${open} offen`, icon: ShoppingCart },
    { key: 'bring', label: 'Mitbringen', hint: `${bringCount} Sachen`, icon: Backpack },
    { key: 'expenses', label: 'Ausgabe', hint: 'eintragen', icon: Wallet },
  ]
  // Bristol ist fester Bestandteil des Cockpits (Flo-Entscheid) — der Tab dafür
  // ist aus der Bottom-Navigation gewandert.
  quickTiles.push({
    key: 'bristol',
    label: 'Bristol',
    hint: bristolEnabled ? 'Eintrag' : 'einschalten',
    icon: Activity,
  })

  const remaining = day !== null ? TRIP_LENGTH - day : null
  const metaRight = phase === 'during' && remaining !== null
    ? remaining === 0 ? 'Abreisetag' : `noch ${remaining} ${remaining === 1 ? 'Tag' : 'Tage'}`
    : phase === 'before'
      ? `ab ${formatDayShort(TRIP_START)}`
      : null

  return (
    <div className="today">
      <section className="today-hero">
        <div className="today-hero-glow" aria-hidden="true" />
        <div className="today-kicker">{kicker}</div>
        <h1 className="today-date">{formatDayLong(today)}</h1>
        <div className="today-sub">{TRIP.name} · {TRIP.place}</div>
        <div className="today-sub today-sub-soft">
          {formatRange()} · {participantCount === 1 ? 'du allein' : `${participantCount} dabei`}
          {metaRight ? ` · ${metaRight}` : ''}
        </div>
        <div className="today-progress" aria-hidden="true">
          {days.map((date, index) => {
            const past = phase === 'after' || (day !== null && index + 1 < day)
            const now = day !== null && index + 1 === day
            return (
              <span
                key={isoDay(date)}
                className={`today-progress-dot${past ? ' is-past' : ''}${now ? ' is-now' : ''}`}
              />
            )
          })}
        </div>
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

      <section className="today-section">
        <div className="today-section-head">
          <h2>{planTitle}</h2>
          <button type="button" className="today-link" onClick={() => onNavigate('plan')}>
            Reiseplan <ArrowRight size={13} strokeWidth={2.4} />
          </button>
        </div>
        {focusSlots.length > 0 ? (
          <button type="button" className="today-plan" onClick={() => onNavigate('plan')}>
            {focusSlots.map((slot) => (
              <span className="today-plan-row" key={slot.key}>
                <span className="today-plan-slot">
                  <SlotIcon slot={slot.key} size={10} className="today-plan-icon" />
                  {slot.label}
                </span>
                <span className="today-plan-title">{focusPlan?.[slot.key]?.title}</span>
              </span>
            ))}
          </button>
        ) : (
          <button type="button" className="today-empty" onClick={() => onNavigate('plan')}>
            <span className="today-empty-title">{emptyTitle}</span>
            <span className="today-empty-hint">{emptyHint}</span>
            <ChevronRight size={16} strokeWidth={2} className="today-empty-chevron" />
          </button>
        )}
      </section>

      <section className="today-section">
        <div className="today-section-head">
          <h2>Schnellzugriff</h2>
          <span className="today-hint">Hallo {userName}</span>
        </div>
        <div className="today-tiles">
          {quickTiles.map(({ key, label, hint, icon: Icon }) => (
            <button key={key} type="button" className="today-tile" onClick={() => onNavigate(key)}>
              <span className="today-tile-icon"><Icon size={17} strokeWidth={2} /></span>
              <span className="today-tile-label">{label}</span>
              <span className="today-tile-hint">{hint}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
