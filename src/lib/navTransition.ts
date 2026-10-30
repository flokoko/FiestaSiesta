import type { TabView } from '../types'

/**
 * Tiefe im Navigationsbaum: größer = weiter unten (Unterseite).
 * Bestimmt, ob ein Seitenwechsel vorwärts (von rechts) oder zurück
 * (von links) eingeblendet wird.
 */
const DEPTH: Record<TabView, number> = {
  home: 0,
  trip: 1,
  plan: 2,
  offen: 2,
  lists: 1,
  list: 2,
  bring: 2,
  expenses: 1,
  bristol: 2,
  notes: 2,
  weather: 2,
  settings: 2,
}

/** Reihenfolge der Domänen in der Bottom-Nav — entscheidet bei gleicher Tiefe. */
const ORDER: Record<TabView, number> = {
  home: 0,
  trip: 1,
  lists: 2,
  expenses: 3,
  plan: 1.5,
  offen: 1.6,
  list: 2.5,
  bring: 2.5,
  bristol: 0.5,
  notes: 0.5,
  weather: 0.5,
  settings: 0.5,
}

export type ScreenDirection = 'forward' | 'back' | 'side'

/**
 * Richtung des Übergangs von `from` nach `to`.
 * forward = tiefer/weiter rechts, back = zurück nach oben/links,
 * side = seitlicher Wechsel auf gleicher Ebene (oder gleicher Tab).
 */
export function screenDirection(from: TabView, to: TabView): ScreenDirection {
  if (from === to) return 'side'
  const dFrom = DEPTH[from]
  const dTo = DEPTH[to]
  if (dTo > dFrom) return 'forward'
  if (dTo < dFrom) return 'back'
  return ORDER[to] >= ORDER[from] ? 'forward' : 'back'
}
