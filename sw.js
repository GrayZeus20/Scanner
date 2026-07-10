const CACHE_NAME = 'webscanner-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/css/dark-mode.css',
  '/js/i18n.js',
  '/js/camera.js',
  '/js/edge-detection.js',
  '/js/pdf-export.js',
  '/js/storage.js',
  '/js/ocr.js',
  '/js/app.js',
  '/manifest.json',
  'https://unpkg.com/lucide@latest',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const asset of ASSETS) {
        try {
          await cache.add(asset);
        } catch (error) {
          console.warn('Failed to cache asset', asset, error);
        }
      }
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const copy = response.clone();
        const cacheable = request.url.startsWith(self.location.origin) || request.url.startsWith('https://unpkg.com') || request.url.startsWith('https://cdnjs.cloudflare.com') || request.url.startsWith('https://cdn.jsdelivr.net');
        if (cacheable && response.ok) {
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
