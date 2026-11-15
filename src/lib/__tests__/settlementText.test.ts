import { describe, expect, it } from 'vitest'
import { settlementShareText } from '../settlementText'

describe('settlementShareText', () => {
  it('listet zwei Zahlungen in übergebener Reihenfolge mit offener Summe', () => {
    const text = settlementShareText({
      proposals: [
        { from: 'Flo', to: 'Madeline', amount: 32.5 },
        { from: 'Madeline', to: 'Jonas', amount: 12 },
      ],
    })
    expect(text).toBe(
      'Fiesta Siesta · Abrechnung\n'
      + 'Flo → Madeline: 32,50 €\n'
      + 'Madeline → Jonas: 12,00 €\n'
      + 'Offen insgesamt: 44,50 €',
    )
    expect(text.includes('\r')).toBe(false)
  })

  it('rundet 10.005 auf „10,01 €“ — über roundCents, nicht Intl alleine', () => {
    const text = settlementShareText({
      proposals: [{ from: 'Björn', to: 'Ana-María', amount: 10.005 }],
    })
    // Intl formatieren allein würde hier 10,00 € ergeben — roundCents geht
    // über die Exponentialschreibweise und rundet sauber auf.
    expect(text).toContain('Björn → Ana-María: 10,01 €')
    expect(text).toContain('Offen insgesamt: 10,01 €')
  })

  it('liefert im leeren Fall „Alles ausgeglichen“ ohne Umbruch am Ende', () => {
    const text = settlementShareText({ proposals: [] })
    expect(text).toBe('Fiesta Siesta · Abrechnung\n\nAlles ausgeglichen — niemand schuldet etwas.')
    expect(text.endsWith('\n')).toBe(false)
  })

  it('lässt Sonderzeichen in Namen unverändert', () => {
    const text = settlementShareText({
      proposals: [
        { from: 'Björn', to: 'Ana-María', amount: 5 },
        { from: 'Ana-María', to: 'Björn', amount: 7.123 },
      ],
    })
    expect(text).toContain('Björn → Ana-María: 5,00 €')
    expect(text).toContain('Ana-María → Björn: 7,12 €')
  })

  it('hängt beglichene Zahlungen als eigenen Block an die offenen an', () => {
    const text = settlementShareText({
      proposals: [{ from: 'Flo', to: 'Madeline', amount: 32.5 }],
      settlements: [{ from: 'Jonas', to: 'Flo', amount: 10 }],
    })
    expect(text).toContain('Offen insgesamt: 32,50 €\n\nBereits beglichen\nJonas → Flo: 10,00 €')
  })
})
