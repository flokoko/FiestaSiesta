import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

/**
 * Wischen zum Löschen für Listenzeilen.
 *
 * Die Zeile folgt dem Finger nach links (Gummiband bis -104 px), dahinter
 * zeigt sich die rote Lösch-Unterlage. Loslassen löscht, wenn weit genug
 * (96 px) oder schnell genug (0,5 px/ms) gezogen wurde — sonst federt die
 * Zeile zurück (Feder-Übergang liegt im CSS).
 *
 * Intent-Erkennung entscheidet erst ab ~12 px: nur wenn |dx| > |dy| * 1,2,
 * wird der Zug genommen. Alles andere (vertikales Scrollen, Wischen nach
 * rechts) bricht ab — das Scrollen hat von außen sogar Vortritt, weil der
 * Browser bei vertikalem Zug pointercancel schickt (touch-action: pan-y der
 * Zeile). Rechts-nach-links ist Pflicht: ein positiver dx löst nie aus.
 *
 * Ausschlusszonen (Checkbox, Drag-Handle, Buttons) behalten ihre eigene
 * Geste — dort startet der Wisch gar nicht. Und es darf immer nur EINE
 * Zeile in einer Wisch-Geste stecken (modulweiter Besitz-Slot).
 */

/** So weit folgt die Zeile dem Finger (Gummiband). */
const MAX_PULL = -104
/** Ab so viel gezogener Strecke löscht das Loslassen. */
const DELETE_AT = 96
/** … oder mit mindestens diesem Tempo (px/ms, negativ = nach links). */
const DELETE_VELOCITY = 0.5
/** Horizontale Mindeststrecke, bevor der Intent entschieden wird. */
const INTENT_MIN = 12
/** Intent-Regel: nur wenn |dx| > |dy| * INTENT_RATIO. */
const INTENT_RATIO = 1.2
/** Dauer der Rückfeder (220 ms) plus Puffer, bis die Zeile wieder normal ist. */
const SETTLE_MS = 240
/** Zonen mit eigener Geste: Checkbox, Buttons und beide Drag-Handles. */
const EXCLUDE_SELECTOR = 'button, input, label, .item-drag-handle, .bring-drag-handle'

export interface SwipeDeleteHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void
}

/** Modulweit: es darf immer nur EINE Zeile offen — ein Besitz-Slot pro Geste. */
let openSwipeOwner: number | null = null
let swipeOwnerSeq = 0

export function useSwipeDelete(onDelete: () => void) {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  // `settling` = die Zeile federt gerade zurück (Klasse + Übergang im CSS).
  const [settling, setSettling] = useState(false)

  // Ref-Spiegel: die Geste läuft in Events, ohne Render-Zeiten abzuwarten.
  const onDeleteRef = useRef(onDelete)
  onDeleteRef.current = onDelete

  // null = keine laufende Geste in dieser Zeile.
  const pointerIdRef = useRef<number | null>(null)
  const startXRef = useRef(0)
  const startYRef = useRef(0)
  const lastXRef = useRef(0) // für das Wisch-Tempo beim Loslassen
  const lastTRef = useRef(0)
  const offsetRef = useRef(0)
  const vibratedRef = useRef(false)
  const settlingTimerRef = useRef<number | null>(null)

  // Besitz-Slot: nur wer ihn hält, darf den Zug weiterverfolgen.
  const ownerIdRef = useRef<number | null>(null)
  const activeRef = useRef(false)

  useEffect(
    () => () => {
      if (settlingTimerRef.current !== null) window.clearTimeout(settlingTimerRef.current)
      if (ownerIdRef.current !== null && openSwipeOwner === ownerIdRef.current) openSwipeOwner = null
    },
    [],
  )

  const releaseOwner = useCallback(() => {
    if (ownerIdRef.current !== null && openSwipeOwner === ownerIdRef.current) openSwipeOwner = null
    ownerIdRef.current = null
  }, [])

  /** Geste beenden: mit Rückfeder (unter der Schwelle) oder hart rücksetzen. */
  const endGesture = useCallback(
    (withSettle: boolean) => {
      if (settlingTimerRef.current !== null) {
        window.clearTimeout(settlingTimerRef.current)
        settlingTimerRef.current = null
      }
      activeRef.current = false
      setDragging(false)
      offsetRef.current = 0
      setOffset(0)
      if (withSettle) {
        setSettling(true)
        settlingTimerRef.current = window.setTimeout(() => {
          settlingTimerRef.current = null
          setSettling(false)
        }, SETTLE_MS)
      } else {
        setSettling(false)
      }
      vibratedRef.current = false
      pointerIdRef.current = null
      releaseOwner()
    },
    [releaseOwner],
  )

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    // Ausschlusszonen behalten ihre Geste (Checkbox, Handles, Buttons).
    if ((e.target as HTMLElement | null)?.closest?.(EXCLUDE_SELECTOR)) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    // Laufende Rückfeder dieser Zeile abkürzen — eine neue Geste beginnt.
    if (settlingTimerRef.current !== null) {
      window.clearTimeout(settlingTimerRef.current)
      settlingTimerRef.current = null
      setSettling(false)
    }
    // Der Besitz-Slot wird erst bei der Aktivierung belegt (und der Pointer
    // gefangen): eine Geste, die vorher endet oder den Screen verlässt,
    // darf ihn nicht dauerhaft verstopfen.
    pointerIdRef.current = e.pointerId
    startXRef.current = e.clientX
    startYRef.current = e.clientY
    lastXRef.current = e.clientX
    lastTRef.current = performance.now()
    offsetRef.current = 0
    vibratedRef.current = false
  }, [])

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (pointerIdRef.current === null || e.pointerId !== pointerIdRef.current) return
      const dx = e.clientX - startXRef.current
      const dy = e.clientY - startYRef.current
      if (!activeRef.current) {
        // Erst ab ~12 px entscheiden — davor ist noch nichts verloren.
        if (Math.abs(dx) < INTENT_MIN && Math.abs(dy) < INTENT_MIN) return
        // Intent: nur nach links und deutlich flacher vertikal. Sonst dem
        // vertikalen Scrollen den Vortritt lassen (Abbruch ohne Wiederanlauf).
        if (!(Math.abs(dx) > Math.abs(dy) * INTENT_RATIO && dx < 0)) {
          endGesture(false)
          return
        }
        if (openSwipeOwner !== null) {
          // Eine andere Zeile hält den Slot — nur eine offene Zeile erlaubt.
          endGesture(false)
          return
        }
        activeRef.current = true
        ownerIdRef.current = ++swipeOwnerSeq
        openSwipeOwner = ownerIdRef.current
        setDragging(true)
        // Fangen: ab jetzt gehört der Zug dieser Zeile, auch wenn der Finger
        // seitlich über den Rand hinausgleitet — pointerup/cancel kommen so
        // sicher an, und der Slot wird in jedem Fall wieder frei.
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      }
      // Nur nach links; ein Zurückwischen in der Geste legt die Zeile still.
      const next = Math.max(MAX_PULL, Math.min(0, Math.round(dx)))
      offsetRef.current = next
      lastXRef.current = e.clientX
      lastTRef.current = performance.now()
      setOffset(next)
      // Haptik genau einmal — beim Überschreiten der Lösch-Schwelle.
      if (!vibratedRef.current && next <= -DELETE_AT) {
        vibratedRef.current = true
        navigator.vibrate?.(12)
      }
    },
    [endGesture],
  )

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (pointerIdRef.current === null || e.pointerId !== pointerIdRef.current) return
      ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
      if (!activeRef.current) {
        // Nur angetippt oder vertikal abgebrochen — nichts zu tun.
        endGesture(false)
        return
      }
      const dx = e.clientX - startXRef.current
      const dt = Math.max(1, performance.now() - lastTRef.current)
      // Tempo des letzten Segments: die letzte Bewegung zählt, nicht der Weg.
      const velocity = (e.clientX - lastXRef.current) / dt // px/ms, negativ = links
      const shouldDelete = dx <= -DELETE_AT || (velocity < 0 && -velocity > DELETE_VELOCITY)
      // Falls die Schwelle nur per Tempo übersprungen wurde, jetzt genau
      // einmal Feedback — während des Zugs geschah es schon bei 96 px.
      if (shouldDelete && !vibratedRef.current) navigator.vibrate?.(12)
      if (shouldDelete) onDeleteRef.current()
      // Gelöschte Zeile verschwindet im selben Commit; die gebliebene federt.
      endGesture(!shouldDelete)
    },
    [endGesture],
  )

  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (pointerIdRef.current === null || e.pointerId !== pointerIdRef.current) return
      // Der Browser hat übernommen (Scroll) — keine Löschung, zurückfedern.
      endGesture(activeRef.current)
    },
    [endGesture],
  )

  return {
    offset,
    dragging,
    settling,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } as SwipeDeleteHandlers,
  }
}
