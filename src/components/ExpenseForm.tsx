import { useState, useMemo, useCallback, useRef } from 'react'
import { Trash2, Plus, Pencil } from 'lucide-react'
import type { ExpenseSplit, ExpenseQuota, ItemCategory } from '../types'
import { expenseIcon } from '../lib/expenseIcons'
import { supabase } from '../lib/supabase'
import { logError } from '../lib/logger'
import { useToast } from '../context/ToastContext'
import { useCategories } from '../hooks/useCategories'
import { calculateShareAmounts, calculateQuotaShares, fmtEUR, roundCents } from '../lib/settlement'
import { publishActivity, markOwnAction } from '../lib/activityBus'
import { spanishPhrase } from '../lib/espanaFlair'

interface ExpenseFormProps {
  listId: string
  userName: string
  allPersons: string[]
  expenseCategories: ItemCategory[]
  editingId: string | null
  description: string
  amount: string
  paidBy: string
  splitPeople: string[]
  splitMode: 'equal' | 'exact'
  exactShares: Record<string, string>
  expenseDate: string
  expenseNote: string
  expenseCategory: string
  formExpanded: boolean
  hasQuotaConfig: boolean
  categoryQuotas: ExpenseQuota[]
  // Setters
  setDescription: (v: string) => void
  setAmount: (v: string) => void
  setPaidBy: (v: string) => void
  setSplitPeople: (v: string[] | ((prev: string[]) => string[])) => void
  setSplitMode: (v: 'equal' | 'exact') => void
  setExactShares: (v: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void
  setExpenseDate: (v: string) => void
  setExpenseNote: (v: string) => void
  setExpenseCategory: (v: string) => void
  // Data helpers
  getSplitsForExpense: (expenseId: string) => ExpenseSplit[]
  // Callbacks
  onExpensesChange: () => void
  onCategoriesChange: () => void
  resetForm: () => void
}

export default function ExpenseForm({
  listId,
  userName,
  allPersons,
  expenseCategories,
  editingId,
  description,
  amount,
  paidBy,
  splitPeople,
  splitMode,
  exactShares,
  expenseDate,
  expenseNote,
  expenseCategory,
  formExpanded,
  hasQuotaConfig,
  categoryQuotas,
  setDescription,
  setAmount,
  setPaidBy,
  setSplitPeople,
  setSplitMode,
  setExactShares,
  setExpenseDate,
  setExpenseNote,
  setExpenseCategory,
  getSplitsForExpense,
  onExpensesChange,
  onCategoriesChange,
  resetForm,
}: ExpenseFormProps) {
  const { toast, confirm } = useToast()
  const { updateCategory, deleteCategory, addCategory } = useCategories(onCategoriesChange)
  const [catEditorOpen, setCatEditorOpen] = useState(false)
  const [catLocalNames, setCatLocalNames] = useState<Record<string, string>>({})
  const [newCatName, setNewCatName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submittingRef = useRef(false)

  // Betrag auf Cent normalisieren, BEVOR er in Splits und DB geht: sonst steht
  // in `expenses.amount` z. B. 3.335, während die Splits auf 3.34 gerundet sind
  // und die Salden nicht mehr auf 0 summieren.
  const amountNum = roundCents(parseFloat(amount) || 0)

  // ── Exact shares sum ──
  const exactSum = useMemo(() => {
    return splitPeople.reduce((sum, p) => {
      const val = parseFloat(exactShares[p] ?? '0')
      return sum + (isNaN(val) ? 0 : val)
    }, 0)
  }, [splitPeople, exactShares])

  const exactSumOk =
    splitMode === 'equal' ||
    Math.abs(exactSum - amountNum) < 0.01

  // When quota config is active, the split is automatic — no manual validation needed
  const canSave =
    description.trim() !== '' &&
    amountNum > 0 &&
    (hasQuotaConfig || (splitPeople.length > 0 && exactSumOk))

  const togglePerson = (name: string) => {
    setSplitPeople((prev) =>
      prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name],
    )
  }

  // ── Preview for equal split ──
  const equalPreview = useMemo(() => {
    if (splitMode !== 'equal' || splitPeople.length === 0 || amountNum <= 0) return null
    const totalCents = Math.round(amountNum * 100)
    const perCents = Math.floor(totalCents / splitPeople.length)
    const remainder = totalCents - perCents * splitPeople.length
    if (remainder === 0) {
      return `${splitPeople.length} Personen à ${fmtEUR(perCents / 100)}`
    }
    const lower = perCents / 100
    const higher = (perCents + 1) / 100
    return `${splitPeople.length} Personen à ${fmtEUR(lower)}–${fmtEUR(higher)}`
  }, [splitMode, splitPeople, amountNum])

  // ── Preview for quota split ──
  const quotaPreview = useMemo(() => {
    if (!hasQuotaConfig || amountNum <= 0) return null
    const shares = calculateQuotaShares(categoryQuotas, allPersons, amountNum)
    if (shares.length === 0) return null
    return shares.map(s => `${s.person_name}: ${fmtEUR(s.share_amount)}`).join(', ')
  }, [hasQuotaConfig, categoryQuotas, allPersons, amountNum])

  const calculateShares = useCallback((): { person_name: string; share_amount: number }[] => {
    // If category has quota config, override everything
    if (hasQuotaConfig) {
      return calculateQuotaShares(categoryQuotas, allPersons, amountNum)
    }
    return calculateShareAmounts(splitMode, splitPeople, amountNum, exactShares)
  }, [hasQuotaConfig, categoryQuotas, allPersons, amountNum, splitMode, splitPeople, exactShares])

  // ── The effective split_mode to store in DB ──
  const effectiveSplitMode: 'equal' | 'exact' = hasQuotaConfig ? 'exact' : splitMode

  // ── Save (insert or update) ──
  const handleSave = async () => {
    if (submittingRef.current) return
    const desc = description.trim()
    if (!desc || amountNum <= 0) return
    if (!hasQuotaConfig && (splitPeople.length === 0 || !exactSumOk)) return

    const shares = calculateShares()

    // Keine gültige Aufteilung → nicht speichern. Vorher wurde die Ausgabe
    // trotzdem angelegt (nur ohne Splits) und belastete damit allein paid_by;
    // die Salden waren danach falsch und niemand konnte sehen, warum.
    if (shares.length === 0 || shares.every(s => s.share_amount <= 0)) {
      toast('Keine gültige Aufteilung — bitte mindestens eine Person mit Anteil > 0 % wählen.', 'error')
      return
    }

    submittingRef.current = true
    setIsSubmitting(true)
    try {

    if (editingId) {
      // Alte Werte vor dem Update merken, um bei Split-Fehlern zurückrollen zu können.
      const { data: oldExpense, error: oldErr } = await supabase
        .from('expenses')
        .select('*')
        .eq('id', editingId)
        .single()
      if (oldErr || !oldExpense) {
        toast(`Fehler beim Laden der Ausgabe: ${oldErr?.message ?? 'nicht gefunden'}`, 'error')
        return
      }
      const { error: updErr } = await supabase
        .from('expenses')
        .update({
          description: desc,
          amount: amountNum,
          paid_by: paidBy,
          split_mode: effectiveSplitMode,
          expense_date: expenseDate,
          note: expenseNote.trim() || null,
          category: expenseCategory || null,
        })
        .eq('id', editingId)
      if (updErr) {
        toast(`Fehler beim Speichern: ${updErr.message}`, 'error')
        return
      }
      const oldSplits = getSplitsForExpense(editingId)
      const oldMap = new Map(oldSplits.map(s => [s.person_name, s.share_amount]))
      const newMap = new Map(shares.map(s => [s.person_name, s.share_amount]))

      const toDelete = oldSplits.filter(s => !newMap.has(s.person_name))
      const toInsert = shares.filter(s => !oldMap.has(s.person_name))
      const toUpdate = shares.filter(s => oldMap.has(s.person_name) && oldMap.get(s.person_name) !== s.share_amount)

      const ops: PromiseLike<{ error: unknown }>[] = []
      if (toDelete.length > 0) {
        ops.push(
          supabase.from('expense_splits').delete().eq('expense_id', editingId).in('person_name', toDelete.map(s => s.person_name))
        )
      }
      if (toInsert.length > 0) {
        ops.push(
          supabase.from('expense_splits').insert(
            toInsert.map(s => ({ expense_id: editingId, person_name: s.person_name, share_amount: s.share_amount }))
          )
        )
      }
      for (const s of toUpdate) {
        ops.push(
          supabase.from('expense_splits').update({ share_amount: s.share_amount }).eq('expense_id', editingId).eq('person_name', s.person_name)
        )
      }

      if (ops.length > 0) {
        const results = await Promise.allSettled(ops)
        const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.error))
        if (failed.length > 0) {
          try {
            await supabase.from('expenses').update({
              description: oldExpense.description,
              amount: oldExpense.amount,
              paid_by: oldExpense.paid_by,
              split_mode: oldExpense.split_mode,
              expense_date: oldExpense.expense_date,
              note: oldExpense.note,
              category: oldExpense.category,
            }).eq('id', editingId)
            // Splits immer auf den alten Stand zurücksetzen: auch wenn es vorher
            // keine gab, dürfen zurückgebliebene neue Zeilen nicht stehen bleiben.
            await supabase.from('expense_splits').delete().eq('expense_id', editingId)
            if (oldSplits.length > 0) {
              await supabase.from('expense_splits').insert(
                oldSplits.map(s => ({ expense_id: editingId, person_name: s.person_name, share_amount: s.share_amount }))
              )
            }
            toast('Fehler beim Aktualisieren der Aufteilung — die Änderung wurde zurückgenommen.', 'error')
          } catch (err) {
            logError('Rollback nach Split-Fehler fehlgeschlagen:', err)
            toast('Fehler beim Aktualisieren der Aufteilung. Bitte erneut versuchen.', 'error')
          }
          return
        }
      }
    } else {
      const { data, error: insErr } = await supabase
        .from('expenses')
        .insert({
          list_id: listId,
          description: desc,
          amount: amountNum,
          paid_by: paidBy,
          split_mode: effectiveSplitMode,
          expense_date: expenseDate,
          note: expenseNote.trim() || null,
          category: expenseCategory || null,
          created_by: userName,
        })
        .select('id')
        .single()
      if (insErr) {
        toast(`Fehler beim Speichern: ${insErr.message}`, 'error')
        return
      }
      const expenseId = data.id
      if (shares.length > 0) {
        const { error: splitErr } = await supabase.from('expense_splits').insert(
          shares.map((s) => ({
            expense_id: expenseId,
            person_name: s.person_name,
            share_amount: s.share_amount,
          })),
        )
        if (splitErr) {
          toast(`Fehler beim Speichern der Aufteilung: ${splitErr.message}`, 'error')
          // Rollback: delete the orphaned expense to avoid inconsistent state
          await supabase.from('expenses').delete().eq('id', expenseId)
          return
        }
      }
    }
    if (!editingId) {
      // Aktivität: neue Ausgabe sofort lokal melden (zuverlässig auf eigenem Gerät), Echo unterdrücken
      markOwnAction(`expenses:${desc}`)
      publishActivity(`${spanishPhrase('add')} ${desc} als Ausgabe eingetragen`)
    }

    navigator.vibrate?.(10)
    resetForm()
    onExpensesChange()
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  if (!formExpanded) return null

  return (
    <div className="expense-form">
      <input
        className="expense-input"
        type="text"
        placeholder="Beschreibung (z.B. Supermarkt)"
        aria-label="Beschreibung"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        autoFocus
      />
      <div className="expense-form-row">
        <input
          className="expense-input"
          type="number"
          step="0.01"
          placeholder="Betrag (€)"
          aria-label="Betrag in Euro"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <select
          className="expense-select"
          value={paidBy}
          onChange={(e) => setPaidBy(e.target.value)}
        >
          {allPersons.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      <input
        className="expense-input"
        type="date"
        value={expenseDate}
        onChange={(e) => setExpenseDate(e.target.value)}
      />

      {/* Kategorie */}
      <div className="expense-category-row">
        {expenseCategories.map(cat => {
          const CatIcon = expenseIcon(cat.name)
          return (
            <button
              key={cat.id}
              className={`expense-cat-chip ${expenseCategory === cat.name ? 'active' : ''}`}
              onClick={() => setExpenseCategory(expenseCategory === cat.name ? '' : cat.name)}
              type="button"
              aria-pressed={expenseCategory === cat.name}
            >
              <CatIcon size={14} strokeWidth={1.9} /> {cat.name}
            </button>
          )
        })}
        <button
          className="expense-cat-chip expense-cat-edit-btn"
          onClick={() => setCatEditorOpen(v => !v)}
          type="button"
          aria-label="Kategorien bearbeiten"
        >
          <Pencil size={13} strokeWidth={1.9} />
        </button>
      </div>

      {/* Inline Category Editor */}
      {catEditorOpen && (
        <div className="expense-cat-editor">
          <div className="expense-cat-editor-list">
            {expenseCategories.map(cat => (
              <div key={cat.id} className="expense-cat-editor-row">
                <span className="expense-cat-editor-icon">{cat.icon}</span>
                <input
                  className="expense-cat-editor-input"
                  type="text"
                  value={catLocalNames[cat.id] ?? cat.name}
                  onChange={(e) => {
                    setCatLocalNames(prev => ({ ...prev, [cat.id]: e.target.value }))
                  }}
                  onBlur={() => {
                    const newName = catLocalNames[cat.id]?.trim()
                    if (newName && newName !== cat.name) {
                      updateCategory(cat.id, { name: newName })
                    }
                    setCatLocalNames(prev => { const n = { ...prev }; delete n[cat.id]; return n })
                  }}
                />
                <button
                  className="expense-cat-editor-del"
                  onClick={() => {
                    confirm(`Kategorie „${cat.name}“ wirklich löschen?`, async () => {
                      await deleteCategory(cat.id)
                      await supabase.from('expenses').update({ category: null }).eq('list_id', listId).eq('category', cat.name)
                      onExpensesChange()
                    })
                  }}
                >
                  <Trash2 size={14} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
          <div className="expense-cat-editor-add-row">
            <input
              className="expense-cat-editor-input"
              type="text"
              placeholder="Neue Kategorie…"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
            />
            <button
              className="expense-cat-editor-add-btn"
              onClick={() => {
                const name = newCatName.trim()
                if (!name) return
                const maxOrder = expenseCategories.reduce((m, c) => Math.max(m, c.sort_order), 0)
                addCategory(listId, 'expense', maxOrder + 1, {
                  name,
                  icon: '📦',
                  color: '#9b6dd9',
                  bg: '#e8dcf7',
                })
                setNewCatName('')
              }}
            >
              <Plus size={16} strokeWidth={2} />
            </button>
          </div>
        </div>
      )}

      <input
        className="expense-input"
        type="text"
        placeholder="Notiz (optional) — z.B. 'Für den Strandtag'"
        aria-label="Notiz zur Ausgabe"
        value={expenseNote}
        onChange={(e) => setExpenseNote(e.target.value)}
      />

      {/* Quota info banner — shown when category has quota config */}
      {hasQuotaConfig && (
        <div className="quota-form-banner">
          📊 Diese Kategorie hat feste Quoten — die Aufteilung erfolgt automatisch nach Prozenten.
        </div>
      )}

      {/* Split among chips — hidden when quota config is active */}
      {!hasQuotaConfig && (
        <div>
          <div className="expense-chips-label">Geteilt durch</div>
          <div className="expense-chips">
            {allPersons.map((p) => (
              <button
                key={p}
                className={`expense-chip ${splitPeople.includes(p) ? 'active' : ''}`}
                onClick={() => togglePerson(p)}
                type="button"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Split mode toggle — hidden when quota config is active */}
      {!hasQuotaConfig && (
        <div className="expense-mode-toggle">
          <button
            className={`expense-mode-btn ${splitMode === 'equal' ? 'active' : ''}`}
            onClick={() => setSplitMode('equal')}
            type="button"
          >
            Gleichmäßig
          </button>
          <button
            className={`expense-mode-btn ${splitMode === 'exact' ? 'active' : ''}`}
            onClick={() => setSplitMode('exact')}
            type="button"
          >
            Exakt
          </button>
        </div>
      )}

      {/* Exact split inputs — hidden when quota config is active */}
      {!hasQuotaConfig && splitMode === 'exact' && splitPeople.length > 0 && (
        <div className="expense-exact-splits">
          {splitPeople.map((p) => (
            <div key={p} className="expense-exact-row">
              <span className="expense-exact-name">{p}</span>
              <input
                className="expense-exact-input"
                type="number"
                step="0.01"
                placeholder="0,00"
                aria-label={`Anteil für ${p} in Euro`}
                value={exactShares[p] ?? ''}
                onChange={(e) =>
                  setExactShares((prev) => ({ ...prev, [p]: e.target.value }))
                }
              />
            </div>
          ))}
          <div className={`expense-exact-sum ${exactSumOk ? 'ok' : 'warn'}`}>
            <span>Summe: {fmtEUR(exactSum)}</span>
            <span>Betrag: {fmtEUR(amountNum)}</span>
          </div>
        </div>
      )}

      {/* Quota preview — shown when quota config is active */}
      {quotaPreview && (
        <div className="expense-form-preview">{quotaPreview}</div>
      )}

      {/* Equal preview — shown when no quota config */}
      {!hasQuotaConfig && equalPreview && (
        <div className="expense-form-preview">{equalPreview}</div>
      )}

      {/* Actions */}
      <div className="expense-form-actions">
        <button className="expense-btn-cancel" onClick={resetForm}>
          Abbrechen
        </button>
        <button
          className="expense-btn-save"
          onClick={handleSave}
          disabled={!canSave || isSubmitting}
        >
          {isSubmitting ? 'Speichere…' : editingId ? 'Aktualisieren' : 'Speichern'}
        </button>
      </div>
    </div>
  )
}