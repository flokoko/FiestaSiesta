import { useEffect, type RefObject } from 'react'

/**
 * Ziehen-zum-Schließen für Blätter (Mehr-Blatt, Notfall-Blatt).
 *
 * Greift nur an Elementen mit `data-sheet-drag` (Griff und Kopfzeile) — sonst
 * würde jedes Wischen im Blatt mit dem Scrollen kollidieren. Die Achse steht
 * nach dem ersten Move über 8 px: die zuerst eingeschlagene Richtung gewinnt
 * und bleibt für diesen Zug.
 *
 * Vertikal: nach unten folgt das Blatt dem Finger, nach oben nur ein Viertel
 * (Gummiband). Geschlossen wird ab 110 px oder 0,6 px/ms, sonst federt es
 * zurück (Feder wie unten).
 * Horizontal: das Blatt geht seitlich bis ±25 % der Breite mit (darüber
 * Gummiband); ab 120 px oder 0,7 px/ms läuft es seitlich heraus (200 ms),
 * sonst federt es zurück.
 *
 * `prefers-reduced-motion` schaltet Feder und Auslauf aus (harter Schnitt,
 * kein Ziehen mit Animation), damit nichts nachruckelt.
 */
export function useSheetDrag(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  enabled: boolean,
) {
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    const AXIS_SLOP = 8     // px, bis zu denen die Achse noch offen ist
    const RUBBER = 0.25     // Dämpfung jenseits des Mitgehens / nach oben
    const V_MAX = 110       // px, ab der ein Zug nach unten schließt
    const V_VEL = 0.6       // px/ms, ab der ein Zug nach unten schließt
    const H_MAX = 120       // px, ab der ein seitlicher Zug schließt
    const H_VEL = 0.7       // px/ms, ab der ein seitlicher Zug schließt
    const SIDE_CAP = 0.25   // max. ±25 % der Blattbreite beim seitlichen Mitgehen
    const SPRING = 'transform 260ms cubic-bezier(0.32, 0.72, 0, 1)'
    const SIDE_EXIT = 'transform 200ms cubic-bezier(0.32, 0.72, 0, 1)'

    let dragging = false
    let pointerId: number | undefined = -1
    let startX = 0
    let startY = 0
    let startTime = 0
    let axis: 'x' | 'y' | null = null
    let dx = 0
    let dy = 0
    let width = 0

    const reset = () => {
      el.style.transition = ''
      el.style.transform = ''
    }

    const onDown = (e: PointerEvent) => {
      if (dragging) return
      const target = e.target as HTMLElement | null
      if (!target?.closest('[data-sheet-drag]')) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      dragging = true
      pointerId = e.pointerId
      startX = e.clientX
      startY = e.clientY
      startTime = performance.now()
      axis = null
      dx = 0
      dy = 0
      // offsetWidth ist im jsdom 0 — ohne Fallback bliebe das Gummiband starr.
      width = el.offsetWidth || 360
      // Kein Fangen des Pointers: ein capture würde Klicks im Blatt schlucken,
      // die Fenster-Listener unten sehen den Zug trotzdem.
      el.style.transition = 'none'
    }

    const onMove = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) return
      dx = e.clientX - startX
      dy = e.clientY - startY
      if (axis === null) {
        // Erst ab 8 px Gesamtbewegung entscheidet die Achse — was zuerst
        // deutlicher war, bleibt für den ganzen Zug.
        if (Math.abs(dx) < AXIS_SLOP && Math.abs(dy) < AXIS_SLOP) return
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      }
      if (axis === 'y') {
        // Nach oben nur ein Viertel mitgehen — das Blatt soll nicht in die Luft.
        const y = dy > 0 ? dy : dy * RUBBER
        el.style.transform = `translateY(${Math.round(y)}px)`
        return
      }
      // Seitlich: ±25 % der Breite mitgehen, darüber Gummiband.
      const cap = width * SIDE_CAP
      const absX = Math.abs(dx)
      const x = absX <= cap ? dx : Math.sign(dx) * (cap + (absX - cap) * RUBBER)
      el.style.transform = `translateX(${Math.round(x)}px)`
    }

    const finish = (e: PointerEvent, cancelled: boolean) => {
      if (!dragging || e.pointerId !== pointerId) return
      dragging = false
      const elapsed = Math.max(1, performance.now() - startTime)

      if (cancelled) {
        // Der Browser hat die Geste gekappt (etwa weil ein Scroll gestartet
        // ist) — auf einem verlorenen Finger niemals schließen, nur federn.
        el.style.transition = SPRING
        el.style.transform = axis === 'x' ? 'translateX(0px)' : 'translateY(0px)'
        window.setTimeout(reset, 280)
        return
      }

      if (axis === 'x') {
        const vx = dx / elapsed
        const shouldClose = Math.abs(dx) > H_MAX || Math.abs(vx) > H_VEL
        if (!shouldClose) {
          el.style.transition = SPRING
          el.style.transform = 'translateX(0px)'
          window.setTimeout(reset, 280)
          return
        }
        if (reduce) {
          reset()
          onClose()
          return
        }
        el.style.transition = SIDE_EXIT
        el.style.transform = `translateX(${dx < 0 ? -105 : 105}%)`
        window.setTimeout(() => {
          reset()
          onClose()
        }, 200)
        return
      }

      // Vertikal — unveränderte Schwellen (110 px / 0,6 px/ms), Feder zurück.
      const velocity = dy / elapsed
      const shouldClose = dy > V_MAX || velocity > V_VEL

      if (reduce) {
        reset()
        if (shouldClose) onClose()
        return
      }

      el.style.transition = SPRING
      if (shouldClose) {
        el.style.transform = 'translateY(110%)'
        window.setTimeout(() => {
          reset()
          onClose()
        }, 200)
      } else {
        el.style.transform = 'translateY(0px)'
        window.setTimeout(reset, 280)
      }
    }

    const onUp = (e: PointerEvent) => finish(e, false)
    const onCancel = (e: PointerEvent) => finish(e, true)

    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      reset()
    }
  }, [ref, onClose, enabled])
}
