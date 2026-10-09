/**
 * deepscan.js — DeepScan: per-file detection + batch session creation.
 * Owner: deepscan module. Runtime unit: batch pipeline (localfile import / drop / folder scan).
 * State: none persisted here (sessions live in storage.js).
 */
const deepscan = {
  MAX_FILE_SIZE: 15 * 1024 * 1024, // 15 MB
  ACCEPTED_TYPES: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  ACCEPTED_EXTENSIONS: ['.png', '.jpg', '.jpeg', '.webp', '.gif'],

  async scanFile(file) {
    const name = (file.name || '').toLowerCase();
    if (!this.ACCEPTED_TYPES.includes(file.type) && !this.ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      throw new Error('Format file tidak didukung. Gunakan PNG, JPG, JPEG, WEBP atau GIF.');
    }
    if (file.size > this.MAX_FILE_SIZE) {
      throw new Error('File terlalu besar. Maksimal 15 MB.');
    }

    const dataUrl = await this.toDataURL(file);
    return this.scanDataURL(dataUrl);
  },

  async scanDataURL(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);

        (async () => {
          try {
            const result = await this.detect(canvas);
            resolve({ canvas, corners: result?.corners || null, confidence: result?.confidence || 0, category: result?.category || 'Dokumen' });
          } catch (err) {
            reject(err);
          }
        })();
      };
      img.onerror = () => reject(new Error('Gagal memuat gambar.'));
      img.src = dataUrl;
    });
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
    return { ...(result || {}), confidence: result?.confidence || 0, category };
  },

  classifyCategory(canvas) {
    if (window.MLDetector?.classifyDocument) {
      return window.MLDetector.classifyDocument(canvas).then((res) => res?.category || 'Dokumen');
    }
    return Promise.resolve('Dokumen');
  },

  /** Batch import helper: detect all files, return { pages[], errors[] } */
  async batchImport(files, opts = {}) {
    const { autoCrop = true, createSession = true } = opts;
    const pages = [];
    const errors = [];

    for (const file of files) {
      try {
        const det = await this.scanFile(file);
        const canvas = det.canvas;
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
          if (warped && warped.width >= 20 && warped.height >= 20) {
            canvas.width = warped.width;
            canvas.height = warped.height;
            canvas.getContext('2d').drawImage(warped, 0, 0);
          }
        }
        pages.push({
          name: file.name,
          image: canvas.toDataURL('image/jpeg', 0.85),
          w: canvas.width,
          h: canvas.height,
          detected: det.confidence >= 0.3,
          category: det.category
        });
      } catch (err) {
        errors.push({ name: file.name, error: err.message });
      }
    }
    return { pages, errors };
  }
};

window.deepscan = deepscan;
