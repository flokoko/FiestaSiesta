import {
  Utensils, ShoppingCart, Fuel, Route, Ticket, Umbrella, Waves, Dices,
  Wine, Package, Coffee, BedDouble, Car, Plane, ShoppingBag, Landmark,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * Kategorie-Emojis aus der Datenbank werden im Geld-Bereich nicht angezeigt —
 * dort gilt eine ruhige, iconbasierte Sprache (Splitwise-Vorbild). Das Emoji
 * bleibt in der DB, weil Einkaufsliste und Mitbringen es weiterverwenden.
 */
const MAP: Array<[RegExp, LucideIcon]> = [
  [/restaurant|essen|caf[eé]|frühstück|imbiss/i, Utensils],
  [/supermarkt|grundversorgung|einkauf|lebensmittel/i, ShoppingCart],
  [/benzin|tanken|sprit|diesel/i, Fuel],
  [/maut|autobahn|vignette/i, Route],
  [/aktiv|eintritt|ticket|ausflug|park/i, Ticket],
  [/strand|sonne/i, Umbrella],
  [/pool|schwimm|wasser/i, Waves],
  [/spiel/i, Dices],
  [/alkohol|wein|bier|bar/i, Wine],
  [/hotel|unterkunft|apartment|zimmer/i, BedDouble],
  [/mietwagen|auto|parkplatz/i, Car],
  [/flug|flughafen/i, Plane],
  [/shopping|souvenir|geschenk/i, ShoppingBag],
  [/gebühr|steuer|versicherung/i, Landmark],
  [/kaffee/i, Coffee],
]

export function expenseIcon(categoryName?: string | null): LucideIcon {
  if (!categoryName) return Package
  for (const [re, icon] of MAP) if (re.test(categoryName)) return icon
  return Package
}

/** Farbton pro Kategorie — nur ein sehr leichter Tint, kein buntes Chaos. */
export function expenseTint(categoryName?: string | null): string {
  const name = categoryName ?? ''
  if (/restaurant|essen|caf|frühstück/i.test(name)) return 'var(--tint-rose)'
  if (/supermarkt|einkauf|lebensmittel|grundversorgung/i.test(name)) return 'var(--tint-mint)'
  if (/benzin|maut|auto|mietwagen|flug|parkplatz/i.test(name)) return 'var(--tint-blue)'
  if (/aktiv|ticket|ausflug|strand|pool|spiel/i.test(name)) return 'var(--tint-amber)'
  return 'var(--tint-plum)'
}
