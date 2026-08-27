const CACHE_NAME = 'webscanner-v8';
const BASE_PATH = self.location.pathname.replace(/\/sw\.js$/, '/').replace(/\/[^\/]*$/, '/');
const ASSETS = [
  'index.html',
  'css/style.css',
  'css/dark-mode.css',
  'js/config.js',
  'js/i18n.js',
  'js/camera.js',
  'js/edge-detection.js',
  'js/manual-crop.js',
  'js/pdf-export.js',
  'js/storage.js',
  'js/ocr.js',
  'js/inpaint.js',
  'js/ai.js',
  'js/app.js',
  'js/filter-worker.js',
  'manifest.json',
  'https://unpkg.com/lucide@0.460.0',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isShell = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');

  if (isShell) {
    event.respondWith(
      fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      }).catch(() => caches.match(request).then((cached) => cached || caches.match('index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const copy = response.clone();
        const cacheable = url.origin === self.location.origin || 
          url.hostname === 'unpkg.com' || 
          url.hostname === 'cdnjs.cloudflare.com' || 
          url.hostname === 'cdn.jsdelivr.net';
        if (cacheable && response.ok) {
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => caches.match('index.html'));
    })
  );
});
