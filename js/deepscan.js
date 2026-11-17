/**
 * deepscan.js — DeepScan: per-file detection + batch session creation.
 * Owner: deepscan module. Runtime unit: batch pipeline (localfile import / drop / folder scan).
 * State: none persisted here (sessions live in storage.js).
 */
const deepscan = {
  MAX_FILE_SIZE: 15 * 1024 * 1024, // 15 MB
  ACCEPTED_TYPES: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'],
  ACCEPTED_EXTENSIONS: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'],

  async scanFile(file) {
    const name = (file.name || '').toLowerCase();
    if (!this.ACCEPTED_TYPES.includes(file.type) && !this.ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      throw new Error('Format file tidak didukung. Gunakan PNG, JPG, JPEG, WEBP atau GIF.');
    }
    if (file.size <= 0 || file.size > this.MAX_FILE_SIZE) {
      throw new Error('File terlalu besar. Maksimal 15 MB.');
    }

    if (typeof createImageBitmap === 'function') {
      let bitmap;
      try {
        bitmap = await createImageBitmap(file);
      } catch (err) {
        console.warn('ImageBitmap decode failed; falling back to Image:', err);
        return this.scanDataURL(await this.toDataURL(file));
      }
      try {
        return await this.scanImage(bitmap);
      } finally {
        bitmap.close();
      }
    }

    return this.scanDataURL(await this.toDataURL(file));
  },

  async scanDataURL(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => this.scanImage(img).then(resolve, reject);
      img.onerror = () => reject(new Error('Gagal memuat gambar.'));
      img.src = dataUrl;
    });
  },

  async scanImage(image) {
    const width = image.width || image.naturalWidth;
    const height = image.height || image.naturalHeight;
    if (!width || !height) throw new Error('Dimensi gambar tidak valid.');

    const maxSize = config.IMAGE_MAX_SIZE;
    const scale = Math.min(1, maxSize / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas gambar tidak dapat dibuat.');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const result = await this.detect(canvas);
    return {
      canvas,
      corners: result?.corners || null,
      confidence: result?.confidence || 0,
      category: result?.category || 'Dokumen',
      quality: result?.quality || null
    };
  },

  async scanDirectory(files) {
    const results = [];
    const errors = [];
    for (const file of files) {
      try { results.push(await this.scanFile(file)); }
      catch (err) { errors.push({ name: file.name, error: err.message }); }
    }
    return { results, errors };
  },

  /** Load image from File into canvas */
  toDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Gagal membaca file.'));
      reader.readAsDataURL(file);
    });
  },

  /** Public detection: ML detector → edge fallback → classifier (never throws) */
  async detect(canvas) {
    let result = null;
    try {
      result = window.MLDetector?.detect ? await window.MLDetector.detect(canvas) : null;
    } catch (err) {
      console.warn('MLDetector failed, using edge fallback:', err);
      result = null;
    }

    if (!result || (result.confidence ?? 0) < 0.3) {
      try {
        if (typeof edgeDetection !== 'undefined') {
          result = edgeDetection.detectContour(canvas, { relaxed: true });
        }
      } catch (err) {
        console.warn('Edge fallback failed:', err);
        result = result || null;
      }
    }

    let category = 'Dokumen';
    try {
      category = await this.classifyCategory(canvas);
    } catch (err) {
      console.warn('classifyCategory failed:', err);
    }

    let quality = null;
    try {
      if (window.MLDetector?.analyzeQuality) {
        quality = window.MLDetector.analyzeQuality(canvas);
      }
    } catch (_) {}

    return { ...(result || {}), confidence: result?.confidence || 0, category, quality };
  },

  classifyCategory(canvas) {
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      return Promise.resolve('Dokumen');
    }
    try {
      const contentType = window.MLDetector?.detectContentType
        ? window.MLDetector.detectContentType(canvas)
        : 'document';
      if (contentType === 'photo') {
        return Promise.resolve('Foto / Gambar');
      }
      const w = canvas.width;
      const h = canvas.height;
      if (w >= 20 && h >= 20) {
        if (h / w >= 1.95) return Promise.resolve('Struk / Nota');
        const ratio = Math.max(w, h) / Math.min(w, h);
        if (w > h && ratio >= 1.50 && ratio <= 1.66) return Promise.resolve('Kartu / ID');
      }
    } catch (_) {}
    return Promise.resolve('Dokumen');
  },

  _pdfJsPromise: null,

  isPdfFile(file) {
    if (!file) return false;
    const name = (file.name || '').toLowerCase();
    return file.type === 'application/pdf' || name.endsWith('.pdf');
  },

  isValidPdfBuffer(buffer) {
    if (!buffer || buffer.byteLength < 64) return false;
    const bytes = new Uint8Array(buffer);
    // Must start with %PDF-
    if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46 || bytes[4] !== 0x2D) {
      return false;
    }
    const text = new TextDecoder('latin1').decode(bytes);
    return text.includes('%%EOF') && (text.includes('/Page') || text.includes('/Pages'));
  },

  async ensurePdfJs() {
    if (typeof window.pdfjsLib !== 'undefined') return window.pdfjsLib;
    if (!this._pdfJsPromise) {
      this._pdfJsPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.onload = () => {
          if (window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
              'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            resolve(window.pdfjsLib);
          } else {
            reject(new Error('PDF.js gagal diinisialisasi.'));
          }
        };
        script.onerror = () => reject(new Error('Gagal memuat PDF.js.'));
        document.head.appendChild(script);
      }).catch((err) => {
        this._pdfJsPromise = null;
        throw err;
      });
    }
    return this._pdfJsPromise;
  },

  /**
   * Extract embedded JPEG streams (SOI 0xFFD8FF .. EOI 0xFFD9) from a PDF binary buffer
   * Used as fast offline fallback when PDF was generated from scanned images / jsPDF.
   */
  _extractPdfEmbeddedJpegs(bytes) {
    const blobs = [];
    const len = bytes.length;
    let i = 0;
    while (i < len - 4) {
      if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8 && bytes[i + 2] === 0xFF) {
        const start = i;
        let end = -1;
        for (let j = start + 4; j < len - 1; j++) {
          if (bytes[j] === 0xFF && bytes[j + 1] === 0xD9) {
            end = j + 2;
          }
          // Stop if we hit endstream keyword
          if (
            bytes[j] === 0x65 && bytes[j + 1] === 0x6E && bytes[j + 2] === 0x64 &&
            bytes[j + 3] === 0x73 && bytes[j + 4] === 0x74 && bytes[j + 5] === 0x72
          ) {
            break;
          }
        }
        if (end > start + 32) {
          blobs.push(new Blob([bytes.subarray(start, end)], { type: 'image/jpeg' }));
          i = end;
          continue;
        }
      }
      i++;
    }
    return blobs;
  },

  /**
   * Parse and render a PDF file into an array of scanned page canvases/objects.
   * Rejects invalid/truncated PDFs with 'PDF tidak didukung' message.
   */
  async scanPdfFile(file, opts = {}) {
    if (!file || file.size <= 0 || file.size > this.MAX_FILE_SIZE) {
      throw new Error('File PDF terlalu besar atau kosong.');
    }
    const buffer = await file.arrayBuffer();
    if (!this.isValidPdfBuffer(buffer)) {
      const msg = (typeof t === 'function' && t('pdfNotSupported')) || 'File PDF tidak valid atau belum didukung';
      throw new Error(msg);
    }

    const maxPages = opts.maxPages || (typeof config !== 'undefined' ? config.MAX_SESSION_PAGES : 30);
    const baseName = (file.name || 'document.pdf').replace(/\.pdf$/i, '');
    const results = [];

    // 1. Try fast embedded JPEG extraction first (instant offline support for jsPDF & scanned PDFs)
    const bytes = new Uint8Array(buffer);
    const jpegBlobs = this._extractPdfEmbeddedJpegs(bytes);
    if (jpegBlobs.length > 0) {
      const limit = Math.min(jpegBlobs.length, maxPages);
      for (let idx = 0; idx < limit; idx++) {
        const dataUrl = await this.toDataURL(jpegBlobs[idx]);
        const det = await this.scanDataURL(dataUrl);
        results.push({
          ...det,
          name: `${baseName}_p${idx + 1}.jpg`
        });
      }
      return results;
    }

    // 2. Try full PDF.js rendering for vector/text PDFs
    try {
      const pdfjsLib = await this.ensurePdfJs();
      const pdfDoc = await pdfjsLib.getDocument({ data: buffer }).promise;
      const total = Math.min(pdfDoc.numPages, maxPages);
      for (let pageNum = 1; pageNum <= total; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        const det = await this.detect(canvas);
        results.push({
          canvas,
          corners: det?.corners || null,
          confidence: det?.confidence || 0,
          category: det?.category || 'Dokumen',
          quality: det?.quality || null,
          name: `${baseName}_p${pageNum}.jpg`
        });
      }
      if (results.length > 0) return results;
    } catch (err) {
      console.warn('PDF.js render fallback:', err);
    }

    // 3. Offline fallback for valid text PDFs when CDN is unreachable
    const text = new TextDecoder('latin1').decode(bytes);
    const pageMatches = text.match(/\/Type\s*\/Page\b/g) || [];
    const numPages = Math.min(Math.max(1, pageMatches.length), maxPages);
    const literalStrings = [...text.matchAll(/\(([^()\\]{1,120})\)\s*Tj/g)].map(m => m[1]);

    for (let idx = 0; idx < numPages; idx++) {
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 848;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#0f172a';
      ctx.font = '18px sans-serif';
      const lineText = literalStrings[idx] || `${baseName} - Halaman ${idx + 1}`;
      ctx.fillText(lineText, 48, 80);
      const det = await this.detect(canvas);
      results.push({
        canvas,
        corners: det?.corners || null,
        confidence: det?.confidence || 0,
        category: det?.category || 'Dokumen',
        quality: det?.quality || null,
        name: `${baseName}_p${idx + 1}.jpg`
      });
    }
    return results;
  },

  /** Batch import helper: detect all files, return { pages[], errors[] } */
  async batchImport(files, opts = {}) {
    const { autoCrop = true, createSession = true } = opts;
    const pages = [];
    const errors = [];
    const maxPages = typeof config !== 'undefined' ? config.MAX_SESSION_PAGES : 30;

    const pushDetectedCanvas = (det, pageName) => {
      const canvas = det.canvas;
      try {
        if (autoCrop && det.corners && det.confidence >= 0.3) {
          const ordered = (typeof edgeDetection !== 'undefined' && edgeDetection.orderCorners)
            ? edgeDetection.orderCorners(det.corners)
            : det.corners;
          const topW = Math.hypot(ordered[1].x - ordered[0].x, ordered[1].y - ordered[0].y);
          const botW = Math.hypot(ordered[2].x - ordered[3].x, ordered[2].y - ordered[3].y);
          const leftH = Math.hypot(ordered[3].x - ordered[0].x, ordered[3].y - ordered[0].y);
          const rightH = Math.hypot(ordered[2].x - ordered[1].x, ordered[2].y - ordered[1].y);
          const targetW = Math.max(30, Math.round(Math.max(topW, botW)));
          const targetH = Math.max(30, Math.round(Math.max(leftH, rightH)));
          const warped = (typeof edgeDetection !== 'undefined' && edgeDetection.warpPerspective)
            ? edgeDetection.warpPerspective(canvas, ordered, targetW, targetH)
            : null;
          if (warped) {
            try {
              if (warped.width >= 20 && warped.height >= 20) {
                canvas.width = warped.width;
                canvas.height = warped.height;
                canvas.getContext('2d').drawImage(warped, 0, 0);
              }
            } finally {
              warped.width = 0;
              warped.height = 0;
            }
          }
        }
        const pageW = canvas.width;
        const pageH = canvas.height;
        const imageDataUrl = canvas.toDataURL('image/jpeg', 0.85);
        pages.push({
          name: pageName,
          image: imageDataUrl,
          w: pageW,
          h: pageH,
          detected: det.confidence >= 0.3,
          confidence: det.confidence || 0,
          corners: det.corners || null,
          category: det.category,
          quality: det.quality || null
        });
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    };

    for (const file of files) {
      if (pages.length >= maxPages) break;
      try {
        if (this.isPdfFile(file)) {
          const pdfDetections = await this.scanPdfFile(file, { maxPages: maxPages - pages.length });
          for (const det of pdfDetections) {
            if (pages.length >= maxPages) {
              if (det.canvas) { det.canvas.width = 0; det.canvas.height = 0; }
              break;
            }
            pushDetectedCanvas(det, det.name || file.name);
          }
        } else {
          const det = await this.scanFile(file);
          pushDetectedCanvas(det, file.name);
        }
      } catch (err) {
        errors.push({ name: file.name, error: err.message });
      }
    }
    return { pages, errors };
  }
};

window.deepscan = deepscan;
