import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChefHat, Clock, Loader2, Plus, Trash2, Users, ShoppingBasket, Check, X,
} from 'lucide-react'
import { readCache, writeCache } from '../lib/readCache'
import { supabase } from '../lib/supabase'
import {
  formatIngredient, parseIngredients, parseSteps, recipeMeta, unitLabel,
} from '../lib/recipes'
import type { Recipe, RecipeIngredient } from '../types'
import './RecipesScreen.css'

interface Props {
  listId: string
  userName: string
}

export default function RecipesScreen({ listId, userName }: Props) {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  // Ohne Empfang in den Bergen: Rezepte sollen trotzdem lesbar sein.
  const [offline, setOffline] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    // Erst der letzte Stand aus dem Gerät — so steht die Küche sofort, auch offline.
    const cached = readCache<Recipe[]>(listId, 'recipes')
    if (cached && cached.length > 0) {
      setRecipes((current) => (current.length > 0 ? current : cached))
      setLoading(false)
    }

    const { data, error } = await supabase
      .from('recipes')
      .select('*')
      .eq('list_id', listId)
      .order('created_at', { ascending: true })

    if (error || !data) {
      setOffline(true)
      setLoading(false)
      return
    }
    setOffline(false)
    setRecipes(data as Recipe[])
    writeCache<Recipe[]>(listId, 'recipes', data as Recipe[])
    setLoading(false)
  }, [listId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  /** Zutaten, die noch nicht auf der Einkaufsliste stehen, in einem Rutsch anlegen. */
  const addToShopping = async (recipe: Recipe) => {
    if (busy) return
    setBusy(true)
    try {
      const { data: existing } = await supabase
        .from('items')
        .select('name')
        .eq('list_id', listId)
        .eq('list_type', 'shopping')
      const known = new Set(((existing ?? []) as Array<{ name: string }>).map((row) => row.name.toLowerCase()))

      const missing = recipe.ingredients.filter(
        (ingredient) => !known.has(ingredient.name.toLowerCase()),
      )
      if (missing.length === 0) {
        setToast('Steht alles schon auf der Liste')
        return
      }

      const { error } = await supabase.from('items').insert(
        missing.map((ingredient, index) => ({
          list_id: listId,
          name: ingredient.name,
          category: ingredient.category,
          quantity: [ingredient.qty, unitLabel(ingredient.unit)].filter(Boolean).join(' '),
          list_type: 'shopping',
          created_by: userName,
          sort_order: index,
          is_checked: false,
          is_brought: false,
        })),
      )
      if (error) {
        setToast('Konnte nicht speichern — Netz?')
        return
      }
      const skipped = recipe.ingredients.length - missing.length
      setToast(
        missing.length === 1
          ? '1 Zutat auf die Einkaufsliste'
          : `${missing.length} Zutaten auf die Einkaufsliste${skipped > 0 ? ` · ${skipped} stand schon da` : ''}`,
      )
    } finally {
      setBusy(false)
    }
  }

  const remove = async (recipe: Recipe) => {
    setBusy(true)
    const { error } = await supabase.from('recipes').delete().eq('id', recipe.id)
    setBusy(false)
    if (error) {
      setToast('Löschen fehlgeschlagen')
      return
    }
    setRecipes((current) => {
      const next = current.filter((entry) => entry.id !== recipe.id)
      writeCache<Recipe[]>(listId, 'recipes', next)
      return next
    })
    setOpen(null)
    setToast('Rezept gelöscht')
  }

  const current = recipes.find((recipe) => recipe.id === open) ?? null
  const detailRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    const node = detailRef.current
    if (!node) return
    window.requestAnimationFrame(() => {
      node.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [open])

  return (
    <div className="rc-screen list-screen">
      <header className="list-head">
        <div className="list-head-text">
          <h1>Küche</h1>
          <p>
            {loading
              ? 'lädt'
              : `${recipes.length === 1 ? '1 Rezept' : `${recipes.length} Rezepte`}${offline ? ' · offline' : ''}`}
          </p>
        </div>
        <button
          type="button"
          className="rc-add"
          onClick={() => { setAdding(true); setOpen(null) }}
          aria-label="Rezept hinzufügen"
        >
          <Plus size={18} strokeWidth={2.2} />
        </button>
      </header>

      {!loading && recipes.length === 0 && !adding && (
        <div className="rc-empty">
          <ChefHat size={22} strokeWidth={1.8} />
          <strong>Nichts zum Kochen hinterlegt</strong>
          <span>
            Rezepte, die mit dem, was es in Agüimes gibt, funktionieren — Zutaten landen
            mit einem Tipp auf der Einkaufsliste.
          </span>
        </div>
      )}

      <div className="rc-list">
        {recipes.map((recipe) => (
          <button
            key={recipe.id}
            type="button"
            className={`rc-card${open === recipe.id ? ' is-open' : ''}`}
            onClick={() => { setOpen(open === recipe.id ? null : recipe.id); setAdding(false) }}
          >
            <span className="rc-card-main">
              <strong>{recipe.title}</strong>
              <span className="rc-card-meta">{recipeMeta(recipe)}</span>
            </span>
            <ChefHat size={16} strokeWidth={1.9} className="rc-card-icon" />
          </button>
        ))}
      </div>

      {current && (
        <section className="rc-detail" ref={detailRef}>
          <div className="rc-detail-head">
            <div>
              <h2>{current.title}</h2>
              <p className="rc-card-meta">{recipeMeta(current)}</p>
            </div>
            <button
              type="button"
              className="rc-icon-btn"
              onClick={() => void remove(current)}
              aria-label={`${current.title} löschen`}
            >
              <Trash2 size={16} strokeWidth={1.9} />
            </button>
          </div>

          {current.note && <p className="rc-note">{current.note}</p>}

          <h3 className="rc-sub">Zutaten</h3>
          <ul className="rc-ingredients">
            {current.ingredients.map((ingredient, index) => (
              <li key={`${ingredient.name}-${index}`}>
                <span className="rc-ing-qty">{[ingredient.qty, unitLabel(ingredient.unit)].filter(Boolean).join(' ')}</span>
                <span className="rc-ing-name">{ingredient.name}</span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            className="rc-shop"
            onClick={() => void addToShopping(current)}
            disabled={busy || offline}
          >
            {busy ? <Loader2 size={15} className="rc-spin" /> : <ShoppingBasket size={15} strokeWidth={2} />}
            {offline ? 'Offline — Zutaten brauchen Netz' : 'Zutaten auf die Einkaufsliste'}
          </button>

          {current.steps && (
            <>
              <h3 className="rc-sub">So geht&apos;s</h3>
              <ol className="rc-steps">
                {parseSteps(current.steps).map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}

      {adding && (
        <RecipeForm
          listId={listId}
          userName={userName}
          offline={offline}
          onCancel={() => setAdding(false)}
          onSaved={(recipe) => {
            setRecipes((current) => {
              const next = [...current, recipe]
              writeCache<Recipe[]>(listId, 'recipes', next)
              return next
            })
            setAdding(false)
            setOpen(recipe.id)
            setToast('Rezept gespeichert')
          }}
          onError={(message) => setToast(message)}
        />
      )}

      {toast && <div className="rc-toast">{toast}</div>}
    </div>
  )
}

// ── Formular ─────────────────────────────────────────────────────────

interface FormProps {
  listId: string
  userName: string
  offline: boolean
  onCancel: () => void
  onSaved: (recipe: Recipe) => void
  onError: (message: string) => void
}

function RecipeForm({ listId, userName, offline, onCancel, onSaved, onError }: FormProps) {
  const [title, setTitle] = useState('')
  const [servings, setServings] = useState(3)
  const [minutes, setMinutes] = useState('')
  const [ingredientText, setIngredientText] = useState('')
  const [steps, setSteps] = useState('')
  const [saving, setSaving] = useState(false)

  const parsed = useMemo(() => parseIngredients(ingredientText), [ingredientText])
  const canSave = title.trim().length > 1 && parsed.length > 0 && !saving && !offline

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    const { data, error } = await supabase
      .from('recipes')
      .insert({
        list_id: listId,
        title: title.trim(),
        servings,
        minutes: minutes ? Number(minutes) : null,
        ingredients: parsed,
        steps: steps.trim() || null,
        created_by: userName,
      })
      .select('*')
      .single()
    setSaving(false)
    if (error || !data) {
      onError('Speichern fehlgeschlagen — Netz?')
      return
    }
    onSaved(data as Recipe)
  }

  return (
    <section className="rc-form">
      <div className="rc-form-head">
        <h2>Neues Rezept</h2>
        <button type="button" className="rc-icon-btn" onClick={onCancel} aria-label="Abbrechen">
          <X size={16} strokeWidth={2} />
        </button>
      </div>

      <label className="rc-field">
        <span>Name</span>
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="z. B. Papas arrugadas"
          autoFocus
        />
      </label>

      <div className="rc-field-row">
        <label className="rc-field">
          <span><Users size={11} strokeWidth={2} /> Portionen</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={12}
            value={servings}
            onChange={(event) => setServings(Math.min(12, Math.max(1, Number(event.target.value) || 1)))}
          />
        </label>
        <label className="rc-field">
          <span><Clock size={11} strokeWidth={2} /> Minuten</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={480}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
            placeholder="25"
          />
        </label>
      </div>

      <label className="rc-field">
        <span>Zutaten — eine pro Zeile</span>
        <textarea
          rows={5}
          value={ingredientText}
          onChange={(event) => setIngredientText(event.target.value)}
          placeholder={'1 kg Kartoffeln\n2 EL Meersalz\n3 Knoblauchzehen\n1 TL Paprikapulver'}
        />
      </label>

      {parsed.length > 0 && (
        <ul className="rc-preview">
          {parsed.map((ingredient: RecipeIngredient, index) => (
            <li key={`${ingredient.name}-${index}`}>{formatIngredient(ingredient)}</li>
          ))}
        </ul>
      )}

      <label className="rc-field">
        <span>Zubereitung — optional</span>
        <textarea
          rows={4}
          value={steps}
          onChange={(event) => setSteps(event.target.value)}
          placeholder={'Kartoffeln mit Schale in Salzwasser kochen\nMojo aus Knoblauch, Paprika, Öl und Essig rühren'}
        />
      </label>

      <button type="button" className="rc-shop rc-save" onClick={() => void save()} disabled={!canSave}>
        {saving ? <Loader2 size={15} className="rc-spin" /> : <Check size={15} strokeWidth={2.2} />}
        {offline ? 'Speichern braucht Netz' : 'Rezept speichern'}
      </button>
    </section>
  )
}
