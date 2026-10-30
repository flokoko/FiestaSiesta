import { describe, it, expect } from 'vitest'
import { computeMatrix, computeSettlementProposals, calculateQuotaShares, roundCents, type SettlementTxn } from '../settlement'
import type { Expense, ExpenseSplit, ExpenseQuota, Settlement } from '../../types'

const makeExpense = (id: string, paidBy: string, amount = 100): Expense => ({
  id,
  list_id: 'list',
  description: `Ausgabe ${id}`,
  amount,
  paid_by: paidBy,
  expense_date: '2026-01-01',
  split_mode: 'equal',
  note: null,
  category: null,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
})

const makeSplit = (expenseId: string, personName: string, shareAmount = 100): ExpenseSplit => ({
  id: `${expenseId}-${personName}`,
  expense_id: expenseId,
  person_name: personName,
  share_amount: shareAmount,
  created_at: '2026-01-01T00:00:00Z',
})

describe('computeMatrix', () => {
  it('zeigt ursprüngliche Schulden ohne beglichene Zahlungen', () => {
    // Alice zahlt 100€, Bob ist der einzige Split-Anteil → Bob schuldet Alice 100€.
    const expenses = [makeExpense('e1', 'Alice')]
    const splits = [makeSplit('e1', 'Bob', 100)]

    const m = computeMatrix(expenses, splits)

    expect(m.debtors).toEqual(['Bob'])
    expect(m.creditors).toEqual(['Alice'])
    expect(m.cells['Bob']?.['Alice']).toBe(100)
  })

  it('zieht beglichene Beträge von der jeweiligen Zelle ab', () => {
    const expenses = [makeExpense('e1', 'Alice')]
    const splits = [makeSplit('e1', 'Bob', 100)]
    // Bob hat bereits 40€ an Alice beglichen.
    const settlements: Settlement[] = [
      {
        id: 's1',
        list_id: 'list',
        payer: 'Bob',
        payee: 'Alice',
        amount: 40,
        settled_at: '2026-01-02',
        created_by: null,
        created_at: '2026-01-02T00:00:00Z',
      },
    ]

    const m = computeMatrix(expenses, splits, settlements)

    expect(m.cells['Bob']?.['Alice']).toBe(60)
  })

  it('entfernt die Zelle bei vollständig beglichener Schuld', () => {
    const expenses = [makeExpense('e1', 'Alice')]
    const splits = [makeSplit('e1', 'Bob', 100)]
    const settlements: Settlement[] = [
      {
        id: 's1',
        list_id: 'list',
        payer: 'Bob',
        payee: 'Alice',
        amount: 100,
        settled_at: '2026-01-02',
        created_by: null,
        created_at: '2026-01-02T00:00:00Z',
      },
    ]

    const m = computeMatrix(expenses, splits, settlements)

    // Zelle vollständig abgezogen → Bob taucht nicht mehr als Schuldner auf.
    expect(m.cells['Bob']).toBeUndefined()
    expect(m.debtors).toEqual([])
    expect(m.creditors).toEqual([])
  })

  it('übernimmt Begleichungen ohne bestehende Schuld nicht negativ (Überzahlung)', () => {
    const expenses = [makeExpense('e1', 'Alice')]
    const splits = [makeSplit('e1', 'Bob', 50)]
    const settlements: Settlement[] = [
      {
        id: 's1',
        list_id: 'list',
        payer: 'Bob',
        payee: 'Alice',
        amount: 80,
        settled_at: '2026-01-02',
        created_by: null,
        created_at: '2026-01-02T00:00:00Z',
      },
    ]

    const m = computeMatrix(expenses, splits, settlements)

    // Überzahlung deckelt bei 0 — keine negative Zelle.
    expect(m.cells['Bob']?.['Alice']).toBeUndefined()
    expect(m.debtors).toEqual([])
  })
})

describe('computeSettlementProposals', () => {
  it('bleibt stabil: Begleichen einer Schuld verändert die anderen Vorschläge nicht', () => {
    // Drei Personen: Alice hat 100€ ausgegeben (Bob 50, Carol 50 schulden),
    // Bob hat 60€ ausgegeben (Alice 30, Carol 30 schulden).
    // Netto-Salden: Alice +70, Bob -10, Carol -60.
    const balances = { Alice: 70, Bob: -10, Carol: -60 }

    // Ohne Begleichungen: Greedy minimiert Transaktionen.
    const base = computeSettlementProposals(balances, [])
    // Erwartung: Carol → Alice 60, Bob → Alice 10 (2 Transaktionen).
    expect(base).toEqual([
      { from: 'Carol', to: 'Alice', amount: 60 },
      { from: 'Bob', to: 'Alice', amount: 10 },
    ])

    // Bob begleicht seine 10€ an Alice.
    const settled: SettlementTxn[] = [{ from: 'Bob', to: 'Alice', amount: 10 }]
    const after = computeSettlementProposals(balances, settled)

    // Bobs Vorschlag verschwindet, aber Carols 60€ bleiben UNVERÄNDERT.
    expect(after).toEqual([{ from: 'Carol', to: 'Alice', amount: 60 }])
  })

  it('reduziert Teilzahlungen nur auf dem passenden Paar', () => {
    const balances = { Alice: 70, Bob: -10, Carol: -60 }
    // Carol zahlt 20€ von ihren 60€ an Alice.
    const settled: SettlementTxn[] = [{ from: 'Carol', to: 'Alice', amount: 20 }]
    const after = computeSettlementProposals(balances, settled)

    expect(after).toEqual([
      { from: 'Carol', to: 'Alice', amount: 40 },
      { from: 'Bob', to: 'Alice', amount: 10 },
    ])
  })
})

describe('calculateQuotaShares', () => {
  const makeQuota = (personName: string, percent: number): ExpenseQuota => ({
    id: `q-${personName}`,
    list_id: 'list',
    category: 'c',
    person_name: personName,
    percent,
    created_at: '2026-01-01T00:00:00Z',
  })

  it('verteilt den vollen Betrag, auch wenn die Quotensumme unter 100 % liegt', () => {
    // 50 % + 30 % = 80 % — die Rest-Cents bleiben im Topf, nichts geht verloren.
    const shares = calculateQuotaShares(
      [makeQuota('Alice', 50), makeQuota('Bob', 30)],
      ['Alice', 'Bob'],
      137,
    )
    const total = shares.reduce((s, r) => s + r.share_amount, 0)
    expect(Math.round(total * 100)).toBe(13700)
  })

  it('gibt den ersten Rest-Cent der Person mit dem größten Bruchteil-Verlust', () => {
    // 1 Cent bei 50 % / 30 %: raw 0.5 / 0.3 → Alice lost am meisten beim Floor.
    const shares = calculateQuotaShares(
      [makeQuota('Alice', 50), makeQuota('Bob', 30)],
      ['Alice', 'Bob'],
      0.01,
    )
    expect(shares).toEqual([
      { person_name: 'Alice', share_amount: 0.01 },
      { person_name: 'Bob', share_amount: 0 },
    ])
  })

  it('schließt Personen mit 0 % Quote aus, verliert aber keinen Betrag', () => {
    const shares = calculateQuotaShares(
      [makeQuota('Alice', 50), makeQuota('Bob', 30), makeQuota('Carol', 0)],
      ['Alice', 'Bob', 'Carol'],
      89.99,
    )
    const total = shares.reduce((s, r) => s + r.share_amount, 0)
    expect(Math.round(total * 100)).toBe(8999)
    expect(shares.some(s => s.person_name === 'Carol')).toBe(false)
  })

  it('zieht bei Quotensumme über 100 % den Überschuss wieder ab', () => {
    // 80 % + 80 % auf 10 €: die Shares dürfen NICHT zusammen 16 € ergeben.
    const shares = calculateQuotaShares(
      [makeQuota('Alice', 80), makeQuota('Bob', 80)],
      ['Alice', 'Bob'],
      10,
    )
    const total = shares.reduce((s, r) => s + r.share_amount, 0)
    expect(Math.round(total * 100)).toBe(1000)
  })

  it('behält die exakte Gleichverteilung bei (≈ gleiche Quoten)', () => {
    // 33.33 / 33.33 / 33.34 wird als gleich behandelt → exakter Equal-Split.
    const shares = calculateQuotaShares(
      [makeQuota('Alice', 33.33), makeQuota('Bob', 33.33), makeQuota('Carol', 33.34)],
      ['Alice', 'Bob', 'Carol'],
      1000,
    )
    const total = shares.reduce((s, r) => s + r.share_amount, 0)
    expect(Math.round(total * 100)).toBe(100000)
    expect(Math.max(...shares.map(s => s.share_amount)) - Math.min(...shares.map(s => s.share_amount))).toBeLessThanOrEqual(0.01)
  })
})

describe('roundCents', () => {
  it('rundet Halb-Cent-Beträge kaufmännisch statt float-bedingt ab', () => {
    // 1.005 * 100 = 100.49999999999999 -> naive Rundung ergäbe 1,00
    expect(roundCents(1.005)).toBe(1.01)
    expect(roundCents(10.075)).toBe(10.08)
    expect(roundCents(1.015)).toBe(1.02)
  })

  it('behandelt negative Beträge symmetrisch', () => {
    expect(roundCents(-1.005)).toBe(-1.01)
    expect(roundCents(-0.004)).toBe(0)
  })

  it('lässt saubere Centbeträge unverändert', () => {
    expect(roundCents(41.99)).toBe(41.99)
    expect(roundCents(0.1 + 0.2)).toBe(0.3)
    expect(roundCents(0)).toBe(0)
  })
})
