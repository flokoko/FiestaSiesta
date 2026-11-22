import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/**
 * Wischen zwischen den Küchen-Segmenten (Einkaufsliste ↔ Rezepte).
 *
 * Die Geste startet nur, wenn sie klar horizontal ist (|dx| > |dy| · 1,2):
 * vertikales Scrollen in der Liste hat Vorrang. Ab 8 px Gesamtbewegung steht
 * die Achse fest — danach gehen beide Panels mit dem Finger (bis 38 % der
 * Breite), der Indikator folgt anteilig. Beim Loslassen wechselt das Segment
 * ab 64 px oder 0,4 px/ms, sonst federt alles zurück (260 ms, wie der
 * Indikator-Übergang).
 *
 * Nicht wischen auf Elementen mit eigenen Gesten: die Zeilen tragen ihre
 * eigenen horizontalen Aktionen (Punkt 1), die Chip-Leiste scrollt nativ,
 * Eingabefelder wollen ihre Textauswahl. Nichts startet außerdem auf `.item-row`.
 *
 * `prefers-reduced-motion`: kein Mitziehen — beim Loslassen wechselt das
 * Segment direkt, ohne Übergang.
 */
export type SegmentKey = 'shopping' | 'recipes'

const MAX_FOLLOW = 0.38 // max. ±38 % der Panel-Breite
const SWITCH_DIST = 64  // px, ab der das Loslassen wechselt
const SWITCH_V = 0.4    // px/ms, ab der das Loslassen wechselt
const AXIS_BIAS = 1.2   // „klar horizontal“: |dx| > |dy| · 1,2
const AXIS_SLOP = 8     // px, bis zu denen die Achse noch offen ist
const IND_GAP = 6       // Gap zwischen den beiden Indikator-Positionen (px)
const RUBBER = 0.25     // Dämpfung in der falschen Richtung
const SETTLE_TRANS = 'transform 260ms cubic-bezier(0.32, 0.72, 0, 1)'
const SETTLE_MS = 320   // Übergang 260 ms + Puffer — danach Inline-Styles frei geben
const VETO_SELECTOR = '.item-row, .cat-strip, input, textarea, select'

/**
 * Indikator-Position als Faktor der Einheit „Indikatorbreite + Gap“:
 * 0 = Ruheposition links (Einkaufsliste), 1 = Ruheposition rechts (Rezepte).
 * Das CSS wandert mit translateX(calc(100% + 6px)) — genau diese Einheit.
 */
function indTransform(factor: number): string {
  const px = factor * IND_GAP
  return `translateX(calc(${factor.toFixed(4)} * 100% ${px < 0 ? '-' : '+'} ${Math.abs(px).toFixed(2)}px))`
}

interface Options {
  shoppingRef: RefObject<HTMLElement | null>
  recipesRef: RefObject<HTMLElement | null>
  indicatorRef: RefObject<HTMLElement | null>
  /** Aktives Segment — über Ref gelesen, damit kein Rebind mitten im Ziehen. */
  segment: SegmentKey
  onSegment: (segment: SegmentKey) => void
}

export function useSegmentSwipe({
  shoppingRef, recipesRef, indicatorRef, segment, onSegment,
}: Options) {
  // Neuester Stand ohne Rebind: ein Realtime-Refresh mittendrin darf den
  // laufenden Zug nicht zerreißen (Muster wie onCloseRef in useSheetFocus).
  const latest = useRef({ segment, onSegment })
  latest.current = { segment, onSegment }

  useEffect(() => {
    const shopping = shoppingRef.current
    const recipes = recipesRef.current
    const indicator = indicatorRef.current
    if (!shopping || !recipes || !indicator) return

    const screen = shopping.parentElement // .kueche-screen — nur für cursor/user-select
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    let pending: { pid: number; x: number; y: number; t: number } | null = null
    let drag: { pid: number; base: SegmentKey; width: number } | null = null
    let dx = 0       // roher Zeiger-Abstand seit dem Aufsetzen (unkorrigiert)
    let followX = 0  // gedämpfter/geklemmter Mitzieh-Wert vom letzten Move
    let suppressClick = false
    let settleTimer = 0

    // Alle Inline-Styles freigeben — die Ruhe-Definitionen liegen im CSS.
    const clearStyles = () => {
      for (const el of [shopping, recipes]) {
        el.style.transition = ''
        el.style.transform = ''
      }
      indicator.style.transition = ''
      indicator.style.transform = ''
    }

    const onDown = (e: PointerEvent) => {
      if (drag) return // ein Finger pro Zug
      const target = e.target as HTMLElement | null
      if (!target || target.closest(VETO_SELECTOR)) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      window.clearTimeout(settleTimer)
      // Ein laufendes Zurückfedern endet hart auf null — sonst startet der
      // neue Zug von einem Zwischenwert mit falschem Ursprung.
      for (const el of [shopping, recipes]) {
        el.style.transition = 'none'
        el.style.transform = ''
      }
      indicator.style.transition = 'none'
      indicator.style.transform = ''
      suppressClick = false
      pending = {
        pid: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        t: performance.now(),
      }
    }

    const onMove = (e: PointerEvent) => {
      if (!pending) return
      if (e.pointerId !== pending.pid) return
      if (!drag) {
        const dx0 = e.clientX - pending.x
        const dy0 = e.clientY - pending.y
        if (Math.abs(dx0) < AXIS_SLOP && Math.abs(dy0) < AXIS_SLOP) return
        if (Math.abs(dx0) <= Math.abs(dy0) * AXIS_BIAS) {
          pending = null // vertikal gewinnt — die Liste scrollt nativ weiter
          return
        }
        drag = {
          pid: e.pointerId,
          base: latest.current.segment,
          width: shopping.getBoundingClientRect().width || shopping.offsetWidth || 360,
        }
        // Maus-Zug soll nicht Text unter den Panes markieren.
        screen?.classList.add('is-seg-dragging')
      }
      dx = e.clientX - pending.x
      const cap = drag.width * MAX_FOLLOW
      const valid =
        (drag.base === 'shopping' && dx < 0) || (drag.base === 'recipes' && dx > 0)
      followX = valid
        ? Math.min(Math.abs(dx), cap) * (dx < 0 ? -1 : 1)
        // Falsche Richtung: nur Gummiband — dahinter ist kein Segment.
        : dx * RUBBER
      if (reduce) return // kein Mitziehen — nur die Wechsel-Entscheidung zählt
      for (const el of [shopping, recipes]) {
        el.style.transition = 'none'
        el.style.transform = `translateX(${Math.round(followX)}px)`
      }
      // Indikator anteilig: Faktor der Einheit von der Ruheposition aus
      // (shopping 0 → 1 nach rechts; recipes 1 → 0 nach links).
      indicator.style.transition = 'none'
      indicator.style.transform = indTransform(
        drag.base === 'shopping' ? -followX / cap : 1 - followX / cap,
      )
    }

    const release = (e: PointerEvent, cancelled: boolean) => {
      if (!drag) {
        pending = null
        return
      }
      if (e.pointerId !== drag.pid) return
      const startT = pending?.t ?? 0
      const base = drag.base
      const dragWidth = drag.width // vor dem Nullen sichern (TS-Narrowing, Klarheit)
      drag = null
      pending = null
      screen?.classList.remove('is-seg-dragging')
      suppressClick = true // der Zug ist zu Ende — unter ihm darf kein Klick auslösen
      const elapsed = Math.max(1, performance.now() - startT)
      const velocity = dx / elapsed
      const valid =
        (base === 'shopping' && dx < 0) || (base === 'recipes' && dx > 0)
      const target: SegmentKey | null =
        cancelled || !valid
          ? null
          : Math.abs(dx) >= SWITCH_DIST || Math.abs(velocity) > SWITCH_V
            ? (base === 'shopping' ? 'recipes' : 'shopping')
            : null

      // Reduzierte Bewegung: harter Schnitt — direkter Wechsel, kein Ziehen.
      if (reduce) {
        if (target) {
          navigator.vibrate?.(6)
          latest.current.onSegment(target)
        }
        return
      }

      if (target) {
        navigator.vibrate?.(6)
        // Ziel-Pane steht schon an den Finger gezogen bereit, BEVOR das Segment
        // umschaltet: es erscheint an der gezogenen Position und gleitet zu Ende.
        const incoming = target === 'recipes' ? recipes : shopping
        const side = dx < 0 ? dragWidth : -dragWidth
        incoming.style.transition = 'none'
        incoming.style.transform = `translateX(${Math.round(side + followX)}px)`
        void incoming.offsetWidth // Layout erzwingen, sonst springt der Übergang an
        incoming.style.transition = SETTLE_TRANS
        incoming.style.transform = 'translateX(0px)'
        // Der Indikator nutzt seinen CSS-Übergang von der gezogenen Position
        // in die neue Ruheposition.
        indicator.style.transition = ''
        indicator.style.transform = indTransform(target === 'recipes' ? 1 : 0)
        latest.current.onSegment(target)
      } else {
        // Zurückfedern: beide Panes und der Indikator in die Ruheposition.
        for (const el of [shopping, recipes]) {
          el.style.transition = SETTLE_TRANS
          el.style.transform = 'translateX(0px)'
        }
        indicator.style.transition = ''
        indicator.style.transform = indTransform(base === 'recipes' ? 1 : 0)
      }
      settleTimer = window.setTimeout(clearStyles, SETTLE_MS)
    }

    const onUp = (e: PointerEvent) => release(e, false)
    const onCancel = (e: PointerEvent) => release(e, true)

    // Der gezogene Finger darf beim Loslassen nie einen Klick darunter auslösen
    // (Rezept-Karten, Zeilen) — einmalig abgekappt in der Capture-Phase.
    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClick) return
      suppressClick = false
      e.preventDefault()
      e.stopPropagation()
    }

    shopping.addEventListener('pointerdown', onDown)
    recipes.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('click', onClickCapture, true)
    return () => {
      shopping.removeEventListener('pointerdown', onDown)
      recipes.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('click', onClickCapture, true)
      window.clearTimeout(settleTimer)
      screen?.classList.remove('is-seg-dragging')
      clearStyles()
    }
  }, [shoppingRef, recipesRef, indicatorRef])
}
