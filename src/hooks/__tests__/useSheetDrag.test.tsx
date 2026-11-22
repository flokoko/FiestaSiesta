import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { useRef } from 'react'
import { useSheetDrag } from '../useSheetDrag'

// jsdom kennt keinen PointerEvent-Konstruktor — Events von Hand bauen.
function firePointer(el: Element, type: string, x = 0, y = 0, pid = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event &
    Record<string, unknown>
  Object.assign(event, {
    clientX: x,
    clientY: y,
    pointerId: pid,
    pointerType: 'touch',
    button: 0,
  })
  el.dispatchEvent(event)
}

function Host({ onClose, open = true }: { onClose: () => void; open?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useSheetDrag(ref, onClose, open)
  if (!open) return null
  return (
    <div ref={ref} data-testid="sheet">
      <div data-testid="grab" data-sheet-drag />
    </div>
  )
}

describe('useSheetDrag', () => {
  beforeEach(() => {
    // jsdom hat kein matchMedia — der Hook fragt prefers-reduced-motion ab.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
    // Gesteuerte Zeit: performance.now tickt pro Aufruf um clockStep (Velocity!).
    clockStep = 500
    nowValue = 0
    vi.spyOn(performance, 'now').mockImplementation(() => {
      nowValue += clockStep
      return nowValue
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('schließt seitlich mit Auslauf, wenn 120 px überschritten werden', async () => {
    const onClose = vi.fn()
    render(<Host onClose={onClose} />)
    const grab = screen.getByTestId('grab')
    const sheet = screen.getByTestId('sheet')
    // jsdom liefert 0 Breite — Fallback 360 px: cap = 90, Gummiband darüber.

    firePointer(grab, 'pointerdown', 100, 100)
    // Helper nimmt ABSOLUTE Koordinaten: x=100-140=-40 → dx = -140.
    firePointer(grab, 'pointermove', 100 - 140, 100)

    // Mitziehen über den Cap hinaus gedämpft: -(90 + 50·0,25) = -102,5 → -102.
    expect(sheet.style.transform).toBe('translateX(-102px)')
    // Loslassen: seitlicher Auslauf nach links (200 ms), danach schließen.
    firePointer(grab, 'pointerup', 100 - 140, 100)
    expect(sheet.style.transition).toContain('200ms')
    expect(sheet.style.transform).toBe('translateX(-105%)')
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), { timeout: 1000 })
    expect(sheet.style.transform).toBe('') // reset nach dem Auslauf
  })

  it('federt seitlich zurück, wenn Strecke und Tempo zu klein sind', async () => {
    const onClose = vi.fn()
    render(<Host onClose={onClose} />)
    const grab = screen.getByTestId('grab')
    const sheet = screen.getByTestId('sheet')
    firePointer(grab, 'pointerdown', 100, 100)
    firePointer(grab, 'pointermove', 70, 100)
    firePointer(grab, 'pointerup', 70, 100)
    // 30 px bei ~1000 ms: unter 120 px / 0,7 px/ms → zurück.
    expect(sheet.style.transform).toBe('translateX(0px)')
    await waitFor(() => expect(sheet.style.transform).toBe(''), { timeout: 1000 })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('behält die vertikale Logik: 110 px oder 0,6 px/ms schließen', async () => {
    const onClose = vi.fn()
    render(<Host onClose={onClose} />)
    const grab = screen.getByTestId('grab')
    const sheet = screen.getByTestId('sheet')
    firePointer(grab, 'pointerdown', 100, 100)
    firePointer(grab, 'pointermove', 100, 230)
    expect(sheet.style.transform).toBe('translateY(130px)')
    firePointer(grab, 'pointerup', 100, 230)
    // Vertikaler Auslauf (110 %) statt seitlichem — Logik wie vor der Erweiterung.
    expect(sheet.style.transform).toBe('translateY(110%)')
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), { timeout: 1000 })
    expect(sheet.style.transform).toBe('')
  })

  it('entscheidet die Achse beim ersten Move über 8 px — x gewinnt nicht nachträglich', async () => {
    const onClose = vi.fn()
    render(<Host onClose={onClose} />)
    const grab = screen.getByTestId('grab')
    const sheet = screen.getByTestId('sheet')
    firePointer(grab, 'pointerdown', 100, 100)
    // Erst deutlich nach unten (Axis-Entscheidung y), dann rüber.
    firePointer(grab, 'pointermove', 105, 130)
    // Trotz 100 px horizontal: die Achse bleibt y, es folgt nur der Finger.
    expect(sheet.style.transform).toBe('translateY(30px)')
    firePointer(grab, 'pointermove', 200, 130)
    expect(sheet.style.transform).toBe('translateY(30px)')
    firePointer(grab, 'pointerup', 200, 130)
    // 30 px vertikal reichen nicht → federnd zurück.
    expect(sheet.style.transform).toBe('translateY(0px)')
    await waitFor(() => expect(sheet.style.transform).toBe(''), { timeout: 1000 })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('greift nur am data-sheet-drag-Griff', async () => {
    const onClose = vi.fn()
    render(<Host onClose={onClose} />)
    const sheet = screen.getByTestId('sheet')
    firePointer(sheet, 'pointerdown', 100, 100)
    firePointer(sheet, 'pointermove', 40, 100)
    firePointer(sheet, 'pointerup', 40, 100)
    expect(sheet.style.transform).toBe('')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('schließt unter prefers-reduced-motion ohne Animation direkt', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduced-motion'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
    const onClose = vi.fn()
    render(<Host onClose={onClose} />)
    const grab = screen.getByTestId('grab')
    const sheet = screen.getByTestId('sheet')
    firePointer(grab, 'pointerdown', 100, 100)
    firePointer(grab, 'pointermove', 100, 240)
    expect(sheet.style.transform).toBe('translateY(140px)') // mitgehen bleibt
    firePointer(grab, 'pointerup', 100, 240)
    // Harter Schnitt: sofort geschlossen, kein Auslauf.
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(sheet.style.transform).toBe('')
  })
})

// Kontrollvariablen für die Zeit-Fälschung (in beforeEach referenziert).
let clockStep = 500
let nowValue = 0
