// sw.js — Carnet
// Stratégie : Stale-While-Revalidate pour les ressources de l'app,
// + cache des assets externes utilisés (CDN, polices) et fallback navigation hors-ligne.
const CACHE_NAME = 'carnet-v5';
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
      try {
        // Essayer d'ajouter tous les assets (internes + externes).
        await cache.addAll([...CORE_ASSETS, ...EXTERNAL_ASSETS]);
      } catch (err) {
        // Si un des assets externes échoue, on ne bloque pas l'installation —
        // on a déjà mis en cache les fichiers essentiels via `CORE_ASSETS`.
        try { await cache.addAll(CORE_ASSETS); } catch (e) { /* noop */ }
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

    // Navigation (page load) : Network-first, fallback vers index.html en hors-ligne
    if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
      try {
        const netResp = await fetch(req);
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
