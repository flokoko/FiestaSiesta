import { useRef, useState } from 'react'
import { X, Phone, HeartPulse, ShieldAlert, Navigation, MapPin, Copy, Check } from 'lucide-react'
import { useSheetFocus } from '../hooks/useSheetFocus'
import {
  EMERGENCY_HEADLINE, EMERGENCY_SECTIONS, EMERGENCY_FOOTNOTE,
} from '../lib/tripEmergency'
import type { EmergencyRow } from '../lib/tripEmergency'
import './EmergencySheet.css'

interface EmergencySheetProps {
  open: boolean
  onClose: () => void
}

const SECTION_ICON: Record<string, typeof Phone> = {
  sofort: ShieldAlert,
  gesundheit: HeartPulse,
  unterwegs: Navigation,
}

function RowAction({ row }: { row: EmergencyRow }) {
  const [copied, setCopied] = useState(false)
  const isPhone = row.href?.startsWith('tel:')

  const copy = async () => {
    if (!row.copy) return
    try {
      await navigator.clipboard.writeText(row.copy)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Zwischenablage gesperrt (älterer Browser, kein HTTPS-Kontext):
      // dann bleibt der Text zum Abschreiben stehen.
    }
  }

  if (!row.href && !row.copy) return null

  return (
    <div className="em-actions">
      {row.href && (
        <a className="em-action is-primary" href={row.href}>
          {isPhone ? <Phone size={14} strokeWidth={2.2} /> : <MapPin size={14} strokeWidth={2.2} />}
          {isPhone ? 'Anrufen' : 'Auf Karte'}
        </a>
      )}
      {row.copy && (
        <button type="button" className="em-action" onClick={() => void copy()}>
          {copied ? <Check size={14} strokeWidth={2.2} /> : <Copy size={14} strokeWidth={2.2} />}
          {copied ? 'Kopiert' : 'Kopieren'}
        </button>
      )}
    </div>
  )
}

export default function EmergencySheet({ open, onClose }: EmergencySheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  useSheetFocus(sheetRef, open, onClose, closeRef)

  if (!open) return null

  return (
    <div className="more-scrim" role="presentation" onClick={onClose}>
      <div
        ref={sheetRef}
        className="em-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={EMERGENCY_HEADLINE}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="more-grab" aria-hidden="true" />
        <header className="em-head">
          <div className="em-head-text">
            <h2>{EMERGENCY_HEADLINE}</h2>
            <p>Liegt offline in der App</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="em-close"
            onClick={onClose}
            aria-label="Schließen"
          >
            <X size={16} strokeWidth={2.2} />
          </button>
        </header>

        <div className="em-body">
          {EMERGENCY_SECTIONS.map((section) => {
            const Icon = SECTION_ICON[section.id] ?? Phone
            return (
              <section className="em-group" key={section.id}>
                <h3 className="em-group-title">
                  <Icon size={13} strokeWidth={2.2} />
                  {section.title}
                </h3>
                <div className="em-rows">
                  {section.rows.map((row) => (
                    <div className="em-row" key={row.label}>
                      <div className="em-row-label">{row.label}</div>
                      <div className="em-row-value">{row.value}</div>
                      {row.hint && <p className="em-row-hint">{row.hint}</p>}
                      <RowAction row={row} />
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
          <p className="em-footnote">{EMERGENCY_FOOTNOTE}</p>
        </div>
      </div>
    </div>
  )
}
