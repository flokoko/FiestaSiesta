import { useEffect } from 'react'
import { Sun, Moon, CloudSun, StickyNote, Settings, LogOut, X } from 'lucide-react'
import type { TabView } from '../types'

interface MoreSheetProps {
  open: boolean
  onClose: () => void
  onNavigate: (tab: TabView) => void
  isDark: boolean
  onToggleTheme: () => void
  onLeave: () => void
  userName: string
}

export default function MoreSheet({
  open, onClose, onNavigate, isDark, onToggleTheme, onLeave, userName,
}: MoreSheetProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

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
            <span>{userName}</span>
            <button type="button" className="more-close" onClick={onClose} aria-label="Schließen">
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

        <button type="button" className="more-leave" onClick={() => { onLeave(); onClose() }}>
          <LogOut size={15} strokeWidth={2} /> Abmelden
        </button>
      </div>
    </div>
  )
}
