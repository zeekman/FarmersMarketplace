const APP_VERSION = self.__APP_VERSION__ || '1.0.0';
const CACHE_NAME = `fm-shell-${APP_VERSION}`;
const OFFLINE_URL = '/offline.html';

const PRECACHE_URLS = [
  '/offline.html',
];

// Explicit allowlist of PUBLIC API endpoints that are safe to cache.
// Anything else under /api/ (auth, wallet, orders, messages, addresses,
// admin, ...) must never be stored in Cache Storage.
const PUBLIC_API_ALLOWLIST = [
  /^\/api\/v1\/products(\/|$)/,
  /^\/api\/v1\/categories(\/|$)/,
  /^\/api\/v1\/rates(\/|$)/,
];

function isCacheableApiRequest(request, url) {
  if (request.method !== 'GET') return false;
  // Never cache anything that carries credentials/authorization.
  if (request.headers.get('Authorization')) return false;
  return PUBLIC_API_ALLOWLIST.some((pattern) => pattern.test(url.pathname));
}

// Install: pre-cache the offline fallback only. index.html is intentionally
// NOT pre-cached so navigation always goes to the network when online.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  // Do NOT call skipWaiting() here — activation is controlled via the
  // SKIP_WAITING message so the user gets a chance to see the update prompt.
});

// Activate: clean up old caches, then notify clients of the update
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
      .then(() =>
        self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((clients) =>
          clients.forEach((c) => c.postMessage({ type: 'SW_UPDATED' }))
        )
      )
  );
});

// Delete every cached API response. Used on logout and on login as a
// different user so a previous session's data can never be served.
async function clearUserCache() {
  const keys = await caches.keys();
  await Promise.all(
    keys.map(async (key) => {
      const cache = await caches.open(key);
      const requests = await cache.keys();
      await Promise.all(
        requests
          .filter((req) => new URL(req.url).pathname.startsWith('/api/'))
          .map((req) => cache.delete(req))
      );
    })
  );
}

// Controlled activation: the UpdatePrompt component sends SKIP_WAITING
// so we only take over after the user has acknowledged the update.
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data.type === 'CLEAR_USER_CACHE') {
    event.waitUntil(clearUserCache());
  }
});

// Fetch strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Navigation requests: network-first so a fresh deploy always serves the
  // new index.html (and its hashed chunks). Fall back to the cached shell
  // only when the network is unavailable.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && request.method === 'GET') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match(OFFLINE_URL))
        )
    );
    return;
  }

  // Product listing API: stale-while-revalidate
  if (url.pathname.startsWith('/api/products') && request.method === 'GET') {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request).then((response) => {
          if (response.ok && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        }).catch(() => null);
        return cached || fetchPromise || new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      })
    );
    return;
  }

  // Other API requests: network-first. Only public allowlisted endpoints
  // (and requests without an Authorization header) may be cached; every
  // other /api/ response is passed through and never stored.
  if (url.pathname.startsWith('/api/')) {
    const cacheable = isCacheableApiRequest(request, url);
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (cacheable && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          if (!cacheable) {
            return new Response(JSON.stringify({ error: 'offline' }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return caches.match(request).then((cached) => cached || new Response(JSON.stringify({ error: 'offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }));
        })
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && request.method === 'GET') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // For navigation requests, serve offline page (shouldn't reach here)
          if (request.mode === 'navigate') {
            return caches.match(OFFLINE_URL);
          }
        });
    })
  );
});

// Push notifications
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Farmers Marketplace';
  const options = {
    body: data.body || 'You have a new notification',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: data.url || '/',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data || '/';
  event.waitUntil(clients.openWindow(targetUrl));
});
