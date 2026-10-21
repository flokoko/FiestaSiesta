import { createContext, useContext, type ReactNode } from 'react'
import { useToastState, type ToastAction } from '../hooks/useToast'
import Toast from '../components/Toast'

interface ToastContextValue {
  toast: (message: string, type?: 'success' | 'error' | 'info', action?: ToastAction) => void
  dismiss: (id?: string) => void
  confirm: (message: string, onConfirm: () => void, onCancel?: () => void) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const { toasts, toast, dismiss, confirm } = useToastState()

  return (
    <ToastContext.Provider value={{ toast, dismiss, confirm }}>
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