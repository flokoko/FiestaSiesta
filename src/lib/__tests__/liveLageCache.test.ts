// ── Cache-Rückfall der „Live-Lage" ────────────────────────────────────
// Das Versprechen der drei Module: im Urlaub ist das Netz oft weg — dann
// steht der letzte bekannte Stand weiter da. Getestet wird genau das:
// Cache veralten (at in die Vergangenheit), fetch scheitern lassen, und
// prüfen, dass der alte Wert zurückkommt statt null.
//
// Node versteckt sein experimentelles localStorage — deshalb derselbe
// Map-Stub wie in geoWiki.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
const localStorageMock = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)) },
  removeItem: (k: string) => { store.delete(k) },
  clear: () => store.clear(),
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size },
}
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, configurable: true })

const AIR_OK = {
  current: { time: '2026-12-01T10:00', pm10: 14, pm2_5: 7, dust: 6, uv_index: 2.5, european_aqi: 24 },
  hourly: { time: ['2026-12-01T10:00'], dust: [6], uv_index: [2.5] },
}
const SEA_OK = {
  current: { time: '2026-12-01T10:00', wave_height: 0.6, wave_period: 8.7, sea_surface_temperature: 23.6 },
  hourly: {
    // now = 10:00. Extremwerte NACH jetzt: Minimum 12:00, Maximum 14:00.
    // (Das Maximum um 09:00 liegt vor „jetzt" und darf nicht auftauchen.)
    time: [
      '2026-12-01T08:00', '2026-12-01T09:00', '2026-12-01T10:00', '2026-12-01T11:00',
      '2026-12-01T12:00', '2026-12-01T13:00', '2026-12-01T14:00',
    ],
    sea_level_height_msl: [0.4, 0.8, 0.7, 0.2, 0.1, 0.6, 0.9],
  },
}
const FUEL_OK = {
  Fecha: '01/12/2026 9:15:00',
  ListaEESSPrecio: [
    { 'Rótulo': 'PLENERGY', 'Dirección': 'Calle Ansite', 'Latitud': '27,860000', 'Longitud (WGS84)': '-15,430000', 'Precio Gasoleo A': '1,509', 'Precio Gasolina 95 E5': '1,309' },
    { 'Rótulo': 'REPSOL', 'Dirección': 'Calle Ansite 100', 'Latitud': '27,861000', 'Longitud (WGS84)': '-15,431000', 'Precio Gasoleo A': '1,689', 'Precio Gasolina 95 E5': '1,489' },
  ],
}

function okResponse(payload: unknown) {
  return { ok: true, json: async () => payload } as unknown as Response
}

/** Cache-Eintrag künstlich veralten, damit der frische Zweig nicht greift. */
function makeStale(key: string) {
  const raw = store.get(key)
  expect(raw, `Cache-Eintrag ${key} fehlt`).toBeTruthy()
  const parsed = JSON.parse(raw as string) as { at?: number }
  parsed.at = Date.now() - 3 * 60 * 60 * 1000
  store.set(key, JSON.stringify(parsed))
}

beforeEach(() => {
  store.clear()
  vi.unstubAllGlobals()
})

describe('Luft: Cache hält im Funkloch', () => {
  it('liefert den letzten Stand, wenn der Abruf scheitert', async () => {
    const { fetchAirNow } = await import('../airQuality')
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(AIR_OK)))
    const fresh = await fetchAirNow(true)
    expect(fresh?.dust).toBe(6)
    makeStale('fiesta-air-quality')

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
    const cached = await fetchAirNow()
    expect(cached?.dust).toBe(6)
    expect(cached?.pm10).toBe(14)
  })
})

describe('Meer: Cache hält im Funkloch', () => {
  it('liefert Wellen und Gezeiten weiter, wenn der Abruf scheitert', async () => {
    const { fetchSeaNow } = await import('../sea')
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(SEA_OK)))
    const fresh = await fetchSeaNow(true)
    expect(fresh?.wave).toBe(0.6)
    makeStale('fiesta-sea')

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
    const cached = await fetchSeaNow()
    expect(cached?.wave).toBe(0.6)
    expect(cached?.water).toBe(23.6)
    expect(cached?.tide.length).toBeGreaterThan(0)
  })

  it('verwirft eine Antwort ohne Kernwerte und behält den alten Stand', async () => {
    const { fetchSeaNow } = await import('../sea')
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(SEA_OK)))
    await fetchSeaNow(true)
    makeStale('fiesta-sea')

    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ current: { time: '2026-12-01T10:00' } })))
    const cached = await fetchSeaNow()
    expect(cached?.wave).toBe(0.6)
  })
})

describe('Spritpreise: Cache hält im Funkloch', () => {
  it('liefert die günstigsten Stationen weiter, wenn der Abruf scheitert', async () => {
    const { fetchFuel } = await import('../fuel')
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(FUEL_OK)))
    const fresh = await fetchFuel(true)
    expect(fresh?.stations[0].name).toBe('PLENERGY')
    expect(fresh?.maxDiesel).toBe(1.689)
    makeStale('fiesta-fuel')

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
    const cached = await fetchFuel()
    expect(cached?.stations[0].name).toBe('PLENERGY')
    expect(cached?.updated).toBe('01/12/2026 9:15:00')
  })
})
