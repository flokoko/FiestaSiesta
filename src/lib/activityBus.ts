// ── Activity-Bus ───────────────────────────────────────────────────
// Zentraler Publisher für „etwas ist passiert"-Meldungen (onActivity).
// Wird von Add-Formularen (AddItemForm, ExpenseForm) und von useListData
// (Toggle / Realtime) benutzt, um Meldungen zu feuern — seit Entfernung des
// Dashboard-Bands rendern die Meldungen nirgends, der Mechanismus bleibt
// aber bestehen.
//
// Zusätzlich: "eigene Aktion"-Marker zur Echo-Unterdrückung. Wenn eine
// Komponente eine Aktion lokal feuert, markiert sie den Schlüssel. Der
// Realtime-Handler konsumiert denselben Schlüssel und überspringt das Echo
// (sonst würde die eigene Aktion im Realtime-Stream fälschlich als fremde
// Änderung behandelt).

type Listener = (msg: string) => void

let listener: Listener | null = null

// ── Own-Action marker (Echo-Suppression) ──────────────────────────────
interface OwnMarker {
  key: string
  at: number
}
let ownAction: OwnMarker | null = null

const ECHO_WINDOW_MS = 3000

/** Registriert den Activity-Listener (genau einer, zuletzt gewinnt). */
export function subscribeActivity(fn: Listener): () => void {
  listener = fn
  return () => {
    if (listener === fn) listener = null
  }
}

/** Feuert eine Activity-Meldung an den aktuellen Listener. */
export function publishActivity(msg: string): void {
  listener?.(msg)
}

/**
 * Markiert eine Aktion, die lokal ausgeführt wurde (eigener Client).
 * Der Schlüssel sollte so aufgebaut sein, dass der Realtime-Handler ihn
 * exakt reproduzieren kann, z.B. `items:${name}`.
 */
export function markOwnAction(key: string): void {
  ownAction = { key, at: Date.now() }
}

/**
 * Prüft, ob eine lokal ausgeführte Aktion mit diesem Schlüssel im
 * Echo-Fenster liegt. Wenn ja: konsumiert sie (löscht Marker) und gibt
 * true zurück — der Realtime-Handler soll das Echo dann überspringen.
 */
export function consumeOwnAction(key: string): boolean {
  const own = ownAction
  if (!own) return false
  if (own.key !== key || Date.now() - own.at > ECHO_WINDOW_MS) {
    return false
  }
  ownAction = null
  return true
}