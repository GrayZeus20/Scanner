const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('oversized decoded images are reduced before import processing', async ({ page }) => {
  const dimensions = await page.evaluate(async () => {
    const originalDetect = deepscan.detect;
    deepscan.detect = async () => null;
    const source = document.createElement('canvas');
    source.width = 5000;
    source.height = 1000;
    source.getContext('2d').fillRect(0, 0, source.width, source.height);
    try {
      const result = await deepscan.scanImage(source);
      return [result.canvas.width, result.canvas.height];
    } finally {
      deepscan.detect = originalDetect;
      source.width = 0;
      source.height = 0;
    }
  });

  expect(dimensions).toEqual([3000, 600]);
});

test('image files remain importable when ImageBitmap decoding is rejected', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const bytes = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAlgAAAGQCAYAAAByNR6YAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='),
      (char) => char.charCodeAt(0)
    );
    const file = new File([bytes], 'doc_sample.png', { type: 'image/png' });
    const scan = await deepscan.scanFile(file);
    return [scan.canvas.width, scan.canvas.height];
  });

  expect(result).toEqual([600, 400]);
});

test('large inpaint masks use bounded scratch canvases', async ({ page }) => {
  const result = await page.evaluate(() => {
    const source = document.createElement('canvas');
    const mask = document.createElement('canvas');
    source.width = mask.width = 1600;
    source.height = mask.height = 900;
    const sourceCtx = source.getContext('2d');
    sourceCtx.fillStyle = '#222';
    sourceCtx.fillRect(0, 0, source.width, source.height);
    const maskCtx = mask.getContext('2d');
    maskCtx.fillStyle = 'white';
    maskCtx.fillRect(0, 0, mask.width, mask.height);

    inpaint.maskCanvas = mask;
    inpaint.maskCtx = maskCtx;
    inpaint.brushSize = 30;
    inpaint.maskBounds = { minX: 0, minY: 0, maxX: 1599, maxY: 899 };

    const dimensions = [];
    const originalCreate = document.createElement.bind(document);
    document.createElement = (name, ...args) => {
      const element = originalCreate(name, ...args);
      if (name === 'canvas') {
        const getContext = element.getContext.bind(element);
        element.getContext = (...contextArgs) => {
          dimensions.push([element.width, element.height]);
          return getContext(...contextArgs);
        };
      }
      return element;
    };

    let applied;
    try {
      applied = inpaint.applyInpaint(source, mask);
    } finally {
      document.createElement = originalCreate;
      source.width = source.height = 0;
      mask.width = mask.height = 0;
      inpaint.maskCanvas = null;
      inpaint.maskCtx = null;
    }
    return { applied, dimensions };
  });

  expect(result.applied).toBe(true);
  expect(result.dimensions.length).toBe(2);
  for (const [width, height] of result.dimensions) {
    expect(width).toBeLessThanOrEqual(1024);
    expect(height).toBeLessThanOrEqual(1024);
  }
});

test('successful OCR does not terminate its worker after the timeout', async ({ page }) => {
  const terminated = await page.evaluate(async () => {
    const worker = {
      terminateCount: 0,
      recognize: async () => ({ data: { text: 'ok' } }),
      terminate() { this.terminateCount++; }
    };
    const originalGetWorker = ocrEngine.getWorker;
    const originalTimeout = config.OCR.timeout;
    ocrEngine.worker = worker;
    ocrEngine.getWorker = async () => worker;
    config.OCR.timeout = 20;
    try {
      const text = await ocrEngine.recognize(document.createElement('canvas'));
      await new Promise((resolve) => setTimeout(resolve, 60));
      return { text, terminateCount: worker.terminateCount };
    } finally {
      ocrEngine.getWorker = originalGetWorker;
      ocrEngine.worker = null;
      config.OCR.timeout = originalTimeout;
    }
  });

  expect(terminated).toEqual({ text: 'ok', terminateCount: 0 });
});

test('timed-out OCR terminates the stalled worker', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const worker = {
      terminateCount: 0,
      recognize: () => new Promise(() => {}),
      terminate() { this.terminateCount++; }
    };
    const originalGetWorker = ocrEngine.getWorker;
    const originalTimeout = config.OCR.timeout;
    ocrEngine.worker = worker;
    ocrEngine.getWorker = async () => worker;
    config.OCR.timeout = 20;
    try {
      let message = '';
      try {
        await ocrEngine.recognize(document.createElement('canvas'));
      } catch (err) {
        message = err.message;
      }
      return { message, terminateCount: worker.terminateCount };
    } finally {
      ocrEngine.getWorker = originalGetWorker;
      ocrEngine.worker = null;
      config.OCR.timeout = originalTimeout;
    }
  });

  expect(result.message).toMatch(/habis|timed out/i);
  expect(result.terminateCount).toBe(1);
});

test('PDF export renders and releases each page before continuing', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const originalJsPdf = window.jspdf;
    const rendered = [];
    let pageCount = 0;
    window.jspdf = {
      jsPDF: class {
        constructor() {
          this.internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
        }
        addPage() {}
        addImage() {}
        output() { return new Blob(['pdf']); }
      }
    };
    try {
      const blob = await pdfExport.toPdfBlobFromPages(2, async (index) => {
        pageCount++;
        const canvas = document.createElement('canvas');
        canvas.width = 12 + index;
        canvas.height = 16;
        rendered.push(canvas);
        return canvas;
      });
      return {
        type: blob.type,
        size: blob.size,
        pageCount,
        dimensionsAfterExport: rendered.map((canvas) => [canvas.width, canvas.height])
      };
    } finally {
      window.jspdf = originalJsPdf;
    }
  });

  expect(result.size).toBe(3);
  expect(result.pageCount).toBe(2);
  expect(result.dimensionsAfterExport).toEqual([[0, 0], [0, 0]]);
});

test('PDF preview opens and closes without rendering every page up front', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles({
    name: 'preview.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      'base64'
    ),
  });
  await expect(page.locator('#editorArea')).not.toHaveClass(/hidden/);
  await page.locator('#navExport').click();
  await page.locator('[data-format="pdf"]').click();

  await expect(page.locator('#pdfPreviewModal')).toBeVisible();
  await expect(page.locator('#pdfPreviewPageInfo')).toHaveText('1/1');
  await expect(page.locator('#pdfPreviewCanvas')).toHaveAttribute('width', '1');

  await page.locator('#closePdfPreview').click();
  await expect(page.locator('#pdfPreviewModal')).toBeHidden();
});

test('batch import never exceeds the session page limit', async ({ page }) => {
  const imported = await page.evaluate(async () => {
    const originalBatchImport = deepscan.batchImport;
    let batchLength = 0;
    deepscan.batchImport = async (files) => {
      batchLength = files.length;
      return { pages: [], errors: [] };
    };
    try {
      const files = Array.from({ length: 35 }, (_, index) => ({
        name: `${index}.png`,
        type: 'image/png'
      }));
      await app.importBatch(files);
      return batchLength;
    } finally {
      deepscan.batchImport = originalBatchImport;
    }
  });

  expect(imported).toBe(30);
});

test('finishing camera capture waits for an in-flight image to load once', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const originalReset = camera.resetCameraUI;
    const originalStop = camera.stop;
    const originalEmit = app.emit;
    let sessionCreations = 0;
    camera.resetCameraUI = () => {};
    camera.stop = () => {};
    app.emit = (event) => {
      if (event === 'session:create') sessionCreations++;
    };
    camera.captureInProgress = true;
    camera._captureCompletion = new Promise((resolve) => {
      camera._resolveCapture = resolve;
    });
    camera._finishing = false;
    try {
      const finishPromises = [camera.finish(), camera.finish()];
      setTimeout(() => {
        camera.capturedCount = 1;
        camera.captureInProgress = false;
        camera._resolveCapture();
      }, 40);
      await Promise.all(finishPromises);
      return sessionCreations;
    } finally {
      camera.resetCameraUI = originalReset;
      camera.stop = originalStop;
      app.emit = originalEmit;
      camera.capturedCount = 0;
      camera.captureInProgress = false;
      camera._captureCompletion = null;
      camera._resolveCapture = null;
      camera._finishing = false;
    }
  });

  expect(result).toBe(1);
});

test('concurrent classifier calls share one lazy model load', async ({ page }) => {
  const loadCount = await page.evaluate(async () => {
    const originalModel = MLDetector.model;
    const originalModelPromise = MLDetector._modelPromise;
    const originalEnsureRuntime = MLDetector._ensureRuntime;
    const originalMobileNet = window.mobilenet;
    let count = 0;
    const model = { classify: async () => [] };
    MLDetector.model = null;
    MLDetector._modelPromise = null;
    MLDetector._ensureRuntime = async () => {};
    window.mobilenet = {
      load: async () => {
        count++;
        await Promise.resolve();
        return model;
      }
    };
    try {
      const [first, second] = await Promise.all([MLDetector._loadModel(), MLDetector._loadModel()]);
      return first === second ? count : -1;
    } finally {
      MLDetector.model = originalModel;
      MLDetector._modelPromise = originalModelPromise;
      MLDetector._ensureRuntime = originalEnsureRuntime;
      if (originalMobileNet === undefined) delete window.mobilenet;
      else window.mobilenet = originalMobileNet;
    }
  });

  expect(loadCount).toBe(1);
});
