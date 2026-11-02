// ── Wecker am Reiseplan ─────────────────────────────────────────────
// Zwei Zustellwege, ein Zustand:
//   1. Push über die Edge Function `reminder` (pg_cron, alle 5 Minuten) —
//      funktioniert auch, wenn die App geschlossen ist.
//   2. Lokaler Timer, solange die App offen ist — dann kommt die Notification
//      sofort, ohne auf den Cron zu warten.
//
// Zeiten sind IMMER Kanaren-Zeit (Atlantic/Canary). Flos Gerät steht auf
// deutscher Zeit, ein naiver `new Date('…T09:00')` wäre eine Stunde daneben.

import type { TripProposal, TripSlot } from '../types'

/** Voreingestellte Los-Zeiten je Tageszeit. */
export const SLOT_START: Record<TripSlot, string> = {
  morning: '09:00',
  noon: '13:00',
  evening: '19:00',
}

/** Auswahl für den Vorlauf in Minuten. */
export const LEAD_OPTIONS = [0, 5, 10, 15, 20, 30, 45, 60, 90] as const

export const DEFAULT_LEAD = 20
const LEAD_KEY = 'fiesta_wake_lead'

export function readDefaultLead(): number {
  try {
    const stored = localStorage.getItem(LEAD_KEY)
    // Number(null) und Number('') sind 0 — ohne diese Zeile wäre der Standard
    // immer „pünktlich".
    if (!stored) return DEFAULT_LEAD
    const value = Number(stored)
    // Nur Werte annehmen, die auch im Select stehen — sonst zeigt das Feld still
    // die erste Option, während intern etwas anderes gilt.
    if ((LEAD_OPTIONS as readonly number[]).includes(value)) return value
    if (Number.isFinite(value) && value > 0 && value <= 90) return value
  } catch {
    // localStorage gesperrt: Standard reicht
  }
  return DEFAULT_LEAD
}

export function writeDefaultLead(minutes: number): void {
  try {
    localStorage.setItem(LEAD_KEY, String(Math.max(0, Math.min(180, Math.round(minutes)))))
  } catch {
    // egal — gilt nur für dieses Gerät
  }
}

/** 'HH:MM:SS' aus Postgres → 'HH:MM' */
export function hhmm(value: string | null | undefined): string {
  return (value ?? '').slice(0, 5)
}

/** Minuten seit Mitternacht, aus 'HH:MM[:SS]'. */
export function minutesOf(value: string): number {
  const [h, m] = value.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function clockText(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`
}

/** Uhrzeit, zu der der Wecker klingelt ('08:40') — null ohne Los-Zeit. */
export function reminderClock(startsAt: string | null, leadMinutes: number): string | null {
  if (!startsAt) return null
  return clockText(minutesOf(startsAt) - leadMinutes)
}

/** Wie weit die Kanaren gerade von UTC entfernt sind (Winter 0, Sommer +60). */
function canaryOffsetMinutes(ref: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Atlantic/Canary',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(ref)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return Math.round((asUtc - ref.getTime()) / 60000)
}

function shiftDay(day: string, delta: number): string {
  const [y, mo, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y, (mo || 1) - 1, d || 1))
  date.setUTCDate(date.getUTCDate() + delta)
  return date.toISOString().slice(0, 10)
}

/** Kanarische Wanduhr-Zeit → absoluter Zeitpunkt. */
export function canaryWallToDate(day: string, clock: string, ref: Date = new Date()): Date {
  const [y, mo, d] = day.split('-').map(Number)
  const [h, mi] = clock.split(':').map(Number)
  const offset = canaryOffsetMinutes(ref)
  return new Date(Date.UTC(y, (mo || 1) - 1, d || 1, h || 0, mi || 0) - offset * 60000)
}

export interface WakeSlot {
  proposal: TripProposal
  /** Zeitpunkt, zu dem die Notification kommen soll */
  at: Date
  /** Los-Zeit als 'HH:MM' */
  startsAt: string
  lead: number
}

/** Alle aktiven Wecker, aufsteigend nach Zeitpunkt. */
export function wakeSlots(proposals: TripProposal[], ref: Date = new Date()): WakeSlot[] {
  return proposals
    .filter((p) => p.remind_enabled && p.starts_at)
    .map((p) => {
      const lead = p.remind_before ?? DEFAULT_LEAD
      const clock = reminderClock(p.starts_at, lead)
      if (!clock) return null
      // Vorlauf über Mitternacht: 00:10 mit 30 Min klingelt am VORTAG um 23:40,
      // nicht am selben Tag (das wäre 40 Minuten nach dem Start).
      const dueMinutes = minutesOf(p.starts_at as string) - lead
      const dueDay = dueMinutes < 0 ? shiftDay(p.day, -1) : p.day
      return {
        proposal: p,
        at: canaryWallToDate(dueDay, clock, ref),
        startsAt: hhmm(p.starts_at),
        lead,
      }
    })
    .filter((slot): slot is WakeSlot => slot !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
}

/** Der nächste Wecker, der noch kommt (null, wenn keiner mehr ansteht). */
export function nextWake(proposals: TripProposal[], now: Date = new Date()): WakeSlot | null {
  return wakeSlots(proposals, now).find((slot) => slot.at.getTime() > now.getTime()) ?? null
}

/** Klingelt dieser Wecker jetzt (innerhalb der letzten Minute)? */
export function wakeFired(slot: WakeSlot, now: Date): boolean {
  const delta = now.getTime() - slot.at.getTime()
  return delta >= 0 && delta < 60_000
}

/**
 * Notification über den Service Worker. Nur ein Komfortpfad: ohne Erlaubnis
 * oder ohne SW passiert nichts, der Push vom Server kommt trotzdem.
 */
export async function showWakeNotification(slot: WakeSlot): Promise<void> {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    const registration = await navigator.serviceWorker?.ready
    if (!registration) return
    const place = slot.proposal.place ? ` · ${slot.proposal.place.split('·')[0].trim()}` : ''
    const title = slot.lead === 0
      ? `Jetzt los: ${slot.proposal.title}`
      : `In ${slot.lead} Min: ${slot.proposal.title}`
    await registration.showNotification(title, {
      body: `${slot.startsAt} los${place}.`,
      icon: '/FiestaSiesta/icon-192.png',
      tag: `fiesta-wake-${slot.proposal.id}`,
      data: { url: '/FiestaSiesta/?tab=plan', kind: 'wake', proposalId: slot.proposal.id },
    })
  } catch {
    // Kein SW (Dev) oder Erlaubnis entzogen — der Cron-Push deckt es ab.
  }
}
