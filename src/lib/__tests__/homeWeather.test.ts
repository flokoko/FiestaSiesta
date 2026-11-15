import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultHomePlace,
  effectiveHomePlace,
  fetchHomeWeather,
  geocodeHomePlace,
  readHomePlace,
  writeHomePlace,
  type HomePlace,
} from '../homeWeather'

// jsdom-Testumgebung: In-Memory-Web-Storage nachlegen (Muster wie in den
// bestehenden readCache-Tests).
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

afterEach(() => {
  vi.unstubAllGlobals()
})

const BONN: HomePlace = { lat: 50.7374, lon: 7.0982, name: 'Bonn' }

describe('Standard-Heimatorte je Teilnehmer', () => {
  it('Floko und Peter wohnen in München, Andrésito in Landshut', () => {
    expect(defaultHomePlace('Floko')?.name).toBe('München')
    expect(defaultHomePlace('Peter')?.name).toBe('München')
    expect(defaultHomePlace('Andrésito')?.name).toBe('Landshut')
  })

  it('ignoriert Groß-/Kleinschreibung und Leerzeichen', () => {
    expect(defaultHomePlace('  pEtEr  ')?.name).toBe('München')
    expect(defaultHomePlace('ANDRÉSITO')?.name).toBe('Landshut')
  })

  it('kennt keinen Standard für unbekannte Namen oder leere Eingabe', () => {
    expect(defaultHomePlace('Anna')).toBeNull()
    expect(defaultHomePlace('')).toBeNull()
  })

  it('eigene Geräteeinstellung schlägt den Standard', () => {
    expect(effectiveHomePlace('Floko')?.name).toBe('München') // Standard
    writeHomePlace(BONN)
    expect(effectiveHomePlace('Floko')).toEqual(BONN)
    // Und nach dem Entfernen greift der Standard wieder
    writeHomePlace(null)
    expect(effectiveHomePlace('Floko')?.name).toBe('München')
    expect(effectiveHomePlace('Anna')).toBeNull()
  })
})

describe('geocodeHomePlace', () => {
  it('nimmt den ersten Treffer weltweit — deutsche Orte funktionieren', async () => {
    // Regression: der Screen nutzte geocodePlace() aus poiCoords, das nur
    // Treffer in Spanien nahe Temisas akzeptiert und für „Landshut" null lieferte.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        results: [{ name: 'Landshut', latitude: 48.52961, longitude: 12.16179, country_code: 'DE' }],
      }),
    })))
    await expect(geocodeHomePlace('Landshut')).resolves.toEqual({
      lat: 48.52961, lon: 12.16179, name: 'Landshut',
    })
  })

  it('liefert null ohne Treffer und bei zu kurzer Eingabe', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    })))
    await expect(geocodeHomePlace('Xyzzyxstadt')).resolves.toBeNull()
    await expect(geocodeHomePlace('ab')).resolves.toBeNull()
  })
})

describe('readHomePlace / writeHomePlace', () => {
  it('liest einen gültigen Eintrag unverändert zurück', () => {
    writeHomePlace(BONN)
    expect(readHomePlace()).toEqual({ lat: 50.7374, lon: 7.0982, name: 'Bonn' })
  })

  it('gibt bei kaputtem JSON null statt zu werfen', () => {
    localStorage.setItem('fiesta_home_place', '{ kein JSON')
    expect(readHomePlace()).toBeNull()
  })

  it('verwirft Einträge mit fehlenden oder sinnlosen Feldern', () => {
    localStorage.setItem('fiesta_home_place', JSON.stringify({ lat: 'x', lon: 7.1, name: 'Bonn' }))
    expect(readHomePlace()).toBeNull()
    localStorage.setItem('fiesta_home_place', JSON.stringify({ lat: 50.7, lon: 7.1, name: '   ' }))
    expect(readHomePlace()).toBeNull()
    localStorage.setItem('fiesta_home_place', JSON.stringify({ lon: 7.1, name: 'Bonn' }))
    expect(readHomePlace()).toBeNull()
  })

  it('writeHomePlace(null) entfernt den Eintrag', () => {
    writeHomePlace(BONN)
    writeHomePlace(null)
    expect(readHomePlace()).toBeNull()
    expect(localStorage.getItem('fiesta_home_place')).toBeNull()
  })

  it('schreibt nichts bei unbrauchbaren Koordinaten', () => {
    writeHomePlace({ lat: Number.NaN, lon: 7.1, name: 'Bonn' })
    expect(localStorage.getItem('fiesta_home_place')).toBeNull()
  })
})

describe('fetchHomeWeather — Cache', () => {
  it('bedient sich aus dem Cache, wenn die Koordinaten auf 2 Dezimalstellen passen', async () => {
    localStorage.setItem('fiesta-home-weather', JSON.stringify({
      lat: 50.74,
      lon: 7.1,
      at: Date.now(),
      data: { temp: 4, code: 61, rain: 20 },
    }))
    const fetchMock = vi.fn(() => Promise.reject(new Error('sollte nicht gerufen werden')))
    vi.stubGlobal('fetch', fetchMock)

    const value = await fetchHomeWeather(BONN) // 50.7374 → 50,74 · 7.0982 → 7,10
    expect(value).toEqual({ temp: 4, code: 61, rain: 20 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fragt neu und scheitert still, wenn die Koordinaten nicht passen', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('offline')))
    vi.stubGlobal('fetch', fetchMock)

    const value = await fetchHomeWeather({ ...BONN, lat: 52.52, name: 'Berlin' })
    expect(value).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ignoriert einen abgelaufenen Cache und überschreibt ihn nach Neuabruf', async () => {
    localStorage.setItem('fiesta-home-weather', JSON.stringify({
      lat: 50.74,
      lon: 7.1,
      at: Date.now() - 61 * 60 * 1000,
      data: { temp: 9, code: 61, rain: 20 },
    }))
    const payload = {
      current: { temperature_2m: 4.31, weather_code: 3, is_day: 1 },
      daily: { precipitation_probability_max: [15] },
    }
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)

    const value = await fetchHomeWeather(BONN)
    expect(value).toEqual({ temp: 4.31, code: 3, rain: 15 })

    // Jetzt frisch im Cache — der nächste Abruf fragt nicht mehr nach.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const again = await fetchHomeWeather(BONN)
    expect(again).toEqual({ temp: 4.31, code: 3, rain: 15 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
