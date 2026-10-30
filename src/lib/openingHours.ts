// ── Öffnungszeiten-Ampel ────────────────────────────────────────────
// Statisch, offline, ohne API: die Zeiten stammen aus OpenStreetMap
// (overpass-api.de, Abfrage vom 30.10.2026, Bounding-Box Agüimes/Ingenio) und
// stehen hier als `opening_hours`-String im OSM-Format. Der Parser versteht
// genau den Teil, den die Daten benutzen — kein vollständiger OSM-Parser.
//
// Wichtig für die Anzeige: Temisas liegt auf 690 m im Gemeindegebiet Agüimes,
// die nächsten Läden sind 10–15 Autominuten entfernt. Und der Aufenthalt fällt
// in Spaniens Winterzeit — die Kanaren gehen eine Stunde nach deutscher Zeit.

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const
export type Weekday = (typeof WEEKDAYS)[number]

export type Category = 'supermarket' | 'bakery' | 'pharmacy' | 'fuel' | 'cafe'

export interface OpeningEntry {
  id: string
  name: string
  category: Category
  /** Wo genau — steht in der Zeile unter dem Namen */
  address: string
  /** OSM opening_hours */
  hours: string
  lat: number
  lon: number
  phone?: string
  /** Praktischer Hinweis, nur wenn er wirklich etwas beiträgt */
  note?: string
}

export const OPENING_SOURCE = 'OpenStreetMap, 30.10.2026'

export const OPENING_ENTRIES: OpeningEntry[] = [
  {
    id: 'spar-aguerimes',
    name: 'Spar',
    category: 'supermarket',
    address: 'Calle Crisantemo, Agüimes · 10 Min',
    hours: 'Mo-Su 08:00-21:30',
    lat: 27.90188,
    lon: -15.41228,
    note: 'Auch sonntags offen.',
  },
  {
    id: 'al-san-anton',
    name: 'Al San Anton',
    category: 'supermarket',
    address: 'Calle San Antón, Agüimes · 14 Min',
    hours: 'Mo-Sa 08:00-22:00; Su 08:00-15:00',
    lat: 27.90605,
    lon: -15.44498,
  },
  {
    id: 'brasil',
    name: 'Brasil',
    category: 'supermarket',
    address: 'Agüimes · 14 Min',
    hours: 'PH,Mo-Su 07:00-22:00',
    lat: 27.9042,
    lon: -15.44672,
    note: 'Ab 07:00 — Wasser und Kaffee vor der Abfahrt.',
  },
  {
    id: 'villa-de-aguimes',
    name: 'Villa de Agüimes',
    category: 'bakery',
    address: 'Agüimes · 14 Min',
    hours: 'Mo-Sa 06:00-14:00; Su off',
    lat: 27.90462,
    lon: -15.44438,
    note: 'Sonntags zu — Brot am Samstag.',
  },
  {
    id: 'farmacia-apolinario',
    name: 'Farmacia Apolinario',
    category: 'pharmacy',
    address: 'Agüimes · 14 Min',
    hours: 'Mo-Fr 09:00-13:30,16:30-20:00; Sa 09:00-12:00',
    lat: 27.90492,
    lon: -15.44383,
  },
  {
    id: 'farmacia-ruth',
    name: 'Farmacia Ruth Hernández',
    category: 'pharmacy',
    address: 'Calle León y Castillo 8, Agüimes · 16 Min',
    hours: 'Mo-Su 09:00-13:00,16:30-20:45',
    lat: 27.91977,
    lon: -15.4374,
    note: 'Einzige mit Sonntagsdienst.',
  },
  {
    id: 'disa-aguimes',
    name: 'DISA Agüimes',
    category: 'fuel',
    address: 'Calle Juan Alvarado y Sanz 79 · 14 Min',
    hours: 'Mo-Su 06:30-22:30',
    lat: 27.90409,
    lon: -15.44489,
  },
  {
    id: 'disa-autopista',
    name: 'DISA Autopista',
    category: 'fuel',
    address: 'GC-1, Abfahrt Arinaga · 12 Min',
    hours: '24/7',
    lat: 27.89906,
    lon: -15.40481,
    note: 'Rund um die Uhr — Abreisetag.',
  },
  {
    id: 'el-populacho',
    name: 'El Populacho',
    category: 'cafe',
    address: 'Plaza del Rosario 16, Agüimes · 14 Min',
    hours: 'Su-Fr 09:30-17:00; Sa 09:30-21:00',
    lat: 27.90707,
    lon: -15.44701,
    phone: '+34928784514',
  },
  {
    id: 'la-tarteria',
    name: 'La Tartería',
    category: 'cafe',
    address: 'Plaza del Rosario 21, Agüimes · 14 Min',
    hours: 'Mo-Fr 09:30-14:00; PH,Sa,Su 10:00-14:00',
    lat: 27.90701,
    lon: -15.44666,
    phone: '+34928787638',
    note: 'Nur bis 14:00.',
  },
]

export const CATEGORY_LABEL: Record<Category, string> = {
  supermarket: 'Supermärkte',
  bakery: 'Bäckerei',
  pharmacy: 'Apotheken',
  fuel: 'Tankstellen',
  cafe: 'Cafés & Bars',
}

// ── Parser ──────────────────────────────────────────────────────────

/** Minuten seit Mitternacht; 24:00 wird zu 1440. */
export interface Interval {
  from: number
  to: number
}

export type WeekPlan = Record<Weekday, Interval[]>

function minutes(text: string): number {
  const [h, m] = text.split(':').map(Number)
  return h * 60 + (m || 0)
}

function emptyPlan(): WeekPlan {
  return { Mo: [], Tu: [], We: [], Th: [], Fr: [], Sa: [], Su: [] }
}

/** „Mo-Fr" / „Mo,We,Fr" / „Su" / „PH" → Wochentage (PH wird ignoriert). */
function expandDays(spec: string): Weekday[] {
  const days = new Set<Weekday>()
  for (const part of spec.split(',')) {
    const token = part.trim()
    if (!token) continue
    const range = token.match(/^([A-Z][a-z])\s*-\s*([A-Z][a-z])$/)
    if (range) {
      const from = WEEKDAYS.indexOf(range[1] as Weekday)
      const to = WEEKDAYS.indexOf(range[2] as Weekday)
      if (from < 0 || to < 0) continue
      // Über die Woche hinweg (z. B. We-Mo) laufen, nicht abbrechen.
      for (let i = from; ; i = (i + 1) % 7) {
        days.add(WEEKDAYS[i])
        if (i === to) break
      }
      continue
    }
    if ((WEEKDAYS as readonly string[]).includes(token)) days.add(token as Weekday)
  }
  return Array.from(days)
}

/**
 * OSM-`opening_hours` → Wochenplan. Versteht:
 *   „24/7", „Mo-Su 08:00-21:30", „Mo-Sa 08:00-22:00; Su 08:00-15:00",
 *   „Mo-Fr 09:00-13:30,16:30-20:00", „...; Su off", „PH,Mo-Su 07:00-22:00".
 * Unbekannte Regeln werden ignoriert; ein unlesbarer String ergibt null.
 */
export function parseOpeningHours(spec: string): WeekPlan | null {
  const plan = emptyPlan()
  const value = spec.trim()
  if (!value) return null
  if (value === '24/7' || value === '00:00-24:00') {
    for (const day of WEEKDAYS) plan[day] = [{ from: 0, to: 1440 }]
    return plan
  }

  let parsedAnything = false
  for (const rule of value.split(';')) {
    const text = rule.trim()
    if (!text) continue

    // „Su closed" / „Mo off" — ausdrücklich zu
    const closed = text.match(/^([A-Za-z,\-\s]+?)\s+(?:off|closed)$/)
    if (closed) {
      for (const day of expandDays(closed[1])) plan[day] = []
      parsedAnything = true
      continue
    }

    const split = text.match(/^([A-Za-z,\-\s]+?)\s+([\d:,\-\s]+)$/)
    if (!split) continue
    const days = expandDays(split[1])
    if (days.length === 0) continue

    const intervals: Interval[] = []
    for (const chunk of split[2].split(',')) {
      const times = chunk.trim().match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/)
      if (!times) continue
      const from = minutes(times[1])
      const to = minutes(times[2]) || 1440
      if (to > from) intervals.push({ from, to })
    }
    if (intervals.length === 0) continue
    intervals.sort((a, b) => a.from - b.from)
    for (const day of days) plan[day] = intervals.map((i) => ({ ...i }))
    parsedAnything = true
  }

  return parsedAnything ? plan : null
}

// ── Zustand „jetzt" ─────────────────────────────────────────────────

/** Ortszeit der Kanaren, unabhängig von der Gerätezeitzone. */
export function canaryNow(now: Date = new Date()): { day: Weekday; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Atlantic/Canary',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const map: Record<string, Weekday> = {
    Mon: 'Mo', Tue: 'Tu', Wed: 'We', Thu: 'Th', Fri: 'Fr', Sat: 'Sa', Sun: 'Su',
  }
  const day = map[get('weekday')] ?? 'Mo'
  const hour = Number(get('hour')) % 24
  const minute = Number(get('minute'))
  return { day, minutes: hour * 60 + (minute || 0) }
}

export interface OpenState {
  open: boolean
  /** Minuten bis zum Schließen (nur wenn offen) */
  closesIn: number | null
  /** Schließzeit in Minuten seit Mitternacht */
  closesAt: number | null
  /** „Pause" = heute kommt noch eine zweite Öffnung */
  midDayBreak: boolean
  /** nächste Öffnung: heute (sameDay true) oder an einem Folgetag */
  nextDay: Weekday | null
  nextFrom: number | null
  /** Rohdaten unlesbar */
  unknown: boolean
}

export function openState(hours: string, now: Date = new Date()): OpenState {
  const plan = parseOpeningHours(hours)
  const clock = canaryNow(now)
  if (!plan) {
    return {
      open: false, closesIn: null, closesAt: null, midDayBreak: false,
      nextDay: null, nextFrom: null, unknown: true,
    }
  }

  const today = plan[clock.day]
  for (const interval of today) {
    if (clock.minutes >= interval.from && clock.minutes < interval.to) {
      return {
        open: true,
        closesIn: interval.to - clock.minutes,
        closesAt: interval.to,
        midDayBreak: false,
        nextDay: null,
        nextFrom: null,
        unknown: false,
      }
    }
  }

  // Heute geschlossen, aber später nochmal auf?
  const laterToday = today.find((i) => i.from > clock.minutes)
  if (laterToday) {
    return {
      open: false, closesIn: null, closesAt: null, midDayBreak: true,
      nextDay: clock.day, nextFrom: laterToday.from, unknown: false,
    }
  }

  // Nächster Tag mit Öffnung (max. 7 Tage voraus)
  const startIndex = WEEKDAYS.indexOf(clock.day)
  for (let step = 1; step <= 7; step++) {
    const day = WEEKDAYS[(startIndex + step) % 7]
    const intervals = plan[day]
    if (intervals.length > 0) {
      return {
        open: false, closesIn: null, closesAt: null, midDayBreak: false,
        nextDay: day, nextFrom: intervals[0].from, unknown: false,
      }
    }
  }

  return {
    open: false, closesIn: null, closesAt: null, midDayBreak: false,
    nextDay: null, nextFrom: null, unknown: false,
  }
}

export function clockText(minutesFromMidnight: number): string {
  const h = Math.floor(minutesFromMidnight / 60) % 24
  const m = minutesFromMidnight % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Menschenlesbarer Zustand für die Zeile. */
export function stateLabel(
  state: OpenState,
  now: Date = new Date(),
): { tone: 'open' | 'soon' | 'closed' | 'unknown'; text: string } {
  if (state.unknown) return { tone: 'unknown', text: 'Zeiten unbekannt' }
  const clock = canaryNow(now)

  if (state.open && state.closesAt !== null) {
    // 24/7 endet rechnerisch um Mitternacht — „bis 00:00" wäre irreführend.
    if (state.closesAt >= 1440) return { tone: 'open', text: 'rund um die Uhr' }
    const closes = clockText(state.closesAt)
    const inMin = state.closesIn ?? 0
    if (inMin <= 45) {
      return { tone: 'soon', text: `schließt ${closes} · in ${inMin} Min` }
    }
    return { tone: 'open', text: `offen · bis ${closes}` }
  }

  if (state.nextDay && state.nextFrom !== null) {
    const from = clockText(state.nextFrom)
    if (state.midDayBreak) return { tone: 'closed', text: `Pause · öffnet ${from}` }
    if (state.nextDay === clock.day) return { tone: 'closed', text: `öffnet ${from}` }
    const index = WEEKDAYS.indexOf(state.nextDay)
    const todayIndex = WEEKDAYS.indexOf(clock.day)
    const dayLabel = (todayIndex + 1) % 7 === index ? 'morgen' : state.nextDay
    return { tone: 'closed', text: `geschlossen · ${dayLabel} ${from}` }
  }

  return { tone: 'closed', text: 'geschlossen' }
}

/** „Mo-Sa 08:00-22:00" → „Mo–Sa 08:00–22:00" für die Zeile unter dem Namen. */
export function hoursText(spec: string): string {
  if (spec === '24/7') return 'rund um die Uhr'
  return spec
    .replace(/;\s*/g, ' · ')
    .replace(/,\s*(?=\d)/g, ', ')
    .replace(/(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/g, '$1–$2')
    .replace(/\boff\b/g, 'zu')
    .replace(/^PH,\s*/, '')
}
