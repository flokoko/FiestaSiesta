// ── Ziel-Wetter pro Planzeile ───────────────────────────────────────
// Eine Instanz reicht: die Reise-Tab-Karten fragen für ihre Planzeilen an,
// der Cache in poiWeather.ts hält die letzte Antwort auch offline.

import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchPoiWeather, pointKey, readPoiCache, type PoiForecast } from '../lib/poiWeather'

export interface PoiTarget {
  /** ISO-Datum des Plans */
  day: string
  lat: number | null
  lon: number | null
}

export function usePoiWeather(targets: PoiTarget[]): PoiForecast {
  const [forecast, setForecast] = useState<PoiForecast>(() => readPoiCache())

  // Stabile Kennung: die Liste der Ziele ändert sich bei jedem Render, die
  // daraus abgeleitete Zeichenkette nur, wenn wirklich ein Punkt dazukommt.
  const key = useMemo(
    () =>
      targets
        .filter((t) => typeof t.lat === 'number' && typeof t.lon === 'number')
        .map((t) => `${t.day}|${pointKey(t.lat as number, t.lon as number)}`)
        .sort()
        .join(';'),
    [targets],
  )

  const targetsRef = useRef(targets)
  targetsRef.current = targets

  useEffect(() => {
    if (!key) return
    let cancelled = false
    const rows = targetsRef.current
    const points = rows
      .filter((t) => typeof t.lat === 'number' && typeof t.lon === 'number')
      .map((t) => ({ lat: t.lat as number, lon: t.lon as number }))
    const days = rows.filter((t) => typeof t.lat === 'number').map((t) => t.day)
    if (points.length === 0) return

    void fetchPoiWeather(points, days).then((next) => {
      if (!cancelled) setForecast(next)
    })
    return () => {
      cancelled = true
    }
  }, [key])

  return forecast
}
