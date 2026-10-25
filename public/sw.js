// IMPORTANT: Bump this version when deploying changes.
// Keep in sync with APP_VERSION in src/version.ts
const CACHE_NAME = 'fiesta-siesta-v0.28.0';

const INDEX_URL = '/FiestaSiesta/';

// Install: precache every build asset (from the manifest emitted by
// vite.config.ts), then activate immediately.
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    fetch('/FiestaSiesta/precache-manifest.json')
      .then((res) => {
        if (!res.ok) throw new Error(`precache manifest ${res.status}`);
        return res.json();
      })
      .then((files) => {
        const urls = [INDEX_URL, '/FiestaSiesta/index.html', ...files];
        return caches.open(CACHE_NAME).then((cache) => cache.addAll(urls));
      })
      .catch(() => {
        // Non-fatal: install must not abort when the manifest can't be loaded.
        return caches
          .open(CACHE_NAME)
          .then((cache) =>
            cache.addAll([INDEX_URL, '/FiestaSiesta/index.html']).catch(() => undefined)
          );
      })
  );
});

// Activate: keep the current cache plus the most recent previous generation
// (escape hatch for sessions still open across a deploy), delete everything older.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(async (keys) => {
      const keep = new Set([CACHE_NAME]);
      const generations = keys
        .filter((k) => k.startsWith('fiesta-siesta-v'))
        .sort();
      const previous = generations.filter((k) => k !== CACHE_NAME).pop();
      if (previous) keep.add(previous);
      const toDelete = keys.filter((k) => !keep.has(k));
      await Promise.all(toDelete.map((k) => caches.delete(k)));
      await self.clients.claim();
    })
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

  // Never intercept Supabase/API traffic
  if (url.hostname.includes('supabase')) return;

  // GET only
  if (e.request.method !== 'GET') return;

  // Same-origin only
  if (url.origin !== self.location.origin) return;

  // HTML navigation: cache-first on index.html, network fallback.
  if (e.request.mode === 'navigate' || e.request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached =
          (await cache.match(e.request)) ||
          (await cache.match(INDEX_URL)) ||
          (await caches.match(e.request)) ||
          (await caches.match(INDEX_URL));
        if (cached) return cached;

        try {
          const response = await fetch(e.request);
          if (response && response.status === 200) {
            e.waitUntil(cache.put(e.request, response.clone()));
          }
          return response;
        } catch {
          return new Response('Offline — die App konnte nicht geladen werden.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
      })()
    );
    return;
  }

  // Assets: cache-first (across current + previous generation), else network.
  e.respondWith(
    (async () => {
      const cached = await caches.match(e.request);
      if (cached) return cached;

      try {
        const response = await fetch(e.request);
        const isJsCss = /\.(js|css)(\?|#|$)/.test(url.pathname);

        if (response && response.status === 200) {
          const cache = await caches.open(CACHE_NAME);
          e.waitUntil(cache.put(e.request, response.clone()));
          return response;
        }

        // Stale hashed JS/CSS gone after a deploy: don't leak the raw 404.
        if (isJsCss) {
          return new Response('', { status: 410, statusText: 'Gone' });
        }

        return response;
      } catch {
        return new Response('', { status: 504, statusText: 'Gateway Timeout' });
      }
    })()
  );
});
