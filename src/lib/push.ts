// ── Web Push client helper ─────────────────────────────────────────
// Provides subscription, unsubscription, and permission utilities for
// the Fiesta Siesta PWA. The VAPID public key is read from
// VITE_VAPID_PUBLIC_KEY at build time. If it is not set, push is
// gracefully disabled (no crash).

import { supabase } from './supabase'

// VAPID public key from build env (may be empty/undefined on builds
// that haven't configured it yet).
const VAPID_PUBLIC_KEY: string =
  (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? ''

/**
 * Decode a base64url string into a Uint8Array (for VAPID applicationServerKey).
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const output = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    output[i] = rawData.charCodeAt(i)
  }
  return output
}

/**
 * Check whether Web Push is supported in the current browser.
 * Returns false if Notification permission is already denied, since
 * there's nothing the app can do in that state.
 */
export function isPushSupported(): boolean {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    Notification.permission !== 'denied'
  )
}

/**
 * Check whether the VAPID public key is configured.
 */
export function isPushConfigured(): boolean {
  return VAPID_PUBLIC_KEY.length > 0
}

/**
 * Get the existing push subscription from the service worker (if any).
 */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return null
  }
  try {
    const reg = await navigator.serviceWorker.ready
    return reg.pushManager.getSubscription()
  } catch {
    return null
  }
}

/**
 * Subscribe the current user to push notifications.
 * Requests permission, creates a push subscription with the VAPID
 * public key, and upserts the subscription into the push_subscriptions
 * table in Supabase.
 *
 * @param listId       UUID of the current list
 * @param participantName  Name of the current participant
 * @returns { ok: boolean, error?: string }
 */
export async function subscribeToPush(
  listId: string,
  participantName: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!VAPID_PUBLIC_KEY) {
    return { ok: false, error: 'Push ist nicht konfiguriert (VAPID key fehlt).' }
  }

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, error: 'Push wird von diesem Browser nicht unterstützt.' }
  }

  // Request notification permission
  let permission: NotificationPermission
  try {
    permission = await Notification.requestPermission()
  } catch {
    return { ok: false, error: 'Berechtigung konnte nicht angefragt werden.' }
  }

  if (permission !== 'granted') {
    return { ok: false, error: 'Benachrichtigungen wurden abgelehnt.' }
  }

  let reg: ServiceWorkerRegistration
  try {
    reg = await navigator.serviceWorker.ready
  } catch {
    return { ok: false, error: 'Service Worker ist nicht bereit.' }
  }

  let subscription: PushSubscription
  try {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    })
  } catch (err) {
    return {
      ok: false,
      error: `Push-Abonnement fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  // Upsert the subscription into Supabase
  const sub = subscription.toJSON()
  const endpoint = sub.endpoint
  const p256dh = sub.keys?.p256dh ?? ''
  const auth = sub.keys?.auth ?? ''

  if (!endpoint || !p256dh || !auth) {
    return { ok: false, error: 'Abonnement-Daten unvollständig.' }
  }

  const { error: upsertError } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        list_id: listId,
        participant_name: participantName,
        endpoint,
        p256dh,
        auth,
      },
      { onConflict: 'list_id,participant_name,endpoint' },
    )

  if (upsertError) {
    return { ok: false, error: `Speichern fehlgeschlagen: ${upsertError.message}` }
  }

  // Persist a local flag so the UI can show "active" state quickly
  localStorage.setItem('push_notifications_enabled', 'true')

  return { ok: true }
}

/**
 * Unsubscribe the current user from push notifications.
 * Cancels the browser push subscription and deletes the row(s) from
 * Supabase matching the endpoint.
 *
 * @param listId          UUID of the current list
 * @param participantName Name of the current participant
 */
export async function unsubscribeFromPush(
  listId: string,
  participantName: string,
): Promise<void> {
  // Cancel the browser-side subscription first
  const existing = await getExistingSubscription()
  const endpoint = existing?.endpoint ?? null
  if (existing) {
    try {
      await existing.unsubscribe()
    } catch {
      // ignore — the subscription may already be invalid
    }
  }

  // Nur das Abo DIESES Geräts löschen. Vorher wurden alle Zeilen von
  // list+participant entfernt — wer die Benachrichtigungen auf dem Handy
  // abschaltete, bekam auf dem Tablet ebenfalls keine Pushs mehr.
  // Ohne bekannten Endpoint wird NICHTS gelöscht: sonst reißt der Fall
  // „Browser hat gerade kein Abo mehr" alle Geräte mit.
  if (!endpoint) {
    localStorage.removeItem('push_notifications_enabled')
    return
  }

  await supabase
    .from('push_subscriptions')
    .delete()
    .eq('list_id', listId)
    .eq('participant_name', participantName)
    .eq('endpoint', endpoint)

  localStorage.removeItem('push_notifications_enabled')
}

/**
 * Vom Service Worker rotierter Endpoint (pushsubscriptionchange) liegt im Cache
 * 'fiesta-push-meta'. Beim Start nach Supabase nachziehen, sonst zeigt die UI
 * „aktiv", während der Server an einen toten Endpoint pusht.
 */
export async function syncRotatedSubscription(
  listId: string,
  participantName: string,
): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false
    const cache = await caches.open('fiesta-push-meta')
    const res = await cache.match('/__push_subscription')
    if (!res) return false
    const data = await res.json() as {
      subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    }
    const endpoint = data?.subscription?.endpoint
    const p256dh = data?.subscription?.keys?.p256dh
    const auth = data?.subscription?.keys?.auth
    if (!endpoint || !p256dh || !auth) return false

    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        { list_id: listId, participant_name: participantName, endpoint, p256dh, auth },
        { onConflict: 'list_id,participant_name,endpoint' },
      )

    if (error) return false
    await cache.delete('/__push_subscription')
    localStorage.setItem('push_notifications_enabled', 'true')
    return true
  } catch {
    return false
  }
}

/**
 * Check whether the current browser has an active push subscription
 * AND it exists in Supabase for the given user.
 * For a lightweight check, just verify the browser subscription exists.
 */
export async function hasActiveSubscription(): Promise<boolean> {
  const sub = await getExistingSubscription()
  return sub !== null
}