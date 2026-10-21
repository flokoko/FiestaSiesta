import { useMemo } from 'react'
import { Pencil, Trash2, MessageSquare, Pizza } from 'lucide-react'
import type { Expense, ExpenseSplit, ItemCategory } from '../types'
import { groupExpensesByDate, getSplitInfo, fmtEUR, fmtDate } from '../lib/settlement'
import { SkeletonExpenseCard } from './Skeleton'

interface ExpenseListProps {
  expenses: Expense[]
  expenseSplits: ExpenseSplit[]
  expenseCategories: ItemCategory[]
  searchQuery: string
  isLoading?: boolean
  formExpanded: boolean
  onEdit: (expense: Expense) => void
  onDelete: (expense: Expense) => void
}

export default function ExpenseList({
  expenses,
  expenseSplits,
  expenseCategories,
  searchQuery,
  isLoading,
  formExpanded,
  onEdit,
  onDelete,
}: ExpenseListProps) {
  const groupedExpenses = useMemo(
    () => groupExpensesByDate(expenses, searchQuery),
    [expenses, searchQuery],
  )

  if (isLoading) {
    return (
      <div className="expense-list">
        <SkeletonExpenseCard />
        <SkeletonExpenseCard />
        <SkeletonExpenseCard />
      </div>
    )
  }

  return (
    <>
      {expenses.length === 0 && !formExpanded && (
        <p className="expense-empty"><Pizza size={24} strokeWidth={1.5} /> Noch keine Ausgaben — füge die erste hinzu!</p>
      )}

      <div className="expense-list">
        {groupedExpenses.map(([date, items]) => (
          <div key={date} className="expense-date-group">
            <div className="expense-date-header">{fmtDate(date)}</div>
            {items.map((expense) => (
              <div key={expense.id} className="expense-card">
                <div className="expense-card-top">
                  <div className="expense-card-info">
                    <div className="expense-card-desc">{expense.description}</div>
                    <div className="expense-card-amount">{fmtEUR(expense.amount)}</div>
                  </div>
                  <div className="expense-card-buttons">
                    <button
                      className="expense-card-btn"
                      onClick={() => onEdit(expense)}
                      aria-label="Bearbeiten"
                    >
                      <Pencil size={16} strokeWidth={2} />
                    </button>
                    <button
                      className="expense-card-btn"
                      onClick={() => onDelete(expense)}
                      aria-label="Löschen"
                    >
                      <Trash2 size={16} strokeWidth={2} />
                    </button>
                  </div>
                </div>
                <div className="expense-card-meta">
                  {expense.category && (
                    <span className="expense-card-category">
                      {expenseCategories.find(c => c.name === expense.category)?.icon ?? '📦'} {expense.category}
                    </span>
                  )}
                  Bezahlt von {expense.paid_by}
                </div>
                <div className="expense-card-split">{getSplitInfo(expense, expenseSplits)}</div>
                {expense.note && (
                  <div className="expense-card-note">
                    <MessageSquare size={12} strokeWidth={2} /> {expense.note}
                  </div>
                )}
                {expense.created_by && (
                  <div className="expense-card-by">von {expense.created_by}</div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}