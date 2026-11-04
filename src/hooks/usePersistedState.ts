import { useCallback, useState } from 'react'

/**
 * UI-Zustand, der ein Neuladen der App überlebt (letzter Tab-Abschnitt,
 * Listenfilter, gewählter Reisetag, …).
 *
 * Warum localStorage und nicht der Pane-Zustand? Die Screens bleiben gemountet,
 * ein Tab-Wechsel verliert also nichts. Verloren geht der Zustand erst beim
 * Neustart der PWA — genau dort (Supermarkt, App aus dem Hintergrund neu
 * gestartet) soll die Liste aber noch gefiltert sein.
 *
 * Werte werden als JSON abgelegt; `true`/`false` landen damit als `"true"`/
 * `"false"` in localStorage und bleiben zu älteren Schlüsseln kompatibel.
 * Fehler (Privatmodus, voller Speicher) dürfen die App nie brechen.
 */
export function usePersistedState<T>(key: string, initial: T | (() => T)) {
  const readInitial = () => (typeof initial === 'function' ? (initial as () => T)() : initial)

  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw === null) return readInitial()
      return JSON.parse(raw) as T
    } catch {
      return readInitial()
    }
  })

  const setPersisted = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        try {
          localStorage.setItem(key, JSON.stringify(resolved))
        } catch {
          // Speicher voll oder gesperrt — der Zustand gilt dann nur für die Sitzung.
        }
        return resolved
      })
    },
    [key],
  )

  return [value, setPersisted] as const
}
