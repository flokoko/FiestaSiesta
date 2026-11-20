import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

// Mock des Supabase-Clients: from(t).select('*').eq('list_id', l) löst mit
// einstellbarem, immer identischem Zeilenstand auf. Die Abruf-Zähler dienen
// als "zweiter Lauf ist durch"-Signal.
const db = vi.hoisted(() => ({
  state: {
    proposals: [] as unknown[],
    votes: [] as unknown[],
    calls: { trip_proposals: 0, trip_votes: 0 },
  },
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from(table: string) {
      return {
        select: () => ({
          eq: (_col: string, _val: unknown) => {
            const key = table as keyof typeof db.state.calls
            db.state.calls[key] = (db.state.calls[key] ?? 0) + 1
            return Promise.resolve({
              data: table === 'trip_proposals' ? db.state.proposals : db.state.votes,
              error: null,
            })
          },
        }),
      }
    },
  },
}))

// Cache außer Gefecht: lesend null, schreibend gezählt — writeCache läuft
// am ENDE jedes Laufs, signalisiert also "Lauf vollständig verarbeitet".
const cache = vi.hoisted(() => ({ writes: 0 }))

vi.mock('../../lib/readCache', () => ({
  readCache: () => null,
  writeCache: () => { cache.writes += 1 },
}))

vi.mock('../useRealtimeSync', () => ({
  useRealtimeSync: () => {},
}))

import { useTripPlan } from '../useTripPlan'

// Gleiche Serverzeile bei jedem Refetch — Inhalt byte-identisch.
const ROW = {
  id: 'p1', list_id: 'l1', day: '2026-12-02', slot: 'morning',
  title: 'Roque Nublo', note: null, place: 'Roque Nublo',
  place_lat: 27.9911, place_lon: -15.6111, place_url: null,
  created_by: 'Flo', created_at: '2026-11-01T10:00:00Z',
  confirmed_at: null, confirmed_by: null,
  starts_at: null, remind_before: null, remind_enabled: false,
}
const VOTE = { id: 'v1', list_id: 'l1', proposal_id: 'p1', voter: 'Flo', voted_at: '2026-11-01T11:00:00Z' }

describe('useTripPlan — Plan-Identität bei Refetch', () => {
  afterEach(() => {
    db.state.calls.trip_proposals = 0
    db.state.calls.trip_votes = 0
  })

  it('zwei Refetches mit identischen Serverzeilen lassen die plan-Referenz unverändert (samePlan)', async () => {
    db.state.proposals = [ROW]
    db.state.votes = [VOTE]

    const { result, rerender } = renderHook(
      ({ listId, tab }: { listId: string; tab: string }) => useTripPlan(listId, tab),
      { initialProps: { listId: 'l1', tab: 'home' } },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.proposalCount).toBe(1)
    const first = result.current.plan
    expect(Object.keys(first)).toEqual(['2026-12-02'])
    expect(first['2026-12-02']?.morning?.title).toBe('Roque Nublo')

    // Zweiter Lauf über den Tab-Refetch (dieselben Zeilen vom Server) — die
    // Referenz muss gleich bleiben, sonst rechnet die Tageskarte die Route neu.
    rerender({ listId: 'l1', tab: 'plan' })
    // writeCache läuft nach setPlan: erst dann ist der zweite Lauf am Ende.
    await waitFor(() => expect(cache.writes).toBe(2))
    expect(result.current.plan).toBe(first)
  })
})
