/* Service worker: app disponible sin señal + reintento de envío (Background Sync) */
var CACHE = 'hc-actas-v1.2.0';
var SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/pdf.js', 'js/outbox-core.js',
  'vendor/jspdf.umd.min.js', 'vendor/signature_pad.umd.min.js',
  'assets/logo.jpg', 'assets/logo-ui.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-64.png'
];
importScripts('js/outbox-core.js');

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('hc-actas-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                       // los POST de envío van directo a la red
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') >= 0) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then(function (r) { return r || fetch(req); }));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (r) {
    return r || fetch(req).then(function (resp) {
      if (resp && resp.ok) { var cp = resp.clone(); caches.open(CACHE).then(function (c) { c.put(req, cp); }); }
      return resp;
    });
  }));
});
self.addEventListener('sync', function (e) {
  if (e.tag !== 'enviar-actas') return;
  e.waitUntil(self.HC.processOutbox().then(function (r) {
    if (r && (r.failed || r.offline)) throw new Error('Quedan actas pendientes; el navegador reintentará');
  }));
});
self.addEventListener('message', function (e) {
  if (e.data === 'outbox') e.waitUntil(self.HC.processOutbox());
});
