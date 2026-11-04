import { useEffect, useRef } from 'react'
import type { TabView } from '../types'

/** Ein Eintrag im Browser-Verlauf, den diese App selbst gesetzt hat. */
type NavState = { tab: TabView; sheet: 'more' | 'emergency' | null }

/**
 * Tiefe der Screens: 0 = Domäne (Tab), 1 = Unterseite. Ein Wechsel nach oben
 * (Zurück-Pfeil) ersetzt den Verlaufs-Eintrag, statt einen neuen anzulegen —
 * sonst wächst der Verlauf bei jedem Zurück und Android-Zurück springt wieder
 * in den Screen, den man gerade verlassen hat.
 */
export const NAV_DEPTH: Record<TabView, 0 | 1> = {
  home: 0,
  lists: 0,
  expenses: 0,
  list: 1,
  bring: 1,
  plan: 1,
  offen: 1,
  recipes: 1,
  weather: 1,
  settings: 1,
  notes: 1,
  bristol: 1,
}

function readState(): NavState | null {
  const raw = (history.state as { __siesta?: NavState } | null)?.__siesta
  if (!raw || typeof raw.tab !== 'string') return null
  return raw
}

function sameState(a: NavState | null, b: NavState) {
  return !!a && a.tab === b.tab && (a.sheet ?? null) === (b.sheet ?? null)
}

/**
 * Android-Zurück (und der Browser-Zurück-Pfeil) sollen einen Screen zurück
 * gehen, statt die PWA zu schließen.
 *
 * Umsetzung: jeder Nutzer-Wechsel legt einen Verlaufs-Eintrag an; beim
 * `popstate` stellen wir den Zustand aus `event.state` wieder her. Der
 * Abgleich läuft über `history.state` statt über ein „kommt gerade von
 * popstate"-Flag — nach dem Zurückgehen ist der Verlauf schon auf dem Ziel,
 * das nachfolgende Effekt-Push entfällt dadurch von selbst.
 *
 * Sonderfall Sheet: Notizen aus dem Mehr-Blatt heraus öffnen heißt Sheet zu +
 * Tab neu. Statt eines neuen Eintrags (Zurück würde das Blatt wieder öffnen)
 * wird der Sheet-Eintrag ersetzt.
 */
export function useBackNav({
  enabled,
  tab,
  sheet,
  onRestore,
}: {
  enabled: boolean
  tab: TabView
  sheet: 'more' | 'emergency' | null
  onRestore: (state: NavState) => void
}) {
  const depth = NAV_DEPTH[tab]
  // Callback in einer Ref, damit der popstate-Listener nicht bei jedem Render
  // neu registriert wird (sonst geht ein schneller Doppel-Zurück verloren).
  const restoreRef = useRef(onRestore)
  restoreRef.current = onRestore

  // Basis-Eintrag: nur setzen, wenn dieser Verlauf noch keinen App-Zustand trägt.
  useEffect(() => {
    if (!enabled) return
    if (!readState()) history.replaceState({ __siesta: { tab, sheet } }, '')
    // Nur beim Aktivieren (Login) — danach übernimmt der Effekt unten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    const onPop = (event: PopStateEvent) => {
      const next = (event.state as { __siesta?: NavState } | null)?.__siesta
      restoreRef.current(next?.tab ? next : { tab: 'home', sheet: null })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    const next: NavState = { tab, sheet }
    const current = readState()
    if (sameState(current, next)) return
    // Sheet geschlossen (Zurück-Pfeil, Escape, Navigation aus dem Blatt) oder
    // eine Ebene nach oben: Eintrag ersetzen, keinen neuen anlegen.
    const goingUp = current ? depth < NAV_DEPTH[current.tab] : false
    if ((current?.sheet && !next.sheet) || goingUp) history.replaceState({ __siesta: next }, '')
    else history.pushState({ __siesta: next }, '')
  }, [enabled, tab, sheet, depth])
}
