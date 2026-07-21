// sw.js — Carnet
// Stratégie : Stale-While-Revalidate pour les ressources de l'app,
// Network-Only pour les CDN externes (xlsx, chart.js, jspdf, polices).
const CACHE_NAME = 'carnet-v3';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192-v2.png',
  './icons/icon-512-v2.png',
  './icons/icon-512-maskable-v2.png',
  './icons/apple-touch-icon-v2.png',
  './icons/favicon-v2.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (!isSameOrigin) {
    // Ressources externes (CDN) : on laisse le réseau gérer, sans les mettre en cache
    // pour ne pas figer des bibliothèques tierces.
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      const networkFetch = fetch(req)
        .then((response) => {
          if (response && response.ok) cache.put(req, response.clone());
          return response;
        })
        .catch(() => null);
      return cached || (await networkFetch) || cached;
    })
  );
});
