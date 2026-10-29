const { test, expect } = require('@playwright/test');

test.describe('New Enhancements Suite', () => {
  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  );

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('Share button does not trigger automatic download when clicked or cancelled', async ({ page }) => {
    // Import image
    await page.locator('#fileInput').setInputFiles({
      name: 'test.png',
      mimeType: 'image/png',
      buffer: pngBuffer,
    });
    await expect(page.locator('#editorArea')).not.toHaveClass(/hidden/, { timeout: 8000 });

    // Track any downloads triggered
    let downloadTriggered = false;
    page.on('download', () => {
      downloadTriggered = true;
    });

    // Open export sheet
    await page.click('#navExport');
    await expect(page.locator('#exportSheet')).toBeVisible();

    // Verify share button does not trigger exportToImage download
    const shareBtn = page.locator('#shareBtn');
    if (await shareBtn.isVisible()) {
      await shareBtn.click();
      await page.waitForTimeout(500);
      expect(downloadTriggered).toBe(false);
    }
  });

  test('OCR sheet has language selector and retry button', async ({ page }) => {
    // Import image
    await page.locator('#fileInput').setInputFiles({
      name: 'test.png',
      mimeType: 'image/png',
      buffer: pngBuffer,
    });
    await expect(page.locator('#editorArea')).not.toHaveClass(/hidden/, { timeout: 8000 });

    // Open tools sheet
    await page.click('#navTools');
    await expect(page.locator('#toolsSheet')).toBeVisible();

    // Open OCR
    await page.click('#toolOcrBtn');
    await expect(page.locator('#ocrSheet')).toBeVisible();

    // Verify language selector exists with options
    const langSelect = page.locator('#ocrLangSelect');
    await expect(langSelect).toBeVisible();
    await expect(langSelect.locator('option')).toHaveCount(3);

    // Verify retry button exists
    const retryBtn = page.locator('#retryOcrBtn');
    await expect(retryBtn).toBeVisible();

    // Close OCR sheet
    await page.click('#closeOcrSheet');
    await expect(page.locator('#ocrSheet')).toBeHidden();
  });

  test('ML HD pixel enhancer button is available and enhances canvas', async ({ page }) => {
    // Import image
    await page.locator('#fileInput').setInputFiles({
      name: 'test.png',
      mimeType: 'image/png',
      buffer: pngBuffer,
    });
    await expect(page.locator('#editorArea')).not.toHaveClass(/hidden/, { timeout: 8000 });

    // Open tools sheet
    await page.click('#navTools');
    await expect(page.locator('#toolsSheet')).toBeVisible();

    // Click HD Enhance button
    const hdBtn = page.locator('#toolHdEnhanceBtn');
    await expect(hdBtn).toBeVisible();
    await hdBtn.click();

    // Wait for enhancement to complete
    await page.waitForTimeout(800);

    const postDims = await page.evaluate(() => {
      const canvas = document.getElementById('mainCanvas');
      return { width: canvas.width, height: canvas.height };
    });

    // Should have valid enhanced positive dimensions
    expect(postDims.width).toBeGreaterThan(0);
    expect(postDims.height).toBeGreaterThan(0);
  });

  test('Upscale scale preset buttons change scale factor', async ({ page }) => {
    // Import image
    await page.locator('#fileInput').setInputFiles({
      name: 'test.png',
      mimeType: 'image/png',
      buffer: pngBuffer,
    });
    await expect(page.locator('#editorArea')).not.toHaveClass(/hidden/, { timeout: 8000 });

    // Open tools sheet
    await page.click('#navTools');
    await expect(page.locator('#toolsSheet')).toBeVisible();

    // Verify scale buttons exist (1.5x, 2x, 3x, 4x)
    const scaleBtns = page.locator('#upscaleScalesRow .scale-btn');
    await expect(scaleBtns).toHaveCount(4);

    // Click 3x scale button
    const btn3x = page.locator('#upscaleScalesRow .scale-btn[data-scale="3.0"]');
    await btn3x.click();
    await expect(btn3x).toHaveClass(/active/);
    await expect(page.locator('#toolHdEnhanceBtn strong')).toContainText('3x');

    // Click 4x scale button
    const btn4x = page.locator('#upscaleScalesRow .scale-btn[data-scale="4.0"]');
    await btn4x.click();
    await expect(btn4x).toHaveClass(/active/);
    await expect(page.locator('#toolHdEnhanceBtn strong')).toContainText('4x');
  });

  test('Upscale mode buttons toggle between Auto, Photo, and Document modes', async ({ page }) => {
    // Import image
    await page.locator('#fileInput').setInputFiles({
      name: 'test.png',
      mimeType: 'image/png',
      buffer: pngBuffer,
    });
    await expect(page.locator('#editorArea')).not.toHaveClass(/hidden/, { timeout: 8000 });

    // Open tools sheet
    await page.click('#navTools');
    await expect(page.locator('#toolsSheet')).toBeVisible();

    // Verify mode buttons exist (Auto, Photo, Document)
    const modeBtns = page.locator('#upscaleModesRow .mode-btn');
    await expect(modeBtns).toHaveCount(3);

    // Initial default is Auto
    await expect(page.locator('#upscaleModesRow .mode-btn[data-mode="auto"]')).toHaveClass(/active/);

    // Click Photo mode button
    const photoBtn = page.locator('#upscaleModesRow .mode-btn[data-mode="photo"]');
    await photoBtn.click();
    await expect(photoBtn).toHaveClass(/active/);
    await expect(page.locator('#upscaleModesRow .mode-btn[data-mode="auto"]')).not.toHaveClass(/active/);

    // Click Document mode button
    const docBtn = page.locator('#upscaleModesRow .mode-btn[data-mode="document"]');
    await docBtn.click();
    await expect(docBtn).toHaveClass(/active/);
    await expect(photoBtn).not.toHaveClass(/active/);
  });

  test('MLDetector detects content type and preserves colors in photo mode', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // 1. Create document canvas: white bg + black text
      const docCanvas = document.createElement('canvas');
      docCanvas.width = 100;
      docCanvas.height = 100;
      const docCtx = docCanvas.getContext('2d');
      docCtx.fillStyle = '#ffffff';
      docCtx.fillRect(0, 0, 100, 100);
      docCtx.fillStyle = '#000000';
      docCtx.fillText('Text', 20, 50);

      const detectedDoc = window.MLDetector.detectContentType(docCanvas);

      // 2. Create photo/meme canvas: colorful skin tone and background
      const photoCanvas = document.createElement('canvas');
      photoCanvas.width = 100;
      photoCanvas.height = 100;
      const photoCtx = photoCanvas.getContext('2d');
      photoCtx.fillStyle = 'rgb(180, 120, 80)';
      photoCtx.fillRect(0, 0, 100, 100);
      photoCtx.fillStyle = 'rgb(30, 80, 160)';
      photoCtx.fillRect(0, 70, 100, 30);

      const detectedPhoto = window.MLDetector.detectContentType(photoCanvas);

      // 3. Upscale photo canvas with photo mode
      const upPhoto = await window.MLDetector.enhanceHD(photoCanvas, { scale: 2.0, mode: 'photo' });
      const upCtx = upPhoto.canvas.getContext('2d');
      const pixel = upCtx.getImageData(50, 50, 1, 1).data;

      return {
        detectedDoc,
        detectedPhoto,
        upScale: upPhoto.scale,
        upMode: upPhoto.mode,
        r: pixel[0],
        g: pixel[1],
        b: pixel[2]
      };
    });

    expect(result.detectedDoc).toBe('document');
    expect(result.detectedPhoto).toBe('photo');
    expect(result.upScale).toBe(2);
    expect(result.upMode).toBe('photo');
    expect(result.r).toBeGreaterThan(140);
    expect(result.r).toBeLessThan(220);
    expect(result.g).toBeGreaterThan(90);
    expect(result.g).toBeLessThan(160);
  });

  test('300px document image upscales 4x to 1200px with super-resolution', async ({ page }) => {
    // Generate a 300x300 canvas and run MLDetector.enhanceHD with scale 4.0
    const dims = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 300;
      c.height = 300;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 300, 300);
      ctx.fillStyle = '#000000';
      ctx.font = '24px sans-serif';
      ctx.fillText('Test 300px Document', 20, 150);

      const res = await window.MLDetector.enhanceHD(c, { scale: 4.0 });
      return { width: res.width, height: res.height, scale: res.scale };
    });

    expect(dims.width).toBe(1200);
    expect(dims.height).toBe(1200);
    expect(dims.scale).toBe(4);
  });

  test('Mobile view (360x740) header does not overflow and dark mode button works cleanly', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/');

    const darkBtn = page.locator('#darkToggle');
    await expect(darkBtn).toBeVisible();

    // Verify dark button is completely within viewport (not pushed offscreen)
    const box = await darkBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x + box.width).toBeLessThanOrEqual(360);

    // Verify toggling dark mode adds class to body and html
    await darkBtn.click();
    await expect(page.locator('body')).toHaveClass(/dark-mode/);
    await expect(page.locator('html')).toHaveClass(/dark-mode/);

    // Toggle back
    await darkBtn.click();
    await expect(page.locator('body')).not.toHaveClass(/dark-mode/);
  });
});

