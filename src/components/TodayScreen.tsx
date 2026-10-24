import { ShoppingCart, Backpack, Wallet, Activity, StickyNote, ChevronRight, ArrowRight } from 'lucide-react'
import type { TabView } from '../types'
import {
  TRIP, formatDayLong, formatRange, tripDay, tripPhase, daysUntilTrip, TRIP_LENGTH,
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
  onNavigate: (tab: TabView) => void
}

function euro(value: number): string {
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(value)
}

export default function TodayScreen({
  userName, participantCount, shoppingCount, shoppingChecked, bringCount,
  expenseTotal, userBalance, bristolEnabled, onNavigate,
}: TodayScreenProps) {
  const today = new Date()
  const phase = tripPhase(today)
  const day = tripDay(today)
  const open = Math.max(0, shoppingCount - shoppingChecked)

  const kicker = phase === 'during'
    ? `Tag ${day} von ${TRIP_LENGTH}`
    : phase === 'before'
      ? `Noch ${daysUntilTrip(today)} Tage`
      : 'Reise vorbei'

  const quickTiles: Array<{ key: TabView; label: string; hint: string; icon: typeof ShoppingCart }> = [
    { key: 'list', label: 'Einkaufen', hint: `${open} offen`, icon: ShoppingCart },
    { key: 'bring', label: 'Mitbringen', hint: `${bringCount} Sachen`, icon: Backpack },
    { key: 'expenses', label: 'Ausgabe', hint: 'eintragen', icon: Wallet },
  ]
  quickTiles.push(
    bristolEnabled
      ? { key: 'bristol', label: 'Bristol', hint: 'Eintrag', icon: Activity }
      : { key: 'notes', label: 'Notizen', hint: 'kurz festhalten', icon: StickyNote },
  )

  return (
    <div className="today">
      <section className="today-hero">
        <div className="today-hero-glow" aria-hidden="true" />
        <div className="today-kicker">{kicker}</div>
        <h1 className="today-date">{formatDayLong(today)}</h1>
        <div className="today-sub">{TRIP.name} · {TRIP.place}</div>
        <div className="today-sub today-sub-soft">
          {formatRange()} · {participantCount === 1 ? 'du allein' : `${participantCount} dabei`}
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
          <h2>Heute geplant</h2>
          <button type="button" className="today-link" onClick={() => onNavigate('trip')}>
            Reise öffnen <ArrowRight size={13} strokeWidth={2.4} />
          </button>
        </div>
        <button type="button" className="today-empty" onClick={() => onNavigate('trip')}>
          <span className="today-empty-title">Noch kein Programm für heute</span>
          <span className="today-empty-hint">
            Öffne die Reise, um Programmpunkte für heute anzulegen.
          </span>
          <ChevronRight size={16} strokeWidth={2} className="today-empty-chevron" />
        </button>
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
