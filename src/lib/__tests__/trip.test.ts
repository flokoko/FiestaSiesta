import { describe, expect, it } from 'vitest'
import { Sun, CloudRain, CloudLightning, CloudSnow, CloudSun, CloudFog } from 'lucide-react'
import {
  TRIP_LENGTH, daysUntilTrip, formatRange, tripDay, tripDays, tripDaysFrom, tripPhase,
} from '../trip'
import { isoDay } from '../tripPlan'
import { weatherIconFor } from '../../components/WeatherGlyph'

describe('tripDays', () => {
  it('liefert 8 aufeinanderfolgende Kalendertage für die Reise', () => {
    const days = tripDays()
    const isos = days.map(isoDay)
    expect(isos).toHaveLength(TRIP_LENGTH)
    expect(isos[0]).toBe('2026-11-29')
    expect(isos[isos.length - 1]).toBe('2026-12-06')
    expect(new Set(isos).size).toBe(TRIP_LENGTH)
  })

  // Regression: mit `start + i * 24h` kippte die Reihe über die Zeitumstellung.
  // Am 25.10.2026 wurde Tag 3 doppelt und der letzte Tag fehlte.
  it('bleibt über die Zeitumstellung hinweg lückenlos', () => {
    const start = new Date(2026, 9, 24) // Sa 24.10.2026, Umstellung in der Nacht auf den 25.
    const isos = tripDaysFrom(start, 8).map(isoDay)
    expect(isos).toEqual([
      '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27',
      '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31',
    ])
  })

  it('bleibt auch über die Rück-Umstellung im Frühjahr lückenlos', () => {
    const start = new Date(2027, 2, 26) // Fr 26.03.2027, Umstellung in der Nacht auf den 28.
    const isos = tripDaysFrom(start, 5).map(isoDay)
    expect(isos).toEqual([
      '2027-03-26', '2027-03-27', '2027-03-28', '2027-03-29', '2027-03-30',
    ])
  })
})

describe('Reisephase', () => {
  it('rechnet den Reisetag 1-basiert und außerhalb null', () => {
    expect(tripDay(new Date(2026, 10, 29))).toBe(1)
    expect(tripDay(new Date(2026, 11, 6))).toBe(TRIP_LENGTH)
    expect(tripDay(new Date(2026, 11, 7))).toBeNull()
    expect(tripDay(new Date(2026, 10, 28))).toBeNull()
  })

  it('kennt die drei Phasen', () => {
    expect(tripPhase(new Date(2026, 9, 25))).toBe('before')
    expect(tripPhase(new Date(2026, 11, 1))).toBe('during')
    expect(tripPhase(new Date(2026, 11, 20))).toBe('after')
  })

  it('zählt die Tage bis zur Abreise', () => {
    expect(daysUntilTrip(new Date(2026, 10, 29))).toBe(0)
    expect(daysUntilTrip(new Date(2026, 10, 19))).toBe(10)
    // Auch über die Zeitumstellung hinweg: 25.10. → 29.11. sind 35 Tage.
    expect(daysUntilTrip(new Date(2026, 9, 25))).toBe(35)
  })

  it('formatiert den Zeitraum einheitlich', () => {
    expect(formatRange()).toBe('29.11. – 06.12.')
  })
})

describe('weatherIconFor', () => {
  it('ordnet die WMO-Codes den richtigen Icons zu', () => {
    expect(weatherIconFor(0)).toBe(Sun)
    expect(weatherIconFor(2)).toBe(CloudSun)
    expect(weatherIconFor(45)).toBe(CloudFog)
    expect(weatherIconFor(61)).toBe(CloudRain)
    expect(weatherIconFor(80)).toBe(CloudRain)
    expect(weatherIconFor(71)).toBe(CloudSnow)
    expect(weatherIconFor(95)).toBe(CloudLightning)
  })

  it('fällt bei unbekannten Codes auf Regen zurück statt zu werfen', () => {
    expect(weatherIconFor(999)).toBe(CloudRain)
  })
})
