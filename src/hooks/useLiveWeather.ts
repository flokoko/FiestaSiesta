import { useEffect, useState } from 'react'
import { cachedLiveWeather, fetchLiveWeather } from '../lib/liveWeather'
import type { LiveWeather } from '../lib/liveWeather'

/** Auffrischen beim Zurückkehren in die App (Cache ist 20 Min frisch). */
const REFRESH_MS = 30 * 60 * 1000

/**
 * Aktuelle Wetterlage am Zielort für die Heute-Karte. Startet mit dem
 * gespeicherten Stand (sofort sichtbar, auch offline) und zieht nach.
 */
export function useLiveWeather(): LiveWeather | null {
  const [data, setData] = useState<LiveWeather | null>(() => cachedLiveWeather())

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const next = await fetchLiveWeather()
      if (!cancelled && next) setData(next)
    }
    void load()

    const onVisible = () => {
      if (!document.hidden) void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => {
      if (!document.hidden) void load()
    }, REFRESH_MS)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [])

  return data
}
