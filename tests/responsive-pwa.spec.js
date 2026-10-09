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
});
