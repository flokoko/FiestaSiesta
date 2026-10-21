import { useState, useEffect } from 'react'
import type { ItemCategory, ListType } from '../types'
import { supabase } from '../lib/supabase'
import { logError } from '../lib/logger'
import { useToast } from '../context/ToastContext'
import { publishActivity, markOwnAction } from '../lib/activityBus'
import { spanishPhrase } from '../lib/espanaFlair'
import './AddItemForm.css'

interface AddItemFormProps {
  listId: string
  userName: string
  onAdded?: () => void
  defaultAssignedTo?: string
  placeholder?: string
  categories: ItemCategory[]
  listType: ListType
  persons?: string[]
}

export default function AddItemForm({
  listId,
  userName,
  onAdded,
  defaultAssignedTo,
  placeholder,
  categories,
  listType,
  persons,
}: AddItemFormProps) {
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [category, setCategory] = useState<string>(categories[0]?.name ?? '')
  const [assignedTo, setAssignedTo] = useState(defaultAssignedTo ?? '')
  const [expanded, setExpanded] = useState(false)

  // Update category when categories load async from Supabase
  useEffect(() => {
    if (!category && categories.length > 0) {
      setCategory(categories[0].name)
    }
  }, [categories, category])

  const handleAdd = async () => {
    const n = name.trim()
    if (!n) return
    const { error } = await supabase.from('items').insert({
      list_id: listId,
      name: n,
      quantity: quantity.trim() || '1',
      category,
      assigned_to: listType === 'bring' ? (assignedTo.trim() || null) : null,
      is_checked: false,
      is_brought: false,
      created_by: userName,
      list_type: listType,
    })
    if (error) {
      logError('Insert failed:', error)
      toast(`Fehler beim Speichern: ${error.message}`, 'error')
      return
    }
    setName('')
    setQuantity('')
    setAssignedTo(defaultAssignedTo ?? '')
    setCategory(categories[0]?.name ?? '')
    setExpanded(false)
    // Aktivität: sofort lokal melden (zuverlässig auf eigenem Gerät), Echo unterdrücken
    markOwnAction(`items:${n}`)
    const target = listType === 'bring' ? 'Mitbringen' : 'Einkaufsliste'
    publishActivity(`${spanishPhrase('add')} ${n} zur ${target} hinzugefügt`)
    onAdded?.()
  }

  return (
    <div className="add-item-form">
      {expanded ? (
        <div className="add-item-expanded">
          <input
            className="add-input"
            type="text"
            placeholder={placeholder ?? "Was soll gekauft werden?"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            maxLength={100}
            autoFocus
          />
          <div className="add-row">
            <input
              className="add-input add-qty"
              type="text"
              placeholder="Menge"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              maxLength={100}
            />
            <select
              className="add-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {categories.length === 0 ? (
                <option disabled>Keine Kategorien</option>
              ) : (
                categories.map((cat) => (
                  <option key={cat.id} value={cat.name}>
                    {cat.name}
                  </option>
                ))
              )}
            </select>
          </div>
          {listType === 'bring' && (
            persons && persons.length > 0 ? (
              <select
                className="add-select"
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
              >
                <option value="">— Niemand —</option>
                {persons.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            ) : (
              <input
                className="add-input"
                type="text"
                placeholder="Zuweisen an (optional)"
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                maxLength={100}
              />
            )
          )}
          <div className="add-actions">
            <button className="add-btn-cancel" onClick={() => setExpanded(false)}>
              Abbrechen
            </button>
            <button className="add-btn-confirm" onClick={handleAdd} disabled={!name.trim()}>
              Hinzufügen
            </button>
          </div>
        </div>
      ) : (
        <button className="add-item-trigger" onClick={() => setExpanded(true)}>
          <span className="add-plus">+</span> Item hinzufügen
        </button>
      )}
    </div>
  )
}