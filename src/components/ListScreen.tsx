import { useState, useMemo, useRef, useEffect } from 'react'
import { Trash2, ShoppingBasket, GripVertical, ChevronDown, MoreHorizontal, Search, EyeOff, Eye, Settings2, X, ChefHat } from 'lucide-react'
import type { ListItem, ItemCategory, ListType } from '../types'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import { usePersistedState } from '../hooks/usePersistedState'
import { aggregateItems, type AggregatedItem } from '../lib/aggregate'
import ItemRow from './ItemRow'
import AddItemForm from './AddItemForm'
import EditItemForm from './EditItemForm'
import CategoryManager from './CategoryManager'
import { SkeletonCatHeader, SkeletonItemRow } from './Skeleton'

import { useDragReorder } from '../hooks/useDragReorder'
import { useSwipeDelete } from '../hooks/useSwipeDelete'
import { useSheetFocus } from '../hooks/useSheetFocus'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import PullIndicator from './PullIndicator'
import './ListScreen.css'

interface ListScreenProps {
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
  /** Offline-Pfad für AddItemForm — Temp-Zeile sofort im Elternteil sichtbar machen. */
  onOptimisticAdd?: (payload: Record<string, unknown>) => string | undefined
  /** Öffnet die Küche — Rezepte füllen genau diese Liste. */
  onOpenKitchen?: () => void
  /** Pull-to-Refresh am oberen Rand: alles frisch holen. */
  onRefresh?: () => Promise<void>
  /**
   * Eingebettet in der Küche (Segment „Einkaufsliste"): kein eigener Seitentitel,
   * kein Küche-Knopf — der Rahmen (Kopf + Leiste) gehört dann dem KuecheScreen.
   */
  embedded?: boolean
}

/** Stabile leere Liste — verhindert, dass useMemo im Kind bei jedem Render neu läuft. */
const EMPTY_ITEMS: ListItem[] = []

/**
 * Aggregierte Zeile (mehrere Items gruppiert): der Wisch-Hook braucht einen
 * eigenen Komponentenkörper — Hooks dürfen nicht im .map-Kopf stehen. Das
 * Markup ist die alte Inline-Zeile, nur in einer Zelle mit roter Unterlage.
 */
function AggregatedRow({
  agg,
  freshIds,
  isDragging,
  isDragOver,
  isExpanded,
  onToggleExpand,
  onToggleAggregated,
  onSubToggle,
  onDelete,
  onDragDown,
  onDragMove,
  onDragUp,
  registerRef,
}: {
  agg: AggregatedItem
  freshIds?: Set<string>
  isDragging: boolean
  isDragOver: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  onToggleAggregated: () => void
  onSubToggle: (item: ListItem) => void
  onDelete: () => void
  onDragDown: (e: ReactPointerEvent) => void
  onDragMove: (e: ReactPointerEvent) => void
  onDragUp: (e: ReactPointerEvent) => void
  registerRef: (el: HTMLDivElement | null) => void
}) {
  const swipe = useSwipeDelete(onDelete)

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    swipe.handlers.onPointerMove(e)
    onDragMove(e)
  }
  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    swipe.handlers.onPointerUp(e)
    onDragUp(e)
  }

  const rowClass = [
    'item-row',
    agg.isChecked ? 'checked' : '',
    isDragging ? 'dragging' : '',
    isDragOver ? 'drag-over' : '',
    agg.items.some((i) => freshIds?.has(i.id)) ? 'is-new' : '',
    swipe.dragging ? 'is-swiping' : '',
    swipe.settling ? 'swipe-settle' : '',
  ].filter(Boolean).join(' ')

  const rowStyle =
    swipe.dragging || swipe.settling || swipe.offset !== 0
      ? { transform: `translateX(${swipe.offset}px)` }
      : undefined

  return (
    <div className="swipe-cell swipe-cell-flat">
      <div className="swipe-under" aria-hidden="true">
        <span>Löschen</span>
        <Trash2 size={16} strokeWidth={2} />
      </div>
      <div
        className={rowClass}
        ref={registerRef}
        style={rowStyle}
        onPointerDown={swipe.handlers.onPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={swipe.handlers.onPointerCancel}
      >
        <span
          className="item-drag-handle"
          onPointerDown={onDragDown}
        >
          <GripVertical size={16} strokeWidth={2} />
        </span>
        <label className="item-checkbox-wrap">
          <input
            type="checkbox"
            checked={agg.isChecked}
            onChange={() => { onToggleAggregated(); navigator.vibrate?.(10) }}
          />
          <span className="item-checkmark" />
        </label>
        <div
          className="item-content"
          role="button"
          tabIndex={0}
          aria-expanded={isExpanded}
          aria-label={`${agg.name} — Einzelposten anzeigen`}
          onClick={onToggleExpand}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onToggleExpand()
            }
          }}
          style={{ cursor: 'pointer' }}
        >
          <span className="item-name">
            {agg.name}
            <span className="agg-badge" title={`${agg.count} Einträge`}>× {agg.count}</span>
          </span>
          <div className="item-meta">
            <span className="item-qty">{agg.displayQuantity}</span>
            <ChevronDown
              size={14}
              strokeWidth={2}
              style={{
                transition: 'transform 0.2s',
                transform: isExpanded ? 'rotate(180deg)' : 'none',
              }}
            />
          </div>
        </div>
        <button className="item-delete" onClick={onDelete} aria-label="Löschen">
          <Trash2 size={16} strokeWidth={2} />
        </button>

        {isExpanded && (
          <div className="agg-expanded">
            {agg.items.map((item) => (
              <div key={item.id} className="agg-sub-item">
                <label className="item-checkbox-wrap">
                  <input
                    type="checkbox"
                    checked={item.is_checked}
                    onChange={() => { onSubToggle(item); navigator.vibrate?.(10) }}
                  />
                  <span className="item-checkmark" />
                </label>
                <span className="agg-sub-name">{item.name}</span>
                <span className="agg-sub-qty">{item.quantity}</span>
                {item.created_by && <span className="agg-sub-by">von {item.created_by}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Wraps one category's items with independent drag-reorder + aggregation. */
function DraggableCategorySection({
  catItems,
  cat,
  onItemToggle,
  onBatchToggle,
  onItemDelete,
  onEdit,
  onReorder,
  freshIds,
}: {
  catItems: ListItem[]
  cat: ItemCategory
  onItemToggle?: (item: ListItem) => void
  onBatchToggle?: (items: ListItem[], checked: boolean) => void
  onItemDelete?: (item: ListItem) => void
  onEdit?: (item: ListItem) => void
  onReorder?: (newOrder: string[]) => void
  freshIds?: Set<string>
}) {
  const { confirm } = useToast()
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  // Aggregate items within this category
  const aggregated = useMemo(() => aggregateItems(catItems), [catItems])

  // For drag-reorder, we work with the group keys (first item's id per group)
  // but the drag hook needs items with { id: string } — we use AggregatedItem which has groupKey
  const dragItems = useMemo(() =>
    aggregated.map(a => ({ id: a.groupKey, ...a })), [aggregated])

  const {
    dragState,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    registerItem,
  } = useDragReorder<{ id: string }>(dragItems, (newOrder) => {
    // Map group keys back to all underlying item ids in order
    const allIds: string[] = []
    for (const key of newOrder) {
      const group = aggregated.find(a => a.groupKey === key)
      if (group) {
        for (const item of group.items) {
          allIds.push(item.id)
        }
      }
    }
    onReorder?.(allIds)
  })

  const checkedCount = catItems.filter((i) => i.is_checked).length

  const toggleExpand = (groupKey: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }

  const handleAggregatedToggle = (agg: AggregatedItem) => {
    // Use batch toggle (single API call) when available, fall back to per-item
    if (onBatchToggle) {
      onBatchToggle(agg.items, !agg.isChecked)
    } else {
      for (const item of agg.items) {
        onItemToggle?.(item)
      }
    }
  }

  const handleAggregatedDelete = (agg: AggregatedItem) => {
    confirm(`„${agg.name}“ (${agg.count} Einträge) wirklich löschen?`, () => {
      for (const item of agg.items) {
        onItemDelete?.(item)
      }
    })
  }

  return (
    <div className="cat-section">
      <div className="cat-header" data-cat={cat.name}>
        <span className="cat-dot" style={{ background: cat.color }} aria-hidden="true" />
        <span className="cat-title">{cat.name}</span>
        <span className="cat-count">
          {checkedCount}/{catItems.length}
        </span>
      </div>
      {aggregated.map((agg) => {
        const isDragging = dragState.draggingId === agg.groupKey
        const isDragOver = dragState.dragOverId === agg.groupKey
        const isExpanded = expandedGroups.has(agg.groupKey)

        if (!agg.isAggregated) {
          // Single item — render as normal ItemRow
          const item = agg.items[0]
          return (
            <ItemRow
              key={item.id}
              item={item}
              onToggle={onItemToggle}
              onDelete={onItemDelete}
              onEdit={onEdit}
              dragHandleProps={{
                onPointerDown: (e: ReactPointerEvent) => handlePointerDown(e, agg.groupKey),
                onPointerMove: handlePointerMove,
                onPointerUp: handlePointerUp,
              }}
              isDragging={isDragging}
              isDragOver={isDragOver}
              registerRef={(el) => registerItem(agg.groupKey, el)}
              isNew={freshIds?.has(item.id)}
            />
          )
        }

        return (
          <AggregatedRow
            key={agg.groupKey}
            agg={agg}
            freshIds={freshIds}
            isDragging={isDragging}
            isDragOver={isDragOver}
            isExpanded={isExpanded}
            onToggleExpand={() => toggleExpand(agg.groupKey)}
            onToggleAggregated={() => handleAggregatedToggle(agg)}
            onSubToggle={(item) => onItemToggle?.(item)}
            onDelete={() => handleAggregatedDelete(agg)}
            onDragDown={(e: ReactPointerEvent) => handlePointerDown(e, agg.groupKey)}
            onDragMove={handlePointerMove}
            onDragUp={handlePointerUp}
            registerRef={(el) => registerItem(agg.groupKey, el)}
          />
        )
      })}
    </div>
  )
}

export default function ListScreen({ items, categories, listId, userName, isLoading, onItemToggle, onBatchToggle, onItemDelete, onItemChange, onReorder, onCategoriesChange, onOptimisticAdd, onOpenKitchen, onRefresh, embedded }: ListScreenProps) {
  const { toast, confirm } = useToast()
  const [hideChecked, setHideChecked] = usePersistedState<boolean>('fiesta_hide_checked', false)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingItem, setEditingItem] = useState<ListItem | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [catsOpen, setCatsOpen] = useState(false)
  const [activeCat, setActiveCat] = usePersistedState<string | null>('fiesta_active_cat', null)

  // Pull-to-Refresh am oberen Rand — der Zustand (ptr.*) wird unten am
  // Screen-Rand als PullIndicator gerendert. Der Hook steht vor dem
  // isLoading-Rückprung (Rules of Hooks).
  const ptr = usePullToRefresh(onRefresh)

  const menuRef = useRef<HTMLDivElement | null>(null)
  useSheetFocus(menuRef, menuOpen, () => setMenuOpen(false))

  const toggleHideChecked = () => {
    navigator.vibrate?.(8)
    setHideChecked((prev: boolean) => !prev)
  }

  const checkedItems = items.filter((i) => i.is_checked)
  const openCount = items.length - checkedItems.length
  const progress = items.length === 0 ? 0 : Math.round((checkedItems.length / items.length) * 100)

  const handleDeleteChecked = () => {
    if (checkedItems.length === 0) return
    setMenuOpen(false)
    confirm('Alle erledigten Items löschen?', async () => {
      const { error } = await supabase.rpc('batch_delete_items', { item_ids: checkedItems.map(i => i.id) })
      if (error) {
        toast(`Fehler beim Löschen: ${error.message}`, 'error')
        return
      }
      onItemChange?.()
    })
  }

  // Suche (inkl. "Erledigte ausblenden") memoisiert — nicht bei jedem
  // Render neu filtern (z. B. bei Drag-State-Updates im Kind)
  const searchFiltered = useMemo(() => {
    const base = hideChecked ? items.filter((i) => !i.is_checked) : items
    const query = searchQuery.trim().toLowerCase()
    return query ? base.filter((i) => i.name.toLowerCase().includes(query)) : base
  }, [items, hideChecked, searchQuery])

  // Items einmal nach Kategorie gruppieren. Vorher entstand `catItems` beim
  // Rendern in der .map() jedes Mal neu — damit war jedes useMemo im Kind
  // (aggregateItems, dragItems) wirkungslos und lief bei jedem Tipp neu.
  const itemsByCategory = useMemo(() => {
    const map = new Map<string, ListItem[]>()
    for (const item of searchFiltered) {
      const bucket = map.get(item.category)
      if (bucket) bucket.push(item)
      else map.set(item.category, [item])
    }
    return map
  }, [searchFiltered])

  // Kategorie-Auswahl über die Wischleiste
  const shownCategories = activeCat ? categories.filter((c) => c.name === activeCat) : categories
  const chips = useMemo(
    () => categories
      .map((cat) => {
        const catItems = items.filter((i) => i.category === cat.name)
        const catOpen = catItems.filter((i) => !i.is_checked).length
        return { name: cat.name, color: cat.color, bg: cat.bg, open: catOpen, total: catItems.length }
      })
      .filter((c) => c.total > 0),
    [items, categories],
  )

  // Frisch dazugekommene Zeilen (nicht der erste Aufbau): sie laufen kurz ein.
  // Ohne diese Spur gäbe es online keine Entrance-Animation — dort entsteht
  // keine Temp-Zeile, der Datensatz kommt erst per Realtime.
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set())
  const seenIdsRef = useRef<Set<string> | null>(null)
  const freshTimerRef = useRef<number | null>(null)
  useEffect(() => {
    const ids = new Set(items.map((i) => i.id))
    if (seenIdsRef.current === null) {
      seenIdsRef.current = ids
      return
    }
    const added = [...ids].filter((id) => !seenIdsRef.current!.has(id))
    seenIdsRef.current = ids
    if (added.length === 0) return
    setFreshIds(new Set(added))
    // Der Timer darf NICHT im Effect-Cleanup hängen: der Realtime-Echo ändert
    // `items` direkt danach, der Cleanup würde ihn sonst abbrechen und die
    // Markierung bliebe für immer stehen.
    if (freshTimerRef.current !== null) window.clearTimeout(freshTimerRef.current)
    freshTimerRef.current = window.setTimeout(() => {
      setFreshIds(new Set())
      freshTimerRef.current = null
    }, 700)
  }, [items])

  useEffect(
    () => () => {
      if (freshTimerRef.current !== null) window.clearTimeout(freshTimerRef.current)
    },
    [],
  )

  // Skeleton loading state
  if (isLoading) {
    return (
      <div className="list-screen">
        <div className="list-top-bar">
          <div className="skeleton" style={{ width: '140px', height: '2rem', borderRadius: '8px' }} />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="cat-section">
            <SkeletonCatHeader />
            <SkeletonItemRow />
            <SkeletonItemRow />
            <SkeletonItemRow />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      className={`list-screen ptr-host${embedded ? ' is-embedded' : ''}`}
      ref={ptr.ref}
    >
      {/* Pull-to-Refresh-Indikator: wächst am oberen Rand mit, sonst unsichtbar. */}
      <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} pulling={ptr.pulling} />
      <header className="list-head">
        <div className="list-head-text">
          {!embedded && <h1>Einkaufen</h1>}
          {/* Eingebettet steht die Zahl der offenen Posten schon im Badge der
              Küchen-Leiste — hier bleibt nur, was dort nicht steht. */}
          <p>
            {items.length === 0
              ? 'Noch nichts drauf'
              : openCount === 0
                ? 'Alles erledigt 🎉'
                : embedded
                  ? `${checkedItems.length} erledigt`
                  : `${openCount} offen · ${checkedItems.length} erledigt`}
          </p>
        </div>
        <div className="list-head-actions">
          {!embedded && onOpenKitchen && (
            <button
              type="button"
              className="list-menu-btn"
              onClick={onOpenKitchen}
              aria-label="Küche öffnen"
              title="Küche"
            >
              <ChefHat size={18} strokeWidth={2} />
            </button>
          )}
          <button
            type="button"
            className="list-menu-btn"
            onClick={() => setMenuOpen(true)}
            aria-label="Optionen"
          >
            <MoreHorizontal size={20} strokeWidth={2.2} />
          </button>
        </div>
      </header>

      <div
        className={`list-progress${progress >= 100 && items.length > 0 ? ' is-done' : ''}`}
        aria-hidden="true"
      >
        <i style={{ width: `${progress}%` }} />
      </div>

      {searchOpen && (
        <div className="list-search-row">
          <Search size={15} strokeWidth={2} />
          <input
            type="text"
            className="list-search-input"
            placeholder="Artikel suchen…"
            aria-label="Artikel suchen"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            autoFocus
          />
          <button
            type="button"
            onClick={() => { setSearchQuery(''); setSearchOpen(false) }}
            aria-label="Suche schließen"
          >
            <X size={15} strokeWidth={2} />
          </button>
        </div>
      )}

      {chips.length > 1 && (
        <div className="cat-strip">
          <button
            type="button"
            className={`cat-chip${activeCat === null ? ' active' : ''}`}
            onClick={() => { setActiveCat(null); navigator.vibrate?.(6) }}
            aria-pressed={activeCat === null}
          >
            Alle <b>{items.length}</b>
          </button>
          {chips.map((c) => (
            <button
              key={c.name}
              type="button"
              className={`cat-chip${activeCat === c.name ? ' active' : ''}`}
              onClick={() => { setActiveCat(activeCat === c.name ? null : c.name); navigator.vibrate?.(6) }}
              style={activeCat === c.name ? { borderColor: c.color, background: c.bg, color: c.color } : undefined}
              aria-pressed={activeCat === c.name}
            >
              {c.name} <b>{c.open}</b>
            </button>
          ))}
        </div>
      )}

      {catsOpen && (
        <div className="cat-manager-wrap">
          <CategoryManager
            categories={categories}
            listId={listId}
            listType="shopping"
            onCategoriesChange={onCategoriesChange}
          />
        </div>
      )}

      <div className="list-body">
        {searchFiltered.length === 0 && (
          <p className="list-empty">
            <ShoppingBasket size={24} strokeWidth={1.5} />
            {searchQuery.trim()
              ? 'Nichts gefunden.'
              : hideChecked
                ? 'Alles erledigt — nichts mehr offen.'
                : 'Noch nichts drauf. Tippe unten auf +.'}
          </p>
        )}

        {shownCategories.map((cat) => {
          const catItems = itemsByCategory.get(cat.name) ?? EMPTY_ITEMS
          if (catItems.length === 0) return null
          return (
            <DraggableCategorySection
              key={cat.id}
              catItems={catItems}
              cat={cat}
              onItemToggle={onItemToggle}
              onBatchToggle={onBatchToggle}
              onItemDelete={onItemDelete}
              onEdit={(item) => setEditingItem(item)}
              onReorder={(newOrder) => onReorder?.('shopping', newOrder)}
              freshIds={freshIds}
            />
          )
        })}

        {/* Fallback: items whose category was deleted or doesn't match any existing category */}
        {(() => {
          const orphanItems = categories.length === 0
            ? searchFiltered
            : searchFiltered.filter(item => !categories.some(cat => cat.name === item.category))
          if (orphanItems.length === 0) return null
          const fallbackCat: ItemCategory = {
            id: '__uncategorized__',
            list_id: listId,
            name: 'Ohne Kategorie',
            icon: '📦',
            color: '#8A6A4E',
            bg: '#F3E7D8',
            sort_order: 9999,
            list_type: 'shopping',
            created_at: '',
          }
          return (
            <DraggableCategorySection
              key="__uncategorized__"
              catItems={orphanItems}
              cat={fallbackCat}
              onItemToggle={onItemToggle}
              onBatchToggle={onBatchToggle}
              onItemDelete={onItemDelete}
              onEdit={(item) => setEditingItem(item)}
              onReorder={(newOrder) => onReorder?.('shopping', newOrder)}
              freshIds={freshIds}
            />
          )
        })()}
      </div>

      <div className="list-addbar">
        <AddItemForm
          listId={listId}
          userName={userName}
          onAdded={onItemChange}
          onOptimisticAdd={onOptimisticAdd}
          categories={activeCat ? categories.filter(c => c.name === activeCat) : categories}
          listType="shopping"
        />
      </div>

      {menuOpen && (
        <div className="list-menu-scrim" role="presentation" onClick={() => setMenuOpen(false)}>
          <div
            ref={menuRef}
            className="list-menu-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Listen-Optionen"
            onClick={e => e.stopPropagation()}
          >
            <div className="more-grab" aria-hidden="true" />
            <button
              type="button"
              className="list-menu-item"
              onClick={() => { toggleHideChecked(); setMenuOpen(false) }}
            >
              {hideChecked ? <Eye size={17} strokeWidth={2} /> : <EyeOff size={17} strokeWidth={2} />}
              <span>{hideChecked ? 'Erledigte anzeigen' : 'Erledigte ausblenden'}</span>
            </button>
            <button
              type="button"
              className="list-menu-item"
              onClick={() => { setSearchOpen(true); setMenuOpen(false) }}
            >
              <Search size={17} strokeWidth={2} />
              <span>Suchen</span>
            </button>
            <button
              type="button"
              className="list-menu-item"
              onClick={() => { setCatsOpen(v => !v); setMenuOpen(false) }}
            >
              <Settings2 size={17} strokeWidth={2} />
              <span>{catsOpen ? 'Kategorien ausblenden' : 'Kategorien verwalten'}</span>
            </button>
            <button
              type="button"
              className="list-menu-item is-danger"
              onClick={handleDeleteChecked}
              disabled={checkedItems.length === 0}
            >
              <Trash2 size={17} strokeWidth={2} />
              <span>Erledigte löschen ({checkedItems.length})</span>
            </button>
          </div>
        </div>
      )}

      {editingItem && (
        <EditItemForm
          item={editingItem}
          categories={categories}
          listId={listId}
          onSaved={() => {
            setEditingItem(null)
            onItemChange?.()
          }}
          onCancel={() => setEditingItem(null)}
        />
      )}
    </div>
  )
}
