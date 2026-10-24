import { Home, Map, ListChecks, Wallet, Activity, type LucideIcon } from 'lucide-react'
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
  { key: 'bristol', label: 'Bristol', icon: Activity },
]

/** Tabs, die einer Navigations-Domäne zugeordnet sind */
const DOMAIN_OF: Partial<Record<TabView, TabView>> = {
  list: 'lists',
  bring: 'lists',
}

interface BottomNavProps {
  tab: TabView
  onNavigate: (tab: TabView) => void
  bristolEnabled: boolean
}

export default function BottomNav({ tab, onNavigate, bristolEnabled }: BottomNavProps) {
  const activeDomain = DOMAIN_OF[tab] ?? tab
  const items = ITEMS.filter(i => i.key !== 'bristol' || bristolEnabled)

  return (
    <nav className="bottom-nav" aria-label="Hauptnavigation">
      {items.map(({ key, label, icon: Icon }) => {
        const isActive = activeDomain === key
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
    </nav>
  )
}
