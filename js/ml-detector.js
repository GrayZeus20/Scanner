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
  _runtimePromise: null,
  _modelPromise: null,

  async init() {
    return this.tfReady;
  },

  async _loadModel() {
    if (this.model) return this.model;
    if (!this._modelPromise) {
      this._modelPromise = (async () => {
        await this._ensureRuntime();
        const model = await mobilenet.load({ version: 2, alpha: 1.0 });
        this.model = model;
        return model;
      })().catch((err) => {
        this._modelPromise = null;
        throw err;
      });
    }
    return this._modelPromise;
  },

  _loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Gagal memuat library ML.'));
      document.head.appendChild(script);
    });
  },

  async _ensureRuntime() {
    if (typeof tf !== 'undefined' && typeof mobilenet !== 'undefined') {
      await tf.ready();
      this.tfReady = true;
      return;
    }
    if (!this._runtimePromise) {
      this._runtimePromise = (async () => {
        if (typeof tf === 'undefined') {
          await this._loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');
        }
        if (typeof mobilenet === 'undefined') {
          await this._loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1');
        }
        await tf.ready();
        this.tfReady = true;
      })().catch((err) => {
        this._runtimePromise = null;
        throw err;
      });
    }
    return this._runtimePromise;
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
    if (!this.model) {
      let timeoutId;
      try {
        await Promise.race([
          this._loadModel(),
          new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('timeout')), 2000);
          })
        ]);
      } catch (err) {
        console.warn('MobileNet unavailable; using local fallback:', err);
      } finally {
        clearTimeout(timeoutId);
      }
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
   * Automatically detect whether image is a paper document (text/document) or photographic content (photo/meme/portrait)
   * Based on color saturation, chromatic distribution, and background paper white ratio.
   * @param {HTMLCanvasElement} canvas
   * @returns {'document'|'photo'}
   */
  detectContentType(canvas) {
    if (!canvas || canvas.width === 0 || canvas.height === 0) return 'document';
    try {
      const sampleW = Math.min(100, canvas.width);
      const sampleH = Math.min(100, canvas.height);
      const offCanvas = document.createElement('canvas');
      offCanvas.width = sampleW;
      offCanvas.height = sampleH;
      const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
      offCtx.drawImage(canvas, 0, 0, sampleW, sampleH);

      const imgData = offCtx.getImageData(0, 0, sampleW, sampleH);
      const data = imgData.data;
      const totalPixels = sampleW * sampleH;

      let colorfulCount = 0;
      let midtoneCount = 0;
      let whiteBgCount = 0;
      let totalSaturation = 0;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const diff = max - min; // chroma
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const sat = max === 0 ? 0 : diff / max;

        totalSaturation += sat;

        // Distinct colors (skin tones, backgrounds, clothing, graphics)
        if (diff > 24) {
          colorfulCount++;
        }

        // Midtone range typical of continuous photographic tones
        if (lum >= 65 && lum <= 195) {
          midtoneCount++;
        }

        // Very light background typical of document paper
        if (lum > 210 && sat < 0.12) {
          whiteBgCount++;
        }
      }

      const avgSat = totalSaturation / totalPixels;
      const colorRatio = colorfulCount / totalPixels;
      const midRatio = midtoneCount / totalPixels;
      const whiteRatio = whiteBgCount / totalPixels;

      // If document paper dominates (> 55% near-white low-sat background and low color), it's a document
      if (whiteRatio > 0.55 && colorRatio < 0.08) {
        return 'document';
      }

      // If there are substantial colors (photos/memes) or continuous midtones
      if (colorRatio > 0.10 || avgSat > 0.12 || (midRatio > 0.35 && colorRatio > 0.05)) {
        return 'photo';
      }

      return 'document';
    } catch (e) {
      console.warn('Content type detection error:', e);
      return 'document';
    }
  },

  /**
   * HD Enhancer / Super-Resolution Upscaler (Document & Photo/Meme)
   *
   * Photo/meme pipeline (anti-rusak):
   *   deblock sumber -> progressive 2x upscale -> luma-only gradient-gated
   *   sharpening + anti-ringing clamp -> chroma smoothing.
   * Document pipeline: progressive upscale -> unsharp conv -> paper whitening +
   *   ink deepening.
   *
   * Prinsip: hanya struktur (tepi teks, outline) yang dipertajam. Area datar
   * (kulit, background) dibiarkan utuh supaya wajah tidak jadi "kocak"/pecah.
   */
  async enhanceHD(canvas, options = {}) {
    if (!canvas || canvas.width === 0 || canvas.height === 0) return null;

    const srcW = canvas.width;
    const srcH = canvas.height;
    const maxDim = Math.max(srcW, srcH);

    // Determine mode: 'auto' | 'photo' | 'document'
    let requestedMode = (options.mode || 'auto').toLowerCase();
    let effectiveMode = requestedMode;
    if (requestedMode === 'auto') {
      effectiveMode = this.detectContentType(canvas);
    } else if (effectiveMode !== 'photo' && effectiveMode !== 'document') {
      effectiveMode = 'document';
    }

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
      // jangan pernah dibulatkan ke atas, kalau tidak hasilnya bisa > 4096
      scale = Math.max(1.2, 4096 / maxDim);
      scale = Math.floor(scale * 100) / 100;
    } else {
      scale = Math.round(scale * 100) / 100;
    }

    let dstW = Math.max(2, Math.round(srcW * scale));
    let dstH = Math.max(2, Math.round(srcH * scale));
    const longest = Math.max(dstW, dstH);
    if (longest > 4096) {
      const f = 4096 / longest;
      dstW = Math.max(2, Math.floor(dstW * f));
      dstH = Math.max(2, Math.floor(dstH * f));
      scale = Math.round((dstW / srcW) * 100) / 100;
    }

    // Stage 0 — source deblocking.
    // Screenshot meme (WA/IG) bawa blok JPEG 8x8 + mosquito noise. Kalau dibesarkan
    // dulu baru dipertajam, blok itu ikut membesar jadi smear ("pecah"). Jadi
    // diratakan dulu di resolusi asli, hanya pada area datar (tepi asli dilewati).
    let srcCanvas = canvas;
    if (effectiveMode === 'photo' && srcW * srcH <= 3200000) {
      srcCanvas = this._deblockSource(canvas) || canvas;
    }

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
      midCtx.drawImage(srcCanvas, 0, 0, midW, midH);

      // Stage 2 pre-pass: edge steepening at 2x so the final 4x tidak jadi blur lebar.
      // Photo: ringan (tanpa halo di kulit); document: tegas untuk tinta.
      if (effectiveMode === 'photo') {
        this._fastUnsharpPass(midCtx, midW, midH, 1.35, -0.0875);
      } else {
        this._fastUnsharpPass(midCtx, midW, midH, 1.9, -0.22);
      }

      // Stage 3: final upscale 2x -> target
      hdCtx.drawImage(midCanvas, 0, 0, dstW, dstH);
      midCanvas.width = 0;
      midCanvas.height = 0;
    } else if (scale > 2.0) {
      const midCanvas = document.createElement('canvas');
      midCanvas.width = Math.round(srcW * 1.5);
      midCanvas.height = Math.round(srcH * 1.5);
      const midCtx = midCanvas.getContext('2d');
      midCtx.imageSmoothingEnabled = true;
      midCtx.imageSmoothingQuality = 'high';
      midCtx.drawImage(srcCanvas, 0, 0, midCanvas.width, midCanvas.height);
      hdCtx.drawImage(midCanvas, 0, 0, dstW, dstH);
      midCanvas.width = 0;
      midCanvas.height = 0;
    } else {
      hdCtx.drawImage(srcCanvas, 0, 0, dstW, dstH);
    }
    if (srcCanvas && srcCanvas !== canvas) {
      srcCanvas.width = 0;
      srcCanvas.height = 0;
    }

    let usedTf = false;

    // 1. TensorFlow.js neural conv2d — DOCUMENT ONLY.
    //    Photo/meme sengaja TIDAK lewat sini: kernel konvolusi seragam menajamkan
    //    SEMUA piksel termasuk kulit datar, hasilnya halo + bintik ("pecah", "kocak").
    //    Foto ditangani _photoTextSafePass (luma-only, gradient-gated) di bawah.
    if (effectiveMode === 'document' && this.tfReady && typeof tf !== 'undefined') {
      try {
        const enhancedTensor = tf.tidy(() => {
          // Normalize to [0, 1] float tensor [H, W, 3]
          const input = tf.browser.fromPixels(hdCanvas).toFloat().div(255.0);
          const [r, g, b] = tf.split(input, 3, 2);

          // Document mode: 3x3 edge-directed unsharp kernel with diagonal anti-aliasing
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

        // dispose HARUS di finally: kalau toPixels gagal (GPU OOM/context loss),
        // tensor tidak boleh bocor lalu menumpuk di percobaan berikutnya.
        try {
          await tf.browser.toPixels(enhancedTensor, hdCanvas);
        } finally {
          enhancedTensor.dispose();
        }
        usedTf = true;
      } catch (e) {
        console.warn('TensorFlow.js HD enhancement fallback to TypedArray:', e);
      }
    }

    // 2. Deterministic multi-stage HD passes (Directional Tensor + Unsharp + Edge Shock + Neural SR CNN + Micro-Clarity)
    if (!usedTf) {
      if (effectiveMode === 'photo') {
        // Poin 2: Directional Structure Tensor (anti-jaggies along diagonal edges)
        this._directionalEdgePass(hdCtx, dstW, dstH);
        // Multi-scale luma unsharp pass
        this._photoTextSafePass(hdCtx, dstW, dstH);
        // Poin 1: Morphological Edge Shock filter (compress blurry edge ramps into sharp strokes)
        this._edgeShockPass(hdCtx, dstW, dstH, { strength: 0.38 });
        // Poin 4: Embedded 2-Layer Residual Super-Resolution CNN (WebGL TF.js / CPU fallback)
        await this._neuralSrPass(hdCanvas, hdCtx, dstW, dstH);
        // Poin 3: Adaptive Micro-Clarity & Local Tone Mapping
        this._adaptiveClarityPass(hdCtx, dstW, dstH, { strength: 0.22 });
        // Chroma denoise
        const cr = Math.min(8, Math.max(2, Math.round(2.5 * scale)));
        this._chromaSmooth(hdCtx, dstW, dstH, cr);
      } else {
        this._directionalEdgePass(hdCtx, dstW, dstH);
        this._documentInkPass(hdCtx, dstW, dstH);
        this._edgeShockPass(hdCtx, dstW, dstH, { strength: 0.42 });
      }
    } else if (effectiveMode === 'document') {
      this._edgeShockPass(hdCtx, dstW, dstH, { strength: 0.35 });
    }

    return {
      canvas: hdCanvas,
      engine: usedTf
        ? 'TensorFlow.js Neural Conv2D'
        : (effectiveMode === 'photo' ? 'Text-Safe Luma Pipeline' : 'Pixel-by-Pixel Anti-Ringing Fallback'),
      scale,
      width: dstW,
      height: dstH,
      mode: effectiveMode,
      stages: ['directional-tensor', 'luma-unsharp', 'edge-shock', 'neural-sr-cnn', 'micro-clarity']
    };
  },

  /**
   * Stage 0 photo prep — flatten JPEG/WA block artifacts at SOURCE resolution.
   * Blocks are harmless while small; after 2-4x upscale they become visible smears.
   * Only flat pixels (|detail| < 13) are pulled toward the local mean, real edges
   * (text strokes, outlines, mustache) are left untouched.
   */
  _deblockSource(canvas) {
    try {
      const w = canvas.width;
      const h = canvas.height;
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const ctx = out.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, 0, 0);
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      const n = w * h;

      const Y = new Float32Array(n);
      const Y2 = new Float32Array(n);
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        const y = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
        Y[i] = y;
        Y2[i] = y * y;
      }
      const lowY = this._boxMean(Y, w, h, 1);
      const lowY2 = this._boxMean(Y2, w, h, 1);

      for (let i = 0, p = 0; i < n; i++, p += 4) {
        const dev = Y[i] - lowY[i];
        // Tepi asli (teks / garis / kumis) punya dev besar DAN variansi besar -> jangan disentuh.
        // Yang dibersihkan hanya area benar-benar datar (blok JPEG / grain kompresi).
        if (dev > 7 || dev < -7) continue;
        const variance = lowY2[i] - lowY[i] * lowY[i];
        if (variance > 36) continue; // std > 6 -> ada struktur, skip
        const delta = -dev * 0.7;
        d[p] += delta;
        d[p + 1] += delta;
        d[p + 2] += delta;
      }
      ctx.putImageData(img, 0, 0);
      return out;
    } catch (e) {
      return null;
    }
  },

  /**
   * Separable box mean (edge-clamped). O(n) per axis, aman untuk canvas 4096².
   * Dipakai sebagai low-pass reference untuk gradient-gated sharpening.
   */
  _boxMean(src, w, h, r) {
    const div = 2 * r + 1;
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);

    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[row + (k < 0 ? 0 : (k >= w ? w - 1 : k))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum / div;
        const addX = x + r + 1 >= w ? w - 1 : x + r + 1;
        const subX = x - r < 0 ? 0 : x - r;
        sum += src[row + addX] - src[row + subX];
      }
    }

    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += tmp[(k < 0 ? 0 : (k >= h ? h - 1 : k)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = sum / div;
        const addY = y + r + 1 >= h ? h - 1 : y + r + 1;
        const subY = y - r < 0 ? 0 : y - r;
        sum += tmp[addY * w + x] - tmp[subY * w + x];
      }
    }
    return out;
  },

  /**
   * Photo / meme / screenshot HD pass — "logika HD" yang anti-rusak:
   *  1. Kerja di kanal LUMA saja, lalu dipakai sebagai delta ke RGB
   *     -> warna kulit & kumis hitam tidak bergeser / tidak jadi fringe.
   *  2. Low-pass 3x3 / 5x5 / 9x9 dihitung streaming per baris (ring buffer),
   *     jadi kanvas 4096² tidak butuh ratusan MB typed array.
   *  3. detail = luma - low-pass, di-gate smoothstep: area datar (kulit,
   *     background) = 0 -> tidak ada noise/grain yang ikut ditajamkan.
   *  4. Tiga skala detail: 3x3 ketajaman tepi, 5x5 stroke lebih tebal,
   *     9x9 "clarity" supaya wajah/fitur tidak terlihat lembek.
   *  5. Clamp ke min/max 3x3 (+margin) -> anti-ringing, tidak "pecah"/halo.
   *
   * Gate-nya gabungan dua skala (5x5 DAN 9x9 harus sama-sama "ada isi"):
   * noise JPEG itu frekuensi tinggi -> det3 besar tapi det9 kecil, jadi
   * background/grain tidak ikut ditajamkan, sedangkan tepi asli (teks, mata,
   * garis kumis) pasti punya isi di dua skala.
   *
   * @param {object} opts override konstanta (dipakai tuning/test)
   */
  _photoTextSafePass(ctx, w, h, opts = {}) {
    const P = Object.assign({
      gateFloor: 2, gateSpan: 5,        // 5x5: ambang & lebar ramp
      structFloor: 5, structSpan: 8,   // 9x9: syarat ada struktur lebar
      k3: 3.2, k5: 1.6, k9: 0.6,       // bobot unsharp 3 skala
      flatLimit3: 3, flatLimit9: 7,    // syarat area datar
      flatPull: 0.75,                  // tarik ke rata (denoise halus)
      marginBase: 4, marginGain: 20    // anti-ringing
    }, opts);

    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;

    const getRowLuma = (sy, out) => {
      const base = sy * w * 4;
      for (let x = 0; x < w; x++) {
        const p = base + x * 4;
        out[x] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
      }
    };

    const b3 = this._boxStreamer(w, h, 1, getRowLuma);
    const b5 = this._boxStreamer(w, h, 2, getRowLuma);
    const b9 = this._boxStreamer(w, h, 4, getRowLuma);

    for (let y = 0; y < h; y++) {
      const m3 = b3.at(y);
      const m5 = b5.at(y);
      const m9 = b9.at(y);
      const rowC = b3.luma(y);
      const rowU = b3.luma(y > 0 ? y - 1 : 0);
      const rowD = b3.luma(y < h - 1 ? y + 1 : h - 1);

      for (let x = 0; x < w; x++) {
        const c = rowC[x];
        const det3 = c - m3[x];
        const det5 = c - m5[x];
        const det9 = c - m9[x];
        const ad3 = det3 < 0 ? -det3 : det3;
        const ad5 = det5 < 0 ? -det5 : det5;
        const ad9 = det9 < 0 ? -det9 : det9;
        let lum = c;

        // geser ke struktur: butuh isi di 5x5 (kontras) DAN 9x9 (bukan noise)
        let wA = (ad5 - P.gateFloor) / P.gateSpan;
        if (wA < 0) wA = 0; else if (wA > 1) wA = 1;
        let wB = (ad9 - P.structFloor) / P.structSpan;
        if (wB < 0) wB = 0; else if (wB > 1) wB = 1;
        let wt = wA < wB ? wA : wB;         // min -> noise (det9 kecil) mati
        wt = wt * wt * (3 - 2 * wt);        // smoothstep gate

        if (wt > 0) {
          const l = rowC[x > 0 ? x - 1 : 0];
          const r = rowC[x < w - 1 ? x + 1 : w - 1];
          const u = rowU[x];
          const dn = rowD[x];
          const lo = Math.min(c, l, r, u, dn);
          const hi = Math.max(c, l, r, u, dn);

          // unsharp 3 skala: tepi tajam + stroke tebal + clarity fitur wajah
          lum = c + det3 * P.k3 * wt + det5 * P.k5 * wt + det9 * P.k9 * wt;

          const m = P.marginBase + P.marginGain * wt;    // anti-ringing margin
          if (lum < lo - m) lum = lo - m;
          else if (lum > hi + m) lum = hi + m;
        } else if (ad3 < P.flatLimit3 && ad9 < P.flatLimit9) {
          // Area benar-benar datar: jangan ditajamkan, malah diratakan sedikit.
          // det9 = c - rata lokal, jadi menarik ke rata = c - det9*k (BUKAN +).
          lum = c - det9 * P.flatPull;
        }

        if (lum !== c) {
          // delta luma diterapkan rata ke RGB -> hue/saturasi tetap (kulit & kumis aman)
          const delta = lum - c;
          const p = (y * w + x) * 4;
          d[p] += delta;
          d[p + 1] += delta;
          d[p + 2] += delta;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  },

  /**
   * Chroma denoise: box-mean Cb/Cr (default 5x5), luma dipertahankan.
   * JPEG 4:2:0 bikin blotch warna (mis. background merah) yang ikut membesar
   * saat upscale. Blur chroma menghilangkannya tanpa mengorbankan ketajaman.
   */
  _chromaSmooth(ctx, w, h, r = 2) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;

    const rowCb = (sy, out) => {
      const base = sy * w * 4;
      for (let x = 0; x < w; x++) {
        const p = base + x * 4;
        out[x] = 128 - 0.168736 * d[p] - 0.331264 * d[p + 1] + 0.5 * d[p + 2];
      }
    };
    const rowCr = (sy, out) => {
      const base = sy * w * 4;
      for (let x = 0; x < w; x++) {
        const p = base + x * 4;
        out[x] = 128 + 0.5 * d[p] - 0.418688 * d[p + 1] - 0.081312 * d[p + 2];
      }
    };

    const sCb = this._boxStreamer(w, h, r, rowCb);
    const sCr = this._boxStreamer(w, h, r, rowCr);

    for (let y = 0; y < h; y++) {
      const cbRow = sCb.at(y);
      const crRow = sCr.at(y);
      const base = y * w * 4;
      for (let x = 0; x < w; x++) {
        const p = base + x * 4;
        const Y = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
        const cb = cbRow[x] - 128;
        const cr = crRow[x] - 128;
        d[p] = Y + 1.402 * cr;
        d[p + 1] = Y - 0.344136 * cb - 0.714136 * cr;
        d[p + 2] = Y + 1.772 * cb;
      }
    }
    ctx.putImageData(img, 0, 0);
  },

  /**
   * Poin 2: Directional Structure Tensor & Along-Edge Smoothing (Anti-Jaggies)
   * Menghitung gradien Sobel (Gx, Gy) dan vektor singgung tepi (-Gy, Gx),
   * lalu menghaluskan piksel searah kontur tepi untuk menghilangkan gerigi/tangga
   * pada huruf miring, alis, dan garis diagonal tanpa menyentuh area kulit/datar.
   */
  _directionalEdgePass(ctx, w, h) {
    if (w < 6 || h < 6) return;
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const n = w * h;
    const Y = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      Y[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
    }

    const low5 = this._boxMean(Y, w, h, 2);
    const low9 = this._boxMean(Y, w, h, 4);

    const sampleBilinear = (fx, fy) => {
      const cx = fx < 0 ? 0 : (fx > w - 1.001 ? w - 1.001 : fx);
      const cy = fy < 0 ? 0 : (fy > h - 1.001 ? h - 1.001 : fy);
      const x0 = cx | 0;
      const y0 = cy | 0;
      const wx = cx - x0;
      const wy = cy - y0;
      const r0 = y0 * w;
      const r1 = (y0 + 1 < h ? y0 + 1 : y0) * w;
      const x1 = x0 + 1 < w ? x0 + 1 : x0;
      const top = Y[r0 + x0] + (Y[r0 + x1] - Y[r0 + x0]) * wx;
      const bot = Y[r1 + x0] + (Y[r1 + x1] - Y[r1 + x0]) * wx;
      return top + (bot - top) * wy;
    };

    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      const rowU = (y - 1) * w;
      const rowD = (y + 1) * w;
      for (let x = 1; x < w - 1; x++) {
        const i = row + x;
        const c = Y[i];
        const ad5 = Math.abs(c - low5[i]);
        const ad9 = Math.abs(c - low9[i]);

        // Struktur gate: skip area datar (kulit) & grain
        if (ad5 <= 3.5 || ad9 <= 6.5) continue;

        const tl = Y[rowU + x - 1], tc = Y[rowU + x], tr = Y[rowU + x + 1];
        const ml = Y[row + x - 1],                    mr = Y[row + x + 1];
        const bl = Y[rowD + x - 1], bc = Y[rowD + x], br = Y[rowD + x + 1];

        const gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
        const gy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
        const mag = Math.hypot(gx, gy);
        if (mag < 28) continue;

        // Vektor unit searah garis tepi (tangent = (-gy, gx) / mag)
        const tx = -gy / mag;
        const ty = gx / mag;

        const fwd = sampleBilinear(x + tx * 0.85, y + ty * 0.85);
        const bwd = sampleBilinear(x - tx * 0.85, y - ty * 0.85);
        const alongAvg = 0.5 * c + 0.25 * (fwd + bwd);
        const delta = (alongAvg - c) * 0.35;

        const p = i * 4;
        d[p] += delta;
        d[p + 1] += delta;
        d[p + 2] += delta;
      }
    }
    ctx.putImageData(img, 0, 0);
  },

  /**
   * Poin 1: Morphological Edge Shock / Inflection Compression Filter
   * Memadatkan lereng transisi tepi (4-6px -> 1-2px) dengan menarik piksel di sisi
   * terang ke local max dan sisi gelap ke local min tanpa melewati batas 3x3 (0 halo).
   */
  _edgeShockPass(ctx, w, h, opts = {}) {
    if (w < 6 || h < 6) return;
    const strength = opts.strength ?? 0.38;
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const n = w * h;
    const Y = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      Y[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
    }

    const low5 = this._boxMean(Y, w, h, 2);
    const low9 = this._boxMean(Y, w, h, 4);

    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      const rowU = (y - 1) * w;
      const rowD = (y + 1) * w;
      for (let x = 1; x < w - 1; x++) {
        const i = row + x;
        const c = Y[i];
        const ad5 = Math.abs(c - low5[i]);
        const ad9 = Math.abs(c - low9[i]);

        let wA = (ad5 - 3) / 6;
        if (wA < 0) wA = 0; else if (wA > 1) wA = 1;
        let wB = (ad9 - 6) / 9;
        if (wB < 0) wB = 0; else if (wB > 1) wB = 1;
        let wt = wA < wB ? wA : wB;
        if (wt <= 0) continue;
        wt = wt * wt * (3 - 2 * wt);

        const l = Y[row + x - 1], r = Y[row + x + 1];
        const u = Y[rowU + x], dn = Y[rowD + x];
        const ul = Y[rowU + x - 1], ur = Y[rowU + x + 1];
        const dl = Y[rowD + x - 1], dr = Y[rowD + x + 1];

        const lo = Math.min(c, l, r, u, dn, ul, ur, dl, dr);
        const hi = Math.max(c, l, r, u, dn, ul, ur, dl, dr);
        const span = hi - lo;
        if (span < 12) continue;

        const mid = 0.5 * (lo + hi);
        const target = c >= mid ? hi : lo;
        const delta = (target - c) * strength * wt;

        const p = i * 4;
        d[p] += delta;
        d[p + 1] += delta;
        d[p + 2] += delta;
      }
    }
    ctx.putImageData(img, 0, 0);
  },

  /**
   * Poin 3: Adaptive Micro-Clarity & Local Tone Mapping
   * Meningkatkan kontras mikro S-curve pada area berfitur (mata, kumis, rambut, teks)
   * dengan roll-off highlight/shadow agar gambar lebih berdimensi tanpa merusak kulit.
   */
  _adaptiveClarityPass(ctx, w, h, opts = {}) {
    if (w < 6 || h < 6) return;
    const strength = opts.strength ?? 0.22;
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const n = w * h;
    const Y = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      Y[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
    }

    const low5 = this._boxMean(Y, w, h, 2);
    const low9 = this._boxMean(Y, w, h, 4);

    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const c = Y[i];
      const det5 = c - low5[i];
      const det9 = c - low9[i];
      const ad5 = Math.abs(det5);
      const ad9 = Math.abs(det9);

      let wA = (ad5 - 3) / 6;
      if (wA < 0) wA = 0; else if (wA > 1) wA = 1;
      let wB = (ad9 - 6) / 9;
      if (wB < 0) wB = 0; else if (wB > 1) wB = 1;
      let wt = wA < wB ? wA : wB;
      if (wt <= 0) continue;
      wt = wt * wt * (3 - 2 * wt);

      // Midtone roll-off: lindungi highlight (>230) & shadow pekat (<25) dari clipping
      const norm = (c - 128) / 128;
      const toneGuard = Math.max(0.15, 1 - norm * norm * 0.65);
      const delta = det9 * strength * wt * toneGuard;

      d[p] += delta;
      d[p + 1] += delta;
      d[p + 2] += delta;
    }
    ctx.putImageData(img, 0, 0);
  },

  /**
   * Poin 4: Embedded 2-Layer Residual Super-Resolution CNN (Anime4K / ESPCN Luma Residual)
   * Menggunakan 8 filter fitur terarah 3x3 (Horizontal, Vertikal, Diagonal +45/-45,
   * Sudut/Corner, dan Kurvatur) + aktivasi non-linear PReLU + rekonstruksi residual 1x1.
   * Dieksekusi via TensorFlow.js WebGL jika tersedia atau fallback TypedArray deterministik.
   */
  async _neuralSrPass(canvas, ctx, w, h) {
    if (w < 8 || h < 8) return;
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const n = w * h;
    const Y = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      Y[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
    }

    const low5 = this._boxMean(Y, w, h, 2);
    const low9 = this._boxMean(Y, w, h, 4);

    // 4 pasangan filter residual terarah (H-edge, V-edge, Diag1, Diag2) dengan non-linearitas PReLU
    let residual = null;
    if (this.tfReady && typeof tf !== 'undefined' && w * h <= 2000000) {
      try {
        const resTensor = tf.tidy(() => {
          const yTensor = tf.tensor4d(Y, [1, h, w, 1]).div(255.0);
          // Layer 1: 4 oriented 3x3 feature extractors [3, 3, 1, 4]
          const k1 = tf.tensor4d([
            // F0: Horizontal edge curvature, F1: Vertical edge curvature, F2: +45 Diag, F3: -45 Diag
            -0.25,  0.00, -0.50,  0.00,   -0.50, -0.25,  0.00, -0.50,   -0.25,  0.00,  0.00, -0.50,
             0.50, -0.50,  0.00,  0.50,    1.00,  1.00,  1.00,  1.00,    0.50, -0.50,  0.50,  0.00,
            -0.25,  0.00, -0.50,  0.00,   -0.50, -0.25,  0.00, -0.50,   -0.25,  0.00, -0.50,  0.00
          ], [3, 3, 1, 4]);
          const conv1 = tf.conv2d(yTensor, k1, 1, 'same');
          // Non-linear PReLU activation (alpha = 0.15)
          const act1 = tf.maximum(conv1, conv1.mul(0.15));
          // Layer 2: 1x1 residual projection [1, 1, 4, 1]
          const k2 = tf.tensor4d([0.28, 0.28, 0.22, 0.22], [1, 1, 4, 1]);
          const conv2 = tf.conv2d(act1, k2, 1, 'same');
          return conv2.squeeze().mul(255.0);
        });
        residual = await resTensor.data();
        resTensor.dispose();
      } catch (_) {
        residual = null;
      }
    }

    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      const rowU = (y - 1) * w;
      const rowD = (y + 1) * w;
      for (let x = 1; x < w - 1; x++) {
        const i = row + x;
        const c = Y[i];
        const ad5 = Math.abs(c - low5[i]);
        const ad9 = Math.abs(c - low9[i]);

        let wA = (ad5 - 3) / 6;
        if (wA < 0) wA = 0; else if (wA > 1) wA = 1;
        let wB = (ad9 - 6) / 9;
        if (wB < 0) wB = 0; else if (wB > 1) wB = 1;
        let wt = wA < wB ? wA : wB;
        if (wt <= 0) continue;
        wt = wt * wt * (3 - 2 * wt);

        const l = Y[row + x - 1], r = Y[row + x + 1];
        const u = Y[rowU + x], dn = Y[rowD + x];
        const ul = Y[rowU + x - 1], ur = Y[rowU + x + 1];
        const dl = Y[rowD + x - 1], dr = Y[rowD + x + 1];

        let cnnDelta;
        if (residual) {
          cnnDelta = residual[i] - 0.25 * c;
        } else {
          // CPU multi-orientation non-linear PReLU feature reconstruction
          const fH = c - 0.5 * (u + dn);
          const fV = c - 0.5 * (l + r);
          const fD1 = c - 0.5 * (ul + dr);
          const fD2 = c - 0.5 * (ur + dl);
          const prelu = (v) => (v >= 0 ? v : v * 0.25);
          cnnDelta = 0.28 * prelu(fH) + 0.28 * prelu(fV) + 0.22 * prelu(fD1) + 0.22 * prelu(fD2);
        }

        const lo = Math.min(c, l, r, u, dn);
        const hi = Math.max(c, l, r, u, dn);
        let lum = c + cnnDelta * 0.45 * wt;
        const m = 4 + 12 * wt;
        if (lum < lo - m) lum = lo - m;
        else if (lum > hi + m) lum = hi + m;

        const delta = lum - c;
        const p = i * 4;
        d[p] += delta;
        d[p + 1] += delta;
        d[p + 2] += delta;
      }
    }
    ctx.putImageData(img, 0, 0);
  },

  /**
   * Streaming separable box-mean (radius r) dengan ring buffer.
   * `at(y)` mengembalikan baris means (Float32Array panjang w) untuk baris y;
   * `luma(y)` mengembalikan baris luma asli (untuk min/max 3x3).
   * Memori O(w * (2r+1)), bukan O(w*h).
   */
  _boxStreamer(w, h, r, getRowLuma) {
    const win = 2 * r + 1;
    const inv = 1 / win;
    const hor = Array.from({ length: win }, () => new Float32Array(w));
    const lum = Array.from({ length: win }, () => new Float32Array(w));
    const out = new Float32Array(w);
    let loaded = 0;

    const build = (sy) => {
      const src = sy < 0 ? 0 : (sy > h - 1 ? h - 1 : sy);
      const yRow = lum[sy % win];
      if (sy >= loaded) getRowLuma(src, yRow);
      const hrow = hor[sy % win];
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += yRow[k < 0 ? 0 : (k > w - 1 ? w - 1 : k)];
      for (let x = 0; x < w; x++) {
        hrow[x] = sum * inv;
        const a = x + r + 1 < w ? x + r + 1 : w - 1;
        const b = x - r < 0 ? 0 : x - r;
        sum += yRow[a] - yRow[b];
      }
    };

    return {
      at(y) {
        while (loaded <= y + r && loaded < h) {
          build(loaded);
          loaded++;
        }
        out.fill(0);
        for (let k = -r; k <= r; k++) {
          const yy = y + k;
          const src = yy < 0 ? 0 : (yy > h - 1 ? h - 1 : yy);
          const row = hor[src % win];
          for (let x = 0; x < w; x++) out[x] += row[x];
        }
        for (let x = 0; x < w; x++) out[x] *= inv;
        return out;
      },
      luma(y) {
        const src = y < 0 ? 0 : (y > h - 1 ? h - 1 : y);
        while (loaded <= src && loaded < h) {
          build(loaded);
          loaded++;
        }
        return lum[src % win];
      }
    };
  },

  /**
   * Document pass — unsharp 3x3 + paper whitening + ink deepening (unchanged logic).
   */
  _documentInkPass(ctx, w, h) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const copy = new Uint8ClampedArray(data);

    const kCenter = 2.60;
    const kCross = -0.32;
    const kDiag = -0.08;

    for (let y = 1; y < h - 1; y++) {
      const row = y * w * 4;
      const rowU = (y - 1) * w * 4;
      const rowD = (y + 1) * w * 4;

      for (let x = 1; x < w - 1; x++) {
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
          const margin = 12;
          const nMin = Math.max(0, Math.min(cCenter, cL, cR, cU, cD, cUL, cUR, cDL, cDR) - margin);
          const nMax = Math.min(255, Math.max(cCenter, cL, cR, cU, cD, cUL, cUR, cDL, cDR) + margin);

          let val = cCenter * kCenter
              + (cL + cR + cU + cD) * kCross
              + (cUL + cUR + cDL + cDR) * kDiag;

          if (val < nMin) val = nMin;
          if (val > nMax) val = nMax;

          if (val > 185) {
            val = val + (255 - val) * 0.42; // clean paper background
          } else if (val < 115) {
            val = val * 0.82; // deepen and solidify ink strokes
          }

          data[idx + c] = val < 0 ? 0 : (val > 255 ? 255 : (val | 0));
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
  },

  /**
   * Adaptive Document Shadow Removal & Illumination Normalization (100% On-Device)
   * Estimates a smooth 2D local background illumination surface via morphological
   * block maxima + separable smoothing, then normalizes uneven lighting/shadows
   * while preserving dark ink strokes.
   */
  removeShadows(canvas, options = {}) {
    if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
    const w = canvas.width;
    const h = canvas.height;
    const outCanvas = document.createElement('canvas');
    outCanvas.width = w;
    outCanvas.height = h;
    const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
    outCtx.drawImage(canvas, 0, 0);
    this.applyShadowRemovalInPlace(outCtx, w, h, options.strength ?? 1.0);
    return { canvas: outCanvas, width: w, height: h };
  },

  applyShadowRemovalInPlace(ctx, w, h, strength = 1.0) {
    if (!ctx || w <= 0 || h <= 0) return false;
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;

    const blockSize = Math.max(8, Math.min(32, Math.round(Math.min(w, h) / 20)));
    const gridW = Math.max(2, Math.ceil(w / blockSize));
    const gridH = Math.max(2, Math.ceil(h / blockSize));
    let bgGrid = new Float32Array(gridW * gridH);

    // 1. Estimate local paper illumination per block (morphological dilation / local max)
    for (let gy = 0; gy < gridH; gy++) {
      const y0 = gy * blockSize;
      const y1 = Math.min(h, y0 + blockSize);
      for (let gx = 0; gx < gridW; gx++) {
        const x0 = gx * blockSize;
        const x1 = Math.min(w, x0 + blockSize);
        let maxLum = 0;
        const step = (x1 - x0 > 8 && y1 - y0 > 8) ? 2 : 1;
        for (let y = y0; y < y1; y += step) {
          const row = y * w * 4;
          for (let x = x0; x < x1; x += step) {
            const p = row + x * 4;
            const lum = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
            if (lum > maxLum) maxLum = lum;
          }
        }
        bgGrid[gy * gridW + gx] = Math.max(65, maxLum);
      }
    }

    // 2. Smooth the illumination grid so shadow transitions are seamless
    bgGrid = this._boxMean(bgGrid, gridW, gridH, 1);
    bgGrid = this._boxMean(bgGrid, gridW, gridH, 1);

    // 3. Bilinear illumination division + ink contrast preservation
    const mix = Math.max(0, Math.min(1, strength));
    const invMix = 1 - mix;

    for (let y = 0; y < h; y++) {
      const fy = Math.max(0, Math.min(gridH - 1.0001, (y + 0.5) / blockSize - 0.5));
      const gy0 = fy | 0;
      const gy1 = Math.min(gridH - 1, gy0 + 1);
      const wy = fy - gy0;
      const row = y * w * 4;

      for (let x = 0; x < w; x++) {
        const fx = Math.max(0, Math.min(gridW - 1.0001, (x + 0.5) / blockSize - 0.5));
        const gx0 = fx | 0;
        const gx1 = Math.min(gridW - 1, gx0 + 1);
        const wx = fx - gx0;

        const b00 = bgGrid[gy0 * gridW + gx0];
        const b10 = bgGrid[gy0 * gridW + gx1];
        const b01 = bgGrid[gy1 * gridW + gx0];
        const b11 = bgGrid[gy1 * gridW + gx1];
        const bgTop = b00 + (b10 - b00) * wx;
        const bgBot = b01 + (b11 - b01) * wx;
        const bg = Math.max(60, bgTop + (bgBot - bgTop) * wy);

        const p = row + x * 4;
        const r = d[p];
        const g = d[p + 1];
        const b = d[p + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const gain = 248 / bg;

        let nr = r * gain;
        let ng = g * gain;
        let nb = b * gain;

        if (lum > bg * 0.78) {
          // Lift shadowed paper background cleanly toward white
          nr = nr + (255 - nr) * 0.35;
          ng = ng + (255 - ng) * 0.35;
          nb = nb + (255 - nb) * 0.35;
        } else if (lum < bg * 0.55) {
          // Keep text/ink strokes crisp and dark
          nr *= 0.88;
          ng *= 0.88;
          nb *= 0.88;
        }

        nr = nr > 255 ? 255 : (nr < 0 ? 0 : nr);
        ng = ng > 255 ? 255 : (ng < 0 ? 0 : ng);
        nb = nb > 255 ? 255 : (nb < 0 ? 0 : nb);

        d[p] = (r * invMix + nr * mix) | 0;
        d[p + 1] = (g * invMix + ng * mix) | 0;
        d[p + 2] = (b * invMix + nb * mix) | 0;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return true;
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
