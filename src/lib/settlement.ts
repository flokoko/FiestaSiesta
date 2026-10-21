import type { Expense, ExpenseSplit, ExpenseQuota, Settlement } from '../types'

export interface SettlementTxn {
  from: string
  to: string
  amount: number
}

export interface BalanceEntry {
  name: string
  balance: number
}

export interface ExpenseMatrix {
  debtors: string[]
  creditors: string[]
  cells: Record<string, Record<string, number>>
}

/** Per-person balance: total paid minus total share */
export function computeBalances(
  expenses: Expense[],
  expenseSplits: ExpenseSplit[],
): Record<string, number> {
  const map: Record<string, number> = {}
  for (const e of expenses) {
    map[e.paid_by] = (map[e.paid_by] ?? 0) + e.amount
  }
  for (const s of expenseSplits) {
    map[s.person_name] = (map[s.person_name] ?? 0) - s.share_amount
  }
  return map
}

/**
 * Subtract settled payments from net balances to get OPEN balances.
 * For each settlement: payer balance += amount (debt decreases),
 *                       payee balance -= amount (credit decreases).
 * Rounded to cents. Does not modify the input balances map.
 */
export function computeOpenBalances(
  balances: Record<string, number>,
  settlements: SettlementTxn[],
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [name, balance] of Object.entries(balances)) {
    result[name] = Math.round(balance * 100) / 100
  }
  for (const s of settlements) {
    // payer's debt decreases → their balance goes up (toward zero)
    result[s.from] = (result[s.from] ?? 0) + s.amount
    // payee's credit decreases → their balance goes down (toward zero)
    result[s.to] = (result[s.to] ?? 0) - s.amount
    result[s.from] = Math.round(result[s.from] * 100) / 100
    result[s.to] = Math.round(result[s.to] * 100) / 100
  }
  return result
}

/**
 * Settlement proposals that stay STABLE as payments are recorded.
 *
 * The proposals are derived ONCE from the ORIGINAL balances (greedy,
 * minimized-transaction). Settled payments are then subtracted only from the
 * proposal that matches the same payer→payee pair. This means settling one
 * debt shrinks (or removes) exactly that proposal and leaves all OTHER
 * passengers' debts unchanged — unlike re-running the greedy algorithm on the
 * open balances, which would re-optimize and reshuffle every proposal.
 */
export function computeSettlementProposals(
  balances: Record<string, number>,
  settlements: SettlementTxn[],
): SettlementTxn[] {
  const proposals = computeSettlement(balances)

  // Sum settled payments per payer→payee pair.
  const settledByPair = new Map<string, number>()
  for (const s of settlements) {
    const key = `${s.from}\u0000${s.to}`
    settledByPair.set(key, (settledByPair.get(key) ?? 0) + s.amount)
  }

  const result: SettlementTxn[] = []
  for (const p of proposals) {
    const key = `${p.from}\u0000${p.to}`
    const paid = settledByPair.get(key) ?? 0
    const remaining = Math.round((p.amount - paid) * 100) / 100
    if (remaining > 0.001) {
      result.push({ from: p.from, to: p.to, amount: remaining })
    }
  }
  return result
}

/** Greedy minimized-transaction settlement from a balances map */
export function computeSettlement(balances: Record<string, number>): SettlementTxn[] {
  const creditors: { name: string; amount: number }[] = []
  const debtors: { name: string; amount: number }[] = []

  for (const [name, balance] of Object.entries(balances)) {
    const rounded = Math.round(balance * 100) / 100
    if (rounded > 0.01) creditors.push({ name, amount: rounded })
    else if (rounded < -0.01) debtors.push({ name, amount: -rounded })
  }

  creditors.sort((a, b) => b.amount - a.amount)
  debtors.sort((a, b) => b.amount - a.amount)

  const txns: SettlementTxn[] = []
  let ci = 0
  let di = 0

  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci]
    const d = debtors[di]
    const payment = Math.round(Math.min(c.amount, d.amount) * 100) / 100
    if (payment > 0) {
      txns.push({ from: d.name, to: c.name, amount: payment })
    }
    c.amount = Math.round((c.amount - payment) * 100) / 100
    d.amount = Math.round((d.amount - payment) * 100) / 100
    if (c.amount < 0.01) ci++
    if (d.amount < 0.01) di++
  }

  return txns
}

/** Sorted balance entries (highest positive first) */
export function sortedBalanceEntries(balances: Record<string, number>): BalanceEntry[] {
  return Object.entries(balances)
    .map(([name, balance]) => ({ name, balance: Math.round(balance * 100) / 100 }))
    .sort((a, b) => b.balance - a.balance)
}

/**
 * Matrix: who owes whom (debtor × creditor grid).
 * Zeigt die offenen (bereits beglichene Schulden abgezogene) Beträge — was
 * jede Person der jeweils anderen aktuell noch zahlen muss.
 */
export function computeMatrix(
  expenses: Expense[],
  expenseSplits: ExpenseSplit[],
  settlements: Settlement[] = [],
): ExpenseMatrix {
  const debtGrid: Record<string, Record<string, number>> = {}

  // Pre-index splits by expense_id once (O(n) instead of O(n·m) filtering
  // inside the expenses loop below).
  const splitsByExpense = new Map<string, ExpenseSplit[]>()
  for (const s of expenseSplits) {
    const list = splitsByExpense.get(s.expense_id)
    if (list) list.push(s)
    else splitsByExpense.set(s.expense_id, [s])
  }

  for (const expense of expenses) {
    const splits = splitsByExpense.get(expense.id) ?? []
    const payer = expense.paid_by
    for (const split of splits) {
      if (split.person_name === payer) continue
      if (!debtGrid[split.person_name]) debtGrid[split.person_name] = {}
      debtGrid[split.person_name][payer] = (debtGrid[split.person_name][payer] ?? 0) + split.share_amount
    }
  }

  // Bereits beglichene Beträge von der jeweiligen Zelle abziehen:
  // eine Zahlung payer → payee reduziert exakt die Schuld payer→payee.
  // Auf 0 gedeckelt — eine Überzahlung erzeugt keine negative Zelle.
  for (const s of settlements) {
    const cell = debtGrid[s.payer]?.[s.payee]
    if (cell === undefined) continue
    const remaining = cell - s.amount
    if (remaining <= 0) {
      delete debtGrid[s.payer][s.payee]
      if (Object.keys(debtGrid[s.payer]).length === 0) delete debtGrid[s.payer]
    } else {
      debtGrid[s.payer][s.payee] = Math.round(remaining * 100) / 100
    }
  }

  const allDebtorNames = Object.keys(debtGrid)
  const allCreditorNames = new Set<string>()
  for (const d of allDebtorNames) {
    for (const c of Object.keys(debtGrid[d])) allCreditorNames.add(c)
  }

  const debtors = allDebtorNames.sort((a, b) => a.localeCompare(b))
  const creditors = Array.from(allCreditorNames).sort((a, b) => a.localeCompare(b))

  return { debtors, creditors, cells: debtGrid }
}

/** Calculate share amounts for saving an expense */
export function calculateShareAmounts(
  splitMode: 'equal' | 'exact',
  splitPeople: string[],
  amountNum: number,
  exactShares: Record<string, string>,
): { person_name: string; share_amount: number }[] {
  if (splitMode === 'equal') {
    if (splitPeople.length === 0) return []
    const totalCents = Math.round(amountNum * 100)
    const perCents = Math.floor(totalCents / splitPeople.length)
    const remainder = totalCents - perCents * splitPeople.length
    return splitPeople.map((p, i) => ({
      person_name: p,
      share_amount: (perCents + (i < remainder ? 1 : 0)) / 100,
    }))
  }
  return splitPeople.map((p) => {
    const val = parseFloat(exactShares[p] ?? '0')
    return { person_name: p, share_amount: isNaN(val) ? 0 : val }
  })
}

/**
 * Calculate share amounts from quota percentages.
 * Same rounding logic as calculateShareAmounts: floor to cents,
 * remainder goes to the largest quota holders (by absolute cents).
 */
export function calculateQuotaShares(
  quotas: ExpenseQuota[],
  allPersons: string[],
  amountNum: number,
): { person_name: string; share_amount: number }[] {
  if (allPersons.length === 0 || amountNum <= 0) return []

  // Build person -> percent map from quotas (only persons in allPersons)
  const percentMap = new Map<string, number>()
  for (const q of quotas) {
    if (allPersons.includes(q.person_name)) {
      percentMap.set(q.person_name, (percentMap.get(q.person_name) ?? 0) + q.percent)
    }
  }

  // Only persons with a quota > 0 participate
  const participants = allPersons.filter(p => (percentMap.get(p) ?? 0) > 0)
  if (participants.length === 0) return []

  const totalCents = Math.round(amountNum * 100)

  // If all participating quotas are (to within rounding) equal, this is an
  // even distribution → split the amount equally in cents. Doing this via the
  // rounded percentages (e.g. 33.33 / 33.33 / 33.34) would inflate the tiny
  // 0.01% rounding difference into real cent gaps at large amounts (at 1000 €
  // a 33.33 vs 33.34 split is off by 10 cents). Equal-splitting directly keeps
  // every person within 1 cent of each other, the mathematical optimum.
  const firstPct = percentMap.get(participants[0]) ?? 0
  const isEven = participants.every(p => Math.abs((percentMap.get(p) ?? 0) - firstPct) < 0.011)
  if (isEven) {
    const perCents = Math.floor(totalCents / participants.length)
    const remainder = totalCents - perCents * participants.length
    return participants.map((p, i) => ({
      person_name: p,
      share_amount: (perCents + (i < remainder ? 1 : 0)) / 100,
    }))
  }

  // Calculate raw cents per person (floored)
  const rawCents = participants.map(p => {
    const pct = percentMap.get(p) ?? 0
    return { person_name: p, cents: Math.floor((totalCents * pct) / 100) }
  })

  // Remainder: distribute to those with the highest fractional part
  // (i.e. those whose floor cost them the most relative to their quota)
  const distributed = rawCents.reduce((s, r) => s + r.cents, 0)
  let remainder = totalCents - distributed

  if (remainder > 0) {
    // Sort by who lost the most to flooring (highest raw value before floor)
    const fractionalLoss = participants.map((p, i) => {
      const pct = percentMap.get(p) ?? 0
      const raw = (totalCents * pct) / 100
      return { person_name: p, loss: raw - rawCents[i].cents, idx: i }
    })
    fractionalLoss.sort((a, b) => b.loss - a.loss)
    for (let i = 0; i < remainder && i < fractionalLoss.length; i++) {
      rawCents[fractionalLoss[i].idx].cents += 1
    }
  }

  return rawCents.map(r => ({ person_name: r.person_name, share_amount: r.cents / 100 }))
}

/**
 * True when a category's quota config is effectively an even split across ALL
 * participants (every person has the same non-zero percent). In that case the
 * category behaves exactly like one without any quota config — the quota banner
 * is hidden and the split falls back to the normal equal/exact behaviour.
 */
export function isEqualQuotaDistribution(
  quotas: ExpenseQuota[],
  allPersons: string[],
): boolean {
  if (allPersons.length === 0) return false

  // Build person -> percent map (same logic as calculateQuotaShares)
  const percentMap = new Map<string, number>()
  for (const q of quotas) {
    if (allPersons.includes(q.person_name)) {
      percentMap.set(q.person_name, (percentMap.get(q.person_name) ?? 0) + q.percent)
    }
  }

  // Every person must participate with the same non-zero percent
  const participants = allPersons.filter(p => (percentMap.get(p) ?? 0) > 0)
  if (participants.length !== allPersons.length) return false

  const firstPct = percentMap.get(participants[0]) ?? 0
  return participants.every(p => Math.abs((percentMap.get(p) ?? 0) - firstPct) < 0.011)
}

/** Total expenses */
export function totalExpenses(expenses: Expense[]): number {
  return expenses.reduce((sum, e) => sum + e.amount, 0)
}

/** Group expenses by date (newest first), optionally filtered by search query */
export function groupExpensesByDate(
  expenses: Expense[],
  searchQuery: string,
): [string, Expense[]][] {
  const filtered = searchQuery.trim()
    ? expenses.filter((e) => e.description.toLowerCase().includes(searchQuery.toLowerCase()))
    : expenses
  const groups: Record<string, Expense[]> = {}
  for (const e of filtered) {
    if (!groups[e.expense_date]) groups[e.expense_date] = []
    groups[e.expense_date].push(e)
  }
  return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]))
}

/** Splits for a given expense */
export function getSplitInfo(
  expense: Expense,
  expenseSplits: ExpenseSplit[],
): string {
  const splits = expenseSplits.filter((s) => s.expense_id === expense.id)
  if (expense.split_mode === 'equal') {
    return `Geteilt durch ${splits.length} ${splits.length === 1 ? 'Person' : 'Personen'}`
  }
  return splits
    .map((s) => `${s.person_name}: ${fmtEUR(s.share_amount)}`)
    .join(', ')
}

// ── Format helpers ──────────────────────────────────────────────────

export function fmtEUR(amount: number): string {
  return amount.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
}

export function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}