// ── Batched notification module ────────────────────────────────────
// Collects notification "events" and flushes them as ONE consolidated
// notification after a short debounce window (~2 seconds). This prevents
// notification spam during a big shopping run where many items are
// toggled or added in quick succession.
//
// Delivery priority:
//   1. If a real push subscription exists (localStorage flag + VAPID
//      configured), try the Edge Function via supabase.functions.invoke.
//   2. Fallback: native Notification API.
//
// Notifications are only delivered when the tab is hidden (document.hidden
// === true) — the user sees changes live when the app is visible.

import { supabase, getJoinCode } from './supabase'
import { isPushConfigured } from './push'

// ── Types ──────────────────────────────────────────────────────────

interface NotifyEvent {
  type: string
  label: string
  count: number
}

interface NotifyBuffer {
  events: NotifyEvent[]
  timer: ReturnType<typeof setTimeout> | null
}

// ── Module-level state ─────────────────────────────────────────────

const buffer: NotifyBuffer = {
  events: [],
  timer: null,
}

let notifyListId: string | null = null
let notifyUserName: string | null = null

const DEBOUNCE_MS = 2000
const NOTIFICATION_TAG = 'fiesta-batch'

// ── Public API ─────────────────────────────────────────────────────

/**
 * Set the current list ID, used when invoking the Edge Function.
 */
export function setNotifyListId(listId: string | null): void {
  notifyListId = listId
}

/**
 * Set the current user name. The Edge Function body includes this as
 * `exclude` so the server side can skip the actor's subscription.
 * (Callers also guard at the call site — only notifying on changes
 *  made by others — so this is a secondary safety net.)
 */
export function setNotifyUserName(name: string | null): void {
  notifyUserName = name
}

/**
 * Add a notification event to the buffer.
 *
 * Events with the same `type` + `label` are merged (count is incremented).
 * Starts (or restarts) the debounce timer. When the timer fires,
 * `flushNotifications()` is called automatically.
 *
 * @param type   Event type (e.g. 'new_shopping', 'checked_shopping')
 * @param label  Human-readable label (German), e.g. 'neue Items in der Einkaufsliste'
 * @param count  How many items this event represents (default 1)
 */
export function notifyEvent(type: string, label: string, count = 1): void {
  // Merge into existing event with same type+label
  const existing = buffer.events.find(
    (e) => e.type === type && e.label === label,
  )
  if (existing) {
    existing.count += count
  } else {
    buffer.events.push({ type, label, count })
  }

  // (Re)start debounce timer
  if (buffer.timer) {
    clearTimeout(buffer.timer)
  }
  buffer.timer = setTimeout(() => {
    flushNotifications()
  }, DEBOUNCE_MS)
}

/**
 * Build a human-readable German summary line for a single event.
 */
function formatEventLine(event: NotifyEvent): string {
  const n = event.count
  switch (event.type) {
    case 'new_shopping':
      return `🛒 ${n} neue${n === 1 ? 's' : ''} Item${n === 1 ? '' : 's'}`
    case 'new_bring':
      return `🎒 ${n} neue${n === 1 ? 's' : ''} Mitbring-Item${n === 1 ? '' : 's'}`
    case 'checked_shopping':
      return `✅ ${n} abgehakt`
    case 'unchecked_shopping':
      return `↩️ ${n} wieder offen`
    case 'brought':
      return `📦 ${n} als mitgebracht markiert`
    case 'unbrought':
      return `↩️ ${n} nicht mehr mitgebracht`
    default:
      return `${event.label}: ${n}`
  }
}

/**
 * Flush the buffer: build a consolidated notification body and deliver it.
 *
 * Delivery is skipped if:
 *   - The buffer is empty.
 *   - The tab is visible (document.hidden === false).
 *
 * Delivery strategy (in priority order):
 *   1. Edge Function via supabase.functions.invoke('send-push', ...)
 *      — only if push is enabled AND VAPID is configured.
 *   2. Native Notification API (fallback).
 *
 * The buffer is cleared after flushing regardless of delivery outcome.
 */
export function flushNotifications(): void {
  // Clear timer reference
  if (buffer.timer) {
    clearTimeout(buffer.timer)
    buffer.timer = null
  }

  // Nothing to send
  if (buffer.events.length === 0) return

  // Don't notify the user who is actively looking at the app
  if (typeof document !== 'undefined' && !document.hidden) {
    buffer.events = []
    return
  }

  // Build the notification content
  const lines = buffer.events.map(formatEventLine)
  const body = lines.join('\n')
  const title =
    buffer.events.length === 1
      ? 'Fiesta Siesta'
      : `Fiesta Siesta — ${buffer.events.length} Änderungen`

  // Clear buffer NOW so concurrent calls don't double-fire
  const events = buffer.events
  buffer.events = []

  // ── Delivery ──────────────────────────────────────────────────

  const pushEnabled =
    localStorage.getItem('push_notifications_enabled') === 'true'
  const pushConfigured = isPushConfigured()

  if (pushEnabled && pushConfigured && notifyListId) {
    // Try Edge Function; fall back to native on failure
    deliverViaEdgeFunction(notifyListId, title, body, events).catch(() => {
      deliverNative(title, body)
    })
  } else {
    // Native fallback (this is the common path when VAPID isn't configured)
    deliverNative(title, body)
  }
}

/**
 * Attempt delivery via the Supabase Edge Function 'send-push'.
 * Resolves on success, rejects on failure (caller falls back to native).
 */
async function deliverViaEdgeFunction(
  listId: string,
  title: string,
  body: string,
  _events: NotifyEvent[],
): Promise<void> {
  const invokeBody: Record<string, unknown> = {
    list_id: listId,
    title,
    body,
  }
  // Pass the actor name as `exclude` so the Edge Function can skip them
  // (the Edge Function may or may not support this field — it ignores
  //  unknown fields gracefully in most implementations).
  if (notifyUserName) {
    invokeBody.exclude = notifyUserName
  }

  const { error } = await supabase.functions.invoke('send-push', {
    body: invokeBody,
    // Die Edge Function autorisiert über den Join-Code (sie umgeht RLS mit dem
    // Service-Role-Key). Ohne diesen Header antwortet sie mit 403.
    headers: { 'x-join-code': getJoinCode() },
  })

  if (error) {
    throw error
  }
}

/**
 * Deliver a local browser notification (fallback path when the Edge
 * Function is unavailable). Prefers the service worker's showNotification:
 * on Android Chrome the Notification constructor throws "Illegal
 * constructor" — a local notification would never arrive there. Falls back
 * to the constructor only where no service worker exists.
 * Silently no-ops if the Notification API is unavailable or permission
 * is not granted.
 */
function deliverNative(title: string, body: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return

  // Android Chrome: der Notification-Konstruktor wirft dort „Illegal constructor"
  // und der try/catch unten schluckt das still — es käme nie eine Benachrichtigung
  // an. Über den Service Worker ist die Anzeige erlaubt (und nimmt Icon + Badge).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then((reg) =>
        reg.showNotification(title, {
          body,
          tag: NOTIFICATION_TAG,
          icon: '/FiestaSiesta/icon-192.png',
          badge: '/FiestaSiesta/icon-192.png',
        }),
      )
      .catch(() => undefined)
    return
  }

  try {
    new Notification(title, {
      body,
      tag: NOTIFICATION_TAG,
      // renotify: false — don't buzz again if the tag is already shown
    })
  } catch {
    // Some browsers throw if the service worker is in a bad state.
    // Silently ignore — we don't want to crash the app over a notification.
  }
}

/**
 * Clear the buffer and cancel any pending debounce timer.
 * Call on logout / leave / unmount.
 */
export function resetNotifyBuffer(): void {
  if (buffer.timer) {
    clearTimeout(buffer.timer)
    buffer.timer = null
  }
  buffer.events = []
}