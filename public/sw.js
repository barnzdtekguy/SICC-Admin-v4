/* SICC Admin service worker: app-shell caching, offline fallback, and push notifications.
   API responses are NEVER cached (they contain personal data). */
const VERSION = 'sicc-v4-1';
const SHELL = ['/offline.html', '/manifest.json', '/icons/icon-192.png', '/salem-logo.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Page navigations: network first, offline page as the fallback.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
    return;
  }
  // Built, content-hashed assets: cache first (they never change for a given URL).
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(caches.match(request).then(hit => hit || fetch(request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(VERSION).then(cache => cache.put(request, copy)); }
      return response;
    })));
  }
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'SICC Admin', body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'SICC Admin', {
    body: data.body || '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { link: data.link || '/app/overview' }, tag: data.type || 'sicc',
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.link) || '/app/overview';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.includes(self.location.origin));
    if (open) { open.navigate(target); return open.focus(); }
    return self.clients.openWindow(target);
  }));
});
