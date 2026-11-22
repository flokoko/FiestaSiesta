import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useSwipeDelete } from '../useSwipeDelete'

/**
 * Die Zeile im Test bekommt die Handler und spiegelt Offset/Klassen in
 * DOM-Form — wie ItemRow es im echten Render tut.
 */
function Row({ onDelete, testId = 'row' }: { onDelete: () => void; testId?: string }) {
  const swipe = useSwipeDelete(onDelete)
  return (
    <div
      data-testid={testId}
      className={
        swipe.dragging ? 'is-swiping' : swipe.settling ? 'swipe-settle' : ''
      }
      style={{ transform: `translateX(${swipe.offset}px)` }}
      {...swipe.handlers}
    >
      Zeile
    </div>
  )
}

/**
 * Pointer-Zug ohne PointerEvent-Klasse (jsdom kennt sie nicht): React hört
 * auf den Ereignis-Namen, nicht auf den Konstruktor.
 */
function firePointer(el: Element, type: string, x: number, y: number) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'pointerId', { value: 1 })
  Object.defineProperty(ev, 'pointerType', { value: 'touch' })
  Object.defineProperty(ev, 'isPrimary', { value: true })
  Object.defineProperty(ev, 'clientX', { value: x })
  Object.defineProperty(ev, 'clientY', { value: y })
  el.dispatchEvent(ev)
}

describe('useSwipeDelete', () => {
  let vibrate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vibrate = vi.fn()
    Object.defineProperty(window.navigator, 'vibrate', {
      value: vibrate,
      configurable: true,
    })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const row = () => screen.getByTestId('row') as HTMLElement

  it('löscht bei weit genugem Wisch nach links und vibriert genau einmal', () => {
    const onDelete = vi.fn()
    render(<Row onDelete={onDelete} />)
    act(() => {
      firePointer(row(), 'pointerdown', 300, 100)
      firePointer(row(), 'pointermove', 280, 100)
    })
    act(() => {
      firePointer(row(), 'pointermove', 200, 100)
    })
    // Zeile folgt dem Finger, Hintergrund-Schwelle überschritten → Haptik
    expect(row().style.transform).toBe('translateX(-100px)')
    expect(vibrate).toHaveBeenCalledTimes(1)
    act(() => {
      firePointer(row(), 'pointerup', 200, 100)
    })
    expect(onDelete).toHaveBeenCalledTimes(1)
    // Restzustand: Zeile geschlossen, kein Settle nötig
    expect(row().style.transform).toBe('translateX(0px)')
    expect(row().className).not.toContain('swipe-settle')
    expect(vibrate).toHaveBeenCalledTimes(1) // kein zweites Mal
  })

  it('federt zurück, wenn nicht weit genug gezogen wurde', () => {
    const onDelete = vi.fn()
    render(<Row onDelete={onDelete} />)
    act(() => {
      firePointer(row(), 'pointerdown', 300, 100)
      firePointer(row(), 'pointermove', 260, 100)
      firePointer(row(), 'pointerup', 260, 100)
    })
    expect(onDelete).not.toHaveBeenCalled()
    expect(vibrate).not.toHaveBeenCalled()
    // Rückfeder läuft, danach ist die Zeile ruhig
    expect(row().className).toContain('swipe-settle')
    act(() => {
      vi.advanceTimersByTime(260)
    })
    expect(row().className).not.toContain('swipe-settle')
    expect(row().style.transform).toBe('translateX(0px)')
  })

  it('bricht bei vertikaler Bewegung ab — Scrollen hat Vortritt', () => {
    const onDelete = vi.fn()
    render(<Row onDelete={onDelete} />)
    act(() => {
      firePointer(row(), 'pointerdown', 300, 100)
      // Intent: vertikal dominiert (|dx| > |dy| * 1,2 verletzt)
      firePointer(row(), 'pointermove', 280, 140)
      firePointer(row(), 'pointermove', 180, 180)
      firePointer(row(), 'pointerup', 180, 180)
    })
    expect(row().style.transform).toBe('translateX(0px)')
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('löst bei Wisch nach rechts nichts aus (nur negativer dx zählt)', () => {
    const onDelete = vi.fn()
    render(<Row onDelete={onDelete} />)
    act(() => {
      firePointer(row(), 'pointerdown', 300, 100)
      firePointer(row(), 'pointermove', 340, 100)
      firePointer(row(), 'pointermove', 360, 100)
      firePointer(row(), 'pointerup', 360, 100)
    })
    expect(onDelete).not.toHaveBeenCalled()
    expect(row().style.transform).toBe('translateX(0px)')
  })

  it('lässt nur EINE Zeile in einer Geste stecken', () => {
    const onDeleteA = vi.fn()
    const onDeleteB = vi.fn()
    render(
      <>
        <Row onDelete={onDeleteA} testId="row-a" />
        <Row onDelete={onDeleteB} testId="row-b" />
      </>,
    )
    const rowA = screen.getByTestId('row-a')
    const rowB = screen.getByTestId('row-b')
    act(() => {
      // Zeile A zügig in Geste
      firePointer(rowA, 'pointerdown', 300, 100)
      firePointer(rowA, 'pointermove', 180, 100)
    })
    act(() => {
      // Zeile B probiert gleichzeitig — der Besitz-Slot gehört A
      firePointer(rowB, 'pointerdown', 300, 300)
      firePointer(rowB, 'pointermove', 150, 300)
      firePointer(rowB, 'pointerup', 150, 300)
    })
    expect(onDeleteB).not.toHaveBeenCalled()
    act(() => {
      firePointer(rowA, 'pointerup', 180, 100)
    })
    expect(onDeleteA).toHaveBeenCalledTimes(1)
    // Slot wieder frei: die zweite Zeile wischt jetzt ganz normal
    act(() => {
      firePointer(rowB, 'pointerdown', 300, 300)
      firePointer(rowB, 'pointermove', 150, 300)
      firePointer(rowB, 'pointerup', 150, 300)
    })
    expect(onDeleteB).toHaveBeenCalledTimes(1)
  })
})
