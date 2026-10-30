import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Plus, ThumbsUp, Trash2, Loader2, Crown, MapPin, Check, RotateCcw, CalendarPlus } from 'lucide-react'
import SlotIcon from './SlotIcon'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/friendlyError'
import { useToast } from '../context/ToastContext'
import { useRealtimeSync } from '../hooks/useRealtimeSync'
import { SLOTS, isoDay, confirmedProposal, mapsUrl, planFor, proposalsFor, slotMeta, voteCount } from '../lib/tripPlan'
import { tripDays, formatDayShort, tripDay } from '../lib/trip'
import { coordsFromMapsUrl, isMapsUrl, reverseLabel, resolvePlaceCoords, type Coords } from '../lib/poiCoords'
import { buildIcs, downloadIcs, eventsFromPlan } from '../lib/ics'
import type { TripProposal, TripSlot, TripVote } from '../types'
import './TripPlanScreen.css'

interface TripPlanScreenProps {
  listId: string
  userName: string
  isAdmin: boolean
  onBack: () => void
}

export default function TripPlanScreen({ listId, userName, isAdmin, onBack }: TripPlanScreenProps) {
  const { toast, confirm } = useToast()
  const days = useMemo(() => tripDays(), [])
  const [proposals, setProposals] = useState<TripProposal[]>([])
  const [votes, setVotes] = useState<TripVote[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [addSlot, setAddSlot] = useState<TripSlot | null>(null)
  const [draft, setDraft] = useState('')
  const [draftNote, setDraftNote] = useState('')
  const [draftPlace, setDraftPlace] = useState('')
  const [placeCoords, setPlaceCoords] = useState<Coords | null>(null)
  const [placeUrl, setPlaceUrl] = useState<string | null>(null)
  const [placeBusy, setPlaceBusy] = useState(false)
  const [selectedDay, setSelectedDay] = useState<string>(() => {
    const today = tripDay()
    if (today !== null) return isoDay(days[today - 1] ?? days[0])
    return isoDay(days[0])
  })
  // ── Doppelklick-Sperre je proposal_id: keine parallelen Vote-Inserts/Deletes
  const votingRef = useRef<Set<string>>(new Set())
  // ── Doppelklick-Sperre für „Vorschlagen": Insert darf nicht doppelt feuern
  const addingRef = useRef(false)

  const load = useCallback(async () => {
    const [p, v] = await Promise.all([
      supabase.from('trip_proposals').select('*').eq('list_id', listId).order('created_at'),
      supabase.from('trip_votes').select('*').eq('list_id', listId),
    ])
    if (p.error || v.error) {
      setLoading(false)
      toast(`Reiseplan konnte nicht geladen werden: ${(p.error ?? v.error)?.message}`, 'error')
      return
    }
    const voteRows = (v.data ?? []) as TripVote[]
    const grouped: Record<string, string[]> = {}
    for (const row of voteRows) {
      grouped[row.proposal_id] = [...(grouped[row.proposal_id] ?? []), row.voter]
    }
    setVotes(voteRows)
    setProposals(
      ((p.data ?? []) as TripProposal[]).map((row) => ({ ...row, votes: grouped[row.id] ?? [] }))
    )
    setLoading(false)
  }, [listId, toast])

  useEffect(() => {
    void load()
  }, [load])

  // Refetch beim Zurückkehren in die App, wenn der letzte Ladevorgang her ist —
  // der Screen bleibt als Pane gemountet, ein „Betreten" gibt es nicht.
  const lastLoadRef = useRef(0)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastLoadRef.current < 30_000) return
      lastLoadRef.current = Date.now()
      void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  useRealtimeSync({
    listId,
    channelSuffix: ':plan',
    tables: ['trip_proposals', 'trip_votes'],
    onTableChange: () => void load(),
  })

  const fixedCount = useMemo(() => proposals.filter((p) => p.confirmed_at).length, [proposals])

  /** Eingefügter Maps-Link: Koordinaten lesen und einen lesbaren Ortsnamen holen. */
  const handlePlaceChange = (value: string) => {
    setDraftPlace(value)
    if (!isMapsUrl(value)) {
      // Von Hand getippter Name: Koordinaten werden erst beim Speichern gesucht.
      if (placeCoords) setPlaceCoords(null)
      if (placeUrl) setPlaceUrl(null)
      return
    }
    const coords = coordsFromMapsUrl(value)
    if (!coords) {
      // Kurzlink (maps.app.goo.gl): keine Zahlen im Link, Name bleibt Handarbeit.
      toast('Kurzlink erkannt — bitte den Ortsnamen tippen', 'info')
      return
    }
    setPlaceCoords(coords)
    setPlaceUrl(value.trim())
    setPlaceBusy(true)
    void reverseLabel(coords.lat, coords.lon)
      .then((label) => {
        if (label) setDraftPlace(label)
      })
      .finally(() => setPlaceBusy(false))
  }

  const resetDraft = () => {
    setDraft('')
    setDraftNote('')
    setDraftPlace('')
    setPlaceCoords(null)
    setPlaceUrl(null)
    setPlaceBusy(false)
  }

  const handleAdd = async (slot: TripSlot) => {
    const title = draft.trim()
    if (!title) return
    // Ref-Sperre: Doppelklick darf den Insert nicht doppelt abschicken
    if (addingRef.current) return
    addingRef.current = true
    setBusyId(`new-${slot}`)
    try {
      const placeLabel = draftPlace.trim()
      let coords = placeCoords
      if (!coords && placeLabel) {
        // Kein Link, aber ein Name: einmal auflösen, damit auch getippte Orte
        // ein Ziel-Wetter bekommen. Scheitert still (unbekannter Ort).
        coords = (await resolvePlaceCoords(placeLabel, null)).coords
      }
      const { error } = await supabase.from('trip_proposals').insert({
        list_id: listId,
        day: selectedDay,
        slot,
        title,
        note: draftNote.trim() || null,
        place: placeLabel || null,
        place_lat: coords?.lat ?? null,
        place_lon: coords?.lon ?? null,
        place_url: placeUrl,
        created_by: userName,
      })
      if (error) {
        toast(friendlyError(error), 'error')
        return
      }
      navigator.vibrate?.(10)
      resetDraft()
      setAddSlot(null)
      void load()
    } finally {
      addingRef.current = false
      setBusyId(null)
    }
  }

  const handleVote = async (proposal: TripProposal) => {
    // Ref-Sperre: Doppelklick darf nicht zwei Insert/Delete parallel laufen lassen
    if (votingRef.current.has(proposal.id)) return
    votingRef.current.add(proposal.id)
    try {
      const own = votes.find((v) => v.proposal_id === proposal.id && v.voter === userName)
      navigator.vibrate?.(8)
      setBusyId(proposal.id)
      const { error } = own
        ? await supabase.from('trip_votes').delete().eq('id', own.id)
        : await supabase.from('trip_votes').insert({
            list_id: listId,
            proposal_id: proposal.id,
            voter: userName,
          })
      setBusyId(null)
      // 23505 = unique(proposal_id, voter): der eigene Vote war schon gesetzt
      // (verzögertes Realtime/Echo). Ergebnis stimmt, also keinen Fehler zeigen.
      if (error && error.code !== '23505') {
        toast(friendlyError(error), 'error')
        return
      }
      void load()
    } finally {
      votingRef.current.delete(proposal.id)
    }
  }

  const handleConfirm = (proposal: TripProposal) => {
    confirm(`„${proposal.title}“ als Plan übernehmen?`, async () => {
      // Serverseitig in EINER Transaktion (sql/151): erst die alte Bestätigung
      // desselben Slots lösen, dann die neue setzen. Zwei Client-Statements
      // hinterließen bei Abbruch einen Slot ganz ohne Plan und zwei Clients
      // konnten sich gegenseitig überschreiben.
      const { data, error } = await supabase.rpc('confirm_trip_proposal', {
        p_list_id: listId,
        p_proposal_id: proposal.id,
        p_confirmed_by: userName,
      })
      if (error) {
        toast(friendlyError(error), 'error')
        void load()
        return
      }
      const result = data as { error?: string } | null
      if (result?.error) {
        toast(result.error, 'error')
        void load()
        return
      }
      navigator.vibrate?.([10, 40, 10])
      toast('Plan übernommen', 'success')
      void load()
    })
  }

  const handleReopen = (proposal: TripProposal) => {
    confirm(`Plan „${proposal.title}“ wieder freigeben?`, async () => {
      const { error } = await supabase
        .from('trip_proposals')
        .update({ confirmed_at: null, confirmed_by: null })
        .eq('id', proposal.id)
      if (error) {
        toast(friendlyError(error), 'error')
        return
      }
      toast('Abstimmung wieder offen', 'success')
      void load()
    })
  }

  const handleDelete = (proposal: TripProposal) => {
    confirm(`„${proposal.title}“ mit allen Stimmen löschen?`, async () => {
      const { error } = await supabase.from('trip_proposals').delete().eq('id', proposal.id)
      if (error) {
        toast(friendlyError(error), 'error')
        return
      }
      toast('Vorschlag gelöscht', 'success')
      void load()
    })
  }

  const selectedDate = days.find((d) => isoDay(d) === selectedDay) ?? days[0]
  // Plan eines Tages (bestätigt vor Favorit) — Grundlage für den Tagesexport.
  const dayPlanFor = useCallback((iso: string): Partial<Record<TripSlot, TripProposal>> => {
    const out: Partial<Record<TripSlot, TripProposal>> = {}
    for (const slot of SLOTS) {
      const winner = planFor(proposalsFor(proposals, iso, slot.key))
      if (winner) out[slot.key] = winner
    }
    return out
  }, [proposals])
  const proposalTotal = proposals.length

  // Tagesexport: derselbe Plan, auf den ausgewählten Tag gefiltert.
  const exportSelectedDay = () => {
    const events = eventsFromPlan({ [selectedDay]: dayPlanFor(selectedDay) })
    if (events.length === 0) {
      toast('Für diesen Tag ist noch nichts festgelegt.', 'info')
      return
    }
    downloadIcs(
      `fiesta-siesta-${selectedDay}.ics`,
      buildIcs({ calendarName: `Fiesta Siesta · ${formatDayShort(selectedDate)}`, events }),
    )
    navigator.vibrate?.(8)
    toast('Kalenderdatei erstellt', 'success')
  }

  return (
    <div className="plan-screen">
      <header className="list-head">
        <button type="button" className="plan-back" onClick={onBack} aria-label="Zurück zur Reise">
          <ArrowLeft size={18} strokeWidth={2.2} />
        </button>
        <div className="list-head-text">
          <h1>Reiseplan</h1>
          <p>
            {fixedCount} von {days.length * SLOTS.length} Zeiten fest · {proposalTotal}{' '}
            {proposalTotal === 1 ? 'Vorschlag' : 'Vorschläge'}
          </p>
        </div>
        <button
          type="button"
          className="plan-ics-icon"
          aria-label={`Tagesplan ${formatDayShort(selectedDate)} als Kalenderdatei`}
          title="Diesen Tag in den Kalender"
          onClick={exportSelectedDay}
        >
          <CalendarPlus size={17} strokeWidth={2} />
        </button>
      </header>

      <div className="cat-strip plan-days">
        {days.map((day) => {
          const iso = isoDay(day)
          const count = proposals.filter((p) => p.day === iso).length
          return (
            <button
              key={iso}
              type="button"
              className={`cat-chip${iso === selectedDay ? ' active' : ''}`}
              onClick={() => { navigator.vibrate?.(6); setSelectedDay(iso) }}
            >
              {formatDayShort(day)}
              {count > 0 && <span className="plan-day-count">{count}</span>}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="plan-loading" role="status"><Loader2 size={18} className="spin" /> Lädt Vorschläge …</div>
      ) : (
        SLOTS.map((slot) => {
          const list = proposalsFor(proposals, selectedDay, slot.key)
          const fixed = confirmedProposal(list)
          const leader = planFor(list)
          const meta = slotMeta(slot.key)
          return (
            <section className="plan-slot" key={slot.key}>
              <h2 className="plan-slot-title">
                <SlotIcon slot={slot.key} size={12} className="plan-slot-emoji" />
                {meta.label}
                {fixed ? (
                  <span className="plan-slot-plan is-fixed"><Check size={10} strokeWidth={3} /> Bestätigt</span>
                ) : leader ? (
                  <span className="plan-slot-plan">Favorit</span>
                ) : null}
                {fixed ? (
                  <button
                    type="button"
                    className="plan-slot-action"
                    onClick={() => handleReopen(fixed)}
                  >
                    <RotateCcw size={11} strokeWidth={2.2} /> Ändern
                  </button>
                ) : leader ? (
                  <button
                    type="button"
                    className="plan-slot-action"
                    onClick={() => handleConfirm(leader)}
                  >
                    <Check size={11} strokeWidth={2.6} /> Übernehmen
                  </button>
                ) : null}
              </h2>

              {list.length === 0 ? (
                <p className="plan-empty">{meta.hint} — noch kein Vorschlag.</p>
              ) : (
                <div className="plan-rows">
                  {list.map((proposal) => {
                    const mine = proposal.created_by === userName
                    const voted = (proposal.votes ?? []).includes(userName)
                    const isLeader = leader?.id === proposal.id
                    return (
                      <div className={`plan-row${isLeader ? ' is-plan' : ''}`} key={proposal.id}>
                        <div className="plan-row-main">
                          <span className="plan-row-title">{proposal.title}</span>
                          <span className="plan-row-meta">von {proposal.created_by}</span>
                          {proposal.place && (
                            <a
                              className="plan-row-place"
                              href={proposal.place_url ?? mapsUrl(proposal.place)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MapPin size={11} strokeWidth={2.2} />
                              {proposal.place}
                            </a>
                          )}
                          {proposal.note && <span className="plan-row-note">{proposal.note}</span>}
                        </div>
                        {(mine || isAdmin) && (
                          <button
                            type="button"
                            className="plan-mini"
                            onClick={() => handleDelete(proposal)}
                            aria-label="Vorschlag löschen"
                          >
                            <Trash2 size={14} strokeWidth={2} />
                          </button>
                        )}
                        <button
                          type="button"
                          className={`plan-vote${voted ? ' is-voted' : ''}`}
                          onClick={() => handleVote(proposal)}
                          disabled={busyId === proposal.id || Boolean(fixed)}
                          aria-pressed={voted}
                          aria-label={fixed ? 'Abstimmung geschlossen — Plan steht fest' : `Für ${proposal.title} stimmen`}
                        >
                          {busyId === proposal.id
                            ? <Loader2 size={13} className="spin" />
                            : <ThumbsUp size={13} strokeWidth={2.2} />}
                          {voteCount(proposal)}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {addSlot === slot.key ? (
                <div className="plan-form">
                  <input
                    className="plan-input"
                    type="text"
                    placeholder={`Was machen wir ${meta.label.toLowerCase()}?`}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAdd(slot.key)}
                    autoFocus
                  />
                  <input
                    className="plan-input"
                    type="text"
                    placeholder="Ort oder Maps-Link (optional)"
                    value={draftPlace}
                    onChange={(e) => handlePlaceChange(e.target.value)}
                  />
                  {placeBusy && (
                    <span className="plan-coord-hint is-busy">
                      <Loader2 size={11} className="spin" /> Ort wird aufgelöst …
                    </span>
                  )}
                  {!placeBusy && placeCoords && (
                    <span className="plan-coord-hint">
                      <MapPin size={11} strokeWidth={2.2} />
                      Ziel erkannt · {placeCoords.lat.toFixed(4)}, {placeCoords.lon.toFixed(4)}
                    </span>
                  )}
                  <input
                    className="plan-input"
                    type="text"
                    placeholder="Notiz (optional)"
                    value={draftNote}
                    onChange={(e) => setDraftNote(e.target.value)}
                  />
                  <div className="plan-form-actions">
                    <button
                      type="button"
                      className="plan-btn"
                      onClick={() => { setAddSlot(null); resetDraft() }}
                    >
                      Abbrechen
                    </button>
                    <button
                      type="button"
                      className="plan-btn plan-btn-primary"
                      onClick={() => handleAdd(slot.key)}
                      disabled={!draft.trim() || busyId === `new-${slot.key}`}
                    >
                      {busyId === `new-${slot.key}` ? <Loader2 size={14} className="spin" /> : 'Vorschlagen'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="plan-add"
                  onClick={() => { navigator.vibrate?.(6); setAddSlot(slot.key); resetDraft() }}
                >
                  <Plus size={15} strokeWidth={2.2} />
                  Vorschlag
                </button>
              )}
            </section>
          )
        })
      )}

      <p className="plan-footnote">
        <Crown size={12} strokeWidth={2} /> Die meisten Stimmen gewinnen — „Übernehmen“ macht daraus den festen Plan.
      </p>
    </div>
  )
}
