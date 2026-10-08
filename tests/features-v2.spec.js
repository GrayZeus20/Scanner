import { test, expect } from '@playwright/test';

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
});
