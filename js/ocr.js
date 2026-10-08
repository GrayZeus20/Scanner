/**
 * ocr.js — Resilient client-side OCR engine using Tesseract.js
 * Features:
 * - Dynamic library check and fallback loading
 * - Pre-processing (downscaling & contrast enhancement) for speed and high accuracy
 * - Multi-language support (Indonesian & English) with automatic fallback
 * - Progress tracking & cancellation
 */
const ocrEngine = {
  worker: null,
  currentLang: 'ind+eng',
  _abortFlag: false,

  async ensureTesseract() {
    if (typeof Tesseract !== 'undefined') return true;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 150));
      if (typeof Tesseract !== 'undefined') return true;
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.onload = () => resolve(true);
      script.onerror = () => reject(new Error('Gagal memuat library Tesseract. Periksa koneksi internet Anda.'));
      document.head.appendChild(script);
    });
  },

  async getWorker(lang = 'ind+eng') {
    if (this.worker && this.currentLang === lang) return this.worker;
    if (this.worker) {
      await this.terminate();
    }
    await this.ensureTesseract();

    const logger = m => {
      if (this._progressCallback) {
        if (m.status === 'recognizing text' && typeof m.progress === 'number') {
          this._progressCallback(m.progress);
        } else if (m.status === 'loading tesseract core' || m.status === 'loading language traineddata') {
          this._progressCallback(0.15);
        }
      }
    };

    try {
      this.worker = await Tesseract.createWorker(lang, 1, { logger });
      this.currentLang = lang;
      return this.worker;
    } catch (primaryErr) {
      console.warn(`OCR worker init failed for [${lang}], falling back to 'eng':`, primaryErr);
      try {
        this.worker = await Tesseract.createWorker('eng', 1, { logger });
        this.currentLang = 'eng';
        return this.worker;
      } catch (fallbackErr) {
        console.error('OCR worker fallback failed:', fallbackErr);
        throw new Error('Gagal menginisialisasi OCR. Pastikan koneksi internet aktif untuk mengunduh model bahasa.');
      }
    }
  },

  /**
   * Pre-process canvas for OCR:
   * Scale large photos to optimal OCR size (~1400-1600px) and enhance contrast
   */
  prepareCanvas(canvas) {
    if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
    const maxDim = 1600;
    const w = canvas.width;
    const h = canvas.height;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const targetW = Math.max(100, Math.round(w * scale));
    const targetH = Math.max(100, Math.round(h * scale));

    const offscreen = document.createElement('canvas');
    offscreen.width = targetW;
    offscreen.height = targetH;
    const octx = offscreen.getContext('2d');

    // Slight contrast and grayscale boost for clean text extraction
    octx.filter = 'contrast(125%) grayscale(100%)';
    octx.drawImage(canvas, 0, 0, targetW, targetH);
    return offscreen;
  },

  abort() {
    this._abortFlag = true;
  },

  async recognize(canvas, progressCallback, abortCheck, lang = 'ind+eng') {
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error(t('ocrCanvasEmpty') || 'Canvas kosong atau tidak valid.');
    }

    this._abortFlag = false;
    this._progressCallback = progressCallback || (() => {});

    try {
      const processedCanvas = this.prepareCanvas(canvas) || canvas;
      const worker = await this.getWorker(lang);

      if (this._abortFlag || (abortCheck && abortCheck())) {
        throw new Error(t('ocrCancelled') || 'OCR dibatalkan');
      }

      let checkInterval;
      const timeoutMs = config.OCR?.timeout || 50000;

      const result = await Promise.race([
        worker.recognize(processedCanvas).then(res => {
          clearInterval(checkInterval);
          return res;
        }),
        new Promise((_, reject) => {
          checkInterval = setInterval(() => {
            if (this._abortFlag || (abortCheck && abortCheck())) {
              clearInterval(checkInterval);
              this.terminate();
              reject(new Error(t('ocrCancelled') || 'OCR dibatalkan'));
            }
          }, 200);
          setTimeout(() => {
            clearInterval(checkInterval);
            this.terminate();
            reject(new Error(t('ocrTimedOut') || 'Waktu pemrosesan OCR habis.'));
          }, timeoutMs);
        })
      ]);

      this._progressCallback = null;
      return result?.data?.text?.trim() || '';
    } catch (error) {
      this._progressCallback = null;
      console.error('OCR Error:', error);
      throw error;
    }
  },

  async terminate() {
    if (this.worker) {
      try {
        await this.worker.terminate();
      } catch (_) {}
      this.worker = null;
    }
  }
};
