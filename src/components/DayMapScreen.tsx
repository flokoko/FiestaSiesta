import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ExternalLink, MapPin, Navigation, Info } from 'lucide-react'
import type { TripPlanMap } from '../hooks/useTripPlan'
import {
  HOME_POINT, buildDayStops, fetchDayRoute, legMinutes, quickRouteFor, type DayRoute, type RouteStop,
} from '../lib/dayRoute'
import { hhmm } from '../lib/wake'
import { SLOTS, isoDay } from '../lib/tripPlan'
import { formatDayLong, formatDayShort, tripDay, tripDays } from '../lib/trip'
import './DayMapScreen.css'

interface DayMapScreenProps {
  dayIso: string
  plan: TripPlanMap
}

// Leaflets Standard-Marker braucht Bilddateien, die der Bundler nicht kennt —
// eigene DivIcons mit Nummer (Reihenfolge der Route) bzw. Startpunkt.
function stopIcon(index: number) {
  return L.divIcon({
    className: 'day-map-pin',
    html: `<span>${index + 1}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

const homeIcon = L.divIcon({
  className: 'day-map-home',
  html: '<span></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

function FitRoute({ points }: { points: Array<[number, number]> }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    const bounds = L.latLngBounds(points.map(([lat, lon]) => L.latLng(lat, lon)))
    map.fitBounds(bounds, { padding: [26, 26], maxZoom: 12 })
  }, [map, points])
  return null
}

/**
 * Tageskarte: Unterkunft + Ziele des gewählten Tages auf einer OSM-Karte,
 * verbunden zur Route (OSRM), darunter die Etappen mit geschätzter Fahrzeit.
 * Ohne Route (offline, Demo-Limit) bleibt die Luftlinie gestrichelt.
 */
export default function DayMapScreen({ dayIso, plan }: DayMapScreenProps) {
  const days = useMemo(() => tripDays(), [])
  const dayIndex = Math.max(0, days.findIndex((d) => isoDay(d) === dayIso))
  const dayDate = days[dayIndex] ?? days[0]
  const today = tripDay()
  const isToday = today !== null && dayIndex + 1 === today

  const dayPlan = plan[dayIso]
  const stops = useMemo(() => buildDayStops(dayPlan), [dayPlan])
  const [route, setRoute] = useState<DayRoute | null>(() => (stops.length > 0 ? quickRouteFor(stops) : null))
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (stops.length === 0) {
      setRoute(null)
      return
    }
    // Sofort die Schätzung zeigen, die echte Route nachreichen.
    setRoute(quickRouteFor(stops))
    let cancelled = false
    setLoading(true)
    void fetchDayRoute(stops)
      .then((real) => {
        if (!cancelled && real) setRoute(real)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [stops])

  const stopTimes = useMemo(() => {
    const map = new Map<string, string | null>()
    if (dayPlan) for (const slot of SLOTS) map.set(dayPlan[slot.key]?.id ?? '', dayPlan[slot.key]?.starts_at ?? null)
    return map
  }, [dayPlan])

  const mapsUrl = useMemo(() => {
    if (stops.length === 0) return null
    const all: RouteStop[] = [
      { id: 'home', label: 'Unterkunft', lat: HOME_POINT[0], lon: HOME_POINT[1] },
      ...stops,
    ]
    return `https://www.google.com/maps/dir/${all.map((p) => `${p.lat},${p.lon}`).join('/')}`
  }, [stops])

  const dayLabel = `Tag ${dayIndex + 1} · ${formatDayShort(dayDate)}`
  const points: Array<[number, number]> = route?.points ?? [HOME_POINT, ...stops.map((s) => [s.lat, s.lon] as [number, number])]

  return (
    <div className="day-map-screen">
      <header className="list-head">
        <div className="list-head-text">
          <h1>Tageskarte</h1>
          <p>
            {dayLabel}
            {isToday ? ' · heute' : ''} · {stops.length === 0 ? 'keine Ziele' : `${stops.length} ${stops.length === 1 ? 'Ziel' : 'Ziele'}`}
          </p>
        </div>
        {mapsUrl && (
          <a
            className="day-map-nav"
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Route in Google Maps öffnen"
            title="Route in Google Maps öffnen"
          >
            <ExternalLink size={16} strokeWidth={2} />
          </a>
        )}
      </header>

      {stops.length === 0 ? (
        <div className="day-map-empty">
          <MapPin size={18} strokeWidth={2} />
          <strong>Keine Ziele mit Koordinaten</strong>
          <span>
            Im Reiseplan einen Google-Maps-Link in das Ortsfeld einfügen — dann steht der Punkt
            hier auf der Karte und die Fahrzeit wird gerechnet.
          </span>
        </div>
      ) : (
        <>
          <div className="day-map-canvas">
            <MapContainer
              center={HOME_POINT}
              zoom={10}
              style={{ height: '100%', width: '100%' }}
              scrollWheelZoom={true}
            >
              {/* Keyless OSM — CARTO bräuchte einen API-Key und liefert sonst
                  Kacheln mit „API KEY REQUIRED". Dunkelmodus invertiert per CSS. */}
              <TileLayer
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende'
                className="day-map-tiles"
                maxNativeZoom={18}
              />
              <Polyline
                positions={points}
                pathOptions={
                  route?.source === 'route'
                    ? { color: '#D7263D', weight: 4, opacity: 0.9, lineCap: 'round' }
                    : { color: '#D7263D', weight: 3, opacity: 0.75, dashArray: '6 8' }
                }
              />
              <Marker position={HOME_POINT} icon={homeIcon}>
                <Tooltip direction="top" offset={[0, -10]}>Casa Los Pinos, Temisas</Tooltip>
              </Marker>
              {stops.map((stop, index) => (
                <Marker key={stop.id} position={[stop.lat, stop.lon]} icon={stopIcon(index)}>
                  <Tooltip direction="top" offset={[0, -12]}>{stop.label}</Tooltip>
                </Marker>
              ))}
              <FitRoute points={points} />
            </MapContainer>
          </div>

          <div className="day-map-summary">
            <span className="day-map-stat">
              <Navigation size={13} strokeWidth={2} aria-hidden="true" />
              {route ? `${route.km.toFixed(1)} km · ${route.minutes} Min` : '–'}
            </span>
            <span className={`day-map-source${route?.source === 'route' ? '' : ' is-estimate'}`}>
              {loading ? 'Route wird geladen…' : route?.source === 'route' ? 'Route · OSRM' : 'Schätzung'}
            </span>
          </div>

          <ol className="day-map-stops">
            <li className="day-map-stop is-home">
              <span className="day-map-stop-num is-home" aria-hidden="true">★</span>
              <span className="day-map-stop-text">
                <strong>Casa Los Pinos</strong>
                <small>Temisas · Start</small>
              </span>
            </li>
            {stops.map((stop, index) => {
              const from: [number, number] =
                index === 0 ? HOME_POINT : [stops[index - 1].lat, stops[index - 1].lon]
              const time = stopTimes.get(stop.id) ?? null
              // Mit echter Route gilt die OSRM-Etappe, sonst die Schätzung (≈).
              const leg = route && route.source === 'route' ? route.legs?.[index] : undefined
              const drive = leg ? `${leg.minutes} Min · ${leg.km} km` : `≈ ${legMinutes(from, stop)} Min`
              return (
                <li className="day-map-stop" key={stop.id}>
                  <span className="day-map-stop-num" aria-hidden="true">{index + 1}</span>
                  <span className="day-map-stop-text">
                    <strong>{stop.label}</strong>
                    <small>
                      {time ? `${hhmm(time)} · ` : ''}{drive} Fahrt
                    </small>
                  </span>
                </li>
              )
            })}
          </ol>

          {route?.source === 'estimate' && (
            <p className="day-map-hint">
              <Info size={13} strokeWidth={2} aria-hidden="true" />
              <span>
                Keine Route geladen — die Linie ist Luftlinie und die Zeiten sind geschätzt.
                Mit Netz wird die echte Strecke nachgerechnet.
              </span>
            </p>
          )}
        </>
      )}

      <p className="day-map-date-note">{formatDayLong(dayDate)}</p>
    </div>
  )
}
