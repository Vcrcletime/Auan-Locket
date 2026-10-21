const CACHE = 'auan-v8';
const FILES = ['./', './index.html', './manifest.json', './icon.svg', './icon-192.png', './badge-72.png', './cloud.js', './emoji.js', './firebase-config.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request))
  );
});

// ---- Web Push: "who sent what" notification ----
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'Auan', body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // the app is open in front of the user: the in-app banner already shows it
    if (cs.some(c => c.visibilityState === 'visible' && c.focused)) return;
    await self.registration.showNotification(d.title || 'Auan', {
      body: d.body || '',
      icon: './icon-192.png',
      badge: './badge-72.png',
      tag: d.tag || 'auan',
      renotify: true,
      vibrate: [90, 40, 90],
      data: { chat: d.chat || null }
    });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const chat = e.notification.data && e.notification.data.chat;
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of cs) {
      if ('focus' in c) { await c.focus(); if (chat) c.postMessage({ openChat: chat }); return; }
    }
    await self.clients.openWindow('./' + (chat ? `?chat=${chat.type}:${chat.id}` : ''));
  })());
});
