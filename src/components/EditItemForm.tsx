import { useState } from 'react'
import type { ListItem, ItemCategory } from '../types'
import { supabase } from '../lib/supabase'
import { logError } from '../lib/logger'
import { spanishSuccess } from '../lib/espanaFlair'
import { useToast } from '../context/ToastContext'
import './AddItemForm.css'

interface EditItemFormProps {
  item: ListItem
  categories: ItemCategory[]
  listId: string
  onSaved: () => void
  onCancel: () => void
}

export default function EditItemForm({ item, categories, onSaved, onCancel }: EditItemFormProps) {
  const { toast } = useToast()
  const [name, setName] = useState(item.name)
  const [quantity, setQuantity] = useState(item.quantity)
  const [category, setCategory] = useState(item.category)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    const n = name.trim()
    if (!n) return
    setSaving(true)
    const { error } = await supabase
      .from('items')
      .update({ name: n, quantity: quantity.trim() || '1', category })
      .eq('id', item.id)
    setSaving(false)
    if (error) {
      logError('Edit failed:', error)
      toast(`Fehler beim Speichern: ${error.message}`, 'error')
      return
    }
    toast(`${spanishSuccess()} Item aktualisiert`, 'success')
    onSaved()
  }

  return (
    <div className="edit-item-overlay" onClick={onCancel}>
      <div className="edit-item-card" onClick={(e) => e.stopPropagation()}>
        <div className="add-item-expanded">
          <input
            className="add-input"
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
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
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
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
          <div className="add-actions">
            <button className="add-btn-cancel" onClick={onCancel} disabled={saving}>
              Abbrechen
            </button>
            <button className="add-btn-confirm" onClick={handleSave} disabled={!name.trim() || saving}>
              Speichern
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}