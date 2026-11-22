import { Suspense, lazy, memo } from 'react'
import { ChefHat, ShoppingBasket } from 'lucide-react'
import type { ItemCategory, ListItem, ListType } from '../types'
import './KuecheScreen.css'

const ListScreen = lazy(() => import('./ListScreen'))
const RecipesScreen = lazy(() => import('./RecipesScreen'))

export type KuecheSegment = 'shopping' | 'recipes'

interface Props {
  /** Welches Segment sichtbar ist — der Rahmen hält den Zustand (App). */
  segment: KuecheSegment
  onSegment: (segment: KuecheSegment) => void

  // ── Einkaufsliste (identisch zum ListScreen-Aufruf) ──
  items: ListItem[]
  categories: ItemCategory[]
  listId: string
  userName: string
  isLoading?: boolean
  onItemToggle?: (item: ListItem) => void
  onBatchToggle?: (items: ListItem[], checked: boolean) => void
  onItemDelete?: (item: ListItem) => void
  onItemChange?: () => void
  onReorder?: (listType: ListType, newOrder: string[]) => void
  onCategoriesChange?: () => void
  onOptimisticAdd?: (payload: Record<string, unknown>) => string | undefined
  /** Pull-to-Refresh im Einkaufslisten-Segment. */
  onRefresh?: () => Promise<void>
}

const MemoList = memo(ListScreen)
const MemoRecipes = memo(RecipesScreen)

/**
 * Küche = ein Rahmen, zwei Funktionen. Oben eine Leiste mit beiden Wegen,
 * **Einkaufsliste links und standardmäßig aktiv** — das ist der Alltagsfall
 * (einkaufen), Rezepte sind der zweite Weg (Ideen).
 *
 * Beide Segmente bleiben gemountet und werden nur versteckt: der Wechsel soll
 * nicht jedes Mal neu laden, und der Realtime-Abgleich läuft weiter.
 */
export default function KuecheScreen({
  segment,
  onSegment,
  items,
  categories,
  listId,
  userName,
  isLoading,
  onItemToggle,
  onBatchToggle,
  onItemDelete,
  onItemChange,
  onReorder,
  onCategoriesChange,
  onOptimisticAdd,
  onRefresh,
}: Props) {
  const openCount = items.filter((item) => !item.is_checked).length

  return (
    <div className="kueche-screen">
      <header className="list-head">
        <div className="list-head-text">
          <h1>Küche</h1>
        </div>
      </header>

      <div className="kueche-seg" role="tablist" aria-label="Küchenfunktionen" data-seg={segment}>
        {/* Der helle Untergrund gleitet mit, statt zu springen — ein Element,
            das per transform wandert, ist billiger als zwei Flächen, die
            gleichzeitig faden. */}
        <span className="kueche-seg-ind" aria-hidden="true" />
        <button
          type="button"
          role="tab"
          id="kueche-tab-shopping"
          aria-selected={segment === 'shopping'}
          aria-controls="kueche-panel-shopping"
          className={`kueche-seg-btn${segment === 'shopping' ? ' is-active' : ''}`}
          onClick={() => onSegment('shopping')}
        >
          <ShoppingBasket size={15} strokeWidth={2} aria-hidden="true" />
          Einkaufsliste
          {openCount > 0 && (
            <span className="kueche-seg-count" key={openCount}>{openCount}</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          id="kueche-tab-recipes"
          aria-selected={segment === 'recipes'}
          aria-controls="kueche-panel-recipes"
          className={`kueche-seg-btn${segment === 'recipes' ? ' is-active' : ''}`}
          onClick={() => onSegment('recipes')}
        >
          <ChefHat size={15} strokeWidth={2} aria-hidden="true" />
          Rezepte
        </button>
      </div>

      <div
        id="kueche-panel-shopping"
        role="tabpanel"
        aria-labelledby="kueche-tab-shopping"
        hidden={segment !== 'shopping'}
      >
        <Suspense fallback={null}>
          <MemoList
            embedded
            items={items}
            categories={categories}
            listId={listId}
            userName={userName}
            isLoading={isLoading}
            onItemToggle={onItemToggle}
            onBatchToggle={onBatchToggle}
            onItemDelete={onItemDelete}
            onItemChange={onItemChange}
            onReorder={onReorder}
            onCategoriesChange={onCategoriesChange}
            onOptimisticAdd={onOptimisticAdd}
            onRefresh={onRefresh}
          />
        </Suspense>
      </div>

      <div
        id="kueche-panel-recipes"
        role="tabpanel"
        aria-labelledby="kueche-tab-recipes"
        hidden={segment !== 'recipes'}
      >
        <Suspense fallback={null}>
          <MemoRecipes embedded listId={listId} userName={userName} />
        </Suspense>
      </div>
    </div>
  )
}
