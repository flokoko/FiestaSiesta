import { useMemo, useState } from 'react'
import { ArrowRight, CheckCircle2, Trash2, X, BarChart3, Receipt } from 'lucide-react'
import type { Expense, ExpenseSplit, Settlement } from '../types'
import {
  computeBalances,
  computeOpenBalances,
  computeSettlementProposals,
  sortedBalanceEntries,
  fmtEUR,
  fmtDate,
  type SettlementTxn,
} from '../lib/settlement'
import ExpenseCharts from './ExpenseCharts'
import { supabase } from '../lib/supabase'
import { todayIso } from '../lib/date'
import { useToast } from '../context/ToastContext'

interface ExpenseSettlementProps {
  expenses: Expense[]
  expenseSplits: ExpenseSplit[]
  listId: string
  userName: string
  settlements: Settlement[]
  onSettlementsChange: () => void
  onExpensesChange: () => void
}

export default function ExpenseSettlement({
  expenses,
  expenseSplits,
  listId,
  userName,
  settlements,
  onSettlementsChange,
  onExpensesChange,
}: ExpenseSettlementProps) {
  const { toast, confirm } = useToast()

  // ── All hooks MUST be before any conditional return ──
  const [view, setView] = useState<'settlement' | 'charts'>('settlement')
  const originalBalances = useMemo(() => computeBalances(expenses, expenseSplits), [expenses, expenseSplits])

  // Convert persisted Settlement[] to SettlementTxn[] for computeOpenBalances
  const settledTxns: SettlementTxn[] = useMemo(
    () => settlements.map(s => ({ from: s.payer, to: s.payee, amount: s.amount })),
    [settlements],
  )

  // Open balances = original balances minus settled payments
  const openBalances = useMemo(
    () => computeOpenBalances(originalBalances, settledTxns),
    [originalBalances, settledTxns],
  )

  // Settlement proposals derived from ORIGINAL balances, then settled payments
  // subtracted per payer→payee pair — so settling one debt leaves the other
  // passengers' proposals unchanged (stable, no re-optimization reshuffle).
  const settlementProposals = useMemo(
    () => computeSettlementProposals(originalBalances, settledTxns),
    [originalBalances, settledTxns],
  )
  const sortedOpenBalances = useMemo(() => sortedBalanceEntries(openBalances), [openBalances])

  // ── Inline "begleichen" form state ──
  const [settlingIdx, setSettlingIdx] = useState<number | null>(null)
  const [settleAmount, setSettleAmount] = useState('')
  const [settleDate, setSettleDate] = useState(() => todayIso())
  const [isSubmitting, setIsSubmitting] = useState(false)

  // ── Delete state guard ──
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ── Handlers ──
  const handleStartSettle = (idx: number, proposedAmount: number) => {
    navigator.vibrate?.(8)
    setSettlingIdx(idx)
    setSettleAmount(proposedAmount.toFixed(2))
    setSettleDate(todayIso())
  }

  const handleCancelSettle = () => {
    setSettlingIdx(null)
    setSettleAmount('')
  }

  const handleConfirmSettle = async (txn: SettlementTxn) => {
    if (isSubmitting) return

    const amountNum = parseFloat(settleAmount.replace(',', '.'))
    if (isNaN(amountNum) || amountNum <= 0) {
      toast('Bitte einen gültigen Betrag eingeben.', 'error')
      return
    }

    // Round to cents
    const amountCents = Math.round(amountNum * 100) / 100

    // Validate: amount must not exceed the current open debt for this pair
    // The proposed amount from computeSettlement already represents the exact
    // open debt for this payer→payee pair.
    const maxDebt = Math.round(txn.amount * 100) / 100
    if (amountCents > maxDebt + 0.001) {
      toast(
        `Betrag darf nicht höher als die offene Schuld (${fmtEUR(maxDebt)}) sein.`,
        'error',
      )
      return
    }

    setIsSubmitting(true)
    try {
      const { error } = await supabase.from('settlements').insert({
        list_id: listId,
        payer: txn.from,
        payee: txn.to,
        amount: amountCents,
        settled_at: settleDate,
        created_by: userName,
      })
      if (error) {
        toast(`Fehler beim Speichern: ${error.message}`, 'error')
        return
      }
      navigator.vibrate?.(10)
      toast(`${txn.from} → ${txn.to}: ${fmtEUR(amountCents)} beglichen!`, 'success')
      setSettlingIdx(null)
      setSettleAmount('')
      onSettlementsChange()
      onExpensesChange()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteSettlement = (s: Settlement) => {
    if (deletingId) return
    confirm(
      `Zahlung „${s.payer} → ${s.payee}: ${fmtEUR(s.amount)}“ wirklich löschen?`,
      async () => {
        setDeletingId(s.id)
        try {
          const { error } = await supabase.from('settlements').delete().eq('id', s.id)
          if (error) {
            toast(`Fehler beim Löschen: ${error.message}`, 'error')
            return
          }
          navigator.vibrate?.(10)
          toast('Zahlung gelöscht.', 'info')
          onSettlementsChange()
          onExpensesChange()
        } finally {
          setDeletingId(null)
        }
      },
    )
  }

  return (
    <div key="settlement">
      {/* Die Gesamtsumme steht schon im Hero — hier nur noch die Sicht-Auswahl. */}
      <div className="expense-toggle expense-settlement-toggle xp-seg">
        <button
          className={`expense-toggle-btn ${view === 'settlement' ? 'active' : ''}`}
          onClick={() => { navigator.vibrate?.(8); setView('settlement') }}
        >
          <Receipt size={15} strokeWidth={2} /> Salden
        </button>
        <button
          className={`expense-toggle-btn ${view === 'charts' ? 'active' : ''}`}
          onClick={() => { navigator.vibrate?.(8); setView('charts') }}
        >
          <BarChart3 size={15} strokeWidth={2} /> Charts
        </button>
      </div>

      {view === 'charts' ? (
        <ExpenseCharts expenses={expenses} />
      ) : expenses.length === 0 ? (
        <p className="expense-empty">Noch keine Ausgaben zur Abrechnung.</p>
      ) : (
        <>
          {/* ── Open Balances ── */}
          <div className="xp-rows xp-salden">
            {sortedOpenBalances.map(({ name, balance }) => {
              const cls = balance > 0.01 ? 'is-plus' : balance < -0.01 ? 'is-minus' : ''
              return (
                <div key={name} className={`xp-row xp-saldo ${cls}`}>
                  <span className="xp-row-icon xp-saldo-icon" aria-hidden="true">
                    {name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="xp-row-main">
                    <span className="xp-row-title">{name}</span>
                    <span className="xp-row-meta">
                      {balance > 0.01
                        ? 'bekommt zurück'
                        : balance < -0.01
                          ? 'schuldet noch'
                          : 'ausgeglichen'}
                    </span>
                  </span>
                  <span className="xp-row-right">
                    <span className="xp-row-amount">
                      {balance > 0.01
                        ? `+${fmtEUR(balance)}`
                        : balance < -0.01
                          ? `-${fmtEUR(-balance)}`
                          : '0,00 €'}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>

          {/* ── Open Settlement Transactions ── */}
          <h3 className="expense-settlement-title">
            <ArrowRight size={16} strokeWidth={2} /> Ausgleichszahlungen
          </h3>
          {settlementProposals.length === 0 ? (
            <p className="expense-settlement-empty">
              Alle ausgeglichen — nichts zu überweisen!
            </p>
          ) : (
            <div className="expense-settlement-list">
              {settlementProposals.map((txn, i) => (
                <div key={i} className="expense-txn xp-txn">
                  <span className="xp-txn-text">
                    <strong>{txn.from}</strong> zahlt <strong>{txn.to}</strong>
                  </span>
                  <span className="expense-txn-amount">{fmtEUR(txn.amount)}</span>
                  {settlingIdx === i ? (
                    <div className="expense-settle-inline">
                      <input
                        type="number"
                        className="expense-settle-input"
                        value={settleAmount}
                        onChange={e => setSettleAmount(e.target.value)}
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        placeholder="Betrag"
                      />
                      <input
                        type="date"
                        className="expense-settle-date"
                        value={settleDate}
                        onChange={e => setSettleDate(e.target.value)}
                      />
                      <button
                        className="expense-settle-save"
                        disabled={isSubmitting}
                        onClick={() => handleConfirmSettle(txn)}
                      >
                        <CheckCircle2 size={16} strokeWidth={2} />
                      </button>
                      <button
                        className="expense-settle-cancel"
                        onClick={handleCancelSettle}
                        disabled={isSubmitting}
                      >
                        <X size={16} strokeWidth={2} />
                      </button>
                    </div>
                  ) : (
                    <button
                      className="expense-settle-btn xp-settle-btn"
                      onClick={() => handleStartSettle(i, txn.amount)}
                      aria-label={`${txn.from} an ${txn.to} als beglichen markieren`}
                    >
                      Begleichen
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Already Settled Section ── */}
          {settlements.length > 0 && (
            <>
              <h3 className="expense-settled-title">
                <CheckCircle2 size={16} strokeWidth={2} /> Bereits beglichen
              </h3>
              <div className="expense-settlement-list">
                {settlements.map(s => (
                  <div key={s.id} className="expense-txn expense-txn-settled xp-txn">
                    <span className="xp-txn-text">
                      <strong>{s.payer}</strong> an <strong>{s.payee}</strong>
                      <span className="xp-txn-date">{fmtDate(s.settled_at)}</span>
                    </span>
                    <span className="expense-txn-amount">{fmtEUR(s.amount)}</span>
                    <button
                      className="expense-settle-delete"
                      onClick={() => handleDeleteSettlement(s)}
                      disabled={deletingId === s.id}
                      aria-label="Zahlung löschen"
                    >
                      <Trash2 size={14} strokeWidth={2} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}