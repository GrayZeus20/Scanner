const CACHE_NAME = 'webscanner-v21';
const SHARE_CACHE = 'webscanner-share-target';

const LOCAL_ASSETS = [
  './',
  'index.html',
  // Kunci cache HARUS sama dengan URL request di index.html (?v=21),
  // kalau tidak, cold start offline tidak match → halaman tanpa style
  'css/style.css?v=21',
  'css/dark-mode.css?v=21',
  'js/config.js',
  'js/i18n.js',
  'js/camera.js',
  'js/edge-detection.js',
  'js/ml-detector.js',
  'js/manual-crop.js',
  'js/pdf-export.js',
  'js/storage.js',
  'js/deepscan.js',
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
      keys.filter((key) => key !== CACHE_NAME && key !== SHARE_CACHE).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Web Share Target API: receive shared image/PDF files via POST and hand off to app
  if (request.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/share-target')) {
    event.respondWith((async () => {
      try {
        const formData = await request.formData();
        const files = formData.getAll('media').filter((f) => f && typeof f.arrayBuffer === 'function');
        const cache = await caches.open(SHARE_CACHE);
        const manifest = [];
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          const key = `./__shared_file_${i}`;
          await cache.put(key, new Response(f, {
            headers: { 'Content-Type': f.type || 'application/octet-stream' }
          }));
          manifest.push({ key, name: f.name || `shared_${i + 1}.jpg`, type: f.type || 'image/jpeg' });
        }
        await cache.put('./__shared_manifest', new Response(JSON.stringify(manifest), {
          headers: { 'Content-Type': 'application/json' }
        }));
      } catch (err) {
        console.warn('SW share-target error:', err);
      }
      return Response.redirect('./?action=share-target', 303);
    })());
    return;
  }

  if (request.method !== 'GET') return;

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
        }).catch(async () => {
          const fallback = await caches.match(request);
          return fallback || new Response('', { status: 503, statusText: 'Offline' });
        });
      })
    );
  }
});
