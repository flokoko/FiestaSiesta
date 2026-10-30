import { describe, it, expect } from 'vitest'
import { coordsFromMapsUrl, isMapsUrl } from '../poiCoords'

describe('coordsFromMapsUrl', () => {
  it('liest den Kartenausschnitt (@lat,lon,zoom)', () => {
    const coords = coordsFromMapsUrl(
      'https://www.google.com/maps/@27.90937,-15.50733,15z/data=!3m1!1e3',
    )
    expect(coords).toEqual({ lat: 27.90937, lon: -15.50733, source: 'link' })
  })

  it('liest den markierten Ort (!3d…!4d…)', () => {
    const coords = coordsFromMapsUrl(
      'https://www.google.com/maps/place/Roque+Nublo/data=!4m6!3m5!1s0x0:0x0!8m2!3d27.99106!4d-15.61007',
    )
    expect(coords?.lat).toBeCloseTo(27.99106, 5)
    expect(coords?.lon).toBeCloseTo(-15.61007, 5)
  })

  it('liest q= und ll=', () => {
    expect(coordsFromMapsUrl('https://maps.google.com/?q=27.99106,-15.61007')?.lat).toBeCloseTo(27.99106, 5)
    expect(coordsFromMapsUrl('https://www.google.com/maps/search/?api=1&query=28.0507,-15.5472')?.lon).toBeCloseTo(-15.5472, 5)
    expect(coordsFromMapsUrl('https://www.google.com/maps/place/x?ll=28.1,-15.4')?.lat).toBeCloseTo(28.1, 5)
  })

  it('liest Koordinaten aus dem Pfad', () => {
    expect(coordsFromMapsUrl('https://www.google.com/maps/place/27.90937,-15.50733,17z')?.lat).toBeCloseTo(27.90937, 5)
  })

  it('gibt bei Kurzlinks und Fremd-Hosts null zurück', () => {
    expect(coordsFromMapsUrl('https://maps.app.goo.gl/abc123')).toBeNull()
    expect(coordsFromMapsUrl('https://openstreetmap.org/?mlat=27.9&mlon=-15.5')).toBeNull()
    expect(coordsFromMapsUrl('Roque Nublo')).toBeNull()
    expect(coordsFromMapsUrl(null)).toBeNull()
  })

  it('verwirft den Atlantik-Nullpunkt als Parse-Unfall', () => {
    expect(coordsFromMapsUrl('https://maps.google.com/?q=0,0')).toBeNull()
  })

  it('verwirft Koordinaten außerhalb der Erde', () => {
    expect(coordsFromMapsUrl('https://maps.google.com/?q=127.9,-215.5')).toBeNull()
  })

  it('erkennt Maps-Links auch am Host', () => {
    expect(isMapsUrl('https://www.google.de/maps/@27.9,-15.5,12z')).toBe(true)
    expect(isMapsUrl('https://maps.app.goo.gl/abc')).toBe(true)
    expect(isMapsUrl('Temisas')).toBe(false)
  })
})
