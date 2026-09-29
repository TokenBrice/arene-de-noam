/* Offline service worker, registered only by the built dist/ (never in
   development or under automation). tools/build.mjs minifies this file into
   dist/sw.js and defines:
   - __BUILD_ID__: hash of every dist file, so each deploy is a new worker;
   - __PRECACHE__: { immutable, revalidate } lists covering every dist file.
   Cache-first for same-origin GET; the only fetches are the app's own files. */
const PREFIX = 'arene-de-noam-';
const CACHE = `${PREFIX}${__BUILD_ID__}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Hashed files are immutable, so the HTTP cache may serve them; the rest
      // is revalidated so a new build never stores a stale copy.
      await cache.addAll([
        ...__PRECACHE__.immutable,
        ...__PRECACHE__.revalidate.map((url) => new Request(url, { cache: 'no-cache' })),
      ]);
      await self.skipWaiting();
    })()
  );
});

// The worker takes over pages still running the previous build (skipWaiting +
// claim), and those pages may still lazy-load that build's battle CSS or arena
// chunk, which the new deploy no longer serves. So the previous cache survives
// one generation; older ones are deleted.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const ours = (await caches.keys()).filter((key) => key.startsWith(PREFIX) && key !== CACHE);
      await Promise.all(ours.slice(0, -1).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const current = await caches.open(CACHE);
      const cached =
        (await current.match(request, { ignoreSearch: true })) ??
        // Every page URL (any ?query) is the single-page app shell.
        (request.mode === 'navigate'
          ? await current.match('./index.html')
          : await caches.match(request, { ignoreSearch: true }));
      return cached ?? fetch(request);
    })()
  );
});
