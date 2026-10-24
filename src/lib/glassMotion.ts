/**
 * Glas-Bewegung (v0.18): der Lichtreflex auf den Hero-Karten folgt dem
 * Finger/Zeiger und wandert beim Scrollen leicht mit — plus Scroll-Zustand
 * für Kopfleiste und Navigation.
 *
 * Setzt CSS-Variablen auf <html>:
 *   --gx, --gy  Zeigerposition, normiert auf -1 … 1 (0 = Mitte)
 *   --gsy       vertikaler Scroll-Offset in px
 *
 * Respektiert prefers-reduced-motion: dann bleiben alle Werte neutral.
 */

let started = false

export function initGlassMotion(): void {
  if (started || typeof window === 'undefined') return
  started = true

  const root = document.documentElement
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

  let gx = 0
  let gy = 0
  let gsy = 0
  let frame = 0

  const flush = () => {
    frame = 0
    root.style.setProperty('--gx', gx.toFixed(3))
    root.style.setProperty('--gy', gy.toFixed(3))
    root.style.setProperty('--gsy', `${Math.round(gsy)}px`)
    if (gsy > 6) root.setAttribute('data-scrolled', 'true')
    else root.removeAttribute('data-scrolled')
  }

  const schedule = () => {
    if (frame) return
    frame = window.requestAnimationFrame(flush)
  }

  const onPointer = (event: PointerEvent) => {
    if (reduced.matches) return
    const w = window.innerWidth || 1
    const h = window.innerHeight || 1
    gx = Math.max(-1, Math.min(1, (event.clientX / w) * 2 - 1))
    gy = Math.max(-1, Math.min(1, (event.clientY / h) * 2 - 1))
    schedule()
  }

  const onScroll = () => {
    gsy = window.scrollY || 0
    schedule()
  }

  const reset = () => {
    if (reduced.matches) return
    gx = 0
    gy = 0
    schedule()
  }

  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('pointermove', onPointer, { passive: true })
  window.addEventListener('pointerleave', reset, { passive: true })
  window.addEventListener('pointercancel', reset, { passive: true })

  flush()
}
