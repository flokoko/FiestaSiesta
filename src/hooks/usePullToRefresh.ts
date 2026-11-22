import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Pull-to-Refresh am oberen Rand.
 *
 * Die Geste greift nur, wenn die Seite ganz oben steht (scrollTop === 0) und
 * der Finger nach unten zieht — vertikales Scrollen hat sonst Vortritt, und
 * eine gescrollte Seite oder aufwärts gerichtete Bewegung bricht die Geste
 * ab (kein Wiederanlauf in derselben Berührung). Der Zug läuft durch ein
 * Gummiband (halbe Fingerstrecke, max. 72 px); ab 58 px löst das Loslassen
 * einen Refresh aus.
 *
 * Rückgabe ist der Gummiband-Zustand (`pull`, `refreshing`, `pulling` für die
 * CSS-Klasse) plus ein Callback-Ref für die Screen-Wurzel — der runde Indikator
 * selbst liegt als eigene Komponente vor (PullIndicator), damit der Hook
 * JSX-frei bleiben kann.
 *
 * Beim Auslösen dreht der Indikator kurz und verschwindet: `refreshing`
 * bleibt an, bis der Refresh durch ist — frühestens nach 650 ms, spätestens
 * nach 4 s (Sicherheitsnetz gegen einen ewigen Spinner).
 */

/** Gummiband: halbe Fingerstrecke, … */
const RUBBER_FACTOR = 0.5
/** … aber nie weiter als dies. */
const MAX_PULL = 72
/** Ab so viel Gummiband-Zug löst das Loslassen aus. */
export const PULL_TRIGGER = 58
/** Sicherheitsnetz: spätestens so lange bleibt `refreshing` an. */
const REFRESH_TIMEOUT_MS = 4000
/** Der Spin soll kurz sichtbar sein, auch bei blinzelschnellen Refreshes. */
const MIN_SPIN_MS = 650

export function usePullToRefresh(onRefresh?: () => Promise<void>) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [pulling, setPulling] = useState(false)
  // Callback-Ref statt Objekt-Ref: der Screen kann seine Wurzel wechseln
  // (Skeleton-Zweig vor dem ersten Datenlauf) — neu binden, sonst lauschen
  // die Listener auf einem toten Element.
  const [hostEl, setHostEl] = useState<HTMLElement | null>(null)
  const setRoot = useCallback((el: HTMLElement | null) => setHostEl(el), [])

  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh
  const refreshingRef = useRef(refreshing)
  refreshingRef.current = refreshing

  useEffect(() => {
    if (!hostEl) return
    let mounted = true
    // Zuggeschichte der laufenden Geste
    let startY: number | null = null
    let engaged = false
    let currentPull = 0

    const finish = () => {
      setRefreshing(false)
      setPull(0)
      currentPull = 0
    }

    const trigger = () => {
      setPull(PULL_TRIGGER) // fester Parkplatz, damit der Spin nicht zappelt
      currentPull = PULL_TRIGGER
      setRefreshing(true)
      const guard = window.setTimeout(finish, REFRESH_TIMEOUT_MS)
      const spinBeat = new Promise<void>((resolve) => {
        window.setTimeout(resolve, MIN_SPIN_MS)
      })
      let result: Promise<unknown> = Promise.resolve()
      try {
        result = Promise.resolve(onRefreshRef.current?.())
      } catch {
        // synchron geworfener Fehler: trotzdem sauber ausblenden
      }
      Promise.allSettled([result, spinBeat]).then(() => {
        window.clearTimeout(guard)
        if (mounted) finish()
      })
    }

    const atTop = () => {
      const sc = document.scrollingElement
      return !sc || sc.scrollTop === 0
    }

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current) return
      if (e.touches.length !== 1 || !atTop()) return
      startY = e.touches[0].clientY
      engaged = false
      currentPull = 0
    }

    const onMove = (e: TouchEvent) => {
      if (startY === null) return
      const dy = e.touches[0].clientY - startY
      if (!engaged) {
        // Nur nach unten und nur ganz oben. Erste Abwärtsbewegung oder
        // gescrollte Seite beendet die Geste (kein Wiederanlauf).
        if (dy <= 0 || !atTop()) {
          startY = null
          return
        }
        if (dy < 4) return // kleine Totzone gegen Finger-Wackeln
        engaged = true
        setPulling(true)
      }
      // Der Browser darf die Geste nicht zusätzlich als Overscroll deuten.
      e.preventDefault()
      currentPull = Math.min(MAX_PULL, Math.round(dy * RUBBER_FACTOR))
      setPull(currentPull)
    }

    const onEnd = () => {
      if (startY === null) return
      setPulling(false)
      if (engaged && currentPull >= PULL_TRIGGER && !refreshingRef.current) {
        trigger()
      } else {
        setPull(0)
        currentPull = 0
      }
      startY = null
      engaged = false
    }

    const onCancel = () => {
      if (startY === null) return
      startY = null
      engaged = false
      currentPull = 0
      setPulling(false)
      setPull(0)
    }

    hostEl.addEventListener('touchstart', onStart, { passive: true })
    // Nicht-passiv: sonst frisst preventDefault nichts und iOS federt doppelt
    // (Browser-Gummiband und eigener Indikator zugleich).
    hostEl.addEventListener('touchmove', onMove, { passive: false })
    hostEl.addEventListener('touchend', onEnd, { passive: true })
    hostEl.addEventListener('touchcancel', onCancel, { passive: true })
    return () => {
      mounted = false
      hostEl.removeEventListener('touchstart', onStart)
      hostEl.removeEventListener('touchmove', onMove)
      hostEl.removeEventListener('touchend', onEnd)
      hostEl.removeEventListener('touchcancel', onCancel)
    }
  }, [hostEl])

  return { ref: setRoot, pull, refreshing, pulling }
}
