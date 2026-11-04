import { describe, it, expect } from 'vitest'
import { skyTone, conditionLabel, canaryClock } from '../liveWeather'

describe('skyTone', () => {
  it('ordnet die WMO-Codes den Szenen zu', () => {
    expect(skyTone(0)).toBe('clear')
    expect(skyTone(1)).toBe('partly')
    expect(skyTone(2)).toBe('partly')
    expect(skyTone(3)).toBe('cloudy')
    expect(skyTone(45)).toBe('fog')
    expect(skyTone(48)).toBe('fog')
    expect(skyTone(61)).toBe('rain')
    expect(skyTone(66)).toBe('rain')
    expect(skyTone(80)).toBe('rain')
    expect(skyTone(82)).toBe('rain')
    expect(skyTone(71)).toBe('snow')
    expect(skyTone(86)).toBe('snow')
    expect(skyTone(95)).toBe('storm')
    expect(skyTone(99)).toBe('storm')
  })

  it('fällt bei unbekannten Codes auf Regen zurück (nie auf eine leere Szene)', () => {
    expect(skyTone(1234)).toBe('rain')
  })
})

describe('conditionLabel', () => {
  it('nennt einen klaren Himmel tagsüber sonnig und nachts klar', () => {
    expect(conditionLabel(0, true)).toBe('Sonnig')
    expect(conditionLabel(0, false)).toBe('Klar')
  })

  it('lässt Regen und Gewitter auch nachts, wie sie sind', () => {
    expect(conditionLabel(61, false)).toBe('Regen')
    expect(conditionLabel(95, false)).toBe('Gewitter')
  })
})

describe('canaryClock', () => {
  it('zeigt das Datum der Kanaren, nicht das deutsche', () => {
    // 00:30 deutscher Zeit am 5.11. ist auf den Kanaren noch der 4.11.
    expect(canaryClock(new Date('2026-11-04T23:30:00Z'))).toEqual({ date: 'Mi 4.11.', time: '23:30' })
  })

  it('rechnet auch die Sommerzeit mit (UTC+1 auf den Kanaren)', () => {
    // 12:00 UTC im Juli = 13:00 auf den Kanaren
    expect(canaryClock(new Date('2026-07-15T12:00:00Z')).time).toBe('13:00')
  })
})
