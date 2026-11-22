import type { ListItem } from '../types'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { Trash2, GripVertical, Pencil } from 'lucide-react'
import { useSwipeDelete } from '../hooks/useSwipeDelete'
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
  /** Gerade dazugekommen (nicht beim ersten Aufbau des Screens). */
  isNew?: boolean
}

export default function ItemRow({ item, onToggle, onDelete, onEdit, dragHandleProps, isDragging, isDragOver, registerRef, isNew }: ItemRowProps) {
  const swipe = useSwipeDelete(() => onDelete?.(item))

  const toggleChecked = () => {
    onToggle?.(item)
    navigator.vibrate?.(10)
  }

  // Sofort löschen — „Rückgängig" liegt als Toast-Aktion darüber (useListData
  // führt den Undo-Stack, App zeigt den Knopf). Ein Modal für jedes Item war
  // der häufigste Klick im Screen.
  const deleteItem = () => {
    onDelete?.(item)
    navigator.vibrate?.(15)
  }

  // Wisch-Geste und Vertikal-Drag teilen sich die Row-Events: beide Hooks
  // prüfen selbst, ob ihr Fall vorliegt, und melden sich sonst nicht.
  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    swipe.handlers.onPointerMove(e)
    dragHandleProps?.onPointerMove(e)
  }
  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    swipe.handlers.onPointerUp(e)
    dragHandleProps?.onPointerUp(e)
  }

  // Inline-Transform nur, solange die Zeile vom Finger abweicht oder federt —
  // sonst läge er im Weg der Hover-/Active-Optik.
  const rowStyle =
    swipe.dragging || swipe.settling || swipe.offset !== 0
      ? { transform: `translateX(${swipe.offset}px)` }
      : undefined

  const rowClass = [
    'item-row',
    item.is_checked ? 'checked' : '',
    isDragging ? 'dragging' : '',
    isDragOver ? 'drag-over' : '',
    // Frisch angelegt (online wie offline): läuft beim Erscheinen kurz ein.
    isNew || item.id.startsWith('temp-') ? 'is-new' : '',
    swipe.dragging ? 'is-swiping' : '',
    swipe.settling ? 'swipe-settle' : '',
  ].filter(Boolean).join(' ')

  return (
    // Die Breite der roten Unterlage folgt dem Zug: nur der freigelegte
    // Streifen wird rot. Vollbreite hinter einer halbtransparenten Zeile
    // (--surface ist 74 % Weiß) schiene durch die ganze Zeile durch.
    <div
      className="swipe-cell swipe-cell-flat"
      style={{ '--swipe-x': `${Math.max(0, -swipe.offset)}px` } as CSSProperties}
    >
      {/* Rote Unterlage mit Papierkorb — sie zeigt sich in der Fläche, die die
          nach links gleitende Zeile freigibt. */}
      <div className="swipe-under" aria-hidden="true">
        <span>Löschen</span>
        <Trash2 size={16} strokeWidth={2} />
      </div>
      <div
        className={rowClass}
        ref={registerRef ?? undefined}
        style={rowStyle}
        onPointerDown={swipe.handlers.onPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={swipe.handlers.onPointerCancel}
      >
        {dragHandleProps && (
          <button
            type="button"
            className="item-drag-handle"
            onPointerDown={dragHandleProps.onPointerDown}
            aria-label={`${item.name} verschieben`}
          >
            <GripVertical size={16} strokeWidth={2} />
          </button>
        )}
        <label className="custom-checkbox" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={item.is_checked}
            onChange={toggleChecked}
            className="custom-checkbox-input"
            aria-label={`${item.name} abhaken`}
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
          <span className="item-name"><span className="item-name-text">{item.name}</span></span>
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
    </div>
  )
}
