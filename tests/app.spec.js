const { test, expect } = require('@playwright/test');

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

test('bottom nav hidden on home, visible in edit session', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#bottomNav')).toHaveClass(/hidden/);

  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  );
  await page.locator('#fileInput').setInputFiles({
    name: 'nav_test.png',
    mimeType: 'image/png',
    buffer: pngBuffer,
  });
  await expect(page.locator('#editorArea')).not.toHaveClass(/hidden/, { timeout: 8000 });
  await expect(page.locator('#bottomNav')).not.toHaveClass(/hidden/);

  // back to home → nav hides again
  await page.locator('#navHistory').click();
  await expect(page.locator('#historyView')).not.toHaveClass(/hidden/);
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

test('language switcher shows compact ID/ENG, full labels in menu', async ({ page }) => {
  await page.goto('/');
  const switcher = page.locator('#langSwitcher');
  const menu = page.locator('#langMenu');

  // Closed state: compact label only
  await expect(switcher).toBeVisible();
  await expect(switcher).toHaveText('ID/ENG');
  await expect(menu).toHaveClass(/hidden/);

  // Open: full labels listed
  await switcher.click();
  await expect(menu).not.toHaveClass(/hidden/);
  await expect(menu.locator('[data-lang="id"]')).toHaveText('ID Indonesia');
  await expect(menu.locator('[data-lang="en"]')).toHaveText('Eng English');

  // Select ID → applies + menu closes
  await menu.locator('[data-lang="id"]').click();
  await expect(menu).toHaveClass(/hidden/);
  await expect(page.locator('h2[data-i18n="emptyTitle"]')).toHaveText('Belum ada dokumen');

  // Reopen → aria-selected reflects active lang
  await switcher.click();
  await expect(menu.locator('[data-lang="id"]')).toHaveAttribute('aria-selected', 'true');
  await expect(menu.locator('[data-lang="en"]')).toHaveAttribute('aria-selected', 'false');
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
  // wait for first session save so second import appends (not guarded)
  await page.waitForFunction(() => app.state.dirty === false, null, { timeout: 5000 });

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
  await expect(cameraBtn.locator('i[data-lucide="camera"], svg.lucide-camera')).toBeAttached();
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

test('local ML document analysis runs on-device without server dependency', async ({ page }) => {
  await page.goto('/');

  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  );
  await page.locator('#fileInput').setInputFiles({
    name: 'invoice_test.png',
    mimeType: 'image/png',
    buffer: pngBuffer,
  });
  await expect(page.locator('#editorArea')).not.toHaveClass(/hidden/, { timeout: 8000 });

  // Open OCR sheet
  await page.locator('#navTools').click();
  await page.locator('#toolOcrBtn').click();
  await expect(page.locator('#ocrSheet')).not.toHaveClass(/hidden/);

  // Set sample invoice text in OCR result div
  await page.evaluate(() => {
    const el = document.getElementById('ocrResult');
    el.innerText = 'FAKTUR PEMBELIAN\nNo: INV-2026-001\nTotal: Rp 150.000\nTanggal: 15/08/2026\n2 x Kopi Latte\nHubungi: 08123456789';
  });

  // Click ML analysis button
  await page.locator('#aiAnalyzeBtn').click();

  // Result area should appear with CNN / Local ML content
  const resultArea = page.locator('#aiResultArea');
  await expect(resultArea).not.toHaveClass(/hidden/);
  await expect(resultArea).toContainText('MobileNet', { timeout: 10000 });
  await expect(resultArea).toContainText('Dokumen Keuangan');
});

test('local inpaint / object eraser opens and cancels cleanly', async ({ page }) => {
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
  await page.locator('#toolInpaintBtn').click();

  await expect(page.locator('#inpaintOverlay')).not.toHaveClass(/hidden/);
  await expect(page.locator('#inpaintActionBar')).not.toHaveClass(/hidden/);

  // Cancel inpaint
  await page.locator('#cancelInpaintBtn').click();
  await expect(page.locator('#inpaintOverlay')).toHaveClass(/hidden/);
  await expect(page.locator('#inpaintActionBar')).toHaveClass(/hidden/);
});

test('home shows riwayat button that opens session history', async ({ page }) => {
  await page.goto('/');
  const homeRiwayat = page.locator('#homeHistoryBtn');
  await expect(homeRiwayat).toBeVisible();

  await homeRiwayat.click();
  await expect(page.locator('#historyView')).not.toHaveClass(/hidden/);
  await expect(page.locator('#emptyState')).toHaveClass(/hidden/);

  // close history (no open pages) → back to home surface
  await page.locator('#closeHistory').click();
  await expect(page.locator('#emptyState')).not.toHaveClass(/hidden/);
  await expect(page.locator('#historyView')).toHaveClass(/hidden/);
});

test('back-to-home warns on unsaved data, cancel stays in editor, discard goes home', async ({ page }) => {
  await page.goto('/');
  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  );
  await page.locator('#fileInput').setInputFiles({
    name: 'backhome_test.png',
    mimeType: 'image/png',
    buffer: pngBuffer,
  });
  await expect(page.locator('#editorArea')).not.toHaveClass(/hidden/, { timeout: 8000 });
  await expect(page.locator('#homeBackBtn')).toBeVisible();

  // mark unsaved edits (filter/crop/reorder would do the same)
  await page.evaluate(() => { app.state.dirty = true; });
  await page.locator('#homeBackBtn').click();

  // warning modal with home-specific labels
  await expect(page.locator('#sessionGuardModal')).not.toHaveClass(/hidden/);
  await expect(page.locator('#guardSaveBtn [data-i18n="sessionGuardSaveHome"]')).toBeVisible();
  await expect(page.locator('#guardDiscardBtn [data-i18n="sessionGuardDiscardHome"]')).toBeVisible();

  // cancel → stay in editor
  await page.locator('#guardCancelBtn').click();
  await expect(page.locator('#sessionGuardModal')).toHaveClass(/hidden/);
  await expect(page.locator('#editorArea')).not.toHaveClass(/hidden/);

  // back again → discard → home surface, back button hidden
  await page.locator('#homeBackBtn').click();
  await page.locator('#guardDiscardBtn').click();
  await expect(page.locator('#emptyState')).not.toHaveClass(/hidden/);
  await expect(page.locator('#historyView')).toHaveClass(/hidden/);
  await expect(page.locator('#homeBackBtn')).toHaveClass(/hidden/);
});

test('undo and redo are locked while an import is running', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    app.state.undoStack.push({ fake: true });
    app._importing = true;
    app.syncUndoRedoLock();
    const disabledWhileImporting = document.getElementById('undoBtn').disabled && document.getElementById('redoBtn').disabled;
    const lenBefore = app.state.undoStack.length;
    await app.undo();
    const lenAfter = app.state.undoStack.length;
    app._importing = false;
    app.syncUndoRedoLock();
    const enabledAfter = !document.getElementById('undoBtn').disabled;
    return { disabledWhileImporting, unchanged: lenBefore === lenAfter, enabledAfter };
  });
  expect(result.disabledWhileImporting).toBe(true);
  expect(result.unchanged).toBe(true);
  expect(result.enabledAfter).toBe(true);
});

test('folder permission helper explains before browser picker', async ({ page }) => {
  await page.goto('/');

  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  );
  await page.locator('#fileInput').setInputFiles({
    name: 'perm_test.png',
    mimeType: 'image/png',
    buffer: pngBuffer,
  });
  await expect(page.locator('#editorArea')).not.toHaveClass(/hidden/, { timeout: 8000 });

  await page.evaluate(() => {
    window.__pickerCalled = false;
    window.showDirectoryPicker = async () => {
      window.__pickerCalled = true;
      return { name: 'PickerDir' };
    };
  });

  await page.locator('#navExport').click();
  await expect(page.locator('#exportSheet')).not.toHaveClass(/hidden/);
  await page.locator('#pickFolderBtn').click();

  // explanation modal shows FIRST, browser picker not yet called
  await expect(page.locator('#permissionModal')).not.toHaveClass(/hidden/);
  expect(await page.evaluate(() => window.__pickerCalled)).toBe(false);

  // deny → picker never called
  await page.locator('#permDenyBtn').click();
  await expect(page.locator('#permissionModal')).toHaveClass(/hidden/);
  expect(await page.evaluate(() => window.__pickerCalled)).toBe(false);

  // allow → picker called
  await page.locator('#pickFolderBtn').click();
  await expect(page.locator('#permissionModal')).not.toHaveClass(/hidden/);
  await page.locator('#permAllowBtn').click();
  await expect(page.locator('#permissionModal')).toHaveClass(/hidden/);
  await page.waitForFunction(() => window.__pickerCalled === true);
});


