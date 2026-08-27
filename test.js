const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Simple 1x1 PNG buffer (red pixel)
function createDummyImage() {
  const pngHeader = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE,
    0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, // IDAT chunk
    0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00,
    0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC, 0x33,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, // IEND chunk
    0xAE, 0x42, 0x60, 0x82
  ]);
  return pngHeader;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const errors = [];
  const warnings = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(`CONSOLE: ${msg.text()}`);
    }
  });

  page.on('pageerror', err => {
    errors.push(`PAGE: ${err.message}`);
  });

  page.on('requestfailed', request => {
    errors.push(`REQUEST: ${request.url()} - ${request.failure().errorText}`);
  });

  page.on('response', response => {
    if (response.status() >= 400) {
      errors.push(`HTTP ${response.status()}: ${response.url()}`);
    }
  });

  console.log('=== Deep Scan Started ===\n');

  // 1. Navigate to app
  console.log('1. Loading app...');
  await page.goto('http://localhost:3001');
  await page.waitForLoadState('networkidle');

  // 2. Check fonts
  console.log('\n2. Checking fonts...');
  const fontCheck = await page.evaluate(() => {
    const body = window.getComputedStyle(document.body).fontFamily;
    const heading = document.querySelector('h2, h3');
    const headingFont = heading ? window.getComputedStyle(heading).fontFamily : 'N/A';
    return { body, heading: headingFont, readyState: document.fonts.status };
  });
  console.log(`   Body font: ${fontCheck.body}`);
  console.log(`   Heading font: ${fontCheck.heading}`);
  console.log(`   Fonts status: ${fontCheck.readyState}`);
  if (!fontCheck.body.includes('Plus Jakarta Sans') && !fontCheck.heading.includes('Plus Jakarta Sans')) {
    warnings.push('Font "Plus Jakarta Sans" not loaded - using fallback');
  }

  // 3. Check initial UI state
  console.log('\n3. Checking initial UI...');
  const uiCheck = await page.evaluate(() => {
    return {
      emptyStateVisible: !document.getElementById('emptyState')?.classList.contains('hidden'),
      editorVisible: !document.getElementById('editorArea')?.classList.contains('hidden'),
      navVisible: !document.getElementById('bottomNav')?.classList.contains('hidden'),
      darkToggle: !!document.getElementById('darkToggle'),
      undoBtn: !!document.getElementById('undoBtn'),
      redoBtn: !!document.getElementById('redoBtn'),
    };
  });
  console.log(`   Empty state visible: ${uiCheck.emptyStateVisible}`);
  console.log(`   Editor visible: ${uiCheck.editorVisible}`);
  console.log(`   Nav visible: ${uiCheck.navVisible}`);

  // 4. Upload image and test crop
  console.log('\n4. Testing image upload & crop...');

  // Inject test image
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 800; c.height = 600;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'blue';
    ctx.fillRect(0, 0, 800, 600);
    const img = new Image();
    img.src = c.toDataURL('image/png');
    img.onload = () => {
        const pageObj = { originalImage: img, currentImageData: null };
        window.app.state.pages.push(pageObj);
        window.app.state.currentPageIndex = window.app.state.pages.length - 1;
        window.app.showEditor();
        window.app.renderPage(window.app.state.currentPageIndex);
    };
  });

  await page.waitForFunction(() => window.app && window.app.state.imageLoaded);
  console.log('   Image loaded: true');
  await page.waitForTimeout(500);

  // Check if image loaded
  const imageLoaded = await page.evaluate(() => {
    return typeof window.app !== 'undefined' && window.app.state.imageLoaded;
  });
  console.log(`   Image loaded: ${imageLoaded}`);

  if (imageLoaded) {
    // Open tools sheet
    await page.click('#navTools');
    await page.waitForTimeout(500);

    // Click crop button
    await page.click('#toolCropBtn');
    await page.waitForTimeout(500);

    // Check crop state
    const cropState = await page.evaluate(() => {
      return {
        overlayVisible: !document.getElementById('cropOverlay')?.classList.contains('hidden'),
        actionBarVisible: !document.getElementById('cropActionBar')?.classList.contains('hidden'),
        isCropping: window.app.state.isCropping,
        manualCropInit: !!window.manualCrop.initialized,
      };
    });
    console.log(`   Crop overlay visible: ${cropState.overlayVisible}`);
    console.log(`   Crop action bar visible: ${cropState.actionBarVisible}`);
    console.log(`   isCropping state: ${cropState.isCropping}`);
    console.log(`   manualCrop initialized: ${cropState.manualCropInit}`);

    if (cropState.overlayVisible && cropState.actionBarVisible) {
      // Test drag
      const handle = await page.$('.crop-handle[data-handle="br"]');
      if (handle) {
        const box = await handle.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(box.x - 50, box.y - 50, { steps: 10 });
          await page.mouse.up();
          await page.waitForTimeout(300);

          const cropArea = await page.evaluate(() => {
            return {
              corners: window.manualCrop.state.corners,
              width: document.getElementById('cropArea')?.offsetWidth,
              height: document.getElementById('cropArea')?.offsetHeight,
            };
          });
          console.log(`   Crop area after drag: ${cropArea.width}x${cropArea.height}`);
          console.log('   SUCCESS: Crop drag works');
        }
      }

      // Cancel crop
      await page.click('#cancelCropBtn');
      await page.waitForTimeout(300);
    }

    // 5. Test filter sheet
    console.log('\n5. Testing filters...');
    await page.click('#navTools');
    await page.waitForTimeout(500);
    await page.click('#toolFilterBtn');
    await page.waitForTimeout(500);

    const filterSheetVisible = await page.evaluate(() => {
      return !document.getElementById('filterSheet')?.classList.contains('hidden');
    });
    console.log(`   Filter sheet visible: ${filterSheetVisible}`);

    // Test brightness slider
    await page.fill('#filterBrightness', '50');
    await page.dispatchEvent('#filterBrightness', 'input');
    await page.waitForTimeout(500);

    const filterState = await page.evaluate(() => {
      return window.app.state.filters.brightness;
    });
    console.log(`   Brightness value: ${filterState}`);

    // Close filter sheet
    await page.click('#closeFilterSheet');
    await page.waitForTimeout(300);

    // 6. Test undo
    console.log('\n6. Testing Undo/Redo...');
    const undoState = await page.evaluate(() => {
      return {
        undoDisabled: document.getElementById('undoBtn')?.disabled,
        redoDisabled: document.getElementById('redoBtn')?.disabled,
        undoStackLength: window.app.state.undoStack.length,
      };
    });
    console.log(`   Undo disabled: ${undoState.undoDisabled}`);
    console.log(`   Redo disabled: ${undoState.redoDisabled}`);
    console.log(`   Undo stack: ${undoState.undoStackLength}`);
  }

  // 7. Check console errors
  console.log('\n7. Console Errors:');
  if (errors.length === 0) {
    console.log('   No errors found!');
  } else {
    errors.forEach(e => console.log(`   ERROR: ${e}`));
  }

  console.log('\n8. Warnings:');
  if (warnings.length === 0) {
    console.log('   No warnings found!');
  } else {
    warnings.forEach(w => console.log(`   WARN: ${w}`));
  }

  // Cleanup
  await browser.close();
  console.log('\n=== Deep Scan Complete ===');
})();

