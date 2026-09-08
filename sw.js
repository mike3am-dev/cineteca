/* ══════════════════════════════════════════════════════════
   Service worker — prima la rete, la cache è il paracadute.

   La versione precedente serviva prima la cache: bastava
   aggiungere uno script all'index perché il browser continuasse
   a servire la pagina vecchia, senza il file nuovo, rompendo
   la app. Qui la rete vince sempre e la cache interviene solo
   quando la rete non c'è.
   ══════════════════════════════════════════════════════════ */

const CACHE = 'cineteca-v202609080506';
const SHELL = [
  './', './index.html', './css/styles.css',
  './js/avviso.js', './js/store.js', './js/format.js', './js/charts.js',
  './js/consiglia.js', './js/persone.js', './js/ciechi.js', './js/perte.js', './js/notizie.js', './js/stats.js', './js/detail.js', './js/novita.js', './js/cloud-config.js', './js/cloud.js', './js/app.js',
  './data/movies.json', './manifest.webmanifest', './assets/icon-180.png', './assets/icon-192.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;

  e.respondWith(
    fetch(request)
      .then(res => {
        // Solo le risposte valide meritano di finire in cache.
        if (res && res.ok && res.type !== 'opaque') {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(request, copia)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(request);
        if (hit) return hit;
        // Navigazione offline senza corrispondenza: rimando alla home.
        if (request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      })
  );
});
