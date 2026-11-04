import { describe, it, expect } from 'vitest'
import {
  formatIngredient, guessCategory, ingredientsToText, parseIngredientLine,
  parseIngredients, parseSteps, recipeMeta, sameName,
} from '../recipes'

describe('Zutatenzeilen lesen', () => {
  it('Menge + Einheit + Name', () => {
    expect(parseIngredientLine('500 g Kartoffeln')).toEqual({
      name: 'Kartoffeln', qty: '500', unit: 'g', category: 'Gemüse & Kräuter',
    })
  })

  it('Stückzahl ohne Einheit', () => {
    const z = parseIngredientLine('2 Zwiebeln')
    expect(z?.qty).toBe('2')
    expect(z?.unit).toBe('')
    expect(z?.name).toBe('Zwiebeln')
  })

  it('Bruch und Dezimalkomma', () => {
    expect(parseIngredientLine('1/2 Zitrone')?.qty).toBe('1/2')
    expect(parseIngredientLine('1,5 kg Tomaten')?.qty).toBe('1,5')
  })

  it('Gebinde wie "1 Bund Petersilie"', () => {
    const p = parseIngredientLine('1 Bund Petersilie')
    expect(p?.qty).toBe('1')
    expect(p?.unit).toBe('bund')
    expect(p?.name).toBe('Petersilie')
  })

  it('ohne Menge bleibt alles Name', () => {
    const salz = parseIngredientLine('Salz')
    expect(salz?.qty).toBe('')
    expect(salz?.name).toBe('Salz')
  })

  it('Aufzählungszeichen und Leerzeilen', () => {
    const list = parseIngredients('- 3 Eier\n\n• Olivenöl\n   ')
    expect(list).toHaveLength(2)
    expect(list[0].name).toBe('Eier')
    expect(list[1].name).toBe('Olivenöl')
  })
})

describe('Kategorien raten', () => {
  it('trifft die Einkaufskategorien', () => {
    expect(guessCategory('Hähnchenbrust')).toBe('Fleisch & Fisch')
    expect(guessCategory('Gambas')).toBe('Fleisch & Fisch')
    expect(guessCategory('Manchego')).toBe('Milchprodukte')
    expect(guessCategory('Knoblauchzehen')).toBe('Gemüse & Kräuter')
    expect(guessCategory('Zitronen')).toBe('Obst')
    expect(guessCategory('Baguette')).toBe('Brot & Backwaren')
    expect(guessCategory('Weißwein')).toBe('Alkohol')
    expect(guessCategory('Olivenöl')).toBe('Sonstiges')
  })
})

describe('Formate', () => {
  it('Zutat zurück in Text und wieder einlesen', () => {
    const text = '500 g Kartoffeln\n2 Zwiebeln\nSalz'
    const round = ingredientsToText(parseIngredients(text))
    expect(round).toBe(text)
  })

  it('Gebinde werden angezeigt groß geschrieben, Metrisches bleibt klein', () => {
    expect(formatIngredient({ name: 'Petersilie', qty: '1', unit: 'bund', category: 'Gemüse & Kräuter' }))
      .toBe('1 Bund Petersilie')
    expect(formatIngredient({ name: 'Kümmel', qty: '1', unit: 'tl', category: 'Sonstiges' })).toBe('1 TL Kümmel')
    expect(formatIngredient({ name: 'Kartoffeln', qty: '500', unit: 'g', category: 'Gemüse & Kräuter' }))
      .toBe('500 g Kartoffeln')
  })

  it('formatIngredient ohne Menge', () => {
    expect(formatIngredient({ name: 'Salz', qty: '', unit: '', category: 'Sonstiges' })).toBe('Salz')
  })

  it('Schritte entfernen Nummerierung', () => {
    expect(parseSteps('1. Wasser kochen\n2) Kartoffeln salzen\n\n')).toEqual([
      'Wasser kochen', 'Kartoffeln salzen',
    ])
  })

  it('Meta-Zeile', () => {
    expect(recipeMeta({ servings: 3, minutes: 25, ingredients: parseIngredients('a\nb') }))
      .toBe('3 Portionen · 25 Min · 2 Zutaten')
    expect(recipeMeta({ servings: 1, minutes: null, ingredients: parseIngredients('a') }))
      .toBe('1 Portion · 1 Zutat')
  })

  it('Namensvergleich ignoriert Groß/Klein und Leerzeichen', () => {
    expect(sameName(' Kartoffeln ', 'kartoffeln')).toBe(true)
    expect(sameName('Kartoffel', 'Kartoffeln')).toBe(false)
  })
})
