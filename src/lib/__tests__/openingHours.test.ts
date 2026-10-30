import { describe, it, expect } from 'vitest'
import {
  parseOpeningHours, openState, stateLabel, canaryNow, hoursText, clockText,
} from '../openingHours'

/** Kanaren sind im Winter UTC+0, im Sommer UTC+1 — Tests deshalb in UTC. */
const at = (iso: string) => new Date(iso)

describe('parseOpeningHours', () => {
  it('versteht 24/7', () => {
    const plan = parseOpeningHours('24/7')!
    expect(plan.Mo).toEqual([{ from: 0, to: 1440 }])
    expect(plan.Su).toEqual([{ from: 0, to: 1440 }])
  })

  it('verteilt eine Tagesrange auf alle sieben Tage', () => {
    const plan = parseOpeningHours('Mo-Su 08:00-21:30')!
    expect(plan.Mo).toEqual([{ from: 480, to: 1290 }])
    expect(plan.Su).toEqual([{ from: 480, to: 1290 }])
  })

  it('nimmt eine eigene Sonntagszeit', () => {
    const plan = parseOpeningHours('Mo-Sa 08:00-22:00; Su 08:00-15:00')!
    expect(plan.Sa).toEqual([{ from: 480, to: 1320 }])
    expect(plan.Su).toEqual([{ from: 480, to: 900 }])
  })

  it('behält zwei Blöcke am Tag (Siesta)', () => {
    const plan = parseOpeningHours('Mo-Fr 09:00-13:30,16:30-20:00; Sa 09:00-12:00')!
    expect(plan.Mo).toEqual([{ from: 540, to: 810 }, { from: 990, to: 1200 }])
    expect(plan.Sa).toEqual([{ from: 540, to: 720 }])
    expect(plan.Su).toEqual([])
  })

  it('versteht „Su off" als ausdrücklich geschlossen', () => {
    const plan = parseOpeningHours('Mo-Sa 06:00-14:00; Su off')!
    expect(plan.Su).toEqual([])
    expect(plan.Mo).toEqual([{ from: 360, to: 840 }])
  })

  it('ignoriert PH und liefert bei Unsinn null', () => {
    const plan = parseOpeningHours('PH,Mo-Su 07:00-22:00')!
    expect(plan.Mo).toEqual([{ from: 420, to: 1320 }])
    expect(parseOpeningHours('nach Absprache')).toBeNull()
  })
})

describe('canaryNow', () => {
  it('rechnet im Winter wie UTC', () => {
    const clock = canaryNow(at('2026-11-30T10:15:00Z'))
    expect(clock.day).toBe('Mo')
    expect(clock.minutes).toBe(615)
  })

  it('rechnet im Sommer +1 h — 23:30 UTC ist schon der nächste Tag', () => {
    const clock = canaryNow(at('2026-07-01T23:30:00Z'))
    expect(clock.day).toBe('Th')
    expect(clock.minutes).toBe(30)
  })
})

describe('openState', () => {
  it('meldet offen mit Restzeit', () => {
    const state = openState('Mo-Su 08:00-21:30', at('2026-11-30T10:00:00Z'))
    expect(state.open).toBe(true)
    expect(state.closesAt).toBe(1290)
    expect(state.closesIn).toBe(690)
  })

  it('warnt 30 Minuten vor Schluss', () => {
    const now = at('2026-11-30T21:00:00Z')
    const label = stateLabel(openState('Mo-Su 08:00-21:30', now), now)
    expect(label.tone).toBe('soon')
    expect(label.text).toBe('schließt 21:30 · in 30 Min')
  })

  it('erkennt die Siesta und nennt die zweite Öffnung', () => {
    const now = at('2026-11-30T14:30:00Z')
    const state = openState('Mo-Fr 09:00-13:30,16:30-20:00', now)
    expect(state.open).toBe(false)
    expect(state.midDayBreak).toBe(true)
    expect(stateLabel(state, now).text).toBe('Pause · öffnet 16:30')
  })

  it('springt am geschlossenen Sonntag auf Montag', () => {
    const now = at('2026-11-29T10:00:00Z')
    const state = openState('Mo-Sa 06:00-14:00; Su off', now)
    expect(state.open).toBe(false)
    expect(state.nextDay).toBe('Mo')
    expect(stateLabel(state, now).text).toBe('geschlossen · morgen 06:00')
  })

  it('kennt Tankstellen ohne Schließzeit', () => {
    const state = openState('24/7', at('2026-11-30T03:00:00Z'))
    expect(state.open).toBe(true)
    expect(state.closesIn).toBe(1260)
  })

  it('markiert unlesbare Zeiten als unbekannt statt als geschlossen', () => {
    expect(stateLabel(openState('', at('2026-11-30T10:00:00Z'))).tone).toBe('unknown')
  })
})

describe('Textformate', () => {
  it('setzt Gedankenstriche in Zeiten und trennt Regeln', () => {
    expect(hoursText('Mo-Sa 08:00-22:00; Su 08:00-15:00')).toBe('Mo-Sa 08:00–22:00 · Su 08:00–15:00')
    expect(hoursText('24/7')).toBe('rund um die Uhr')
    expect(hoursText('PH,Mo-Su 07:00-22:00')).toBe('Mo-Su 07:00–22:00')
  })

  it('formatiert Mitternacht als 00:00', () => {
    expect(clockText(1440)).toBe('00:00')
    expect(clockText(1290)).toBe('21:30')
  })
})
