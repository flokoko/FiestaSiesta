import { describe, it, expect, beforeEach, vi } from 'vitest'
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
  return {
    supabase: {
      rpc: vi.fn(),
      from: vi.fn(() => ({
        insert: vi.fn(),
        update: vi.fn(() => ({ eq: vi.fn() })),
        delete: vi.fn(() => ({ eq: vi.fn() })),
        select: selectChain,
      })),
    },
  }
})

import { useOfflineQueue } from '../useOfflineQueue'

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
