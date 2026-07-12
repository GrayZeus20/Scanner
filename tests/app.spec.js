import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/WebScanner/);
});

test('can open camera', async ({ page }) => {
  await page.goto('/');
  const emptyCameraBtn = page.locator('#emptyCamera');
  await emptyCameraBtn.click();
  
  const cameraView = page.locator('#cameraView');
  await expect(cameraView).not.toHaveClass(/hidden/);
});

test('can import file', async ({ page }) => {
  await page.goto('/');
  const fileInput = page.locator('#fileInput');
  // Trigger file selection via hidden input
  await fileInput.setInputFiles({
    name: 'test.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('fake-image-content'),
  });

  // Verify editor area is shown
  const editorArea = page.locator('#editorArea');
  await expect(editorArea).not.toHaveClass(/hidden/);
});
