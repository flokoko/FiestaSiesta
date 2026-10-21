import { useState, useMemo, useCallback } from 'react'
import type { ExpenseQuota, ItemCategory } from '../types'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'

interface ExpenseQuotaManagerProps {
  listId: string
  expenseCategories: ItemCategory[]
  knownPersons: string[]
  expenseQuotas: ExpenseQuota[]
  onQuotasChange: () => void
}

export default function ExpenseQuotaManager({
  listId,
  expenseCategories,
  knownPersons,
  expenseQuotas,
  onQuotasChange,
}: ExpenseQuotaManagerProps) {
  const { toast, confirm } = useToast()
  const [editingCategory, setEditingCategory] = useState<string | null>(null)

  // ── Build a map: category -> { personName -> percent } ──
  const quotaMap = useMemo(() => {
    const map: Record<string, Record<string, number>> = {}
    for (const q of expenseQuotas) {
      if (!map[q.category]) map[q.category] = {}
      map[q.category][q.person_name] = q.percent
    }
    return map
  }, [expenseQuotas])

  // ── Local draft state for the category being edited ──
  const [draft, setDraft] = useState<Record<string, string>>({})

  // ── Start editing a category: load existing quotas into draft ──
  const startEdit = useCallback((category: string) => {
    const existing = quotaMap[category] ?? {}
    const hasExisting = Object.keys(existing).length > 0
    const newDraft: Record<string, string> = {}
    if (hasExisting) {
      // Load existing quotas as-is
      for (const person of knownPersons) {
        newDraft[person] = String(existing[person] ?? 0)
      }
    } else if (knownPersons.length > 0) {
      // No config yet → evenly distribute 100% across all persons,
      // rounding to two decimals and putting the remainder on the first persons
      const totalHundredths = 10000 // 100.00% in hundredths of a percent
      const base = Math.floor(totalHundredths / knownPersons.length)
      const remainder = totalHundredths - base * knownPersons.length
      knownPersons.forEach((person, i) => {
        newDraft[person] = String((base + (i < remainder ? 1 : 0)) / 100)
      })
    }
    setDraft(newDraft)
    setEditingCategory(category)
  }, [quotaMap, knownPersons])

  // ── Draft sum for the current category ──
  const draftSum = useMemo(() => {
    if (!editingCategory) return 0
    return knownPersons.reduce((sum, p) => {
      const val = parseFloat(draft[p] ?? '0')
      return sum + (isNaN(val) ? 0 : val)
    }, 0)
  }, [editingCategory, draft, knownPersons])

  const sumOk = Math.abs(draftSum - 100) < 0.005

  // ── Save quotas for the current category ──
  const handleSave = useCallback(async () => {
    if (!editingCategory || !sumOk) return

    // Build upsert rows
    const rows = knownPersons.map(person => ({
      list_id: listId,
      category: editingCategory,
      person_name: person,
      percent: parseFloat(draft[person] ?? '0') || 0,
    }))

    // Delete existing quotas for this list+category, then insert
    const { error: delError } = await supabase
      .from('expense_quotas')
      .delete()
      .eq('list_id', listId)
      .eq('category', editingCategory)

    if (delError) {
      toast(`Fehler beim Aktualisieren: ${delError.message}`, 'error')
      return
    }

    // Only insert rows where percent > 0 OR the person had a previous quota
    // (We keep all persons so 0% is explicitly stored)
    const { error: insError } = await supabase
      .from('expense_quotas')
      .insert(rows)

    if (insError) {
      toast(`Fehler beim Speichern: ${insError.message}`, 'error')
      return
    }

    navigator.vibrate?.(10)
    toast('Quoten gespeichert', 'success')
    setEditingCategory(null)
    setDraft({})
    onQuotasChange()
  }, [editingCategory, sumOk, knownPersons, draft, listId, toast, onQuotasChange])

  const handleCancel = useCallback(() => {
    setEditingCategory(null)
    setDraft({})
  }, [])

  // ── Check if a category has a quota config ──
  const hasConfig = useCallback((category: string) => {
    return (quotaMap[category] && Object.keys(quotaMap[category]).length > 0) ?? false
  }, [quotaMap])

  // ── Evenly re-distribute one category's quotas across all persons ──
  const handleRedistribute = useCallback(async (category: string) => {
    if (knownPersons.length === 0) return
    confirm(
      `Quoten für "${category}" gleichmäßig auf ${knownPersons.length} ${knownPersons.length === 1 ? 'Person' : 'Personen'} neu verteilen?`,
      async () => {
        const totalHundredths = 10000 // 100.00% in hundredths of a percent
        const base = Math.floor(totalHundredths / knownPersons.length)
        const remainder = totalHundredths - base * knownPersons.length
        const rows = knownPersons.map((person, i) => ({
          list_id: listId,
          category,
          person_name: person,
          percent: (base + (i < remainder ? 1 : 0)) / 100,
        }))

        const { error: delError } = await supabase
          .from('expense_quotas')
          .delete()
          .eq('list_id', listId)
          .eq('category', category)
        if (delError) {
          toast(`Fehler beim Neuverteilen: ${delError.message}`, 'error')
          return
        }

        const { error: insError } = await supabase.from('expense_quotas').insert(rows)
        if (insError) {
          toast(`Fehler beim Speichern: ${insError.message}`, 'error')
          return
        }

        navigator.vibrate?.(10)
        toast('Quoten gleichmäßig verteilt', 'success')
        if (editingCategory === category) {
          setEditingCategory(null)
          setDraft({})
        }
        onQuotasChange()
      }
    )
  }, [knownPersons, listId, confirm, toast, editingCategory, onQuotasChange])

  if (expenseCategories.length === 0) {
    return (
      <div className="expense-empty">
        <span>Keine Ausgaben-Kategorien vorhanden.</span>
        <span style={{ fontSize: '0.78rem' }}>Erstelle zuerst Kategorien im Ausgaben-Tab.</span>
      </div>
    )
  }

  return (
    <div className="quota-manager">
      <div className="quota-info-banner">
        Konfiguriere feste Prozent-Quoten pro Kategorie. Ausgaben in einer Kategorie mit Quoten werden automatisch nach diesen Prozentsätzen aufgeteilt — die manuelle Auswahl wird überschrieben.
      </div>

      {expenseCategories.map(cat => {
        const isEditing = editingCategory === cat.name
        const configured = hasConfig(cat.name)
        const existing = quotaMap[cat.name] ?? {}

        return (
          <div key={cat.id} className="quota-category-card">
            <div className="quota-category-header">
              <span className="quota-category-title">
                {cat.icon} {cat.name}
                {configured && <span className="quota-badge-active">Aktiv</span>}
              </span>
              <div className="quota-category-actions">
                {!isEditing ? (
                  <button
                    className="quota-edit-btn"
                    onClick={() => startEdit(cat.name)}
                    type="button"
                  >
                    {configured ? 'Bearbeiten' : 'Festlegen'}
                  </button>
                ) : null}
                <button
                  className="quota-redistribute-btn"
                  onClick={() => handleRedistribute(cat.name)}
                  type="button"
                >
                  ⚖️ Gleichmäßig
                </button>
              </div>
            </div>
            {isEditing && (
              <div className="quota-edit-section">
                <div className="quota-person-list">
                  {knownPersons.map(person => (
                    <div key={person} className="quota-person-row">
                      <span className="quota-person-name">{person}</span>
                      <div className="quota-person-input-wrap">
                        <input
                          className="quota-percent-input"
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={draft[person] ?? '0'}
                          onChange={(e) => {
                            setDraft(prev => ({ ...prev, [person]: e.target.value }))
                          }}
                        />
                        <span className="quota-percent-sign">%</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className={`quota-sum-row ${sumOk ? 'ok' : 'warn'}`}>
                  <span>Summe: {draftSum.toFixed(2)}%</span>
                  <span>
                    {sumOk
                      ? '✓ Bereit zum Speichern'
                      : `Muss 100% ergeben (noch ${(100 - draftSum).toFixed(2)}%)`}
                  </span>
                </div>

                <div className="quota-actions">
                  <button className="expense-btn-cancel" onClick={handleCancel} type="button">
                    Abbrechen
                  </button>
                  <button
                    className="expense-btn-save"
                    onClick={handleSave}
                    disabled={!sumOk}
                    type="button"
                  >
                    Speichern
                  </button>
                </div>
              </div>
            )}

            {!isEditing && configured && (
              <div className="quota-summary">
                {knownPersons
                  .filter(p => (existing[p] ?? 0) > 0)
                  .map(p => (
                    <span key={p} className="quota-summary-chip">
                      {p}: {existing[p].toFixed(2)}%
                    </span>
                  ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}