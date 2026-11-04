import type { TabView } from '../types'

/**
 * Tiefe im Navigationsbaum: größer = weiter unten (Unterseite).
 * Bestimmt, ob ein Seitenwechsel vorwärts (von rechts) oder zurück
 * (von links) eingeblendet wird.
 */
const DEPTH: Record<TabView, number> = {
  home: 0,
  lists: 0,
  expenses: 0,
  plan: 1,
  offen: 1,
  karte: 1,
  recipes: 1,
  list: 1,
  bring: 1,
  bristol: 1,
  notes: 1,
  weather: 1,
  settings: 1,
}

/** Reihenfolge der Domänen in der Bottom-Nav — entscheidet bei gleicher Tiefe. */
const ORDER: Record<TabView, number> = {
  home: 0,
  lists: 1,
  expenses: 2,
  plan: 0.5,
  offen: 0.6,
  karte: 0.65,
  recipes: 0.7,
  list: 1.5,
  bring: 1.5,
  bristol: 0.4,
  notes: 0.4,
  weather: 0.4,
  settings: 0.4,
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
