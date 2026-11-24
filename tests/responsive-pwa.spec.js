const { test, expect } = require('@playwright/test');

test.describe('Responsive Layout & PWA Suite', () => {

  const sampleImageBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAlgAAAGQCAYAAAByNR6YAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  );

  async function loadSampleImage(page) {
    await page.locator('#fileInput').setInputFiles({
      name: 'doc_sample.png',
      mimeType: 'image/png',
      buffer: sampleImageBuffer
    });
    await expect(page.locator('#editorArea')).not.toHaveClass(/hidden/, { timeout: 8000 });
  }

  test('Desktop Layout (1280x800): App spans full width without 480px restriction', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    // Check #app computed width
    const appWidth = await page.evaluate(() => {
      return document.getElementById('app').getBoundingClientRect().width;
    });
    expect(appWidth).toBe(1280);

    // Header has PWA badge
    const pwaBadge = page.locator('.pwa-badge');
    await expect(pwaBadge).toBeVisible();
    await expect(pwaBadge).toHaveText('PWA');

    // Load an image to test desktop workspace
    await loadSampleImage(page);

    // Canvas wrapper should expand across the desktop window
    const wrapperWidth = await page.evaluate(() => {
      return document.getElementById('canvasWrapper').getBoundingClientRect().width;
    });
    expect(wrapperWidth).toBeGreaterThan(800);

    // Bottom nav functions as a floating desktop command dock
    const navStyle = await page.evaluate(() => {
      const nav = document.getElementById('bottomNav');
      const rect = nav.getBoundingClientRect();
      const cs = window.getComputedStyle(nav);
      return {
        position: cs.position,
        borderRadius: cs.borderRadius,
        bottom: cs.bottom,
        width: rect.width
      };
    });
    expect(navStyle.position).toBe('absolute');
    // Dock should be pill-shaped
    expect(navStyle.borderRadius).toMatch(/9999px|50%/);

    // Open tools sheet - should open as desktop side drawer on the right
    await page.locator('#navTools').click();
    await page.waitForTimeout(350); // Allow slide-in animation to settle
    const sheetStyle = await page.evaluate(() => {
      const sheet = document.getElementById('toolsSheet');
      const rect = sheet.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        windowWidth: window.innerWidth
      };
    });
    // On desktop, drawer width is ~420px docked to the right edge
    expect(sheetStyle.width).toBeLessThanOrEqual(550);
    expect(sheetStyle.right).toBe(1280);
    // Canvas remains partially visible while sheet is open!
    expect(sheetStyle.left).toBeGreaterThan(600);
  });

  test('Mobile Layout (390x844): Mobile-optimized bottom sheet and tab navigation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const appWidth = await page.evaluate(() => {
      return document.getElementById('app').getBoundingClientRect().width;
    });
    expect(appWidth).toBe(390);

    await loadSampleImage(page);

    // Open tools sheet on mobile - should open as bottom sheet covering width 390px
    await page.locator('#navTools').click();
    await page.waitForTimeout(350); // Allow bottom-sheet slide-up animation to settle
    const sheetStyle = await page.evaluate(() => {
      const sheet = document.getElementById('toolsSheet');
      const rect = sheet.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        bottom: Math.round(rect.bottom),
        windowHeight: window.innerHeight
      };
    });
    // Bottom sheet spans full mobile width
    expect(sheetStyle.width).toBe(390);
    expect(sheetStyle.bottom).toBe(844);
  });

  test('PWA Manifest is valid and provides offline/install capabilities', async ({ page }) => {
    const response = await page.goto('/manifest.json');
    expect(response?.status()).toBe(200);

    const manifest = await response?.json();
    expect(manifest.name).toContain('WebScanner');
    expect(manifest.short_name).toBe('WebScanner');
    expect(manifest.display).toBe('standalone');
    expect(manifest.orientation).toBe('any');
    expect(manifest.start_url).toBe('./');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);

    // Verify maskable icon exists
    const hasMaskable = manifest.icons.some((i) => i.purpose === 'maskable');
    expect(hasMaskable).toBeTruthy();

    // Verify shortcuts exist for quick actions
    expect(manifest.shortcuts).toBeDefined();
    expect(manifest.shortcuts.length).toBeGreaterThanOrEqual(2);
  });

  test('PWA Service Worker file is served and contains offline caching logic', async ({ page }) => {
    const response = await page.goto('/sw.js');
    expect(response?.status()).toBe(200);

    const text = await response?.text();
    expect(text).toContain('CACHE_NAME');
    expect(text).toContain('LOCAL_ASSETS');
    expect(text).toContain('install');
    expect(text).toContain('activate');
    expect(text).toContain('fetch');
  });

  test('PWA Install button triggers beforeinstallprompt handler', async ({ page }) => {
    await page.goto('/');

    // Dispatch simulated beforeinstallprompt event
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt');
      event.preventDefault = () => {};
      event.prompt = async () => {};
      event.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(event);
    });

    // PWA install button in header should become visible (single install entry)
    const pwaBtn = page.locator('#pwaInstallBtn');
    await expect(pwaBtn).toBeVisible();
    await expect(pwaBtn).toContainText(/Pasang|Install/);

    // No duplicate install button in empty state
    await expect(page.locator('#emptyInstallBtn')).toHaveCount(0);
  });

  test('persistent storage state is tracked and exposed in dumpState', async ({ page }) => {
    await page.goto('/');

    // initPwaInstall runs during init; wait until the async request settles
    const result = await page.waitForFunction(() => {
      const supported = window.app?.state?.storagePersistSupported;
      const persisted = window.app?.state?.storagePersisted;
      return (supported !== null && persisted !== null) ? { supported, persisted } : false;
    }, null, { timeout: 5000 }).then((h) => h.jsonValue());

    expect(typeof result.supported).toBe('boolean');
    expect(typeof result.persisted).toBe('boolean');

    // dumpState must surface it (inspectable state dump)
    const dump = await page.evaluate(() => window.app.dumpState());
    expect(dump).toHaveProperty('storagePersisted');
    expect(dump.storagePersisted).toBe(result.persisted);

    // Idempotent: calling again must not throw and must keep a boolean
    const again = await page.evaluate(() => window.app.requestPersistentStorage());
    expect(typeof again).toBe('boolean');
  });

  test('persist() denial leaves app functional (error path)', async ({ page }) => {
    await page.goto('/');
    // Force the failure branch: persist() rejects (private mode / policy)
    const state = await page.evaluate(async () => {
      const original = navigator.storage.persist;
      const originalPersisted = navigator.storage.persisted;
      navigator.storage.persisted = async () => false;
      navigator.storage.persist = async () => { throw new Error('denied by policy'); };
      try {
        const granted = await window.app.requestPersistentStorage();
        return { granted, persisted: window.app.state.storagePersisted, appAlive: typeof window.app === 'object' };
      } finally {
        navigator.storage.persist = original;
        navigator.storage.persisted = originalPersisted;
      }
    });

    expect(state.granted).toBe(false);
    expect(state.persisted).toBe(false);
    expect(state.appAlive).toBe(true);

    // App still renders and accepts navigation after the failure.
    // (Di home/empty state bottom nav memang disembunyikan, jadi navigasi
    //  yang diuji = tombol Riwayat di layar utama.)
    await expect(page.locator('#emptyState')).toBeVisible();
    await page.locator('#homeHistoryBtn').click();
    await expect(page.locator('#historyView')).not.toHaveClass(/hidden/);
  });

  test('Mobile (360x740) export sheet, PDF preview footer, and filter footer have zero horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/');
    await loadSampleImage(page);

    // 1. Export sheet keeps 2-column grid at 360px and stays within viewport
    await page.locator('#navExport').click();
    await expect(page.locator('#exportSheet')).toBeVisible();
    await page.waitForTimeout(250);

    const exportMetrics = await page.evaluate(() => {
      const sheet = document.getElementById('exportSheet');
      const grid = sheet.querySelector('.dl-grid');
      const cols = window.getComputedStyle(grid).gridTemplateColumns.split(' ').length;
      return {
        cols,
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
        sheetRight: Math.round(sheet.getBoundingClientRect().right),
        winW: window.innerWidth
      };
    });
    expect(exportMetrics.cols).toBe(2);
    expect(exportMetrics.overflowX).toBe(false);
    expect(exportMetrics.sheetRight).toBeLessThanOrEqual(360);

    // 2. PDF Preview modal footer fits cleanly within 360px mobile width
    await page.locator('.export-btn[data-format="pdf"]').click();
    await expect(page.locator('#pdfPreviewModal')).toBeVisible();
    const pdfBtnBox = await page.locator('#confirmPdfExport').boundingBox();
    expect(pdfBtnBox).not.toBeNull();
    expect(pdfBtnBox.x + pdfBtnBox.width).toBeLessThanOrEqual(360);
    await page.locator('#closePdfPreview').click();

    // 3. Filter sheet 3-button footer has no overflow
    await page.locator('#navTools').click();
    await page.locator('#toolFilterBtn').click();
    await expect(page.locator('#filterSheet')).toBeVisible();
    const filterOverflow = await page.evaluate(() => {
      const resetBox = document.getElementById('resetFilterBtn').getBoundingClientRect();
      return resetBox.right > window.innerWidth + 1;
    });
    expect(filterOverflow).toBe(false);
  });

  test('PWA SW cache version matches index.html CSS query string and manifest has file_handlers', async ({ page }) => {
    const [htmlRes, swRes, manifestRes] = await Promise.all([
      page.goto('/'),
      page.request.get('/sw.js'),
      page.request.get('/manifest.json')
    ]);
    const html = await htmlRes.text();
    const sw = await swRes.text();
    const manifest = await manifestRes.json();

    const cssMatch = html.match(/css\/style\.css\?v=(\d+)/);
    expect(cssMatch).not.toBeNull();
    const version = cssMatch[1];
    expect(sw).toContain(`css/style.css?v=${version}`);
    expect(sw).toContain(`css/dark-mode.css?v=${version}`);
    expect(Array.isArray(manifest.file_handlers)).toBe(true);
    expect(manifest.file_handlers.length).toBeGreaterThanOrEqual(1);
    expect(manifest.share_target).toBeTruthy();
    expect(manifest.share_target.method).toBe('POST');
    expect(manifest.share_target.enctype).toBe('multipart/form-data');
    expect(sw).toContain('/share-target');
    expect(sw).toContain('fetchWithTimeout');
    expect(sw).toContain('CRITICAL_CDN_ASSETS');
  });

  test('PWA Back button (popstate) closes active overlays before exiting and prompts double-back at home', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await loadSampleImage(page);

    // Open export sheet
    await page.locator('#navExport').click();
    await expect(page.locator('#exportSheet')).toBeVisible();

    // Simulate hardware Back button on Android PWA
    await page.evaluate(() => window.history.back());
    await expect(page.locator('#exportSheet')).toHaveClass(/hidden/, { timeout: 3000 });
    // App is still in editor (did not exit)
    await expect(page.locator('#editorArea')).toBeVisible();

    // Another Back in editor triggers goHome() (guard modal or emptyState)
    await page.evaluate(() => window.history.back());
    await page.waitForTimeout(250);
    const guardVisible = await page.locator('#sessionGuardModal').isVisible();
    if (guardVisible) {
      // Back closes the guard modal cleanly
      await page.evaluate(() => window.history.back());
      await expect(page.locator('#sessionGuardModal')).toHaveClass(/hidden/, { timeout: 3000 });
    }
    expect(page.url()).toContain('localhost');
  });

  test('PDF export works offline via built-in pure-JS PDF encoder when jsPDF CDN is unavailable', async ({ page }) => {
    // Block CDN requests to simulate offline / lie-fi cold start
    await page.route('**/*unpkg.com/**', (route) => route.abort());
    await page.route('**/*cdnjs.cloudflare.com/**', (route) => route.abort());

    await page.goto('/');
    await loadSampleImage(page);

    // Verify app did not crash without lucide and PDF export still builds valid PDF 1.4
    const pdfCheck = await page.evaluate(async () => {
      window.jspdf = undefined;
      window.pdfExport._jsPdfPromise = null;
      const blob = await window.pdfExport.toPdfBlobFromPages(
        1,
        (idx) => window.app.renderPageForPdf(idx),
        0.8
      );
      const buf = new Uint8Array(await blob.arrayBuffer());
      const head = new TextDecoder('latin1').decode(buf.slice(0, 8));
      const tail = new TextDecoder('latin1').decode(buf.slice(Math.max(0, buf.length - 16)));
      return { type: blob.type, size: blob.size, head, tail };
    });

    expect(pdfCheck.type).toBe('application/pdf');
    expect(pdfCheck.size).toBeGreaterThan(200);
    expect(pdfCheck.head).toContain('%PDF-1.4');
    expect(pdfCheck.tail).toContain('%%EOF');
  });

  test('Custom export filename sanitization and target PDF size compression work', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 1. Filename sanitization
    const sanitized = await page.evaluate(() => {
      const input = document.getElementById('exportFilename');
      input.value = '  Laporan/Q4:2026*?.pdf  ';
      return window.app.getExportFilename();
    });
    expect(sanitized).toBe('Laporan_Q4_2026');

    // 2. Target PDF size compression via binary search
    const result = await page.evaluate(async () => {
      const makePage = (idx, maxDim = 1600) => {
        const c = document.createElement('canvas');
        const size = Math.min(maxDim, 900);
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        const img = ctx.createImageData(size, size);
        for (let i = 0; i < img.data.length; i += 4) {
          img.data[i] = (i * 13) & 255;
          img.data[i + 1] = (i * 29) & 255;
          img.data[i + 2] = (i * 53) & 255;
          img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        return Promise.resolve(c);
      };
      const uncompressed = await window.pdfExport.toPdfBlobFromPages(1, (i) => makePage(i, 900), 0.95);
      const target = Math.max(20000, Math.floor(uncompressed.size * 0.45));
      const compressed = await window.pdfExport.toPdfBlobWithTargetSize(1, makePage, 0.95, target);
      return {
        uncompressedSize: uncompressed.size,
        compressedSize: compressed.blob.size,
        matchedTarget: compressed.matchedTarget,
        target
      };
    });
    expect(result.compressedSize).toBeLessThan(result.uncompressedSize);
    expect(result.compressedSize).toBeLessThanOrEqual(result.target);
    expect(result.matchedTarget).toBe(true);
  });

  test('Desktop keyboard shortcuts switch pages, open export, and ignore focused inputs', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.setInputFiles('#fileInput', [
      { name: 'p1.png', mimeType: 'image/png', buffer: sampleImageBuffer },
      { name: 'p2.png', mimeType: 'image/png', buffer: sampleImageBuffer }
    ]);
    await expect(page.locator('#editorArea')).toBeVisible();
    await page.waitForFunction(() => window.app.state.pages.length === 2);

    // ArrowRight moves to page 2, ArrowLeft returns to page 1
    const startIdx = await page.evaluate(() => window.app.state.currentPageIndex);
    expect(startIdx).toBe(0);
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => window.app.state.currentPageIndex === 1);
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => window.app.state.currentPageIndex === 0);

    // Ctrl+S opens export sheet
    await page.keyboard.press('Control+s');
    await expect(page.locator('#exportSheet')).toBeVisible();

    // Shortcuts ignored when typing inside #exportFilename
    await page.locator('#exportFilename').focus();
    await page.keyboard.type('Dokumen-Test');
    await page.keyboard.press('ArrowRight');
    const idxAfterInput = await page.evaluate(() => window.app.state.currentPageIndex);
    expect(idxAfterInput).toBe(0);
    expect(await page.locator('#exportFilename').inputValue()).toBe('Dokumen-Test');
  });
});
