import { beforeEach, describe, expect, it } from 'vitest'
import { APP_VERSION } from '../../version'
import { clearCacheForList, readCache, writeCache } from '../readCache'

// jsdom-Testumgebung: Node versteckt sein experimentelles localStorage ohne
// --localstorage-file — In-Memory-Web-Storage nachlegen (Muster wie im
// useOfflineQueue-Test).
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

// Die Version ist an die App-Version geklebt — der Test kennt sie nur so,
// damit er nicht mit der Konstante im Modul mitwandert.
const SCHEMA = `cache1@${APP_VERSION}`

beforeEach(() => {
  localStorage.clear()
})

describe('readCache — Schema-Version', () => {
  it('verwirft Einträge mit alter Version (v: 1)', () => {
    localStorage.setItem('fs_cache_list-a_notes',
      JSON.stringify({ v: '1', ts: 1, data: [{ id: 'alt' }] }))
    expect(readCache('list-a', 'notes')).toBeNull()
  })

  it('verwirft Einträge einer anderen App-Version', () => {
    localStorage.setItem('fs_cache_list-a_expenses',
      JSON.stringify({ v: 'cache1@0.63.6', ts: 1, data: [{ id: 'alt' }] }))
    expect(readCache('list-a', 'expenses')).toBeNull()
  })

  it('liest Einträge mit der laufenden Version', () => {
    localStorage.setItem('fs_cache_list-a_notes',
      JSON.stringify({ v: SCHEMA, ts: 2, data: [{ id: 'n1' }] }))
    expect(readCache('list-a', 'notes')).toEqual([{ id: 'n1' }])
  })

  it('writeCache verpackt und liest mit der laufenden Version zurück', () => {
    writeCache('list-a', 'shopping_items', [{ id: 'i1', name: 'Wasser' }])
    expect(readCache('list-a', 'shopping_items')).toEqual([{ id: 'i1', name: 'Wasser' }])
    const raw = JSON.parse(localStorage.getItem('fs_cache_list-a_shopping_items') ?? '{}') as { v?: string }
    expect(raw.v).toBe(SCHEMA)
  })

  it('kaputtes JSON gibt null statt zu werfen', () => {
    localStorage.setItem('fs_cache_list-a_notes', '{ kein JSON')
    expect(readCache('list-a', 'notes')).toBeNull()
  })
})

describe('clearCacheForList', () => {
  it('entfernt genau die Einträge dieser Liste und keine anderen', () => {
    // Bewusst verschiedene Werte: writeCache überschreibt identische Payloads
    // aus dem Speicher-Diff nicht — gleiche Daten in verschiedenen Listen
    // müssten sich nicht unterscheiden, hier tun sie es trotzdem.
    writeCache('list-a', 'notes', [{ id: 'a-note' }])
    writeCache('list-a', 'expenses', [{ id: 'a-exp' }])
    writeCache('list-b', 'notes', [{ id: 'b-note' }])

    clearCacheForList('list-a')

    expect(readCache('list-a', 'notes')).toBeNull()
    expect(readCache('list-a', 'expenses')).toBeNull()
    expect(readCache('list-b', 'notes')).toEqual([{ id: 'b-note' }])
  })

  it('leert auch den Bristol-Slot (bekannte Cache-Tabellen)', () => {
    writeCache('list-c', 'bristol_entries', [{ id: 'b1', value: 3 }])
    clearCacheForList('list-c')
    expect(readCache('list-c', 'bristol_entries')).toBeNull()
  })

  it('entfernt auch trip_plan und recipes (Plan und Küche haben eigene Slots)', () => {
    writeCache('list-c', 'trip_plan', { plan: {}, count: 3 })
    writeCache('list-c', 'recipes', [{ id: 'r1' }])
    clearCacheForList('list-c')
    expect(readCache('list-c', 'trip_plan')).toBeNull()
    expect(readCache('list-c', 'recipes')).toBeNull()
  })

  it('writeCache schreibt nach clear identische Daten wieder (lastWritten-Diff geworfen)', () => {
    // Genau der Bug: clearCacheForList räumte nur localStorage, der Speicher-
    // Diff in writeCache sah die alten Nutzdaten weiter — identische Daten
    // wurden nicht (erneut) geschrieben und der Offline-Start zeigte nichts.
    const data = [{ id: 'n1', text: 'Karte an die Oma' }]
    writeCache('list-a', 'notes', data)
    clearCacheForList('list-a')
    expect(readCache('list-a', 'notes')).toBeNull()
    // IDENTISCHE Daten nochmal schreiben — der Cache darf nicht leer bleiben
    writeCache('list-a', 'notes', [{ id: 'n1', text: 'Karte an die Oma' }])
    expect(readCache('list-a', 'notes')).toEqual([{ id: 'n1', text: 'Karte an die Oma' }])
    const raw = JSON.parse(localStorage.getItem('fs_cache_list-a_notes') ?? '{}') as { v?: string }
    expect(raw.v).toBe(SCHEMA)
  })
})
