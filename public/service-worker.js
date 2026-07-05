// Service Worker Route SOA — permet d'ouvrir l'app et de continuer à travailler sur
// une tournée déjà chargée même sans réseau (zones blanches Landes/Gers/64).
//
// Stratégie :
// - L'app elle-même (page, icônes, données silos/DKV) est mise en cache → chargement
//   instantané même hors-ligne.
// - Les appels /api/* (analyse PDF, météo, prix carburant, position flotte) ont
//   TOUJOURS besoin d'une connexion — ce sont des données vivantes qu'on ne peut pas
//   deviner sans réseau. Ils ne sont jamais mis en cache ici.
// - La tournée déjà chargée (clients, silos, adresses) reste consultable car elle est
//   déjà stockée dans localStorage par l'app elle-même — indépendant de ce fichier.

const CACHE_NAME = 'route-soa-v2';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/silos.json',
  '/dkv_stations.json'
];

self.addEventListener('install', (event) => {
  // Active la nouvelle version immédiatement, sans attendre que tous les onglets
  // soient fermés — important car les mises à jour sont fréquentes sur ce projet.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Appels API : toujours réseau, jamais de cache — ce sont des données vivantes.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'Hors ligne' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 503
        })
      )
    );
    return;
  }

  // Domaines externes (météo, OSRM, radars gouv, polices Google...) : on laisse
  // passer normalement, sans interception ni mise en cache par ce fichier.
  if (url.origin !== self.location.origin) return;

  // App shell et fichiers statiques : RÉSEAU D'ABORD — garantit que tu vois toujours
  // la dernière version dès qu'il y a du réseau (important vu la fréquence des mises
  // à jour de cette app). Le cache ne sert que de secours si le réseau est coupé —
  // c'est là qu'intervient le mode hors-ligne, pas pour économiser du chargement.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
