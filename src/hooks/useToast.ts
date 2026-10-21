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
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, 300)
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
      // Max 3 toasts — dismiss oldest
      let next = [...prev, newItem]
      while (next.length > 3) {
        const oldest = next[0]
        clearTimer(oldest.id)
        next = next.slice(1)
      }
      return next
    })

    scheduleDismiss(id, duration)
  }, [clearTimer, scheduleDismiss])

  const confirm = useCallback((message: string, onConfirm: () => void, onCancel?: () => void) => {
    const id = `toast-${++toastIdCounter}`
    const newItem: ToastItem = {
      id,
      message,
      type: 'confirm',
      onConfirm,
      onCancel,
      duration: 10000,
    }

    setToasts((prev) => {
      let next = [...prev, newItem]
      while (next.length > 3) {
        const oldest = next[0]
        clearTimer(oldest.id)
        next = next.slice(1)
      }
      return next
    })

    scheduleDismiss(id, 10000)
  }, [clearTimer, scheduleDismiss])

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer))
      timersRef.current.clear()
    }
  }, [])

  return { toasts, toast, dismiss, confirm }
}