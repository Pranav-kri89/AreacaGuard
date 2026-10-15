// ArecaGuard PWA Service Worker
const CACHE_NAME = 'arecaguard-v2';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/icon.svg',
  '/pwa-192x192.png',
  '/pwa-maskable-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/apple-touch-icon.png',
  '/screenshots/screenshot-mobile.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Use Promise.allSettled so that if any individual asset fails,
      // it never breaks the overall service worker installation.
      await Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          fetch(url, { cache: 'no-cache' })
            .then((res) => {
              if (res && res.status === 200) {
                return cache.put(url, res);
              }
            })
            .catch(() => {})
        )
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Let real-time APIs pass straight through
  if (
    event.request.url.includes('/api/') || 
    event.request.url.includes('/sensor-data') || 
    event.request.url.includes('/motor-cmd') ||
    event.request.url.includes('/motor-ping') ||
    event.request.url.includes('/weather')
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return new Response('Network error and no offline cache available', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({ 'Content-Type': 'text/plain' })
          });
        });
      })
  );
});
