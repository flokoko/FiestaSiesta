// ── Lokaler Wecker-Timer ────────────────────────────────────────────
// Klingelt, während die App offen ist — ohne auf den 5-Minuten-Cron zu warten.
// Ist die App zu, übernimmt der Push aus der Edge Function `reminder`.
//
// Es klingelt nur der BESTÄTIGTE Plan (Entscheidung 31.10.2026), genau wie beim
// Server. Ein Vorschlag, der eine Abstimmung verliert, ist stumm.

import { useEffect, useState } from 'react'
import type { TripPlanMap } from './useTripPlan'
import { nextWake, showWakeNotification, wakeFired } from '../lib/wake'
import type { TripProposal } from '../types'

/** Längster Einzel-Timer. Reiseplanung am Vorabend liegt oft 12–15 h entfernt. */
const MAX_DELAY_MS = 26 * 60 * 60 * 1000

export function useWakeTimer(plan: TripPlanMap): void {
  // Nach dem Klingeln neu armieren — sonst feuert nur der erste Wecker des Tages.
  const [round, setRound] = useState(0)

  useEffect(() => {
    const proposals = Object.values(plan)
      .flatMap((day) => Object.values(day))
      .filter((p): p is TripProposal => Boolean(p) && Boolean(p?.confirmed_at))
    const upcoming = nextWake(proposals)
    if (!upcoming) return

    const delay = upcoming.at.getTime() - Date.now()
    if (delay <= 0 || delay > MAX_DELAY_MS) return

    const timer = window.setTimeout(() => {
      // Ein gedrosselter Hintergrund-Timer feuert oft Minuten bis Stunden später.
      // Nur benachrichtigen, wenn der Zeitpunkt wirklich jetzt ist.
      if (wakeFired(upcoming, new Date())) void showWakeNotification(upcoming)
      setRound((n) => n + 1)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [plan, round])
}
