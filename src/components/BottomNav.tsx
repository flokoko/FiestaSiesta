import { useLayoutEffect, useRef, useState } from 'react'
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

  const navRef = useRef<HTMLElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  // „Mehr" steht hinter den vier Domänen; bei offenem Blatt wandert die Pille dorthin.
  const activeIndex = moreOpen ? items.length : items.findIndex(({ key }) => key === activeDomain)

  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)
  // Erst nach dem ersten Messen animieren — sonst fährt die Pille beim
  // Seitenaufbau sichtbar von links herein.
  const [gliding, setGliding] = useState(false)

  useLayoutEffect(() => {
    const measure = () => {
      const el = activeIndex >= 0 ? itemRefs.current[activeIndex] : null
      if (!el) return
      setPill({ left: el.offsetLeft, width: el.offsetWidth })
    }

    measure()
    const raf = requestAnimationFrame(() => setGliding(true))

    // Breite kann sich nach dem Font-Tausch oder bei Rotation ändern.
    const ro = new ResizeObserver(measure)
    if (navRef.current) ro.observe(navRef.current)
    document.fonts?.ready.then(measure).catch(() => {})

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [activeIndex])

  return (
    <nav
      className={`bottom-nav${gliding ? ' is-gliding' : ''}`}
      aria-label="Hauptnavigation"
      ref={navRef}
    >
      {pill && (
        <span
          className="bottom-nav-pill"
          aria-hidden="true"
          style={{ transform: `translate3d(${pill.left}px, 0, 0)`, width: `${pill.width}px` }}
        />
      )}
      {items.map(({ key, label, icon: Icon }, index) => {
        const isActive = !moreOpen && activeDomain === key
        return (
          <button
            key={key}
            type="button"
            ref={(el) => { itemRefs.current[index] = el }}
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
        ref={(el) => { itemRefs.current[items.length] = el }}
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
