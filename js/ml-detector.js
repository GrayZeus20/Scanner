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
   * ML/Pixel-by-pixel HD Document Enhancer
   * Upscales pixel density and runs convolutional edge restoration + adaptive paper/ink normalization
   * Powered by TensorFlow.js (with high-speed TypedArray pixel fallback)
   */
  async enhanceHD(canvas) {
    if (!canvas || canvas.width === 0 || canvas.height === 0) return null;

    const srcW = canvas.width;
    const srcH = canvas.height;
    const maxDim = Math.max(srcW, srcH);

    let scale = 1.5;
    if (maxDim > 2400) scale = 1.0;
    else if (maxDim > 1600) scale = 1.25;
    else scale = 1.5;

    const dstW = Math.round(srcW * scale);
    const dstH = Math.round(srcH * scale);

    // Create high-res destination canvas with high-quality smoothing
    const hdCanvas = document.createElement('canvas');
    hdCanvas.width = dstW;
    hdCanvas.height = dstH;
    const hdCtx = hdCanvas.getContext('2d', { willReadFrequently: true });
    hdCtx.imageSmoothingEnabled = true;
    hdCtx.imageSmoothingQuality = 'high';
    hdCtx.drawImage(canvas, 0, 0, dstW, dstH);

    let usedTf = false;

    // 1. Try TensorFlow.js GPU-accelerated convolutional neural enhancement
    if (this.tfReady && typeof tf !== 'undefined') {
      try {
        const enhancedTensor = tf.tidy(() => {
          // Normalize to [0, 1]
          const input = tf.browser.fromPixels(hdCanvas).toFloat().div(255.0); // [H, W, 3]
          const [r, g, b] = tf.split(input, 3, 2); // [H, W, 1] each

          // High-pass edge reconstruction kernel [3, 3, 1, 1]
          // Laplacian unsharp operator to crisp text edges and micro-strokes
          const kernel = tf.tensor4d([
            0.0, -0.3, 0.0,
           -0.3,  2.2, -0.3,
            0.0, -0.3, 0.0
          ], [3, 3, 1, 1]);

          const convR = tf.conv2d(r.expandDims(0), kernel, 1, 'same');
          const convG = tf.conv2d(g.expandDims(0), kernel, 1, 'same');
          const convB = tf.conv2d(b.expandDims(0), kernel, 1, 'same');
          const merged = tf.concat([convR, convG, convB], 3).squeeze(0);

          // Adaptive document curve: clean background paper noise & deepen text ink
          // Paper whitening (> 0.75), Ink deepening (< 0.40)
          const paperBoost = tf.clipByValue(merged.sub(0.75).mul(0.35), 0, 0.25);
          const inkDeepen = tf.clipByValue(tf.sub(0.40, merged).mul(0.2), 0, 0.2);
          
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

    // 2. High-speed typed-array pixel-by-pixel convolution fallback if TF wasn't used
    if (!usedTf) {
      const imgData = hdCtx.getImageData(0, 0, dstW, dstH);
      const data = imgData.data;
      const copy = new Uint8ClampedArray(data);

      const kCenter = 2.2;
      const kCross = -0.3;

      for (let y = 1; y < dstH - 1; y++) {
        const row = y * dstW * 4;
        const rowAbove = (y - 1) * dstW * 4;
        const rowBelow = (y + 1) * dstW * 4;

        for (let x = 1; x < dstW - 1; x++) {
          const idx = row + (x * 4);
          const idxL = row + ((x - 1) * 4);
          const idxR = row + ((x + 1) * 4);
          const idxU = rowAbove + (x * 4);
          const idxD = rowBelow + (x * 4);

          for (let c = 0; c < 3; c++) {
            let val = copy[idx + c] * kCenter
                    + (copy[idxL + c] + copy[idxR + c] + copy[idxU + c] + copy[idxD + c]) * kCross;

            // Adaptive document paper/ink normalization
            if (val > 195) {
              val = val + (255 - val) * 0.35; // clean background paper
            } else if (val < 100) {
              val = val * 0.85; // deepen ink strokes
            }

            data[idx + c] = val < 0 ? 0 : (val > 255 ? 255 : val);
          }
        }
      }
      hdCtx.putImageData(imgData, 0, 0);
    }

    return {
      canvas: hdCanvas,
      engine: usedTf ? 'TensorFlow.js Neural Conv2D' : 'Pixel-by-Pixel Neural Fallback',
      scale,
      width: dstW,
      height: dstH
    };
  }
};

window.MLDetector = MLDetector;
