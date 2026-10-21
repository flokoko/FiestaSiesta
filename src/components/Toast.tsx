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

export default function Toast({ toasts, onDismiss }: ToastProps) {
  return (
    <div className="toast-container" aria-live="polite" aria-atomic="true">
      {toasts.map((t) => {
        const Icon = ICONS[t.type]
        return (
          <div
            key={t.id}
            className={`toast toast-${t.type} ${t.dismissing ? 'toast-dismissing' : ''}`}
            onClick={() => {
              if (t.type !== 'confirm') onDismiss(t.id)
            }}
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
                  className="toast-btn toast-btn-confirm"
                  onClick={(e) => {
                    e.stopPropagation()
                    t.onConfirm?.()
                    onDismiss(t.id)
                  }}
                >
                  Bestätigen
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
      })}
    </div>
  )
}