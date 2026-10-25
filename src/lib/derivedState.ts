/**
 * Pure derivation functions for useListData state.
 *
 * Extracted from useListData (Fix #1) to separate pure logic from the hook's
 * state management. These functions have no side effects and no React dependencies.
 *
 * The hook still owns the state and calls these via useMemo, but the logic
 * lives here so it can be tested independently and reused if the hook is
 * further decomposed.
 */

import type {
  ListItem,
  ItemCategory,
  Expense,
  ExpenseSplit,
  Participant,
  Settlement,
} from '../types'
import { computeOpenBalances } from './settlement'

/** Categories filtered for a specific list_type */
export function deriveCategoriesByType(
  categories: ItemCategory[],
  listType: 'shopping' | 'bring',
): ItemCategory[] {
  return categories.filter((c) => c.list_type === listType)
}

/** All known persons: userName + all participants, sorted */
export function deriveKnownPersons(
  userName: string | null,
  participants: Participant[],
): string[] {
  const names = new Set<string>()
  if (userName) names.add(userName)
  participants.forEach(p => names.add(p.name))
  return Array.from(names).sort((a, b) => a.localeCompare(b))
}

/**
 * Offener Saldo für einen Nutzer — EINE Wahrheit für Home/Notizen/Geld-Tab:
 * bezahlt − Anteil, abzüglich beglichener Zahlungen (computeOpenBalances aus
 * settlement.ts, damit der Betrag identisch mit dem Geld-Tab ist). Auf Cent
 * gerundet.
 */
export function deriveUserBalance(
  expenses: Expense[],
  expenseSplits: ExpenseSplit[],
  settlements: Settlement[],
  userName: string | null,
): number {
  if (!userName) return 0
  const paid = expenses.filter(e => e.paid_by === userName).reduce((s, e) => s + e.amount, 0)
  const share = expenseSplits.filter(s => s.person_name === userName).reduce((s, s2) => s + s2.share_amount, 0)
  const open = computeOpenBalances(
    { [userName]: paid - share },
    settlements.map(s => ({ from: s.payer, to: s.payee, amount: s.amount })),
  )
  return Math.round((open[userName] ?? 0) * 100) / 100
}

/** Total of all expenses */
export function deriveExpenseTotal(expenses: Expense[]): number {
  return expenses.reduce((sum, e) => sum + e.amount, 0)
}

/** Whether the current user is an admin (has an admin participant entry) */
export function deriveIsAdmin(
  participants: Participant[],
  userName: string | null,
): boolean {
  if (!userName) return false
  return participants.some(p => p.name === userName && p.is_admin)
}

/** Count of checked shopping items */
export function deriveCheckedCount(shoppingItems: ListItem[]): number {
  return shoppingItems.filter((i) => i.is_checked).length
}