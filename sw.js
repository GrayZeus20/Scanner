const CACHE_NAME = 'webscanner-v22';
const SHARE_CACHE = 'webscanner-share-target';

const LOCAL_ASSETS = [
  './',
  'index.html',
  // Kunci cache HARUS sama dengan URL request di index.html (?v=22),
  // kalau tidak, cold start offline tidak match → halaman tanpa style
  'css/style.css?v=22',
  'css/dark-mode.css?v=22',
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

// CDN kritis yang di-precache best-effort agar export PDF & ikon tetap jalan saat offline
const CRITICAL_CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://unpkg.com/lucide@0.460.0'
];

function fetchWithTimeout(request, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

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
      // Best-effort precache critical CDN libs with short timeout so install never stalls
      await Promise.allSettled(
        CRITICAL_CDN_ASSETS.map(async (url) => {
          try {
            const res = await fetchWithTimeout(url, 5000);
            if (res && (res.ok || res.type === 'opaque')) {
              await cache.put(url, res);
            }
          } catch (_) {}
        })
      );
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

  // Local resources: anti-lie-fi (fast timeout fallback to offline cache)
  if (isLocal) {
    // 1. Navigation (HTML): Network with 2s timeout -> instant offline cache fallback
    if (request.mode === 'navigate') {
      event.respondWith((async () => {
        try {
          const response = await fetchWithTimeout(request, 2000);
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        } catch (_) {
          const cached = (await caches.match(request)) || (await caches.match('index.html')) || (await caches.match('./'));
          if (cached) return cached;
          return new Response('Offline - halaman belum tersimpan di cache', { status: 503 });
        }
      })());
      return;
    }

    // 2. Local static assets (CSS/JS/icons): Cache-First + background refresh (Stale-While-Revalidate)
    // Menghindari layar macet saat jaringan lemah / lie-fi
    event.respondWith((async () => {
      const cached = await caches.match(request);
      const networkPromise = fetchWithTimeout(request, 2500).then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => null);

      if (cached) {
        event.waitUntil(networkPromise);
        return cached;
      }
      const netRes = await networkPromise;
      if (netRes) return netRes;
      return new Response('Offline - asset not cached', { status: 503 });
    })());
    return;
  }

  // CDN & ML Model resources: Cache-First with short timeout so lie-fi never stalls app/export
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
        return fetchWithTimeout(request, 3500).then((response) => {
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
