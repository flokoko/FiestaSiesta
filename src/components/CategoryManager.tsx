import { useState } from 'react'
import { Tag, Trash2, GripVertical } from 'lucide-react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { ItemCategory, ListType } from '../types'
import { useCategories } from '../hooks/useCategories'
import { useDebouncedCallback } from '../hooks/useDebouncedCallback'
import { useDragReorder } from '../hooks/useDragReorder'
import { useToast } from '../context/ToastContext'

import './CategoryManager.css'

interface CategoryManagerProps {
  categories: ItemCategory[]
  listId: string
  listType: ListType
  onCategoriesChange?: () => void
}

export default function CategoryManager({ categories, listId, listType, onCategoriesChange }: CategoryManagerProps) {
  const { confirm } = useToast()
  const [expanded, setExpanded] = useState(false)
  const [localNames, setLocalNames] = useState<Record<string, string>>({})
  const { updateCategory, deleteCategory, addCategory, reorderCategories } = useCategories(() => onCategoriesChange?.())

  const debouncedUpdate = useDebouncedCallback(updateCategory, 400)

  const {
    dragState,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    registerItem,
  } = useDragReorder<ItemCategory>(categories, (newOrder) => {
    reorderCategories(newOrder)
  })

  const handleAdd = () => {
    const maxOrder = categories.reduce((max, c) => Math.max(max, c.sort_order), 0)
    addCategory(listId, listType, maxOrder + 1)
  }

  return (
    <div className="cat-manager">
      <button
        className="cat-manager-toggle"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="cat-manager-toggle-icon"><Tag size={16} strokeWidth={2} /></span>
        <span className="cat-manager-toggle-text">Kategorien</span>
        <span className="cat-manager-toggle-count">{categories.length}</span>
        <span className={`cat-manager-chevron ${expanded ? 'open' : ''}`}>▾</span>
      </button>
      <div className={`cat-manager-panel ${expanded ? 'expanded' : ''}`}>
        <div className="cat-manager-panel-inner">
          {categories.length === 0 && (
            <p className="cat-manager-empty">Keine Kategorien</p>
          )}
          {categories.map((cat) => {
            const isDragging = dragState.draggingId === cat.id
            const isDragOver = dragState.dragOverId === cat.id
            const rowClass = [
              'cat-manager-row',
              isDragging ? 'dragging' : '',
              isDragOver ? 'drag-over' : '',
            ].filter(Boolean).join(' ')

            return (
              <div
                key={cat.id}
                className={rowClass}
                ref={(el) => registerItem(cat.id, el)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              >
                <span
                  className="cat-manager-drag-handle"
                  onPointerDown={(e: ReactPointerEvent) => handlePointerDown(e, cat.id)}
                >
                  <GripVertical size={16} strokeWidth={2} />
                </span>
                <input
                  className="cat-manager-name-input"
                  type="text"
                  value={localNames[cat.id] ?? cat.name}
                  onChange={(e) => {
                    setLocalNames(prev => ({ ...prev, [cat.id]: e.target.value }))
                    debouncedUpdate(cat.id, { name: e.target.value })
                  }}
                />
                <button
                  className="cat-manager-delete-btn"
                  onClick={() => confirm('Dieses Element wirklich löschen?', () => deleteCategory(cat.id))}
                  aria-label="Kategorie löschen"
                >
                  <Trash2 size={16} strokeWidth={2} />
                </button>
              </div>
            )
          })}
          <button className="cat-manager-add-btn" onClick={handleAdd}>
            + Kategorie hinzufügen
          </button>
        </div>
      </div>
    </div>
  )
}
