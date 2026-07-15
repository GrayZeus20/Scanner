import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/WebScanner/);
});

test('empty state shows correct UI', async ({ page }) => {
  await page.goto('/');
  const emptyState = page.locator('#emptyState');
  await expect(emptyState).toBeVisible();
  await expect(emptyState.locator('h2[data-i18n="emptyTitle"]')).toBeVisible();
  await expect(page.locator('#emptyCamera')).toBeVisible();
  await expect(page.locator('#emptyImport')).toBeVisible();
});

test('editor is hidden initially', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#editorArea')).toHaveClass(/hidden/);
  await expect(page.locator('#cameraView')).toHaveClass(/hidden/);
});

test('bottom nav hidden until image loaded', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#bottomNav')).toHaveClass(/hidden/);
});

test('click import opens file dialog', async ({ page }) => {
  await page.goto('/');
  const fileInput = page.locator('#fileInput');
  await expect(fileInput).toHaveAttribute('accept', 'image/*');

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('#emptyImport').click(),
  ]);
  expect(fileChooser.isMultiple()).toBeTruthy();
});

test('import valid image shows editor', async ({ page }) => {
  await page.goto('/');

  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  );
  await page.locator('#fileInput').setInputFiles({
    name: 'test.png',
    mimeType: 'image/png',
    buffer: pngBuffer,
  });

  await expect(page.locator('#editorArea')).not.toHaveClass(/hidden/, { timeout: 8000 });
  await expect(page.locator('#emptyState')).toHaveClass(/hidden/);
  await expect(page.locator('#bottomNav')).not.toHaveClass(/hidden/);
});

test('import image shows canvas with content', async ({ page }) => {
  await page.goto('/');

  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  );
  await page.locator('#fileInput').setInputFiles({
    name: 'test.png',
    mimeType: 'image/png',
    buffer: pngBuffer,
  });

  await expect(page.locator('#editorArea')).not.toHaveClass(/hidden/, { timeout: 8000 });
  await expect(page.locator('#pagesTray')).toBeVisible();
  await expect(page.locator('.page-thumb')).toHaveCount(1);
});

test('dark mode toggle works', async ({ page }) => {
  await page.goto('/');
  const body = page.locator('body');
  await expect(body).not.toHaveClass(/dark-mode/);

  await page.locator('#darkToggle').click();
  await expect(body).toHaveClass(/dark-mode/);

  await page.locator('#darkToggle').click();
  await expect(body).not.toHaveClass(/dark-mode/);
});

test('language switcher has both language options', async ({ page }) => {
  await page.goto('/');
  const switcher = page.locator('#langSwitcher');

  await expect(switcher).toBeVisible();
  const options = await switcher.locator('option').allTextContents();
  expect(options.some(o => o.includes('Indonesia'))).toBeTruthy();
  expect(options.some(o => o.includes('English'))).toBeTruthy();

  await expect(switcher).toHaveValue('en');
});

test('tools sheet opens and closes', async ({ page }) => {
  await page.goto('/');

  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  );
  await page.locator('#fileInput').setInputFiles({
    name: 'test.png',
    mimeType: 'image/png',
    buffer: pngBuffer,
  });
  await expect(page.locator('#editorArea')).not.toHaveClass(/hidden/, { timeout: 8000 });

  await page.locator('#navTools').click();
  await expect(page.locator('#toolsSheet')).not.toHaveClass(/hidden/);

  await expect(page.locator('#toolCropBtn')).toBeVisible();
  await expect(page.locator('#toolFilterBtn')).toBeVisible();
  await expect(page.locator('#toolOcrBtn')).toBeVisible();
  await expect(page.locator('#toolInpaintBtn')).toBeVisible();

  await page.locator('#closeToolsSheet').click();
  await expect(page.locator('#toolsSheet')).toHaveClass(/hidden/);
});

test('export sheet opens and closes', async ({ page }) => {
  await page.goto('/');

  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  );
  await page.locator('#fileInput').setInputFiles({
    name: 'test.png',
    mimeType: 'image/png',
    buffer: pngBuffer,
  });
  await expect(page.locator('#editorArea')).not.toHaveClass(/hidden/, { timeout: 8000 });

  await page.locator('#navExport').click();
  await expect(page.locator('#exportSheet')).not.toHaveClass(/hidden/);

  await expect(page.locator('[data-format="pdf"]')).toBeVisible();
  await expect(page.locator('[data-format="png"]')).toBeVisible();
  await expect(page.locator('[data-format="jpg"]')).toBeVisible();

  await page.locator('#closeExportSheet').click();
  await expect(page.locator('#exportSheet')).toHaveClass(/hidden/);
});

test('multiple image imports create pages', async ({ page }) => {
  await page.goto('/');

  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  );

  await page.locator('#fileInput').setInputFiles({
    name: 'test1.png',
    mimeType: 'image/png',
    buffer: pngBuffer,
  });
  await expect(page.locator('#editorArea')).not.toHaveClass(/hidden/, { timeout: 8000 });
  await expect(page.locator('.page-thumb')).toHaveCount(1);

  await page.locator('#fileInput').setInputFiles({
    name: 'test2.png',
    mimeType: 'image/png',
    buffer: pngBuffer,
  });
  await expect(page.locator('.page-thumb')).toHaveCount(2, { timeout: 5000 });
});

test('camera button exists and is accessible', async ({ page }) => {
  await page.goto('/');
  const cameraBtn = page.locator('#emptyCamera');
  await expect(cameraBtn).toBeVisible();
  await expect(cameraBtn.locator('i[data-lucide="camera"]')).toBeAttached();
});

test('filter sheet opens with all controls', async ({ page }) => {
  await page.goto('/');

  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  );
  await page.locator('#fileInput').setInputFiles({
    name: 'test.png',
    mimeType: 'image/png',
    buffer: pngBuffer,
  });
  await expect(page.locator('#editorArea')).not.toHaveClass(/hidden/, { timeout: 8000 });

  await page.locator('#navTools').click();
  await expect(page.locator('#toolsSheet')).not.toHaveClass(/hidden/);

  await page.locator('#toolFilterBtn').click();
  await expect(page.locator('#filterSheet')).not.toHaveClass(/hidden/);
  await expect(page.locator('#filterBrightness')).toBeVisible();
  await expect(page.locator('#filterContrast')).toBeVisible();
  await expect(page.locator('#filterSaturation')).toBeVisible();
  await expect(page.locator('#filterSharpness')).toBeVisible();
  await expect(page.locator('#filterGrayscale')).toBeAttached();
  await expect(page.locator('#filterSepia')).toBeAttached();
  await expect(page.locator('#filterInvert')).toBeAttached();
  await expect(page.locator('#filterBW')).toBeAttached();

  await page.locator('#closeFilterSheet').click();
  await expect(page.locator('#filterSheet')).toHaveClass(/hidden/);
});

test('rotate buttons exist in filter sheet', async ({ page }) => {
  await page.goto('/');

  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  );
  await page.locator('#fileInput').setInputFiles({
    name: 'test.png',
    mimeType: 'image/png',
    buffer: pngBuffer,
  });
  await expect(page.locator('#editorArea')).not.toHaveClass(/hidden/, { timeout: 8000 });

  await page.locator('#navTools').click();
  await page.locator('#toolFilterBtn').click();
  await expect(page.locator('#filterSheet')).not.toHaveClass(/hidden/);

  await expect(page.locator('#rotateLeftBtn')).toBeVisible();
  await expect(page.locator('#rotateRightBtn')).toBeVisible();
  await expect(page.locator('#flipHBtn')).toBeVisible();
  await expect(page.locator('#flipVBtn')).toBeVisible();
  await expect(page.locator('#resetFilterBtn')).toBeVisible();

  await page.locator('#closeFilterSheet').click();
});

test('zoom controls visible when image loaded', async ({ page }) => {
  await page.goto('/');

  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  );
  await page.locator('#fileInput').setInputFiles({
    name: 'test.png',
    mimeType: 'image/png',
    buffer: pngBuffer,
  });
  await expect(page.locator('#editorArea')).not.toHaveClass(/hidden/, { timeout: 8000 });

  await expect(page.locator('#zoomControls')).toBeVisible();
  await expect(page.locator('#zoomInBtn')).toBeVisible();
  await expect(page.locator('#zoomOutBtn')).toBeVisible();
  await expect(page.locator('#zoomResetBtn')).toBeVisible();
});

test('history sheet shows empty state', async ({ page }) => {
  await page.goto('/');

  // Load image first to make nav visible
  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  );
  await page.locator('#fileInput').setInputFiles({
    name: 'test.png',
    mimeType: 'image/png',
    buffer: pngBuffer,
  });
  await expect(page.locator('#editorArea')).not.toHaveClass(/hidden/, { timeout: 8000 });

  await page.locator('#navHistory').click();
  await expect(page.locator('#historyView')).not.toHaveClass(/hidden/);
  await expect(page.locator('#historyList')).toBeVisible();

  await page.locator('#closeHistory').click();
  await expect(page.locator('#historyView')).toHaveClass(/hidden/);
});
