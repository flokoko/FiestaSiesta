import { useMemo } from 'react'
import { Wallet } from 'lucide-react'
import type { Expense, ExpenseSplit, Settlement } from '../types'
import { computeMatrix, totalExpenses, fmtEUR } from '../lib/settlement'

interface ExpenseMatrixProps {
  expenses: Expense[]
  expenseSplits: ExpenseSplit[]
  settlements: Settlement[]
}

export default function ExpenseMatrix({ expenses, expenseSplits, settlements }: ExpenseMatrixProps) {
  const total = useMemo(() => totalExpenses(expenses), [expenses])
  const matrix = useMemo(
    () => computeMatrix(expenses, expenseSplits, settlements),
    [expenses, expenseSplits, settlements],
  )

  return (
    <div key="matrix">
      <div className="expense-total-banner">
        <Wallet size={18} strokeWidth={2} /> Gesamtausgaben: {fmtEUR(total)}
      </div>

      {expenses.length === 0 ? (
        <p className="expense-empty">Noch keine Ausgaben für die Matrix.</p>
      ) : matrix.debtors.length === 0 ? (
        <p className="expense-settlement-empty">Alle ausgeglichen — keine offenen Schulden!</p>
      ) : (
        <div className="expense-matrix-wrapper">
          <table className="expense-matrix">
            <thead>
              <tr>
                <th className="expense-matrix-corner">schuldet →<br />↓ bekommt</th>
                {matrix.creditors.map(c => (
                  <th key={c} className="expense-matrix-header">{c}</th>
                ))}
                <th className="expense-matrix-total-header">Σ Schulden</th>
              </tr>
            </thead>
            <tbody>
              {matrix.debtors.map(debtor => {
                const totalOwed = matrix.creditors.reduce((sum, c) => sum + ((matrix.cells[debtor]?.[c]) ?? 0), 0)
                return (
                  <tr key={debtor}>
                    <td className="expense-matrix-label">{debtor}</td>
                    {matrix.creditors.map(c => {
                      const val = matrix.cells[debtor]?.[c] ?? 0
                      return (
                        <td key={c} className={`expense-matrix-cell ${val > 0 ? 'has-debt' : ''}`}>
                          {val > 0 ? fmtEUR(val) : '—'}
                        </td>
                      )
                    })}
                    <td className="expense-matrix-total">{totalOwed > 0 ? fmtEUR(totalOwed) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="expense-matrix-hint">
            <strong>So liest du die Matrix:</strong> {matrix.debtors.join(', ')} schulden Geld an {matrix.creditors.join(', ')}.
            Jede Zelle zeigt, was der Schuldner (Zeile) dem Gläubiger (Spalte) zahlen muss.
          </p>
        </div>
      )}
    </div>
  )
}