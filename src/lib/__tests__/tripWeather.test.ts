import { describe, expect, it } from 'vitest'
import { sunClock } from '../tripWeather'

describe('sunClock', () => {
  it('schneidet die Uhrzeit aus dem Open-Meteo-Format', () => {
    expect(sunClock('2026-11-29T07:41')).toBe('07:41')
    expect(sunClock('2026-12-06T18:03')).toBe('18:03')
  })

  it('liefert einen leeren String für fehlende oder kaputte Werte', () => {
    expect(sunClock(undefined)).toBe('')
    expect(sunClock('')).toBe('')
    expect(sunClock('29.11.2026')).toBe('')
  })
})
