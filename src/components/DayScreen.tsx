import { useEffect, useMemo, useRef } from 'react'
import {
  ChevronRight, ArrowRight, MapPin, StickyNote, ChefHat, Clock, ShieldAlert,
  CalendarPlus, Sunrise, Sunset, CloudRain, ShoppingCart, Backpack, Wallet, Activity,
} from 'lucide-react'
import type { TabView } from '../types'
import type { TripPlanMap } from '../hooks/useTripPlan'
import type { TripForecast } from '../lib/tripWeather'
import { SLOTS, isoDay } from '../lib/tripPlan'
import { sunClock } from '../lib/tripWeather'
import { pointKey } from '../lib/poiWeather'
import { usePoiWeather } from '../hooks/usePoiWeather'
import { useLiveWeather } from '../hooks/useLiveWeather'
import { useCanaryClock } from '../hooks/useCanaryClock'
import { hhmm, readDefaultLead, reminderClock } from '../lib/wake'
import { buildIcs, downloadIcs, eventsFromPlan } from '../lib/ics'
import SlotIcon from './SlotIcon'
import WeatherGlyph from './WeatherGlyph'
import TodayWeather from './TodayWeather'
import './DayScreen.css'
import { TRIP, TRIP_START, TRIP_LENGTH, formatDayLong, formatDayShort, formatRange, tripDay, tripDays, tripPhase, daysUntilTrip } from '../lib/trip'

interface DayScreenProps {
  userName: string
  participantCount: number
  shoppingCount: number
  shoppingChecked: number
  bringCount: number
  expenseTotal: number
  userBalance: number
  bristolEnabled: boolean
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
  userName, participantCount, shoppingCount, shoppingChecked, bringCount,
  expenseTotal, userBalance, bristolEnabled, notesCount, proposalCount,
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
  const stripRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const header = document.querySelector('.app-header')
    const el = stripRef.current
    if (!header || !el) return
    const apply = () => el.style.setProperty('--day-strip-top', `${Math.round(header.getBoundingClientRect().height)}px`)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(header)
    return () => ro.disconnect()
  }, [])
  const selectedDate = days[selectedIndex] ?? TRIP_START
  const selectedIso = isoDay(selectedDate)
  const isToday = day !== null && selectedIndex + 1 === day
  const wx = weather[selectedIso]
  const dayPlan = plan[selectedIso]
  const slots = dayPlan ? SLOTS.filter((slot) => dayPlan[slot.key]) : []
  const open = Math.max(0, shoppingCount - shoppingChecked)
  const decidedSlots = Object.values(plan).reduce((n, d) => n + Object.keys(d).length, 0)

  const kicker = isToday
    ? `Tag ${day} von ${TRIP_LENGTH}`
    : phase === 'before'
      ? `Noch ${daysUntilTrip(today)} Tage`
      : phase === 'after'
        ? 'Reise vorbei'
        : `Tag ${selectedIndex + 1} von ${TRIP_LENGTH}`

  const remaining = day !== null ? TRIP_LENGTH - day : null
  const metaRight = isToday && remaining !== null
    ? remaining === 0 ? 'Abreisetag' : `noch ${remaining} ${remaining === 1 ? 'Tag' : 'Tage'}`
    : phase === 'before'
      ? `ab ${formatDayShort(TRIP_START)}`
      : null

  // Ziel-Wetter nur für den gewählten Tag — vorher lud der Reise-Tab alle Tage.
  const poiTargets = useMemo(() => {
    if (!dayPlan) return []
    const out: Array<{ day: string; lat: number; lon: number; id: string; label: string }> = []
    for (const slot of SLOTS) {
      const p = dayPlan[slot.key]
      if (!p || typeof p.place_lat !== 'number' || typeof p.place_lon !== 'number') continue
      out.push({
        day: selectedIso,
        lat: p.place_lat,
        lon: p.place_lon,
        id: p.id,
        label: p.place?.split('·')[0].trim() || p.title,
      })
    }
    return out
  }, [dayPlan, selectedIso])

  const poiForecast = usePoiWeather(
    useMemo(() => poiTargets.map((t) => ({ day: t.day, lat: t.lat, lon: t.lon })), [poiTargets]),
  )

  const poiLines = poiTargets
    .map((t) => {
      const key = pointKey(t.lat, t.lon)
      const entry = poiForecast[key]
      const pointWeather = entry?.days[selectedIso]
      if (!pointWeather) return null
      return { id: t.id, label: t.label, elevation: entry?.elevation ?? null, weather: pointWeather }
    })
    .filter((line): line is NonNullable<typeof line> => line !== null)
    .sort((a, b) => (b.elevation ?? 0) - (a.elevation ?? 0))
    .slice(0, 2)

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

  const quickTiles: Array<{ key: TabView; label: string; hint: string; icon: typeof ShoppingCart }> = [
    { key: 'list', label: 'Einkaufen', hint: `${open} offen`, icon: ShoppingCart },
    { key: 'bring', label: 'Mitbringen', hint: `${bringCount} Sachen`, icon: Backpack },
    { key: 'expenses', label: 'Ausgabe', hint: 'eintragen', icon: Wallet },
    // Bristol bleibt fester Bestandteil des Cockpits (Flo-Entscheid).
    { key: 'bristol', label: 'Bristol', hint: bristolEnabled ? 'Eintrag' : 'einschalten', icon: Activity },
  ]

  const hub: Array<{ label: string; icon: typeof MapPin; onClick: () => void }> = [
    { label: 'Reiseplan', icon: MapPin, onClick: () => onNavigate('plan') },
    { label: `Notizen${notesCount > 0 ? ` ${notesCount}` : ''}`, icon: StickyNote, onClick: () => onNavigate('notes') },
    { label: 'Küche', icon: ChefHat, onClick: () => onNavigate('recipes') },
    { label: 'Offen jetzt', icon: Clock, onClick: () => onNavigate('offen') },
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
      <div className="day-strip-wrap" ref={stripRef}>
        <div className="cat-strip day-strip" role="tablist" aria-label="Reisetage">
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
        <div className="today-sub">{TRIP.name} · {TRIP.place}</div>
        <div className="today-sub today-sub-soft">
          {formatRange()} · {participantCount === 1 ? 'du allein' : `${participantCount} dabei`}
          {metaRight ? ` · ${metaRight}` : ''}
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
          emptyHint="Vorhersage folgt 16 Tage vorher"
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

      {(poiLines.length > 0 || (wx?.sunrise && wx?.sunset)) && (
        <div className="day-meta">
          {poiLines.map((line) => (
            <span className="day-poi-row" key={line.id}>
              <WeatherGlyph code={line.weather.code} size={12} className="day-poi-icon" />
              <span className="day-poi-name">{line.label}</span>
              <span
                className="day-poi-value"
                title={line.elevation !== null ? 'Höhe aus dem Geländemodell (Open-Meteo) — Näherung' : undefined}
              >
                {line.elevation !== null ? `≈${Math.round(line.elevation / 10) * 10} m · ` : ''}
                {Math.round(line.weather.tMax)}°
                {line.weather.wind >= 40 ? ` · ${Math.round(line.weather.wind)} km/h` : ''}
              </span>
            </span>
          ))}
          {wx?.sunrise && wx?.sunset && (
            <span className="day-sun">
              <Sunrise size={12} strokeWidth={2} aria-hidden="true" />
              <span>{sunClock(wx.sunrise)}</span>
              <span className="day-sun-sep">·</span>
              <Sunset size={12} strokeWidth={2} aria-hidden="true" />
              <span>{sunClock(wx.sunset)}</span>
            </span>
          )}
        </div>
      )}

      {tomorrowWx && (
        <p className="day-rain">
          <CloudRain size={13} strokeWidth={2} aria-hidden="true" />
          <span>
            Morgen Regen: {tomorrowWx.rain} % · Regenjacke einpacken, Ausflug mit Dach einplanen
          </span>
        </p>
      )}

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
