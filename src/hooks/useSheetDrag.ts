import { useEffect, type RefObject } from 'react'

/**
 * Ziehen-zum-Schließen für Blätter (Mehr, Notfall).
 *
 * Greift nur an Elementen mit `data-sheet-drag` (Griff und Kopfzeile) — sonst
 * würde jedes Wischen im Blatt mit dem Scrollen kollidieren. Nach unten folgt
 * das Blatt dem Finger, nach oben stark gedämpft (Gummiband). Beim Loslassen
 * schließt es, wenn es weit genug (110 px) oder schnell genug (0,6 px/ms)
 * gezogen wurde, sonst federt es zurück.
 *
 * `prefers-reduced-motion` schaltet die Feder aus (harter Schnitt, kein Ziehen
 * mit Animation), damit nichts nachruckelt.
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

    let dragging = false
    let startY = 0
    let startTime = 0
    let dy = 0

    const reset = () => {
      el.style.transition = ''
      el.style.transform = ''
    }

    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      if (!target?.closest('[data-sheet-drag]')) return
      if (e.button !== undefined && e.pointerType === 'mouse' && e.button !== 0) return
      dragging = true
      startY = e.clientY
      startTime = performance.now()
      dy = 0
      // Kein Fangen des Pointers: ein capture würde Klicks im Blatt schlucken,
      // die Fenster-Listener unten sehen den Zug trotzdem.
      el.style.transition = 'none'
    }

    const onMove = (e: PointerEvent) => {
      if (!dragging) return
      dy = e.clientY - startY
      // Nach oben nur ein Viertel mitgehen — das Blatt soll nicht in die Luft.
      const y = dy > 0 ? dy : dy * 0.25
      el.style.transform = `translateY(${Math.round(y)}px)`
    }

    const onUp = () => {
      if (!dragging) return
      dragging = false
      const elapsed = Math.max(1, performance.now() - startTime)
      const velocity = dy / elapsed
      const shouldClose = dy > 110 || velocity > 0.6

      if (reduce) {
        reset()
        if (shouldClose) onClose()
        return
      }

      el.style.transition = 'transform 260ms cubic-bezier(0.32, 0.72, 0, 1)'
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

    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      reset()
    }
  }, [ref, onClose, enabled])
}
