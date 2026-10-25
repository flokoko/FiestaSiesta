import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Keyboard/focus handling for modal sheet overlays (role="dialog" aria-modal="true").
 *
 * - Focuses the first focusable element when the sheet opens.
 * - Traps Tab / Shift+Tab inside the sheet (simple focus trap).
 * - Closes on Escape (calls `onClose`).
 * - Restores focus to the element that triggered opening when the sheet closes.
 *
 * `containerRef` points at the dialog container. The hook is a no-op while
 * `open` is false, so it can be called unconditionally before any early returns.
 */
export function useSheetFocus<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  open: boolean,
  onClose: () => void,
) {
  const triggerRef = useRef<HTMLElement | null>(null)
  // Keep the latest onClose without re-running the effect on every render.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return

    // Remember the element that had focus before opening (the trigger).
    triggerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

    const container = containerRef.current
    const first = container?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    ;(first ?? container)?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return

      const node = containerRef.current
      if (!node) return
      const focusables = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusables.length === 0) {
        e.preventDefault()
        return
      }
      const firstEl = focusables[0]
      const lastEl = focusables[focusables.length - 1]
      const active = document.activeElement

      if (e.shiftKey) {
        if (active === firstEl || !node.contains(active)) {
          e.preventDefault()
          lastEl.focus()
        }
      } else {
        if (active === lastEl || !node.contains(active)) {
          e.preventDefault()
          firstEl.focus()
        }
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      triggerRef.current?.focus()
    }
  }, [open, containerRef])
}
