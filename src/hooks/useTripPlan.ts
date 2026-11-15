import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { SLOTS, isoDay, planFor, proposalsFor } from '../lib/tripPlan'
import { tripDays } from '../lib/trip'
import { readCache, writeCache } from '../lib/readCache'
import { useRealtimeSync } from './useRealtimeSync'
import type { TripProposal, TripSlot, TripVote } from '../types'

export type DayPlan = Partial<Record<TripSlot, TripProposal>>
/** Schlüssel: ISO-Datum (YYYY-MM-DD) */
export type TripPlanMap = Record<string, DayPlan>

/** Was im Offline-Cache liegt: der fertige Plan plus die Anzahl der Vorschläge. */
interface CachedPlan {
  plan: TripPlanMap
  count: number
}

export interface TripPlanState {
  /** Was pro Tag und Tageszeit gilt (bestätigt vor Abstimmungssieger) */
  plan: TripPlanMap
  /** Anzahl aller Vorschläge, für Hinweistexte */
  proposalCount: number
  loading: boolean
}

/**
 * Vergleichen statt ersetzen: der 90-Sekunden-Takt und jedes Realtime-Event
 * bauen sonst ein brandneues Plan-Objekt — bei byte-gleichem Inhalt wechseln
 * dann alle Verbraucher die Referenzen (Tageskarte rechnet die Route neu,
 * Wecker armiert neu, Tages-Screen rendert neu). Verglichen werden die Felder,
 * die die UI benutzt; `votes` als sortierte Menge (Reihenfolge vom Server).
 */
function sameProposal(a: TripProposal, b: TripProposal): boolean {
  if (
    a.id !== b.id ||
    a.day !== b.day ||
    a.slot !== b.slot ||
    a.title !== b.title ||
    a.note !== b.note ||
    a.place !== b.place ||
    a.place_url !== b.place_url ||
    a.place_lat !== b.place_lat ||
    a.place_lon !== b.place_lon ||
    a.starts_at !== b.starts_at ||
    a.remind_before !== b.remind_before ||
    a.remind_enabled !== b.remind_enabled ||
    a.confirmed_at !== b.confirmed_at ||
    a.confirmed_by !== b.confirmed_by ||
    a.created_by !== b.created_by
  ) {
    return false
  }
  const av = [...(a.votes ?? [])].sort()
  const bv = [...(b.votes ?? [])].sort()
  return av.length === bv.length && av.every((v, i) => v === bv[i])
}

function samePlan(a: TripPlanMap, b: TripPlanMap): boolean {
  const aDays = Object.keys(a)
  const bDays = Object.keys(b)
  if (aDays.length !== bDays.length || aDays.some((d) => !(d in b))) return false
  for (const day of aDays) {
    const aSlots = a[day]
    const bSlots = b[day]
    const aKeys = Object.keys(aSlots)
    const bKeys = Object.keys(bSlots)
    if (aKeys.length !== bKeys.length || aKeys.some((s) => !(s in bSlots))) return false
    for (const slot of aKeys) {
      const sa = aSlots[slot as TripSlot]
      const sb = bSlots[slot as TripSlot]
      if (!sa || !sb) return false
      if (!sameProposal(sa, sb)) return false
    }
  }
  return true
}

/**
 * Der geltende Reiseplan für alle Tage — einmal in App.tsx aufgerufen und an
 * Heute + Reise durchgereicht. Bewusst EIN Aufruf: ein zweiter Hook im selben
 * Baum bekäme denselben Realtime-Kanal und würde werfen (siehe SKILL.md).
 *
 * `activeTab`: Der Plan wird beim Betreten der Screens nachgeladen, beim
 * Zurückkehren in die App und (als Ausfallsicherung zum Broadcast-Sync aus
 * `sql/140_realtime_broadcast.sql`) im 90-Sekunden-Takt.
 */
export function useTripPlan(
  listId: string | null | undefined,
  activeTab?: string,
): TripPlanState {
  const days = useMemo(() => tripDays(), [])
  const [plan, setPlan] = useState<TripPlanMap>({})
  const [proposalCount, setProposalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  // Sequenz-Guard: ein langsamer oder scheiternder Lauf (90-s-Takt,
  // visibility-Refetch im Funkloch) darf einen frischeren Stand nicht mehr
  // überschreiben — jede Antwort prüft sich selbst.
  const seqRef = useRef(0)

  // Der Reiseplan ist die einzige Tabelle, die im Urlaub ohne Empfang zählt.
  // Beim Start kommt der letzte Stand aus dem Cache, bevor das Netz antwortet.
  useEffect(() => {
    if (!listId) return
    const cached = readCache<CachedPlan>(listId, 'trip_plan')
    if (!cached) return
    setPlan((current) => (Object.keys(current).length > 0 ? current : cached.plan))
    setProposalCount((current) => (current > 0 ? current : cached.count))
    setLoading(false)
  }, [listId])

  const load = useCallback(async () => {
    if (!listId) {
      // Alte Liste weg: laufende Antworten der vorherigen Liste verfallen, indem
      // die Sequenz vorgeworfen wird (der Guard unten lässt sie sterben).
      seqRef.current++
      setPlan({})
      setProposalCount(0)
      setLoading(false)
      return
    }
    const seq = ++seqRef.current
    const [p, v] = await Promise.all([
      supabase.from('trip_proposals').select('*').eq('list_id', listId),
      supabase.from('trip_votes').select('*').eq('list_id', listId),
    ])
    if (seq !== seqRef.current) return
    if (p.error || v.error) {
      // Kein Netz: den letzten bekannten Plan zeigen statt „Noch nichts geplant".
      // Der Cache-Stand überschreibt keinen frischeren RAM-Stand, der schon da ist.
      const cached = readCache<CachedPlan>(listId, 'trip_plan')
      if (cached) {
        setPlan((current) => (Object.keys(current).length > 0 ? current : cached.plan))
        setProposalCount((current) => (current > 0 ? current : cached.count))
      }
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
    if (seq !== seqRef.current) return
    setProposalCount((current) => (current === rows.length ? current : rows.length))
    setPlan((current) => (samePlan(current, next) ? current : next))
    setLoading(false)
    writeCache<CachedPlan>(listId, 'trip_plan', { plan: next, count: rows.length })
  }, [listId, days])

  useEffect(() => {
    void load()
  }, [load])

  // Beim Betreten der betroffenen Screens nachladen (der Pane bleibt sonst
  // stundenlang mit dem Stand vom ersten Mount stehen). Der erste Lauf wird
  // übersprungen — sonst lädt der Mount-Effekt oben und dieser hier dieselben
  // zwei Tabellen direkt hintereinander.
  const tabRef = useRef<string | undefined>(activeTab)
  useEffect(() => {
    if (!activeTab) return
    if (tabRef.current === activeTab) return
    tabRef.current = activeTab
    if (activeTab !== 'home' && activeTab !== 'plan') return
    void load()
  }, [activeTab, load])

  // Realtime läuft jetzt über den Broadcast-Trigger (sql/140). Der Takt hier ist
  // nur die Ausfallsicherung, wenn die WebSocket-Verbindung hängt.
  useEffect(() => {
    // Mindestabstand: jedes Tab-Fenster löste bisher einen vollen Refetch aus.
    const lastRef = { at: 0 }
    const wake = () => {
      if (document.hidden) return
      const now = Date.now()
      if (now - lastRef.at < 30_000) return
      lastRef.at = now
      void load()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    window.addEventListener('focus', wake)
    const timer = window.setInterval(() => {
      if (!document.hidden) void load()
    }, 90_000)
    return () => {
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
      window.removeEventListener('focus', wake)
      window.clearInterval(timer)
    }
  }, [load])

  // Kanal bleibt abonniert: falls die RLS-Seite irgendwann Header durchreicht,
  // greift er sofort — bis dahin ist er ein stiller Mitläufer.
  // Debounce: eine Vote-Runde erzeugt sonst pro Event zwei Vollabfragen.
  const realtimeTimerRef = useRef<number | null>(null)
  useRealtimeSync({
    listId: listId ?? null,
    tables: ['trip_proposals', 'trip_votes'],
    channelSuffix: ':planfeed',
    onTableChange: () => {
      if (realtimeTimerRef.current) window.clearTimeout(realtimeTimerRef.current)
      realtimeTimerRef.current = window.setTimeout(() => {
        realtimeTimerRef.current = null
        void load()
      }, 400)
    },
  })

  useEffect(() => () => {
    if (realtimeTimerRef.current) window.clearTimeout(realtimeTimerRef.current)
  }, [])

  return { plan, proposalCount, loading }
}
