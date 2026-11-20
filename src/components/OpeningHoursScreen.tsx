import { useEffect, useMemo, useState } from 'react'
import { MapPin, Info, Clock, ExternalLink, Fuel } from 'lucide-react'
import {
  CATEGORY_LABEL, OPENING_ENTRIES, OPENING_SOURCE, hoursText, openState, stateLabel,
  type Category, type OpeningEntry,
} from '../lib/openingHours'
import { cachedFuel, fetchFuel, formatFuelUpdated, type FuelData, type FuelStation } from '../lib/fuel'
import { mapsUrl } from '../lib/tripPlan'
import './OpeningHoursScreen.css'

const ORDER: Category[] = ['supermarket', 'bakery', 'pharmacy', 'fuel', 'cafe']

// Tankpreise: spanische Zapfsäulen zeigen drei Nachkommastellen („1,609").
const PRICE_FMT = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
const KM_FMT = new Intl.NumberFormat('de-DE')

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

  // ── Tanken: Spritpreise aus Agüimes (schlüsselloses Beiwerk) ──
  // Das lib-Modul hält 60 Minuten Frische und gibt bei Fehlern den letzten
  // Stand zurück — kein Neuladen-Knopf, solange nichts da ist, bleibt der
  // Abschnitt weg. Alles vor dem ersten (einzigen) Rückgabepfad: Rules of Hooks.
  const [fuel, setFuel] = useState<FuelData | null>(() => cachedFuel())
  useEffect(() => {
    let cancelled = false
    void fetchFuel().then((next) => {
      if (!cancelled && next && next.stations.length > 0) setFuel(next)
    })
    return () => { cancelled = true }
  }, [])

  // Bezug für „−16 ct" ist der teuerste Preis der GEMEINDE, nicht der drei
  // günstigsten — sonst steht bei drei gleich teuren Stationen überall „0 ct".
  const dieselMax = fuel?.maxDiesel ?? null

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

      {fuel && fuel.stations.length > 0 && (
        <section className="oh-group">
          <h2 className="oh-group-head">Spritpreise (Agüimes)</h2>
          <div className="oh-rows">
            {fuel.stations.map((station) => (
              <StationRow key={`${station.name} · ${station.km.toFixed(2)}`} station={station} maxDiesel={dieselMax} />
            ))}
          </div>
          <p className="oh-note" style={{ marginTop: 8, padding: '0 6px' }}>
            {fuel.updated
              ? `Preise von ${formatFuelUpdated(fuel.updated)}, ändern sich halbstündlich.`
              : 'Preise ändern sich halbstündlich.'}
            {' '}Vor der Rückgabe volltanken — voll zu voll, wie auf dem Notfall-Zettel.
          </p>
        </section>
      )}

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

/** Kurzadresse: Straßenname ohne Hausnummer-Zusatz hinter dem Komma. */
function shortAddress(address: string): string {
  return address.split(',')[0]?.trim() || address
}

function StationRow({ station, maxDiesel }: { station: FuelStation; maxDiesel: number | null }) {
  // Delta zur teuersten der gezeigten Stationen — in Cent, nie positiv.
  const delta = station.diesel !== null && maxDiesel !== null
    ? Math.round((station.diesel - maxDiesel) * 100)
    : null
  return (
    <div className="oh-row">
      <span className="oh-row-main">
        <span className="oh-name">
          {station.name} · {shortAddress(station.address)}
        </span>
        <span className="oh-meta">
          <Fuel size={10} strokeWidth={2} />
          Diesel {station.diesel !== null ? `${PRICE_FMT.format(station.diesel)} €` : '–'} · {KM_FMT.format(Math.round(station.km))} km
        </span>
      </span>
      {delta !== null && (
        <span className="oh-pill is-closed">{delta === 0 ? '0 ct' : `−${Math.abs(delta)} ct`}</span>
      )}
    </div>
  )
}
