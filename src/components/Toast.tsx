import { useEffect, useRef } from 'react'
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react'
import type { ToastItem } from '../hooks/useToast'
import './Toast.css'

interface ToastProps {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  confirm: AlertTriangle,
} as const

function ToastEntry({ t, onDismiss }: { t: ToastItem; onDismiss: (id: string) => void }) {
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null)

  // Bestätigungs-Toast: Fokus direkt auf den Bestätigen-Knopf setzen,
  // damit Tastatur-/Screenreader-Nutzer sofort entscheiden können.
  useEffect(() => {
    if (t.type === 'confirm') {
      confirmBtnRef.current?.focus()
    }
  }, [t.type])

  const Icon = ICONS[t.type]
  return (
    <div
      className={`toast toast-${t.type} ${t.dismissing ? 'toast-dismissing' : ''}`}
      role={t.type === 'confirm' ? 'alertdialog' : t.type === 'info' ? 'status' : 'alert'}
      aria-live={t.type === 'confirm' ? 'assertive' : undefined}
      aria-atomic={t.type === 'confirm' ? undefined : true}
    >
      <span className="toast-icon">
        <Icon size={20} strokeWidth={2} />
      </span>
      <span className="toast-message">{t.message}</span>
      {t.type === 'confirm' ? (
        <div className="toast-actions">
          <button
            className="toast-btn toast-btn-cancel"
            onClick={(e) => {
              e.stopPropagation()
              t.onCancel?.()
              onDismiss(t.id)
            }}
          >
            Abbrechen
          </button>
          <button
            ref={confirmBtnRef}
            className="toast-btn toast-btn-confirm"
            onClick={(e) => {
              e.stopPropagation()
              t.onConfirm?.()
              onDismiss(t.id)
            }}
          >
            {t.confirmLabel ?? 'Bestätigen'}
          </button>
        </div>
      ) : (
        <>
          {t.action && (
            <div className="toast-actions">
              <button
                className="toast-btn toast-btn-undo"
                onClick={(e) => {
                  e.stopPropagation()
                  t.action!.onClick()
                  onDismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            </div>
          )}
          <button
            className="toast-close"
            onClick={(e) => {
              e.stopPropagation()
              onDismiss(t.id)
            }}
            aria-label="Schließen"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </>
      )}
    </div>
  )
}

export default function Toast({ toasts, onDismiss }: ToastProps) {
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <ToastEntry key={t.id} t={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
