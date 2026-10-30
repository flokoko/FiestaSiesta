import { useState, useCallback, useRef, useEffect } from 'react'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastItem {
  id: string
  message: string
  type: 'success' | 'error' | 'info' | 'confirm'
  action?: ToastAction
  onConfirm?: () => void
  onCancel?: () => void
  confirmLabel?: string
  dismissing?: boolean
  duration: number
}

let toastIdCounter = 0

export function useToastState() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const clearTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  const dismiss = useCallback((id?: string) => {
    if (id) {
      clearTimer(id)
      setToasts((prev) => prev.map((t) => t.id === id ? { ...t, dismissing: true } : t))
      // 500 ms = Länge von toast-slide-out; bei 300 ms verschwand der Toast
      // mitten in seiner eigenen Animation.
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, 500)
    } else {
      timersRef.current.forEach((timer) => clearTimeout(timer))
      timersRef.current.clear()
      setToasts([])
    }
  }, [clearTimer])

  const scheduleDismiss = useCallback((id: string, duration: number) => {
    const timer = setTimeout(() => dismiss(id), duration)
    timersRef.current.set(id, timer)
  }, [dismiss])

  const toast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info', action?: ToastAction) => {
    const id = `toast-${++toastIdCounter}`
    const duration = action ? 6000 : 4000
    const newItem: ToastItem = { id, message, type, action, duration }

    setToasts((prev) => {
      // Max 3 Toasts. Bestätigungs- und Aktions-Toasts werden nie
      // weggeschoben — sonst verschwindet mitten im Löschen das „Abbrechen"
      // bzw. das „Rückgängig". Notfalls bleibt die Schlange kurz länger.
      let next = [...prev, newItem]
      while (next.length > 3) {
        const idx = next.findIndex((t) => !t.onConfirm && !t.action)
        if (idx < 0) break
        clearTimer(next[idx].id)
        next.splice(idx, 1)
      }
      return next
    })

    scheduleDismiss(id, duration)
  }, [clearTimer, scheduleDismiss])

  const confirm = useCallback((message: string, onConfirm: () => void, onCancel?: () => void, confirmLabel?: string) => {
    const id = `toast-${++toastIdCounter}`
    // Knopftext aus der Frage ableiten, wenn keiner übergeben wurde: bei
    // „… wirklich löschen?“ ist „Bestätigen“ die falsche Antwort.
    const label = confirmLabel
      ?? (/löschen|lösche/i.test(message) ? 'Löschen'
        : /entfernen/i.test(message) ? 'Entfernen'
          : /freigeben/i.test(message) ? 'Freigeben'
            : /übernehmen/i.test(message) ? 'Übernehmen'
              : 'Bestätigen')
    const newItem: ToastItem = {
      id,
      message,
      type: 'confirm',
      onConfirm,
      onCancel,
      confirmLabel: label,
      duration: 10000,
    }

    setToasts((prev) => {
      let next = [...prev, newItem]
      // Bestätigungen nie wegwerfen (siehe toast()): nur informative Toasts
      // rotieren. Bleiben mehr als 3 offene Fragen stehen, ist das ehrlicher
      // als eine stillschweigend verschwundene Entscheidung.
      while (next.length > 3) {
        const idx = next.findIndex((t) => !t.onConfirm && !t.action)
        if (idx < 0) break
        clearTimer(next[idx].id)
        next.splice(idx, 1)
      }
      return next
    })

    // Kein Auto-Dismiss: Der Dialog bleibt, bis der Nutzer entscheidet.
  }, [clearTimer])

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer))
      timersRef.current.clear()
    }
  }, [])

  return { toasts, toast, dismiss, confirm }
}