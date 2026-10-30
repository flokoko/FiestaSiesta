// IMPORTANT: Bump this version when deploying changes.
// Keep in sync with APP_VERSION in src/version.ts
const CACHE_NAME = 'fiesta-siesta-v0.48.0';

const INDEX_URL = '/FiestaSiesta/';

// Install: precache every build asset (from the manifest emitted by
// vite.config.ts), then activate immediately.
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    fetch('/FiestaSiesta/precache-manifest.json', { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`precache manifest ${res.status}`);
        return res.json();
      })
      .then((files) => {
        const urls = [...new Set([INDEX_URL, '/FiestaSiesta/index.html', ...files])];
        // Einzeln laden statt cache.addAll: addAll ist alles-oder-nichts, ein einziger
        // 404 (z. B. eine Datei, die gerade nicht ausgeliefert wird) ließ bisher nur
        // index.html im Cache zurück — die App startete offline dann in einen
        // ewigen Boot-Splash, ohne dass der Browser die Installation wiederholte.
        return caches.open(CACHE_NAME).then(async (cache) => {
          const results = await Promise.allSettled(urls.map((url) => cache.add(url)));
          const failed = results.filter((r) => r.status === 'rejected').length;
          // Nur ein kleiner Schwund ist tolerabel; sonst Installation scheitern lassen,
          // damit der Browser es beim nächsten Update-Versuch erneut probiert.
          if (failed > Math.max(2, Math.floor(urls.length * 0.2))) {
            throw new Error(`precache incomplete: ${failed}/${urls.length}`);
          }
        });
      })
      .catch((err) => {
        // Manifest nicht ladbar → wenigstens index.html, aber NICHT als Erfolg verbuchen.
        console.warn('[sw] precache failed', err);
        return caches
          .open(CACHE_NAME)
          .then((cache) => cache.addAll([INDEX_URL, '/FiestaSiesta/index.html']).catch(() => undefined))
          .then(() => {
            throw err;
          });
      })
  );
});

// Activate: keep the current cache plus the most recent previous generation
// (escape hatch for sessions still open across a deploy), delete everything older.
// Only OUR caches (fiesta-siesta-v*): this origin also serves other apps
// (e.g. /BellaMozzarella/) — their Cache Storage must survive our updates.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(async (keys) => {
      const keep = new Set([CACHE_NAME]);
      const generations = keys
        .filter((k) => k.startsWith('fiesta-siesta-v'))
        // numerisch, nicht lexikalisch: sonst gilt v0.9.0 als neuer als v0.31.0
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const previous = generations.filter((k) => k !== CACHE_NAME).pop();
      if (previous) keep.add(previous);
      const toDelete = keys.filter((k) => k.startsWith('fiesta-siesta-v') && !keep.has(k));
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
// Push-Dienst tauscht den Endpoint (z. B. GCM -> FCM). Ohne diesen Handler
// bleibt in push_subscriptions der alte Endpoint stehen und es kommt nie
// wieder etwas an — ohne Fehlermeldung. Der neue Abo-Datensatz wird im Cache
// abgelegt; push.ts zieht ihn beim naechsten App-Start nach Supabase.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    try {
      const oldOptions = e.oldSubscription && e.oldSubscription.options;
      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: oldOptions && oldOptions.applicationServerKey
          ? oldOptions.applicationServerKey
          : undefined,
      });
      const cache = await caches.open('fiesta-push-meta');
      await cache.put(
        '/__push_subscription',
        new Response(JSON.stringify({ subscription: subscription.toJSON(), at: Date.now() }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    } catch {
      // Ohne Key/Erlaubnis nicht erneut abonnierbar — beim naechsten Start
      // fragt die Einstellungen-Seite den Status ohnehin neu ab.
    }
  })());
});

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

  // HTML navigation: NETWORK first, cache as offline fallback.
  // Vorher cache-first: nach einem Deploy lieferte der Service Worker die alte
  // index.html weiter, die auf inzwischen gelöschte Asset-Hashes zeigt — die App
  // blieb dann im statischen Boot-Splash stehen und kam nie hoch. Offline greift
  // weiter der Cache.
  if (e.request.mode === 'navigate' || e.request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          // Zeitlimit: ohne Abort wartet der Browser bei Captive Portal / NAT-
          // Hänger minutenlang und die App startet scheinbar gar nicht, obwohl
          // index.html und alle Assets im Cache liegen.
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 5000);
          let response;
          try {
            response = await fetch(e.request, { signal: controller.signal });
          } finally {
            clearTimeout(timer);
          }
          if (response && response.status === 200) {
            e.waitUntil(cache.put(e.request, response.clone()).catch(() => undefined));
            return response;
          }
          throw new Error(`status ${response && response.status}`);
        } catch {
          const cached =
            (await cache.match(e.request)) ||
            (await cache.match(INDEX_URL)) ||
            (await caches.match(INDEX_URL));
          if (cached) return cached;
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
          e.waitUntil(cache.put(e.request, response.clone()).catch(() => undefined));
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
