const CACHE_NAME = 'rd-web-shell-v4';
const MAX_ASSET_CACHE_ENTRIES = 64;
const SHELL_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/icon.svg',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

async function trimAssetCache(cache) {
  const keys = await cache.keys();
  const assetKeys = keys.filter((req) => new URL(req.url).pathname.startsWith('/assets/'));
  if (assetKeys.length <= MAX_ASSET_CACHE_ENTRIES) return;
  const excess = assetKeys.length - MAX_ASSET_CACHE_ENTRIES;
  await Promise.all(assetKeys.slice(0, excess).map((req) => cache.delete(req)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => undefined),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;

  // Navigation requests: network-first so updates land immediately, fallback to cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/', copy)).catch(() => undefined);
          }
          return response;
        })
        .catch(() =>
          caches.match('/').then(
            (cached) =>
              cached ||
              new Response('Offline', {
                status: 503,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
              }),
          ),
        ),
    );
    return;
  }

  // Immutable hashed assets: cache-first with bounded cache size.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok && response.type === 'basic') {
              const copy = response.clone();
              caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(request, copy).then(() => trimAssetCache(cache)))
                .catch(() => undefined);
            }
            return response;
          }),
      ),
    );
  }
});
