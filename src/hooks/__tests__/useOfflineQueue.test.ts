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
  // `select()` verhält sich wie PostgREST: ohne maybeSingle() kommt die rohe
  // Antwort (bei Batch-Inserts ein Array), mit maybeSingle() ist ein Array mit
  // ≠ 1 Zeilen ein Fehler (PGRST116). Genau diese Unterscheidung ist der
  // Regressionstest dafür, dass ein Batch-Insert NICHT als Fehler gilt.
  const insertSelect = () => {
    const many = Array.isArray(insertResult.data) && insertResult.data.length !== 1
    return Object.assign(Promise.resolve(insertResult), {
      maybeSingle: () => Promise.resolve(
        many
          ? { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } }
          : insertResult,
      ),
    })
  }
  return {
    supabase: {
      rpc: vi.fn(),
      from: vi.fn(() => ({
        insert: vi.fn(() => ({
          select: insertSelect,
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
  clearFailedOps, isNetworkFailure, remapOpPayload, remapTempId, useOfflineQueue,
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
    // TABELLENÜBERGREIFEND: Temp-IDs sind zufällig, Kollisionen über Tabellen
    // praktisch ausgeschlossen — der expenses-Op mit derselben Temp-ID wird
    // mitgeschrieben (nötig für Splits/Deletes auf der Ausgabe).
    expect(after[4].filterValue).toBe(realId)
  })

  it('schreibt filterValue über Tabellen hinweg um (Split-Delete zeigt auf die Ausgabe)', () => {
    const realId = 'c9a8b7c6-1234-4abc-8def-000000000002'
    const queue: QueuedOp[] = [
      { id: 'op-1', type: 'insert', table: 'expenses', payload: { description: 'Markt' }, clientId: 'temp-1', timestamp: 1 },
      // Split-Delete mit der Temp-ID im filterValue — fremde Tabelle
      { id: 'op-2', type: 'delete', table: 'expense_splits', payload: {}, filterColumn: 'expense_id', filterValue: 'temp-1', timestamp: 2 },
      // Delete der Ausgabe selbst
      { id: 'op-3', type: 'delete', table: 'expenses', payload: {}, filterColumn: 'id', filterValue: 'temp-1', timestamp: 3 },
    ]
    localStorage.setItem('offline_queue', JSON.stringify(queue))

    // Vom Flush des Expense-Inserts aus aufgerufen (table = 'expenses'):
    remapTempId('expenses', 'temp-1', realId)

    const after = JSON.parse(localStorage.getItem('offline_queue')!) as QueuedOp[]
    expect((after[0].payload as { description: string }).description).toBe('Markt')
    expect(after[1].filterValue).toBe(realId)
    expect(after[2].filterValue).toBe(realId)
  })

  it('schreibt den PAYLOAD eines Split-Inserts um (expense_id auf fremder Tabelle)', () => {
    const realId = 'c9a8b7c6-1234-4abc-8def-000000000003'
    const queue: QueuedOp[] = [
      { id: 'op-1', type: 'insert', table: 'expenses', payload: { description: 'Markt' }, clientId: 'temp-1', timestamp: 1 },
      { id: 'op-2', type: 'insert', table: 'expense_splits', payload: { expense_id: 'temp-1', person_name: 'Ben', share_amount: 12.5 }, timestamp: 2 },
      { id: 'op-3', type: 'insert', table: 'expense_splits', payload: [
        { expense_id: 'temp-1', person_name: 'Ada', share_amount: 5 },
        { expense_id: 'other-row', person_name: 'Cy', share_amount: 7.5 },
      ] as unknown as Record<string, unknown>, timestamp: 3 },
    ]
    localStorage.setItem('offline_queue', JSON.stringify(queue))

    remapTempId('expenses', 'temp-1', realId)

    const after = JSON.parse(localStorage.getItem('offline_queue')!) as QueuedOp[]
    expect((after[1].payload as { expense_id: string }).expense_id).toBe(realId)
    expect((after[1].payload as { person_name: string }).person_name).toBe('Ben')
    const batch = after[2].payload as unknown as { expense_id: string }[]
    expect(batch[0].expense_id).toBe(realId)
    expect(batch[1].expense_id).toBe('other-row')
  })
})

describe('remapOpPayload — reine Payload-Ersetzung (keine Mutation)', () => {
  it('Objekt: exakte Strings ersetzt, Zahlen/Booleans/null unangetastet, Eingabe nicht verändert', () => {
    const tempId = 'temp-abc-123'
    const payload = {
      expense_id: tempId,
      amount: 42.5,
      paid_by: tempId,
      note: null,
      active: false,
      keep: `x${tempId}`, // Teil-String bleibt
      nested: { ref: tempId, count: 3 },
    }
    const snapshot = JSON.stringify(payload)
    const { payload: next, changed } = remapOpPayload(payload, tempId, 'real-uuid')

    expect(changed).toBe(true)
    expect((next as { expense_id: string }).expense_id).toBe('real-uuid')
    expect((next as { paid_by: string }).paid_by).toBe('real-uuid')
    expect((next as { keep: string }).keep).toBe(`x${tempId}`)
    expect((next as { amount: number }).amount).toBe(42.5)
    expect((next as { note: null }).note).toBeNull()
    expect((next as { active: boolean }).active).toBe(false)
    expect((next as { nested: { ref: string } }).nested.ref).toBe('real-uuid')
    expect((next as { nested: { count: number } }).nested.count).toBe(3)
    // Eingabe unverändert (reine Funktion — der Aufrufer speichert die Queue)
    expect(JSON.stringify(payload)).toBe(snapshot)
  })

  it('Array von Objekten (Batch-Insert): jedes Element umgeschrieben', () => {
    const tempId = 'temp-1'
    const payload = [
      { expense_id: tempId, person_name: 'Ada', share_amount: 5 },
      { expense_id: 'real-row', person_name: 'Ben', share_amount: 7 },
    ]
    const { payload: next, changed } = remapOpPayload(payload, tempId, 'real-uuid')
    expect(changed).toBe(true)
    const batch = next as { expense_id: string }[]
    expect(batch[0].expense_id).toBe('real-uuid')
    expect(batch[1].expense_id).toBe('real-row')
  })

  it('Arrays von Strings (in.(…)-Werte) und verschachtelte Objekt-Ebenen', () => {
    const tempId = 'temp-1'
    const payload = {
      ids: [tempId, 'other', tempId],
      meta: { tags: ['a', tempId], owner: tempId },
    }
    const { payload: next, changed } = remapOpPayload(payload, tempId, 'real-uuid')
    expect(changed).toBe(true)
    expect((next as { ids: string[] }).ids).toEqual(['real-uuid', 'other', 'real-uuid'])
    expect((next as { meta: { tags: string[]; owner: string } }).meta.tags).toEqual(['a', 'real-uuid'])
    expect((next as { meta: { tags: string[]; owner: string } }).meta.owner).toBe('real-uuid')
  })

  it('Nichts trifft → changed false, Payload bleibt die Referenz', () => {
    const payload = { name: 'Ausgabe', amount: 9.99 }
    const { payload: next, changed } = remapOpPayload(payload, 'temp-1', 'real-uuid')
    expect(changed).toBe(false)
    expect(next).toBe(payload)
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

  it('Batch-Insert (Array-Payload) gilt NICHT als Fehler — kein Dead-Letter, kein zweiter Versuch', async () => {
    // Regression: executeOp nutzte .maybeSingle(). Ein Batch-Payload schreibt
    // N Zeilen, maybeSingle() wirft danach PGRST116 — die Zeilen stehen aber
    // schon in der DB. Der Flush hielt das für einen Fehler, versuchte es
    // dreimal und schrieb die Anteile dreifach (live: 1 Ausgabe, 9 Anteile).
    vi.useFakeTimers()
    setInsertResult({
      data: [{ id: 'aaa' }, { id: 'bbb' }, { id: 'ccc' }],
      error: null,
    })
    const { result } = renderHook(() => useOfflineQueue())
    act(() => {
      result.current.enqueue({
        type: 'insert',
        table: 'expense_splits',
        payload: [
          { expense_id: 'temp-1', person_name: 'Anna', share_amount: 10 },
          { expense_id: 'temp-1', person_name: 'Ben', share_amount: 10 },
          { expense_id: 'temp-1', person_name: 'Flo', share_amount: 10 },
        ] as unknown as Record<string, unknown>,
      })
    })

    await flushTimed(result)

    // Queue leer, kein Dead-Letter, keine Retries
    expect(JSON.parse(localStorage.getItem('offline_queue') ?? '[]')).toHaveLength(0)
    expect(localStorage.getItem('offline_queue_dead')).toBeNull()
    expect(result.current.failedCount).toBe(0)
    // genau EIN Insert-Aufruf für dieses Op
    const insertCalls = (supabase.from as unknown as ReturnType<typeof vi.fn>).mock.results
      .map((r: { value?: { insert?: ReturnType<typeof vi.fn> } }) => r.value?.insert?.mock.calls.length ?? 0)
      .reduce((a: number, b: number) => a + b, 0)
    expect(insertCalls).toBe(1)
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

describe('Insert-Idempotenz: client-UUID, 23505 als Erfolg, geteilter Flush', () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  const setInsertResult = (next: { data: unknown; error: unknown }) => {
    (supabase as unknown as {
      __setInsertResult: (r: { data: unknown; error: unknown }) => void
    }).__setInsertResult(next)
  }

  /** Insert-Payloads aller from()-Aufrufe seit clearAllMocks einsammeln. */
  const collectInsertPayloads = (): unknown[] => {
    const fromMock = supabase.from as unknown as {
      mock: { results: Array<{ value?: { insert?: { mock?: { calls: Array<unknown[]> } } } }> }
    }
    const payloads: unknown[] = []
    for (const result of fromMock.mock.results) {
      for (const call of result.value?.insert?.mock?.calls ?? []) payloads.push(call[0])
    }
    return payloads
  }

  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
    setInsertResult({ data: null, error: null })
  })

  it('Einzel-Insert bekommt eine gültige client-UUID als `id`', async () => {
    const { result } = renderHook(() => useOfflineQueue())
    act(() => {
      result.current.enqueue({ type: 'insert', table: 'items', payload: { name: 'Wasser' } })
    })
    await act(async () => {
      const outcome = await result.current.flushQueue()
      expect(outcome).toEqual({ success: 1, failed: 0 })
    })
    const payloads = collectInsertPayloads()
    expect(payloads).toHaveLength(1)
    const row = payloads[0] as { id?: string; name?: string }
    expect(typeof row.id).toBe('string')
    expect(row.id).toMatch(UUID_RE)
    expect(row.name).toBe('Wasser')
    expect(result.current.queueLength).toBe(0)
  })

  it('Bereits vorhandene `id` bleibt unangetastet (Undo-Insert eines gelöschten Artikels)', async () => {
    const { result } = renderHook(() => useOfflineQueue())
    act(() => {
      result.current.enqueue({
        type: 'insert',
        table: 'items',
        payload: { id: 'undo-row-1', name: 'Wasser' },
      })
    })
    await act(async () => {
      await result.current.flushQueue()
    })
    const payloads = collectInsertPayloads()
    expect(payloads).toHaveLength(1)
    const row = payloads[0] as { id?: string; name?: string }
    // Genau DIESE id geht raus, nichts Neues hinzugefügt
    expect(Object.keys(row)).toEqual(['id', 'name'])
    expect(row.id).toBe('undo-row-1')
    expect(row.name).toBe('Wasser')
  })

  it('Batch-Insert bekommt je Zeile eine eigene UUID', async () => {
    const { result } = renderHook(() => useOfflineQueue())
    act(() => {
      result.current.enqueue({
        type: 'insert',
        table: 'expense_splits',
        payload: [
          { expense_id: 'temp-1', person_name: 'Anna', share_amount: 10 },
          { expense_id: 'temp-1', person_name: 'Ben', share_amount: 10 },
        ] as unknown as Record<string, unknown>,
      })
    })
    await act(async () => {
      await result.current.flushQueue()
    })
    const payloads = collectInsertPayloads()
    expect(payloads).toHaveLength(1)
    const batch = payloads[0] as Array<{ id?: string; person_name?: string }>
    expect(batch).toHaveLength(2)
    expect(batch[0].id).toMatch(UUID_RE)
    expect(batch[1].id).toMatch(UUID_RE)
    // Je Zeile eine EIGENE — nicht dieselbe für alle
    expect(batch[0].id).not.toBe(batch[1].id)
    // Restliche Felder unverändert
    expect(batch[0].person_name).toBe('Anna')
    expect(batch[1].person_name).toBe('Ben')
  })

  it('23505 gilt als Erfolg: Op verlässt die Queue, kein Dead-Letter, kein Retry', async () => {
    // Genau der Fall „Server committet, Antwort verloren": dieselbe client-UUID
    // zum zweiten Mal (Wiederholungsversuch nach verlorenem Response) →
    // Unique-Verstoß — der Op darf nicht als Fehler parken oder liegen bleiben.
    const storedId = 'aaaa1111-2222-4abc-8def-000000000099'
    setInsertResult({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "items_pkey"',
      },
    })
    const { result } = renderHook(() => useOfflineQueue())
    act(() => {
      // Die id sitzt (wie nach einem verlorenen Erstversuch) im Payload.
      result.current.enqueue({
        type: 'insert',
        table: 'items',
        payload: { id: storedId, name: 'Ausgabe' },
      })
    })
    expect(result.current.queueLength).toBe(1)

    await act(async () => {
      const outcome = await result.current.flushQueue()
      expect(outcome).toEqual({ success: 1, failed: 0 })
    })

    // Op raus aus der Queue, kein Dead-Letter-Eintrag
    expect(JSON.parse(localStorage.getItem('offline_queue') ?? '[]')).toHaveLength(0)
    expect(localStorage.getItem('offline_queue_dead')).toBeNull()
    expect(result.current.failedCount).toBe(0)
    // Genau EIN Insert-Versuch: 23505 ist Erfolg, also KEINE Backoff-Runde
    expect(collectInsertPayloads()).toHaveLength(1)
    // Und rausgegangen ist genau die zuvor erzeugte id
    expect((collectInsertPayloads()[0] as { id?: string }).id).toBe(storedId)
  })

  it('zwei parallele flushQueue()-Aufrufe teilen dasselbe Ergebnis statt 0/0', async () => {
    // Der erste Lauf hängt bis zum release — er läuft garantiert noch, wenn
    // der zweite flushQueue()-Aufruf startet.
    let release!: (value: { data: null; error: null }) => void
    const gate = new Promise<{ data: null; error: null }>((resolve) => { release = resolve })
    // insertSelect tut Promise.resolve(insertResult) — ein Promise wird
    // übernommen (adoption), das await hängt also bis zum release.
    setInsertResult(gate as unknown as { data: unknown; error: unknown })

    const { result } = renderHook(() => useOfflineQueue())
    act(() => {
      result.current.enqueue({ type: 'insert', table: 'items', payload: { name: 'Markt' } })
    })
    expect(result.current.queueLength).toBe(1)

    let firstResult: { success: number; failed: number } | null = null
    let secondResult: { success: number; failed: number } | null = null
    await act(async () => {
      const p1 = result.current.flushQueue()
      const p2 = result.current.flushQueue()
      // Dasselbe Promise weitergegeben, nicht { success: 0, failed: 0 }
      expect(p2).toBe(p1)
      release({ data: null, error: null })
      const [r1, r2] = await Promise.all([p1, p2])
      firstResult = r1
      secondResult = r2
    })
    expect(firstResult).toEqual({ success: 1, failed: 0 })
    expect(secondResult).toEqual({ success: 1, failed: 0 })
    expect(result.current.queueLength).toBe(0)
    // Der zweite Aufruf hat KEINEN zweiten Lauf gestartet: 1 Insert-Versuch
    expect(collectInsertPayloads()).toHaveLength(1)
  })
})
