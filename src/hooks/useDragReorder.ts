import { useState, useRef, useCallback } from 'react'

interface DragState {
  draggingId: string | null
  dragOverId: string | null
  /** Verschiebung des Zeigers seit dem Aufsetzen — für das „Karte folgt dem Finger“-Gefühl */
  offsetY: number
}

export function useDragReorder<T extends { id: string }>(
  items: T[],
  onReorder: (newOrder: string[]) => void
) {
  const [dragState, setDragState] = useState<DragState>({ draggingId: null, dragOverId: null, offsetY: 0 })
  const dragStateRef = useRef<DragState>(dragState)
  dragStateRef.current = dragState

  const dragStartY = useRef(0)
  const dragItemIndex = useRef(-1)
  const itemEls = useRef<Map<string, HTMLElement>>(new Map())
  const itemTops = useRef<Map<string, number>>(new Map())

  // Register item element + position for hit-testing
  const registerItem = useCallback((id: string, el: HTMLElement | null) => {
    if (el) {
      itemEls.current.set(id, el)
      itemTops.current.set(id, el.getBoundingClientRect().top)
    } else {
      itemEls.current.delete(id)
      itemTops.current.delete(id)
    }
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent, id: string) => {
    // Only start drag on primary button or touch
    if (e.button !== 0 && e.pointerType === 'mouse') return
    // Refresh all positions before starting drag (in case of scroll/resize)
    for (const [itemId, el] of itemEls.current) {
      itemTops.current.set(itemId, el.getBoundingClientRect().top)
    }
    dragStartY.current = e.clientY
    dragItemIndex.current = items.findIndex(i => i.id === id)
    setDragState({ draggingId: id, dragOverId: null, offsetY: 0 })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [items])

  // dragState via ref → stable dependency list, no re-creation on every move
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const ds = dragStateRef.current
    if (!ds.draggingId) return
    const currentY = e.clientY
    let closestId: string | null = null
    let closestDist = Infinity
    for (const [id, top] of itemTops.current) {
      const dist = Math.abs(top - currentY)
      if (dist < closestDist) {
        closestDist = dist
        closestId = id
      }
    }
    const offsetY = Math.round(currentY - dragStartY.current)
    setDragState(prev => ({
      ...prev,
      offsetY,
      // Ziel nur wechseln, wenn wirklich eine andere Karte unter dem Finger liegt
      dragOverId: closestId && closestId !== ds.draggingId ? closestId : prev.dragOverId,
    }))
  }, [])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const ds = dragStateRef.current
    if (!ds.draggingId) return
    const { draggingId, dragOverId } = ds
    if (dragOverId && draggingId !== dragOverId) {
      // Compute new order
      const ids = items.map(i => i.id)
      const fromIdx = ids.indexOf(draggingId)
      const toIdx = ids.indexOf(dragOverId)
      if (fromIdx !== -1 && toIdx !== -1) {
        ids.splice(fromIdx, 1)
        ids.splice(toIdx, 0, draggingId)
        onReorder(ids)
      }
    }
    setDragState({ draggingId: null, dragOverId: null, offsetY: 0 })
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  }, [items, onReorder])

  return {
    dragState,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    registerItem,
  }
}