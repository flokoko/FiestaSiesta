import { Home, Map, ListChecks, Wallet, MoreHorizontal, type LucideIcon } from 'lucide-react'
import type { TabView } from '../types'

interface NavItem {
  key: TabView
  label: string
  icon: LucideIcon
}

const ITEMS: NavItem[] = [
  { key: 'home', label: 'Heute', icon: Home },
  { key: 'trip', label: 'Reise', icon: Map },
  { key: 'lists', label: 'Listen', icon: ListChecks },
  { key: 'expenses', label: 'Geld', icon: Wallet },
]

/** Tabs, die einer Navigations-Domäne zugeordnet sind */
const DOMAIN_OF: Partial<Record<TabView, TabView>> = {
  list: 'lists',
  bring: 'lists',
  notes: 'home',
  weather: 'home',
  settings: 'home',
  bristol: 'home',
}

interface BottomNavProps {
  tab: TabView
  onNavigate: (tab: TabView) => void
  onMore: () => void
  moreOpen: boolean
}

// Bristol lebt im Cockpit (Schnellzugriff) und im „Mehr"-Blatt — die Leiste
// bleibt damit bei vier Domänen plus „Mehr".
export default function BottomNav({ tab, onNavigate, onMore, moreOpen }: BottomNavProps) {
  const activeDomain = DOMAIN_OF[tab] ?? tab
  const items = ITEMS

  return (
    <nav className="bottom-nav" aria-label="Hauptnavigation">
      {items.map(({ key, label, icon: Icon }) => {
        const isActive = !moreOpen && activeDomain === key
        return (
          <button
            key={key}
            type="button"
            className={`bottom-nav-item${isActive ? ' active' : ''}`}
            onClick={() => onNavigate(key)}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon size={21} strokeWidth={isActive ? 2.4 : 1.9} />
            <span>{label}</span>
          </button>
        )
      })}
      <button
        type="button"
        className={`bottom-nav-item${moreOpen ? ' active' : ''}`}
        onClick={onMore}
        aria-expanded={moreOpen}
      >
        <MoreHorizontal size={21} strokeWidth={moreOpen ? 2.4 : 1.9} />
        <span>Mehr</span>
      </button>
    </nav>
  )
}
