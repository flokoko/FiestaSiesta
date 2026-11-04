import { describe, it, expect } from 'vitest'
import { skyTone } from '../liveWeather'

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
