import { useEffect, useMemo, useState } from 'react'
import { MapPin, Info, Clock, ExternalLink } from 'lucide-react'
import {
  CATEGORY_LABEL, OPENING_ENTRIES, OPENING_SOURCE, hoursText, openState, stateLabel,
  type Category, type OpeningEntry,
} from '../lib/openingHours'
import { mapsUrl } from '../lib/tripPlan'
import './OpeningHoursScreen.css'

const ORDER: Category[] = ['supermarket', 'bakery', 'pharmacy', 'fuel', 'cafe']

export default function OpeningHoursScreen() {
  // Status altert — jede Minute neu rechnen, sonst bleibt „in 3 Min" stehen.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const now = useMemo(() => new Date(), [tick])

  const groups = useMemo(
    () =>
      ORDER.map((category) => ({
        category,
        entries: OPENING_ENTRIES.filter((entry) => entry.category === category),
      })).filter((group) => group.entries.length > 0),
    [],
  )

  const openCount = useMemo(
    () => OPENING_ENTRIES.filter((entry) => openState(entry.hours, now).open).length,
    [now],
  )

  return (
    <div className="oh-screen list-screen">
      <header className="list-head">
        <div className="list-head-text">
          <h1>Offen jetzt</h1>
          <p>
            {openCount === 0
              ? 'gerade nichts offen'
              : openCount === 1
                ? '1 von ' + OPENING_ENTRIES.length + ' hat offen'
                : openCount + ' von ' + OPENING_ENTRIES.length + ' haben offen'}
          </p>
        </div>
      </header>

      <div className="oh-hint">
        <Info size={14} strokeWidth={2} className="oh-hint-icon" />
        <span>
          Temisas hat keinen Laden. Alles hier liegt in Agüimes, 10–15 Min mit dem Auto.
        </span>
      </div>

      {groups.map((group) => (
        <section className="oh-group" key={group.category}>
          <h2 className="oh-group-head">{CATEGORY_LABEL[group.category]}</h2>
          <div className="oh-rows">
            {group.entries.map((entry) => (
              <Row key={entry.id} entry={entry} now={now} />
            ))}
          </div>
        </section>
      ))}

      <p className="oh-source">
        Zeiten: {OPENING_SOURCE} · Kanaren-Zeit (eine Stunde hinter Deutschland)
      </p>
    </div>
  )
}

function Row({ entry, now }: { entry: OpeningEntry; now: Date }) {
  const state = openState(entry.hours, now)
  const label = stateLabel(state, now)

  return (
    <a
      className="oh-row"
      href={mapsUrl(entry.name)}
      target="_blank"
      rel="noreferrer"
      aria-label={`${entry.name} in Maps öffnen`}
    >
      <span className="oh-row-main">
        <span className="oh-name">
          {entry.name}
          <ExternalLink size={10} strokeWidth={2} className="oh-name-icon" />
        </span>
        <span className="oh-meta">
          <Clock size={10} strokeWidth={2} />
          {hoursText(entry.hours)}
        </span>
        <span className="oh-address">
          <MapPin size={10} strokeWidth={2} />
          {entry.address}
        </span>
        {entry.note && <span className="oh-note">{entry.note}</span>}
      </span>
      <span className={`oh-pill is-${label.tone}`}>{label.text}</span>
    </a>
  )
}
