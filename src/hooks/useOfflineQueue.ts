import { useState, useCallback, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

export interface QueuedOp {
  id: string
  type: 'insert' | 'update' | 'delete' | 'rpc'
  table: string
  payload: Record<string, unknown>
  /** For update/delete: the filter column (usually 'id') */
  filterColumn?: string
  /** For update/delete: the filter value */
  filterValue?: string | string[]
  /** For rpc: the rpc function name */
  rpcName?: string
  timestamp: number
}

const STORAGE_KEY = 'offline_queue'

function loadQueue(): QueuedOp[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) as QueuedOp[] : []
  } catch {
    return []
  }
}

function saveQueue(queue: QueuedOp[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
}

let opIdCounter = 0

/**
 * Ping Supabase to verify real connectivity.
 * Returns true if the server responds, false otherwise.
 */
async function checkConnectivity(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const { error } = await supabase.from('participants').select('id').limit(1).abortSignal(controller.signal).maybeSingle()
    clearTimeout(timeout)
    return !error
  } catch {
    return false
  }
}

export function useOfflineQueue() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [queueLength, setQueueLength] = useState(() => loadQueue().length)
  const isFlushingRef = useRef(false)

  // Track online/offline status via browser events + periodic ping
  useEffect(() => {
    const handleOnline = () => {
      // Browser says online — verify with a real ping before trusting it
      checkConnectivity().then((connected) => {
        if (connected) setIsOnline(true)
      })
    }
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Periodic connectivity check every 60s — catches false offline
    const pingInterval = setInterval(async () => {
      const connected = await checkConnectivity()
      setIsOnline(connected)
    }, 60_000)

    // Also run an initial ping to correct a potentially wrong navigator.onLine
    checkConnectivity().then((connected) => {
      if (connected !== navigator.onLine) {
        setIsOnline(connected)
      }
    })

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      clearInterval(pingInterval)
    }
  }, [])

  const updateQueueLength = useCallback(() => {
    setQueueLength(loadQueue().length)
  }, [])

  const flushQueue = useCallback(async (): Promise<{ success: number; failed: number }> => {
    if (isFlushingRef.current) return { success: 0, failed: 0 }
    isFlushingRef.current = true

    let success = 0
    let failed = 0

    const executeOp = async (op: QueuedOp): Promise<void> => {
      if (op.type === 'rpc') {
        const { error } = await supabase.rpc(op.rpcName!, op.payload)
        if (error) throw error
      } else if (op.type === 'insert') {
        const { error } = await supabase.from(op.table).insert(op.payload)
        if (error) throw error
      } else if (op.type === 'update') {
        const { error } = await supabase
          .from(op.table)
          .update(op.payload)
          .eq(op.filterColumn!, op.filterValue!)
        if (error) throw error
      } else if (op.type === 'delete') {
        const { error } = await supabase
          .from(op.table)
          .delete()
          .eq(op.filterColumn!, op.filterValue!)
        if (error) throw error
      }
    }

    try {
      let queue = loadQueue()

      while (queue.length > 0) {
        const op = queue[0]
        let opError = false

        try {
          await executeOp(op)
        } catch {
          // Retry mit exponentiellem Backoff (max 3 Versuche insgesamt)
          let retries = 0
          let lastError: unknown = null
          while (retries < 2) {
            retries++
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, retries - 1)))
            try {
              await executeOp(op)
              lastError = null
              break // Erfolg
            } catch (e) {
              lastError = e
            }
          }
          if (lastError) {
            opError = true
          }
        }

        // Nach Erfolg oder endgültigem Fehlschlag den Op aus der Queue entfernen.
        // Ein dauerhaft scheiternder Op (z.B. RLS-Fehler, inzwischen gelöschte Zeile)
        // darf die restliche Queue NICHT blockieren — sonst würden alle nachfolgenden
        // Änderungen nie synchronisiert. Der fehlgeschlagene Op geht verloren, aber
        // der Rest der Queue wird zuverlässig abgearbeitet.
        if (opError) {
          failed++
        } else {
          success++
        }
        queue = queue.slice(1)
        saveQueue(queue)
      }

      updateQueueLength()
      return { success, failed }
    } finally {
      isFlushingRef.current = false
    }
  }, [updateQueueLength])

  const enqueue = useCallback((op: Omit<QueuedOp, 'id' | 'timestamp'>) => {
    const fullOp: QueuedOp = {
      ...op,
      id: `op-${++opIdCounter}-${Date.now()}`,
      timestamp: Date.now(),
    }
    let queue = loadQueue()

    // Dedup: für update/delete mit gleicher ID, ersetze letzten Eintrag
    if (op.type === 'update' || op.type === 'delete') {
      const existingIdx = queue.findIndex(
        q => q.type === op.type && q.filterColumn === op.filterColumn && q.filterValue === op.filterValue
      )
      if (existingIdx !== -1) {
        queue[existingIdx] = fullOp
        saveQueue(queue)
        updateQueueLength()
        return
      }
    }

    queue.push(fullOp)
    saveQueue(queue)
    updateQueueLength()
  }, [updateQueueLength])

  // Auto-flush when coming back online
  useEffect(() => {
    if (isOnline && loadQueue().length > 0) {
      flushQueue()
    }
  }, [isOnline, flushQueue])

  return {
    isOnline,
    enqueue,
    flushQueue,
    queueLength,
  }
}