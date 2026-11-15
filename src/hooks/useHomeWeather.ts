// ── useHomeWeather ───────────────────────────────────────────────────
// Dünner Hook um lib/homeWeather: beim Mount laden, danach nur, wenn die
// App sichtbar wieder auftaucht (höchstens alle 10 Minuten). Kein Polling
// und kein zweiter Abruf pro Blick auf den Tag-Screen — den 60-Minuten-
// Cache im lib hat man ohnehin, dies hier spart zusätzlich das Neu-Lesen.
//
// Der Ort kommt aus `effectiveHomePlace(userName)`: eigene Geräteeinstellung
// vor dem Standard des Namens (München/Landshut). Ohne `userName` bleibt die
// Zeile aus — dann gibt es keinen Standard.

import { useEffect, useState } from 'react'
import {
  HOME_CHANGE_EVENT,
  effectiveHomePlace,
  fetchHomeWeather,
  type HomePlace,
  type HomeWeather,
} from '../lib/homeWeather'

export interface HomeWeatherState {
  /** Heimatort, der gerade gilt (Geräteeinstellung oder Standard des Namens) */
  home: HomePlace | null
  /** zuletzt geladene Lage am Heimatort, null ohne Ort oder nach Fehler */
  weather: HomeWeather | null
}

/** Mindestabstand zwischen zwei Sichtbarkeits-Läufen. */
const WAKE_MS = 10 * 60 * 1000

export function useHomeWeather(userName: string): HomeWeatherState {
  const [home, setHome] = useState<HomePlace | null>(() => effectiveHomePlace(userName))
  const [weather, setWeather] = useState<HomeWeather | null>(null)

  useEffect(() => {
    let alive = true
    let lastAt = 0

    /**
     * `force` gilt nur für den Mount: im Hintergrund-Tab (oder wenn die PWA aus
     * dem Standby startet) ist `document.hidden` beim ersten Render true — die
     * Zeile blieb dann bis zum ersten Sichtbarwerden leer. Der Guard unten ist
     * für `visibilitychange` gedacht, das auch beim Verstecken feuert.
     */
    const wake = (force = false) => {
      if (!force && document.hidden) return
      const now = Date.now()
      // Beim Mount MUSS der erste Lauf durch — vorher stand hier
      // `lastAt = Date.now()` direkt vor `wake()`, damit war der Abstand 0 und
      // die Drossel verschluckte genau den Ladevorgang (die Zeile blieb leer,
      // bis die App einmal in den Hintergrund und zurück ging).
      if (!force && now - lastAt < WAKE_MS) return
      lastAt = now

      const current = effectiveHomePlace(userName)
      // Auch das Ändern/Entfernen in den Einstellungen landet hier — der Screen
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
    wake(true)

    // Änderung in den Einstellungen sofort übernehmen (der Screen bleibt
    // gemountet, visibilitychange feuert dabei nicht).
    const onHomeChange = () => wake(true)
    // Eigener Handler statt `wake` direkt: `wake` nimmt jetzt `force` entgegen,
    // als Event-Listener bekäme es das Event-Objekt als erstes Argument.
    const onVisible = () => wake()

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener(HOME_CHANGE_EVENT, onHomeChange)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener(HOME_CHANGE_EVENT, onHomeChange)
    }
  }, [userName])

  return { home, weather }
}
