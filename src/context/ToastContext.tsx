import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useToastState, type ToastAction } from '../hooks/useToast'
import Toast from '../components/Toast'

interface ToastContextValue {
  toast: (message: string, type?: 'success' | 'error' | 'info', action?: ToastAction) => void
  dismiss: (id?: string) => void
  confirm: (message: string, onConfirm: () => void, onCancel?: () => void, confirmLabel?: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const { toasts, toast, dismiss, confirm } = useToastState()

  // Ohne useMemo ist `value` bei jedem Toast ein neues Objekt — dann rendert jeder
  // useToast()-Konsument neu, inklusive der gemounteten Screens mit Recharts/Leaflet.
  const value = useMemo(() => ({ toast, dismiss, confirm }), [toast, dismiss, confirm])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toast toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return ctx
}