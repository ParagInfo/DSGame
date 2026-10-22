const CACHE_NAME = 'kbds-cache-v1';
const ASSETS_TO_CACHE = [
  './index.html',
  './src/kbds.css',
  './src/params.js',
  './src/game-secure.js',
  './manifest.json',
  './src/kbds_logo.svg',
  './src/icon-192.png',
  './src/icon-512.png'
];

// 1. Install Event: Cache all essential static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  // Force active status immediately without waiting for browser restart
  self.skipWaiting();
});

// 2. Activate Event: Clean up old, outdated caches when CACHE_NAME changes
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. Fetch Event: Serve from cache first, fall back to network/index.html
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request).catch(() => {
        // Offline fallback for page navigation
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
