import { useState, useMemo } from 'react'
import { Trash2, Pizza, GripVertical, ChevronDown } from 'lucide-react'
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
      <div className="cat-header" style={{ background: cat.bg }} data-cat={cat.name}>
        <span className="cat-title" style={{ color: cat.color }}>{cat.name}</span>
        <span className="cat-count">
          {checkedCount}/{catItems.length} erledigt
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

  const toggleHideChecked = () => {
    navigator.vibrate?.(8)
    const next = !hideChecked
    setHideChecked(next)
    localStorage.setItem('fiesta_hide_checked', String(next))
  }

  const checkedItems = items.filter((i) => i.is_checked)

  const handleDeleteChecked = () => {
    if (checkedItems.length === 0) return
    confirm('Alle erledigten Items löschen?', async () => {
      const { error } = await supabase.rpc('batch_delete_items', { item_ids: checkedItems.map(i => i.id) })
      if (error) {
        toast(`Fehler beim Löschen: ${error.message}`, 'error')
        return
      }
      onItemChange?.()
    })
  }

  const visibleItems = hideChecked ? items.filter((i) => !i.is_checked) : items
  const searchFiltered = searchQuery.trim()
    ? visibleItems.filter((i) => i.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : visibleItems

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
      <div className="list-top-bar">
        <button
          className={`list-top-bar-btn ${hideChecked ? 'active' : ''}`}
          onClick={toggleHideChecked}
        >
          {hideChecked ? 'Alle zeigen' : 'Erledigte ausblenden'}
        </button>
        {checkedItems.length > 0 && (
          <button
            className="list-top-bar-btn list-delete-checked-btn"
            onClick={handleDeleteChecked}
          >
            <Trash2 size={16} strokeWidth={2} /> Erledigte löschen ({checkedItems.length})
          </button>
        )}
      </div>

      <input type="text" className="list-search-input" placeholder="🔍 Suchen…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />

      <CategoryManager
        categories={categories}
        listId={listId}
        listType="shopping"
        onCategoriesChange={onCategoriesChange}
      />
      <AddItemForm
        listId={listId}
        userName={userName}
        onAdded={onItemChange}
        categories={categories}
        listType="shopping"
      />

      {searchFiltered.length === 0 && (
        <p className="list-empty"><Pizza size={24} strokeWidth={1.5} /> {hideChecked ? 'Alle erledigten Items ausgeblendet!' : 'Noch keine Items — füge welche hinzu!'}</p>
      )}

      {categories.map((cat) => {
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
          color: '#888',
          bg: '#f0f0f0',
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
