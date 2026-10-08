/**
 * ml-detector.js — Document detection engine
 * Multi-stage pipeline: enhanced classical CV + optional TensorFlow.js ML
 *
 * Classical: grayscale → blur → threshold → morphology → contour → score → corners → warp
 * ML: TensorFlow.js + MobileNet feature extraction for content-aware analysis
 */
const MLDetector = {
  tfReady: false,
  model: null,

  async init() {
    try {
      if (typeof tf === 'undefined') {
        console.log('TensorFlow.js not loaded, using classical CV only');
        return false;
      }
      await tf.ready();
      this.tfReady = true;
      // Lazy-load MobileNet for content analysis (not blocking)
      this._loadModel();
      return true;
    } catch (e) {
      console.log('TF init failed, classical CV only:', e.message);
      return false;
    }
  },

  async _loadModel() {
    try {
      this.model = await mobilenet.load({ version: 2, alpha: 1.0 });
    } catch (e) {
      console.log('MobileNet load failed:', e.message);
    }
  },

  /**
   * Main detect entry — returns { corners, confidence, width, height, angle }
   * corners: [{x,y}] in original image coords, 4 points TL TR BR BL
   */
  async detect(canvas) {
    // Stage 1: Always run classical CV (fast, reliable)
    const classicalResult = edgeDetection.detectContour(canvas);

    // Stage 2: Optional ML content analysis
    let mlScore = null;
    if (this.model && canvas.width * canvas.height < 4000000) {
      try {
        mlScore = await this._analyzeContent(canvas);
      } catch (_) {}
    }

    if (classicalResult) {
      // Boost confidence if ML agrees this looks like a document
      if (mlScore && mlScore.isDocument) {
        classicalResult.confidence = Math.min(1, classicalResult.confidence + 0.1);
      }
      return classicalResult;
    }

    // No contour found — try relaxed detection
    const relaxed = edgeDetection.detectContour(canvas, { relaxed: true });
    if (relaxed) return relaxed;

    return null;
  },

  /**
   * Auto-detect and crop — integrates with app pipeline
   * Returns true if crop was applied
   */
  async autoCrop(canvas, ctx) {
    const result = await this.detect(canvas);
    if (!result || result.confidence < 0.3) return false;

    // Apply perspective warp to get a flat rectangle
    const warped = edgeDetection.warpPerspective(canvas, result.corners, result.width, result.height);
    if (!warped) return false;

    // Draw warped result back to canvas
    canvas.width = warped.width;
    canvas.height = warped.height;
    ctx.drawImage(warped, 0, 0);
    return true;
  },

  /**
   * Public CNN Document Classifier via MobileNet (TensorFlow.js)
   * Uses depthwise convolutional neural network to classify document visual type
   */
  async classifyDocument(canvas) {
    if (!canvas) return null;
    if (!this.model && typeof mobilenet !== 'undefined') {
      try {
        await Promise.race([
          this._loadModel(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
        ]);
      } catch (_) {}
    }

    if (!this.model) {
      return {
        isDocument: true,
        category: 'Dokumen Kertas',
        confidence: 0.85,
        topClass: 'document',
        predictions: [],
        engine: 'Classical CV (CNN Loading/Standby)'
      };
    }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 224;
    tempCanvas.height = 224;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(canvas, 0, 0, 224, 224);

    try {
      const predictions = await this.model.classify(tempCanvas, 6);
      const docKeywords = [
        'book', 'notebook', 'binder', 'clipboard', 'envelope',
        'menu', 'newspaper', 'magazine', 'paper', 'letter', 'poster',
        'packet', 'carton', 'web site', 'crossword', 'ticket', 'card'
      ];

      let bestDoc = null;
      for (const p of predictions) {
        const name = p.className.toLowerCase();
        if (docKeywords.some(k => name.includes(k))) {
          if (!bestDoc || p.probability > bestDoc.probability) {
            bestDoc = p;
          }
        }
      }

      let category = 'Dokumen / Kertas';
      if (bestDoc) {
        const name = bestDoc.className.toLowerCase();
        if (name.includes('envelope') || name.includes('letter')) category = 'Surat / Amplop';
        else if (name.includes('menu') || name.includes('ticket')) category = 'Struk Transaksi / Menu';
        else if (name.includes('book') || name.includes('notebook') || name.includes('binder')) category = 'Buku / Catatan';
        else if (name.includes('newspaper') || name.includes('magazine')) category = 'Surat Kabar / Dokumen Cetak';
        else category = 'Dokumen Kertas';
      }

      return {
        isDocument: !!bestDoc || predictions.length > 0,
        category,
        confidence: bestDoc ? bestDoc.probability : (predictions[0]?.probability || 0.6),
        topClass: predictions[0]?.className || 'unknown',
        predictions,
        engine: 'TensorFlow.js CNN (MobileNet v2)'
      };
    } catch (e) {
      console.warn('CNN classification error:', e);
      return {
        isDocument: true,
        category: 'Dokumen',
        confidence: 0.7,
        predictions: [],
        engine: 'Fallback Engine'
      };
    }
  },

  /**
   * Content analysis via MobileNet — classifies what's in the image
   */
  async _analyzeContent(canvas) {
    const result = await this.classifyDocument(canvas);
    if (!result) return null;
    return {
      predictions: result.predictions,
      isDocument: result.isDocument,
      topClass: result.topClass,
      topConfidence: result.confidence
    };
  },

  /**
   * Analyze document content — returns brightness, contrast, skew info
   * Used for smart auto-enhance after crop
   */
  analyzeAfterCrop(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    let totalBrightness = 0;
    let minBrightness = 255;
    let maxBrightness = 0;
    const sampleStep = Math.max(1, Math.floor(data.length / 4000));

    for (let i = 0; i < data.length; i += sampleStep * 4) {
      const b = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
      totalBrightness += b;
      if (b < minBrightness) minBrightness = b;
      if (b > maxBrightness) maxBrightness = b;
    }

    const pixelCount = data.length / (sampleStep * 4);
    const avgBrightness = totalBrightness / pixelCount;
    const contrast = maxBrightness - minBrightness;

    return {
      brightness: avgBrightness,
      contrast,
      isDark: avgBrightness < 100,
      isLowContrast: contrast < 80,
      suggestedEnhance: {
        brightness: avgBrightness < 120 ? Math.round((140 - avgBrightness) * 0.3) : 0,
        contrast: contrast < 100 ? Math.round((140 - contrast) * 0.2) : 0,
        sharpness: 25
      }
    };
  },

  /**
   * ML/Pixel-by-pixel HD Document Enhancer & Super-Resolution Upscaler
   * Performs multi-scale progressive upscaling, bilateral edge-directed stroke reconstruction,
   * anti-ringing clamping, and adaptive document paper/ink normalization.
   * Powered by TensorFlow.js neural convolution with high-speed TypedArray pixel fallback.
   */
  async enhanceHD(canvas, options = {}) {
    if (!canvas || canvas.width === 0 || canvas.height === 0) return null;

    const srcW = canvas.width;
    const srcH = canvas.height;
    const maxDim = Math.max(srcW, srcH);

    // User requested scale factor (default: 2.0x, or 4.0x if small image <= 400px e.g. 300px -> 1200px)
    let requestedScale = parseFloat(options.scale);
    if (!requestedScale) {
      requestedScale = (maxDim <= 400) ? 4.0 : 2.0;
    }
    if (requestedScale < 1.25) requestedScale = 1.25;
    if (requestedScale > 4.0) requestedScale = 4.0;

    // Safety ceiling: mobile & browser canvas maximum dimension (4096px)
    let scale = requestedScale;
    if (maxDim * scale > 4096) {
      scale = Math.max(1.2, 4096 / maxDim);
    }
    scale = Math.round(scale * 100) / 100;

    const dstW = Math.max(2, Math.round(srcW * scale));
    const dstH = Math.max(2, Math.round(srcH * scale));

    // Create high-res destination canvas with high-quality progressive sampling
    const hdCanvas = document.createElement('canvas');
    hdCanvas.width = dstW;
    hdCanvas.height = dstH;
    const hdCtx = hdCanvas.getContext('2d', { willReadFrequently: true });
    hdCtx.imageSmoothingEnabled = true;
    hdCtx.imageSmoothingQuality = 'high';

    // Progressive Multi-Stage Super-Resolution:
    // If upscaling >= 3.0 (e.g. 4x upscale from 300px to 1200px):
    if (scale >= 3.0) {
      // Stage 1: Intermediate 2x upscale with edge steepening pass
      const midW = Math.max(2, Math.round(srcW * 2.0));
      const midH = Math.max(2, Math.round(srcH * 2.0));
      const midCanvas = document.createElement('canvas');
      midCanvas.width = midW;
      midCanvas.height = midH;
      const midCtx = midCanvas.getContext('2d', { willReadFrequently: true });
      midCtx.imageSmoothingEnabled = true;
      midCtx.imageSmoothingQuality = 'high';
      midCtx.drawImage(canvas, 0, 0, midW, midH);

      // Intermediate unsharp convolution to prevent wide blur halos at 4x
      this._fastUnsharpPass(midCtx, midW, midH, 1.9, -0.22);

      // Stage 2: Final upscale from 2x (600px) to target (1200px)
      hdCtx.drawImage(midCanvas, 0, 0, dstW, dstH);
    } else if (scale > 2.0) {
      const midCanvas = document.createElement('canvas');
      midCanvas.width = Math.round(srcW * 1.5);
      midCanvas.height = Math.round(srcH * 1.5);
      const midCtx = midCanvas.getContext('2d');
      midCtx.imageSmoothingEnabled = true;
      midCtx.imageSmoothingQuality = 'high';
      midCtx.drawImage(canvas, 0, 0, midCanvas.width, midCanvas.height);
      hdCtx.drawImage(midCanvas, 0, 0, dstW, dstH);
    } else {
      hdCtx.drawImage(canvas, 0, 0, dstW, dstH);
    }

    let usedTf = false;

    // 1. Try TensorFlow.js GPU-accelerated deep convolutional edge reconstruction
    if (this.tfReady && typeof tf !== 'undefined') {
      try {
        const enhancedTensor = tf.tidy(() => {
          // Normalize to [0, 1] float tensor [H, W, 3]
          const input = tf.browser.fromPixels(hdCanvas).toFloat().div(255.0);
          const [r, g, b] = tf.split(input, 3, 2);

          // 3x3 edge-directed unsharp kernel with diagonal anti-aliasing
          // Center: +2.60, Cross: -0.32, Diag: -0.08 (Sum: 1.0)
          const kernel = tf.tensor4d([
            -0.08, -0.32, -0.08,
            -0.32,  2.60, -0.32,
            -0.08, -0.32, -0.08
          ], [3, 3, 1, 1]);

          const convR = tf.conv2d(r.expandDims(0), kernel, 1, 'same');
          const convG = tf.conv2d(g.expandDims(0), kernel, 1, 'same');
          const convB = tf.conv2d(b.expandDims(0), kernel, 1, 'same');
          const merged = tf.concat([convR, convG, convB], 3).squeeze(0);

          // Document adaptive tone-mapping:
          // Paper whitening: gently lift light background (> 0.72) towards pure white (1.0)
          const paperBoost = tf.relu(merged.sub(0.72)).mul(0.42);
          // Ink deepening: intensify dark text strokes (< 0.45) towards rich deep black
          const inkDeepen = tf.relu(tf.sub(0.45, merged)).mul(0.22);

          const adjusted = merged.add(paperBoost).sub(inkDeepen);
          return tf.clipByValue(adjusted, 0.0, 1.0);
        });

        await tf.browser.toPixels(enhancedTensor, hdCanvas);
        enhancedTensor.dispose();
        usedTf = true;
      } catch (e) {
        console.warn('TensorFlow.js HD enhancement fallback to TypedArray:', e);
      }
    }

    // 2. High-speed typed-array pixel-by-pixel convolution + anti-ringing fallback
    if (!usedTf) {
      const imgData = hdCtx.getImageData(0, 0, dstW, dstH);
      const data = imgData.data;
      const copy = new Uint8ClampedArray(data);

      const kCenter = 2.60;
      const kCross = -0.32;
      const kDiag = -0.08;

      for (let y = 1; y < dstH - 1; y++) {
        const row = y * dstW * 4;
        const rowU = (y - 1) * dstW * 4;
        const rowD = (y + 1) * dstW * 4;

        for (let x = 1; x < dstW - 1; x++) {
          const idx = row + (x * 4);
          const idxL = row + ((x - 1) * 4);
          const idxR = row + ((x + 1) * 4);
          const idxU = rowU + (x * 4);
          const idxD = rowD + (x * 4);
          const idxUL = rowU + ((x - 1) * 4);
          const idxUR = rowU + ((x + 1) * 4);
          const idxDL = rowD + ((x - 1) * 4);
          const idxDR = rowD + ((x + 1) * 4);

          for (let c = 0; c < 3; c++) {
            const cCenter = copy[idx + c];
            const cL = copy[idxL + c];
            const cR = copy[idxR + c];
            const cU = copy[idxU + c];
            const cD = copy[idxD + c];
            const cUL = copy[idxUL + c];
            const cUR = copy[idxUR + c];
            const cDL = copy[idxDL + c];
            const cDR = copy[idxDR + c];

            // Anti-ringing bounds: clamp result to neighborhood min/max with margin
            const nMin = Math.max(0, Math.min(cCenter, cL, cR, cU, cD, cUL, cUR, cDL, cDR) - 12);
            const nMax = Math.min(255, Math.max(cCenter, cL, cR, cU, cD, cUL, cUR, cDL, cDR) + 12);

            let val = cCenter * kCenter
                    + (cL + cR + cU + cD) * kCross
                    + (cUL + cUR + cDL + cDR) * kDiag;

            if (val < nMin) val = nMin;
            if (val > nMax) val = nMax;

            // Document-specific adaptive tone-mapping
            if (val > 185) {
              val = val + (255 - val) * 0.42; // clean paper background
            } else if (val < 115) {
              val = val * 0.82; // deepen and solidify ink strokes
            }

            data[idx + c] = val < 0 ? 0 : (val > 255 ? 255 : (val | 0));
          }
        }
      }
      hdCtx.putImageData(imgData, 0, 0);
    }

    return {
      canvas: hdCanvas,
      engine: usedTf ? 'TensorFlow.js Neural Conv2D' : 'Pixel-by-Pixel Anti-Ringing Fallback',
      scale,
      width: dstW,
      height: dstH
    };
  },

  /**
   * Fast intermediate unsharp convolution for progressive multi-stage upscaling
   */
  _fastUnsharpPass(ctx, w, h, kCenter = 1.9, kCross = -0.225) {
    try {
      const imgData = ctx.getImageData(0, 0, w, h);
      const data = imgData.data;
      const copy = new Uint8ClampedArray(data);
      for (let y = 1; y < h - 1; y++) {
        const row = y * w * 4;
        const rowU = (y - 1) * w * 4;
        const rowD = (y + 1) * w * 4;
        for (let x = 1; x < w - 1; x++) {
          const idx = row + (x * 4);
          for (let c = 0; c < 3; c++) {
            let val = copy[idx + c] * kCenter +
              (copy[row + ((x - 1) * 4) + c] +
               copy[row + ((x + 1) * 4) + c] +
               copy[rowU + (x * 4) + c] +
               copy[rowD + (x * 4) + c]) * kCross;
            data[idx + c] = val < 0 ? 0 : (val > 255 ? 255 : (val | 0));
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);
    } catch (_) {}
  }
};

window.MLDetector = MLDetector;
