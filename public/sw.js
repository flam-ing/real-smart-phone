'use strict';
// Shows the phone's Android notifications pushed by the server; a tap opens the app.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  event.waitUntil(self.registration.showNotification(data.title || 'Real Smart Phone', {
    body: data.body || '', tag: data.tag, renotify: Boolean(data.tag),
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: self.registration.scope },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(w => w.url.startsWith(self.registration.scope));
    return open ? open.focus() : self.clients.openWindow(event.notification.data?.url || '/');
  })());
});
