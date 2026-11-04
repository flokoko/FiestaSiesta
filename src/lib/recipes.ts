// ── Rezepte für die Ferienküche ──────────────────────────────────────
// Die Zutaten liegen als strukturierte Liste am Rezept, nicht als Freitext:
// nur so kann ein Rezept die Einkaufsliste füllen.
//
// Eingabe bleibt einfach — eine Zutat pro Zeile, wie man sie aufschreibt:
//   "500 g Kartoffeln", "2 Zwiebeln", "1 Bund Petersilie", "Salz"

export interface RecipeIngredient {
  /** Anzeigename ohne Menge, z. B. "Kartoffeln" */
  name: string
  /** Menge als Text, z. B. "500" oder "1/2" — leer bei "Salz" */
  qty: string
  /** Einheit, z. B. "g" — leer bei Stückzahlen */
  unit: string
  /** Kategorie der Einkaufsliste */
  category: string
}

const UNITS = [
  'g', 'kg', 'ml', 'l', 'cl', 'dl',
  'tl', 'el', 'tsp', 'tbsp', 'prise', 'prisen', 'bund', 'dose', 'dosen',
  'packung', 'päckchen', 'pkg', 'stück', 'stk', 'scheibe', 'scheiben',
  'zehe', 'zehen', 'becher', 'glas', 'flasche', 'beutel', 'tüte',
]

/** Kategorien der Einkaufsliste (list_type = 'shopping'). */
export const SHOP_CATEGORIES = [
  'Obst', 'Gemüse & Kräuter', 'Fleisch & Fisch', 'Milchprodukte',
  'Brot & Backwaren', 'Alkohol', 'Sonstiges',
] as const

const CATEGORY_HINTS: Array<[string, RegExp]> = [
  // Zuerst die Ausnahmen, die sonst von einem Inhaltswort gefangen würden:
  // "Olivenöl" ist kein Gemüse, "Salz" kein Milchprodukt.
  ['Sonstiges', /\b(öl|oel|essig|sauce|soße|salz|pfeffer|zucker|reis|nudeln|pasta|kichererbsen|dose|dosen)/i],
  ['Fleisch & Fisch', /\b(fleisch|hack|hühner?|hähnchen|pollo|pute|schwein|rind|kalb|lamm|chorizo|jamon|jamón|schinken|speck|wurst|salami|fisch|thunfisch|gambas|garnelen|shrimps|lachs|sardine|forelle|kabeljau|muschel)/i],
  ['Milchprodukte', /\b(milch|butter|käse|kaese|queso|sahne|schmand|crème|creme fraiche|joghurt|jogurt|quark|eier?|ei|mozzarella|parmesan|feta|gouda|manchego|mascarpone|hüttenkäse)/i],
  ['Gemüse & Kräuter', /\b(tomaten?|zwiebeln?|knoblauch|kartoffeln?|paprika|gurke|salat|zucchini|aubergine|karotten?|möhren?|lauch|porree|spinat|pilze?|champignons?|petersilie|koriander|basilikum|thymian|rosmarin|oregano|kräuter|oliven|mais|bohnen|erbsen|avocado|sellerie|fenchel|ingwer|chili|frühlingszwiebeln?)/i],
  ['Obst', /\b(äpfel?|apfel|bananen?|orangen?|zitronen?|limetten?|trauben?|melone|mango|pfirsich|birnen?|beeren?|erdbeeren?|himbeeren?|blaubeeren?|ananas|feigen?)/i],
  ['Brot & Backwaren', /\b(brot|brötchen|baguette|toast|mehl|hefe|backpulver|kuchen|kekse|ciabatta|brioche)/i],
  ['Alkohol', /\b(wein|bier|rum|vodka|wodka|sekt|likör|cava|vermouth|gin|whisky|sangria)/i],
]

/** Kategorie aus dem Zutatennamen raten — leerer Treffer landet in "Sonstiges". */
export function guessCategory(name: string): string {
  for (const [category, pattern] of CATEGORY_HINTS) {
    if (pattern.test(name)) return category
  }
  return 'Sonstiges'
}

/**
 * Eine Zeile → Zutat. Erkennt "500 g Kartoffeln", "2 Zwiebeln", "1/2 Zitrone",
 * "1 Bund Petersilie" und "Salz". Was nicht passt, wird komplett zum Namen.
 */
export function parseIngredientLine(line: string): RecipeIngredient | null {
  const raw = line.trim().replace(/^[-•*]\s*/, '')
  if (!raw) return null

  const match = raw.match(
    /^(\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?)\s*([A-Za-zÄÖÜäöüß.]{0,12})?\s*(.*)$/,
  )
  if (!match) {
    return { name: raw, qty: '', unit: '', category: guessCategory(raw) }
  }

  const [, qty, maybeUnit = '', rest = ''] = match
  const unit = maybeUnit.toLowerCase().replace(/\.$/, '')
  const isUnit = UNITS.includes(unit)
  const name = (isUnit ? rest : `${maybeUnit} ${rest}`).trim() || raw

  return {
    name: name.charAt(0).toUpperCase() + name.slice(1),
    qty: qty.replace(/\s+/g, ''),
    unit: isUnit ? unit : '',
    category: guessCategory(name),
  }
}

/** Mehrzeiliger Text → Zutatenliste (leere Zeilen fallen raus). */
export function parseIngredients(text: string): RecipeIngredient[] {
  return text
    .split(/\r?\n/)
    .map(parseIngredientLine)
    .filter((entry): entry is RecipeIngredient => entry !== null)
}

/** Gebinde werden groß geschrieben ("1 Bund", "1 TL"), Metrisches bleibt klein. */
const DISPLAY_UNITS: Record<string, string> = {
  tl: 'TL', el: 'EL', tsp: 'TL', tbsp: 'EL',
  bund: 'Bund', dose: 'Dose', dosen: 'Dosen', packung: 'Packung', 'päckchen': 'Päckchen',
  pkg: 'Pkg', 'stück': 'Stück', stk: 'Stk', scheibe: 'Scheibe', scheiben: 'Scheiben',
  zehe: 'Zehe', zehen: 'Zehen', becher: 'Becher', glas: 'Glas', flasche: 'Flasche',
  beutel: 'Beutel', 'tüte': 'Tüte', prise: 'Prise', prisen: 'Prisen',
}

export function unitLabel(unit: string): string {
  return DISPLAY_UNITS[unit.toLowerCase()] ?? unit
}

/** "500 g Kartoffeln" bzw. "2 Zwiebeln" bzw. "Salz". */
export function formatIngredient(ingredient: RecipeIngredient): string {
  return [ingredient.qty, unitLabel(ingredient.unit), ingredient.name]
    .filter((part) => part && part.length > 0)
    .join(' ')
}

/** Zutaten wieder als bearbeitbaren Text. */
export function ingredientsToText(ingredients: RecipeIngredient[]): string {
  return ingredients.map(formatIngredient).join('\n')
}

/** Schritte: eine Nummer pro Zeile, führende "1." o. ä. wird entfernt. */
export function parseSteps(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\d+[.)]\s*/, ''))
    .filter((line) => line.length > 0)
}

/** Für den Abgleich mit der Einkaufsliste: "Kartoffeln" == "kartoffeln". */
export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** "3 Portionen · 25 Min · 6 Zutaten" */
export function recipeMeta(recipe: {
  servings: number
  minutes: number | null
  ingredients: RecipeIngredient[]
}): string {
  const parts = [
    recipe.servings === 1 ? '1 Portion' : `${recipe.servings} Portionen`,
  ]
  if (recipe.minutes) parts.push(`${recipe.minutes} Min`)
  const count = recipe.ingredients.length
  parts.push(count === 1 ? '1 Zutat' : `${count} Zutaten`)
  return parts.join(' · ')
}
