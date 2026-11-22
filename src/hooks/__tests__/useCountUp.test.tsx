import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { useCountUp } from '../useCountUp'

function Probe({ value }: { value: number }) {
  const shown = useCountUp(value, 300)
  return <span data-testid="out">{shown.toFixed(2)}</span>
}

function Host() {
  const [value, setValue] = useState(10)
  return (
    <>
      <button type="button" onClick={() => setValue(20)}>setzen</button>
      <Probe value={value} />
    </>
  )
}

describe('useCountUp', () => {
  let now = 0
  beforeEach(() => {
    now = 0
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    }))
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    // rAF läuft im Test sofort, aber mit gesteuerter Zeit.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      now += 150
      setTimeout(() => cb(now), 0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('zeigt beim ersten Render sofort den Zielwert', () => {
    render(<Probe value={42} />)
    expect(screen.getByTestId('out').textContent).toBe('42.00')
  })

  it('zählt bei Änderung hoch statt zu springen', async () => {
    render(<Host />)
    fireEvent.click(screen.getByText('setzen'))
    // Erster Frame: zwischen 10 und 20, nicht der Zielwert.
    await waitFor(() => {
      const value = Number(screen.getByTestId('out').textContent)
      expect(value).toBeGreaterThan(10)
      expect(value).toBeLessThan(20)
    })
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('20.00'))
  })

  it('springt bei prefers-reduced-motion sofort', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduced-motion'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    }))
    render(<Host />)
    fireEvent.click(screen.getByText('setzen'))
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('20.00'))
  })
})
