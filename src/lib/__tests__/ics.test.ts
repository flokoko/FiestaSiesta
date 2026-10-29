import { describe, expect, it } from 'vitest'
import { addMinutes, buildIcs, escapeIcsText, eventsFromPlan, foldIcsLine, icsStamp } from '../ics'
import type { TripProposal } from '../../types'

const fixed = new Date('2026-10-29T04:15:00Z')

function proposal(over: Partial<TripProposal>): TripProposal {
  return {
    id: 'p1', list_id: 'l1', day: '2026-11-29', slot: 'evening',
    title: 'Sonnenuntergang', note: '', place: '', created_by: 'Flo',
    created_at: '2026-10-01T10:00:00Z', confirmed_at: null, confirmed_by: null,
    ...over,
  } as TripProposal
}

describe('addMinutes', () => {
  it('rechnet innerhalb des Tages', () => {
    expect(addMinutes('09:00', 120)).toBe('11:00')
    expect(addMinutes('13:00', 90)).toBe('14:30')
  })

  it('bricht über Mitternacht um', () => {
    expect(addMinutes('23:30', 60)).toBe('00:30')
  })
})

describe('escapeIcsText', () => {
  it('escaped Backslash, Semikolon, Komma und Zeilenumbruch', () => {
    expect(escapeIcsText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne')
  })
})

describe('foldIcsLine', () => {
  it('lässt kurze Zeilen unangetastet', () => {
    expect(foldIcsLine('SUMMARY:Test')).toBe('SUMMARY:Test')
  })

  it('faltet lange Zeilen nach Oktetten, nicht nach Zeichen', () => {
    // 40 Umlaute = 80 Oktette, aber nur 40 Zeichen
    const folded = foldIcsLine('X:' + 'ä'.repeat(40))
    const parts = folded.split('\r\n ')
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75)
    }
    // Fortsetzungszeilen beginnen mit genau einem Leerzeichen
    expect(folded).toContain('\r\n ')
  })
})

describe('icsStamp', () => {
  it('setzt Datum und Uhrzeit ohne Trennzeichen zusammen', () => {
    expect(icsStamp('2026-11-29', '09:00')).toBe('20261129T090000')
  })
})

describe('buildIcs', () => {
  const ics = buildIcs({
    calendarName: 'Fiesta Siesta · Gran Canaria',
    events: [{
      uid: '2026-11-29-evening@fiesta-siesta',
      day: '2026-11-29',
      time: '19:00',
      durationMin: 150,
      title: 'Sonnenuntergang am Observatorio',
      description: 'Ort: Teide',
      location: 'Observatorio',
    }],
    now: fixed,
  })

  it('hat Rahmen, Zeitzone und CRLF-Zeilenenden', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
    expect(ics).toContain('BEGIN:VTIMEZONE')
    expect(ics).toContain('TZID:Europe/Madrid')
  })

  it('schreibt Start, Ende, Titel und Ort des Termins', () => {
    expect(ics).toContain('DTSTART;TZID=Europe/Madrid:20261129T190000')
    expect(ics).toContain('DTEND;TZID=Europe/Madrid:20261129T213000')
    expect(ics).toContain('SUMMARY:Sonnenuntergang am Observatorio')
    expect(ics).toContain('LOCATION:Observatorio')
    expect(ics).toContain('DTSTAMP:20261029T041500Z')
  })

  it('escaped Sonderzeichen im Titel', () => {
    const out = buildIcs({
      calendarName: 'Test', now: fixed,
      events: [{ uid: 'u@x', day: '2026-11-29', time: '09:00', durationMin: 60, title: 'Frühstück, Kaffee; Bar' }],
    })
    expect(out).toContain('SUMMARY:Frühstück\\, Kaffee\\; Bar')
  })
})

describe('eventsFromPlan', () => {
  const plan = {
    '2026-11-29': {
      evening: proposal({ slot: 'evening', title: 'Ankunft', place: 'Flughafen LPA' }),
    },
    '2026-11-30': {
      morning: proposal({ id: 'p2', day: '2026-11-30', slot: 'morning', title: 'Olivenhain' }),
    },
  }

  it('baut pro belegtem Slot einen Termin mit fester Uhrzeit', () => {
    const events = eventsFromPlan(plan)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ day: '2026-11-29', time: '19:00', durationMin: 150, title: 'Ankunft' })
    expect(events[1]).toMatchObject({ day: '2026-11-30', time: '09:00', durationMin: 120 })
  })

  it('filtert auf einen einzelnen Tag', () => {
    const events = eventsFromPlan(plan, '2026-11-30')
    expect(events).toHaveLength(1)
    expect(events[0].title).toBe('Olivenhain')
  })

  it('nimmt Ort in die Beschreibung auf', () => {
    const events = eventsFromPlan(plan, '2026-11-29')
    expect(events[0].location).toBe('Flughafen LPA')
    expect(events[0].description).toContain('Ort: Flughafen LPA')
  })
})
