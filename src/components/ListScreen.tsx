import { useState, useMemo } from 'react'
import { Trash2, ShoppingBasket, GripVertical, ChevronDown, MoreHorizontal, Search, EyeOff, Eye, Settings2, X } from 'lucide-react'
import type { ListItem, ItemCategory, ListType } from '../types'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import { aggregateItems, type AggregatedItem } from '../lib/aggregate'
import ItemRow from './ItemRow'
import AddItemForm from './AddItemForm'
import EditItemForm from './EditItemForm'
import CategoryManager from './CategoryManager'
import { SkeletonCatHeader, SkeletonItemRow } from './Skeleton'

import { useDragReorder } from '../hooks/useDragReorder'
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
}: {
  catItems: ListItem[]
  cat: ItemCategory
  onItemToggle?: (item: ListItem) => void
  onBatchToggle?: (items: ListItem[], checked: boolean) => void
  onItemDelete?: (item: ListItem) => void
  onEdit?: (item: ListItem) => void
  onReorder?: (newOrder: string[]) => void
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
    confirm(`"${agg.name}" (${agg.count} Einträge) wirklich löschen?`, () => {
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
            />
          )
        }

        // Aggregated row
        const rowClass = [
          'item-row',
          agg.isChecked ? 'checked' : '',
          isDragging ? 'dragging' : '',
          isDragOver ? 'drag-over' : '',
        ].filter(Boolean).join(' ')

        return (
          <div
            key={agg.groupKey}
            className={rowClass}
            ref={(el) => registerItem(agg.groupKey, el)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <span
              className="item-drag-handle"
              onPointerDown={(e: ReactPointerEvent) => handlePointerDown(e, agg.groupKey)}
            >
              <GripVertical size={16} strokeWidth={2} />
            </span>
            <label className="item-checkbox-wrap">
              <input
                type="checkbox"
                checked={agg.isChecked}
                onChange={() => { handleAggregatedToggle(agg); navigator.vibrate?.(10) }}
              />
              <span className="item-checkmark" />
            </label>
            <div
              className="item-content"
              onClick={() => toggleExpand(agg.groupKey)}
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
            <button className="item-delete" onClick={() => handleAggregatedDelete(agg)} aria-label="Löschen">
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
                        onChange={() => { onItemToggle?.(item); navigator.vibrate?.(10) }}
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
        )
      })}
    </div>
  )
}

export default function ListScreen({ items, categories, listId, userName, isLoading, onItemToggle, onBatchToggle, onItemDelete, onItemChange, onReorder, onCategoriesChange }: ListScreenProps) {
  const { toast, confirm } = useToast()
  const [hideChecked, setHideChecked] = useState(() => localStorage.getItem('fiesta_hide_checked') === 'true')
  const [searchQuery, setSearchQuery] = useState('')
  const [editingItem, setEditingItem] = useState<ListItem | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [catsOpen, setCatsOpen] = useState(false)
  const [activeCat, setActiveCat] = useState<string | null>(null)

  const toggleHideChecked = () => {
    navigator.vibrate?.(8)
    const next = !hideChecked
    setHideChecked(next)
    localStorage.setItem('fiesta_hide_checked', String(next))
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
    <div className="list-screen">
      <header className="list-head">
        <div className="list-head-text">
          <h1>Einkaufen</h1>
          <p>
            {items.length === 0
              ? 'Noch nichts drauf'
              : openCount === 0
                ? 'Alles erledigt 🎉'
                : `${openCount} offen · ${checkedItems.length} erledigt`}
          </p>
        </div>
        <button
          type="button"
          className="list-menu-btn"
          onClick={() => setMenuOpen(true)}
          aria-label="Optionen"
        >
          <MoreHorizontal size={20} strokeWidth={2.2} />
        </button>
      </header>

      <div className="list-progress" aria-hidden="true">
        <i style={{ width: `${progress}%` }} />
      </div>

      {searchOpen && (
        <div className="list-search-row">
          <Search size={15} strokeWidth={2} />
          <input
            type="text"
            placeholder="Artikel suchen…"
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
          const catItems = searchFiltered.filter((i) => i.category === cat.name)
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
            />
          )
        })()}
      </div>

      <div className="list-addbar">
        <AddItemForm
          listId={listId}
          userName={userName}
          onAdded={onItemChange}
          categories={activeCat ? categories.filter(c => c.name === activeCat) : categories}
          listType="shopping"
        />
      </div>

      {menuOpen && (
        <div className="list-menu-scrim" role="presentation" onClick={() => setMenuOpen(false)}>
          <div
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
