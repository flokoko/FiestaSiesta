import { useRef } from 'react'
import { Sun, Moon, Settings, LogOut, X, Activity, Trophy, ChevronRight, UserRound } from 'lucide-react'
import type { TabView } from '../types'
import { useSheetFocus } from '../hooks/useSheetFocus'

interface MoreSheetProps {
  open: boolean
  onClose: () => void
  onNavigate: (tab: TabView) => void
  isDark: boolean
  onToggleTheme: () => void
  onLeave: () => void
  userName: string
}

interface Entry {
  label: string
  hint: string
  icon: typeof Settings
  action: () => void
}

/**
 * „Mehr" trägt nur noch, was an keiner Domäne hängt: Spiel & Spaß und App.
 * Wetter liegt auf der Wetterzeile der Tageskarte, Öffnungszeiten und Notizen
 * am Reiseplan — jeder Weg führt dorthin, wo die Information gebraucht wird.
 */
export default function MoreSheet({
  open, onClose, onNavigate, isDark, onToggleTheme, onLeave, userName,
}: MoreSheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  // Initialfokus auf den Schließen-Knopf — sonst landet er auf „Abmelden“.
  useSheetFocus(sheetRef, open, onClose, closeRef)

  if (!open) return null

  const go = (tab: TabView) => { onNavigate(tab); onClose() }

  const groups: Array<{ title: string; entries: Entry[] }> = [
    {
      title: 'Spiel & Spaß',
      entries: [
        { label: 'Quiz', hint: '15 Stufen, Rangliste', icon: Trophy, action: () => go('quiz') },
        { label: 'Bristol', hint: 'Skala, Statistik, Gag', icon: Activity, action: () => go('bristol') },
      ],
    },
  ]

  const appEntries: Entry[] = [
    { label: 'Einstellungen', hint: 'Name, Passwort, Admin', icon: Settings, action: () => go('settings') },
    {
      label: isDark ? 'Hell' : 'Dunkel',
      hint: 'Darstellung wechseln',
      icon: isDark ? Sun : Moon,
      action: () => { onToggleTheme(); onClose() },
    },
  ]

  const renderRows = (entries: Entry[]) => (
    <div className="more-rows">
      {entries.map(({ label, hint, icon: Icon, action }) => (
        <button key={label} type="button" className="more-row" onClick={action}>
          <span className="more-row-icon">
            <Icon size={16} strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="more-row-body">
            <span className="more-row-label">{label}</span>
            <span className="more-row-hint">{hint}</span>
          </span>
          <ChevronRight size={15} strokeWidth={2.2} className="more-row-chevron" aria-hidden="true" />
        </button>
      ))}
    </div>
  )

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
            {/* Version steht in den Einstellungen („Über") — hier kürzte sie
                nur den Namen ab. */}
            <span className="more-user">
              <UserRound size={13} strokeWidth={2.2} aria-hidden="true" />
              {userName}
            </span>
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

        {groups.map(({ title, entries }) => (
          <section key={title} className="more-group">
            <h3 className="more-group-title">{title}</h3>
            {renderRows(entries)}
          </section>
        ))}

        <section className="more-group">
          <h3 className="more-group-title">App</h3>
          {renderRows(appEntries)}
        </section>
      </div>
    </div>
  )
}
