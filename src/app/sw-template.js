/* FieldLine offline service worker — generated at build time from src/app/sw-template.js. */
const VERSION = '__VERSION__';
const CACHE = `fieldline-${VERSION}`;
const FILES = __FILES__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('fieldline-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // App shell: always answer from cache so the app opens offline; refresh in the background.
    event.respondWith(
      caches.match('./', { ignoreVary: true }).then((cached) => {
        const net = fetch(req).then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put('./', res.clone()));
          return res;
        }).catch(() => cached);
        return cached || net;
      }),
    );
    return;
  }
  // ignoreVary: servers (incl. GitHub Pages) send Vary headers, and module/CORS requests carry
  // an Origin header the pre-cache requests did not — without this nothing matches offline.
  event.respondWith(caches.match(req, { ignoreVary: true }).then((cached) => cached || fetch(req)));
});
