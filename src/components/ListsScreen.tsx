import { ShoppingCart, Backpack, ChevronRight } from 'lucide-react'
import type { TabView } from '../types'

interface ListsScreenProps {
  shoppingCount: number
  shoppingChecked: number
  bringCount: number
  bringBrought: number
  onNavigate: (tab: TabView) => void
}

export default function ListsScreen({
  shoppingCount, shoppingChecked, bringCount, bringBrought, onNavigate,
}: ListsScreenProps) {
  const shoppingOpen = Math.max(0, shoppingCount - shoppingChecked)
  const bringOpen = Math.max(0, bringCount - bringBrought)
  const shoppingProgress = shoppingCount === 0 ? 0 : Math.round((shoppingChecked / shoppingCount) * 100)
  const bringProgress = bringCount === 0 ? 0 : Math.round((bringBrought / bringCount) * 100)

  return (
    <div className="lists-domain">
      <header className="lists-head">
        <h1>Listen</h1>
        <p>Zwei Listen, ein Join-Code — alles landet sofort bei allen.</p>
      </header>

      <button type="button" className="lists-card" onClick={() => onNavigate('list')}>
        <span className="lists-card-icon"><ShoppingCart size={19} strokeWidth={2} /></span>
        <span className="lists-card-body">
          <strong>Einkaufsliste</strong>
          <small>{shoppingOpen === 1 ? '1 Artikel offen' : `${shoppingOpen} Artikel offen`}</small>
          <span className="lists-bar"><i style={{ width: `${shoppingProgress}%` }} /></span>
        </span>
        <ChevronRight size={17} strokeWidth={2} className="lists-card-chevron" />
      </button>

      <button type="button" className="lists-card" onClick={() => onNavigate('bring')}>
        <span className="lists-card-icon"><Backpack size={19} strokeWidth={2} /></span>
        <span className="lists-card-body">
          <strong>Mitbringen</strong>
          <small>{bringOpen === 1 ? '1 Sache offen' : `${bringOpen} Sachen offen`}</small>
          <span className="lists-bar"><i style={{ width: `${bringProgress}%` }} /></span>
        </span>
        <ChevronRight size={17} strokeWidth={2} className="lists-card-chevron" />
      </button>
    </div>
  )
}
