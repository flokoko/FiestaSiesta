// ── Lokaler Wecker-Timer ────────────────────────────────────────────
// Klingelt, während die App offen ist — ohne auf den 5-Minuten-Cron zu warten.
// Ist die App zu, übernimmt der Push aus der Edge Function `reminder`.

import { useEffect } from 'react'
import type { TripPlanMap } from './useTripPlan'
import { nextWake, showWakeNotification, type WakeSlot } from '../lib/wake'
import type { TripProposal } from '../types'

/** Längster Timer, den wir setzen: alles darüber wäre bei einem Reload ohnehin neu. */
const MAX_DELAY_MS = 12 * 60 * 60 * 1000

export function useWakeTimer(plan: TripPlanMap): void {
  useEffect(() => {
    const proposals = Object.values(plan)
      .flatMap((day) => Object.values(day))
      .filter((p): p is TripProposal => Boolean(p))
    const upcoming = nextWake(proposals)
    if (!upcoming) return

    const delay = upcoming.at.getTime() - Date.now()
    if (delay <= 0 || delay > MAX_DELAY_MS) return

    const timer = window.setTimeout(() => {
      void showWakeNotification(upcoming as WakeSlot)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [plan])
}
