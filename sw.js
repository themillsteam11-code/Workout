/* Tally — Service Worker
 * Cache-first for app shell; network-first for API calls.
 */
var CACHE_NAME = 'tally-v1';
var SHELL_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/data.js',
  '/js/calc.js',
  '/js/app.js',
  '/manifest.json'
];

/* Install: pre-cache the app shell */
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

/* Activate: delete old caches */
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* Fetch: cache-first for shell, network-only for Anthropic API */
self.addEventListener('fetch', function (e) {
  var url = e.request.url;

  /* Always go to network for the Anthropic API */
  if (url.includes('api.anthropic.com')) {
    e.respondWith(fetch(e.request));
    return;
  }

  /* Cache-first for everything else */
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      if (cached) return cached;
      return fetch(e.request).then(function (response) {
        /* Cache successful GET responses */
        if (response && response.status === 200 && e.request.method === 'GET') {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(e.request, clone); });
        }
        return response;
      });
    }).catch(function () {
      /* Offline fallback: return the cached index for navigation requests */
      if (e.request.mode === 'navigate') {
        return caches.match('/index.html');
      }
    })
  );
});
