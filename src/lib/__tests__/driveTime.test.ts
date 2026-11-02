import { describe, it, expect } from 'vitest'
import {
  airKm, estimateDriveMinutes, leadIsTight, recommendedLead, quickDriveTime,
} from '../driveTime'
import { TRIP_LAT, TRIP_LON } from '../trip'

// Referenzpunkte (Unterkunft Temisas: 27.90937, -15.50733)
const AGUIMES = { lat: 27.9053, lon: -15.4448 }   // ~7 km Luftlinie, 11 km Straße
const ROQUE_NUBLO = { lat: 27.99106, lon: -15.61007 }
const ARINAGA = { lat: 27.856, lon: -15.39 }

describe('Fahrzeit-Schätzung', () => {
  it('rechnet die Luftlinie plausibel', () => {
    const d = airKm(ROQUE_NUBLO.lat, ROQUE_NUBLO.lon)
    expect(d).toBeGreaterThan(12)
    expect(d).toBeLessThan(16)
    expect(airKm(TRIP_LAT, TRIP_LON)).toBe(0)
  })

  it('mindestens 5 Minuten, auch am selben Punkt', () => {
    expect(estimateDriveMinutes(TRIP_LAT, TRIP_LON)).toBe(5)
  })

  it('nah ist kürzer als fern', () => {
    const nah = estimateDriveMinutes(AGUIMES.lat, AGUIMES.lon)
    const fern = estimateDriveMinutes(ROQUE_NUBLO.lat, ROQUE_NUBLO.lon)
    expect(nah).toBeLessThan(fern)
  })

  it('liegt für Bergziele im realistischen Bereich', () => {
    // Roque Nublo ist real ~40–50 Minuten von Temisas — die Schätzung darf
    // nicht darunter liegen (lieber zu früh losfahren) und nicht absurd hoch.
    const roque = estimateDriveMinutes(ROQUE_NUBLO.lat, ROQUE_NUBLO.lon)
    expect(roque).toBeGreaterThanOrEqual(40)
    expect(roque).toBeLessThanOrEqual(70)
  })

  it('Arinaga an der Küste bleibt unter einer Stunde', () => {
    const arinaga = estimateDriveMinutes(ARINAGA.lat, ARINAGA.lon)
    expect(arinaga).toBeGreaterThan(15)
    expect(arinaga).toBeLessThan(60)
  })
})

describe('Vorlauf', () => {
  it('warnt nur, wenn der Vorlauf knapp ist', () => {
    expect(leadIsTight(20, 45)).toBe(true)
    expect(leadIsTight(49, 45)).toBe(true)   // alles unter 45 + 5 Puffer
    expect(leadIsTight(50, 45)).toBe(false)  // genau der Puffer reicht
    expect(leadIsTight(60, 45)).toBe(false)
  })

  it('empfiehlt Fahrzeit plus Puffer, auf 5 aufgerundet', () => {
    expect(recommendedLead(45)).toBe(50)
    expect(recommendedLead(42)).toBe(50)
    expect(recommendedLead(1)).toBe(10)
  })
})

describe('Cache', () => {
  it('liefert ohne Cache die Schätzung', () => {
    const quick = quickDriveTime(ROQUE_NUBLO.lat, ROQUE_NUBLO.lon)
    expect(quick.source).toBe('estimate')
    expect(quick.minutes).toBe(estimateDriveMinutes(ROQUE_NUBLO.lat, ROQUE_NUBLO.lon))
  })
})
