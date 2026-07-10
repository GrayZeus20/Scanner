const CACHE_NAME = 'webscanner-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/css/dark-mode.css',
  '/js/i18n.js',
  '/js/camera.js',
  '/js/editor.js',
  '/js/edge-detection.js',
  '/js/pdf-export.js',
  '/js/storage.js',
  '/js/ocr.js',
  '/js/app.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
