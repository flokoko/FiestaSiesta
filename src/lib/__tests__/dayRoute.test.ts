import { beforeEach, describe, expect, it } from 'vitest'
import { HOME_POINT, buildDayStops, quickDayRoute, quickRouteFor, type RouteStop } from '../dayRoute'
import type { DayPlan } from '../../hooks/useTripPlan'
import type { TripProposal } from '../../types'

// jsdom-Testumgebung: Node versteckt sein experimentelles localStorage ohne
// --localstorage-file. In-Memory-Web-Storage nachlegen (Muster wie im
// useOfflineQueue-Test).
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value) },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// Typ-import only (kein JS-Import): der Test muss keinen Supabase-Client
// aus hooks/useTripPlan nachziehen.

function proposal(overrides: Partial<TripProposal> & Pick<TripProposal, 'id' | 'title'>): TripProposal {
  return {
    list_id: 'list-1',
    day: '2026-11-29',
    slot: 'morning',
    note: null,
    place: null,
    place_lat: null,
    place_lon: null,
    place_url: null,
    starts_at: null,
    remind_before: null,
    remind_enabled: false,
    created_by: 'Flo',
    created_at: '2026-11-01T10:00:00Z',
    confirmed_at: null,
    confirmed_by: null,
    votes: [],
    ...overrides,
  }
}

const stop: RouteStop = { id: 'p1', label: 'Playa del Inglés', lat: 27.761, lon: -15.584 }

// Route-Schlüssel wie in dayRoute.ts intern (gerundet auf 3 Nachkommastellen).
const routeKeyFor = (stops: RouteStop[]): string =>
  [HOME_POINT, ...stops.map((s) => [s.lat, s.lon] as [number, number])]
    .map(([lat, lon]) => `${lat.toFixed(3)},${lon.toFixed(3)}`)
    .join('|')

beforeEach(() => {
  localStorage.clear()
})

describe('buildDayStops', () => {
  it('nimmt nur die geltenden Plan-Punkte in Slot-Reihenfolge (morgen → mittag → abend)', () => {
    // In der DayPlan-Map steht je Slot nur der Punkt, der gilt (bestätigt oder
    // Abstimmungssieger) — hier in vertauschter Reihenfolge, um die
    // Slot-Reihenfolge des Ausgangs zu prüfen.
    const plan: DayPlan = {
      evening: proposal({
        id: 'p3', title: 'Sonnenuntergang', slot: 'evening',
        place: 'Puerto de Mogán · Hafen', place_lat: 27.815, place_lon: -15.762,
      }),
      morning: proposal({
        id: 'p1', title: 'Strand', slot: 'morning',
        place: 'Playa del Inglés', place_lat: 27.761, place_lon: -15.584,
      }),
    }

    const stops = buildDayStops(plan)

    expect(stops.map((s) => s.id)).toEqual(['p1', 'p3'])
    // Label aus dem Ort vor dem ·-Trenner, sonst Titel
    expect(stops.map((s) => s.label)).toEqual(['Playa del Inglés', 'Puerto de Mogán'])
  })

  it('lässt Punkte ohne Koordinaten weg', () => {
    const plan: DayPlan = {
      morning: proposal({ id: 'p1', title: 'Schlafen' }),
      noon: proposal({ id: 'p2', title: 'Siesta' }),
      evening: proposal({
        id: 'p3', title: 'Tapas', slot: 'evening', place: 'Las Palmas',
        place_lat: 28.12, place_lon: -15.43,
      }),
    }

    const stops = buildDayStops(plan)

    expect(stops).toHaveLength(1)
    expect(stops[0].id).toBe('p3')
  })

  it('leerer Plan → keine Stops', () => {
    expect(buildDayStops(undefined)).toEqual([])
    expect(buildDayStops({})).toEqual([])
  })
})

describe('Routen-Fallback-Kette', () => {
  it('ohne Cache → geschätzte Route ab der Unterkunft (quickDayRoute)', () => {
    const route = quickRouteFor([stop])

    expect(route.source).toBe('estimate')
    expect(route.points[0]).toEqual(HOME_POINT)
    expect(route.points[1]).toEqual([stop.lat, stop.lon])
    // Schätzung rechnet Luftlinie in Fahrminuten — beide Werte plausibel groß
    expect(route.minutes).toBeGreaterThan(0)
    expect(route.km).toBeGreaterThan(0)
  })

  it('mit Cache → gespeicherte Route, ohne neu zu rechnen', () => {
    const cachedRoute = { points: [[28.2, -15.5] as [number, number], [28.1, -15.4] as [number, number]], minutes: 42, km: 12, source: 'route' as const }
    localStorage.setItem(
      'fiesta-day-routes-v2',
      JSON.stringify({ [routeKeyFor([stop])]: { at: Date.now(), route: cachedRoute } }),
    )

    const route = quickRouteFor([stop])

    expect(route.source).toBe('route')
    expect(route.minutes).toBe(42)
    expect(route.km).toBe(12)
  })

  it('abgelaufener Cache-Eintrag fällt auf die Schätzung zurück', () => {
    const THREE_WEEKS_AGO = Date.now() - 30 * 24 * 60 * 60 * 1000 - 1000
    localStorage.setItem(
      'fiesta-day-routes-v2',
      JSON.stringify({ [routeKeyFor([stop])]: { at: THREE_WEEKS_AGO, route: { points: [], minutes: 5, km: 1, source: 'route' } } }),
    )

    const route = quickRouteFor([stop])

    expect(route.source).toBe('estimate')
  })

  it('quickDayRoute ohne Stops → nur die Unterkunft als Startpunkt', () => {
    const route = quickDayRoute([])
    expect(route.points).toEqual([HOME_POINT])
    expect(route.minutes).toBe(0)
  })
})
