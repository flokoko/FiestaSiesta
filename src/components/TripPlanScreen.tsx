import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, ThumbsUp, Trash2, Loader2, Crown, MapPin, Map as MapIcon, Check, RotateCcw, CalendarPlus, Bell, BellOff, Car, MessageSquare, Send, RefreshCw } from 'lucide-react'
import SlotIcon from './SlotIcon'
import { supabase, getSupabaseUrl } from '../lib/supabase'
import { friendlyError } from '../lib/friendlyError'
import { useToast } from '../context/ToastContext'
import { useRealtimeSync } from '../hooks/useRealtimeSync'
import { SLOTS, isoDay, confirmedProposal, mapsUrl, planFor, proposalsFor, slotMeta, voteCount } from '../lib/tripPlan'
import { tripDays, formatDayShort, tripDay, TRIP } from '../lib/trip'
import { coordsFromMapsUrl, isMapsUrl, reverseLabel, resolvePlaceCoords, type Coords } from '../lib/poiCoords'
import { hasActiveSubscription } from '../lib/push'
import { fetchDriveTime, leadIsTight, quickDriveTime, recommendedLead, type DriveTime } from '../lib/driveTime'
import { DEFAULT_LEAD, LEAD_OPTIONS, SLOT_START, hhmm, readDefaultLead, reminderClock } from '../lib/wake'
import { buildIcs, downloadIcs, eventsFromPlan } from '../lib/ics'
import type { TabView, TripComment, TripProposal, TripSlot, TripVote } from '../types'
import type { TripPlanMap } from '../hooks/useTripPlan'
import './TripPlanScreen.css'

interface TripPlanScreenProps {
  listId: string
  userName: string
  isAdmin: boolean
  /** Gewählter Tag, geteilt mit dem Tag-Screen (ISO) */
  dayIso?: string | null
  onPickDay?: (iso: string) => void
  onNavigate: (tab: TabView) => void
}

function commentClock(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function TripPlanScreen({ listId, userName, isAdmin, dayIso, onPickDay, onNavigate }: TripPlanScreenProps) {
  const { toast, confirm } = useToast()
  const days = useMemo(() => tripDays(), [])
  const [proposals, setProposals] = useState<TripProposal[]>([])
  const [votes, setVotes] = useState<TripVote[]>([])
  // Kommentare hängen am Vorschlag — Begründungen stehen dort, wo entschieden wird.
  const [comments, setComments] = useState<TripComment[]>([])
  const [commentFor, setCommentFor] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [commentSending, setCommentSending] = useState(false)
  // Kalender: Abo-Token der Liste (Edge Function `ics-feed`)
  const [feedToken, setFeedToken] = useState<string | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  // Zwei-Tap-Bestätigung: der erste Tipp schärft, der zweite rotiert.
  const [rotateArmed, setRotateArmed] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [addSlot, setAddSlot] = useState<TripSlot | null>(null)
  const [draft, setDraft] = useState('')
  const [draftNote, setDraftNote] = useState('')
  const [draftPlace, setDraftPlace] = useState('')
  const [placeCoords, setPlaceCoords] = useState<Coords | null>(null)
  const [placeUrl, setPlaceUrl] = useState<string | null>(null)
  const [placeBusy, setPlaceBusy] = useState(false)
  // Wecker: Los-Zeit und Vorlauf im Anlege-Formular, Standard aus den Einstellungen
  const [draftStart, setDraftStart] = useState(SLOT_START.morning)
  const [draftLead, setDraftLead] = useState(() => readDefaultLead())
  // welcher Vorschlag gerade seinen Wecker-Editor offen hat (+ Entwurf)
  const [alarmFor, setAlarmFor] = useState<string | null>(null)
  const [savingAlarmId, setSavingAlarmId] = useState<string | null>(null)
  const alarmSavingRef = useRef(false)
  const placeLookupRef = useRef(0)
  // Ohne Push-Abo klingelt der Wecker nur bei geöffneter App — das muss im
  // Editor stehen, sonst verspricht die Zeile etwas, das nicht kommt.
  const [pushReady, setPushReady] = useState<boolean | null>(null)
  // Fahrzeit vom Ferienhaus: erst die Schätzung, dann die echte Route (OSRM).
  const [editorDrive, setEditorDrive] = useState<DriveTime | null>(null)
  const [formDrive, setFormDrive] = useState<DriveTime | null>(null)

  useEffect(() => {
    let cancelled = false
    void hasActiveSubscription().then((active) => {
      if (!cancelled) setPushReady(active)
    })
    return () => { cancelled = true }
  }, [])
  const [alarmDraft, setAlarmDraft] = useState<{ start: string; lead: number; on: boolean }>(
    { start: SLOT_START.morning, lead: DEFAULT_LEAD, on: true },
  )
  // Der gewählte Tag kommt von außen (App.tsx ↔ Tag-Screen): Plan und
  // Tagesleiste zeigen dadurch immer denselben Tag. Fällt der Prop weg oder
  // liegt er außerhalb der Reise, gilt der Standardtag.
  const defaultDay = (() => {
    const today = tripDay()
    if (today !== null) return isoDay(days[today - 1] ?? days[0])
    return isoDay(days[0])
  })()
  const selectedDay =
    dayIso && days.some((d) => isoDay(d) === dayIso) ? dayIso : defaultDay
  const setSelectedDay = (day: string) => onPickDay?.(day)
  // ── Doppelklick-Sperre je proposal_id: keine parallelen Vote-Inserts/Deletes
  const votingRef = useRef<Set<string>>(new Set())
  // ── Doppelklick-Sperre für „Vorschlagen": Insert darf nicht doppelt feuern
  const addingRef = useRef(false)

  const load = useCallback(async () => {
    const [p, v, c, t] = await Promise.all([
      supabase.from('trip_proposals').select('*').eq('list_id', listId).order('created_at'),
      supabase.from('trip_votes').select('*').eq('list_id', listId),
      supabase.from('trip_comments').select('*').eq('list_id', listId).order('created_at'),
      supabase.from('lists').select('ics_token').eq('id', listId).maybeSingle(),
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
    const token = (t.data as { ics_token?: string } | null)?.ics_token
    if (token) setFeedToken(token)
    if (c.error) {
      // Kommentare sind Beiwerk: ein Fehler hier darf den Plan nicht kippen.
      setComments([])
    } else {
      setComments((c.data ?? []) as TripComment[])
    }
    setProposals(
      ((p.data ?? []) as TripProposal[]).map((row) => ({ ...row, votes: grouped[row.id] ?? [] }))
    )
    setLoading(false)
  }, [listId, toast])

  useEffect(() => {
    void load()
  }, [load])

  // ── Kommentare ─────────────────────────────────────────────────────
  const commentsFor = (proposalId: string) => comments.filter((c) => c.proposal_id === proposalId)

  const toggleComments = (proposalId: string) => {
    navigator.vibrate?.(6)
    setCommentFor((current) => (current === proposalId ? null : proposalId))
    setCommentDraft('')
  }

  const sendComment = async (proposal: TripProposal) => {
    const body = commentDraft.trim()
    if (!body || commentSending) return
    setCommentSending(true)
    const { data, error } = await supabase
      .from('trip_comments')
      .insert({ list_id: listId, proposal_id: proposal.id, author: userName, body })
      .select('*')
      .maybeSingle()
    setCommentSending(false)
    if (error || !data) {
      toast(friendlyError(error ?? { message: 'Kommentar nicht gesendet' }), 'error')
      return
    }
    // Realtime liefert die Zeile gleich noch einmal — der lokale Eintrag macht
    // das Absenden sofort sichtbar und wird beim nächsten load() dedupliziert.
    setComments((prev) => (prev.some((c) => c.id === (data as TripComment).id) ? prev : [...prev, data as TripComment]))
    setCommentDraft('')
    navigator.vibrate?.(8)
  }

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
    tables: ['trip_proposals', 'trip_votes', 'trip_comments'],
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
    // Zwei schnell hintereinander eingefügte Links: nur die Antwort zum ZULETZT
    // eingefügten Link darf Name und Spinner setzen, sonst speichert die Zeile
    // den Namen von Link A mit den Koordinaten von Link B.
    loadDrive(coords.lat, coords.lon, setFormDrive)
    const requestId = ++placeLookupRef.current
    void reverseLabel(coords.lat, coords.lon)
      .then((label) => {
        if (requestId === placeLookupRef.current && label) setDraftPlace(label)
      })
      .finally(() => {
        if (requestId === placeLookupRef.current) setPlaceBusy(false)
      })
  }

  const resetDraft = (start: string = SLOT_START.morning) => {
    setDraftStart(start)
    setDraft('')
    setDraftNote('')
    setDraftPlace('')
    setPlaceCoords(null)
    setPlaceUrl(null)
    setPlaceBusy(false)
    setFormDrive(null)
    setDraftLead(readDefaultLead())
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
        starts_at: `${draftStart || SLOT_START[slot]}:00`,
        remind_before: draftLead,
        // Der Wecker hängt am bestätigten Plan: die Bestätigung schaltet ihn scharf
        // (confirm_trip_proposal), nicht das Anlegen.
        remind_enabled: false,
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

  /** Fokus zurück auf die Glocke, nachdem der Editor geschlossen wurde. */
  const focusBell = (proposalId: string) => {
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(`[data-alarm-bell="${proposalId}"]`)
        ?.focus()
    })
  }

  const closeAlarm = (proposalId: string) => {
    setAlarmFor(null)
    focusBell(proposalId)
  }

  const openAlarm = (proposal: TripProposal) => {
    if (alarmFor === proposal.id) {
      setAlarmFor(null)
      return
    }
    navigator.vibrate?.(6)
    setAlarmDraft({
      start: hhmm(proposal.starts_at) || SLOT_START[proposal.slot],
      lead: proposal.remind_before ?? readDefaultLead(),
      on: proposal.remind_enabled,
    })
    loadDrive(proposal.place_lat, proposal.place_lon, setEditorDrive)
    setAlarmFor(proposal.id)
  }

  /** Schätzung sofort, echte Route nach — still, wenn beides fehlschlägt. */
  const loadDrive = (
    lat: number | null,
    lon: number | null,
    apply: (value: DriveTime | null) => void,
  ) => {
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      apply(null)
      return
    }
    apply(quickDriveTime(lat, lon))
    void fetchDriveTime(lat, lon).then((route) => {
      if (route) apply(route)
    })
  }

  const saveAlarm = async (proposal: TripProposal) => {
    // Ref-Guard: drei Tipps im selben Tick sehen im State alle `false`.
    if (alarmSavingRef.current) return
    alarmSavingRef.current = true
    setSavingAlarmId(proposal.id)
    try {
      // `.select('id')`: ohne Rückgabe meldet PostgREST auch dann Erfolg, wenn
      // die Zeile inzwischen gelöscht wurde.
      const { data: updated, error } = await supabase
        .from('trip_proposals')
        .update({
          starts_at: `${alarmDraft.start}:00`,
          remind_before: alarmDraft.lead,
          remind_enabled: alarmDraft.on,
        })
        .eq('id', proposal.id)
        .select('id')
      if (error) {
        toast(friendlyError(error), 'error')
        return
      }
      if (!updated || updated.length === 0) {
        closeAlarm(proposal.id)
        toast('Diesen Vorschlag gibt es nicht mehr — Liste wird neu geladen', 'error')
        void load()
        return
      }
      navigator.vibrate?.(10)
      closeAlarm(proposal.id)
      toast(
        alarmDraft.on
          ? `Wecker ${reminderClock(alarmDraft.start, alarmDraft.lead)} · ${alarmDraft.start} los`
          : 'Wecker aus',
        'success',
      )
      void load()
    } finally {
      alarmSavingRef.current = false
      setSavingAlarmId(null)
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

  // Ganze Reise als Datei: dieselben Termine wie im Abo, nur ohne Server.
  const exportWholeTrip = () => {
    const map: TripPlanMap = {}
    for (const p of proposals) {
      if (!p.confirmed_at) continue
      map[p.day] = { ...(map[p.day] ?? {}), [p.slot]: p }
    }
    const events = eventsFromPlan(map)
    if (events.length === 0) {
      toast('Noch nichts festgelegt — der Kalender wäre leer.', 'info')
      return
    }
    downloadIcs(
      `fiesta-siesta-${TRIP.start}.ics`,
      buildIcs({ calendarName: `Fiesta Siesta · ${TRIP.name}`, events }),
    )
    navigator.vibrate?.(8)
    toast('Kalenderdatei erstellt', 'success')
  }

  useEffect(() => {
    if (!rotateArmed) return
    const timer = window.setTimeout(() => setRotateArmed(false), 6000)
    return () => window.clearTimeout(timer)
  }, [rotateArmed])

  // Neuer Token: der alte Link antwortet danach mit 404. Nur nach Rückfrage,
  // denn jedes abonnierte Gerät muss neu eingerichtet werden.
  const rotateFeedToken = async () => {
    if (!rotateArmed) {
      setRotateArmed(true)
      navigator.vibrate?.(6)
      return
    }
    setRotating(true)
    const { data, error } = await supabase.rpc('rotate_ics_token', { p_list_id: listId })
    setRotating(false)
    setRotateArmed(false)
    if (error || !data) {
      toast(friendlyError(error ?? { message: 'Link nicht neu erzeugt' }), 'error')
      return
    }
    setFeedToken(data as string)
    navigator.vibrate?.(10)
    toast('Neuer Abo-Link — der alte ist ab jetzt ungültig', 'success')
  }

  // Abo-Link: dieselbe Datei, aber vom Server — Kalender holen sie selbst neu.
  const copyFeedLink = async () => {
    if (!feedToken) return
    const url = `${getSupabaseUrl()}/functions/v1/ics-feed/${feedToken}.ics`
    try {
      await navigator.clipboard.writeText(url)
      toast('Abo-Link kopiert', 'success')
    } catch {
      // Ohne Clipboard-Recht (http, alter Browser) wenigstens zeigen.
      toast(url, 'info')
    }
  }

  return (
    <div className="plan-screen">
      <header className="list-head">
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
          aria-label={`Tageskarte für ${formatDayShort(selectedDate)}`}
          title="Tageskarte: Route und Etappen"
          onClick={() => onNavigate('karte')}
        >
          <MapIcon size={17} strokeWidth={2} />
        </button>
        <button
          type="button"
          className={`plan-ics-icon${calendarOpen ? ' is-open' : ''}`}
          aria-label="Kalender: Datei oder Abo"
          title="Kalender"
          aria-expanded={calendarOpen}
          onClick={() => { navigator.vibrate?.(6); setCalendarOpen((open) => !open) }}
        >
          <CalendarPlus size={17} strokeWidth={2} />
        </button>
      </header>

      {calendarOpen && (
        <div className="plan-calendar">
          <p className="plan-calendar-hint">
            Abo: einmal einrichten, danach zieht der Kalender Änderungen selbst nach.
            Es landen nur <strong>bestätigte</strong> Programmpunkte darin.
          </p>
          <div className="plan-calendar-actions">
            <button type="button" className="plan-btn" onClick={exportSelectedDay}>
              Dieser Tag
            </button>
            <button type="button" className="plan-btn" onClick={exportWholeTrip}>
              Ganze Reise
            </button>
            <button
              type="button"
              className="plan-btn is-primary"
              onClick={() => void copyFeedLink()}
              disabled={!feedToken}
            >
              Abo-Link kopieren
            </button>
          </div>
          <p className="plan-calendar-foot">
            Im Kalender: „Kalender hinzufügen" → „Von URL hinzufügen" → Link einfügen.
          </p>
          <button
            type="button"
            className={`plan-calendar-rotate${rotateArmed ? ' is-armed' : ''}`}
            onClick={() => void rotateFeedToken()}
            disabled={!feedToken || rotating}
          >
            <RefreshCw size={12} strokeWidth={2.2} />
            {rotating
              ? 'Wird erzeugt …'
              : rotateArmed
                ? 'Wirklich? Alter Link wird ungültig'
                : 'Abo-Link neu erzeugen'}
          </button>
        </div>
      )}

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
                      <div
                        className={`plan-row${isLeader ? ' is-plan' : ''}${commentFor === proposal.id ? ' has-comments' : ''}`}
                        key={proposal.id}
                      >
                        <div className="plan-row-main">
                          <span className="plan-row-title">{proposal.title}</span>
                          <span className="plan-row-meta">
                            <span className="plan-row-author">von {proposal.created_by}</span>
                            {proposal.starts_at && (
                              <span className="plan-row-time">{hhmm(proposal.starts_at)}</span>
                            )}
                            {proposal.confirmed_at ? (
                              <button
                                type="button"
                                className={`plan-row-bell${proposal.remind_enabled ? ' is-on' : ''}`}
                                onClick={() => openAlarm(proposal)}
                                aria-expanded={alarmFor === proposal.id}
                                aria-label={
                                  proposal.remind_enabled
                                    ? 'Wecker ändern'
                                    : 'Wecker für diesen Programmpunkt einschalten'
                                }
                                data-alarm-bell={proposal.id}
                              >
                                <Bell size={9} strokeWidth={2.4} />
                                {proposal.remind_enabled && proposal.starts_at
                                  ? reminderClock(proposal.starts_at, proposal.remind_before ?? readDefaultLead())
                                  : 'Wecker'}
                              </button>
                            ) : (
                              <span className="plan-row-bell is-muted">Wecker</span>
                            )}
                          </span>
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
                          className={`plan-mini plan-comment-btn${commentFor === proposal.id ? ' is-open' : ''}`}
                          onClick={() => toggleComments(proposal.id)}
                          aria-expanded={commentFor === proposal.id}
                          aria-label={`Kommentare zu ${proposal.title}${commentsFor(proposal.id).length > 0 ? ` (${commentsFor(proposal.id).length})` : ''}`}
                        >
                          <MessageSquare size={13} strokeWidth={2} />
                          {commentsFor(proposal.id).length > 0 && (
                            <span className="plan-comment-count">{commentsFor(proposal.id).length}</span>
                          )}
                        </button>
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
                        {alarmFor === proposal.id && (
                          <div
                            className="plan-alarm-box"
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.stopPropagation()
                                closeAlarm(proposal.id)
                              }
                            }}
                          >
                            <div className="plan-alarm-row">
                              <label className="plan-wake-time">
                                <span>Los um</span>
                                <input
                                  type="time"
                                  className="plan-input plan-time-input"
                                  value={alarmDraft.start}
                                  onChange={(e) => setAlarmDraft((d) => ({ ...d, start: e.target.value || d.start }))}
                                />
                              </label>
                              <label className="plan-wake-lead">
                                <span>Vorlauf</span>
                                <select
                                  className="plan-input plan-lead-select"
                                  value={alarmDraft.lead}
                                  onChange={(e) => setAlarmDraft((d) => ({ ...d, lead: Number(e.target.value) }))}
                                  disabled={!alarmDraft.on}
                                >
                                  {LEAD_OPTIONS.map((m) => (
                                    <option key={m} value={m}>
                                      {m === 0 ? 'pünktlich' : `${m}m`}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <button
                                type="button"
                                className={`plan-bell${alarmDraft.on ? ' is-on' : ''}`}
                                onClick={() => { navigator.vibrate?.(8); setAlarmDraft((d) => ({ ...d, on: !d.on })) }}
                                aria-pressed={alarmDraft.on}
                                aria-label={alarmDraft.on ? 'Wecker ausschalten' : 'Wecker einschalten'}
                              >
                                {alarmDraft.on
                                  ? <Bell size={15} strokeWidth={2.2} />
                                  : <BellOff size={15} strokeWidth={2.2} />}
                              </button>
                            </div>
                            <div className="plan-alarm-foot">
                              {editorDrive && (
                                <span
                                  className={`plan-drive${leadIsTight(alarmDraft.lead, editorDrive.minutes) ? ' is-tight' : ''}`}
                                >
                                  <Car size={11} strokeWidth={2.2} className="plan-drive-icon" />
                                  <span>
                                    Fahrt ≈ {editorDrive.minutes} Min von Temisas
                                    {editorDrive.source === 'estimate' ? ' · Schätzung' : ''}
                                    {leadIsTight(alarmDraft.lead, editorDrive.minutes)
                                      ? ` — Wecker mindestens ${recommendedLead(editorDrive.minutes)} Min vorher`
                                      : ''}
                                  </span>
                                </span>
                              )}
                              <span className="plan-alarm-hint">
                                {alarmDraft.on
                                  ? `Push um ${reminderClock(alarmDraft.start, alarmDraft.lead)} — Kanaren-Zeit`
                                  : 'Kein Push für diesen Programmpunkt'}
                                {alarmDraft.on && pushReady === false && (
                                  <span className="plan-alarm-warn">
                                    {' '}Ohne Push-Abo klingelt es nur, solange die App offen ist.
                                  </span>
                                )}
                              </span>
                              <button type="button" className="plan-btn" onClick={() => closeAlarm(proposal.id)}>
                                Abbrechen
                              </button>
                              <button
                                type="button"
                                className="plan-btn is-primary"
                                onClick={() => saveAlarm(proposal)}
                                disabled={savingAlarmId === proposal.id}
                              >
                                {savingAlarmId === proposal.id ? 'Speichert …' : 'Speichern'}
                              </button>
                            </div>
                          </div>
                        )}
                        {commentFor === proposal.id && (
                          <div className="plan-comments">
                            {commentsFor(proposal.id).length === 0 ? (
                              <p className="plan-comments-empty">Noch kein Kommentar — schreib, warum.</p>
                            ) : (
                              commentsFor(proposal.id).map((comment) => (
                                <div className="plan-comment" key={comment.id}>
                                  <span className="plan-comment-head">
                                    <strong>{comment.author}</strong>
                                    <span>{commentClock(comment.created_at)}</span>
                                  </span>
                                  <span className="plan-comment-body">{comment.body}</span>
                                </div>
                              ))
                            )}
                            <form
                              className="plan-comment-form"
                              onSubmit={(e) => {
                                e.preventDefault()
                                void sendComment(proposal)
                              }}
                            >
                              <input
                                className="plan-input plan-comment-input"
                                type="text"
                                placeholder="Kommentar …"
                                value={commentDraft}
                                maxLength={500}
                                onChange={(e) => setCommentDraft(e.target.value)}
                                aria-label={`Kommentar zu ${proposal.title}`}
                              />
                              <button
                                type="submit"
                                className="plan-mini plan-comment-send"
                                disabled={commentDraft.trim().length === 0 || commentSending}
                                aria-label="Kommentar senden"
                              >
                                {commentSending
                                  ? <Loader2 size={13} className="spin" />
                                  : <Send size={13} strokeWidth={2} />}
                              </button>
                            </form>
                          </div>
                        )}
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
                  <div className="plan-wake">
                    <label className="plan-wake-time">
                      <span>Los um</span>
                      <input
                        type="time"
                        className="plan-input plan-time-input"
                        value={draftStart}
                        onChange={(e) => setDraftStart(e.target.value || SLOT_START[slot.key])}
                      />
                    </label>
                    <label className="plan-wake-lead">
                      <span>Vorlauf</span>
                      <select
                        className="plan-input plan-lead-select"
                        value={draftLead}
                        onChange={(e) => setDraftLead(Number(e.target.value))}
                      >
                        {LEAD_OPTIONS.map((m) => (
                          <option key={m} value={m}>
                            {m === 0 ? 'pünktlich' : `${m}m`}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <span className="plan-wake-hint">
                    Der Wecker startet, sobald der Punkt als Plan bestätigt ist.
                  </span>
                  {formDrive && (
                    <span
                      className={`plan-drive${leadIsTight(draftLead, formDrive.minutes) ? ' is-tight' : ''}`}
                    >
                      <Car size={11} strokeWidth={2.2} className="plan-drive-icon" />
                      <span>
                        Fahrt ≈ {formDrive.minutes} Min von Temisas
                        {formDrive.source === 'estimate' ? ' · Schätzung' : ''}
                        {leadIsTight(draftLead, formDrive.minutes)
                          ? ` — Vorlauf mindestens ${recommendedLead(formDrive.minutes)} Min`
                          : ''}
                      </span>
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
                  onClick={() => { navigator.vibrate?.(6); setAddSlot(slot.key); resetDraft(SLOT_START[slot.key]) }}
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
