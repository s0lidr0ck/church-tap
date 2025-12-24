// NOTE:
// If you make a breaking change to the caching strategy, bump CACHE_VERSION.
// This ensures clients drop old caches quickly.
const CACHE_VERSION = 'v4';
const APP_SHELL_CACHE = `churchtap-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `churchtap-runtime-${CACHE_VERSION}`;

const APP_SHELL_URLS = [
  '/verse',
  '/css/style.css?v=4',
  '/js/app.js?v=4',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/churchtap-full.svg',
  '/icons/churchtap-glyph.svg',
];

function isHtmlNavigationRequest(request) {
  if (request.mode === 'navigate') return true;
  const accept = request.headers.get('accept') || '';
  return accept.includes('text/html');
}

function isStaticAssetPath(pathname) {
  return (
    pathname.startsWith('/js/') ||
    pathname.startsWith('/css/') ||
    pathname.startsWith('/icons/') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.jpeg') ||
    pathname.endsWith('.webp') ||
    pathname.endsWith('.gif') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.woff') ||
    pathname.endsWith('.woff2') ||
    pathname.endsWith('.ttf')
  );
}

async function networkFirst(event) {
  try {
    const response = await fetch(event.request);

    // Cache successful same-origin GET responses for offline fallback.
    // (We do NOT cache /api calls here.)
    if (response && response.ok) {
      const url = new URL(event.request.url);
      if (!url.pathname.startsWith('/api/')) {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(event.request, response.clone());
      }
    }

    return response;
  } catch (err) {
    // Offline fallback for navigations.
    if (isHtmlNavigationRequest(event.request)) {
      const cache = await caches.open(APP_SHELL_CACHE);
      const offlineShell = await cache.match('/verse');
      if (offlineShell) return offlineShell;
    }

    // Otherwise try runtime cache.
    const runtime = await caches.open(RUNTIME_CACHE);
    const cached = await runtime.match(event.request);
    if (cached) return cached;

    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(event.request);

  const fetchPromise = fetch(event.request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(event.request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || (await fetchPromise) || new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
}

// Install service worker and cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_SHELL_CACHE);
      await cache.addAll(APP_SHELL_URLS);
      await self.skipWaiting();
    })()
  );
});

// Activate: clear old caches and take control ASAP
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key !== APP_SHELL_CACHE && key !== RUNTIME_CACHE) {
            return caches.delete(key);
          }
          return undefined;
        })
      );
      await self.clients.claim();
    })()
  );
});

// Allow the page to trigger immediate activation
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch strategy:
// - Navigations (HTML): network-first (prevents "stuck on old HTML")
// - Static assets: stale-while-revalidate (fast + updates in background)
// - API: always network
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Never try to cache or intercept the service worker script itself.
  if (url.pathname === '/sw.js') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Never cache API responses.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (isHtmlNavigationRequest(event.request)) {
    event.respondWith(networkFirst(event));
    return;
  }

  // These files are NOT fingerprinted; prefer getting the latest on every load.
  if (url.pathname === '/css/style.css' || url.pathname === '/js/app.js') {
    event.respondWith(networkFirst(event));
    return;
  }

  if (isStaticAssetPath(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event));
    return;
  }

  // Default to network-first for everything else.
  event.respondWith(networkFirst(event));
});

// Handle background sync for analytics
self.addEventListener('sync', event => {
  if (event.tag === 'background-sync') {
    event.waitUntil(doBackgroundSync());
  }
});

function doBackgroundSync() {
  // Send any pending analytics data when connection is restored
  return fetch('/api/sync-analytics', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timestamp: Date.now(),
      action: 'background-sync'
    })
  }).catch(err => {
    console.log('Background sync failed:', err);
  });
}

// Handle push notifications
self.addEventListener('push', event => {
  const options = {
    body: event.data ? event.data.text() : 'New daily verse available!',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: '1'
    },
    actions: [
      {
        action: 'explore',
        title: 'Read Verse',
        icon: '/icons/icon-192x192.png'
      },
      {
        action: 'close',
        title: 'Close',
        icon: '/icons/icon-192x192.png'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('Daily Verse', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'explore') {
    event.waitUntil(
      clients.openWindow('/verse')
    );
  } else if (event.action === 'close') {
    event.notification.close();
  } else {
    event.waitUntil(
      clients.openWindow('/verse')
    );
  }
});