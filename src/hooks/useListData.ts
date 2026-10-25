import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type {
  ListItem,
  ItemCategory,
  ListType,
  ShoppingList,
  QuickNote,
  Expense,
  ExpenseSplit,
  ExpenseQuota,
  Participant,
  Settlement,
} from '../types'
import { supabase, restoreParticipantSession } from '../lib/supabase'
import { useOfflineQueue } from './useOfflineQueue'
import { useRealtimeSync } from './useRealtimeSync'
import { useToast } from '../context/ToastContext'
import { logError } from '../lib/logger'
import { readCache, writeCache, clearCacheForList } from '../lib/readCache'
import {
  deriveCategoriesByType,
  deriveKnownPersons,
  deriveUserBalance,
  deriveExpenseTotal,
  deriveIsAdmin,
  deriveCheckedCount,
} from '../lib/derivedState'
import {
  notifyEvent,
  setNotifyListId,
  setNotifyUserName,
  resetNotifyBuffer,
} from '../lib/notify'
import { spanishPhrase } from '../lib/espanaFlair'
import { publishActivity, markOwnAction, consumeOwnAction } from '../lib/activityBus'

/** Undo-Stufe: gelöschte Items + Listentyp + Ablauf-Timer */
interface UndoEntry {
  id: number
  items: ListItem[]
  listType: ListType
  timeout: ReturnType<typeof setTimeout> | null
}

/** Items wieder an der Originalposition einsortieren (nicht vorne anhängen):
 * Reihenfolge wie beim Fetch — sort_order, dann created_at. */
function insertSortedBySortOrder(prev: ListItem[], restored: ListItem[]): ListItem[] {
  return [
    ...prev.filter((i) => !restored.some((r) => r.id === i.id)),
    ...restored,
  ].sort(
    (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
  )
}

export function useListData({ onActivity }: { onActivity?: (msg: string) => void } = {}) {
  // ── Offline queue ──────────────────────────────────────────────────
  const { isOnline, enqueue, flushQueue, queueLength } = useOfflineQueue()

  // ── Toast (App-Mechanismus aus dem ToastContext) ───────────────────
  const { toast } = useToast()

  // ── State ──────────────────────────────────────────────────────────
  const [userName, setUserName] = useState<string | null>(null)
  const [list, setList] = useState<ShoppingList | null>(null)
  const [participantId, setParticipantId] = useState<string | null>(null)
  const [shoppingItems, setShoppingItems] = useState<ListItem[]>([])
  const [bringItems, setBringItems] = useState<ListItem[]>([])
  const [categories, setCategories] = useState<ItemCategory[]>([])
  const [notes, setNotes] = useState<QuickNote[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [expenseSplits, setExpenseSplits] = useState<ExpenseSplit[]>([])
  const [expenseQuotas, setExpenseQuotas] = useState<ExpenseQuota[]>([])
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [participants, setParticipants] = useState<Participant[]>([])
  const [adminUnlocked, setAdminUnlocked] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // ── Fetch guard for realtime sync debounce ─────────────────────────
  const isFetchingRef = useRef(false)

  // ── Realtime debounce: accumulate changed tables, refetch once ──────
  const pendingRealtimeTablesRef = useRef<Set<string>>(new Set())
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Race guards für alle Fetches: ein Zähler pro Zustands-Slot ─────
  // Ein älterer Response darf einen neueren nie überschreiben (z. B. wenn
  // ein langsamer Request nach einem frischen Refetch eintrifft).
  const fetchSeqsRef = useRef<Record<string, number>>({})
  const claimFetchSeq = useCallback((key: string) => {
    fetchSeqsRef.current[key] = (fetchSeqsRef.current[key] ?? 0) + 1
    return fetchSeqsRef.current[key]
  }, [])

  // ── Track previous shopping items for push notifications ───────────
  const prevShoppingItemsRef = useRef<ListItem[]>([])
  // ── Track previous bring items for push notifications ─────────────
  const prevBringItemsRef = useRef<ListItem[]>([])

  // ── userNameRef: avoids cascading re-creation of fetchItems ────────
  const userNameRef = useRef<string | null>(userName)
  userNameRef.current = userName

  // ── Undo-Stack für Löschaktionen (max. 5 Stufen, älteste fallen raus) ─
  // undoStackRef als Spiegel, damit withUndo/undoDelete stabile Callbacks
  // bleiben und App den obersten Eintrag als `undoState` bekommt.
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
  const undoStackRef = useRef<UndoEntry[]>([])
  const undoSeqRef = useRef(0)
  /** Kompatibel nach außen: der oberste (neueste) Undo-Eintrag */
  const undoState = undoStack.length > 0 ? undoStack[undoStack.length - 1] : null

  // ── Fetch functions ────────────────────────────────────────────────
  const fetchItems = useCallback(async (listId: string, listType: ListType) => {
    const seqKey = listType === 'shopping' ? 'items:shopping' : 'items:bring'
    const mySeq = claimFetchSeq(seqKey)
    const { data, error: err } = await supabase
      .from('items')
      .select('*')
      .eq('list_id', listId)
      .eq('list_type', listType)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    if (err) {
      logError('fetchItems error:', err)
      // Offline fallback: show cached data so lists stay visible
      if (mySeq === fetchSeqsRef.current[seqKey]) {
        const table = listType === 'shopping' ? 'shopping_items' : 'bring_items'
        const cached = readCache<ListItem[]>(listId, table)
        if (cached) {
          if (listType === 'shopping') setShoppingItems(cached)
          else setBringItems(cached)
        }
      }
      return
    }
    // Race guard: ein älterer Response darf einen neueren nie überschreiben
    if (mySeq !== fetchSeqsRef.current[seqKey]) return
    const items = (data || []) as ListItem[]
    // Write to read cache for offline access
    writeCache(listId, listType === 'shopping' ? 'shopping_items' : 'bring_items', items)
    if (listType === 'shopping') {
      // ── Batched push notifications for shopping items ──────────────
      const pushEnabled = localStorage.getItem('push_notifications_enabled') === 'true'

      if (pushEnabled) {
        const prevItems = prevShoppingItemsRef.current
        const prevMap = new Map(prevItems.map(i => [i.id, i]))
        const prevIds = new Set(prevMap.keys())

        // New items added by others
        const newItems = items.filter(
          i => !prevIds.has(i.id) && i.created_by !== userNameRef.current,
        )

        if (newItems.length > 0 && prevItems.length > 0) {
          notifyEvent('new_shopping', 'neue Items in der Einkaufsliste', newItems.length)
        }

        // Checkbox toggles by others (is_checked changed)
        if (prevItems.length > 0) {
          let checkedCount = 0
          let uncheckedCount = 0
          for (const item of items) {
            const prev = prevMap.get(item.id)
            if (!prev) continue
            // Only count changes on items NOT created by us
            // (if we toggled our own item, we shouldn't be notified)
            if (item.created_by !== userNameRef.current) {
              if (!prev.is_checked && item.is_checked) {
                checkedCount++
              } else if (prev.is_checked && !item.is_checked) {
                uncheckedCount++
              }
            }
          }
          if (checkedCount > 0) {
            notifyEvent('checked_shopping', 'Items abgehakt', checkedCount)
          }
          if (uncheckedCount > 0) {
            notifyEvent('unchecked_shopping', 'Items wieder offen', uncheckedCount)
          }
        }
      }

      prevShoppingItemsRef.current = items
      setShoppingItems(items)
    } else {
      // ── Batched push notifications for bring items ────────────────
      const pushEnabled = localStorage.getItem('push_notifications_enabled') === 'true'

      if (pushEnabled) {
        const prevItems = prevBringItemsRef.current
        const prevMap = new Map(prevItems.map(i => [i.id, i]))
        const prevIds = new Set(prevMap.keys())

        // New bring items added by others
        const newBringItems = items.filter(
          i => !prevIds.has(i.id) && i.created_by !== userNameRef.current,
        )

        if (newBringItems.length > 0 && prevItems.length > 0) {
          notifyEvent('new_bring', 'neue Mitbring-Items', newBringItems.length)
        }

        // is_brought toggles by others
        if (prevItems.length > 0) {
          let broughtCount = 0
          let unbroughtCount = 0
          for (const item of items) {
            const prev = prevMap.get(item.id)
            if (!prev) continue
            if (item.created_by !== userNameRef.current) {
              if (!prev.is_brought && item.is_brought) {
                broughtCount++
              } else if (prev.is_brought && !item.is_brought) {
                unbroughtCount++
              }
            }
          }
          if (broughtCount > 0) {
            notifyEvent('brought', 'Items als mitgebracht markiert', broughtCount)
          }
          if (unbroughtCount > 0) {
            notifyEvent('unbrought', 'Items nicht mehr mitgebracht', unbroughtCount)
          }
        }
      }

      prevBringItemsRef.current = items
      setBringItems(items)
    }
  }, [claimFetchSeq])

  const fetchCategories = useCallback(async (listId: string) => {
    const mySeq = claimFetchSeq('categories')
    const { data, error: err } = await supabase
      .from('categories')
      .select('*')
      .eq('list_id', listId)
      .order('sort_order', { ascending: true })
    if (err) {
      logError('fetchCategories error:', err)
      if (mySeq === fetchSeqsRef.current['categories']) {
        const cached = readCache<ItemCategory[]>(listId, 'categories')
        if (cached) setCategories(cached)
      }
      return
    }
    // Race guard: ein älterer Response darf einen neueren nie überschreiben
    if (mySeq !== fetchSeqsRef.current['categories']) return
    const catData = (data || []) as ItemCategory[]
    writeCache(listId, 'categories', catData)
    setCategories(catData)
  }, [claimFetchSeq])

  const fetchNotes = useCallback(async (listId: string) => {
    const mySeq = claimFetchSeq('notes')
    const { data, error: err } = await supabase
      .from('notes')
      .select('*')
      .eq('list_id', listId)
      .order('is_favorite', { ascending: false })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    if (err) {
      logError('fetchNotes error:', err)
      if (mySeq === fetchSeqsRef.current['notes']) {
        const cached = readCache<QuickNote[]>(listId, 'notes')
        if (cached) setNotes(cached)
      }
      return
    }
    // Race guard: ein älterer Response darf einen neueren nie überschreiben
    if (mySeq !== fetchSeqsRef.current['notes']) return
    const noteData = (data || []) as QuickNote[]
    writeCache(listId, 'notes', noteData)
    setNotes(noteData)
  }, [claimFetchSeq])

  const fetchExpenses = useCallback(async (listId: string) => {
    const mySeq = claimFetchSeq('expenses')

    const { data, error: err } = await supabase
      .from('expenses')
      .select('*')
      .eq('list_id', listId)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })
    if (err) {
      logError('fetchExpenses error:', err)
      // Offline fallback: show cached data for both tables
      if (mySeq === fetchSeqsRef.current['expenses']) {
        const cachedExp = readCache<Expense[]>(listId, 'expenses')
        if (cachedExp) setExpenses(cachedExp)
        const cachedSplits = readCache<ExpenseSplit[]>(listId, 'expense_splits')
        if (cachedSplits) setExpenseSplits(cachedSplits)
      }
      return
    }
    const expData = (data || []) as Expense[]

    // Fetch all splits for these expenses in the same async body
    let splits: ExpenseSplit[] = []
    if (expData.length > 0) {
      const expenseIds = expData.map(e => e.id)
      const { data: splitData, error: splitErr } = await supabase
        .from('expense_splits')
        .select('*')
        .in('expense_id', expenseIds)
      if (splitErr) {
        logError('fetchExpenses splits error:', splitErr)
        // Fall back to cached splits, but still apply fresh expenses
        const cachedSplits = readCache<ExpenseSplit[]>(listId, 'expense_splits')
        splits = cachedSplits ?? []
      } else {
        splits = (splitData || []) as ExpenseSplit[]
      }
    }

    // Race guard: only apply if this is still the latest call
    if (mySeq === fetchSeqsRef.current['expenses']) {
      writeCache(listId, 'expenses', expData)
      writeCache(listId, 'expense_splits', splits)
      setExpenses(expData)
      setExpenseSplits(splits)
    }
  }, [claimFetchSeq])

  const fetchParticipants = useCallback(async (listId: string) => {
    const mySeq = claimFetchSeq('participants')
    const { data, error: err } = await supabase
      .from('participants')
      .select('*')
      .eq('list_id', listId)
      .order('name', { ascending: true })
    if (err) {
      logError('fetchParticipants error:', err)
      if (mySeq === fetchSeqsRef.current['participants']) {
        const cached = readCache<Participant[]>(listId, 'participants')
        if (cached) setParticipants(cached)
      }
      return
    }
    // Race guard: ein älterer Response darf einen neueren nie überschreiben
    if (mySeq !== fetchSeqsRef.current['participants']) return
    const partData = (data || []) as Participant[]
    writeCache(listId, 'participants', partData)
    setParticipants(partData)
  }, [claimFetchSeq])

  const fetchExpenseQuotas = useCallback(async (listId: string) => {
    const mySeq = claimFetchSeq('expense_quotas')
    const { data, error: err } = await supabase
      .from('expense_quotas')
      .select('*')
      .eq('list_id', listId)
      .order('category', { ascending: true })
      .order('person_name', { ascending: true })
    if (err) {
      logError('fetchExpenseQuotas error:', err)
      return
    }
    // Race guard: ein älterer Response darf einen neueren nie überschreiben
    if (mySeq !== fetchSeqsRef.current['expense_quotas']) return
    setExpenseQuotas((data || []) as ExpenseQuota[])
  }, [claimFetchSeq])

  const fetchSettlements = useCallback(async (listId: string) => {
    const mySeq = claimFetchSeq('settlements')
    const { data, error: err } = await supabase
      .from('settlements')
      .select('*')
      .eq('list_id', listId)
      .order('settled_at', { ascending: true })
      .order('created_at', { ascending: true })
    if (err) {
      logError('fetchSettlements error:', err)
      return
    }
    // Race guard: ein älterer Response darf einen neueren nie überschreiben
    if (mySeq !== fetchSeqsRef.current['settlements']) return
    setSettlements((data || []) as Settlement[])
  }, [claimFetchSeq])

  const fetchAll = useCallback(async (listId: string, force = false) => {
    // Guard against overlapping fetches — Mutation-Refetches können mit force=true
    // den Guard umgehen, damit sie nicht vom Realtime-Sync blockiert werden.
    if (!force && isFetchingRef.current) return
    isFetchingRef.current = true
    try {
      await Promise.all([
        fetchItems(listId, 'shopping'),
        fetchItems(listId, 'bring'),
        fetchCategories(listId),
        fetchNotes(listId),
        fetchExpenses(listId),
        fetchParticipants(listId),
        fetchExpenseQuotas(listId),
        fetchSettlements(listId),
      ])
    } finally {
      isFetchingRef.current = false
      setIsLoading(false)
    }
  }, [fetchItems, fetchCategories, fetchNotes, fetchExpenses, fetchParticipants, fetchExpenseQuotas, fetchSettlements])

  // ── Ausfallsicherung gegen stilles Realtime ─────────────────────────
  // Wenn der Tab wieder sichtbar wird oder das Netz zurückkommt, frisch
  // nachladen: Realtime liefert ggf. keine Events (z. B. nach Suspend oder
  // offline Phase). Ohne force → kein Ladebalken, der Guard verhindert
  // Doppel-Fetches.
  useEffect(() => {
    if (!list) return
    const refetch = () => { fetchAll(list.id) }
    const onVisible = () => {
      if (document.visibilityState === 'visible') refetch()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', refetch)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', refetch)
    }
  }, [list, fetchAll])

  // ── Realtime sync (replaces adaptive polling) ──────────────────────
  // ref keeps latest onActivity without re-creating handleRealtimeChange
  const onActivityRef = useRef(onActivity)
  onActivityRef.current = onActivity

  const handleRealtimeChange = useCallback((table: string, payload: any) => {
    if (!list) return

    // ── Build Activity-Meldung aus dem Realtime-Payload ──
    if (payload && onActivityRef.current) {
      const eventType: string = payload.eventType ?? ''
      const newRec = payload.new as { name?: string; title?: string; description?: string; list_type?: string; is_checked?: boolean; is_brought?: boolean } | undefined
      const oldRec = payload.old as { name?: string; title?: string; description?: string; list_type?: string; is_checked?: boolean; is_brought?: boolean } | undefined
      let msg: string | null = null
      let kind: 'add' | 'check' = 'add'

      if (eventType === 'INSERT') {
        kind = 'add'
        if (table === 'items') {
          const name = newRec?.name ?? 'Item'
          // Suppress our own realtime echo (AddItemForm fires locally + marks)
          if (!consumeOwnAction(`items:${name}`)) {
            const lt = newRec?.list_type
            const target = lt === 'bring' ? 'Mitbringen' : 'Einkaufsliste'
            msg = `${name} zur ${target} hinzugefügt`
          }
        } else if (table === 'notes') {
          msg = `${newRec?.title ?? 'Notiz'} hinzugefügt`
        } else if (table === 'expenses') {
          const name = newRec?.description ?? 'Ausgabe'
          if (!consumeOwnAction(`expenses:${name}`)) {
            msg = `${name} als Ausgabe eingetragen`
          }
        }
      } else if (eventType === 'UPDATE') {
        if (table === 'items') {
          if (oldRec?.is_checked === false && newRec?.is_checked === true) {
            kind = 'check'
            const name = newRec?.name ?? 'Item'
            if (!consumeOwnAction(`check:${name}`)) {
              msg = `${name} abgehakt`
            }
          } else if (oldRec?.is_brought === false && newRec?.is_brought === true) {
            kind = 'check'
            const name = newRec?.name ?? 'Item'
            if (!consumeOwnAction(`brought:${name}`)) {
              msg = `${name} als mitgebracht markiert`
            }
          }
        }
      } else if (eventType === 'DELETE') {
        const name = oldRec?.name
        if (name) {
          kind = 'add'
          msg = `${name} entfernt`
        }
      }

      if (msg) {
        const activeMsg = `${spanishPhrase(kind)} ${msg}`
        onActivityRef.current(activeMsg)
      }
    }

    // Accumulate the changed table and debounce the refetch
    pendingRealtimeTablesRef.current.add(table)
    if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
    realtimeDebounceRef.current = setTimeout(() => {
      const tables = pendingRealtimeTablesRef.current
      const lid = list.id
      if (tables.has('items')) {
        fetchItems(lid, 'shopping')
        fetchItems(lid, 'bring')
      }
      if (tables.has('categories')) {
        fetchCategories(lid)
      }
      if (tables.has('notes')) {
        fetchNotes(lid)
      }
      if (tables.has('expenses') || tables.has('expense_splits')) {
        fetchExpenses(lid)
      }
      if (tables.has('expense_quotas')) {
        fetchExpenseQuotas(lid)
      }
      if (tables.has('settlements')) {
        fetchSettlements(lid)
      }
      if (tables.has('participants')) {
        fetchParticipants(lid)
      }
      // bristol_entries is handled by BristolScreen's own realtime subscription
      tables.clear()
      realtimeDebounceRef.current = null
    }, 400)
  }, [list, fetchItems, fetchCategories, fetchNotes, fetchExpenses, fetchExpenseQuotas, fetchParticipants, fetchSettlements])

  useRealtimeSync({
    listId: list?.id ?? null,
    onTableChange: handleRealtimeChange,
  })

  // ── Cleanup realtime debounce timeout on unmount ───────────────────
  useEffect(() => {
    return () => {
      if (realtimeDebounceRef.current) {
        clearTimeout(realtimeDebounceRef.current)
        realtimeDebounceRef.current = null
      }
    }
  }, [])

  // ── Sync list id + user name to the notification module ────────────
  useEffect(() => {
    setNotifyListId(list?.id ?? null)
  }, [list?.id])

  useEffect(() => {
    setNotifyUserName(userName)
  }, [userName])

  // ── Auto-restore session ───────────────────────────────────────────
  useEffect(() => {
    const savedName = localStorage.getItem('user_name')
    const savedParticipantId = localStorage.getItem('participant_id')
    if (savedName && savedParticipantId) {
      restoreParticipantSession(savedParticipantId).then((result) => {
        if (result.error || !result.list_id) return
        setUserName(result.participant_name)
        setParticipantId(result.participant_id)
        setIsLoading(true)
        Promise.resolve(
          supabase
            .from('lists')
            .select('*')
            .eq('id', result.list_id)
            .single()
        )
          .then(({ data, error }) => {
            if (error || !data) {
              // List was deleted or query failed — clean up session and stop loading
              setIsLoading(false)
              if (!error) {
                // Only clean up localStorage if the list genuinely doesn't exist
                localStorage.removeItem('user_name')
                localStorage.removeItem('participant_id')
              }
              return
            }
            setList(data as ShoppingList)
            fetchAll(result.list_id)
          })
          .catch(() => {
            setIsLoading(false)
          })
      })
    }
  }, [fetchAll])

  // ── Optimistic update helpers ──────────────────────────────────────
  // NOTE: refetch happens AFTER the server write completes, not immediately,
  // to avoid the fetch racing with the write and overwriting optimistic state.

  /** Toggle all items in a group at once (single API call instead of N). */
  const batchToggleShoppingItems = useCallback((items: ListItem[], checked: boolean) => {
    if (items.length === 0) return
    const ids = items.map(i => i.id)
    setShoppingItems(prev => prev.map(i => ids.includes(i.id) ? { ...i, is_checked: checked } : i))
    if (isOnline) {
      supabase.from('items').update({ is_checked: checked }).in('id', ids).then(({ error }) => {
        if (error) {
          logError('batchToggleShoppingItems error:', error)
          // Rollback: restore original checked states
          setShoppingItems(prev => prev.map(i => {
            const orig = items.find(o => o.id === i.id)
            return orig ? { ...i, is_checked: orig.is_checked } : i
          }))
        }
        if (list) fetchItems(list.id, 'shopping')
      })
    } else {
      // Enqueue one op per item for offline (Supabase RLS needs per-row)
      for (const item of items) {
        enqueue({ type: 'update', table: 'items', payload: { is_checked: checked }, filterColumn: 'id', filterValue: item.id })
      }
    }
  }, [isOnline, enqueue, list, fetchItems])

  const toggleShoppingItem = useCallback((item: ListItem) => {
    const nextChecked = !item.is_checked
    setShoppingItems(prev => prev.map(i => i.id === item.id ? { ...i, is_checked: nextChecked } : i))
    // Aktivität: "abgehakt" sofort lokal melden (unabhängig vom Realtime-Echo der eigenen Aktion)
    if (nextChecked) {
      markOwnAction(`check:${item.name}`)
      publishActivity(`${spanishPhrase('check')} ${item.name} abgehakt`)
    }
    if (isOnline) {
      supabase.from('items').update({ is_checked: nextChecked }).eq('id', item.id).then(({ error }) => {
        if (error) {
          logError('toggleShoppingItem error:', error)
          setShoppingItems(prev => prev.map(i => i.id === item.id ? { ...i, is_checked: item.is_checked } : i))
        }
        // Refetch AFTER server write completes — prevents race with optimistic state
        if (list) fetchItems(list.id, 'shopping')
      })
    } else {
      enqueue({ type: 'update', table: 'items', payload: { is_checked: nextChecked }, filterColumn: 'id', filterValue: item.id })
    }
  }, [isOnline, enqueue, list, fetchItems])

  // ── Undo helper ─────────────────────────────────────────────────────
  // Undo-Stack (max. 5 Stufen): mehrere Löschungen hintereinander übernehmen
  // sich gegenseitig nicht mehr — jede Stufe hat ihren eigenen Ablauf-Timer
  // (5 s wie bisher), `undoDelete` nimmt die oberste (neueste) Stufe vom Stack.
  const withUndo = useCallback((items: ListItem[], listType: ListType, doAction: () => void) => {
    const id = ++undoSeqRef.current
    const entry: UndoEntry = {
      id,
      items,
      listType,
      // Eigener Ablauf-Timer je Stufe
      timeout: setTimeout(() => {
        if (undoStackRef.current.some(e => e.id === id)) {
          const next = undoStackRef.current.filter(e => e.id !== id)
          undoStackRef.current = next
          setUndoStack(next)
        }
      }, 5000),
    }
    // Max. 5 Stufen — bei Überlauf fallen die ältesten Stufen raus
    const base = undoStackRef.current.length >= 5
      ? undoStackRef.current.slice(undoStackRef.current.length - 4)
      : undoStackRef.current
    const next = [...base, entry]
    undoStackRef.current = next
    setUndoStack(next)
    // Execute the action
    doAction()
  }, [])

  const deleteShoppingItem = useCallback((item: ListItem) => {
    withUndo([item], 'shopping', () => {
      setShoppingItems(prev => prev.filter(i => i.id !== item.id))
      if (isOnline) {
        supabase.from('items').delete().eq('id', item.id).then(({ error }) => {
          if (error) {
            logError('deleteShoppingItem error:', error)
            // Rollback an der Originalposition (sort_order), nicht vorne
            setShoppingItems(prev => insertSortedBySortOrder(prev, [item]))
          }
          if (list) fetchItems(list.id, 'shopping')
        })
      } else {
        enqueue({ type: 'delete', table: 'items', payload: {}, filterColumn: 'id', filterValue: item.id })
      }
    })
  }, [withUndo, isOnline, enqueue, list, fetchItems])

  const undoDelete = useCallback(() => {
    const entry = undoStackRef.current[undoStackRef.current.length - 1]
    if (!entry) return
    if (entry.timeout) clearTimeout(entry.timeout)
    // Oberste (neueste) Stufe vom Stack nehmen — ältere Stufen bleiben machbar
    const next = undoStackRef.current.slice(0, -1)
    undoStackRef.current = next
    setUndoStack(next)
    // Items an ihrer ursprünglichen sort_order-Position wieder einfügen
    if (entry.listType === 'shopping') {
      setShoppingItems(prev => insertSortedBySortOrder(prev, entry.items))
    } else {
      setBringItems(prev => insertSortedBySortOrder(prev, entry.items))
    }
    // Re-insert the deleted items
    for (const item of entry.items) {
      if (isOnline) {
        supabase.from('items').insert(item as unknown as Record<string, unknown>).then(() => {
          if (list) fetchItems(list.id, entry.listType)
        })
      } else {
        enqueue({ type: 'insert', table: 'items', payload: item as unknown as Record<string, unknown> })
      }
    }
  }, [isOnline, enqueue, list, fetchItems])

  const toggleBringItem = useCallback((item: ListItem) => {
    const nextBrought = !item.is_brought
    setBringItems(prev => prev.map(i => i.id === item.id ? { ...i, is_brought: nextBrought } : i))
    // Aktivität: "als mitgebracht markiert" sofort lokal melden
    if (nextBrought) {
      markOwnAction(`brought:${item.name}`)
      publishActivity(`${spanishPhrase('check')} ${item.name} als mitgebracht markiert`)
    }
    if (isOnline) {
      supabase.from('items').update({ is_brought: nextBrought }).eq('id', item.id).then(({ error }) => {
        if (error) {
          logError('toggleBringItem error:', error)
          setBringItems(prev => prev.map(i => i.id === item.id ? { ...i, is_brought: item.is_brought } : i))
        }
        if (list) fetchItems(list.id, 'bring')
      })
    } else {
      enqueue({ type: 'update', table: 'items', payload: { is_brought: nextBrought }, filterColumn: 'id', filterValue: item.id })
    }
  }, [isOnline, enqueue, list, fetchItems])

  const deleteBringItem = useCallback((item: ListItem) => {
    setBringItems(prev => prev.filter(i => i.id !== item.id))
    if (isOnline) {
      supabase.from('items').delete().eq('id', item.id).then(({ error }) => {
        if (error) {
          logError('deleteBringItem error:', error)
          // Rollback an der Originalposition (sort_order), nicht vorne
          setBringItems(prev => insertSortedBySortOrder(prev, [item]))
        }
        if (list) fetchItems(list.id, 'bring')
      })
    } else {
      enqueue({ type: 'delete', table: 'items', payload: {}, filterColumn: 'id', filterValue: item.id })
    }
  }, [isOnline, enqueue, list, fetchItems])

  const reorderItems = useCallback(async (listType: ListType, newOrder: string[]) => {
    if (!list) return
    if (listType === 'shopping') {
      setShoppingItems(prev => {
        const map = new Map(prev.map(i => [i.id, i]))
        return newOrder.map((id, idx) => {
          const item = map.get(id)
          return item ? { ...item, sort_order: idx } : item!
        }).filter(Boolean)
      })
    } else {
      setBringItems(prev => {
        const map = new Map(prev.map(i => [i.id, i]))
        return newOrder.map((id, idx) => {
          const item = map.get(id)
          return item ? { ...item, sort_order: idx } : item!
        }).filter(Boolean)
      })
    }
    if (isOnline) {
      try {
        const { error } = await supabase.rpc('batch_reorder_items', { item_ids: newOrder })
        if (error) throw error
      } catch (e) {
        logError('reorderItems error:', e)
        // Rollback: Serverstand neu laden statt die optimistische Reihenfolge stehen zu lassen
        toast('Reihenfolge konnte nicht gespeichert werden.', 'error')
        if (list) fetchItems(list.id, listType)
        return
      }
    } else {
      enqueue({ type: 'rpc', table: '', payload: { item_ids: newOrder }, rpcName: 'batch_reorder_items' })
    }
    // Refetch only the affected list type (not all 8 tables)
    if (list) fetchItems(list.id, listType)
  }, [list, fetchItems, isOnline, enqueue, toast])

  const reorderNotes = useCallback(async (newOrder: string[]) => {
    if (!list) return
    // Optimistic update
    setNotes(prev => {
      const map = new Map(prev.map(n => [n.id, n]))
      return newOrder.map((id, idx) => {
        const note = map.get(id)
        return note ? { ...note, sort_order: idx } : note!
      }).filter(Boolean)
    })
    if (isOnline) {
      try {
        const { error } = await supabase.rpc('batch_reorder_notes', { note_ids: newOrder })
        if (error) throw error
      } catch (e) {
        logError('reorderNotes error:', e)
        // Rollback: Serverstand neu laden statt die optimistische Reihenfolge stehen zu lassen
        toast('Reihenfolge konnte nicht gespeichert werden.', 'error')
        if (list) fetchNotes(list.id)
        return
      }
    } else {
      enqueue({ type: 'rpc', table: '', payload: { note_ids: newOrder }, rpcName: 'batch_reorder_notes' })
    }
    if (list) fetchNotes(list.id)
  }, [list, fetchNotes, isOnline, enqueue, toast])

  const toggleNoteFavorite = useCallback(async (noteId: string) => {
    if (!list) return
    const { error } = await supabase.rpc('toggle_note_favorite', { note_id: noteId })
    if (error) {
      logError('toggleNoteFavorite error:', error)
      return
    }
    fetchAll(list.id, true)
  }, [list, fetchAll])

  // ── Derived values (pure functions from lib/derivedState) ──────────
  const shoppingCategories = useMemo(() => deriveCategoriesByType(categories, 'shopping'), [categories])
  const bringCategories = useMemo(() => deriveCategoriesByType(categories, 'bring'), [categories])

  const knownPersons = useMemo(() => deriveKnownPersons(userName, participants), [userName, participants])

  const userBalance = useMemo(
    () => deriveUserBalance(expenses, expenseSplits, settlements, userName),
    [expenses, expenseSplits, settlements, userName],
  )

  const expenseTotal = useMemo(() => deriveExpenseTotal(expenses), [expenses])

  const isAdmin = useMemo(() => deriveIsAdmin(participants, userName), [participants, userName])

  const checkedCount = useMemo(() => deriveCheckedCount(shoppingItems), [shoppingItems])

  // ── Join / Leave / Rename ──────────────────────────────────────────
  const handleJoin = useCallback(async (name: string, l: ShoppingList, pid: string) => {
    clearCacheForList(l.id)
    setUserName(name)
    setParticipantId(pid)
    setList(l)
    setIsLoading(true)
    fetchAll(l.id)
    const { data: fullList } = await supabase
      .from('lists')
      .select('*')
      .eq('id', l.id)
      .single()
    if (fullList) setList(fullList as ShoppingList)
  }, [fetchAll])

  const handleLeave = useCallback(() => {
    // Laufenden Realtime-Debounce stoppen und Pending-Tabellen leeren —
    // nach dem Listenwechsel darf kein alter Timer mehr Daten schreiben.
    if (realtimeDebounceRef.current) {
      clearTimeout(realtimeDebounceRef.current)
      realtimeDebounceRef.current = null
    }
    pendingRealtimeTablesRef.current.clear()
    if (list) clearCacheForList(list.id)
    localStorage.removeItem('user_name')
    localStorage.removeItem('participant_id')
    setUserName(null)
    setList(null)
    setParticipantId(null)
    setShoppingItems([])
    setBringItems([])
    setCategories([])
    setNotes([])
    setExpenses([])
    setExpenseSplits([])
    setExpenseQuotas([])
    setSettlements([])
    setParticipants([])
    setAdminUnlocked(false)
    undoStackRef.current = []
    setUndoStack([])
    prevShoppingItemsRef.current = []
    prevBringItemsRef.current = []
    resetNotifyBuffer()
  }, [list])

  const handleRename = useCallback(async (newName: string): Promise<string | null> => {
    const trimmed = newName.trim()
    if (!trimmed || !list || trimmed === userName) return null

    const { data, error } = await supabase.rpc('rename_participant', {
      p_list_id: list.id,
      p_old_name: userName,
      p_new_name: trimmed,
    })

    if (error || data?.error) {
      return data?.error || 'Fehler beim Umbenennen.'
    }

    // Die RPC legt einen neuen Participant an (neue id, is_admin übernommen).
    // Ohne das Nachziehen von participant_id scheitert restore_participant_session
    // beim nächsten Reload und change_participant_password danach.
    const newParticipantId = (data as { participant_id?: string } | null)?.participant_id
    if (newParticipantId) {
      localStorage.setItem('participant_id', newParticipantId)
      setParticipantId(newParticipantId)
    }

    localStorage.setItem('user_name', trimmed)
    setUserName(trimmed)
    fetchAll(list.id, true)
    return null
  }, [list, userName, fetchAll])

  return {
    // state
    userName,
    list,
    participantId,
    shoppingItems,
    bringItems,
    categories,
    notes,
    expenses,
    expenseSplits,
    expenseQuotas,
    settlements,
    participants,
    adminUnlocked,
    isLoading,
    undoState,
    // offline
    isOnline,
    queueLength,
    flushQueue,
    // derived
    isAdmin,
    shoppingCategories,
    bringCategories,
    knownPersons,
    userBalance,
    expenseTotal,
    checkedCount,
    // setters (needed by App.tsx for admin handlers)
    setUserName,
    setList,
    setAdminUnlocked,
    // fetch
    fetchAll,
    fetchItems,
    fetchCategories,
    fetchNotes,
    fetchExpenses,
    fetchParticipants,
    fetchExpenseQuotas,
    fetchSettlements,
    // mutations
    toggleShoppingItem,
    batchToggleShoppingItems,
    deleteShoppingItem,
    undoDelete,
    toggleBringItem,
    deleteBringItem,
    reorderItems,
    reorderNotes,
    toggleNoteFavorite,
    // join/leave/rename
    handleJoin,
    handleLeave,
    handleRename,
    // Aktivität
    onActivity,
  }
}