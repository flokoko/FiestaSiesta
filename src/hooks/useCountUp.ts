import { useEffect, useRef, useState } from 'react'

/**
 * Zählt eine Zahl beim Ändern weich auf den neuen Wert (statt zu springen).
 *
 * - Erster Render zeigt sofort den Zielwert — niemand will beim Öffnen der App
 *   eine Null, die hochzählt.
 * - `prefers-reduced-motion: reduce` springt direkt.
 * - Der Rückgabewert ist ein Float; die Anzeige rundet selbst.
 */
export function useCountUp(target: number, duration = 420): number {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const from = fromRef.current
    if (from === target) return

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce || duration <= 0) {
      fromRef.current = target
      setValue(target)
      return
    }

    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(from + (target - from) * eased)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
        setValue(target)
        rafRef.current = null
      }
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      // Ziel merken, damit ein abgebrochener Lauf beim nächsten Wert nicht
      // beim alten Stand weiterzählt.
      fromRef.current = target
    }
  }, [target, duration])

  return value
}
