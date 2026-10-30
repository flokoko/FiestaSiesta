import { useSyncExternalStore } from 'react'
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
  /**
   * Insert mit vorläufiger id im UI (`temp-…`): hier steht die Temp-ID, damit
   * spätere update/delete-Ops beim Flush auf die echte UUID umgeschrieben
   * werden können.
   */
  clientId?: string
  timestamp: number
}

const STORAGE_KEY = 'offline_queue'
const LOCK_KEY = 'offline_queue_lock'
/**
 * „Dead Letter"-Ablage: Ops, die auch nach allen Retries scheitern, werden hier
 * abgelegt statt gelöscht. Früher verschwand z. B. eine offline angelegte
 * Ausgabe nach drei Fehlversuchen lautlos — der Nutzer sah nur „einige
 * Änderungen konnten nicht synchronisiert werden" und wusste nicht, welche.
 */
const DEAD_KEY = 'offline_queue_dead'
const DEAD_MAX = 20
const PING_INTERVAL_MS = 60_000
/** Gültigkeit des Cross-Tab-Flush-Locks; abgelaufene Locks werden ignoriert */
const LOCK_TTL_MS = 20_000

function loadQueue(): QueuedOp[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) as QueuedOp[] : []
  } catch {
    return []
  }
}

function saveQueue(queue: QueuedOp[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
  } catch (e) {
    // localStorage voll oder gesperrt (QuotaExceededError): darf nicht aus dem
    // Klick-Handler fliegen — Queue im Speicher weiterführen.
    console.error('saveQueue failed:', e)
  }
}

export interface DeadOp extends QueuedOp {
  /** Zeitpunkt des endgültigen Fehlschlags */
  failedAt: number
  /** letzte Fehlermeldung (für die Diagnose im UI) */
  error: string
}

function loadDeadOps(): DeadOp[] {
  try {
    const raw = localStorage.getItem(DEAD_KEY)
    return raw ? JSON.parse(raw) as DeadOp[] : []
  } catch {
    return []
  }
}

function saveDeadOps(ops: DeadOp[]) {
  try {
    localStorage.setItem(DEAD_KEY, JSON.stringify(ops.slice(-DEAD_MAX)))
  } catch {
    // ignore — Dead-Letter ist Diagnose, kein Muss-Pfad
  }
}

/** Gescheiterte Ops dauerhaft ablegen (statt sie zu löschen). */
function parkFailedOp(op: QueuedOp, error: unknown): void {
  const message = error instanceof Error
    ? error.message
    : (error && typeof error === 'object' && 'message' in error)
      ? String((error as { message: unknown }).message)
      : 'Unbekannter Fehler'
  const dead = loadDeadOps()
  dead.push({ ...op, failedAt: Date.now(), error: message.slice(0, 200) })
  saveDeadOps(dead)
}

/** Öffentlich: gescheiterte Änderungen ansehen (Diagnose / Support). */
export function getFailedOps(): DeadOp[] {
  return loadDeadOps()
}

/** Öffentlich: gescheiterte Änderungen verwerfen. */
export function clearFailedOps(): void {
  saveDeadOps([])
  failedCountState = 0
  notifyListeners()
}

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

// ── Modulweiter Zustand ────────────────────────────────────────────
// Existiert genau einmal pro Tab, nicht pro Hook-Instanz: ohne das flushen
// beim Reconnect mehrere Instanzen dieselbe localStorage-Queue gleichzeitig
// (doppelte Inserts) und jede Instanz zeigte eine andere queueLength.
let isOnlineState = navigator.onLine
let queueLengthState = loadQueue().length
let failedCountState = loadDeadOps().length
let isFlushing = false
let opIdCounter = 0
/** Einziger Ping-Timer des Tabs (wird beim ersten Abonnenten gestartet) */
let connectionInterval: ReturnType<typeof setInterval> | null = null
/** Timestamp des von diesem Tab gehaltenen Flush-Locks (null = keiner) */
let flushLockTs: number | null = null
const listeners = new Set<() => void>()

function getIsOnlineSnapshot(): boolean {
  return isOnlineState
}

function getQueueLengthSnapshot(): number {
  return queueLengthState
}

function getFailedCountSnapshot(): number {
  return failedCountState
}

/** Nach dem Ablegen eines gescheiterten Ops die Abonnenten informieren. */
function refreshFailedCount(): void {
  const next = loadDeadOps().length
  if (next === failedCountState) return
  failedCountState = next
  notifyListeners()
}

function notifyListeners(): void {
  for (const listener of listeners) {
    listener()
  }
}

/** Queue-Länge neu einlesen und Abonnenten informieren (nur bei Änderung). */
function refreshQueueLength(): void {
  const next = loadQueue().length
  if (next === queueLengthState) return
  queueLengthState = next
  notifyListeners()
}

/**
 * Ist der Fehler ein Verbindungsproblem (Netz weg, Timeout, abgebrochener
 * Fetch) und KEIN Serverbefall? Nur dann darf der Op in der Queue bleiben —
 * ein echter Postgrest-Fehler (RLS, Constraint, gelöschte Zeile) würde sonst
 * die Queue ewig blockieren.
 */
function isNetworkFailure(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  if (e instanceof DOMException && (e.name === 'AbortError' || e.name === 'TimeoutError')) return true
  if (e instanceof TypeError) return true // fetch failed / Failed to fetch
  const anyE = e as { code?: unknown; status?: unknown; message?: unknown } | null
  if (anyE && (typeof anyE.code === 'string' || typeof anyE.status === 'number')) return false
  const msg = String((anyE?.message as string) ?? '')
  return /network|failed to fetch|load failed|timeout|zeitlimit|abort/i.test(msg)
}

/** Ausführen eines Ops; Inserts geben die neue Zeilen-id zurück (Temp-ID-Mapping). */
async function executeOp(op: QueuedOp): Promise<string | null> {
  if (op.type === 'rpc') {
    const { error } = await supabase.rpc(op.rpcName!, op.payload)
    if (error) throw error
    return null
  } else if (op.type === 'insert') {
    // select('id') kostet nichts extra und liefert die echte UUID: Offline-Insert
    // und späteres Häkchen/Löschen auf dieselbe Zeile hängen daran.
    const { data, error } = await supabase.from(op.table).insert(op.payload).select('id').maybeSingle()
    if (error) throw error
    const id = (data as { id?: string } | null)?.id
    return typeof id === 'string' ? id : null
  } else if (op.type === 'update') {
    // filterValue als Array = Sammel-Update (eine Runde statt N): 30 abgehakte
    // Gruppen-Artikel waren vorher 30 Requests à ≥1 RTT.
    const query = supabase.from(op.table).update(op.payload)
    const { error } = Array.isArray(op.filterValue)
      ? await query.in(op.filterColumn!, op.filterValue)
      : await query.eq(op.filterColumn!, op.filterValue!)
    if (error) throw error
  } else if (op.type === 'delete') {
    const query = supabase.from(op.table).delete()
    const { error } = Array.isArray(op.filterValue)
      ? await query.in(op.filterColumn!, op.filterValue)
      : await query.eq(op.filterColumn!, op.filterValue!)
    if (error) throw error
  }
  return null
}

/**
 * Ersetzt in der Queue alle Verweise auf eine Temp-ID (`temp-…`) durch die
 * echte UUID, sobald der zugehörige Insert durch ist. Ohne das scheiterten
 * Häkchen und Löschen offline angelegter Zeilen an der uuid-Spalte (22P02).
 */
function remapTempId(table: string, tempId: string, realId: string): void {
  const queue = loadQueue()
  let changed = false
  const next = queue.map((q) => {
    if (q.table !== table) return q
    const values = Array.isArray(q.filterValue) ? q.filterValue : null
    if (q.filterValue === tempId) {
      changed = true
      return { ...q, filterValue: realId }
    }
    if (values && values.includes(tempId)) {
      changed = true
      return { ...q, filterValue: values.map(v => (v === tempId ? realId : v)) }
    }
    return q
  })
  if (changed) saveQueue(next)
}

/**
 * Cross-Tab-Lock holen: frischer (< LOCK_TTL_MS) Lock eines anderen Tabs
 * blockiert, abgelaufene Locks werden ignoriert und überschrieben.
 */
function acquireFlushLock(): boolean {
  try {
    const raw = localStorage.getItem(LOCK_KEY)
    if (raw) {
      const ts = Number(raw)
      if (!Number.isNaN(ts) && Date.now() - ts < LOCK_TTL_MS) {
        return false
      }
    }
    flushLockTs = Date.now()
    localStorage.setItem(LOCK_KEY, String(flushLockTs))
    return true
  } catch {
    // Ohne funktionsfähiges localStorage weitermachen, nicht blockieren
    return true
  }
}

function releaseFlushLock(): void {
  if (flushLockTs === null) return
  try {
    // Nur löschen, wenn der Lock noch unserer ist (könnte zwischenzeitlich
    // von einem anderen Tab übernommen worden sein)
    if (localStorage.getItem(LOCK_KEY) === String(flushLockTs)) {
      localStorage.removeItem(LOCK_KEY)
    }
  } catch {
    // ignore
  } finally {
    flushLockTs = null
  }
}

/**
 * Queue abarbeiten. Läuft höchstens einmal gleichzeitig pro Tab (isFlushing)
 * und höchstens einmal tab-übergreifend (localStorage-Lock). Parallele
 * Aufrufe werden sofort mit { success: 0, failed: 0 } quittiert.
 */
async function flushQueue(): Promise<{ success: number; failed: number }> {
  if (isFlushing) return { success: 0, failed: 0 }
  if (loadQueue().length === 0) return { success: 0, failed: 0 }
  if (!acquireFlushLock()) return { success: 0, failed: 0 }
  isFlushing = true

  let success = 0
  let failed = 0
  try {
    // Queue je Iteration neu einlesen und den verarbeiteten Op gezielt per
    // id entfernen: Ops, die während des Flushes (gleicher oder anderer Tab)
    // zusätzlich eingereiht werden, gehen so nicht verloren.
    for (;;) {
      // Flush-Lock erneuern: ein langer Flush (> LOCK_TTL_MS) darf nicht von
      // einem zweiten Tab übernommen werden, der sonst parallel flusht und
      // doppelte Inserts erzeugt.
      try {
        flushLockTs = Date.now()
        localStorage.setItem(LOCK_KEY, String(flushLockTs))
      } catch {
        // ignore
      }
      const queue = loadQueue()
      const op = queue[0]
      if (!op) break

      let opError = false
      let lastError: unknown = null
      let insertedId: string | null = null
      try {
        insertedId = await executeOp(op)
      } catch (firstError) {
        lastError = firstError
        // Verbindungsproblem: nicht weiterprobieren, nicht parken, Queue
        // unangetastet lassen. Der nächste Ping versucht es erneut.
        if (isNetworkFailure(firstError)) {
          break
        }
        // Retry mit exponentiellem Backoff (max 3 Versuche insgesamt)
        let retries = 0
        while (retries < 2) {
          retries++
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, retries - 1)))
          try {
            insertedId = await executeOp(op)
            lastError = null
            break // Erfolg
          } catch (e) {
            lastError = e
            if (isNetworkFailure(e)) break
          }
        }
        if (lastError && isNetworkFailure(lastError)) {
          // Nach einem Netzbruch mitten im Retry: Op bleibt vorne in der Queue.
          break
        }
        if (lastError) {
          opError = true
        }
      }

      // Nach Erfolg oder endgültigem Fehlschlag den Op aus der Queue entfernen.
      // Ein dauerhaft scheiternder Op (z. B. RLS-Fehler, inzwischen gelöschte
      // Zeile) darf die restliche Queue NICHT blockieren — sonst würden alle
      // nachfolgenden Änderungen nie synchronisiert. Er wird aber nicht mehr
      // stillschweigend verworfen, sondern in der Dead-Letter-Ablage geparkt.
      if (!opError && insertedId && op.clientId) {
        remapTempId(op.table, op.clientId, insertedId)
      }

      const remaining = loadQueue().filter(q => q.id !== op.id)
      saveQueue(remaining)
      if (opError) {
        parkFailedOp(op, lastError ?? 'Unbekannter Fehler')
        failed++
      } else {
        success++
      }
    }
  } finally {
    isFlushing = false
    releaseFlushLock()
    refreshQueueLength()
    refreshFailedCount()
  }
  return { success, failed }
}

/**
 * Op in die localStorage-Queue schreiben und ALLE Abonnenten informieren,
 * damit queueLength überall (auch im Offline-Banner) identisch ist.
 */
function enqueueOp(op: Omit<QueuedOp, 'id' | 'timestamp'>): void {
  const fullOp: QueuedOp = {
    ...op,
    id: `op-${++opIdCounter}-${Date.now()}`,
    timestamp: Date.now(),
  }
  const queue = loadQueue()

  // Dedup: für update/delete mit gleicher ID, ersetze letzten Eintrag
  if (op.type === 'update' || op.type === 'delete') {
    const existingIdx = queue.findIndex(
      q => q.type === op.type && q.filterColumn === op.filterColumn && JSON.stringify(q.filterValue) === JSON.stringify(op.filterValue)
    )
    if (existingIdx !== -1) {
      queue[existingIdx] = fullOp
      saveQueue(queue)
      return // Länge ändert sich nicht → kein Notify nötig
    }
  }

  queue.push(fullOp)
  saveQueue(queue)
  refreshQueueLength()
}

/**
 * Verbindungsstatus setzen; Auto-Flush genau einmal beim Übergang
 * offline→online, wenn die Queue nicht leer ist.
 */
function applyConnectivity(connected: boolean): void {
  if (connected === isOnlineState) return
  isOnlineState = connected
  notifyListeners()
  if (connected && loadQueue().length > 0) {
    flushQueue().catch(() => {
      // Auto-Flush-Fehler bewusst ignorieren — der nächste Ping versucht es
      // erneut; verlorene Rejections vermeiden, da fire-and-forget.
    })
  }
}

async function pingConnectivity(): Promise<void> {
  const connected = await checkConnectivity()
  applyConnectivity(connected)
}

// ── Ein Verbindungswatch für den ganzen Tab ────────────────────────
const onWindowOnline = () => {
  // Sofortiger Ping, sobald der Browser „online" meldet — navigator.onLine
  // allein garantiert keine echte Verbindung, deshalb echt prüfen.
  void pingConnectivity()
}

const onWindowOffline = () => {
  // „offline" ist definitiv — hier ist kein Ping nötig.
  applyConnectivity(false)
}

const onVisibilityChange = () => {
  if (document.visibilityState === 'visible') void pingConnectivity()
}

const onStorage = (event: StorageEvent) => {
  // Anderer Tab hat Queue oder Lock verändert → eigene Queue-Länge nachziehen
  if (event.key === null || event.key === STORAGE_KEY || event.key === LOCK_KEY) {
    refreshQueueLength()
  }
}

function startConnectionWatch(): void {
  if (connectionInterval !== null) return
  connectionInterval = setInterval(() => {
    // Nur im Vordergrund pingen — im Hintergrund ist das Ergebnis meist
    // veraltet, während visibilitychange ohnehin sofort pinget.
    if (document.visibilityState === 'visible') void pingConnectivity()
  }, PING_INTERVAL_MS)
  window.addEventListener('online', onWindowOnline)
  window.addEventListener('offline', onWindowOffline)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('storage', onStorage)
  // Queues aus anderen Tabs übernehmen und navigator.onLine korrigieren
  refreshQueueLength()
  if (document.visibilityState === 'visible') void pingConnectivity()
}

function stopConnectionWatch(): void {
  if (connectionInterval === null) return
  clearInterval(connectionInterval)
  connectionInterval = null
  window.removeEventListener('online', onWindowOnline)
  window.removeEventListener('offline', onWindowOffline)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('storage', onStorage)
}

/** Abonnement für useSyncExternalStore; Loop läuft nur, solange wer lauscht. */
function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) startConnectionWatch()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) stopConnectionWatch()
  }
}

/**
 * Offline-Queue als Modul-Singleton: der Zustand (isOnline, isFlushing,
 * queueLength) existiert einmal pro Tab — der Hook koppelt die Komponenten
 * nur per useSyncExternalStore an. Dadurch zeigen alle Aufrufer dieselbe
 * Queue-Länge und es wird nie doppelt geflusht.
 */
export function useOfflineQueue(): {
  isOnline: boolean
  enqueue: (op: Omit<QueuedOp, 'id' | 'timestamp'>) => void
  flushQueue: () => Promise<{ success: number; failed: number }>
  queueLength: number
  /** Änderungen, die endgültig nicht gesendet werden konnten (Dead Letter) */
  failedCount: number
} {
  const isOnline = useSyncExternalStore(subscribe, getIsOnlineSnapshot)
  const queueLength = useSyncExternalStore(subscribe, getQueueLengthSnapshot)
  const failedCount = useSyncExternalStore(subscribe, getFailedCountSnapshot)
  return {
    isOnline,
    enqueue: enqueueOp,
    flushQueue,
    queueLength,
    failedCount,
  }
}