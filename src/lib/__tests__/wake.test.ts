import { describe, it, expect, beforeAll } from 'vitest'
import {
  clockText, hhmm, minutesOf, reminderClock, canaryWallToDate, nextWake, wakeSlots,
  readDefaultLead, writeDefaultLead, DEFAULT_LEAD,
} from '../wake'
import type { TripProposal } from '../../types'

function proposal(over: Partial<TripProposal>): TripProposal {
  return {
    id: 'p1', list_id: 'l1', day: '2026-12-02', slot: 'morning',
    title: 'Roque Nublo', note: null, place: 'Roque Nublo',
    place_lat: 27.9911, place_lon: -15.6111, place_url: null,
    created_by: 'Flo', created_at: '2026-11-01T10:00:00Z',
    confirmed_at: null, confirmed_by: null,
    starts_at: '09:00:00', remind_before: 20, remind_enabled: true,
    ...over,
  }
}

describe('Zeitrechnung', () => {
  it('liest Postgres-Zeiten und formatiert sie', () => {
    expect(hhmm('09:00:00')).toBe('09:00')
    expect(hhmm(null)).toBe('')
    expect(minutesOf('13:45:00')).toBe(825)
    expect(clockText(825)).toBe('13:45')
  })

  it('rechnet den Vorlauf zurück, auch über Mitternacht', () => {
    expect(reminderClock('09:00:00', 20)).toBe('08:40')
    expect(reminderClock('00:10:00', 30)).toBe('23:40')
    expect(reminderClock(null, 20)).toBeNull()
  })

  it('macht aus Kanaren-Wanduhrzeit einen absoluten Zeitpunkt', () => {
    // Winter: Kanaren sind UTC+0, 09:00 Ortszeit ist 09:00 UTC
    const winter = canaryWallToDate('2026-12-02', '09:00', new Date('2026-12-01T12:00:00Z'))
    expect(winter.toISOString()).toBe('2026-12-02T09:00:00.000Z')
    // Sommer: UTC+1, 09:00 Ortszeit ist 08:00 UTC
    const summer = canaryWallToDate('2026-07-01', '09:00', new Date('2026-07-01T08:00:00Z'))
    expect(summer.toISOString()).toBe('2026-07-01T08:00:00.000Z')
  })
})

describe('Wecker-Auswahl', () => {
  const now = new Date('2026-12-02T06:00:00Z')

  it('nimmt nur aktive Wecker mit Los-Zeit', () => {
    const slots = wakeSlots([
      proposal({ id: 'a' }),
      proposal({ id: 'b', remind_enabled: false }),
      proposal({ id: 'c', starts_at: null }),
    ], now)
    expect(slots.map((s) => s.proposal.id)).toEqual(['a'])
  })

  it('sortiert und liefert den nächsten', () => {
    const next = nextWake([
      proposal({ id: 'spaet', starts_at: '19:00:00' }),
      proposal({ id: 'frueh', starts_at: '09:00:00' }),
    ], now)
    expect(next?.proposal.id).toBe('frueh')
    expect(next?.at.toISOString()).toBe('2026-12-02T08:40:00.000Z')
    expect(next?.lead).toBe(20)
  })

  it('ignoriert Wecker, deren Zeit schon vorbei ist', () => {
    const spater = new Date('2026-12-02T09:30:00Z')
    expect(nextWake([proposal({ starts_at: '09:00:00' })], spater)).toBeNull()
  })

  it('nutzt den Standard-Vorlauf, wenn keiner gesetzt ist', () => {
    const [slot] = wakeSlots([proposal({ remind_before: null })], now)
    expect(slot.lead).toBe(20)
    expect(slot.startsAt).toBe('09:00')
  })
})

describe('Standard-Vorlauf', () => {
  // Node hat kein localStorage — ein Map-Stub reicht, es geht nur um den Vertrag.
  const store = new Map<string, string>()
  beforeAll(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value) },
        removeItem: (key: string) => { store.delete(key) },
        clear: () => store.clear(),
      },
    })
  })

  it('liefert ohne gespeicherten Wert den Standard (nicht 0)', () => {
    localStorage.clear()
    expect(readDefaultLead()).toBe(DEFAULT_LEAD)
  })

  it('liest und schreibt den Wert', () => {
    localStorage.clear()
    writeDefaultLead(30)
    expect(readDefaultLead()).toBe(30)
    writeDefaultLead(0)
    expect(readDefaultLead()).toBe(0)
  })

  it('ignoriert Unsinn', () => {
    localStorage.setItem('fiesta_wake_lead', 'kaputt')
    expect(readDefaultLead()).toBe(DEFAULT_LEAD)
    localStorage.setItem('fiesta_wake_lead', '999')
    expect(readDefaultLead()).toBe(DEFAULT_LEAD)
  })
})
