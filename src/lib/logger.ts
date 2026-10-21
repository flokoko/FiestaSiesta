// Einfaches Error-Logging ohne externe Dependencies
// Erweitert console.error um strukturierte Logs
// Batch-Write: Einträge werden gebuffert und alle 1s kombiniert geschrieben

type LogLevel = 'info' | 'warn' | 'error'

interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  data?: unknown
  stack?: string
}

const MAX_LOGS = 50
const STORAGE_KEY = 'app_logs'

// ── Buffer for batched writes ────────────────────────────────────────
let logBuffer: LogEntry[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function getLogs(): LogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function flushBuffer() {
  flushTimer = null
  if (logBuffer.length === 0) return
  try {
    const existing = getLogs()
    const combined = [...existing, ...logBuffer].slice(-MAX_LOGS)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(combined))
  } catch {
    // localStorage full — ignore
  }
  logBuffer = []
}

function scheduleFlush() {
  if (flushTimer !== null) return
  flushTimer = setTimeout(flushBuffer, 1000)
}

function addLog(entry: LogEntry) {
  logBuffer.push(entry)
  scheduleFlush()
}

export function logError(message: string, data?: unknown) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: 'error',
    message,
    data,
    stack: new Error().stack,
  }
  console.error(`[${entry.timestamp}] ${message}`, data)
  addLog(entry)
}

export function logWarn(message: string, data?: unknown) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: 'warn',
    message,
    data,
  }
  console.warn(`[${entry.timestamp}] ${message}`, data)
  addLog(entry)
}

export function getErrorLogs(): LogEntry[] {
  // Flush pending buffer first so the returned logs are up to date
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushBuffer()
  }
  return getLogs()
}

export function clearErrorLogs() {
  logBuffer = []
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  localStorage.removeItem(STORAGE_KEY)
}