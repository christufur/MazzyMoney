// Hand-written service worker for Mazzy Money.
// It caches only the app shell. API calls and mutations never go through it.

const CACHE_VERSION = 'mazzy-shell-v1';
const SHELL_URLS = ['/', '/index.html'];

// Cache the shell, then the hashed script and style files it points at, so the
// app opens offline even if the first visit happened before this worker took over.
const precacheShell = async () => {
  const cache = await caches.open(CACHE_VERSION);
  await cache.addAll(SHELL_URLS);

  const html = await (await cache.match('/index.html')).text();
  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]))];

  // A single missing file must not stop the worker from installing; that request
  // falls back to the network the first time it is needed.
  await Promise.all(assets.map((asset) => cache.add(asset).catch(() => undefined)));
};

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only GETs. Anything else (a sync, a save, a login) goes straight to the network.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // The API is never cached and never served from a fallback.
  if (url.pathname.startsWith('/api/')) return;

  // Another origin (fonts, Plaid) is not ours to cache.
  if (url.origin !== self.location.origin) return;

  // Page loads: network first, so a new build shows up at once; the cached shell
  // answers when the server cannot be reached.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html').then((cached) => cached ?? Response.error()))
    );
    return;
  }

  // Hashed build files never change under the same name, so serve them from the cache.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
  }
});
