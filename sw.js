// sw.js - service worker: caches the app files so it opens with no signal, and fires the rest-end
// notification when the app is in the background. Bump VERSION on every publish.
const VERSION = 'v1.4.0';
const CACHE = `ctt-${VERSION}`;
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js', './js/builder.js', './js/player.js', './js/logger.js', './js/progression.js',
  './js/store.js', './js/export.js', './js/architecture.js', './js/data.js', './js/ui.js', './js/icons.js',
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
// cache: 'no-cache' makes the browser revalidate with GitHub Pages instead of reusing its 10-minute HTTP cache.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req, { cache: 'no-cache' }).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});

// ---- rest-end notification while the page is hidden ----
// The page posts { type: 'schedule-rest-end', endAt, title, body } when it goes to the background during a
// countdown, and 'cancel-rest-end' when it comes back or moves to the next step. The page also shows the
// notification itself if its own (throttled) timer fires first; the tag keeps it to one notification.
let pending = null;
self.addEventListener('message', event => {
  const msg = event.data || {};
  if (msg.type === 'schedule-rest-end') {
    if (pending) clearTimeout(pending.timer);
    const delay = Math.max(0, msg.endAt - Date.now());
    pending = { endAt: msg.endAt };
    pending.timer = setTimeout(() => {
      pending = null;
      self.registration.showNotification(msg.title || 'Rest done', {
        body: msg.body || '', tag: 'rest-end', renotify: true, vibrate: [200, 100, 200],
        icon: 'icons/icon-192.png', badge: 'icons/icon-192.png'
      });
    }, delay);
  } else if (msg.type === 'cancel-rest-end') {
    if (pending) { clearTimeout(pending.timer); pending = null; }
    self.registration.getNotifications({ tag: 'rest-end' }).then(ns => ns.forEach(n => n.close()));
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list.find(x => 'focus' in x);
    if (c) return c.focus();
    return self.clients.openWindow('./');
  }));
});
