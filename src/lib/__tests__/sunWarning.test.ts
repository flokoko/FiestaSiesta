import { beforeEach, describe, expect, it } from 'vitest'
import { sunWarning } from '../sunWarning'
import type { TripProposal } from '../../types'

// In-Memory-Storage statt jsdom-localStorage (Muster aus readCache.test.ts) —
// der driveTime-Cache darf Ergebnisse von einem Test in den nächsten ziehen.
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

beforeEach(() => {
  localStorage.clear()
})

const DAY = '2026-11-29'
const SUNSET = '2026-11-29T18:20'

// Roque Nublo: ~13,6 km Luftlinie — Schätzung 52 Min (Muster wie driveTime.test.ts).
const ROQUE = { lat: 27.99106, lon: -15.61007 }
// 80 m von der Unterkunft → Schätzung 5 Min.
const NAH = { lat: 27.91, lon: -15.507 }

function proposal(over: Partial<TripProposal>): TripProposal {
  return {
    id: 'p1',
    list_id: 'l1',
    day: DAY,
    slot: 'evening',
    title: 'Punkt',
    note: null,
    place: null,
    place_lat: null,
    place_lon: null,
    place_url: null,
    starts_at: null,
    remind_before: null,
    remind_enabled: false,
    created_by: 'flo',
    created_at: '2026-11-01T10:00:00Z',
    confirmed_at: '2026-11-02T10:00:00Z',
    confirmed_by: 'flo',
    ...over,
  }
}

describe('sunWarning', () => {
  it('gibt null ohne Plan und ohne Sonnenuntergang', () => {
    expect(sunWarning({ sunsetIso: null, plan: {}, day: DAY })).toBeNull()
    expect(sunWarning({ sunsetIso: SUNSET, plan: {}, day: DAY })).toBeNull()
  })

  it('gibt null, wenn der letzte Punkt keine Koordinaten hat', () => {
    expect(sunWarning({
      sunsetIso: SUNSET,
      plan: { evening: proposal({ title: 'Dorfrestaurant' }) },
      day: DAY,
    })).toBeNull()
  })

  it('gibt null, wenn die Rückfahrt unter 20 Minuten liegt (Dorfrestaurant)', () => {
    // Ankunft 19:00 + 150 + 5 = 21:35, also nach Sonnenuntergang — aber die
    // Fahrt ist zu kurz, um die unbeleuchtete Bergstraße zu sein.
    expect(sunWarning({
      sunsetIso: SUNSET,
      plan: { evening: proposal({ place: 'Agüimes', place_lat: NAH.lat, place_lon: NAH.lon }) },
      day: DAY,
    })).toBeNull()
  })

  it('warnt am Bergziel: 52 Min Fahrt, Ankunft 22:22 bei Sonnenuntergang 18:20', () => {
    expect(sunWarning({
      sunsetIso: SUNSET,
      plan: {
        evening: proposal({
          place: 'Roque Nublo · Wanderparkplatz',
          place_lat: ROQUE.lat,
          place_lon: ROQUE.lon,
        }),
      },
      day: DAY,
    })).toEqual({
      minutes: 52,
      sunsetClock: '18:20',
      place: 'Roque Nublo',
      arrivalClock: '22:22',
    })
  })

  it('nimmt die individuelle Los-Zeit, wenn starts_at gesetzt ist', () => {
    expect(sunWarning({
      sunsetIso: SUNSET,
      plan: {
        evening: proposal({ place: 'Roque Nublo', place_lat: ROQUE.lat, place_lon: ROQUE.lon, starts_at: '19:15:00' }),
      },
      day: DAY,
    })?.arrivalClock).toBe('22:37')
  })

  it('warnt nicht, wenn die Rückkehr vor dem Sonnenuntergang liegt', () => {
    // Morgen 09:00 + 120 + 52 = 11:52 — weit vor 18:20, obschon 52 Min Fahrt.
    expect(sunWarning({
      sunsetIso: SUNSET,
      plan: { morning: proposal({ slot: 'morning', place: 'Roque Nublo', place_lat: ROQUE.lat, place_lon: ROQUE.lon }) },
      day: DAY,
    })).toBeNull()
  })

  it('nutzt am Abend 150 Minuten statt 120 (SLOT_START 19:00 ohne starts_at)', () => {
    // 19:00 + 150 + 52 = 22:22 — mit 120 Minuten wäre es 21:22.
    expect(sunWarning({
      sunsetIso: SUNSET,
      plan: { evening: proposal({ place: 'Roque Nublo', place_lat: ROQUE.lat, place_lon: ROQUE.lon }) },
      day: DAY,
    })?.arrivalClock).toBe('22:22')
  })

  it('nimmt den späteren des Tages, wenn mehrere Punkte Koordinaten haben', () => {
    // Mittag 13:00 + 120 + 52 = 15:22; Sonnenuntergang 15:00 → Warnung zum Mittag,
    // weil der Abend ohne Koordinaten bleibt und morgen weiter vorne liegt.
    expect(sunWarning({
      sunsetIso: '2026-11-29T15:00',
      plan: {
        morning: proposal({ slot: 'morning', title: 'Frühstück', place: 'Nah', place_lat: NAH.lat, place_lon: NAH.lon }),
        noon: proposal({ slot: 'noon', title: 'Roque Nublo', place: 'Roque Nublo', place_lat: ROQUE.lat, place_lon: ROQUE.lon }),
        evening: proposal({ slot: 'evening', title: 'Dorfrestaurant' }),
      },
      day: DAY,
    })?.place).toBe('Roque Nublo')
  })
})
