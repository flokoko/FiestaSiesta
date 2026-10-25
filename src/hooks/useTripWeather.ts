import { useEffect, useMemo, useState } from 'react'
import { cachedTripForecast, fetchTripForecast } from '../lib/tripWeather'
import type { TripForecast } from '../lib/tripWeather'
import { daysUntilTrip, tripPhase } from '../lib/trip'

/** Open-Meteo liefert höchstens 16 Tage — weiter vorher ist die Karte sinnlos. */
const FORECAST_WINDOW_DAYS = 16

/**
 * Wetter-Vorschau für die Reisetage. Lädt nur, wenn die Reise im
 * Vorschaufenster liegt (sonst 16 nutzlose Abrufe pro App-Start),
 * und frischt beim Zurückkehren in die App auf.
 */
export function useTripWeather(): TripForecast {
  const [forecast, setForecast] = useState<TripForecast>(() => cachedTripForecast())

  const near = useMemo(
    () => tripPhase() !== 'after' && daysUntilTrip() <= FORECAST_WINDOW_DAYS,
    [],
  )

  useEffect(() => {
    if (!near) return
    let cancelled = false
    const load = async () => {
      const days = await fetchTripForecast()
      if (!cancelled && Object.keys(days).length > 0) setForecast(days)
    }
    void load()
    const onVisible = () => {
      if (!document.hidden) void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [near])

  return forecast
}
