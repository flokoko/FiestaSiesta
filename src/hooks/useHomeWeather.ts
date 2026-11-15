// ── useHomeWeather ───────────────────────────────────────────────────
// Dünner Hook um lib/homeWeather: beim Mount laden, danach nur, wenn die
// App sichtbar wieder auftaucht (höchstens alle 10 Minuten). Kein Polling
// und kein zweiter Abruf pro Blick auf den Tag-Screen — den 60-Minuten-
// Cache im lib hat man ohnehin, dies hier spart zusätzlich das Neu-Lesen.

import { useEffect, useState } from 'react'
import {
  fetchHomeWeather,
  readHomePlace,
  type HomePlace,
  type HomeWeather,
} from '../lib/homeWeather'

export interface HomeWeatherState {
  /** Heimatort, wie er jetzt im localStorage steht */
  home: HomePlace | null
  /** zuletzt geladene Lage am Heimatort, null ohne Ort oder nach Fehler */
  weather: HomeWeather | null
}

/** Mindestabstand zwischen zwei Sichtbarkeits-Läufen. */
const WAKE_MS = 10 * 60 * 1000

export function useHomeWeather(): HomeWeatherState {
  const [home, setHome] = useState<HomePlace | null>(() => readHomePlace())
  const [weather, setWeather] = useState<HomeWeather | null>(null)

  useEffect(() => {
    let alive = true
    let lastAt = 0

    const wake = () => {
      // visibilitychange feuert auch beim Verstecken — dann laden wir nicht.
      if (document.hidden) return
      const now = Date.now()
      if (now - lastAt < WAKE_MS) return
      lastAt = now

      const current = readHomePlace()
      // Auch das Entfernen in den Einstellungen landet hier — der Screen
      // bleibt als Pane gerendert, er verliert nur den Sichtbarkeitsfokus.
      setHome(current)
      if (!current) {
        setWeather(null)
        return
      }
      void fetchHomeWeather(current).then((value) => {
        if (alive) setWeather(value)
      })
    }

    // Mount: sofort laden (der 60-Minuten-Cache im lib hält es günstig).
    lastAt = Date.now()
    wake()

    document.addEventListener('visibilitychange', wake)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', wake)
    }
  }, [])

  return { home, weather }
}
