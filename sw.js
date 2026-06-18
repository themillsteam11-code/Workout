/* Tally — Service Worker v2
 * Cache-first for app shell; network-only for Gemini + Open Food Facts.
 */
var CACHE_NAME = 'tally-v2';
var SHELL_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/data.js',
  './js/calc.js',
  './js/app.js',
  './manifest.json'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // addAll fails if any asset 404s, so use individual puts with catch
      return Promise.all(SHELL_ASSETS.map(function (url) {
        return fetch(url).then(function (r) {
          if (r.ok) return cache.put(url, r);
        }).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var url = e.request.url;

  /* Always hit the network for AI + food DB calls */
  if (url.includes('openrouter.ai') ||
      url.includes('openfoodfacts.org') ||
      url.includes('fonts.googleapis.com') ||
      url.includes('fonts.gstatic.com')) {
    e.respondWith(fetch(e.request).catch(function () {
      return new Response('', { status: 503 });
    }));
    return;
  }

  /* Cache-first for the app shell */
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      if (cached) return cached;
      return fetch(e.request).then(function (response) {
        if (response && response.status === 200 && e.request.method === 'GET') {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(e.request, clone); });
        }
        return response;
      });
    }).catch(function () {
      if (e.request.mode === 'navigate') {
        return caches.match('./index.html');
      }
    })
  );
});
