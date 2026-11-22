import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChefHat, Clock, Loader2, Plus, Trash2, Users, ShoppingBasket, Check, X,
} from 'lucide-react'
import { readCache, writeCache } from '../lib/readCache'
import { supabase } from '../lib/supabase'
import { useRealtimeSync } from '../hooks/useRealtimeSync'
import { useToast } from '../context/ToastContext'
import {
  formatIngredient, parseIngredients, parseSteps, recipeMeta, unitLabel,
} from '../lib/recipes'
import type { ListItem, Recipe, RecipeIngredient } from '../types'
import './RecipesScreen.css'

interface Props {
  listId: string
  userName: string
  /** Einkaufsliste als eigener Abschnitt — Zutaten und Rezepte sind ein Weg. */
  shoppingItems: ListItem[]
  /** Häkchen direkt in der Küche setzen (dieselbe Aktion wie in der Liste). */
  onToggleItem: (item: ListItem) => void
  /** Öffnet die vollständige Einkaufsliste. */
  onOpenShopping: () => void
}

export default function RecipesScreen({ listId, userName, shoppingItems, onToggleItem, onOpenShopping }: Props) {
  const { toast } = useToast()
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  // Ohne Empfang in den Bergen: Rezepte sollen trotzdem lesbar sein.
  const [offline, setOffline] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  // Synchroner Doppeltap-Schutz: `busy` (State) kommt zu spät — zwei Taps im
  // selben Tick sehen beide `false` und legen die Zutaten doppelt an (kein
  // Unique-Index auf items). Der Ref wird vor dem ersten `await` gesetzt.
  const busyRef = useRef(false)
  // Realtime-Debounce-Timer (400 ms) — Cleanup im Unmount-Effekt unten.
  const realtimeTimerRef = useRef<number | null>(null)

  // Einkaufsliste: offene Posten zuerst, höchstens vier Zeilen — der Rest ist
  // ein Link. Erledigte brauchen hier keine Zeile, nur ihre Zahl.
  const openShopping = useMemo(() => shoppingItems.filter((item) => !item.is_checked), [shoppingItems])
  const doneShopping = shoppingItems.length - openShopping.length
  const shownShopping = openShopping.slice(0, 4)

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
      // Realtime-Reload fehlgeschlagen: die bereits sichtbaren Rezepte stehen
      // lassen — nur offline/loading setzen, KEIN setRecipes.
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

  useRealtimeSync({
    listId,
    // Kein DEFAULT_TABLES-Eintrag (`'recipes'` ist bewusst opt-in), inline statt
    // pro Render zusammengesetzt — der Hook stabilisiert das Abo über
    // `tablesKey`, kein Abo-Churn.
    tables: ['recipes'],
    // Debounce wie in TripPlanScreen: ein Speicherlauf kann mehrere Zeilen je
    // Event feuern — ein Refetch je Flut genügt. `load()` setzt bei gefülltem
    // State direkt den Netzstand, ein Fehlschlag lässt das Sichtbare stehen.
    onTableChange: () => {
      if (realtimeTimerRef.current) window.clearTimeout(realtimeTimerRef.current)
      realtimeTimerRef.current = window.setTimeout(() => {
        realtimeTimerRef.current = null
        void load()
      }, 400)
    },
  })

  // Hängenden Debounce-Timer beim Unmount abräumen.
  useEffect(() => () => {
    if (realtimeTimerRef.current) window.clearTimeout(realtimeTimerRef.current)
  }, [])

  /** Zutaten, die noch nicht auf der Einkaufsliste stehen, in einem Rutsch anlegen. */
  const addToShopping = async (recipe: Recipe) => {
    if (busy || busyRef.current) return
    setBusy(true)
    busyRef.current = true
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
        toast('Steht alles schon auf der Liste', 'info')
        return
      }

      // Bestehende Reihenfolge nicht überschreiben: aktuelles Maximum holen
      // und dahinter anfügen — sonst landen neue Zutaten oben (sort_order 0,1,2 …).
      const { data: last } = await supabase
        .from('items')
        .select('sort_order')
        .eq('list_id', listId)
        .eq('list_type', 'shopping')
        .order('sort_order', { ascending: false })
        .limit(1)
      const maxOrder = Number((last as Array<{ sort_order: number | null }> | null)?.[0]?.sort_order ?? 0)

      const { error } = await supabase.from('items').insert(
        missing.map((ingredient, index) => ({
          list_id: listId,
          name: ingredient.name,
          category: ingredient.category,
          quantity: [ingredient.qty, unitLabel(ingredient.unit)].filter(Boolean).join(' '),
          list_type: 'shopping',
          created_by: userName,
          sort_order: maxOrder + 1 + index,
          is_checked: false,
          is_brought: false,
        })),
      )
      if (error) {
        toast('Konnte nicht speichern — Netz?', 'error')
        return
      }
      const skipped = recipe.ingredients.length - missing.length
      toast(
        missing.length === 1
          ? '1 Zutat auf die Einkaufsliste'
          : `${missing.length} Zutaten auf die Einkaufsliste${skipped > 0 ? ` · ${skipped} stand schon da` : ''}`,
        'success',
      )
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const remove = (recipe: Recipe) => {
    // Bestätigung wie in den anderen Screens: nichts löscht heimlich weg.
    // Sofort löschen, „Rückgängig" legt dasselbe Rezept (gleiche id) zurück —
    // inklusive Cache, damit es offline sofort wieder da ist.
    const drop = () => {
      setRecipes((current) => {
        const next = current.filter((entry) => entry.id !== recipe.id)
        writeCache<Recipe[]>(listId, 'recipes', next)
        return next
      })
      setOpen(null)
    }
    const restore = () => {
      void supabase.from('recipes').insert(recipe).then(({ error }) => {
        if (error) {
          toast('Wiederherstellen fehlgeschlagen', 'error')
          return
        }
        setRecipes((current) => {
          const next = current.some((entry) => entry.id === recipe.id) ? current : [...current, recipe]
          writeCache<Recipe[]>(listId, 'recipes', next)
          return next
        })
      })
    }

    drop()
    toast(`„${recipe.title}" gelöscht`, 'info', { label: 'Rückgängig', onClick: restore })

    void supabase.from('recipes').delete().eq('id', recipe.id).then(({ error }) => {
      if (error) {
        toast('Löschen fehlgeschlagen', 'error')
        restore()
      }
    })
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
              ? 'Lädt …'
              : recipes.length === 0
                // Leere Liste: die Leerzustandskarte spricht — Anzahl ausblenden.
                ? offline ? 'offline' : ''
                : `${recipes.length === 1 ? '1 Rezept' : `${recipes.length} Rezepte`}${offline ? ' · offline' : ''}`}
          </p>
        </div>
        <div className="rc-head-actions">
          <button
            type="button"
            className="rc-add"
            onClick={() => { setAdding(true); setOpen(null) }}
            aria-label="Rezept hinzufügen"
          >
            <Plus size={18} strokeWidth={2.2} />
          </button>
        </div>
      </header>

      <section className={`rc-basket${openShopping.length === 0 ? ' is-clear' : ''}`}>
        <div className="rc-basket-head">
          <span className="rc-basket-title">
            <ShoppingBasket size={15} strokeWidth={2} aria-hidden="true" />
            Einkaufsliste
          </span>
          <button type="button" className="rc-basket-all" onClick={onOpenShopping} aria-label="Einkaufsliste öffnen">
            alle <span aria-hidden="true">→</span>
          </button>
        </div>
        <p className="rc-basket-meta">
          {openShopping.length === 0
            ? doneShopping > 0 ? 'Alles erledigt' : 'Noch nichts eingetragen'
            : `${openShopping.length} offen${doneShopping > 0 ? ` · ${doneShopping} erledigt` : ''}`}
        </p>

        {openShopping.length === 0 ? (
          <p className="rc-basket-empty">
            {doneShopping > 0 ? 'Alles im Korb. ' : ''}
            Zutaten aus einem Rezept landen mit einem Tipp hier.
          </p>
        ) : (
          <ul className="rc-basket-list">
            {shownShopping.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="rc-basket-row"
                  onClick={() => onToggleItem(item)}
                  aria-label={`${item.name} abhaken`}
                >
                  <span className="rc-basket-check" aria-hidden="true">
                    <Check size={12} strokeWidth={3} />
                  </span>
                  <span className="rc-basket-name">{item.name}</span>
                  {item.quantity && <span className="rc-basket-qty">{item.quantity}</span>}
                </button>
              </li>
            ))}
            {openShopping.length > shownShopping.length && (
              <li>
                <button type="button" className="rc-basket-row is-more" onClick={onOpenShopping}>
                  + {openShopping.length - shownShopping.length} weitere
                </button>
              </li>
            )}
          </ul>
        )}
      </section>

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
              onClick={() => remove(current)}
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
            toast('Rezept gespeichert', 'success')
          }}
          onError={(message) => toast(message, 'error')}
        />
      )}
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
