import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useBackNav } from '../useBackNav'
import type { TabView } from '../../types'

type NavState = { tab: string; sheet: string | null }
type Wrapped = { __siesta?: NavState }
interface Entry { state: unknown }

/**
 * In-Memory-History mit echtem Eintrag-Modell: pushState/replaceState wie im
 * Browser, `back()` feuert — wie dort — ein popstate mit dem Ziel-State (und
 * tut nichts mehr auf dem ersten Eintrag).
 */
function makeFakeHistory() {
  let entries: Entry[] = [{ state: null }]
  let idx = 0
  const pushState = vi.fn((next: unknown) => {
    entries = entries.slice(0, idx + 1)
    entries.push({ state: next })
    idx += 1
  })
  const replaceState = vi.fn((next: unknown) => {
    entries[idx] = { state: next }
  })
  const back = vi.fn(() => {
    if (idx === 0) return
    idx -= 1
    window.dispatchEvent(new PopStateEvent('popstate', { state: entries[idx].state }))
  })
  const history = { get state() { return entries[idx]?.state ?? null }, pushState, replaceState, back }
  return {
    history,
    pushState,
    replaceState,
    back,
    entryCount: () => entries.length,
    topState: () => (entries[idx]?.state ?? null) as Wrapped | null,
  }
}

type FakeHistory = ReturnType<typeof makeFakeHistory>
type Props = { tab: TabView; sheet: 'more' | 'emergency' | null }

describe('useBackNav — Verlauf', () => {
  let fake: FakeHistory

  beforeEach(() => {
    fake = makeFakeHistory()
    Object.defineProperty(window, 'history', { value: fake.history, configurable: true })
  })

  const renderNav = (initial: Props, onRestore: (state: unknown) => void) =>
    renderHook(({ tab, sheet }: Props) => useBackNav({ enabled: true, tab, sheet, onRestore }), {
      initialProps: initial,
    })

  it('legt beim Mount einen Basis-Eintrag an (replace statt push)', () => {
    const onRestore = vi.fn((_state: unknown) => {})
    renderNav({ tab: 'home', sheet: null }, onRestore)
    expect(fake.replaceState).toHaveBeenCalledTimes(1)
    expect(fake.pushState).toHaveBeenCalledTimes(0)
    expect(fake.entryCount()).toBe(1)
    expect(fake.topState()).toEqual({ __siesta: { tab: 'home', sheet: null } })
  })

  it('Blatt öffnen/schließen: genau ein Eintrag, Schließen ersetzt statt zu häufen', () => {
    const onRestore = vi.fn((_state: unknown) => {})
    const { rerender } = renderNav({ tab: 'home', sheet: null }, onRestore)
    // Öffnen: Android-Zurück soll das Blatt schließen können — genau ein Eintrag
    rerender({ tab: 'home', sheet: 'more' })
    expect(fake.pushState).toHaveBeenCalledTimes(1)
    expect(fake.entryCount()).toBe(2)
    expect(fake.topState()).toEqual({ __siesta: { tab: 'home', sheet: 'more' } })
    // Schließen: Eintrag wird ersetzt, der Verlauf wächst nicht
    rerender({ tab: 'home', sheet: null })
    expect(fake.pushState).toHaveBeenCalledTimes(1)
    expect(fake.entryCount()).toBe(2)
    expect(fake.topState()).toEqual({ __siesta: { tab: 'home', sheet: null } })
    // Erneutes Öffnen und Schließen: das Schließen ersetzt wieder statt zu
    // häufen — das Erneute Öffnen gilt wie im Browser als eigener Eintrag
    // (Verlauf wächst je Öffnung um 1, je Schließung um 0).
    rerender({ tab: 'home', sheet: 'more' })
    expect(fake.pushState).toHaveBeenCalledTimes(2)
    expect(fake.entryCount()).toBe(3)
    rerender({ tab: 'home', sheet: null })
    expect(fake.pushState).toHaveBeenCalledTimes(2)
    expect(fake.replaceState).toHaveBeenCalledTimes(3)
    expect(fake.entryCount()).toBe(3)
    expect(fake.topState()).toEqual({ __siesta: { tab: 'home', sheet: null } })
  })

  it('Screen aus dem offenen Blatt öffnen: Eintrag ersetzt, KEIN zweiter (Sonderfall)', () => {
    const onRestore = vi.fn((_state: unknown) => {})
    const { rerender } = renderNav({ tab: 'home', sheet: null }, onRestore)
    rerender({ tab: 'home', sheet: 'more' }) // Blatt offen (1 neuer Eintrag)
    rerender({ tab: 'notes', sheet: null })  // Notizen aus dem Blatt heraus
    expect(fake.pushState).toHaveBeenCalledTimes(1)
    expect(fake.replaceState).toHaveBeenCalledTimes(2) // Seed + Ersetzung
    expect(fake.entryCount()).toBe(2)
    expect(fake.topState()).toEqual({ __siesta: { tab: 'notes', sheet: null } })
  })

  it('popstate stellt Tab und Sheet wieder her', () => {
    const onRestore = vi.fn((_state: unknown) => {})
    const { rerender } = renderNav({ tab: 'home', sheet: null }, onRestore)
    rerender({ tab: 'home', sheet: 'more' })
    fake.back() // Android-Zürück mit offenem Blatt → Blatt zu
    expect(onRestore).toHaveBeenCalledTimes(1)
    expect(onRestore).toHaveBeenCalledWith({ tab: 'home', sheet: null })
  })

  it('Zurück vom aus dem Blatt geöffneten Screen: Blatt bleibt zu, kein Extra-Push nach Restore', () => {
    const onRestore = vi.fn((_state: unknown) => {})
    const { rerender } = renderNav({ tab: 'home', sheet: null }, onRestore)
    rerender({ tab: 'home', sheet: 'more' })
    rerender({ tab: 'notes', sheet: null })
    fake.back()
    expect(onRestore).toHaveBeenCalledTimes(1)
    expect(onRestore).toHaveBeenCalledWith({ tab: 'home', sheet: null })
    // App übernimmt den Restore in die Props → history.state gleicht sich ab,
    // der nachfolgende Effekt-Push entfällt von selbst
    rerender({ tab: 'home', sheet: null })
    expect(fake.pushState).toHaveBeenCalledTimes(1)
  })

  it('Unmount mit offenem Blatt verklemmt die History nicht (Remount räumt den Eintrag weg)', () => {
    const restore1 = vi.fn((_state: unknown) => {})
    const first = renderNav({ tab: 'home', sheet: null }, restore1)
    first.rerender({ tab: 'home', sheet: 'more' })
    first.unmount()
    expect(fake.entryCount()).toBe(2) // Basis + offenes Blatt
    expect(fake.topState()).toEqual({ __siesta: { tab: 'home', sheet: 'more' } })
    // Remount mit geschlossenem Blatt: der Base-Seed greift nicht (state existiert),
    // der hängende Blatt-Eintrag am Verlaufskopf wird ersetzt, kein Push, kein
    // neuer Eintrag — genau EIN Zurück genügt.
    const restore2 = vi.fn((_state: unknown) => {})
    renderNav({ tab: 'home', sheet: null }, restore2)
    expect(fake.pushState).toHaveBeenCalledTimes(1) // nur das Öffnen vor dem Unmount
    expect(fake.replaceState).toHaveBeenCalledTimes(2) // Seed + Aufräumen
    expect(fake.entryCount()).toBe(2)
    expect(fake.topState()).toEqual({ __siesta: { tab: 'home', sheet: null } })
    fake.back()
    expect(restore2).toHaveBeenCalledTimes(1)
    expect(restore2).toHaveBeenCalledWith({ tab: 'home', sheet: null })
  })
})
