// Offline support: app shell is cached; market data is network-first with the cached copy as fallback.
const VERSION = 'v3';
const SHELL = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icon.svg', 'demo.json',
  'js/app.js', 'js/engine.js', 'js/data.js', 'js/ui.js', 'js/store.js', 'js/importers.js',
  'js/brokers.js', 'js/masterchart.js', 'js/masterdata.js', 'js/sync.js', 'js/bonds.js', 'js/goals.js', 'js/i18n.js', 'js/customassets.js', 'js/treemap.js',
  'js/views/analysis.js', 'js/views/calendar.js', 'js/views/common.js', 'js/views/dashboard.js', 'js/views/dividends.js', 'js/views/goals.js', 'js/views/holdings.js', 'js/views/index.js', 'js/views/rebalance.js', 'js/views/settings.js', 'js/views/taxes.js', 'js/views/transactions.js', 'js/views/watchlist.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const sameOrigin = url.origin === location.origin;
  const isCdn = /cdn\.jsdelivr\.net$/.test(url.hostname);
  if (!sameOrigin && !isCdn) return; // GitHub API etc. go straight to the network
  // network first (fresh prices and code), cache as fallback when offline
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
