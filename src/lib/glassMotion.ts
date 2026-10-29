/**
 * Glas-Bewegung (v0.18): der Lichtreflex auf den Hero-Karten folgt dem
 * Finger/Zeiger und wandert beim Scrollen leicht mit — plus Scroll-Zustand
 * für Kopfleiste und Navigation.
 *
 * Setzt CSS-Variablen auf <html>:
 *   --gx, --gy  Zeigerposition, normiert auf -1 … 1 (0 = Mitte)
 *   --gsy       vertikaler Scroll-Offset in px
 *
 * Kostenkontrolle (v0.19.1): --gsy wird nur geschrieben, wenn sich der
 * Wert seit dem letzten Schreiben um mehr als GSY_WRITE_THRESHOLD px
 * bewegt hat (jeder Schreibvorgang löst einen Style-Recalc am
 * Wurzelelement aus). data-scrolled toggelt unverändert exakt an der
 * 6-px-Schwelle. Bei verborgenem Dokument (document.hidden) wird nichts
 * geschrieben — der nächste Event nach der Rückkehr holt alles nach.
 *
 * Respektiert prefers-reduced-motion: dann bleiben alle Werte neutral.
 */

/** Mindestdelta in px, bevor --gsy neu auf <html> geschrieben wird */
const GSY_WRITE_THRESHOLD = 24

/** Schwellwert für data-scrolled am <html>-Element */
const SCROLLED_THRESHOLD = 6

let started = false

export function initGlassMotion(): void {
  if (started || typeof window === 'undefined') return
  started = true

  const root = document.documentElement
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

  let gx = 0
  let gy = 0
  let gsy = 0        // aktueller Scrollwert
  let writtenGsy = 0 // zuletzt geschriebener --gsy-Wert
  let writtenGx = 0  // zuletzt geschriebene --gx/--gy-Werte
  let writtenGy = 0
  let frame = 0

  const flush = () => {
    frame = 0
    if (document.hidden) return
    // Schwelle wie bei --gsy: jeder setProperty am Root löst einen Style-Recalc
    // über alle Konsumenten aus. Ohne Schwelle passiert das bis zu 60×/s.
    if (Math.abs(gx - writtenGx) > 0.01) {
      writtenGx = gx
      root.style.setProperty('--gx', gx.toFixed(3))
    }
    if (Math.abs(gy - writtenGy) > 0.01) {
      writtenGy = gy
      root.style.setProperty('--gy', gy.toFixed(3))
    }
    if (Math.abs(gsy - writtenGsy) > GSY_WRITE_THRESHOLD) {
      writtenGsy = gsy
      root.style.setProperty('--gsy', `${Math.round(gsy)}px`)
    }
    if (gsy > SCROLLED_THRESHOLD) root.setAttribute('data-scrolled', 'true')
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
