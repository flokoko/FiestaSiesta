/**
 * Fiesta Siesta — spanischer Flair.
 * Zentrale Sprüche/Toasts für Begrüßung, Erfolge und Motto.
 */

/**
 * Begrüßung je nach Tageszeit.
 * HINWEIS: spanishQuote()/ESPANOLA_QUOTES werden aktuell nirgends gerendert
 * (das Info-Band wurde entfernt), bleiben aber als Mechanismus erhalten.
 */

/** Begrüßung je nach Tageszeit. */
export function greetByTime(userName: string): string {
  const h = new Date().getHours()
  if (h < 11) return `Buenos días, ${userName}! 🌅`
  if (h < 18) return `Hola, ${userName}! ☀️`
  return `Buenas tardes, ${userName}! 🍹`
}

/** Rotierende Erfolgs-Toasts (per App-Aufruf ein anderer). */
const SUCCESS_QUOTES = [
  'Perfecto! ✓',
  'Listo! 🎉',
  'Olé! 💪',
  'Qué guay! 🥳',
  'Muy bien! ✨',
  'Fantástico! 🇪🇸',
  'Dulce victoria! 🍰',
  'Venga! 🌴',
]

/** Zufälligen Erfolgs-Spruch liefern. */
export function spanishSuccess(): string {
  return SUCCESS_QUOTES[Math.floor(Math.random() * SUCCESS_QUOTES.length)]
}

/** Rotierende Mottos für die Info-Sektion (Settings). */
const MOTTO_QUOTES = [
  'Siesta, Strand, Fiesta — Fiesta Siesta!',
  'Mehr Sonne, weniger Stress!',
  'Playa, Chiringuito & gute Listen!',
  'Buen humor, buenas listas!',
  'Amigos, Sangría & Ordnung!',
  'El grupo perfecto!',
]

/** Zufälliges Motto für die App. */
export function spanishMotto(): string {
  return MOTTO_QUOTES[Math.floor(Math.random() * MOTTO_QUOTES.length)]
}

/** Sprüche für "hinzugefügt"-Aktionen (Aktivitäts-Meldungen). */
const ADD_QUOTES = [
  'Olé! 🍅',
  'Listo! 🎉',
  'Venga! 💪',
  'Fantástico! ✨',
  'Qué guay! 🥳',
  'Marchando! 🌟',
  'Bravo! 👏',
]

/** Sprüche für "abgehakt/mitgebracht"-Aktionen (Aktivitäts-Meldungen). */
const CHECK_QUOTES = [
  'Listo! ✓',
  'Perfecto! ✓',
  'Dulce siesta! 😴',
  'Vamos a la playa! 🏖️',
  'Muy bien! ✨',
  'Bien hecho! 🎓',
  'Todo listo! ✅',
]

/** Spanische Sprichwörter/Zeilen zum Siesta-, Strand- und Fiesta-Thema. */
export const ESPANOLA_QUOTES = [
  'Nach der Siesta geht\'s an den Strand',
  'Wer Siesta hält, denkt klarer — so sagt man in Spanien',
  'Im Chiringuito zählt nur das Wasser',
  'Albúfera, Dünen, Maspalomas — hier ist Zeit nur ein Vorschlag',
  '"A quien madruga, Dios le ayuda" — wer früh aufsteht, hat mehr Strand',
  '"No dejes para mañana la siesta que puedes hacer hoy"',
  '"Sobremesa" — das Plaudern am Tisch ist die schönste Kurseinheit',
  'Das Fiesta beginnt, wenn die Siesta endet',
  'Ein Vino tinto am Abend macht alles leicht',
  '"Más vale mal acompañado que solo" — gemeinsam ist alles schöner',
  'Bocadillo in der Hand, Sand zwischen den Zehen',
  'Aus dem Chiringuito riecht man den Sommer — "hasta luego, verano"',
  'Fiesta ohne Siesta ist keine Fiesta',
  '"La vida es mejor en la playa"',
]

/** Zufälligen Aktivitäts-Spruch liefern — 'add' für Inserts, 'check' für Abhaken/Mitbringen. */
export function spanishPhrase(kind: 'add' | 'check'): string {
  const pool = kind === 'add' ? ADD_QUOTES : CHECK_QUOTES
  const base = pool[Math.floor(Math.random() * pool.length)]
  return Math.random() < 0.08 ? `${base} Gebiss` : base
}

/** Reines Zitat — gelegentlich mit "Gebiss". */
export function spanishQuote(): string {
  const q = ESPANOLA_QUOTES[Math.floor(Math.random() * ESPANOLA_QUOTES.length)]
  return Math.random() < 0.08 ? `${q} — Gebiss` : q
}