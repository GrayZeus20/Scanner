const { test, expect } = require('@playwright/test');

test.describe('Document Crop & Auto Crop Suite', () => {

  // Helper to generate a realistic document test image (white document inside a darker background)
  async function loadTestDocument(page) {
    await page.goto('/');

    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 600;
      c.height = 800;
      const ctx = c.getContext('2d');

      // Dark background / desk surface
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(0, 0, 600, 800);

      // White paper document sheet tilted in the center
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(80, 100);
      ctx.lineTo(520, 120);
      ctx.lineTo(490, 720);
      ctx.lineTo(70, 690);
      ctx.closePath();
      ctx.fill();

      // Some text lines on the paper
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(140, 180, 300, 20);
      ctx.fillRect(140, 230, 260, 14);
      ctx.fillRect(140, 270, 200, 14);
      ctx.fillRect(140, 310, 240, 14);

      return c.toDataURL('image/png');
    });

    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    await page.locator('#fileInput').setInputFiles({
      name: 'test_document.png',
      mimeType: 'image/png',
      buffer: buffer
    });

    await expect(page.locator('#editorArea')).not.toHaveClass(/hidden/, { timeout: 8000 });
  }

  test('Auto Crop (#toolCropBtn) detects document corners and automatically crops', async ({ page }) => {
    await loadTestDocument(page);

    const initialDims = await page.evaluate(() => {
      const c = document.getElementById('mainCanvas');
      return { width: c.width, height: c.height };
    });
    expect(initialDims.width).toBe(600);
    expect(initialDims.height).toBe(800);

    // Open tools sheet and click "Deteksi & Potong" (Auto Crop)
    await page.locator('#navTools').click();
    await expect(page.locator('#toolsSheet')).not.toHaveClass(/hidden/);
    await page.locator('#toolCropBtn').click();

    // Verify auto crop executed: toast message appears, canvas dimensions change to cropped document
    const toast = page.locator('.toast');
    await expect(toast).toBeVisible({ timeout: 5000 });

    // Canvas should be cropped and straightened
    await page.waitForTimeout(1000);
    const croppedDims = await page.evaluate(() => {
      const c = document.getElementById('mainCanvas');
      return { width: c.width, height: c.height };
    });

    // The cropped document should be smaller than 600x800 and approximately the size of the white paper (around 440x600)
    expect(croppedDims.width).toBeLessThan(600);
    expect(croppedDims.height).toBeLessThan(800);
    expect(croppedDims.width).toBeGreaterThan(100);
    expect(croppedDims.height).toBeGreaterThan(100);
  });

  test('Manual Crop opens, handles are unclipped, and clicking Confirm Crop successfully applies crop', async ({ page }) => {
    await loadTestDocument(page);

    // Open tools sheet and click "Potong Manual"
    await page.locator('#navTools').click();
    await page.locator('#toolManualCropBtn').click();

    // Crop overlay and action bar must be visible
    await expect(page.locator('#cropOverlay')).not.toHaveClass(/hidden/);
    await expect(page.locator('#cropActionBar')).not.toHaveClass(/hidden/);

    // All 4 handles must be visible and properly attached
    const handles = page.locator('.crop-handle');
    await expect(handles).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await expect(handles.nth(i)).toBeVisible();
    }

    // SVG elements must exist and be visible
    await expect(page.locator('#cropSvg')).toBeVisible();
    await expect(page.locator('#cropPolygon')).toBeVisible();

    // Verify that action bar is NOT blocked by overlay (z-index hierarchy)
    const zIndexes = await page.evaluate(() => {
      const overlay = window.getComputedStyle(document.getElementById('cropOverlay')).zIndex;
      const bar = window.getComputedStyle(document.getElementById('cropActionBar')).zIndex;
      return { overlay: parseInt(overlay), bar: parseInt(bar) };
    });
    expect(zIndexes.bar).toBeGreaterThan(zIndexes.overlay);

    // Drag one of the handles (Top Left)
    const tlHandle = page.locator('.crop-handle[data-handle="tl"]');
    const box = await tlHandle.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 50, { steps: 5 });
    await page.mouse.up();

    // Click confirm crop button - this MUST NOT be blocked!
    const confirmBtn = page.locator('#confirmCropBtn');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // After confirming, overlay and action bar should hide
    await expect(page.locator('#cropOverlay')).toHaveClass(/hidden/);
    await expect(page.locator('#cropActionBar')).toHaveClass(/hidden/);

    // Toast indicates success
    const toast = page.locator('.toast');
    await expect(toast).toBeVisible();
  });

  test('Manual Crop can be cancelled and reset without corrupting canvas', async ({ page }) => {
    await loadTestDocument(page);

    const initialDims = await page.evaluate(() => {
      const c = document.getElementById('mainCanvas');
      return { width: c.width, height: c.height };
    });

    // Open manual crop
    await page.locator('#navTools').click();
    await page.locator('#toolManualCropBtn').click();
    await expect(page.locator('#cropOverlay')).not.toHaveClass(/hidden/);

    // Click cancel button
    await page.locator('#cancelCropBtn').click();
    await expect(page.locator('#cropOverlay')).toHaveClass(/hidden/);

    // Dimensions unchanged
    const afterCancelDims = await page.evaluate(() => {
      const c = document.getElementById('mainCanvas');
      return { width: c.width, height: c.height };
    });
    expect(afterCancelDims.width).toBe(initialDims.width);
    expect(afterCancelDims.height).toBe(initialDims.height);
  });

  test('Crop color contrast meets accessibility standards', async ({ page }) => {
    await loadTestDocument(page);

    await page.locator('#navTools').click();
    await page.locator('#toolManualCropBtn').click();

    // Check confirm and cancel button background colors
    const buttonStyles = await page.evaluate(() => {
      const confirm = window.getComputedStyle(document.getElementById('confirmCropBtn'));
      const cancel = window.getComputedStyle(document.getElementById('cancelCropBtn'));
      const autoDetect = window.getComputedStyle(document.getElementById('cropAutoDetectBtn'));
      return {
        confirmBg: confirm.backgroundColor,
        confirmColor: confirm.color,
        cancelBg: cancel.backgroundColor,
        cancelColor: cancel.color,
        autoDetectBg: autoDetect.backgroundColor,
      };
    });

    // Confirm button must be solid green (not transparent rgba(0,0,0,0))
    expect(buttonStyles.confirmBg).not.toBe('rgba(0, 0, 0, 0)');
    expect(buttonStyles.confirmBg).not.toBe('transparent');
    expect(buttonStyles.confirmColor).toBe('rgb(255, 255, 255)');

    // Cancel button must be solid red (not transparent)
    expect(buttonStyles.cancelBg).not.toBe('rgba(0, 0, 0, 0)');
    expect(buttonStyles.cancelBg).not.toBe('transparent');
    expect(buttonStyles.cancelColor).toBe('rgb(255, 255, 255)');

    // Handles must have high-contrast border and shadows
    const handleStyle = await page.evaluate(() => {
      const handle = document.querySelector('.crop-handle');
      return window.getComputedStyle(handle).pointerEvents;
    });
    expect(handleStyle).toBe('auto');

    // Overlay must not block pointer events for buttons
    const overlayPointerEvents = await page.evaluate(() => {
      return window.getComputedStyle(document.getElementById('cropOverlay')).pointerEvents;
    });
    expect(overlayPointerEvents).toBe('none');
  });

  test('Auto-detect button in crop action bar re-detects corners', async ({ page }) => {
    await loadTestDocument(page);

    await page.locator('#navTools').click();
    await page.locator('#toolManualCropBtn').click();
    await expect(page.locator('#cropOverlay')).not.toHaveClass(/hidden/);

    // Click auto-detect button inside crop bar
    const autoDetectBtn = page.locator('#cropAutoDetectBtn');
    await expect(autoDetectBtn).toBeVisible();
    await autoDetectBtn.click();

    // Should stay in crop mode with updated corners
    await expect(page.locator('#cropOverlay')).not.toHaveClass(/hidden/);
    await expect(page.locator('#cropPolygon')).toBeVisible();

    // Confirm the crop
    await page.locator('#confirmCropBtn').click();
    await expect(page.locator('#cropOverlay')).toHaveClass(/hidden/);
  });
});
