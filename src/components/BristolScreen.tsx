import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { supabase, getJoinCode } from '../lib/supabase'
import { logError } from '../lib/logger'
import { useToast } from '../context/ToastContext'
import { useOfflineQueue } from '../hooks/useOfflineQueue'
import type { BristolEntry } from '../types'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend,
} from 'recharts'
import {
  BRISTOL_ADJECTIVES,
  BRISTOL_COLORS,
  BRISTOL_EMOJIS,
  BRISTOL_VALUES,
  bristolInk,
} from '../lib/bristolConstants'
import { spanishSuccess } from '../lib/espanaFlair'
import { addDaysIso, isoDay, todayIso } from '../lib/date'
import './BristolScreen.css'

interface BristolScreenProps {
  listId: string
  userName: string
  isAdmin: boolean
}

function todayStr(): string {
  // lokale Zeit: toISOString() wäre UTC und zeigt nachts den Vortag
  return todayIso()
}

/** True if the user's last 3 Bristol entries (by entry_time, fallback entry_date) are all value 13. */
function hasThreeConsecutive13(entries: BristolEntry[], userName: string): boolean {
  const mine = entries
    .filter(e => e.participant_name === userName)
    .sort((a, b) => {
      const aKey = a.entry_time || a.entry_date
      const bKey = b.entry_time || b.entry_date
      return bKey.localeCompare(aKey)
    })
  if (mine.length < 3) return false
  return mine.slice(0, 3).every(e => e.value === 13)
}

export default function BristolScreen({ listId, userName, isAdmin }: BristolScreenProps) {
  const { toast, confirm } = useToast()
  const { isOnline, enqueue } = useOfflineQueue()

  const [entries, setEntries] = useState<BristolEntry[]>([])
  const [loadingEntries, setLoadingEntries] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  // Ref-Guard, nicht State: drei Tipps im selben Tick sehen alle noch
  // `submitting === false` und legen drei Einträge an (State wird erst beim
  // nächsten Render gesetzt).
  const submittingRef = useRef(false)
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState(todayStr())
  const [intradayDate, setIntradayDate] = useState(todayStr())
  const [showStatsInfo, setShowStatsInfo] = useState(false)

  const today = todayStr()

  // ── Value 14 unlock: user's last 3 entries are all 13 ──
  const unlocked14 = useMemo(
    () => hasThreeConsecutive13(entries, userName),
    [entries, userName]
  )

  const fetchEntries = useCallback(async () => {
    const { data, error } = await supabase
      .from('bristol_entries')
      .select('*')
      .eq('list_id', listId)
      // Nur die letzten 90 Tage: Reise ist eine Woche, Statistik/Verlauf brauchen
      // nicht die Ewigkeit — vorher wuchs Payload und Chart-Knotenzahl unbegrenzt.
      .gte('entry_date', addDaysIso(todayIso(), -90))
      .limit(500)
      .order('entry_time', { ascending: false })
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) {
      logError('fetchEntries error:', error)
      return
    }
    setEntries(data as BristolEntry[] ?? [])
    setLoadingEntries(false)
  }, [listId])

  useEffect(() => {
    fetchEntries()
  }, [fetchEntries])

  // ── Realtime sync: refetch when bristol_entries change in this list ──
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  useEffect(() => {
    const joinCode = getJoinCode()
    const channel = supabase.channel(`bristol:${listId}`, {
      config: { headers: { 'x-join-code': joinCode } },
    } as any)
    channel.on(
      'postgres_changes' as any,
      { event: '*', schema: 'public', table: 'bristol_entries', filter: `list_id=eq.${listId}` },
      () => { fetchEntries() }
    )
    channel.subscribe()
    channelRef.current = channel
    return () => {
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [listId, fetchEntries])

  const handleSubmitEntry = useCallback(async (value: number) => {
    // Doppeltipp auf eine Skala-Kachel erzeugte zwei Einträge (kein Guard am
    // State). Jetzt: während des Speicherns sind weitere Tipps wirkungslos.
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    const entryTime = new Date().toISOString()
    if (isOnline) {
      const { error } = await supabase
        .from('bristol_entries')
        .insert({
          list_id: listId,
          participant_name: userName,
          value,
          entry_date: selectedDate,
          entry_time: entryTime,
        })
      submittingRef.current = false
      submittingRef.current = false
    setSubmitting(false)
      if (error) {
        toast(`Fehler: ${error.message}`, 'error')
        return
      }
    } else {
      enqueue({
        type: 'insert',
        table: 'bristol_entries',
        payload: {
          list_id: listId,
          participant_name: userName,
          value,
          entry_date: selectedDate,
          entry_time: entryTime,
        },
      })
      submittingRef.current = false
      submittingRef.current = false
    setSubmitting(false)
    }
    const isToday = selectedDate === today
    const dateLabel = isToday ? '' : ` (${new Date(selectedDate).toLocaleDateString('de-DE')})`
    toast(`${spanishSuccess()} Bristol-Wert ${value} (${BRISTOL_ADJECTIVES[value]})${dateLabel} eingetragen!`, 'success')
    navigator.vibrate?.(20)
    // Plasma-Effekt bei Wert 13
    if (value === 13) {
      navigator.vibrate?.([50, 30, 50, 30, 100, 50, 200])
      const { default: confetti } = await import('canvas-confetti')
      confetti({
        particleCount: 150,
        spread: 120,
        origin: { y: 0.4 },
        colors: ['#8B4513', '#A0522D', '#D2691E', '#654321', '#3E2723'],
        startVelocity: 35,
        scalar: 1.3,
      })
    }
    // Mega-Plasma-Effekt bei Wert 14 (noch bombiger)
    if (value === 14) {
      navigator.vibrate?.([50, 30, 50, 30, 100, 50, 200, 50, 300])
      const { default: confetti } = await import('canvas-confetti')
      confetti({
        particleCount: 300,
        spread: 160,
        origin: { y: 0.4 },
        colors: ['#5C1A0E', '#8B4513', '#A0522D', '#D2691E', '#3E2723', '#FFD700'],
        startVelocity: 45,
        scalar: 1.6,
      })
      confetti({
        particleCount: 100,
        angle: 60,
        spread: 80,
        origin: { x: 0, y: 0.6 },
        colors: ['#5C1A0E', '#8B4513', '#FFD700'],
      })
      confetti({
        particleCount: 100,
        angle: 120,
        spread: 80,
        origin: { x: 1, y: 0.6 },
        colors: ['#5C1A0E', '#8B4513', '#FFD700'],
      })
    }
    fetchEntries()
  }, [listId, userName, selectedDate, today, toast, fetchEntries, isOnline, enqueue])

  const handleUpdateEntry = useCallback(async (entryId: string, value: number) => {
    setSubmitting(true)
    if (isOnline) {
      const { error } = await supabase
        .from('bristol_entries')
        .update({ value })
        .eq('id', entryId)
      submittingRef.current = false
      submittingRef.current = false
    setSubmitting(false)
      if (error) {
        toast(`Fehler: ${error.message}`, 'error')
        return
      }
    } else {
      enqueue({
        type: 'update',
        table: 'bristol_entries',
        payload: { value },
        filterColumn: 'id',
        filterValue: entryId,
      })
      submittingRef.current = false
      submittingRef.current = false
    setSubmitting(false)
    }
    toast(`${spanishSuccess()} Bristol-Wert auf ${value} (${BRISTOL_ADJECTIVES[value]}) geändert!`, 'success')
    navigator.vibrate?.(20)
    setEditingEntryId(null)
    fetchEntries()
  }, [toast, fetchEntries, isOnline, enqueue])

  const handleDeleteEntry = useCallback((entryId: string, entry: BristolEntry) => {
    const datum = new Date(entry.entry_date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
    confirm(`"${entry.participant_name}" vom ${datum} wirklich löschen?`, async () => {
      if (isOnline) {
        const { error } = await supabase.from('bristol_entries').delete().eq('id', entryId)
        if (error) {
          toast(`Fehler: ${error.message}`, 'error')
          return
        }
      } else {
        enqueue({
          type: 'delete',
          table: 'bristol_entries',
          payload: {},
          filterColumn: 'id',
          filterValue: entryId,
        })
      }
      toast(`${spanishSuccess()} Eintrag gelöscht!`, 'success')
      navigator.vibrate?.(10)
      setEditingEntryId(null)
      fetchEntries()
    })
  }, [confirm, toast, fetchEntries, isOnline, enqueue])

  const myEntriesForSelectedDate = useMemo(
    () => entries
      .filter(e => e.participant_name === userName && e.entry_date === selectedDate)
      .sort((a, b) => {
        const aKey = a.entry_time || a.created_at
        const bKey = b.entry_time || b.created_at
        return aKey.localeCompare(bKey)
      }),
    [entries, userName, selectedDate]
  )

  const maxEntriesReached = myEntriesForSelectedDate.length >= 5

  const todayEntries = useMemo(
    () => entries
      .filter(e => e.entry_date === today)
      .sort((a, b) => {
        const aKey = a.entry_time || a.created_at
        const bKey = b.entry_time || b.created_at
        return aKey.localeCompare(bKey)
      }),
    [entries, today]
  )

  const stats = useMemo(() => {
    if (entries.length === 0) return null
    const values = entries.map(e => e.value)
    const total = values.length
    const avg = values.reduce((a, b) => a + b, 0) / total
    const min = Math.min(...values)
    const max = Math.max(...values)
    const counts: Record<number, number> = {}
    values.forEach(v => { counts[v] = (counts[v] ?? 0) + 1 })
    const mode = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0])
    return { total, avg, min, max, mode }
  }, [entries])

  const distributionData = useMemo(() => {
    const counts: Record<number, number> = {}
    const values = unlocked14 ? [...BRISTOL_VALUES, 14] : BRISTOL_VALUES
    values.forEach(v => { counts[v] = 0 })
    entries.forEach(e => { counts[e.value] = (counts[e.value] ?? 0) + 1 })
    return values.map(v => ({
      value: v,
      label: `${v}`,
      count: counts[v],
      adjective: BRISTOL_ADJECTIVES[v],
      fill: BRISTOL_COLORS[v],
    }))
  }, [entries, unlocked14])

  const trendData = useMemo(() => {
    const days: { date: string; label: string; avg: number | null; count: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateStr = isoDay(d)
      const dayEntries = entries.filter(e => e.entry_date === dateStr)
      const avg = dayEntries.length > 0
        ? dayEntries.reduce((s, e) => s + e.value, 0) / dayEntries.length
        : null
      days.push({
        date: dateStr,
        label: d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
        avg: avg !== null ? Number(avg.toFixed(2)) : null,
        count: dayEntries.length,
      })
    }
    return days
  }, [entries])

  // ── Highscore / Leaderboard ──
  const highscore = useMemo(() => {
    if (entries.length === 0) return null

    // Group entries by participant
    const byParticipant: Record<string, BristolEntry[]> = {}
    entries.forEach(e => {
      ;(byParticipant[e.participant_name] ??= []).push(e)
    })

    // Helper: rank top 3 by a metric
    const top3 = <T,>(sorted: { name: string; value: T; extra?: unknown }[]) => sorted.slice(0, 3)

    // Best average (descending — highest average = most "extreme")
    const avgRanked = Object.entries(byParticipant)
      .map(([name, es]) => ({
        name,
        value: es.reduce((s, e) => s + e.value, 0) / es.length,
        count: es.length,
      }))
      .sort((a, b) => b.value - a.value)

    // Most entries
    const entriesRanked = Object.entries(byParticipant)
      .map(([name, es]) => ({
        name,
        value: es.length,
      }))
      .sort((a, b) => b.value - a.value)

    // Most Plasma (value 13) + Mega-Plasma (value 14)
    const plasmaRanked = Object.entries(byParticipant)
      .map(([name, es]) => ({
        name,
        value: es.filter(e => e.value === 13 || e.value === 14).length,
      }))
      .sort((a, b) => b.value - a.value)

    return {
      bestAvg: top3(avgRanked),
      mostEntries: top3(entriesRanked),
      mostPlasma: top3(plasmaRanked),
    }
  }, [entries])

  // ── Biggest change vs previous day ──
  const biggestChange = useMemo(() => {
    if (entries.length === 0) return null

    // Group entries by participant, then by date (average value per day)
    const byParticipant: Record<string, Record<string, number[]>> = {}
    entries.forEach(e => {
      const dayMap = byParticipant[e.participant_name] ??= {}
      ;(dayMap[e.entry_date] ??= []).push(e.value)
    })
    // Convert arrays to averages
    const byParticipantAvg: Record<string, Record<string, number>> = {}
    for (const [name, dayMap] of Object.entries(byParticipant)) {
      const avgMap: Record<string, number> = {}
      for (const [date, vals] of Object.entries(dayMap)) {
        avgMap[date] = vals.reduce((s, v) => s + v, 0) / vals.length
      }
      byParticipantAvg[name] = avgMap
    }

    // Collect all distinct dates, sort descending (most recent first)
    const allDates = [...new Set(entries.map(e => e.entry_date))].sort().reverse()

    // Find the most recent date where the previous day also has data for the same participant
    let bestPos: { name: string; before: number; after: number; change: number; dayLabel: string; prevLabel: string } | null = null
    let bestNeg: { name: string; before: number; after: number; change: number; dayLabel: string; prevLabel: string } | null = null

    for (let i = 0; i < allDates.length - 1; i++) {
      const dayDate = allDates[i]
      const prevDate = allDates[i + 1]
      // Check if consecutive calendar days
      const dayMs = new Date(dayDate).getTime()
      const prevMs = new Date(prevDate).getTime()
      const dayDiff = Math.round((dayMs - prevMs) / (1000 * 60 * 60 * 24))
      if (dayDiff !== 1) continue

      const dayLabel = new Date(dayDate).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
      const prevLabel = new Date(prevDate).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })

      for (const [name, dayMap] of Object.entries(byParticipantAvg)) {
        const after = dayMap[dayDate]
        const before = dayMap[prevDate]
        if (after === undefined || before === undefined) continue
        const change = after - before
        if (change > 0 && (!bestPos || change > bestPos.change)) {
          bestPos = { name, before, after, change, dayLabel, prevLabel }
        }
        if (change < 0 && (!bestNeg || change < bestNeg.change)) {
          bestNeg = { name, before, after, change, dayLabel, prevLabel }
        }
      }
      // We found a day pair with data — use the most recent such pair
      break
    }

    return { positive: bestPos, negative: bestNeg }
  }, [entries])

  // ── Intraday data: one line per participant for the selected intraday date ──
  const intradayData = useMemo(() => {
    const dayEntries = entries.filter(e => e.entry_date === intradayDate)
    if (dayEntries.length === 0) return []

    // Collect all unique time points (HH:MM) sorted ascending
    const byParticipant: Record<string, { time: string; value: number }[]> = {}
    dayEntries.forEach(e => {
      const timeKey = e.entry_time
        ? new Date(e.entry_time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
        : null
      if (!timeKey) return
      ;(byParticipant[e.participant_name] ??= []).push({ time: timeKey, value: e.value })
    })

    // Sort each participant's entries by time
    Object.values(byParticipant).forEach(arr => arr.sort((a, b) => a.time.localeCompare(b.time)))

    // Collect all unique time labels sorted ascending
    const allTimes = [...new Set(Object.values(byParticipant).flat().map(d => d.time))].sort()

    // Build chart data: one row per time point, with a column per participant
    return allTimes.map(time => {
      const row: Record<string, string | number> = { time }
      for (const [name, arr] of Object.entries(byParticipant)) {
        const entry = arr.find(d => d.time === time)
        if (entry) {
          row[name] = entry.value
        }
      }
      return row
    })
  }, [entries, intradayDate])

  // ── Intraday line colors ──
  const intradayParticipants = useMemo(() => {
    const dayEntries = entries.filter(e => e.entry_date === intradayDate)
    return [...new Set(dayEntries.map(e => e.participant_name))].sort()
  }, [entries, intradayDate])

  const intradayColors = ['#F1BF00', '#AA151B', '#1e90ff', '#ff8c00', '#9b59b6', '#e74c3c', '#2ecc71', '#f39c12']

  // ── Day trend: per participant, first vs last entry of the intraday day ──
  const dayTrend = useMemo(() => {
    const dayEntries = entries.filter(e => e.entry_date === intradayDate)
    if (dayEntries.length === 0) return []

    const byParticipant: Record<string, BristolEntry[]> = {}
    dayEntries.forEach(e => {
      ;(byParticipant[e.participant_name] ??= []).push(e)
    })

    return Object.entries(byParticipant)
      .map(([name, arr]) => {
        const sorted = arr.sort((a, b) => {
          const aKey = a.entry_time || a.created_at
          const bKey = b.entry_time || b.created_at
          return aKey.localeCompare(bKey)
        })
        const first = sorted[0]
        const last = sorted[sorted.length - 1]
        const arrow = last.value > first.value ? '📈' : last.value < first.value ? '📉' : '➡️'
        return { name, firstValue: first.value, lastValue: last.value, arrow }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [entries, intradayDate])

  // ── #2 Scheißtag: Wochentag mit schlechtestem (höchstem) Ø-Wert ──
  const worstWeekday = useMemo(() => {
    if (entries.length === 0) return null
    const WD_NAMES = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
    const byWd: Record<number, number[]> = {}
    entries.forEach(e => {
      const wd = new Date(e.entry_date + 'T00:00:00').getDay()
      ;(byWd[wd] ??= []).push(e.value)
    })
    let bestWd = -1
    let bestAvg = -1
    for (const [wdStr, vals] of Object.entries(byWd)) {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length
      if (avg > bestAvg) { bestAvg = avg; bestWd = Number(wdStr) }
    }
    if (bestWd < 0) return null
    return { name: WD_NAMES[bestWd], avg: bestAvg }
  }, [entries])

  // ── #4 Achterbahn-Darm: Tag mit größter Spanne (max-min) aller User ──
  const rollercoasterDay = useMemo(() => {
    if (entries.length === 0) return null
    const byDate: Record<string, number[]> = {}
    entries.forEach(e => {
      ;(byDate[e.entry_date] ??= []).push(e.value)
    })
    let best: { date: string; min: number; max: number } | null = null
    for (const [date, vals] of Object.entries(byDate)) {
      if (vals.length < 2) continue
      const min = Math.min(...vals)
      const max = Math.max(...vals)
      if (!best || (max - min) > (best.max - best.min)) {
        best = { date, min, max }
      }
    }
    return best
  }, [entries])

  // ── #5 Zement-Modus: Längste Serie von Werten 1-3 pro User ──
  const cementRecord = useMemo(() => {
    if (entries.length === 0) return null
    const byUser: Record<string, BristolEntry[]> = {}
    entries.forEach(e => {
      ;(byUser[e.participant_name] ??= []).push(e)
    })
    let best: { name: string; count: number } | null = null
    for (const [name, es] of Object.entries(byUser)) {
      const sorted = [...es].sort((a, b) => {
        const aKey = a.entry_time || a.created_at
        const bKey = b.entry_time || b.created_at
        return aKey.localeCompare(bKey)
      })
      let run = 0
      let maxRun = 0
      for (const e of sorted) {
        if (e.value >= 1 && e.value <= 3) {
          run++
          if (run > maxRun) maxRun = run
        } else {
          run = 0
        }
      }
      if (!best || maxRun > best.count) {
        best = { name, count: maxRun }
      }
    }
    return best
  }, [entries])

  // ── #7 Durchschnitts-Uhrzeit: Ø aller Einträge als HH:MM ──
  const avgClockTime = useMemo(() => {
    if (entries.length === 0) return null
    let totalMinutes = 0
    let count = 0
    entries.forEach(e => {
      const ts = e.entry_time || e.created_at
      if (!ts) return
      const d = new Date(ts)
      totalMinutes += d.getHours() * 60 + d.getMinutes()
      count++
    })
    if (count === 0) return null
    const avgMin = Math.round(totalMinutes / count)
  const hh = Math.floor(avgMin / 60).toString().padStart(2, '0')
  const mm = (avgMin % 60).toString().padStart(2, '0')
    return `${hh}:${mm}`
  }, [entries])

  // ── #8 Nachtaktiv: Einträge zwischen 23:00–04:59 ──
  const nightActivity = useMemo(() => {
    if (entries.length === 0) return null
    let nightCount = 0
    const byUser: Record<string, number> = {}
    entries.forEach(e => {
      const ts = e.entry_time || e.created_at
      if (!ts) return
      const d = new Date(ts)
      const h = d.getHours()
      if (h >= 23 || h < 5) {
        nightCount++
        byUser[e.participant_name] = (byUser[e.participant_name] ?? 0) + 1
      }
    })
    if (nightCount === 0) return null
    let topUser = ''
    let topCount = 0
    for (const [name, c] of Object.entries(byUser)) {
      if (c > topCount) { topCount = c; topUser = name }
    }
    return { count: nightCount, topUser, topCount }
  }, [entries])

  // ── #10 Scheißtag vs Toilettenglück: Schlechtester & bester Tag der letzten 7 Tage ──
  const weekExtremes = useMemo(() => {
    if (entries.length === 0) return null
    const dayMap: Record<string, number[]> = {}
    const now = new Date()
    for (let i = 0; i < 7; i++) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      dayMap[isoDay(d)] = []
    }
    entries.forEach(e => {
      if (dayMap[e.entry_date]) {
        dayMap[e.entry_date].push(e.value)
      }
    })
    let worst: { date: string; avg: number } | null = null
    let best: { date: string; avg: number } | null = null
    for (const [date, vals] of Object.entries(dayMap)) {
      if (vals.length === 0) continue
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length
      if (!worst || avg > worst.avg) worst = { date, avg }
      if (!best || avg < best.avg) best = { date, avg }
    }
    if (!worst || !best) return null
    const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
    return {
      worst: { date: worst.date, avg: worst.avg, label: fmt(worst.date) },
      best: { date: best.date, avg: best.avg, label: fmt(best.date) },
    }
  }, [entries])

  const hasData = entries.length > 0
  const avgValue = hasData
    ? (entries.reduce((sum, e) => sum + e.value, 0) / entries.length).toFixed(1).replace('.', ',')
    : null

  return (
    <div className="bristol-screen">
      <header className="list-head">
        <div className="list-head-text">
          <h1>Bristol</h1>
          <p>
            {hasData
              ? `${entries.length} ${entries.length === 1 ? 'Eintrag' : 'Einträge'} · Ø ${avgValue}`
              : 'Noch kein Eintrag'}
          </p>
        </div>
      </header>

      {/* ── Hero: der Wert des gewählten Tags ── */}
      <div
        className="bv-hero"
        style={{ '--tint': BRISTOL_COLORS[myEntriesForSelectedDate.at(-1)?.value ?? 4] } as React.CSSProperties}
      >
        <div className="bv-hero-top">
          <span className="bv-kicker">
            {selectedDate === today ? 'Dein Wert heute' : 'Dein Wert'}
          </span>
          <div className="bv-date">
            <input
              type="date"
              lang="de"
              className="bv-date-input"
              value={selectedDate}
              max={today}
              onChange={(e) => setSelectedDate(e.target.value)}
              aria-label="Tag wählen"
            />
            {selectedDate !== today && (
              <button className="bv-today" onClick={() => setSelectedDate(today)}>
                Heute
              </button>
            )}
          </div>
        </div>

        {myEntriesForSelectedDate.length > 0 ? (
          <div className="bv-entries">
            {myEntriesForSelectedDate.map(e => (
              <div key={e.id} className="bv-entry">
                <span
                  className="bv-entry-disc"
                  style={{ '--tint': BRISTOL_COLORS[e.value] } as React.CSSProperties}
                >
                  {BRISTOL_EMOJIS[e.value]}
                </span>
                <span className="bv-entry-text">
                  <span className="bv-entry-adj">{BRISTOL_ADJECTIVES[e.value]}</span>
                  <span className="bv-entry-time">
                    {e.entry_time
                      ? new Date(e.entry_time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
                      : 'ohne Uhrzeit'}
                  </span>
                </span>
                <span className="bv-entry-val">{e.value}</span>
              </div>
            ))}
            {selectedDate === today && !maxEntriesReached && (
              <p className="bv-hero-hint">Noch einer? Tippe unten auf die Skala.</p>
            )}
            {maxEntriesReached && (
              <p className="bv-hero-hint">Max. 5 Einträge pro Tag — für mehr erst im Verlauf löschen.</p>
            )}
          </div>
        ) : (
          <div className="bv-hero-empty">
            <span className="bv-hero-empty-line">Noch nichts eingetragen.</span>
            <span className="bv-hero-empty-joke">
              Der Darm schweigt noch — die Skala unten wartet geduldig.
            </span>
          </div>
        )}
      </div>

      {/* ── Skala ── */}
      <div className="bv-picker">
        <div className="bv-picker-head">
          <span className="bv-kicker">Bristol-Skala</span>
          <span className="bv-picker-note">
            {unlocked14 ? '1–7 · Plasma · Mega-Plasma' : '1–7 · plus Plasma'}
          </span>
        </div>
        <div className="bv-scale">
          {BRISTOL_VALUES.map(v => (
            <button
              key={v}
              className={`bv-scale-btn${v === 13 ? ' is-bonus' : ''}`}
              data-value={v}
              style={{ '--tint': BRISTOL_COLORS[v] } as React.CSSProperties}
              disabled={submitting || maxEntriesReached}
              onClick={() => handleSubmitEntry(v)}
            >
              <span className="bv-scale-emoji">{BRISTOL_EMOJIS[v]}</span>
              <span className="bv-scale-num">{v}</span>
              <span className="bv-scale-adj">{BRISTOL_ADJECTIVES[v]}</span>
            </button>
          ))}
          {unlocked14 && (
            <button
              className="bv-scale-btn is-bonus is-mega"
              data-value={14}
              style={{ '--tint': BRISTOL_COLORS[14] } as React.CSSProperties}
              disabled={submitting || maxEntriesReached}
              onClick={() => handleSubmitEntry(14)}
            >
              <span className="bv-scale-emoji">{BRISTOL_EMOJIS[14]}</span>
              <span className="bv-scale-num">14</span>
              <span className="bv-scale-adj">{BRISTOL_ADJECTIVES[14]}</span>
            </button>
          )}
        </div>
        {maxEntriesReached && (
          <p className="bv-picker-hint">
            Max. 5 Einträge pro Tag erreicht — lösche einen Eintrag im Verlauf, um einen neuen hinzuzufügen.
          </p>
        )}
        {!unlocked14 && (
          <p className="bv-picker-hint">
            🔒 Tippe 3× hintereinander Plasma 💩, um Mega-Plasma 💥 freizuschalten.
          </p>
        )}
      </div>

      {/* ── Today's Overview ── */}
      <div className="bristol-card">
        <div className="bristol-card-header">
          <span className="bristol-card-title">Heute</span>
          {todayEntries.length > 0 && (
            <span className="bristol-card-badge">{todayEntries.length} {todayEntries.length === 1 ? 'Eintrag' : 'Einträge'}</span>
          )}
        </div>
        {todayEntries.length === 0 ? (
          <p className="bristol-empty-state">Noch niemand hat heute einen Wert eingetragen.</p>
        ) : (
          <div className="bristol-today-grid">
            {todayEntries.map(e => (
              <div key={e.id} className="bristol-today-chip">
                <span className="bristol-today-dot" style={{ background: BRISTOL_COLORS[e.value] }} />
                <span className="bristol-today-name">
                  {e.participant_name}
                  {e.participant_name === userName && <span className="bristol-today-me"> (du)</span>}
                </span>
                {e.entry_time && (
                  <span className="bristol-today-time">
                    {new Date(e.entry_time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                <span className="bristol-today-val">{e.value}</span>
                <span className="bristol-today-adj">{BRISTOL_ADJECTIVES[e.value]}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Statistics ── */}
      {stats && (
        <div className="bristol-card">
          <div className="bristol-card-header">
            <span className="bristol-card-title">Statistik</span>
            <button
              className="bristol-stats-info-btn"
              onClick={() => setShowStatsInfo(true)}
              aria-label="Statistiken erklären"
            >
              ℹ️
            </button>
          </div>

          <div className="bristol-stats-row">
            <div className="bristol-stat-item">
              <span className="bristol-stat-num">{stats.total}</span>
              <span className="bristol-stat-label">Einträge</span>
            </div>
            <div className="bristol-stat-item">
              <span className="bristol-stat-num">{stats.avg.toFixed(1).replace('.', ',')}</span>
              <span className="bristol-stat-label">Ø Wert</span>
            </div>
            <div className="bristol-stat-item">
              <span className="bristol-stat-num">{stats.min}</span>
              <span className="bristol-stat-label">Min</span>
            </div>
            <div className="bristol-stat-item">
              <span className="bristol-stat-num">{stats.max}</span>
              <span className="bristol-stat-label">Max</span>
            </div>
            <div className="bristol-stat-item">
              <span className="bristol-stat-num">{stats.mode}</span>
              <span className="bristol-stat-label">Häufigster</span>
            </div>
          </div>

          {/* Distribution */}
          <div className="bristol-chart-box">
            <div className="bristol-chart-label">Verteilung</div>
            <ResponsiveContainer width="100%" height={168}>
              <BarChart data={distributionData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--card-bg-solid)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '10px',
                    fontSize: '0.8rem',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
                  }}
                  formatter={(val) => [`${val} Einträge`, 'Anzahl']}
                  labelFormatter={(label) => `Wert ${label}`}
                />
                <Bar dataKey="count" radius={[8, 8, 0, 0]} maxBarSize={24} fill="var(--accent)" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Trend */}
          <div className="bristol-chart-box">
            <div className="bristol-chart-label">Trend (14 Tage)</div>
            <ResponsiveContainer width="100%" height={168}>
              <LineChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
                <YAxis domain={[1, unlocked14 ? 14 : 13]} ticks={unlocked14 ? [1, 3, 5, 7, 9, 11, 13, 14] : [1, 3, 5, 7, 9, 11, 13]} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--card-bg-solid)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '10px',
                    fontSize: '0.8rem',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
                  }}
                  formatter={(val) => val !== null ? [`Ø ${val}`, 'Durchschnitt'] : ['—', '']}
                  labelFormatter={(label) => label}
                />
                <Line
                  type="monotone"
                  dataKey="avg"
                  name="Durchschnitt"
                  stroke="var(--accent)"
                  strokeWidth={2.5}
                  dot={{ fill: 'var(--accent)', r: 3, strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: 'var(--accent)' }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Intraday-Verlauf (Tageskurve) */}
          <div className="bristol-chart-box">
            <div className="bristol-chart-label">Tagesverlauf</div>
            <div className="bristol-intraday-date-row">
              <input
                type="date"
                lang="de"
                className="bristol-hero-date-input"
                value={intradayDate}
                max={today}
                onChange={(e) => setIntradayDate(e.target.value)}
              />
              {intradayDate !== today && (
                <button
                  className="bristol-hero-today-btn"
                  onClick={() => setIntradayDate(today)}
                >
                  Heute
                </button>
              )}
            </div>
            {intradayData.length < 2 ? (
              <p className="bristol-empty-state">
                Für eine Tageskurve braucht es mindestens zwei Einträge.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={intradayData} margin={{ top: 6, right: 10, bottom: 0, left: -22 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                    axisLine={false}
                    tickLine={false}
                    padding={{ left: 14, right: 14 }}
                  />
                  <YAxis
                    domain={[0, (dataMax: number) => Math.max(unlocked14 ? 14 : 8, Math.ceil(dataMax) + 1)]}
                    allowDecimals={false}
                    tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--card-bg-solid)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '10px',
                      fontSize: '0.8rem',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '0.7rem', paddingTop: 2 }} iconSize={8} />
                  {intradayParticipants.map((name, i) => (
                    <Line
                      key={name}
                      type="monotone"
                      dataKey={name}
                      stroke={intradayColors[i % intradayColors.length]}
                      strokeWidth={2.4}
                      /* gefüllte Punkte: bei einem Eintrag pro Person gibt es keine
                         Linie, nur den Punkt — weiß gefüllt war er unsichtbar */
                      dot={{ r: 4.5, strokeWidth: 0, fill: intradayColors[i % intradayColors.length] }}
                      activeDot={{ r: 6.5 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Tagestrend Morgen → Abend */}
          {dayTrend.length > 0 && (
            <div className="bristol-chart-box">
              <div className="bristol-chart-label">Tagestrend Morgen → Abend</div>
              {dayTrend.map(t => (
                <div key={t.name} className="bristol-daytrend-row">
                  <span className="bristol-daytrend-name">{t.name}</span>
                  <span className="bristol-daytrend-values">
                    {t.firstValue} → {t.lastValue}
                  </span>
                  <span className="bristol-daytrend-arrow">{t.arrow}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Humorvolle Fun-Stats ── */}
          <div className="bristol-funstats-grid">
            {/* #2 Scheißtag */}
            {worstWeekday && (
              <div className="bristol-funstat-tile">
                <span className="bristol-funstat-emoji">💩</span>
                <span className="bristol-funstat-text">
                  Scheißtag: {worstWeekday.name} (Ø {worstWeekday.avg.toFixed(1)})
                </span>
              </div>
            )}

            {/* #4 Achterbahn-Darm */}
            {rollercoasterDay && (
              <div className="bristol-funstat-tile">
                <span className="bristol-funstat-emoji">🎢</span>
                <span className="bristol-funstat-text">
                  Achterbahn-Darm: {new Date(rollercoasterDay.date + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} — von {rollercoasterDay.min} ({BRISTOL_ADJECTIVES[rollercoasterDay.min]}) bis {rollercoasterDay.max} ({BRISTOL_ADJECTIVES[rollercoasterDay.max]})
                </span>
              </div>
            )}

            {/* #5 Zement-Modus */}
            {cementRecord && cementRecord.count >= 2 && (
              <div className="bristol-funstat-tile">
                <span className="bristol-funstat-emoji">🧱</span>
                <span className="bristol-funstat-text">
                  Verstopfungs-Rekord: {cementRecord.name} ({cementRecord.count}× hintereinander im Zement-Modus 🧱)
                </span>
              </div>
            )}

            {/* #7 Durchschnitts-Uhrzeit */}
            {avgClockTime && (
              <div className="bristol-funstat-tile">
                <span className="bristol-funstat-emoji">⏰</span>
                <span className="bristol-funstat-text">
                  Regelmäßig wie ein Uhrwerk — Ø {avgClockTime}
                </span>
              </div>
            )}

            {/* #8 Nachtaktiv */}
            {nightActivity && (
              <div className="bristol-funstat-tile">
                <span className="bristol-funstat-emoji">🌙</span>
                <span className="bristol-funstat-text">
                  Nachtaktiv im Stillen Örtchen: {nightActivity.count} {nightActivity.count === 1 ? 'Eintrag' : 'Einträge'} ({nightActivity.topUser} {nightActivity.topCount}×)
                </span>
              </div>
            )}

            {/* #10 Scheißtag vs Toilettenglück */}
            {weekExtremes && (
              <>
                <div className="bristol-funstat-tile bristol-funstat-worst">
                  <span className="bristol-funstat-emoji">💩</span>
                  <span className="bristol-funstat-text">
                    Scheißtag: {weekExtremes.worst.label} (Ø {weekExtremes.worst.avg.toFixed(1)})
                  </span>
                </div>
                <div className="bristol-funstat-tile bristol-funstat-best">
                  <span className="bristol-funstat-emoji">🍀</span>
                  <span className="bristol-funstat-text">
                    Toilettenglück: {weekExtremes.best.label} (Ø {weekExtremes.best.avg.toFixed(1)})
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Highscore / Biggest Change ── */}
      {highscore && (
        <div className="bristol-card">
          <div className="bristol-card-header">
            <span className="bristol-card-title">🏆 Highscore</span>
          </div>

          {/* Leaderboard: Best average */}
          <div className="bristol-leaderboard">
            <div className="bristol-leaderboard-title">Bester Ø-Wert</div>
            {highscore.bestAvg.length === 0 ? (
              <p className="bristol-empty-state">Noch keine Daten.</p>
            ) : (
              highscore.bestAvg.map((p, i) => (
                <div key={p.name} className="bristol-leaderboard-row">
                  <span className="bristol-medal">{['🥇', '🥈', '🥉'][i]}</span>
                  <span className="bristol-leaderboard-name">{p.name}</span>
                  <span className="bristol-leaderboard-value">
                    Ø {p.value.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Leaderboard: Most entries */}
          <div className="bristol-leaderboard">
            <div className="bristol-leaderboard-title">Meiste Einträge</div>
            {highscore.mostEntries.length === 0 ? (
              <p className="bristol-empty-state">Noch keine Daten.</p>
            ) : (
              highscore.mostEntries.map((p, i) => (
                <div key={p.name} className="bristol-leaderboard-row">
                  <span className="bristol-medal">{['🥇', '🥈', '🥉'][i]}</span>
                  <span className="bristol-leaderboard-name">{p.name}</span>
                  <span className="bristol-leaderboard-value">{p.value}</span>
                </div>
              ))
            )}
          </div>

          {/* Leaderboard: Most Plasma */}
          <div className="bristol-leaderboard">
            <div className="bristol-leaderboard-title">Meistens Plasma 💩</div>
            {highscore.mostPlasma.length === 0 || highscore.mostPlasma[0].value === 0 ? (
              <p className="bristol-empty-state">Noch niemand hat Plasma eingetragen.</p>
            ) : (
              highscore.mostPlasma
                .filter(p => p.value > 0)
                .map((p, i) => (
                  <div key={p.name} className="bristol-leaderboard-row">
                    <span className="bristol-medal">{['🥇', '🥈', '🥉'][i]}</span>
                    <span className="bristol-leaderboard-name">{p.name}</span>
                    <span className="bristol-leaderboard-value">{p.value}× 💩</span>
                  </div>
                ))
            )}
          </div>

          {/* Biggest change vs previous day */}
          <div className="bristol-change-section">
            <div className="bristol-change-title">Größte Veränderung vs. Vortag</div>
            {(!biggestChange?.positive && !biggestChange?.negative) ? (
              <p className="bristol-empty-state">
                Noch nicht genug Daten für einen Tagesvergleich. Mindestens zwei aufeinanderfolgende Tage mit Einträgen nötig.
              </p>
            ) : (
              <>
                {biggestChange.positive && (
                  <div className="bristol-change-row bristol-change-pos">
                    <span className="bristol-change-arrow">📈</span>
                    <span className="bristol-change-name">{biggestChange.positive.name}</span>
                    <span className="bristol-change-detail">
                      {biggestChange.positive.before} → {biggestChange.positive.after}
                    </span>
                    <span className="bristol-change-delta">
                      +{biggestChange.positive.change}
                    </span>
                    <span className="bristol-change-date">
                      {biggestChange.positive.prevLabel} → {biggestChange.positive.dayLabel}
                    </span>
                  </div>
                )}
                {biggestChange.negative && (
                  <div className="bristol-change-row bristol-change-neg">
                    <span className="bristol-change-arrow">📉</span>
                    <span className="bristol-change-name">{biggestChange.negative.name}</span>
                    <span className="bristol-change-detail">
                      {biggestChange.negative.before} → {biggestChange.negative.after}
                    </span>
                    <span className="bristol-change-delta">
                      {biggestChange.negative.change}
                    </span>
                    <span className="bristol-change-date">
                      {biggestChange.negative.prevLabel} → {biggestChange.negative.dayLabel}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── History ── */}
      <div className="bristol-card">
        <div className="bristol-card-header">
          <span className="bristol-card-title">Verlauf</span>
          {hasData && <span className="bristol-card-badge">{entries.length} gesamt</span>}
        </div>
        {loadingEntries ? (
          <p className="bristol-empty-state">Lädt…</p>
        ) : !hasData ? (
          <p className="bristol-empty-state">Noch keine Einträge. Tippe oben einen Wert, um zu starten!</p>
        ) : (
          <div className="bristol-history-list">
            {entries.map(e => {
              const isOwn = e.participant_name === userName
              const canManage = isOwn || isAdmin
              const isEditing = editingEntryId === e.id
              return (
                <div key={e.id} className={`bristol-history-row ${isOwn ? 'bristol-history-own' : ''}`}>
                  <span className="bristol-history-date">
                    {new Date(e.entry_date).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                  </span>
                  <span className="bristol-history-name">
                    {e.participant_name}
                    {isOwn && <span className="bristol-today-me"> (du)</span>}
                  </span>
                  {isEditing ? (
                    <div className="bristol-history-edit-picker">
                      {BRISTOL_VALUES.map(v => (
                        <button
                          key={v}
                          className={`bristol-history-edit-btn ${v === 13 ? 'bristol-history-edit-btn-bonus' : ''} ${e.value === v ? 'selected' : ''}`}
                          style={{ '--bristol-color': BRISTOL_COLORS[v] } as React.CSSProperties}
                          disabled={submitting}
                          onClick={() => handleUpdateEntry(e.id, v)}
                        >
                          {v}
                        </button>
                      ))}
                      {unlocked14 && (
                        <button
                          className={`bristol-history-edit-btn bristol-history-edit-btn-bonus ${e.value === 14 ? 'selected' : ''}`}
                          style={{ '--bristol-color': BRISTOL_COLORS[14] } as React.CSSProperties}
                          disabled={submitting}
                          onClick={() => handleUpdateEntry(e.id, 14)}
                        >
                          14
                        </button>
                      )}
                      <button
                        className="bristol-history-edit-cancel"
                        onClick={() => setEditingEntryId(null)}
                        disabled={submitting}
                      >
                        ✕
                      </button>
                      <button
                        className="bristol-history-delete-btn"
                        onClick={() => handleDeleteEntry(e.id, e)}
                        disabled={submitting}
                        aria-label="Eintrag löschen"
                      >
                        <Trash2 size={14} strokeWidth={2} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="bristol-history-badge" style={{ background: BRISTOL_COLORS[e.value], color: bristolInk(e.value) }}>
                        {e.value}
                      </span>
                      <span className="bristol-history-adj">{BRISTOL_ADJECTIVES[e.value]}</span>
                      {canManage && (
                        <button
                          className="bristol-history-edit-trigger"
                          onClick={() => setEditingEntryId(e.id)}
                          aria-label="Wert bearbeiten"
                        >
                          <Pencil size={14} strokeWidth={2} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Statistik-Erklärung (Modal) ── */}
      {showStatsInfo && (
        <div className="bristol-stats-overlay" onClick={() => setShowStatsInfo(false)}>
          <div className="bristol-stats-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bristol-stats-modal-header">
              <span className="bristol-stats-modal-title">Was bedeuten die Statistiken?</span>
              <button
                className="bristol-stats-modal-close"
                onClick={() => setShowStatsInfo(false)}
                aria-label="Schließen"
              >
                ✕
              </button>
            </div>
            <div className="bristol-stats-modal-body">
              <div className="bristol-stats-modal-item">
                <span className="bristol-stats-modal-emoji">💩</span>
                <span><b>Scheißtag</b> — der Wochentag mit dem schlechtesten (höchsten) Ø-Wert.</span>
              </div>
              <div className="bristol-stats-modal-item">
                <span className="bristol-stats-modal-emoji">🎢</span>
                <span><b>Achterbahn-Darm</b> — der Tag mit der größten Spanne zwischen dem niedrigsten und höchsten Wert.</span>
              </div>
              <div className="bristol-stats-modal-item">
                <span className="bristol-stats-modal-emoji">🧱</span>
                <span><b>Zement-Modus</b> — die längste Serie von Werten 1–3 (die „festen“) hintereinander.</span>
              </div>
              <div className="bristol-stats-modal-item">
                <span className="bristol-stats-modal-emoji">⏰</span>
                <span><b>Regelmäßig wie ein Uhrwerk</b> — die durchschnittliche Uhrzeit aller Einträge.</span>
              </div>
              <div className="bristol-stats-modal-item">
                <span className="bristol-stats-modal-emoji">🌙</span>
                <span><b>Nachtaktiv im Stillen Örtchen</b> — Einträge zwischen 23:00 und 04:59.</span>
              </div>
              <div className="bristol-stats-modal-item">
                <span className="bristol-stats-modal-emoji">💩 vs 🍀</span>
                <span><b>Scheißtag / Toilettenglück</b> — der schlechteste und beste Tag der letzten 7 Tage.</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
