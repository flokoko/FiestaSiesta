import { useCallback, useEffect, useRef, useState } from 'react'

interface IndicatorBox {
  left: number
  width: number
}

/**
 * Gleitender Hintergrund für eine Chip-Leiste (Kategorien, Reisetage).
 *
 * Die Leiste ist horizontal scrollbar und die Chips sind unterschiedlich breit —
 * deshalb wird die Box des aktiven Chips **gemessen** (offsetLeft/offsetWidth)
 * und über eine CSS-Variable an den Indikator gegeben. Neu gemessen wird bei:
 * Wechsel (`dep`), Scrollen (sonst löst sich der Indikator beim Wischen),
 * Ändern der Leistenbreite und nach dem ersten Layout.
 *
 * Rückgabe: `ref` für den Container, `style` für `<span className="chip-ind">`.
 * Ohne Treffer bleibt `style` leer — der Indikator wird dann nicht gerendert.
 */
export function useSlidingIndicator<T extends HTMLElement = HTMLDivElement>(
  dep: unknown,
  selector = '.cat-chip.active',
) {
  const ref = useRef<T | null>(null)
  const [box, setBox] = useState<IndicatorBox | null>(null)

  const measure = useCallback(() => {
    const container = ref.current
    if (!container) return
    const el = container.querySelector<HTMLElement>(selector)
    if (!el) {
      setBox(null)
      return
    }
    setBox((prev) =>
      prev && Math.abs(prev.left - el.offsetLeft) < 0.5 && Math.abs(prev.width - el.offsetWidth) < 0.5
        ? prev
        : { left: el.offsetLeft, width: el.offsetWidth },
    )
  }, [selector])

  useEffect(() => {
    measure()
    // Nach dem ersten Frame nochmal: Schriften/Layout können die Breite ändern.
    const raf = requestAnimationFrame(measure)
    const container = ref.current
    const ro = container && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (container && ro) ro.observe(container)
    container?.addEventListener('scroll', measure, { passive: true })

    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
      container?.removeEventListener('scroll', measure)
    }
  }, [measure, dep])

  return { ref, box }
}
