import { describe, expect, it } from 'vitest'
import { tideExtremes, waveLevel } from '../sea'

describe('waveLevel', () => {
  it('wechselt an 0,5 / 1,2 / 2,0 m', () => {
    expect(waveLevel(0.49)).toBe('ruhig')
    expect(waveLevel(0.5)).toBe('mäßig')
    expect(waveLevel(1.2)).toBe('rau')
    expect(waveLevel(2.0)).toBe('sehr rau')
  })
})

describe('tideExtremes', () => {
  const now = '2026-12-01T10:00'
  const times = [
    '2026-12-01T11:00',
    '2026-12-01T12:00',
    '2026-12-01T13:00',
    '2026-12-01T14:00',
    '2026-12-01T15:00',
    '2026-12-01T16:00',
    '2026-12-01T17:00',
    '2026-12-01T18:00',
    '2026-12-01T19:00',
    '2026-12-01T20:00',
  ]
  // Hoch bei 13:00, Tief bei 16:00, erneut Hoch bei 19:00.
  const heights = [0.4, 0.7, 0.9, 0.6, 0.3, 0.2, 0.5, 0.8, 1.0, 0.9]

  it('liefert Hoch/Tief als die nächsten zwei Ereignisse mit korrekter Uhrzeit', () => {
    expect(tideExtremes(times, heights, now)).toEqual([
      { label: 'Hochwasser', clock: '13:00' },
      { label: 'Niedrigwasser', clock: '16:00' },
    ])
  })

  it('nimmt mit max=3 auch das dritte Ereignis', () => {
    expect(tideExtremes(times, heights, now, 3)).toEqual([
      { label: 'Hochwasser', clock: '13:00' },
      { label: 'Niedrigwasser', clock: '16:00' },
      { label: 'Hochwasser', clock: '19:00' },
    ])
  })

  it('kehrt bei leerer Reihe und ohne Zukunft mit [] zurück', () => {
    expect(tideExtremes([], [], now)).toEqual([])
    expect(tideExtremes(['2026-12-01T09:00'], [0.5], now)).toEqual([])
  })
})
