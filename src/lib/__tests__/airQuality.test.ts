import { describe, expect, it } from 'vitest'
import { dustLevel, maxNext24, uvLevel } from '../airQuality'

describe('dustLevel', () => {
  it('wechselt an den Schwellen 25 und 50 µg/m³', () => {
    expect(dustLevel(24)).toBe('klar')
    expect(dustLevel(25)).toBe('etwas Staub')
    expect(dustLevel(49)).toBe('etwas Staub')
    expect(dustLevel(50)).toBe('Calima')
  })

  it('nennt normale Werte klar, auch 0', () => {
    expect(dustLevel(6)).toBe('klar')
    expect(dustLevel(0)).toBe('klar')
  })
})

describe('uvLevel', () => {
  it('folgt der WHO-Skala mit den Schwellen 3 / 6 / 8 / 11', () => {
    expect(uvLevel(2.9)).toBe('niedrig')
    expect(uvLevel(3)).toBe('mäßig')
    expect(uvLevel(6)).toBe('hoch')
    expect(uvLevel(8)).toBe('sehr hoch')
    expect(uvLevel(11)).toBe('extrem')
  })
})

describe('maxNext24', () => {
  // Ortszeit der API: jetzt 12:00, Reihe über drei Tage (forecast_days=3).
  const now = '2026-11-29T12:00'
  const times = [
    '2026-11-29T10:00', // Vergangenheit — zählt nicht
    '2026-11-29T12:00', // die laufende Stunde — zählt nicht
    '2026-11-29T13:00',
    '2026-11-29T14:00',
    '2026-11-29T22:00',
    '2026-11-30T12:00', // genau +24 h — gehört noch ins Fenster
    '2026-11-30T13:00', // jenseits von 24 h — zählt nicht
  ]
  const values: Array<number | null> = [40, 42, 30, null, 66, 55, 90]

  it('nimmt das Maximum der nächsten 24 Stunden und lässt null aus', () => {
    expect(maxNext24(times, values, now)).toBe(66)
  })

  it('gibt 0 ohne Zukunfts-Werte zurück', () => {
    expect(maxNext24([], [], now)).toBe(0)
    expect(maxNext24(['2026-11-29T11:00'], [50], now)).toBe(0)
  })
})
