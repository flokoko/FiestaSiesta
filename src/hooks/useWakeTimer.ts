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
    // Vergangene Wecker klingen still ab (der Server-Cron hat sie längst geschickt
    // bzw. die Benachrichtigung wurde beim letzten Lauf gezeigt).
    if (delay <= 0) return

    if (delay > MAX_DELAY_MS) {
      // Weiter als 26 h entfernt: kein Einzel-Timer möglich. Ohne Wiedervorlage
      // bliebe der Wecker dauerhaft gar nicht armiert — der Vorlauf-Timer erhöht
      // nur `round`, danach rechnet der Effekt den verkürzten Abstand neu.
      const snooze = Math.min(MAX_DELAY_MS, delay - MAX_DELAY_MS + 60_000)
      const timer = window.setTimeout(() => setRound((n) => n + 1), snooze)
      return () => window.clearTimeout(timer)
    }

    const timer = window.setTimeout(() => {
      // Ein gedrosselter Hintergrund-Timer feuert oft Minuten bis Stunden später.
      // Nur benachrichtigen, wenn der Zeitpunkt wirklich jetzt ist.
      if (wakeFired(upcoming, new Date())) void showWakeNotification(upcoming)
      setRound((n) => n + 1)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [plan, round])
}
