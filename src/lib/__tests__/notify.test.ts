import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

// Edge Function als Aufzeichnung: die konsolidierte Meldung lässt sich dort
// als EIN invoke-Aufruf mit body (title/body/exclude) ablesen.
vi.mock('../supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(() => Promise.resolve({ data: null, error: null })),
    },
  },
  getJoinCode: () => 'join-code',
}))
// Push gilt als konfiguriert — notify schlägt dann den Native-Fallback ein
// und das Ergebnis landet (prüfbar) im invoke-Spy.
vi.mock('../push', () => ({
  isPushConfigured: () => true,
}))

import { supabase } from '../supabase'
import {
  notifyEvent, resetNotifyBuffer, setNotifyListId, setNotifyUserName,
} from '../notify'

const invoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>

function lastBody(): { title: string; body: string; exclude?: string } {
  // invoke(functionName, { body, headers }) → Options-Argument öffnen
  const options = invoke.mock.calls[0][1] as {
    body: { title: string; body: string; exclude?: string }
  }
  return options.body
}

describe('lib/notify — Sammeln, Mergen, Ausliefern', () => {
  beforeEach(() => {
    invoke.mockClear()
    resetNotifyBuffer()
    localStorage.setItem('push_notifications_enabled', 'true')
    setNotifyListId('list-1')
    setNotifyUserName('Flo')
    // Der Tab ist in jsdom sichtbar — notify liefert dann nie aus. Für die
    // Tests den Tab als verdeckt markieren (Eigenschaft am document-Objekt
    // überblendet den jsdom-Getter, afterEach wird er wieder gelöscht).
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    vi.useFakeTimers()
  })

  afterEach(() => {
    resetNotifyBuffer()
    vi.useRealTimers()
    delete (document as { hidden?: boolean }).hidden
  })

  it('zwei Aufrufe kurz hintereinander ergeben EINE Meldung', async () => {
    notifyEvent('new_shopping', 'neue Items in der Einkaufsliste')
    notifyEvent('checked_shopping', 'Items abgehakt', 2)
    // Gleicher Typ + Label → wird in denselben Eintrag gemerged, nicht angehängt.
    notifyEvent('new_shopping', 'neue Items in der Einkaufsliste')
    expect(invoke.mock.calls).toHaveLength(0) // Debounce (2 s) noch nicht abgelaufen

    await vi.advanceTimersByTimeAsync(2_100)

    expect(invoke.mock.calls).toHaveLength(1)
    const body = lastBody()
    expect(body.body).toBe('🛒 2 neue Items\n✅ 2 abgehakt')
    // Mehr als ein Ereignis → Anzahl im Titel
    expect(body.title).toBe('Fiesta Siesta — 2 Änderungen')
  })

  it('übergibt den Absender als exclude', async () => {
    setNotifyUserName('Felix')
    notifyEvent('brought', 'Items als mitgebracht markiert')

    await vi.advanceTimersByTimeAsync(2_100)

    expect(invoke.mock.calls).toHaveLength(1)
    expect(lastBody().exclude).toBe('Felix')
  })

  it('meldet nichts, solange die App sichtbar ist', async () => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    notifyEvent('new_shopping', 'neue Items in der Einkaufsliste')

    await vi.advanceTimersByTimeAsync(2_100)

    expect(invoke.mock.calls).toHaveLength(0)
  })
})
