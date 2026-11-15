// ── Rückweg im Dunkeln ───────────────────────────────────────────────
// Temisas liegt 11 km Bergstraße ohne Beleuchtung hinter dem Roque Nublo.
// Ein Abendplan mit Sonnenuntergang 18:20 und 150 Minuten Aufenthalt heißt:
// die Heimfahrt startet im Dunkeln. Diese Funktion rechnet aus dem letzten
// Programmpunkt des Tags, wann die Rückkehr ankommt — und warnt nur, wenn
// das nach Sonnenuntergang liegt UND die Rückfahrt eine echte Fahrt ist
// (≥ 20 Minuten), nicht der Rückweg vom Dorfrestaurant.
//
// Alle Zeiten sind Kanaren-Wanduhr, die im Plan steht; der Sonnenuntergang
// kommt per `sunClock` aus der open-meteo-Vorschau.

import type { TripProposal, TripSlot } from '../types'
import type { DayPlan } from '../hooks/useTripPlan'
import { SLOTS } from './tripPlan'
import { SLOT_START, clockText, hhmm, minutesOf } from './wake'
import { sunClock } from './tripWeather'
import { quickDriveTime } from './driveTime'

export interface SunWarning {
  /** Rückfahrt zur Unterkunft, in Minuten */
  minutes: number
  /** Sonnenuntergang als „18:20" */
  sunsetClock: string
  /** Ort des letzten Programmpunkts */
  place: string
  /** Ankunft zu Hause als „22:22" */
  arrivalClock: string
}

/** Aufenthalt am Programmpunkt vor der Rückfahrt, in Minuten. */
const STAY_MINUTES: Record<TripSlot, number> = {
  morning: 120,
  noon: 120,
  evening: 150,
}

/** Darunter ist es der Weg zum Dorfrestaurant, keine Bergstraße. */
const MIN_DRIVE_MINUTES = 20

function pointWithCoords(
  p: TripProposal | null | undefined,
  day: string,
): { proposal: TripProposal; lat: number; lon: number } | null {
  if (!p || p.day !== day) return null
  const lat = p.place_lat
  const lon = p.place_lon
  if (
    typeof lat !== 'number' ||
    typeof lon !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon)
  ) {
    return null
  }
  return { proposal: p, lat, lon }
}

/**
 * Warnung vor dem Heimweg in der Dunkelheit, oder null.
 *
 * `plan` ist der Plan EINES Tages (TripPlanMap[day]) — die Einträge sind
 * bereits fest: bestätigt oder Abstimmungssieger. Gemessen wird der letzte
 * Punkt des Tags (Morgen → Mittag → Abend), der Koordinaten hat. Punkte
 * eines anderen Tages (stale Plan-Objekte) werden übersprungen.
 */
export function sunWarning(options: {
  sunsetIso: string | null
  plan: DayPlan
  day: string
}): SunWarning | null {
  const { sunsetIso, plan, day } = options
  if (!sunsetIso) return null
  const sunsetClock = sunClock(sunsetIso)
  if (!sunsetClock) return null
  const sunset = minutesOf(sunsetClock)

  // Letzter bestätigter Punkt mit Koordinaten (Morgen → Mittag → Abend).
  let chosen: { proposal: TripProposal; lat: number; lon: number } | null = null
  for (const slot of SLOTS) {
    const next = pointWithCoords(plan[slot.key], day)
    // Der später im Tag gelegene Punkt gewinnt — dort endet der Ausflug.
    if (next) chosen = next
  }
  if (!chosen) return null

  const point = chosen.proposal
  const startClock = point.starts_at ? hhmm(point.starts_at) : SLOT_START[point.slot]
  const drive = quickDriveTime(chosen.lat, chosen.lon).minutes
  const arrival = minutesOf(startClock) + STAY_MINUTES[point.slot] + drive

  if (drive < MIN_DRIVE_MINUTES || arrival <= sunset) return null

  const place = (point.place ?? '').split('·')[0].trim() || point.title
  return {
    minutes: drive,
    sunsetClock,
    place,
    arrivalClock: clockText(arrival),
  }
}
