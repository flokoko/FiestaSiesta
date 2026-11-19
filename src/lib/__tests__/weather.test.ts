import { describe, expect, it } from 'vitest'
import { dailyIndexFor } from '../weather'

// Der Tag-Screen warnt mit dem Sonnenuntergang des GEWÄHLTEN Tags; die
// Details-Sektion im Wetter-Screen ist über denselben Index verdrahtet,
// damit beide Zahlen zum selben Reisetag gehören.

describe('dailyIndexFor', () => {
  const times = ['2026-11-19', '2026-11-20', '2026-11-21']

  it('findet den heutigen Tag am Index 0', () => {
    expect(dailyIndexFor('2026-11-19', times)).toBe(0)
  })

  it('findet einen künftigen Tag an seinem Index', () => {
    expect(dailyIndexFor('2026-11-21', times)).toBe(2)
  })

  it('fällt auf 0 (heute am Ort) zurück, wenn der Tag nicht im Array steht', () => {
    expect(dailyIndexFor('2026-11-25', times)).toBe(0)
  })
})
