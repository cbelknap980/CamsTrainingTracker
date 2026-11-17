// sw.js - service worker: caches the app files so it opens with no signal.
// Bump VERSION on every publish; the old cache is deleted on activate.
const VERSION = 'v1.0.0';
const CACHE = `ctt-${VERSION}`;
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js', './js/builder.js', './js/player.js', './js/logger.js', './js/progression.js',
  './js/store.js', './js/export.js', './js/architecture.js', './js/data.js', './js/ui.js',
  './data/plan.json', './data/rules.json', './data/settings.json', './data/architecture.json',
  './vendor/xlsx.mini.min.js',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Network first for the app's own files when online (so a new publish shows up), cache fallback offline.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
