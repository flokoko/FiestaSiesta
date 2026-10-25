import { useState, useMemo, useCallback, useRef } from 'react'
import { Wallet, Receipt, Table2, Percent, MoreHorizontal, Search, X, ArrowRight } from 'lucide-react'
import type { Expense, ExpenseSplit, ExpenseQuota, ItemCategory, Settlement } from '../types'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import {
  isEqualQuotaDistribution, computeBalances, computeOpenBalances,
  computeSettlement, totalExpenses, fmtEUR,
} from '../lib/settlement'
import ExpenseForm from './ExpenseForm'
import ExpenseList from './ExpenseList'
import ExpenseSettlement from './ExpenseSettlement'
import ExpenseMatrix from './ExpenseMatrix'
import ExpenseQuotaManager from './ExpenseQuotaManager'
import { useSheetFocus } from '../hooks/useSheetFocus'
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const menuRef = useRef<HTMLDivElement | null>(null)
  useSheetFocus(menuRef, menuOpen, () => setMenuOpen(false))

  // ── Saldo-Logik: erst was offen ist, dann die Details ──
  const balances = useMemo(() => computeBalances(expenses, expenseSplits), [expenses, expenseSplits])
  const openBalances = useMemo(
    () => computeOpenBalances(
      balances,
      settlements.map(s => ({ from: s.payer, to: s.payee, amount: s.amount })),
    ),
    [balances, settlements],
  )
  const proposals = useMemo(() => computeSettlement(openBalances), [openBalances])
  const totalSpent = useMemo(() => totalExpenses(expenses), [expenses])
  const myBalance = Math.round((openBalances[userName] ?? 0) * 100) / 100

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
      // Erst die Ausgabe selbst löschen — schlägt das fehl, bleibt der alte
      // Stand konsistent. (Die DB cascade't die Splits über ON DELETE CASCADE
      // mit; der Split-Delete danach ist Best-Effort für Schemas ohne Cascade.)
      const { error } = await supabase.from('expenses').delete().eq('id', expense.id)
      if (error) {
        toast(`Fehler beim Löschen: ${error.message}`, 'error')
        onExpensesChange()
        return
      }
      const { error: splitError } = await supabase.from('expense_splits').delete().eq('expense_id', expense.id)
      if (splitError) {
        toast(`Fehler beim Löschen der Aufteilung: ${splitError.message}`, 'error')
        // Ausgabe ist weg, Splits evtl. nicht → Refetch statt inkonsistenter UI
        onExpensesChange()
        return
      }
      navigator.vibrate?.(10)
      onExpensesChange()
    })
  }

  const showQuotaTab = isAdmin && adminUnlocked

  return (
    <div className="expense-screen">
      {/* ── Kopf: was steht unterm Strich ── */}
      <header className="money-head">
        <div className="money-head-text">
          <h1>Geld</h1>
          <p>{expenses.length === 0 ? 'Noch keine Ausgabe' : `${expenses.length} Ausgaben · ${allPersons.length} Personen`}</p>
        </div>
        <button
          type="button"
          className="list-menu-btn"
          onClick={() => setMenuOpen(true)}
          aria-label="Optionen"
        >
          <MoreHorizontal size={20} strokeWidth={2.2} />
        </button>
      </header>

      <section className="money-hero">
        <div className="money-hero-glow" aria-hidden="true" />
        <div className="money-hero-label">Zusammen ausgegeben</div>
        <div className="money-hero-total">{fmtEUR(totalSpent)}</div>
        <div className={`money-hero-balance${myBalance < -0.005 ? ' is-negative' : ''}`}>
          {expenses.length === 0
            ? 'Trag die erste Ausgabe ein'
            : myBalance > 0.005
              ? `Dir stehen ${fmtEUR(myBalance)} zu`
              : myBalance < -0.005
                ? `Du schuldest ${fmtEUR(Math.abs(myBalance))}`
                : 'Du bist ausgeglichen'}
        </div>
      </section>

      {allPersons.length > 0 && expenses.length > 0 && (
        <div className="xp-balances">
          {[...allPersons]
            .sort((a, b) => (a === userName ? -1 : b === userName ? 1 : a.localeCompare(b)))
            .map((person) => {
            const value = Math.round((openBalances[person] ?? 0) * 100) / 100
            const positive = value > 0.005
            const negative = value < -0.005
            return (
              <div
                key={person}
                className={`xp-bal${positive ? ' is-plus' : ''}${negative ? ' is-minus' : ''}`}
              >
                <span className="xp-bal-avatar" aria-hidden="true">
                  {person.slice(0, 2).toUpperCase()}
                </span>
                <span className="xp-bal-body">
                  <span className="xp-bal-name">{person === userName ? 'Du' : person.split(' ')[0]}</span>
                  <span className="xp-bal-value">
                    {positive ? '+' : ''}
                    {fmtEUR(value)}
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      )}

      <section className="money-debts">
        <div className="money-debts-head">
          <h2>Offen zwischen euch</h2>
          {proposals.length > 0 && (
            <button
              type="button"
              className="today-link"
              onClick={() => setSection('settlement')}
            >
              Abrechnen <ArrowRight size={13} strokeWidth={2.4} />
            </button>
          )}
        </div>
        {proposals.length === 0 ? (
          <p className="money-debts-empty">
            {expenses.length === 0 ? 'Noch nichts zu verteilen.' : 'Alles ausgeglichen'}
          </p>
        ) : (
          <div className="money-debts-list">
            {proposals.slice(0, 3).map((txn, i) => (
              <div key={`${txn.from}-${txn.to}-${i}`} className="money-debt-row xp-debt-row">
                <span className="xp-bal-avatar is-sm" aria-hidden="true">
                  {txn.from.slice(0, 2).toUpperCase()}
                </span>
                <span className="money-debt-from">
                  {txn.from === userName ? 'Du' : txn.from.split(' ')[0]}
                </span>
                <span className="money-debt-verb">
                  {txn.from === userName ? 'schuldest' : 'schuldet'}
                </span>
                <span className="money-debt-to">
                  {txn.to === userName ? 'dir' : txn.to.split(' ')[0]}
                </span>
                <span className="money-debt-amount">{fmtEUR(txn.amount)}</span>
              </div>
            ))}
            {proposals.length > 3 && (
              <button
                type="button"
                className="money-debt-more"
                onClick={() => setSection('settlement')}
              >
                +{proposals.length - 3} weitere
              </button>
            )}
          </div>
        )}
      </section>

      <div className="money-toggle" role="tablist" aria-label="Bereich">
        <button
          type="button"
          role="tab"
          aria-selected={section === 'expenses'}
          className={`money-toggle-btn${section === 'expenses' ? ' active' : ''}`}
          onClick={() => { navigator.vibrate?.(8); setSection('expenses') }}
        >
          <Wallet size={15} strokeWidth={2} /> Ausgaben
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === 'settlement'}
          className={`money-toggle-btn${section === 'settlement' ? ' active' : ''}`}
          onClick={() => { navigator.vibrate?.(8); setSection('settlement') }}
        >
          <Receipt size={15} strokeWidth={2} /> Abrechnung
        </button>
        {(section === 'matrix' || section === 'quotas') && (
          <button type="button" role="tab" aria-selected={true} className="money-toggle-btn active" onClick={() => setSection('expenses')}>
            {section === 'matrix' ? <Table2 size={15} strokeWidth={2} /> : <Percent size={15} strokeWidth={2} />}
            {section === 'matrix' ? 'Matrix' : 'Quoten'}
          </button>
        )}
      </div>

      {searchOpen && section === 'expenses' && (
        <div className="list-search-row">
          <Search size={15} strokeWidth={2} />
          <input
            type="text"
            className="expense-search-input"
            placeholder="Ausgabe suchen…"
            aria-label="Ausgaben suchen"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            autoFocus
          />
          <button type="button" onClick={() => { setSearchQuery(''); setSearchOpen(false) }} aria-label="Suche schließen">
            <X size={15} strokeWidth={2} />
          </button>
        </div>
      )}

      {/* ── Ausgaben Section ── */}
      {section === 'expenses' && (
        <div key="expenses">
          {formExpanded && (
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
            userName={userName}
            isLoading={isLoading}
            formExpanded={formExpanded}
            onEdit={startEdit}
            onDelete={handleDelete}
          />

          {!formExpanded && (
            <div className="money-addbar">
              <button type="button" className="money-add-btn" onClick={startAdd}>
                + Ausgabe hinzufügen
              </button>
            </div>
          )}
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

      {menuOpen && (
        <div className="list-menu-scrim" role="presentation" onClick={() => setMenuOpen(false)}>
          <div
            ref={menuRef}
            className="list-menu-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Geld-Optionen"
            onClick={e => e.stopPropagation()}
          >
            <div className="more-grab" aria-hidden="true" />
            <button
              type="button"
              className="list-menu-item"
              onClick={() => { setSection('expenses'); setSearchOpen(true); setMenuOpen(false) }}
            >
              <Search size={17} strokeWidth={2} />
              <span>Ausgaben suchen</span>
            </button>
            <button
              type="button"
              className="list-menu-item"
              onClick={() => { setSection('matrix'); setMenuOpen(false) }}
            >
              <Table2 size={17} strokeWidth={2} />
              <span>Matrix aller Schulden</span>
            </button>
            {showQuotaTab && (
              <button
                type="button"
                className="list-menu-item"
                onClick={() => { setSection('quotas'); setMenuOpen(false) }}
              >
                <Percent size={17} strokeWidth={2} />
                <span>Quoten je Kategorie</span>
              </button>
            )}
            <button
              type="button"
              className="list-menu-item"
              onClick={() => { setSection('settlement'); setMenuOpen(false) }}
            >
              <Receipt size={17} strokeWidth={2} />
              <span>Abrechnung &amp; Verlauf</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}