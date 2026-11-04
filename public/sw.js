const CACHE_VERSION = 'doas-v1';
const PAGE_CACHE = `${CACHE_VERSION}-pages`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const OFFLINE_URL = '/offline.html';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/login.html',
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PAGE_CACHE);
      await Promise.allSettled(
        PRECACHE_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' }))),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('doas-') && !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API responses, auth callbacks, the manifest, or the worker.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/sw.js' || url.pathname === '/manifest.webmanifest') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
    return;
  }

  if (
    url.pathname.startsWith('/assets/') ||
    /\.(?:css|js|mjs|png|svg|ico|webmanifest|woff2?)$/i.test(url.pathname)
  ) {
    event.respondWith(cacheFirstStatic(request));
  }
});

async function networkFirstPage(request) {
  const cache = await caches.open(PAGE_CACHE);

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => undefined);
    }
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;

    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;

    return new Response('Offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => undefined);
    }
    return response;
  } catch {
    return new Response('', { status: 504 });
  }
}
