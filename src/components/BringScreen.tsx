import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Trash2, GripVertical, Plus, Copy, MoreHorizontal, Search, X, Settings2, Backpack, Luggage } from 'lucide-react'
import type { BringFilter, ListItem, ItemCategory, ListType } from '../types'
import { supabase, getJoinCode } from '../lib/supabase'
import { logError } from '../lib/logger'
import { friendlyError } from '../lib/friendlyError'
import { useToast } from '../context/ToastContext'
import { useOfflineQueue } from '../hooks/useOfflineQueue'
import AddItemForm from './AddItemForm'
import CategoryManager from './CategoryManager'
import { useDragReorder } from '../hooks/useDragReorder'
import { useSheetFocus } from '../hooks/useSheetFocus'
import { SkeletonItemRow } from './Skeleton'
import './BringScreen.css'

// ── Packlist item type (not in types/index.ts — local to this screen) ──
interface PacklistItem {
  id: string
  list_id: string
  participant_name: string
  name: string
  quantity: string | null
  is_checked: boolean
  sort_order: number
  created_at: string
}

type SubTab = 'bring' | 'packlist'

interface BringScreenProps {
  items: ListItem[]
  categories: ItemCategory[]
  listId: string
  userName: string
  onItemToggle?: (item: ListItem) => void
  onItemDelete?: (item: ListItem) => void
  onItemChange?: () => void
  onReorder?: (listType: ListType, newOrder: string[]) => void
  onCategoriesChange?: () => void
  persons?: string[]
}

/** Wraps one person's bring items with independent drag-reorder. */
function DraggableBringGroup({
  person,
  personItems,
  isMe,
  onToggleBrought,
  onDelete,
  onReorder,
}: {
  person: string
  personItems: ListItem[]
  isMe: boolean
  onToggleBrought: (item: ListItem) => void
  onDelete: (item: ListItem) => void
  onReorder?: (newOrder: string[]) => void
}) {
  const { confirm } = useToast()
  const {
    dragState,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    registerItem,
  } = useDragReorder<ListItem>(personItems, (newOrder) => onReorder?.(newOrder))

  const broughtCount = personItems.filter((i) => i.is_brought).length

  return (
    <div className="bring-group">
      <div className="bring-group-header">
        <span className="bring-person">
          {isMe && <span className="bring-me-badge">Du</span>}
          {person}
        </span>
        <span className="bring-group-count">{broughtCount}/{personItems.length} mitgebracht</span>
      </div>
      {personItems.map((item) => {
        const itemClass = [
          'bring-item',
          item.is_brought ? 'brought' : '',
          dragState.draggingId === item.id ? 'dragging' : '',
          dragState.dragOverId === item.id ? 'drag-over' : '',
        ].filter(Boolean).join(' ')

        return (
          <div
            key={item.id}
            className={itemClass}
            ref={(el) => registerItem(item.id, el)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <button
              type="button"
              className="bring-drag-handle"
              onPointerDown={(e: ReactPointerEvent) => handlePointerDown(e, item.id)}
              aria-label={`${item.name} verschieben`}
            >
              <GripVertical size={16} strokeWidth={2} />
            </button>
            <label className="bring-checkbox-wrap">
              <input
                type="checkbox"
                checked={item.is_brought}
                onChange={() => { onToggleBrought(item); navigator.vibrate?.(10) }}
                aria-label={`${item.name} als mitgebracht markieren`}
              />
              <span className="bring-checkmark" />
            </label>
            <span className="bring-item-name">{item.name}</span>
            <span className="bring-item-qty">{item.quantity}</span>
            <button
              className="bring-item-delete"
              onClick={() => confirm(`„${item.name}“ wirklich löschen?`, () => onDelete(item), undefined, 'Löschen')}
              aria-label="Löschen"
            >
              <Trash2 size={16} strokeWidth={2} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default function BringScreen({ items, categories, listId, userName, onItemToggle, onItemDelete, onItemChange, onReorder, onCategoriesChange, persons }: BringScreenProps) {
  const { toast, confirm } = useToast()
  const { isOnline, enqueue } = useOfflineQueue()

  // ── Sub-tab toggle: shared bring list vs personal packing list ──
  const [subTab, setSubTab] = useState<SubTab>('bring')

  // ── Shared bring-list state (existing) ──
  const [filter, setFilter] = useState<BringFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [catsOpen, setCatsOpen] = useState(false)

  // ── Personal packing-list state ──
  const [packItems, setPackItems] = useState<PacklistItem[]>([])
  const [packLoading, setPackLoading] = useState(false)
  const [newPackName, setNewPackName] = useState('')
  const [newPackQty, setNewPackQty] = useState('')

  const menuRef = useRef<HTMLDivElement | null>(null)
  useSheetFocus(menuRef, menuOpen, () => setMenuOpen(false))

  // ── Refs ──
  const packChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // ── Fetch personal packing items ──
  const fetchPackItems = useCallback(async () => {
    setPackLoading(true)
    const { data, error } = await supabase
      .from('packlist_items')
      .select('*')
      .eq('list_id', listId)
      .eq('participant_name', userName)
      .order('sort_order')
    if (error) {
      logError('fetchPackItems error:', error)
      toast(`Packliste konnte nicht geladen werden: ${error.message}`, 'error')
    } else {
      setPackItems((data as PacklistItem[]) ?? [])
    }
    setPackLoading(false)
  }, [listId, userName, toast])

  // Fetch on mount and whenever the packlist tab becomes active
  useEffect(() => {
    if (subTab === 'packlist') {
      fetchPackItems()
    }
  }, [subTab, fetchPackItems])

  // ── Realtime sync for packlist_items (only while packlist tab is active) ──
  useEffect(() => {
    if (subTab !== 'packlist') return
    const joinCode = getJoinCode()
    const channel = supabase.channel(`packlist:${listId}:${userName}`, {
      config: { headers: { 'x-join-code': joinCode } },
    } as any)
    channel.on(
      'postgres_changes' as any,
      { event: '*', schema: 'public', table: 'packlist_items', filter: `list_id=eq.${listId}` },
      () => { fetchPackItems() }
    )
    channel.subscribe()
    packChannelRef.current = channel
    return () => {
      supabase.removeChannel(channel)
      packChannelRef.current = null
    }
  }, [listId, userName, subTab, fetchPackItems])

  // ── Add a packing item ──
  const handleAddPackItem = useCallback(async () => {
    const name = newPackName.trim()
    if (!name) return
    const quantity = newPackQty.trim() || null
    const sortOrder = packItems.length

    if (isOnline) {
      const { data, error } = await supabase
        .from('packlist_items')
        .insert({
          list_id: listId,
          participant_name: userName,
          name,
          quantity,
          is_checked: false,
          sort_order: sortOrder,
        })
        .select()
        .single()
      if (error) {
        toast(friendlyError(error), 'error')
        return
      }
      setPackItems(prev => [...prev, data as PacklistItem])
    } else {
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setPackItems(prev => [...prev, {
        id: tempId,
        list_id: listId,
        participant_name: userName,
        name,
        quantity,
        is_checked: false,
        sort_order: sortOrder,
        created_at: new Date().toISOString(),
      }])
      enqueue({
        type: 'insert',
        table: 'packlist_items',
        payload: {
          list_id: listId,
          participant_name: userName,
          name,
          quantity,
          is_checked: false,
          sort_order: sortOrder,
        },
      })
    }
    setNewPackName('')
    setNewPackQty('')
    navigator.vibrate?.(10)
  }, [newPackName, newPackQty, packItems.length, isOnline, listId, userName, enqueue, toast])

  // ── Toggle a packing item's is_checked ──
  const handleTogglePackItem = useCallback(async (item: PacklistItem) => {
    const newValue = !item.is_checked
    // Optimistic update
    setPackItems(prev => prev.map(p => p.id === item.id ? { ...p, is_checked: newValue } : p))

    if (isOnline) {
      const { error } = await supabase
        .from('packlist_items')
        .update({ is_checked: newValue })
        .eq('id', item.id)
      if (error) {
        toast(friendlyError(error), 'error')
        // Revert on error
        setPackItems(prev => prev.map(p => p.id === item.id ? { ...p, is_checked: !newValue } : p))
      }
    } else {
      enqueue({
        type: 'update',
        table: 'packlist_items',
        payload: { is_checked: newValue },
        filterColumn: 'id',
        filterValue: item.id,
      })
    }
    navigator.vibrate?.(10)
  }, [isOnline, enqueue, toast])

  // ── Delete a packing item ──
  const handleDeletePackItem = useCallback((item: PacklistItem) => {
    confirm(`Packlisten-Element „${item.name}“ wirklich löschen?`, async () => {
      // Optimistic removal
      setPackItems(prev => prev.filter(p => p.id !== item.id))

      if (isOnline) {
        const { error } = await supabase
          .from('packlist_items')
          .delete()
          .eq('id', item.id)
        if (error) {
          toast(friendlyError(error), 'error')
          // Re-fetch to restore correct state
          fetchPackItems()
        }
      } else {
        enqueue({
          type: 'delete',
          table: 'packlist_items',
          payload: {},
          filterColumn: 'id',
          filterValue: item.id,
        })
      }
      toast('Element gelöscht!', 'success')
      navigator.vibrate?.(10)
    })
  }, [confirm, isOnline, enqueue, toast, fetchPackItems])

  // ── Copy items from shared bring list (assigned to me) into packing list ──
  const handleCopyFromBring = useCallback(async () => {
    const myBringItems = items.filter(i => i.assigned_to === userName)
    if (myBringItems.length === 0) {
      toast('Du hast keine Mitbringen-Elemente zugewiesen.', 'info')
      return
    }

    // Dedupe by name against existing pack items
    const existingNames = new Set(packItems.map(p => p.name.toLowerCase()))
    const toAdd = myBringItems.filter(i => !existingNames.has(i.name.toLowerCase()))
    if (toAdd.length === 0) {
      toast('Alle deine Mitbringen-Elemente sind bereits in der Packliste.', 'info')
      return
    }

    let baseSort = packItems.length
    const newRows = toAdd.map((item, idx) => ({
      id: `temp-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      list_id: listId,
      participant_name: userName,
      name: item.name,
      quantity: item.quantity || null,
      is_checked: false,
      sort_order: baseSort + idx,
      created_at: new Date().toISOString(),
    }))

    // Optimistic insert
    setPackItems(prev => [...prev, ...newRows])

    if (isOnline) {
      const insertPayload = newRows.map((row) => {
        const rest = { ...row } as unknown as Record<string, unknown>
        delete rest.id
        delete rest.created_at
        return rest
      })
      const { error } = await supabase
        .from('packlist_items')
        .insert(insertPayload)
      if (error) {
        toast(`Übernehmen fehlgeschlagen — ${friendlyError(error)}`, 'error')
        // Re-fetch to restore correct state
        fetchPackItems()
        return
      }
    } else {
      for (const row of newRows) {
        const rest = { ...row } as unknown as Record<string, unknown>
        delete rest.id
        delete rest.created_at
        enqueue({
          type: 'insert',
          table: 'packlist_items',
          payload: rest,
        })
      }
    }
    toast(`${toAdd.length} Element${toAdd.length === 1 ? '' : 'e'} aus Mitbringen übernommen!`, 'success')
    navigator.vibrate?.(15)
  }, [items, userName, packItems, isOnline, listId, enqueue, toast, fetchPackItems])

  // ── Packlist stats ──
  const packStats = useMemo(() => {
    const total = packItems.length
    const checked = packItems.filter(p => p.is_checked).length
    return { total, checked }
  }, [packItems])

  // ── Shared bring-list filtering (existing) ──
  const filtered = useMemo(() => {
    let result = items
    if (filter === 'mine') result = result.filter((i) => i.assigned_to === userName)
    if (filter === 'unfilled') result = result.filter((i) => !i.assigned_to)
    if (searchQuery.trim()) result = result.filter((i) => i.name.toLowerCase().includes(searchQuery.toLowerCase()))
    return result
  }, [items, filter, userName, searchQuery])

  const grouped = useMemo(() => {
    const map = new Map<string, ListItem[]>()
    for (const item of filtered) {
      const key = item.assigned_to || '— Niemand —'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(item)
    }
    // Sort: userName's group first, then alphabetical
    const sorted = Array.from(map.entries()).sort((a, b) => {
      if (a[0] === userName) return -1
      if (b[0] === userName) return 1
      return a[0].localeCompare(b[0])
    })
    return sorted
  }, [filtered, userName])

  const broughtCount = items.filter(i => i.is_brought).length
  const openBring = items.length - broughtCount
  const progress = subTab === 'bring'
    ? (items.length === 0 ? 0 : Math.round((broughtCount / items.length) * 100))
    : (packStats.total === 0 ? 0 : Math.round((packStats.checked / packStats.total) * 100))

  const headline = subTab === 'bring'
    ? items.length === 0
      ? 'Noch nichts verteilt'
      : openBring === 0
        ? 'Alles dabei 🎉'
        : `${openBring} offen · ${broughtCount} mitgebracht`
    : packStats.total === 0
      ? 'Noch nichts gepackt'
      : `${packStats.total - packStats.checked} offen · ${packStats.checked} gepackt`

  return (
    <div className="bring-screen">
      <header className="list-head">
        <div className="list-head-text">
          <h1>{subTab === 'bring' ? 'Mitbringen' : 'Packliste'}</h1>
          <p>{headline}</p>
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

      <div className="list-progress" aria-hidden="true">
        <i style={{ width: `${progress}%` }} />
      </div>

      <div className="money-toggle">
        <button
          type="button"
          aria-pressed={subTab === 'bring'}
          className={`money-toggle-btn${subTab === 'bring' ? ' active' : ''}`}
          onClick={() => { navigator.vibrate?.(8); setSubTab('bring') }}
        >
          <Backpack size={15} strokeWidth={2} /> Mitbringen
        </button>
        <button
          type="button"
          aria-pressed={subTab === 'packlist'}
          className={`money-toggle-btn${subTab === 'packlist' ? ' active' : ''}`}
          onClick={() => { navigator.vibrate?.(8); setSubTab('packlist') }}
        >
          <Luggage size={15} strokeWidth={2} /> Packliste
        </button>
      </div>

      {menuOpen && (
        <div className="list-menu-scrim" role="presentation" onClick={() => setMenuOpen(false)}>
          <div
            ref={menuRef}
            className="list-menu-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Mitbringen-Optionen"
            onClick={e => e.stopPropagation()}
          >
            <div className="more-grab" aria-hidden="true" />
            <button
              type="button"
              className="list-menu-item"
              onClick={() => { setSearchOpen(true); setMenuOpen(false) }}
            >
              <Search size={17} strokeWidth={2} />
              <span>Suchen</span>
            </button>
            <button
              type="button"
              className="list-menu-item"
              onClick={() => { setCatsOpen(v => !v); setMenuOpen(false) }}
            >
              <Settings2 size={17} strokeWidth={2} />
              <span>{catsOpen ? 'Kategorien ausblenden' : 'Kategorien verwalten'}</span>
            </button>
            <button
              type="button"
              className="list-menu-item"
              onClick={() => { handleCopyFromBring(); setMenuOpen(false) }}
            >
              <Copy size={17} strokeWidth={2} />
              <span>Aus Mitbringen in die Packliste</span>
            </button>
          </div>
        </div>
      )}

      {searchOpen && (
        <div className="list-search-row">
          <Search size={15} strokeWidth={2} />
          <input
            type="text"
            className="bring-search-input"
            placeholder="Suchen…"
            aria-label="Mitbringen durchsuchen"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            autoFocus
          />
          <button
            type="button"
            onClick={() => { setSearchQuery(''); setSearchOpen(false) }}
            aria-label="Suche schließen"
          >
            <X size={15} strokeWidth={2} />
          </button>
        </div>
      )}

      {catsOpen && (
        <div className="cat-manager-wrap">
          <CategoryManager
            categories={categories}
            listId={listId}
            listType="bring"
            onCategoriesChange={onCategoriesChange}
          />
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* TAB: Shared Mitbringen (existing — unchanged)                */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {subTab === 'bring' && (
        <>
          <div className="cat-strip">
            {([
              { key: 'all' as BringFilter, label: 'Alle', count: items.length },
              { key: 'mine' as BringFilter, label: 'Nur meine', count: items.filter(i => i.assigned_to === userName).length },
              { key: 'unfilled' as BringFilter, label: 'Offen', count: items.filter(i => !i.assigned_to).length },
            ]).map(({ key, label, count }) => (
              <button
                key={key}
                type="button"
                className={`cat-chip${filter === key ? ' active' : ''}`}
                onClick={() => { navigator.vibrate?.(6); setFilter(key) }}
                aria-pressed={filter === key}
              >
                {label} <b>{count}</b>
              </button>
            ))}
          </div>

          {grouped.length === 0 && (
            <p className="bring-empty"><Backpack size={24} strokeWidth={1.5} /> Nichts hier — vielleicht Filter ändern?</p>
          )}

          {grouped.map(([person, personItems]) => {
            const isMe = person === userName
            return (
              <DraggableBringGroup
                key={person}
                person={person}
                personItems={personItems}
                isMe={isMe}
                onToggleBrought={onItemToggle ?? (() => {})}
                onDelete={onItemDelete ?? (() => {})}
                onReorder={(newOrder) => onReorder?.('bring', newOrder)}
              />
            )
          })}

          <div className="list-addbar">
            <AddItemForm
              listId={listId}
              userName={userName}
              onAdded={onItemChange}
              defaultAssignedTo={userName}
              placeholder="Was bringst du mit?"
              categories={categories}
              listType="bring"
              persons={persons}
            />
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* TAB: Meine Packliste (personal packing list)                   */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {subTab === 'packlist' && (
        <div className="packlist-section">
          {/* Add form */}
          <div className="packlist-add-form">
            <input
              type="text"
              className="packlist-input-name"
              placeholder="Was packst du ein?"
              value={newPackName}
              onChange={e => setNewPackName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddPackItem() }}
            />
            <input
              type="text"
              className="packlist-input-qty"
              placeholder="Menge"
              value={newPackQty}
              onChange={e => setNewPackQty(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddPackItem() }}
            />
            <button
              className="packlist-add-btn"
              onClick={handleAddPackItem}
              disabled={!newPackName.trim()}
              aria-label="Hinzufügen"
            >
              <Plus size={18} strokeWidth={2.5} />
            </button>
          </div>

          {/* Copy from bring list */}
          <button
            className="packlist-copy-btn"
            onClick={handleCopyFromBring}
          >
            <Copy size={16} strokeWidth={2} />
            Aus Mitbringen übernehmen
          </button>

          {/* Progress indicator */}
          {packStats.total > 0 && (
            <div className="packlist-progress">
              <div className="packlist-progress-bar">
                <div
                  className="packlist-progress-fill"
                  style={{ width: `${packStats.total > 0 ? (packStats.checked / packStats.total) * 100 : 0}%` }}
                />
              </div>
              <span className="packlist-progress-text">
                {packStats.checked}/{packStats.total} gepackt
              </span>
            </div>
          )}

          {/* Loading state */}
          {packLoading && packItems.length === 0 && (
            <div className="packlist-items">
              <SkeletonItemRow />
              <SkeletonItemRow />
              <SkeletonItemRow />
            </div>
          )}

          {/* Empty state */}
          {!packLoading && packItems.length === 0 && (
            <p className="packlist-empty">
              🧳 Noch nichts auf der Packliste.<br />
              Noch nichts hier — füge oben etwas hinzu oder übernehme sie aus der Mitbringen-Liste.
            </p>
          )}

          {/* Packlist items */}
          {packItems.length > 0 && (
            <div className="packlist-items">
              {packItems.map((item) => (
                <div
                  key={item.id}
                  className={`packlist-item ${item.is_checked ? 'checked' : ''}`}
                >
                  <label className="packlist-checkbox-wrap">
                    <input
                      type="checkbox"
                      checked={item.is_checked}
                      onChange={() => handleTogglePackItem(item)}
                    />
                    <span className="packlist-checkmark" />
                  </label>
                  <span className="packlist-item-name">{item.name}</span>
                  {item.quantity && (
                    <span className="packlist-item-qty">{item.quantity}</span>
                  )}
                  <button
                    className="packlist-item-delete"
                    onClick={() => handleDeletePackItem(item)}
                    aria-label="Löschen"
                  >
                    <Trash2 size={16} strokeWidth={2} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}