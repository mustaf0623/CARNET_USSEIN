// sw.js — Carnet
// Stratégie : Stale-While-Revalidate pour les ressources de l'app,
// + cache des assets externes utilisés (CDN, polices) et fallback navigation hors-ligne.
const CACHE_NAME = 'carnet-v23';
const APP_SHELL_URL = new URL('./index.html', self.location.href).href;

// Ces fichiers sont l'app elle-même : ils sont installés en mode fail-fast
// (cache.addAll) — si l'un d'eux échoue, TOUTE l'installation échoue et le
// navigateur retentera plus tard, plutôt que de laisser le Service Worker
// s'activer avec un module manquant qui plantera silencieusement hors ligne.
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon.svg',
  './apple-touch-icon-v2.png',
  './css/style.css',
  './js/main.js',
  './js/config.js',
  './js/state.js',
  './js/auth.js',
  './js/pwa.js',
  './js/db/indexeddb.js',
  './js/db/data.js',
  './js/db/sync.js',
  './js/db/upload-queue.js',
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
  './js/views/observations.js',
  './js/views/administration.js',
];

// Assets externes référencés dans index.html — on les met en cache pour permettre
// un fonctionnement hors-ligne après un premier chargement réussi. Non
// bloquants à l'installation : volumineux, et un échec ponctuel d'un CDN ne
// doit pas empêcher l'app elle-même de démarrer hors ligne.
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

      // CRITIQUE : fail-fast. Si un seul de ces fichiers ne se met pas en
      // cache (chemin erroné, fichier renommé côté dépôt, coupure réseau
      // pendant l'installation), cache.addAll() rejette et l'installation
      // entière échoue — le navigateur réessaiera automatiquement au
      // prochain chargement au lieu d'activer un cache silencieusement
      // incomplet (ce qui, avant ce correctif, pouvait faire planter l'app
      // hors ligne sur un module JS manquant, sans aucun signal).
      await cache.addAll(CORE_ASSETS);

      // Best-effort pour les CDN externes : chaque échec est loggé, pas
      // avalé silencieusement, mais ne bloque pas l'installation.
      await Promise.allSettled(
        EXTERNAL_ASSETS.map(async (url) => {
          try {
            const resp = await fetch(url, { cache: 'no-store' });
            if (resp && (resp.ok || resp.type === 'opaque')) {
              await cache.put(url, resp.clone());
            } else {
              console.warn('[SW] asset externe non mis en cache (réponse non-ok):', url);
            }
          } catch (e) {
            console.warn('[SW] échec mise en cache asset externe:', url, e);
          }
        })
      );
    })()
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Avec l'installation fail-fast ci-dessus, ce bloc ne s'exécute que si le
  // nouveau cache est complet (sinon 'install' a déjà échoué et ce SW n'est
  // jamais activé) — on peut donc purger l'ancien cache sans risque de
  // perdre un asset qui n'existerait que dans l'ancienne version.
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

  // Ne jamais intercepter les requêtes vers d'autres origines (API Supabase,
  // Supabase Storage, etc.) : elles doivent atteindre le réseau directement,
  // sans jamais être servies depuis un cache périmé du Service Worker. Seuls
  // les CDN explicitement listés dans EXTERNAL_ASSETS restent gérés ici.
  if (new URL(req.url).origin !== self.location.origin && !EXTERNAL_ASSETS.includes(req.url)) {
    return;
  }

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
        if (netResp && netResp.ok) {
          try { cache.put(req, netResp.clone()); } catch (e) { /* noop */ }
          return netResp;
        }
        return cached || await cache.match(APP_SHELL_URL) || await cache.match('./');
      } catch (err) {
        // Réseau indisponible — retourner la page en cache si disponible.
        // APP_SHELL_URL est résolu via new URL(), donc correct même en
        // sous-dossier (ex. GitHub Pages /CARNET_USSEIN/), contrairement à
        // un chemin absolu codé en dur comme '/index.html'.
        return cached || await cache.match(APP_SHELL_URL) || await cache.match('./');
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
      // Dernier recours : retourner ce qui est en cache (ou undefined)
      return cached;
    }
  })());
});
