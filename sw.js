// sw.js — Carnet
// Stratégie : Stale-While-Revalidate pour les ressources de l'app,
// + cache des assets externes utilisés (CDN, polices) et fallback navigation hors-ligne.
const CACHE_NAME = 'carnet-v13B';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png',
  './favicon.png',
  './css/style.css',
  './js/main.js',
  './js/config.js',
  './js/state.js',
  './js/auth.js',
  './js/pwa.js',
  './js/db/indexeddb.js',
  './js/db/data.js',
  './js/db/sync.js',
  './js/domain/membres.js',
  './js/domain/stats.js',
  './js/export/xlsx-export.js',
  './js/export/pdf-export.js',
  './js/components/ui.js',
  './js/components/modals.js',
  './js/views/shell.js',
  './js/views/dashboard.js',
  './js/views/pointage.js',
  './js/views/membres.js',
  './js/views/rapports.js',
  './js/views/amphitheatre.js',
  './js/views/administration.js',
];

// Assets externes référencés dans index.html — on les met en cache pour permettre
// un fonctionnement hors-ligne après un premier chargement réussi.
const EXTERNAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const putFresh = async (url) => {
        try {
          const resp = await fetch(url, { cache: 'no-store' });
          if (resp && (resp.ok || resp.type === 'opaque')) await cache.put(url, resp.clone());
        } catch (e) { /* noop — sera retenté via le fetch handler */ }
      };
      try {
        await Promise.allSettled([...CORE_ASSETS, ...EXTERNAL_ASSETS].map(putFresh));
      } catch (err) {
        try { await Promise.allSettled(CORE_ASSETS.map(putFresh)); } catch (e) { /* noop */ }
      }
    })()
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

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);

    // Navigation (page load) : Network-first, fallback vers index.html en hors-ligne.
    // cache: 'no-store' est essentiel ici — sans ça, ce fetch() peut lui-même
    // être servi depuis le cache HTTP du navigateur (fréquent sur mobile),
    // ce qui annule complètement la stratégie "network-first".
    if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
      try {
        const netResp = await fetch(req, { cache: 'no-store' });
        if (netResp) {
          // Enregistrez la réponse réseau (utile pour mise à jour)
          try { cache.put(req, netResp.clone()); } catch (e) { /* noop */ }
          return netResp;
        }
      } catch (err) {
        // Réseau indisponible — retourner la page en cache (index) si disponible
        return cached || await cache.match('./') || await cache.match('/index.html');
      }
    }

    // Pour les autres requêtes : Stale-While-Revalidate
    if (cached) {
      // Relancer une requête réseau en tâche de fond pour rafraîchir le cache
      (async () => {
        try {
          const net = await fetch(req);
          if (net && (net.ok || net.type === 'opaque')) {
            try { await cache.put(req, net.clone()); } catch (e) { /* noop */ }
          }
        } catch (e) { /* ignore */ }
      })();
      return cached;
    }

    // Pas de cache : essayer le réseau puis mettre en cache
    try {
      const netResp = await fetch(req);
      if (netResp && (netResp.ok || netResp.type === 'opaque')) {
        try { await cache.put(req, netResp.clone()); } catch (e) { /* noop */ }
        return netResp;
      }
      return cached;
    } catch (err) {
      // Dernier recours : retourner ce qui est en cache (ou null)
      return cached;
    }
  })());
});
