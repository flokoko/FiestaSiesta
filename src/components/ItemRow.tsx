import type { ListItem } from '../types'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Trash2, GripVertical, Pencil } from 'lucide-react'
import { useToast } from '../context/ToastContext'
import './ItemRow.css'

interface ItemRowProps {
  item: ListItem
  onToggle?: (item: ListItem) => void
  onDelete?: (item: ListItem) => void
  onEdit?: (item: ListItem) => void
  dragHandleProps?: {
    onPointerDown: (e: ReactPointerEvent) => void
    onPointerMove: (e: ReactPointerEvent) => void
    onPointerUp: (e: ReactPointerEvent) => void
  }
  isDragging?: boolean
  isDragOver?: boolean
  registerRef?: (el: HTMLDivElement | null) => void
}

export default function ItemRow({ item, onToggle, onDelete, onEdit, dragHandleProps, isDragging, isDragOver, registerRef }: ItemRowProps) {
  const { confirm } = useToast()

  const toggleChecked = () => {
    onToggle?.(item)
    navigator.vibrate?.(10)
  }

  const deleteItem = () => {
    confirm('Dieses Element wirklich löschen?', () => {
      onDelete?.(item)
      navigator.vibrate?.(15)
    })
  }

  const rowClass = [
    'item-row',
    item.is_checked ? 'checked' : '',
    isDragging ? 'dragging' : '',
    isDragOver ? 'drag-over' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={rowClass}
      ref={registerRef ?? undefined}
      onPointerMove={dragHandleProps?.onPointerMove}
      onPointerUp={dragHandleProps?.onPointerUp}
    >
      {dragHandleProps && (
        <span
          className="item-drag-handle"
          onPointerDown={dragHandleProps.onPointerDown}
        >
          <GripVertical size={16} strokeWidth={2} />
        </span>
      )}
      <label className="custom-checkbox" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={item.is_checked}
          onChange={toggleChecked}
          className="custom-checkbox-input"
        />
        <span className={`custom-checkbox-visual ${item.is_checked ? 'checked' : ''}`}>
          {item.is_checked && (
            <svg className="checkmark-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </span>
      </label>
      <div className="item-content">
        <span className="item-name">{item.name}</span>
        <div className="item-meta">
          <span className="item-qty">{item.quantity}</span>
          {item.created_by && <span className="item-created-by">von {item.created_by}</span>}
        </div>
      </div>
      <button className="item-edit" onClick={(e) => { e.stopPropagation(); onEdit?.(item) }} aria-label="Bearbeiten">
        <Pencil size={16} strokeWidth={2} />
      </button>
      <button className="item-delete" onClick={deleteItem} aria-label="Löschen">
        <Trash2 size={16} strokeWidth={2} />
      </button>
    </div>
  )
}