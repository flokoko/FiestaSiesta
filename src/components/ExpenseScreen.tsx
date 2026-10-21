import { useState, useMemo, useCallback } from 'react'
import { Wallet, Receipt, Table2, Percent } from 'lucide-react'
import type { Expense, ExpenseSplit, ExpenseQuota, ItemCategory, Settlement } from '../types'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import { isEqualQuotaDistribution } from '../lib/settlement'
import ExpenseForm from './ExpenseForm'
import ExpenseList from './ExpenseList'
import ExpenseSettlement from './ExpenseSettlement'
import ExpenseMatrix from './ExpenseMatrix'
import ExpenseQuotaManager from './ExpenseQuotaManager'
import './ExpenseScreen.css'

interface ExpenseScreenProps {
  expenses: Expense[]
  expenseSplits: ExpenseSplit[]
  expenseQuotas: ExpenseQuota[]
  listId: string
  userName: string
  knownPersons: string[]
  expenseCategories: ItemCategory[]
  isLoading?: boolean
  isAdmin: boolean
  adminUnlocked: boolean
  onExpensesChange: () => void
  onCategoriesChange: () => void
  onQuotasChange: () => void
  settlements: Settlement[]
  onSettlementsChange: () => void
}

export default function ExpenseScreen({
  expenses,
  expenseSplits,
  expenseQuotas,
  listId,
  userName,
  knownPersons,
  expenseCategories,
  isLoading,
  isAdmin,
  adminUnlocked,
  onExpensesChange,
  onCategoriesChange,
  onQuotasChange,
  settlements,
  onSettlementsChange,
}: ExpenseScreenProps) {
  const { toast, confirm } = useToast()
  const [section, setSection] = useState<'expenses' | 'settlement' | 'matrix' | 'quotas'>('expenses')
  const [formExpanded, setFormExpanded] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [paidBy, setPaidBy] = useState(userName)
  const [splitPeople, setSplitPeople] = useState<string[]>([])
  const [splitMode, setSplitMode] = useState<'equal' | 'exact'>('equal')
  const [exactShares, setExactShares] = useState<Record<string, string>>({})
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [expenseNote, setExpenseNote] = useState('')
  const [expenseCategory, setExpenseCategory] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  // ── All known persons (from props) ──
  const allPersons = useMemo(() => {
    const names = new Set<string>(knownPersons)
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [knownPersons])

  // ── Quotas for the selected category (for auto-split in form) ──
  const categoryQuotas = useMemo(() => {
    if (!expenseCategory) return []
    return expenseQuotas.filter(q => q.category === expenseCategory)
  }, [expenseQuotas, expenseCategory])

  // A category is "quota-driven" only when it has a real, non-equal quota
  // config. If the quotas were adjusted but still split evenly across all
  // participants (everyone the same percent), behave exactly like a category
  // without any quota config — no banner, normal equal/exact behaviour.
  const hasQuotaConfig = categoryQuotas.length > 0 && !isEqualQuotaDistribution(categoryQuotas, allPersons)

  // ── Splits for a given expense ──
  const getSplitsForExpense = useCallback(
    (expenseId: string): ExpenseSplit[] =>
      expenseSplits.filter((s) => s.expense_id === expenseId),
    [expenseSplits],
  )

  // ── Form helpers ──
  const resetForm = useCallback(() => {
    setDescription('')
    setAmount('')
    setPaidBy(userName)
    setSplitPeople([])
    setSplitMode('equal')
    setExactShares({})
    setExpenseDate(new Date().toISOString().slice(0, 10))
    setExpenseNote('')
    setExpenseCategory('')
    setEditingId(null)
    setFormExpanded(false)
  }, [userName])

  const startAdd = useCallback(() => {
    navigator.vibrate?.(8)
    setEditingId(null)
    setDescription('')
    setAmount('')
    setPaidBy(userName)
    setSplitPeople(allPersons.slice())
    setSplitMode('equal')
    setExactShares({})
    setExpenseDate(new Date().toISOString().slice(0, 10))
    setExpenseNote('')
    setExpenseCategory('')
    setFormExpanded(true)
  }, [userName, allPersons])

  const startEdit = useCallback(
    (expense: Expense) => {
      const splits = getSplitsForExpense(expense.id)
      setEditingId(expense.id)
      setDescription(expense.description)
      setAmount(expense.amount.toString())
      setPaidBy(expense.paid_by)
      setSplitMode(expense.split_mode)
      setExpenseDate(expense.expense_date)
      setExpenseNote(expense.note ?? '')
      setExpenseCategory(expense.category ?? '')
      const people = splits.map((s) => s.person_name)
      setSplitPeople(people)
      const shares: Record<string, string> = {}
      if (expense.split_mode === 'exact') {
        for (const s of splits) {
          shares[s.person_name] = s.share_amount.toString()
        }
      }
      setExactShares(shares)
      setFormExpanded(true)
    },
    [getSplitsForExpense],
  )

  // ── Delete ──
  const handleDelete = (expense: Expense) => {
    confirm(`"${expense.description}" wirklich löschen?`, async () => {
      const { error: splitError } = await supabase.from('expense_splits').delete().eq('expense_id', expense.id)
      if (splitError) {
        toast(`Fehler beim Löschen der Aufteilung: ${splitError.message}`, 'error')
        return
      }
      const { error } = await supabase.from('expenses').delete().eq('id', expense.id)
      if (error) {
        toast(`Fehler beim Löschen: ${error.message}`, 'error')
        return
      }
      navigator.vibrate?.(10)
      onExpensesChange()
    })
  }

  const showQuotaTab = isAdmin && adminUnlocked

  return (
    <div className="expense-screen">
      {/* ── Sub-Toggle ── */}
      <div className="expense-toggle">
        <button
          className={`expense-toggle-btn ${section === 'expenses' ? 'active' : ''}`}
          onClick={() => { navigator.vibrate?.(8); setSection('expenses') }}
        >
          <Wallet size={16} strokeWidth={2} /> Ausgaben{expenses.length > 0 && <span className="expense-toggle-badge">{expenses.length}</span>}
        </button>
        <button
          className={`expense-toggle-btn ${section === 'settlement' ? 'active' : ''}`}
          onClick={() => { navigator.vibrate?.(8); setSection('settlement') }}
        >
          <Receipt size={16} strokeWidth={2} /> Abrechnung
        </button>
        <button
          className={`expense-toggle-btn ${section === 'matrix' ? 'active' : ''}`}
          onClick={() => { navigator.vibrate?.(8); setSection('matrix') }}
        >
          <Table2 size={16} strokeWidth={2} /> Matrix
        </button>
        {showQuotaTab && (
          <button
            className={`expense-toggle-btn ${section === 'quotas' ? 'active' : ''}`}
            onClick={() => { navigator.vibrate?.(8); setSection('quotas') }}
          >
            <Percent size={16} strokeWidth={2} /> Quoten
          </button>
        )}
      </div>

      {/* ── Ausgaben Section ── */}
      {section === 'expenses' && (
        <div key="expenses">
          <input type="text" className="expense-search-input" placeholder="🔍 Suchen…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          {!formExpanded ? (
            <button className="expense-add-trigger" onClick={startAdd}>
              + Ausgabe hinzufügen
            </button>
          ) : (
            <ExpenseForm
              listId={listId}
              userName={userName}
              allPersons={allPersons}
              expenseCategories={expenseCategories}
              editingId={editingId}
              description={description}
              amount={amount}
              paidBy={paidBy}
              splitPeople={splitPeople}
              splitMode={splitMode}
              exactShares={exactShares}
              expenseDate={expenseDate}
              expenseNote={expenseNote}
              expenseCategory={expenseCategory}
              formExpanded={formExpanded}
              hasQuotaConfig={hasQuotaConfig}
              categoryQuotas={categoryQuotas}
              setDescription={setDescription}
              setAmount={setAmount}
              setPaidBy={setPaidBy}
              setSplitPeople={setSplitPeople}
              setSplitMode={setSplitMode}
              setExactShares={setExactShares}
              setExpenseDate={setExpenseDate}
              setExpenseNote={setExpenseNote}
              setExpenseCategory={setExpenseCategory}
              getSplitsForExpense={getSplitsForExpense}
              onExpensesChange={onExpensesChange}
              onCategoriesChange={onCategoriesChange}
              resetForm={resetForm}
            />
          )}

          <ExpenseList
            expenses={expenses}
            expenseSplits={expenseSplits}
            expenseCategories={expenseCategories}
            searchQuery={searchQuery}
            isLoading={isLoading}
            formExpanded={formExpanded}
            onEdit={startEdit}
            onDelete={handleDelete}
          />
        </div>
      )}

      {/* ── Abrechnung Section ── */}
      {section === 'settlement' && (
        <ExpenseSettlement
          expenses={expenses}
          expenseSplits={expenseSplits}
          listId={listId}
          userName={userName}
          settlements={settlements}
          onSettlementsChange={onSettlementsChange}
          onExpensesChange={onExpensesChange}
        />
      )}

      {/* ── Matrix Section ── */}
      {section === 'matrix' && (
        <ExpenseMatrix expenses={expenses} expenseSplits={expenseSplits} settlements={settlements} />
      )}

      {/* ── Quoten Section (Admin only) ── */}
      {section === 'quotas' && showQuotaTab && (
        <ExpenseQuotaManager
          listId={listId}
          expenseCategories={expenseCategories}
          knownPersons={allPersons}
          expenseQuotas={expenseQuotas}
          onQuotasChange={onQuotasChange}
        />
      )}
    </div>
  )
}