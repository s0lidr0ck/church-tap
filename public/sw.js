const CACHE_NAME = 'daily-verse-v1';
const urlsToCache = [
  '/',
  '/verse',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// Install service worker and cache resources
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cached version or fetch from network
        if (response) {
          return response;
        }
        return fetch(event.request).catch(() => {
          // If network fails and it's a navigation request, show offline page
          if (event.request.mode === 'navigate') {
            return caches.match('/verse').then(offlineResponse => {
              return offlineResponse || new Response('Offline', {
                status: 503,
                statusText: 'Service Unavailable'
              });
            });
          }
          // For non-navigation requests, return a proper error response
          return new Response('Network Error', {
            status: 503,
            statusText: 'Service Unavailable'
          });
        });
      })
  );
});

// Update service worker
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
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