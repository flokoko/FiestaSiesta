import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchGeoWiki, shortExtract } from '../geoWiki'

// jsdom-Testumgebung: Node versteckt sein experimentelles localStorage —
// In-Memory-Web-Storage nachlegen (Muster readCache.test.ts).
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

describe('shortExtract', () => {
  it('kürzt an der letzten Satzgrenze innerhalb des Fensters', () => {
    const text =
      'Erster Satz, der über die Landschaft erzählt. Zweiter Satz mit mehr als genug Text, '
      + 'damit das Limit klar überschritten wird, weil Wikipedia-Extrakte gern etwas länger '
      + 'sind und weiterlaufen. Dritter Satz.'
    const out = shortExtract(text, 80)
    expect(out).toBe('Erster Satz, der über die Landschaft erzählt.')
  })

  it('schneidet hart, wenn der erste Satz das Limit bereits sprengt', () => {
    const text = 'Ein'.repeat(120) // 360 Zeichen ohne jedes Satzzeichen
    const out = shortExtract(text, 220)
    expect(out.length).toBe(220)
    expect(out.startsWith('EinEin')).toBe(true)
  })

  it('akzeptiert eine Satzgrenze genau am Fensterende', () => {
    // Der '.' sitzt exakt auf Position 220 — dann darf er mitgenommen werden.
    expect(shortExtract('A'.repeat(219) + '. Zwei', 220)).toBe('A'.repeat(219) + '.')
  })

  it('lässt kurze Texte unangetastet, glättet aber Leerraum', () => {
    expect(shortExtract('Kurzer Text.', 220)).toBe('Kurzer Text.')
    expect(shortExtract('Zwei  Zeilen\n  mit Umbruch.', 220)).toBe('Zwei Zeilen mit Umbruch.')
  })
})

describe('fetchGeoWiki', () => {
  const DAY = '2030-01-01'
  const POINT_A = { lat: 27.8, lon: -15.55 }     // geosearch hier: zwei Treffer
  const POINT_B = { lat: 27.756, lon: -15.578 }  // geosearch hier: Doppelgänger (gleiche pageid)

  // Playa del Inglés ~6,3 km von A, Tempel ~5,0 km — deshalb kommt der
  // Tempel zuerst. B liegt an der Playa und liefert dieselbe pageid erneut.
  const HITS_A = [
    { pageid: 3458092, ns: 0, title: 'Playa del Inglés', lat: 27.75, lon: -15.5806, dist: 6320 },
    { pageid: 260062, ns: 0, title: 'Templo Ecuménico El Salvador', lat: 27.7594, lon: -15.5688, dist: 4990 },
  ]
  const HITS_B = [
    { pageid: 3458092, ns: 0, title: 'Playa del Inglés', lat: 27.75, lon: -15.5806, dist: 713 },
  ]
  const EXTRACTS: Record<string, string> = {
    'Playa del Inglés':
      'Playa del Inglés ist ein Ortsteil der Gemeinde San Bartolomé de Tirajana an der Südküste Gran Canarias. '
      + 'Der Hauptwirtschaftszweig ist der Tourismus, der Ort wächst weiter.',
    'Templo Ecuménico El Salvador': 'Der Tempel wurde 1969 erbaut.',
  }

  function jsonResponse(payload: unknown, status = 200): Promise<Response> {
    return Promise.resolve(new Response(JSON.stringify(payload), { status }))
  }

  function stubFetch(options: { allowSummaries?: boolean } = {}): ReturnType<typeof vi.fn> {
    const { allowSummaries = true } = options
    return vi.fn((input: string | URL | Request) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      if (url.includes('geosearch')) {
        if (url.includes('27.8')) return jsonResponse({ query: { geosearch: HITS_A } })
        return jsonResponse({ query: { geosearch: HITS_B } })
      }
      const summary = /\/page\/summary\/(.+)$/.exec(url)
      const title = summary ? decodeURIComponent(summary[1]) : ''
      if (!(title in EXTRACTS) || !allowSummaries) return jsonResponse({ type: 'Internal error' }, 404)
      return jsonResponse({
        extract: EXTRACTS[title],
        content_urls: { desktop: { page: `https://de.wikipedia.org/wiki/${title.replace(/ /g, '_')}` } },
      })
    })
  }

  it('dedupliziert nach pageid und sortiert nach Entfernung', async () => {
    const fetchMock = stubFetch()
    vi.stubGlobal('fetch', fetchMock)

    const places = await fetchGeoWiki(DAY, [POINT_A, POINT_B])

    // 2 geosearch + 2 Zusammenfassungen; der Doppelgänger geht raus,
    // BEVOR seine Zusammenfassung geholt würde.
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(places.map((p) => p.title)).toEqual([
      'Templo Ecuménico El Salvador',
      'Playa del Inglés',
    ])
    expect(places[0].km).toBeLessThan(places[1].km)
    expect(places[0].url).toBe('https://de.wikipedia.org/wiki/Templo_Ecuménico_El_Salvador')
    // Zusammenfassung gekürzt, Einleitung bleibt sauber.
    expect(places[1].extract.startsWith('Playa del Inglés ist ein Ortsteil')).toBe(true)
    expect(places[1].extract.length).toBeLessThanOrEqual(220)
  })

  it('liest den Tages-Cache, ohne erneut zu fragen', async () => {
    const fetchMock = stubFetch()
    vi.stubGlobal('fetch', fetchMock)
    await fetchGeoWiki(DAY, [POINT_A, POINT_B])
    const callsAfterFirst = fetchMock.mock.calls.length
    await fetchGeoWiki(DAY, [POINT_A, POINT_B])
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst)
  })

  it('lässt Orte ohne erreichbare Zusammenfassung weg (404)', async () => {
    const fetchMock = stubFetch({ allowSummaries: false })
    vi.stubGlobal('fetch', fetchMock)
    const places = await fetchGeoWiki(DAY, [POINT_A])
    expect(places).toEqual([])
  })

  it('bricht ohne Netz mit [] ab und wirft nicht', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
    const places = await fetchGeoWiki(DAY, [POINT_A])
    expect(places).toEqual([])
  })
})
