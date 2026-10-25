import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { SLOTS, isoDay, planFor, proposalsFor } from '../lib/tripPlan'
import { tripDays } from '../lib/trip'
import { useRealtimeSync } from './useRealtimeSync'
import type { TripProposal, TripSlot, TripVote } from '../types'

export type DayPlan = Partial<Record<TripSlot, TripProposal>>
/** Schlüssel: ISO-Datum (YYYY-MM-DD) */
export type TripPlanMap = Record<string, DayPlan>

export interface TripPlanState {
  /** Was pro Tag und Tageszeit gilt (bestätigt vor Abstimmungssieger) */
  plan: TripPlanMap
  /** Anzahl aller Vorschläge, für Hinweistexte */
  proposalCount: number
  loading: boolean
}

/**
 * Der geltende Reiseplan für alle Tage — einmal in App.tsx aufgerufen und an
 * Heute + Reise durchgereicht. Bewusst EIN Aufruf: ein zweiter Hook im selben
 * Baum bekäme denselben Realtime-Kanal und würde werfen (siehe SKILL.md).
 *
 * `activeTab`: Die RLS-Policies hängen an `request.headers->>'x-join-code'`,
 * Realtime wertet sie ohne diese Header aus und liefert deshalb KEINE Events
 * (am 25.10.2026 mit `items` und `trip_proposals` gegengeprüft). Der Plan wird
 * darum beim Betreten der Screens, beim Zurückkehren in die App und alle 30 s
 * nachgeladen — ohne diesen Fallback bliebe ein fremder Vorschlag unsichtbar.
 */
export function useTripPlan(
  listId: string | null | undefined,
  activeTab?: string,
): TripPlanState {
  const days = useMemo(() => tripDays(), [])
  const [plan, setPlan] = useState<TripPlanMap>({})
  const [proposalCount, setProposalCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!listId) {
      setPlan({})
      setProposalCount(0)
      setLoading(false)
      return
    }
    const [p, v] = await Promise.all([
      supabase.from('trip_proposals').select('*').eq('list_id', listId),
      supabase.from('trip_votes').select('*').eq('list_id', listId),
    ])
    if (p.error || v.error) {
      setLoading(false)
      return
    }
    const votedBy: Record<string, string[]> = {}
    for (const row of (v.data ?? []) as TripVote[]) {
      votedBy[row.proposal_id] = [...(votedBy[row.proposal_id] ?? []), row.voter]
    }
    const rows = ((p.data ?? []) as TripProposal[]).map((row) => ({
      ...row,
      votes: votedBy[row.id] ?? [],
    }))

    const next: TripPlanMap = {}
    for (const day of days) {
      const iso = isoDay(day)
      const entry: DayPlan = {}
      for (const slot of SLOTS) {
        const chosen = planFor(proposalsFor(rows, iso, slot.key))
        if (chosen) entry[slot.key] = chosen
      }
      if (Object.keys(entry).length > 0) next[iso] = entry
    }
    setProposalCount(rows.length)
    setPlan(next)
    setLoading(false)
  }, [listId, days])

  useEffect(() => {
    void load()
  }, [load])

  // Beim Betreten der betroffenen Screens nachladen (der Pane bleibt sonst
  // stundenlang mit dem Stand vom ersten Mount stehen).
  useEffect(() => {
    if (!activeTab) return
    if (activeTab !== 'home' && activeTab !== 'trip' && activeTab !== 'plan') return
    void load()
  }, [activeTab, load])

  // Realtime ist hier tot (siehe oben): Zurückkehren in die App und ein
  // ruhiger 30-Sekunden-Takt halten den Plan trotzdem frisch.
  useEffect(() => {
    const wake = () => {
      if (!document.hidden) void load()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    window.addEventListener('focus', wake)
    const timer = window.setInterval(() => {
      if (!document.hidden) void load()
    }, 30_000)
    return () => {
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
      window.removeEventListener('focus', wake)
      window.clearInterval(timer)
    }
  }, [load])

  // Kanal bleibt abonniert: falls die RLS-Seite irgendwann Header durchreicht,
  // greift er sofort — bis dahin ist er ein stiller Mitläufer.
  useRealtimeSync({
    listId: listId ?? null,
    tables: ['trip_proposals', 'trip_votes'],
    channelSuffix: ':planfeed',
    onTableChange: () => {
      void load()
    },
  })

  return { plan, proposalCount, loading }
}
