const CACHE_NAME = 'webscanner-v13';

const LOCAL_ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'css/dark-mode.css',
  'js/config.js',
  'js/i18n.js',
  'js/camera.js',
  'js/edge-detection.js',
  'js/ml-detector.js',
  'js/manual-crop.js',
  'js/pdf-export.js',
  'js/storage.js',
  'js/ocr.js',
  'js/inpaint.js',
  'js/ai.js',
  'js/app.js',
  'js/filter-worker.js',
  'manifest.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache local assets with individual error resilience
      for (const asset of LOCAL_ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn('SW: Failed caching asset:', asset, err);
        }
      }
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
  const isLocal = url.origin === self.location.origin;

  // Local resources: network-first with offline cache fallback
  if (isLocal) {
    event.respondWith(
      fetch(request).then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        // Navigation fallback to index.html
        if (request.mode === 'navigate') {
          return caches.match('index.html');
        }
        return new Response('Offline - asset not cached', { status: 503 });
      })
    );
    return;
  }

  // CDN & ML Model resources: Cache-First for instant offline ML & libraries
  const isCDN = url.hostname === 'unpkg.com' ||
    url.hostname === 'cdnjs.cloudflare.com' ||
    url.hostname === 'cdn.jsdelivr.net' ||
    url.hostname === 'storage.googleapis.com' ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com';

  if (isCDN) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && (response.ok || response.type === 'opaque')) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        }).catch(() => {
          return caches.match(request);
        });
      })
    );
  }
});
