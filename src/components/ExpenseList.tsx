import { useMemo } from 'react'
import { Trash2, Receipt } from 'lucide-react'
import type { Expense, ExpenseSplit, ItemCategory } from '../types'
import { fmtEUR } from '../lib/settlement'
import { expenseIcon, expenseTint } from '../lib/expenseIcons'
import { SkeletonExpenseCard } from './Skeleton'

interface ExpenseListProps {
  expenses: Expense[]
  expenseSplits: ExpenseSplit[]
  expenseCategories: ItemCategory[]
  searchQuery: string
  userName: string
  isLoading?: boolean
  formExpanded: boolean
  onEdit: (expense: Expense) => void
  onDelete: (expense: Expense) => void
}

/** "1. Dez" — das Datum ist Kontext, keine Überschrift. */
function shortDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })
}

/** "Dezember 2026" als ruhige Gruppenüberschrift. */
function monthLabel(monthKey: string): string {
  const d = new Date(`${monthKey}-01T00:00:00`)
  return d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
}

function payerLabel(payer: string, userName: string): string {
  if (payer === userName) return 'Du hast bezahlt'
  return `${payer.split(' ')[0]} hat bezahlt`
}

export default function ExpenseList({
  expenses,
  expenseSplits,
  searchQuery,
  userName,
  isLoading,
  formExpanded,
  onEdit,
  onDelete,
}: ExpenseListProps) {
  // Monatsgruppen statt Tagesüberschriften: eine Überschrift pro Tag wäre bei
  // drei Ausgaben schon Lärm, das Datum steht in der Zeile.
  const groups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const filtered = q
      ? expenses.filter(
          (e) =>
            e.description.toLowerCase().includes(q) ||
            (e.category ?? '').toLowerCase().includes(q) ||
            e.paid_by.toLowerCase().includes(q),
        )
      : expenses
    const byMonth = new Map<string, Expense[]>()
    for (const e of filtered) {
      const key = e.expense_date.slice(0, 7)
      const list = byMonth.get(key)
      if (list) list.push(e)
      else byMonth.set(key, [e])
    }
    return [...byMonth.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, items]) => [monthLabel(key), items] as [string, Expense[]])
  }, [expenses, searchQuery])

  if (isLoading) {
    return (
      <div className="xp-list">
        <SkeletonExpenseCard />
        <SkeletonExpenseCard />
        <SkeletonExpenseCard />
      </div>
    )
  }

  if (expenses.length === 0 && !formExpanded) {
    return (
      <div className="xp-empty">
        <span className="xp-empty-icon">
          <Receipt size={22} strokeWidth={1.6} />
        </span>
        <strong>Noch keine Ausgabe</strong>
        <span>Wer gezahlt hat, tragt ihr hier ein — abgerechnet wird am Ende.</span>
      </div>
    )
  }

  return (
    <div className="xp-list">
      {groups.map(([month, items]) => (
        <section key={month} className="xp-group">
          <h3 className="xp-group-label">{month}</h3>
          <div className="xp-rows">
            {items.map((expense) => {
              const Icon = expenseIcon(expense.category)
              const splits = expenseSplits.filter((s) => s.expense_id === expense.id)
              const mySplit = splits.find((s) => s.person_name === userName)
              // Die Kategorie steckt schon im Icon — in der Zeile zählt, wer
              // gezahlt hat und wann. Sonst wird die Meta-Zeile abgeschnitten.
              const meta = `${payerLabel(expense.paid_by, userName)} · ${shortDate(expense.expense_date)}`
              return (
                <div key={expense.id} className="xp-row">
                  <button
                    type="button"
                    className="xp-row-hit"
                    onClick={() => onEdit(expense)}
                    aria-label={`${expense.description} bearbeiten`}
                  >
                    <span className="xp-row-icon" style={{ background: expenseTint(expense.category) }}>
                      <Icon size={18} strokeWidth={1.9} />
                    </span>
                    <span className="xp-row-main">
                      <span className="xp-row-title">{expense.description}</span>
                      <span className="xp-row-meta">{meta}</span>
                    </span>
                    <span className="xp-row-right">
                      <span className="xp-row-amount">{fmtEUR(expense.amount)}</span>
                      {mySplit && <span className="xp-row-share">Anteil {fmtEUR(mySplit.share_amount)}</span>}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="xp-row-del"
                    onClick={() => onDelete(expense)}
                    aria-label={`${expense.description} löschen`}
                  >
                    <Trash2 size={16} strokeWidth={1.9} />
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
