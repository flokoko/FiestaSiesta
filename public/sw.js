// IMPORTANT: Bump this version when deploying changes.
// Keep in sync with APP_VERSION in src/version.ts
const CACHE_NAME = 'fiesta-siesta-v0.1.0';

// Install: skipWaiting to activate immediately
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Push event handlers ────────────────────────────────────────────

// Receive a push notification from the Edge Function and display it.
self.addEventListener('push', (e) => {
  let payload = { title: 'Fiesta Siesta', body: '', icon: '', tag: '', data: {} };

  try {
    if (e.data) {
      payload = e.data.json();
    }
  } catch {
    // Fallback if the payload isn't JSON
    payload.body = e.data ? e.data.text() : '';
  }

  const title = payload.title || 'Fiesta Siesta';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/FiestaSiesta/icon-192.png',
    badge: '/FiestaSiesta/icon-192.png',
    tag: payload.tag || 'fiesta-siesta',
    data: payload.data || {},
    vibrate: [80, 40, 80],
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

// Handle notification click: focus existing window or open new one.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to focus an existing Fiesta Siesta tab
      for (const client of clientList) {
        if (client.url.includes('/FiestaSiesta') && 'focus' in client) {
          return client.focus();
        }
      }
      // No existing tab found — open a new one
      if (self.clients.openWindow) {
        return self.clients.openWindow('/FiestaSiesta/');
      }
    })
  );
});

// Handle notification close (analytics or cleanup could go here).
self.addEventListener('notificationclose', () => {
  // Intentionally empty — no action needed on close.
});

// Fetch
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Don't intercept Supabase API calls
  if (url.hostname.includes('supabase')) return;

  // Only handle GET
  if (e.request.method !== 'GET') return;

  // Same-origin only
  if (url.origin !== self.location.origin) return;

  // HTML navigation requests: NETWORK-FIRST with cache fallback.
  // This guarantees users always get the latest index.html (which points
  // to the latest hashed bundle), instead of a stale cached HTML that
  // references an old broken bundle.
  if (e.request.mode === 'navigate' || e.request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      fetch(e.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(e.request).then((cached) => cached || caches.match('/FiestaSiesta/')))
    );
    return;
  }

  // Other same-origin GET (hashed assets): stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});