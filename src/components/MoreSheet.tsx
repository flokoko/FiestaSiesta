import { useRef } from 'react'
import { Sun, Moon, CloudSun, StickyNote, Settings, LogOut, X, Activity, ShieldAlert } from 'lucide-react'
import { APP_VERSION } from '../version'
import type { TabView } from '../types'
import { useSheetFocus } from '../hooks/useSheetFocus'

interface MoreSheetProps {
  open: boolean
  onClose: () => void
  onNavigate: (tab: TabView) => void
  isDark: boolean
  onToggleTheme: () => void
  onLeave: () => void
  onEmergency: () => void
  userName: string
}

export default function MoreSheet({
  open, onClose, onNavigate, isDark, onToggleTheme, onLeave, onEmergency, userName,
}: MoreSheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  // Initialfokus auf den Schließen-Knopf — sonst landet er auf „Abmelden“.
  useSheetFocus(sheetRef, open, onClose, closeRef)

  if (!open) return null

  const entries: Array<{ label: string; hint: string; icon: typeof CloudSun; action: () => void }> = [
    {
      label: 'Wetter',
      hint: '7-Tage-Vorschau',
      icon: CloudSun,
      action: () => { onNavigate('weather'); onClose() },
    },
    {
      label: 'Notizen',
      hint: 'Kurznotizen & Favoriten',
      icon: StickyNote,
      action: () => { onNavigate('notes'); onClose() },
    },
    {
      label: 'Bristol',
      hint: 'Skala, Statistik, Gag',
      icon: Activity,
      action: () => { onNavigate('bristol'); onClose() },
    },
    {
      label: 'Notfall',
      hint: 'Notruf, Arzt, Adresse',
      icon: ShieldAlert,
      action: () => { onEmergency(); onClose() },
    },
    {
      label: 'Einstellungen',
      hint: 'Name, Passwort, Admin',
      icon: Settings,
      action: () => { onNavigate('settings'); onClose() },
    },
    {
      label: isDark ? 'Hell' : 'Dunkel',
      hint: 'Darstellung wechseln',
      icon: isDark ? Sun : Moon,
      action: () => { onToggleTheme(); onClose() },
    },
  ]

  return (
    <div className="more-scrim" role="presentation" onClick={onClose}>
      <div
        ref={sheetRef}
        className="more-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Weitere Bereiche"
        onClick={e => e.stopPropagation()}
      >
        <div className="more-grab" aria-hidden="true" />
        <div className="more-head">
          <h2>Mehr</h2>
          <div className="more-head-right">
            <span className="more-user">{userName} · v{APP_VERSION}</span>
            {/* Abmelden gehört in den Kopf: unten lag es direkt über der Bottom-Nav
                und wurde beim Tippen auf die Leiste versehentlich getroffen. */}
            <button
              type="button"
              className="more-leave more-leave-top"
              onClick={() => { onLeave(); onClose() }}
              aria-label="Abmelden"
            >
              <LogOut size={14} strokeWidth={2} /> <span>Abmelden</span>
            </button>
            <button ref={closeRef} type="button" className="more-close" onClick={onClose} aria-label="Schließen">
              <X size={16} strokeWidth={2.2} />
            </button>
          </div>
        </div>

        <div className="more-grid">
          {entries.map(({ label, hint, icon: Icon, action }) => (
            <button key={label} type="button" className="more-tile" onClick={action}>
              <span className="more-tile-icon"><Icon size={16} strokeWidth={2} /></span>
              <span className="more-tile-label">{label}</span>
              <span className="more-tile-hint">{hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
