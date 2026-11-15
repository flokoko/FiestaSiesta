import { describe, it, expect } from 'vitest'
import { mergePending, dropRemoved, dropSplitsOfRemoved } from '../expensePending'

interface Row {
  id: string
  label: string
}

interface Split {
  id: string
  expense_id: string
}

const real = (id: string, label = id): Row => ({ id, label })
const splitOf = (id: string, expenseId: string): Split => ({ id, expense_id: expenseId })

describe('mergePending — hängende Zeilen gemischt (Temp zuerst, keine Duplikate)', () => {
  it('hängende Zeile vorne, echte Zeilen dahinter in der Original-Reihenfolge', () => {
    const pending: Row[] = [real('temp-1', 'frisch')]
    const merged = mergePending([real('a'), real('b')], pending)
    expect(merged.map((r) => r.id)).toEqual(['temp-1', 'a', 'b'])
  })

  it('gleiche id: die echte Serverzeile gewinnt, die Temp-Zeile fällt weg', () => {
    const pending: Row[] = [real('a', 'Temp-Verdopplung'), real('x', 'echt neu')]
    const merged = mergePending([real('a'), real('b')], pending)
    expect(merged.map((r) => r.id)).toEqual(['x', 'a', 'b'])
    expect(merged.find((r) => r.id === 'a')?.label).toBe('a')
  })

  it('ohne hängende Zeilen bleibt die echte Liste unverändert (gleiche Referenz)', () => {
    const rows = [real('a')]
    expect(mergePending(rows, [])).toBe(rows)
  })

  it('alle hängenden sind bereits da → echte Liste zurück (identische Referenz)', () => {
    const rows = [real('temp-1')]
    expect(mergePending(rows, [real('temp-1', 'doppelt')])).toBe(rows)
  })
})

describe('dropRemoved / dropSplitsOfRemoved — offline gelöschte Zeilen', () => {
  it('Tombstones filtern echte Zeilen nach id heraus', () => {
    const removed = new Set(['b'])
    expect(dropRemoved([real('a'), real('b'), real('c')], removed).map((r) => r.id)).toEqual(['a', 'c'])
  })

  it('leere Tombstone-Menge gibt die Liste unangetastet zurück', () => {
    const rows = [real('a'), real('b')]
    expect(dropRemoved(rows, new Set())).toBe(rows)
  })

  it('Splits einer gelöschten Ausgabe anhand expense_id raus, andere bleiben', () => {
    const removed = new Set(['exp-1'])
    const splits = [splitOf('s1', 'exp-1'), splitOf('s2', 'exp-2'), splitOf('s3', 'exp-1')]
    expect(dropSplitsOfRemoved(splits, removed)).toEqual([splitOf('s2', 'exp-2')])
  })

  it('leere Tombstone-Menge gibt die Splits unangetastet zurück', () => {
    const splits = [splitOf('s1', 'exp-1')]
    expect(dropSplitsOfRemoved(splits, new Set<string>())).toBe(splits)
  })
})
