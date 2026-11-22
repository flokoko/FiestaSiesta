import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { useRef, useState } from 'react'
import { useSegmentSwipe, type SegmentKey } from '../useSegmentSwipe'

// jsdom kennt keinen PointerEvent-Konstruktor — die Events werden von Hand
// gebaut (bubbeln zu den Fenster-Listenern des Hooks).
type PointerInit = { x: number; y: number; pid?: number }

function firePointer(el: Element, type: string, init: PointerInit) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event &
    Record<string, unknown>
  Object.assign(event, {
    clientX: init.x,
    clientY: init.y,
    pointerId: init.pid ?? 1,
    pointerType: 'touch',
    button: 0,
  })
  el.dispatchEvent(event)
}

interface ProbeProps {
  segment: SegmentKey
  onSegment: (segment: SegmentKey) => void
  onCardClick?: () => void
}

/** Struktur wie die Küche: zwei Panes überlappend übereinander, Indikator daneben. */
function Probe({ segment, onSegment, onCardClick }: ProbeProps) {
  const shoppingRef = useRef<HTMLDivElement | null>(null)
  const recipesRef = useRef<HTMLDivElement | null>(null)
  const indRef = useRef<HTMLSpanElement | null>(null)
  useSegmentSwipe({
    shoppingRef,
    recipesRef,
    indicatorRef: indRef,
    segment,
    onSegment,
  })
  return (
    <div>
      <div ref={shoppingRef} data-testid="shopping" id="kueche-panel-shopping">
        <button type="button" data-testid="card" onClick={onCardClick}>
          Karte
        </button>
        <div className="item-row" data-testid="row">
          Zeile mit eigener Geste
        </div>
      </div>
      <div ref={recipesRef} data-testid="recipes" id="kueche-panel-recipes" />
      <span ref={indRef} data-testid="ind" />
    </div>
  )
}

function Host({ onCardClick }: { onCardClick?: () => void }) {
  const [segment, setSegment] = useState<SegmentKey>('shopping')
  return (
    <>
      <span data-testid="label">{segment}</span>
      <Probe segment={segment} onSegment={setSegment} onCardClick={onCardClick} />
    </>
  )
}

// Kontrollvariablen für die Zeit-Fälschung (in beforeEach referenziert).
let clockStep = 500
let nowValue = 0

describe('useSegmentSwipe', () => {
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
    // navigator.vibrate nachrüsten (Prototyp, damit navigator.vibrate?. greift).
    Object.defineProperty(Navigator.prototype, 'vibrate', {
      value: vi.fn(),
      configurable: true,
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    Reflect.deleteProperty(Navigator.prototype, 'vibrate')
  })

  it('zieht beim Wischen nach links mit und wechselt ab 100 px auf Rezepte', async () => {
    render(<Host />)
    const shopping = screen.getByTestId('shopping')
    const ind = screen.getByTestId('ind')
    // jsdom liefert 0 Breite — der Hook fällt auf 360 px zurück: cap = 136,8.

    firePointer(shopping, 'pointerdown', { x: 100, y: 100 })
    firePointer(shopping, 'pointermove', { x: 0, y: 100 })

    // Beide Panes und der Indikator folgen dem Finger …
    expect(shopping.style.transform).toBe('translateX(-100px)')
    expect(screen.getByTestId('recipes').style.transform).toBe('translateX(-100px)')
    // … der Indikator anteilig: Faktor 100 / 136,8 ≈ 0,731 der Einheit.
    expect(ind.style.transform).toMatch(/^translateX\(calc\(0\.73\d\d \* 100% \+ 4\.3\dpx\)\)$/)
    // bis dahin noch kein Wechsel (Loslassen entscheidet).
    expect(screen.getByTestId('label').textContent).toBe('shopping')

    firePointer(shopping, 'pointerup', { x: 0, y: 100 })

    await waitFor(() => expect(screen.getByTestId('label').textContent).toBe('recipes'))
    expect(Navigator.prototype.vibrate).toHaveBeenCalledWith(6)
    // Nach dem Übergang sind alle Inline-Styles wieder freigegeben.
    await waitFor(() => expect(shopping.style.transform).toBe(''))
    expect(screen.getByTestId('recipes').style.transform).toBe('')
    expect(ind.style.transform).toBe('')
  })

  it('federt zurück, wenn weder Strecke noch Tempo reichen', async () => {
    render(<Host />)
    const shopping = screen.getByTestId('shopping')
    firePointer(shopping, 'pointerdown', { x: 100, y: 100 })
    firePointer(shopping, 'pointermove', { x: 80, y: 100 })
    expect(shopping.style.transform).toBe('translateX(-20px)')

    firePointer(shopping, 'pointerup', { x: 80, y: 100 })

    // 20 px bei ~1000 ms Ablösezeit: unter Schwellen → zurück zur Ruheposition.
    expect(screen.getByTestId('label').textContent).toBe('shopping')
    expect(shopping.style.transition).toContain('260ms')
    await waitFor(() => expect(shopping.style.transform).toBe(''))
    expect(Navigator.prototype.vibrate).not.toHaveBeenCalled()
  })

  it('reißt mit Tempo ab 0,4 px/ms das Segment um, auch bei kurzer Strecke', async () => {
    clockStep = 5 // 3 Aufrufe (down/move/up): ~10 ms Ablösezeit
    render(<Host />)
    const shopping = screen.getByTestId('shopping')
    firePointer(shopping, 'pointerdown', { x: 100, y: 100 })
    firePointer(shopping, 'pointermove', { x: 80, y: 100 })
    firePointer(shopping, 'pointerup', { x: 80, y: 100 })
    await waitFor(() => expect(screen.getByTestId('label').textContent).toBe('recipes'))
  })

  it('lässt vertikales Scrollen gewinnen und wischt ab einer Zeile nicht', async () => {
    render(<Host />)
    const shopping = screen.getByTestId('shopping')
    const row = screen.getByTestId('row')

    // Erst schräg nach unten (vertikal dominiert), dann rüber — zu spät: die
    // Achse ist bereits entschieden und die Geste ignoriert.
    firePointer(shopping, 'pointerdown', { x: 100, y: 100 })
    firePointer(shopping, 'pointermove', { x: 105, y: 140 })
    firePointer(shopping, 'pointermove', { x: 160, y: 140 })
    firePointer(shopping, 'pointerup', { x: 160, y: 140 })
    expect(shopping.style.transform).toBe('')
    expect(screen.getByTestId('label').textContent).toBe('shopping')

    // Zeilen haben eigene horizontale Gesten (Punkt 1) — kein Segment-Wisch.
    firePointer(row, 'pointerdown', { x: 200, y: 300 })
    firePointer(row, 'pointermove', { x: 40, y: 300 })
    firePointer(row, 'pointerup', { x: 40, y: 300 })
    expect(shopping.style.transform).toBe('')
    expect(screen.getByTestId('label').textContent).toBe('shopping')
  })

  it('dämpft die falsche Richtung (Gummiband) und wechselt dann nicht', async () => {
    render(<Host />)
    const shopping = screen.getByTestId('shopping')
    firePointer(shopping, 'pointerdown', { x: 100, y: 100 })
    firePointer(shopping, 'pointermove', { x: 160, y: 100 })
    // Nach rechts ist von shopping aus kein Segment: gedämpft (×0,25) folgen.
    expect(shopping.style.transform).toBe('translateX(15px)')
    firePointer(shopping, 'pointerup', { x: 160, y: 100 })
    expect(screen.getByTestId('label').textContent).toBe('shopping')
  })

  it('unterdrückt den Klick unter einem beendeten Zug', async () => {
    const onCardClick = vi.fn()
    render(<Host onCardClick={onCardClick} />)
    const shopping = screen.getByTestId('shopping')
    const card = screen.getByTestId('card')
    const click = () =>
      card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    firePointer(shopping, 'pointerdown', { x: 120, y: 120 })
    firePointer(shopping, 'pointermove', { x: 90, y: 120 })
    firePointer(shopping, 'pointerup', { x: 90, y: 120 })

    // Erster Klick nach dem Zug: gekappt.
    click()
    expect(onCardClick).not.toHaveBeenCalled()
    // Der nächste (echte Tap) geht wieder durch.
    click()
    expect(onCardClick).toHaveBeenCalledTimes(1)
  })

  it('zieht nicht mit unter prefers-reduced-motion, wechselt aber direkt', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduced-motion'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
    render(<Host />)
    const shopping = screen.getByTestId('shopping')
    firePointer(shopping, 'pointerdown', { x: 100, y: 100 })
    firePointer(shopping, 'pointermove', { x: 0, y: 100 })
    // Kein Mitziehen …
    expect(shopping.style.transform).toBe('')
    firePointer(shopping, 'pointerup', { x: 0, y: 100 })
    // … aber direkter Wechsel beim Loslassen.
    await waitFor(() => expect(screen.getByTestId('label').textContent).toBe('recipes'))
    expect(Navigator.prototype.vibrate).toHaveBeenCalledWith(6)
  })
})

