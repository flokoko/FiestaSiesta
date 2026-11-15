import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock supabase before importing useOfflineQueue
vi.mock('../../lib/supabase', () => {
  // checkConnectivity ruft .from('participants').select('id').limit(1)
  //   .abortSignal(signal).maybeSingle() auf — das muss eine erfolgreiche,
  //   fehlerfreie Antwort liefern, damit navigator.onLine == true erhalten bleibt.
  const selectChain = () => ({
    limit: () => ({
      abortSignal: () => ({
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      }),
    }),
  })
  // Einstellbares Insert-Ergebnis: die Dead-Letter-Tests zwingen die Queue
  // damit in einen echten Postgrest-Fehler (code + message).
  let insertResult: { data: unknown; error: unknown } = { data: null, error: null }
  return {
    supabase: {
      rpc: vi.fn(),
      from: vi.fn(() => ({
        insert: vi.fn(() => ({
          select: () => ({
            maybeSingle: () => Promise.resolve(insertResult),
          }),
        })),
        update: vi.fn(() => ({ eq: vi.fn(), in: vi.fn() })),
        delete: vi.fn(() => ({ eq: vi.fn(), in: vi.fn() })),
        select: selectChain,
      })),
      __setInsertResult: (next: { data: unknown; error: unknown }) => {
        insertResult = next
      },
    },
  }
})

import { supabase } from '../../lib/supabase'
import {
  clearFailedOps, isNetworkFailure, remapTempId, useOfflineQueue,
  type DeadOp, type QueuedOp,
} from '../useOfflineQueue'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
    get length() { return Object.keys(store).length },
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
  }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// Mock navigator.onLine
Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })

describe('useOfflineQueue', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  it('starts with empty queue when online', () => {
    const { result } = renderHook(() => useOfflineQueue())
    expect(result.current.queueLength).toBe(0)
    expect(result.current.isOnline).toBe(true)
  })

  it('enqueues operations', () => {
    const { result } = renderHook(() => useOfflineQueue())
    act(() => {
      result.current.enqueue({
        type: 'update',
        table: 'items',
        payload: { is_checked: true },
        filterColumn: 'id',
        filterValue: 'test-id',
      })
    })
    expect(result.current.queueLength).toBe(1)
  })

  it('deduplicates update operations for same id', () => {
    const { result } = renderHook(() => useOfflineQueue())
    act(() => {
      result.current.enqueue({
        type: 'update',
        table: 'items',
        payload: { is_checked: true },
        filterColumn: 'id',
        filterValue: 'test-id',
      })
    })
    act(() => {
      result.current.enqueue({
        type: 'update',
        table: 'items',
        payload: { is_checked: false },
        filterColumn: 'id',
        filterValue: 'test-id',
      })
    })
    expect(result.current.queueLength).toBe(1)
  })

  it('tracks online/offline status', async () => {
    const { result } = renderHook(() => useOfflineQueue())
    expect(result.current.isOnline).toBe(true)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current.isOnline).toBe(false)
    // checkConnectivity() ist asynchron — das Ergebnis wird erst in einer
    // Mikrotask nach dem online-Event gesetzt. Deshalb hier await act verwenden.
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    expect(result.current.isOnline).toBe(true)
  })
})

describe('isNetworkFailure — Verbindungsproblem oder Serverbefehl?', () => {
  it('Netz-/Abbruchklassen sind Wiederholungsfälle', () => {
    // TypeError: „Failed to fetch" / „NetworkError"
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkFailure(new Error('Failed to fetch'))).toBe(true)
    // Abort/Timeout (AbortController, Timeout-Wrapper)
    expect(isNetworkFailure(new DOMException('aborted', 'AbortError'))).toBe(true)
    expect(isNetworkFailure(new DOMException('timeout', 'TimeoutError'))).toBe(true)
  })

  it('Postgrest-Fehler mit code sind endgültig (kein Retry, kein Parken als Netzfehler)', () => {
    expect(isNetworkFailure({ code: 'PGRST205', message: 'x' })).toBe(false)
    expect(isNetworkFailure({ code: '22P02', message: 'x' })).toBe(false)
  })

  it('Fremde Meldungen ohne Netz-Stichwort sind kein Netzfehler', () => {
    expect(isNetworkFailure(new Error('JWT expired'))).toBe(false)
  })
})

describe('remapTempId — Temp-ID auf echte UUID umschreiben', () => {
  it('schreibt alle Vorkommen um (skalar + Array) und lässt sonst nichts anfassen', () => {
    const realId = 'c9a8b7c6-1234-4abc-8def-000000000001'
    const queue: QueuedOp[] = [
      { id: 'op-1', type: 'insert', table: 'items', payload: { name: 'Wasser' }, clientId: 'temp-1', timestamp: 111 },
      { id: 'op-2', type: 'update', table: 'items', payload: { is_checked: true }, filterColumn: 'id', filterValue: 'temp-1', timestamp: 222 },
      { id: 'op-3', type: 'delete', table: 'items', payload: {}, filterColumn: 'id', filterValue: ['temp-1', 'other'], timestamp: 333 },
      { id: 'op-4', type: 'update', table: 'items', payload: { is_checked: false }, filterColumn: 'id', filterValue: ['other', 'temp-1', 'temp-1'], timestamp: 444 },
      // Fremde Tabelle: kein Umschreiben
      { id: 'op-5', type: 'update', table: 'expenses', payload: { amount: 1 }, filterColumn: 'id', filterValue: 'temp-1', timestamp: 555 },
    ]
    localStorage.setItem('offline_queue', JSON.stringify(queue))

    remapTempId('items', 'temp-1', realId)

    const after = JSON.parse(localStorage.getItem('offline_queue')!) as QueuedOp[]
    // Reihenfolge, ids und timestamps unangetastet
    expect(after.map((q) => q.id)).toEqual(['op-1', 'op-2', 'op-3', 'op-4', 'op-5'])
    expect(after.map((q) => q.timestamp)).toEqual([111, 222, 333, 444, 555])
    // Insert selbst: clientId bleibt (der Flush entfernt den Op ohnehin)
    expect(after[0].clientId).toBe('temp-1')
    // Skalares filterValue umgeschrieben
    expect(after[1].filterValue).toBe(realId)
    // Array umgeschrieben, fremde Werte bleiben
    expect(after[2].filterValue).toEqual([realId, 'other'])
    // Mehrfache Vorkommen im selben Array: alle umgeschrieben
    expect(after[3].filterValue).toEqual(['other', realId, realId])
    // Andere Tabelle unverändert
    expect(after[4].filterValue).toBe('temp-1')
  })
})

describe('enqueue — Dedup und FIFO', () => {
  // Eigene Ausräum-Regeln wie im Describe oben: der Speicher wird geleert,
  // sonst läuft der Modul-Singleton (queueLengthState) über die Tests hinweg.
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  it('zwei Updates auf dieselbe Zeile werden zu einem (der letzte gewinnt)', () => {
    const { result } = renderHook(() => useOfflineQueue())
    act(() => {
      result.current.enqueue({ type: 'update', table: 'items', payload: { is_checked: true }, filterColumn: 'id', filterValue: 'row-1' })
    })
    act(() => {
      result.current.enqueue({ type: 'update', table: 'items', payload: { is_checked: false }, filterColumn: 'id', filterValue: 'row-1' })
    })
    expect(result.current.queueLength).toBe(1)
    const queue = JSON.parse(localStorage.getItem('offline_queue')!) as QueuedOp[]
    expect(queue).toHaveLength(1)
    expect((queue[0].payload as { is_checked: boolean }).is_checked).toBe(false)
  })

  it('zwei Inserts bleiben beide und liegen in Reihenfolge', () => {
    const { result } = renderHook(() => useOfflineQueue())
    act(() => {
      result.current.enqueue({ type: 'insert', table: 'items', payload: { name: 'A' } })
    })
    act(() => {
      result.current.enqueue({ type: 'insert', table: 'items', payload: { name: 'B' } })
    })
    expect(result.current.queueLength).toBe(2)
    const queue = JSON.parse(localStorage.getItem('offline_queue')!) as QueuedOp[]
    expect(queue.map((q) => (q.payload as { name: string }).name)).toEqual(['A', 'B'])
    expect(queue[0].timestamp).toBeLessThanOrEqual(queue[1].timestamp)
  })
})

describe('Dead-Letter: endgültig gescheiterte Ops', () => {
  /** Dem Mock-Insert ein Ergebnis unterjubeln. */
  const setInsertResult = (next: { data: unknown; error: unknown }) => {
    (supabase as unknown as {
      __setInsertResult: (r: { data: unknown; error: unknown }) => void
    }).__setInsertResult(next)
  }

  function seedDeadOps(count: number): void {
    const entries: DeadOp[] = Array.from({ length: count }, (_, i) => ({
      id: `old-${i}`,
      type: 'update',
      table: 'items',
      payload: {},
      filterColumn: 'id',
      filterValue: `old-${i}`,
      timestamp: i,
      failedAt: i,
      error: `Fehler alt-${i}`,
    }))
    localStorage.setItem('offline_queue_dead', JSON.stringify(entries))
  }

  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
    setInsertResult({ data: null, error: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Flush starten, die 1 s + 2 s Retry-Runde mit Fake-Timern abspülen, Flush abwarten. */
  async function flushTimed(result: { current: { flushQueue: () => Promise<unknown> } }): Promise<void> {
    await act(async () => {
      const flushing = result.current.flushQueue()
      await vi.advanceTimersByTimeAsync(4_000)
      await flushing
    })
  }

  it('parkt ein Op nach dreifachem Serverfehler und leert die Queue', async () => {
    vi.useFakeTimers()
    setInsertResult({
      data: null,
      error: {
        code: '23514',
        message: 'Diese Zahlung wurde gerade eben schon erfasst — bitte die Liste neu laden.',
      },
    })
    const { result } = renderHook(() => useOfflineQueue())
    act(() => {
      result.current.enqueue({ type: 'insert', table: 'items', payload: { name: 'Ausgabe' }, clientId: 'temp-1' })
    })
    expect(result.current.queueLength).toBe(1)

    await flushTimed(result)

    const dead = JSON.parse(localStorage.getItem('offline_queue_dead')!)
    expect(dead).toHaveLength(1)
    expect(dead[0].error).toBe('Diese Zahlung wurde gerade eben schon erfasst — bitte die Liste neu laden.')
    expect(dead[0].clientId).toBe('temp-1')
    // Nicht mehr in der Queue
    expect(JSON.parse(localStorage.getItem('offline_queue') ?? '[]')).toHaveLength(0)
    expect(result.current.failedCount).toBe(1)

    // Ein weiterer Flush hat nichts zu tun und parkt nichts weiter
    await flushTimed(result)
    expect(JSON.parse(localStorage.getItem('offline_queue_dead')!)).toHaveLength(1)
  })

  it('Dead-Letter fasst max. 20 Ops — die ältesten fliegen raus, clearFailedOps leert', async () => {
    vi.useFakeTimers()
    seedDeadOps(20)
    setInsertResult({
      data: null,
      error: {
        code: '23514',
        message: 'Diese Zahlung wurde gerade eben schon erfasst — bitte die Liste neu laden.',
      },
    })
    const { result } = renderHook(() => useOfflineQueue())
    act(() => {
      result.current.enqueue({ type: 'insert', table: 'items', payload: { name: 'Wasser' } })
    })

    await flushTimed(result)

    const dead = JSON.parse(localStorage.getItem('offline_queue_dead')!) as DeadOp[]
    expect(dead).toHaveLength(20)
    // Jüngst gescheitertes Op landet hinten, der älteste Vorbestand ist raus
    expect(dead[dead.length - 1].error).toContain('Diese Zahlung')
    expect(dead.map((d) => d.id)).not.toContain('old-0')
    expect(dead[0].id).toBe('old-1')
    // clearFailedOps räumt die Ablage komplett ab (inkl. Hook-Frischzelle)
    act(() => {
      clearFailedOps()
    })
    expect(localStorage.getItem('offline_queue_dead')).toBe('[]')
    expect(result.current.failedCount).toBe(0)
  })
})
