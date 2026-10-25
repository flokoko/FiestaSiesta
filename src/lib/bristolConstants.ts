// ── Shared Bristol constants (Fix #4) ────────────────────────────────
// Extracted from BristolScreen.tsx and BristolWidget.tsx to eliminate
// duplication of BRISTOL_COLORS / BRISTOL_EMOJIS / BRISTOL_ADJECTIVES.

export const BRISTOL_ADJECTIVES: Record<number, string> = {
  1: 'klumpig',
  2: 'wurstartig',
  3: 'rissig',
  4: 'glatt',
  5: 'weich',
  6: 'breiig',
  7: 'flüssig',
  13: 'Plasma',
  14: 'Mega-Plasma',
}

export const BRISTOL_COLORS: Record<number, string> = {
  1: '#8B4513',
  2: '#A0522D',
  3: '#D2691E',
  4: '#F1BF00',
  5: '#9ACD32',
  6: '#FFD700',
  7: '#FF6347',
  13: '#8B4513',
  14: '#5C1A0E',
}

export const BRISTOL_EMOJIS: Record<number, string> = {
  1: '🪨',
  2: '🌭',
  3: '🥨',
  4: '🍌',
  5: '🍦',
  6: '🥣',
  7: '💧',
  13: '💩',
  14: '💥💩',
}

export const BRISTOL_VALUES = [1, 2, 3, 4, 5, 6, 7, 13]
/**
 * Schriftfarbe auf einem Farbchip: die hellen Werte (Gelb, Limette, Tomate)
 * tragen weiße Schrift nicht (unter 3:1). Dort dunkle Tinte.
 */
const LIGHT_VALUES = new Set([4, 5, 6, 7])
export const bristolInk = (value: number) => (LIGHT_VALUES.has(value) ? '#241A05' : '#FFFFFF')
