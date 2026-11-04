import { useEffect, useState } from 'react'
import { canaryClock } from '../lib/liveWeather'

/**
 * Datum und Uhrzeit an der Unterkunft, alle 30 Sekunden neu. Die Kanaren
 * liegen eine Stunde hinter Deutschland — kurz nach Mitternacht ist dort
 * noch der Vortag, deshalb reicht ein einmaliger Wert beim Mount nicht.
 */
export function useCanaryClock(): { date: string; time: string } {
  const [clock, setClock] = useState(() => canaryClock())
  useEffect(() => {
    const timer = window.setInterval(() => setClock(canaryClock()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return clock
}
