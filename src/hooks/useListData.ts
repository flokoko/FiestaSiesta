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
import { closeAllRealtimeChannels } from '../lib/realtimeBus'
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
  const { isOnline, enqueue, flushQueue, queueLength, failedCount } = useOfflineQueue()

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
  // true, solange eine gespeicherte Sitzung wiederhergestellt wird. Ohne das
  // rendert App zuerst den Login (userName/list sind null) und der Nutzer sieht
  // bei jedem Start kurz den Anmelde-Screen, obwohl er angemeldet ist.
  const [restoringSession, setRestoringSession] = useState(() => {
    if (typeof localStorage === 'undefined') return false
    return !!localStorage.getItem('participant_id') && !!localStorage.getItem('user_name')
  })

  // ── Fetch guard for realtime sync debounce ─────────────────────────
  const isFetchingRef = useRef(false)

  // ── Mindestalter zwischen automatischen visibilitychange-Refetches ──
  const lastFetchAllRef = useRef(0)

  // ── Realtime debounce: accumulate changed tables, refetch once ──────
  const pendingRealtimeTablesRef = useRef<Set<string>>(new Set())

  // Welche Item-Liste (shopping/bring) hat sich geändert? Erspart den zweiten Refetch.

  const pendingItemTypesRef = useRef<Set<string>>(new Set())
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
        // NICHT die frischen Ausgaben mit alten Splits mischen: eine gerade
        // angelegte Ausgabe hätte dann keinen Anteil und würde allein dem
        // Zahler angelastet. Lieber den bisherigen (konsistenten) Stand
        // stehen lassen — der nächste Fetch/Realtime-Event korrigiert ihn.
        return
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
      if (mySeq === fetchSeqsRef.current['expense_quotas']) {
        const cached = readCache<ExpenseQuota[]>(listId, 'expense_quotas')
        if (cached) setExpenseQuotas(cached)
      }
      return
    }
    // Race guard: ein älterer Response darf einen neueren nie überschreiben
    if (mySeq !== fetchSeqsRef.current['expense_quotas']) return
    const quotaData = (data || []) as ExpenseQuota[]
    writeCache(listId, 'expense_quotas', quotaData)
    setExpenseQuotas(quotaData)
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
      if (mySeq === fetchSeqsRef.current['settlements']) {
        const cached = readCache<Settlement[]>(listId, 'settlements')
        if (cached) setSettlements(cached)
      }
      return
    }
    // Race guard: ein älterer Response darf einen neueren nie überschreiben
    if (mySeq !== fetchSeqsRef.current['settlements']) return
    const settleData = (data || []) as Settlement[]
    writeCache(listId, 'settlements', settleData)
    setSettlements(settleData)
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
  // Realtime läuft seit v0.37.0 über den Broadcast-Trigger; wenn die
  // WebSocket-Verbindung hängt (Suspend, offline, Netzwechsel), kommt trotzdem
  // nichts an. Deshalb zusätzlich: beim Sichtbarwerden, bei zurückkommendem
  // Netz und in einem ruhigen 90-Sekunden-Takt nachladen. Ohne force → kein
  // Ladebalken, der Guard verhindert Doppel-Fetches.
  useEffect(() => {
    if (!list) return
    const refetch = () => { fetchAll(list.id) }
    const onVisible = () => {
      // Mindestalter: Rückkehr in die App löst sonst bei jedem Sichtbarkeits-
      // wechsel 8 Queries aus — erst ab 30 s seit dem letzten Lauf neu laden.
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastFetchAllRef.current < 30_000) return
      lastFetchAllRef.current = Date.now()
      refetch()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', refetch)
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      refetch()
    }, 90_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', refetch)
      window.clearInterval(timer)
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
    if (table === 'items') {
      const lt = (payload?.new?.list_type ?? payload?.old?.list_type) as string | undefined
      if (lt === 'shopping' || lt === 'bring') pendingItemTypesRef.current.add(lt)
    }
    if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
    realtimeDebounceRef.current = setTimeout(() => {
      const tables = pendingRealtimeTablesRef.current
      const lid = list.id
      if (tables.has('items')) {
        // Nur die betroffene Liste nachladen (der Payload nennt list_type);
        // unbekannt → beide, damit nichts verpasst wird.
        const types = pendingItemTypesRef.current
        if (types.size === 0) {
          fetchItems(lid, 'shopping')
          fetchItems(lid, 'bring')
        } else {
          for (const t of types) fetchItems(lid, t as ListType)
        }
        types.clear()
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
  // Hält die aktuelle Liste lokal, damit die App auch ohne jede Verbindung
  // starten kann (siehe Offline-Zweig unten).
  useEffect(() => {
    try {
      if (list) localStorage.setItem('fs_current_list', JSON.stringify(list))
    } catch {
      // localStorage voll — der Offline-Start fällt dann auf den Login zurück
    }
  }, [list])

  /**
   * Sitzung ohne Netz aus dem lokalen Spiegel aufbauen. Genau der Urlaubsfall:
   * installierte PWA, kein Empfang, aber alle Tabellen liegen als Read-Cache
   * (readCache) auf dem Gerät. Vorher landete man stattdessen im Login-Screen,
   * der selbst einen RPC braucht — die App war offline komplett unbenutzbar.
   */
  const hydrateFromCache = useCallback((listId: string) => {
    const cached = <T,>(table: string, set: (value: T) => void) => {
      const value = readCache<T>(listId, table)
      if (value) set(value)
    }
    cached<ListItem[]>('shopping_items', setShoppingItems)
    cached<ListItem[]>('bring_items', setBringItems)
    cached<ItemCategory[]>('categories', setCategories)
    cached<QuickNote[]>('notes', setNotes)
    cached<Expense[]>('expenses', setExpenses)
    cached<ExpenseSplit[]>('expense_splits', setExpenseSplits)
    cached<Participant[]>('participants', setParticipants)
    cached<ExpenseQuota[]>('expense_quotas', setExpenseQuotas)
    cached<Settlement[]>('settlements', setSettlements)
  }, [])

  useEffect(() => {
    const savedName = localStorage.getItem('user_name')
    const savedParticipantId = localStorage.getItem('participant_id')
    if (!savedName || !savedParticipantId) {
      setRestoringSession(false)
      return
    }

    let cancelled = false
    // Sicherheitsnetz: hängt die Wiederherstellung (offline, langsames Netz),
    // kommt nach 6 s die App statt eines ewigen Splashs.
    const guard = window.setTimeout(() => {
      if (!cancelled) setRestoringSession(false)
    }, 6000)

    /** Offline-Start versuchen; false = kein lokaler Listen-Spiegel vorhanden. */
    const startOffline = (): boolean => {
      let cachedList: ShoppingList | null = null
      try {
        const raw = localStorage.getItem('fs_current_list')
        if (raw) cachedList = JSON.parse(raw) as ShoppingList
      } catch {
        cachedList = null
      }
      if (!cachedList) return false
      setUserName(savedName)
      setParticipantId(savedParticipantId)
      setList(cachedList)
      hydrateFromCache(cachedList.id)
      setIsLoading(false)
      setRestoringSession(false)
      return true
    }

    // Ohne Netz nicht erst 12 s auf den Timeout warten.
    if (!navigator.onLine && startOffline()) {
      window.clearTimeout(guard)
      return () => {
        cancelled = true
        window.clearTimeout(guard)
      }
    }

    restoreParticipantSession(savedParticipantId)
      .then((result) => {
        if (cancelled) return
        if (result.error || !result.list_id) {
          // Netz-/Serverfehler: lokal weiterarbeiten statt Login zu zeigen.
          if (!startOffline()) setRestoringSession(false)
          return
        }
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
            if (cancelled) return
            setRestoringSession(false)
            if (error || !data) {
              setIsLoading(false)
              // Liste wirklich gelöscht (kein Netzfehler) → Sitzung verwerfen
              if (!error) {
                localStorage.removeItem('user_name')
                localStorage.removeItem('participant_id')
                localStorage.removeItem('fs_current_list')
              }
              return
            }
            setList(data as ShoppingList)
            fetchAll(result.list_id, true)
          })
          .catch(() => {
            if (cancelled) return
            setIsLoading(false)
            if (!startOffline()) setRestoringSession(false)
          })
          .finally(() => window.clearTimeout(guard))
      })
      .catch(() => {
        if (cancelled) return
        if (!startOffline()) setRestoringSession(false)
      })

    return () => {
      cancelled = true
      window.clearTimeout(guard)
    }
  }, [fetchAll, hydrateFromCache])

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
      })
    } else {
      // EIN Op mit .in(id-Liste): beim Flush ein Request statt einer pro Artikel.
      enqueue({ type: 'update', table: 'items', payload: { is_checked: checked }, filterColumn: 'id', filterValue: ids })
    }
  }, [isOnline, enqueue])

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
      })
    } else {
      enqueue({ type: 'update', table: 'items', payload: { is_checked: nextChecked }, filterColumn: 'id', filterValue: item.id })
    }
  }, [isOnline, enqueue])

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
        })
      } else {
        enqueue({ type: 'delete', table: 'items', payload: {}, filterColumn: 'id', filterValue: item.id })
      }
    })
  }, [withUndo, isOnline, enqueue])

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
      })
    } else {
      enqueue({ type: 'update', table: 'items', payload: { is_brought: nextBrought }, filterColumn: 'id', filterValue: item.id })
    }
  }, [isOnline, enqueue])

  const deleteBringItem = useCallback((item: ListItem) => {
    setBringItems(prev => prev.filter(i => i.id !== item.id))
    if (isOnline) {
      supabase.from('items').delete().eq('id', item.id).then(({ error }) => {
        if (error) {
          logError('deleteBringItem error:', error)
          // Rollback an der Originalposition (sort_order), nicht vorne
          setBringItems(prev => insertSortedBySortOrder(prev, [item]))
        }
      })
    } else {
      enqueue({ type: 'delete', table: 'items', payload: {}, filterColumn: 'id', filterValue: item.id })
    }
  }, [isOnline, enqueue])

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
    // Nur Notizen: ein Boolean-Toggle braucht keine 8 Tabellen-Abfragen.
    fetchNotes(list.id)
  }, [list, fetchNotes])

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
    // force: der Guard eines noch laufenden Fetches der ALTEN Liste darf den
    // ersten Ladevorgang der neuen Liste nicht verschlucken (leere Listen bis
    // zum nächsten Realtime-Event). Die seq-Guards verwerfen die alte Antwort.
    fetchAll(l.id, true)
    // Kein extra Listen-Query: JoinScreen hat `l` bereits vollständig geladen,
    // ein zweiter Roundtrip auf dem Anmelde-Pfad bringt nichts.
  }, [fetchAll])

  const handleLeave = useCallback(() => {
    // Laufenden Realtime-Debounce stoppen und Pending-Tabellen leeren —
    // nach dem Listenwechsel darf kein alter Timer mehr Daten schreiben.
    if (realtimeDebounceRef.current) {
      clearTimeout(realtimeDebounceRef.current)
      realtimeDebounceRef.current = null
    }
    pendingRealtimeTablesRef.current.clear()
    // Ohne Reset bleibt ein evtl. noch laufender Fetch als „läuft" markiert und
    // der nächste Join lädt gar nicht erst.
    isFetchingRef.current = false
    // Realtime-Kanal der alten Liste schließen — sonst hört die abgemeldete
    // Sitzung weiter mit und hält eine WebSocket-Verbindung offen.
    closeAllRealtimeChannels()
    if (list) clearCacheForList(list.id)
    localStorage.removeItem('user_name')
    localStorage.removeItem('participant_id')
    localStorage.removeItem('fs_current_list')
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
    restoringSession,
    undoState,
    // offline
    isOnline,
    queueLength,
    failedCount,
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