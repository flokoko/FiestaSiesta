import { flushSync } from 'react-dom'

/**
 * View Transitions API als Wrapper um alle Screen-Wechsel (Punkt 2).
 *
 * Warum gekapselt: `document.startViewTransition` friert die Seite visuell ein,
 * bis das DOM-Update gerendert ist. Ohne API-Unterstützung (Firefox, ältere
 * WebViews), mit `prefers-reduced-motion: reduce`, bei einem parallel laufenden
 * Übergang oder bei einem Fehler darf die App sich exakt wie bisher verhalten —
 * deshalb fällt alles hier auf `update()` zurück und es wird nie nach außen
 * geworfen.
 */

export interface ViewTransitionOptions {
  /**
   * Shared-Element-Name. Wird als `data-vt` am `<html>` gesetzt, damit das CSS
   * die Kupplung (Hub-Kachel → Ziel-Kopf) NUR für die Dauer des Übergangs
   * verdrahten kann — `view-transition-name` darf im DOM nicht doppelt vorkommen,
   * ein dauerhafter Name würde jeden anderen Screen-Wechsel brechen.
   */
  sharedName?: string
  /**
   * Richtung des Wechsels — steuert über `data-vt-dir` am `<html>` die
   * Root-Keyframes (vorwärts: von rechts; zurück: von links; side: Überblende).
   */
  direction?: 'forward' | 'back' | 'side'
}

/**
 * Zeitlimit für einen Übergang. `ready` kann hängen (Namens-Konflikt, Tab im
 * Hintergrund, WebView-Quirk) — dann bliebe das alte Bild stehen und die App
 * wäre blockiert, wenn niemand abbricht.
 */
const VT_TIMEOUT_MS = 600

/** True, wenn der Browser Screen-Wechsel über die API animieren kann. */
export function supportsViewTransitions(): boolean {
  return typeof document !== 'undefined' && typeof document.startViewTransition === 'function'
}

// Eine Übergangs-Instanz pro Mal: ein zweiter Aufruf während eines laufenden
// Übergangs stapelt die Animationen und ließe die Marker falsch löschen.
let transitionRunning = false

export function withViewTransition(update: () => void, opts: ViewTransitionOptions = {}): void {
  // Bewegung reduziert: gar kein Übergang, sofortiges Update.
  if (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    update()
    return
  }
  // Ohne API (Firefox, ältere WebViews) exakt das alte Verhalten — die
  // bestehenden Pane-Animationen aus design.css laufen unverändert weiter.
  if (!supportsViewTransitions()) {
    update()
    return
  }
  // Doppel-Tap während eines laufenden Übergangs: einfach wechseln, ohne
  // die laufende Animation zu überlagern.
  if (transitionRunning) {
    update()
    return
  }

  const html = document.documentElement
  const { sharedName, direction } = opts
  // Marker nur löschen, wenn keine nachgelagerte Navigation sie wieder
  // überschrieben hat (finished läuft auch dann, wenn neue Marker stehen).
  const clearMarkers = () => {
    if (!sharedName || html.dataset.vt === sharedName) delete html.dataset.vt
    if (!direction || html.dataset.vtDir === direction) delete html.dataset.vtDir
  }

  transitionRunning = true
  try {
    // Marker VOR dem Start setzen: der Browser macht zwei Schnappschüsse — den
    // alten (jetzt) und den neuen (nach dem Update-Callback) — und beide müssen
    // die Namen bereits sehen, sonst morpht nichts.
    html.dataset.vtDir = direction ?? 'side'
    if (sharedName) html.dataset.vt = sharedName
    const transition = document.startViewTransition(() => {
      // flushSync bündelt die State-Updates zu einem synchronen Commit — erst
      // danach darf der Browser den neuen Zustand ablichten (sonst steht im
      // „neuen“ Schnappschuss noch der alte Screen).
      flushSync(update)
    })
    // Sicherheitsnetz: hängt der Übergang, nach 600 ms hart abbrechen.
    const guard = window.setTimeout(() => transition.skipTransition(), VT_TIMEOUT_MS)
    void transition.finished
      .finally(() => {
        window.clearTimeout(guard)
        clearMarkers()
        transitionRunning = false
      })
      // skipTransition und überlagerte Übergänge enden als Rejection —
      // bewusst stumm, es gibt nichts zu melden.
      .catch(() => {})
  } catch {
    // startViewTransition kann sofort scheitern (WebView ohne Vollsupport,
    // versteckte Seite): sauber ohne Übergang weitermachen.
    clearMarkers()
    transitionRunning = false
    update()
  }
}
