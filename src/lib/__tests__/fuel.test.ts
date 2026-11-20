import { describe, expect, it } from 'vitest'
import { dieselMax, formatFuelUpdated, nearestStations, parsePrice } from '../fuel'
import { TRIP_LAT, TRIP_LON } from '../trip'

describe('parsePrice', () => {
  it('wandelt Komma-Strings in Zahlen, Punkt-Komplement funktioniert auch', () => {
    expect(parsePrice('1,609')).toBe(1.609)
    expect(parsePrice(' 1,609 ')).toBe(1.609)
    expect(parsePrice('1.6')).toBe(1.6)
  })

  it('liefert null für leer, kaputt oder 0', () => {
    expect(parsePrice('')).toBeNull()
    expect(parsePrice(undefined)).toBeNull()
    expect(parsePrice('0,00')).toBeNull()
    expect(parsePrice('kein Preis')).toBeNull()
  })
})

describe('nearestStations', () => {
  // Attrappen mit echten Koordinaten im Gemeindegebiet von Agüimes
  // (GC-1 / Arinaga) — Luftlinie zur Unterkunft Temisas:
  //   10,15 km (günstig) · 10,25 km (teuer) · 12,77 km (ohne Preis).
  const AGUIMES_DATA = {
    Fecha: '21/11/2026 8:15:30',
    ListaEESSPrecio: [
      {
        'Rótulo': 'DISA AUTOPISTA KM 21',
        'Dirección': 'AUTOPISTA GC-1 KM. 21',
        'Latitud': '27,899167',
        'Longitud (WGS84)': '-15,404722',
        'Precio Gasoleo A': '1,509',
        'Precio Gasolina 95 E5': '1,409',
      },
      {
        'Rótulo': 'REPSOL ARINAGA',
        'Dirección': 'CALLE CANAL DERECHA, S/N',
        'Latitud': '27,862222',
        'Longitud (WGS84)': '-15,417778',
        'Precio Gasoleo A': '1,669',
        'Precio Gasolina 95 E5': '1,719',
      },
      {
        'Rótulo': 'BP OST ARINAGA',
        'Dirección': 'CARRETERA GC-1, S/N',
        'Latitud': '27,86',
        'Longitud (WGS84)': '-15,39',
        'Precio Gasoleo A': '',
        'Precio Gasolina 95 E5': '',
      },
      {
        'Rótulo': 'OHNE KOORDINATE',
        'Dirección': 'IRGENDWO',
        'Latitud': '',
        'Longitud (WGS84)': '',
        'Precio Gasoleo A': '0,001',
      },
    ],
  }

  it('sortiert nach Dieselpreis, Stationen ohne Preis nach hinten', () => {
    const stations = nearestStations(AGUIMES_DATA, TRIP_LAT, TRIP_LON)
    expect(stations.map((s) => s.name)).toEqual([
      'DISA AUTOPISTA KM 21',
      'REPSOL ARINAGA',
      'BP OST ARINAGA',
    ])
    expect(stations[0].diesel).toBe(1.509)
    expect(stations[0].petrol95).toBe(1.409)
    expect(stations[2].diesel).toBeNull()
  })

  it('rechnet die Luftlinie plausibel (Agüimes → Temisas ~10–14 km)', () => {
    const stations = nearestStations(AGUIMES_DATA, TRIP_LAT, TRIP_LON)
    for (const station of stations) {
      expect(station.km).toBeGreaterThan(10)
      expect(station.km).toBeLessThan(14)
    }
    // Günstige Station etwas näher als die teure an der Küste.
    expect(stations[0].km).toBeLessThan(stations[1].km)
  })

  it('nimmt mit limit=2 nur die zwei günstigsten', () => {
    const stations = nearestStations(AGUIMES_DATA, TRIP_LAT, TRIP_LON, 2)
    expect(stations.map((s) => s.name)).toEqual(['DISA AUTOPISTA KM 21', 'REPSOL ARINAGA'])
  })

  it('nimmt einen JSON-String an und kaputtes JSON führt zu []', () => {
    expect(nearestStations(JSON.stringify(AGUIMES_DATA), TRIP_LAT, TRIP_LON)).toHaveLength(3)
    expect(nearestStations('{ kaputtes json', TRIP_LAT, TRIP_LON)).toEqual([])
    expect(nearestStations(undefined, TRIP_LAT, TRIP_LON)).toEqual([])
    expect(nearestStations({ anderes: 'Format' }, TRIP_LAT, TRIP_LON)).toEqual([])
  })
})

describe('formatFuelUpdated', () => {
  it('formt das Fecha-Feld in ein deutsches Kürzel um', () => {
    expect(formatFuelUpdated('21/11/2026 8:15:30')).toBe('Sa 21.11. 08:15')
    expect(formatFuelUpdated('20/11/2026 15:45:45')).toBe('Fr 20.11. 15:45')
  })

  it('gibt unverständliche Angaben unverändert zurück', () => {
    expect(formatFuelUpdated('kein Datum')).toBe('kein Datum')
  })
})

describe('dieselMax', () => {
  const DATA = {
    ListaEESSPrecio: [
      { 'Precio Gasoleo A': '1,509' },
      { 'Precio Gasoleo A': '1,669' },
      { 'Precio Gasoleo A': '' },
      { 'Precio Gasoleo A': '1,589' },
    ],
  }

  it('nimmt den höchsten Preis der Gemeinde, nicht den der günstigsten drei', () => {
    expect(dieselMax(DATA)).toBe(1.669)
    // Genau der Fall, der im Browser auffiel: drei gleich teure Stationen
    // (alle 1,509) ergaben überall „0 ct" — Bezug muss die Gemeinde sein.
    const onlyCheap = { ListaEESSPrecio: [{ 'Precio Gasoleo A': '1,509' }, { 'Precio Gasoleo A': '1,509' }] }
    expect(dieselMax(onlyCheap)).toBe(1.509)
  })

  it('ignoriert fehlende Preise und kaputte Antworten', () => {
    expect(dieselMax({ ListaEESSPrecio: [{ 'Precio Gasoleo A': '' }] })).toBeNull()
    expect(dieselMax({ anderes: 1 })).toBeNull()
    expect(dieselMax('{ kaputt')).toBeNull()
    expect(dieselMax(undefined)).toBeNull()
  })

  it('akzeptiert einen JSON-String', () => {
    expect(dieselMax(JSON.stringify(DATA))).toBe(1.669)
  })
})
