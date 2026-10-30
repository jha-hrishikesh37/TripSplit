const CACHE_NAME = 'tripsplit-v2.0-static';

const STATIC_ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './manifest.json',
  './icons/icon.svg',
  './js/app.js',
  './js/config.js',
  './js/domain/money.js',
  './js/domain/splits.js',
  './js/domain/settlement.js',
  './js/domain/permissions.js',
  './js/storage/seed.js',
  './js/storage/syncCodec.js',
  './js/storage/merge.js',
  './js/storage/storageAdapter.js',
  './js/ui/state.js',
  './js/ui/helpers.js',
  './js/ui/views.js',
  './js/ui/expenseModal.js',
  './js/ui/tripModal.js',
  './js/ui/syncExport.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) {
          return cached;
        }
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      })
  );
});
