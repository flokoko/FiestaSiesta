import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { usePullToRefresh } from '../usePullToRefresh'

function Probe({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const ptr = usePullToRefresh(onRefresh)
  return (
    <div data-testid="host" ref={ptr.ref}>
      <span data-testid="pull">{Math.round(ptr.pull)}</span>
      <span data-testid="refreshing">{String(ptr.refreshing)}</span>
      <span data-testid="pulling">{String(ptr.pulling)}</span>
    </div>
  )
}

/**
 * Touch-Zug ohne TouchEvent-Klasse (jsdom kennt sie nicht): React hört auf
 * den Ereignis-Namen und liest `touches` direkt.
 */
function fireTouch(host: Element, type: string, y: number) {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'touches', { value: [{ clientY: y }] })
  host.dispatchEvent(ev)
}

describe('usePullToRefresh', () => {
  beforeEach(() => {
    // scrollTop 0: die Seite steht am oberen Rand (jsdom-Grundzustand).
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const read = (id: string) => screen.getByTestId(id).textContent

  it('löst beim Loslassen aus (ab 58 px Gummiband) und blendet danach zurück', async () => {
    let resolveRefresh: () => void = () => {}
    const onRefresh = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveRefresh = res
        }),
    )
    render(<Probe onRefresh={onRefresh} />)
    const host = screen.getByTestId('host')

    act(() => {
      fireTouch(host, 'touchstart', 100)
    })
    act(() => {
      fireTouch(host, 'touchmove', 216) // dy 116 · 0,5 = 58 → Schwelle
    })
    expect(read('pull')).toBe('58')
    expect(read('refreshing')).toBe('false')
    expect(onRefresh).not.toHaveBeenCalled()
    act(() => {
      fireTouch(host, 'touchend', 216)
    })
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(read('refreshing')).toBe('true')
    // Durchlauf + kurzer Spin, dann zurücksetzen
    await act(async () => {
      resolveRefresh()
      await vi.advanceTimersByTimeAsync(700)
    })
    expect(read('refreshing')).toBe('false')
    expect(read('pull')).toBe('0')
  })

  it('setzt `refreshing` spätestens nach 4 s zurück (hängender Refresh)', async () => {
    const onRefresh = vi.fn(() => new Promise<void>(() => {/* nie */}))
    render(<Probe onRefresh={onRefresh} />)
    const host = screen.getByTestId('host')
    act(() => {
      fireTouch(host, 'touchstart', 100)
      fireTouch(host, 'touchmove', 220) // dy 120 → pull 60 ≥ 58
      fireTouch(host, 'touchend', 220)
    })
    expect(read('refreshing')).toBe('true')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(read('refreshing')).toBe('false')
    expect(read('pull')).toBe('0')
  })

  it('federt unter der Schwelle zurück und ruft nichts auf', () => {
    const onRefresh = vi.fn()
    render(<Probe onRefresh={onRefresh} />)
    const host = screen.getByTestId('host')
    act(() => {
      fireTouch(host, 'touchstart', 100)
      fireTouch(host, 'touchmove', 200) // dy 100 → pull 50 < 58
      fireTouch(host, 'touchend', 200)
    })
    expect(onRefresh).not.toHaveBeenCalled()
    expect(read('pull')).toBe('0')
    expect(read('refreshing')).toBe('false')
  })

  it('bricht ab, wenn die Bewegung nach oben geht — kein Wiederanlauf', () => {
    const onRefresh = vi.fn()
    render(<Probe onRefresh={onRefresh} />)
    const host = screen.getByTestId('host')
    act(() => {
      fireTouch(host, 'touchstart', 100)
      fireTouch(host, 'touchmove', 90) // nach oben: Geste zu
      fireTouch(host, 'touchmove', 200) // später nach unten zählt nicht mehr
      fireTouch(host, 'touchend', 200)
    })
    expect(read('pull')).toBe('0')
    expect(read('pulling')).toBe('false')
    expect(onRefresh).not.toHaveBeenCalled()
  })
})
