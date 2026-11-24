const pdfExport = {
  _jsPdfPromise: null,

  async ensureJsPdf() {
    if (typeof window.jspdf !== 'undefined' && window.jspdf.jsPDF) {
      return window.jspdf.jsPDF;
    }
    // Fail fast when completely offline so offline fallback PDF encoder runs immediately
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Offline: jsPDF tidak tersedia di memori');
    }
    if (!this._jsPdfPromise) {
      this._jsPdfPromise = new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn, val) => {
          if (settled) return;
          settled = true;
          clearTimeout(hardTimer);
          fn(val);
        };
        const hardTimer = setTimeout(() => {
          finish(reject, new Error('Timeout memuat library jsPDF (jaringan lambat).'));
        }, 4500);

        const existing = document.querySelector('script[src*="jspdf"]');
        if (existing && !existing.dataset.loadFailed) {
          const poll = setInterval(() => {
            if (typeof window.jspdf !== 'undefined' && window.jspdf.jsPDF) {
              clearInterval(poll);
              finish(resolve, window.jspdf.jsPDF);
            } else if (settled) {
              clearInterval(poll);
            }
          }, 100);
          existing.addEventListener('error', () => {
            clearInterval(poll);
            existing.dataset.loadFailed = '1';
            finish(reject, new Error('Gagal memuat library jsPDF.'));
          }, { once: true });
          return;
        }
        if (existing) existing.remove();
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        script.onload = () => {
          if (typeof window.jspdf !== 'undefined' && window.jspdf.jsPDF) {
            finish(resolve, window.jspdf.jsPDF);
          } else {
            finish(reject, new Error('jsPDF library gagal diinisialisasi.'));
          }
        };
        script.onerror = () => {
          script.dataset.loadFailed = '1';
          finish(reject, new Error('Gagal memuat library jsPDF.'));
        };
        document.head.appendChild(script);
      }).catch((err) => {
        this._jsPdfPromise = null;
        throw err;
      });
    }
    return this._jsPdfPromise;
  },

  /**
   * Pure-JS minimal PDF 1.4 encoder (zero external dependencies).
   * Guarantees PDF export NEVER gets stuck even when 100% offline without jsPDF CDN.
   * Each entry: { jpegBytes: Uint8Array, width: number, height: number }
   */
  _buildMinimalPdfBlob(pages) {
    const enc = new TextEncoder();
    const chunks = [];
    let offset = 0;
    const offsets = [0]; // object 0 is free

    const pushBytes = (u8) => {
      chunks.push(u8);
      offset += u8.length;
    };
    const pushStr = (s) => pushBytes(enc.encode(s));

    pushStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

    // Objects layout:
    // 1: Catalog, 2: Pages
    // For page i (0..N-1):
    //   imgObj = 3 + i*3
    //   contentObj = 4 + i*3
    //   pageObj = 5 + i*3
    const pageObjIds = pages.map((_, i) => 5 + i * 3);

    // Obj 1: Catalog
    offsets.push(offset);
    pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    // Obj 2: Pages
    offsets.push(offset);
    pushStr(`2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`);

    const a4W = 595.28;
    const a4H = 841.89;
    const margin = 28.35; // 10mm

    pages.forEach((p, i) => {
      const imgId = 3 + i * 3;
      const contentId = 4 + i * 3;
      const pageId = 5 + i * 3;

      const ratio = p.width / Math.max(1, p.height);
      const a4Ratio = a4W / a4H;
      let drawW, drawH;
      if (ratio > a4Ratio) {
        drawW = a4W - margin * 2;
        drawH = drawW / ratio;
      } else {
        drawH = a4H - margin * 2;
        drawW = drawH * ratio;
      }
      const x = (a4W - drawW) / 2;
      const y = (a4H - drawH) / 2;

      // Image XObject (JPEG /DCTDecode)
      offsets.push(offset);
      pushStr(
        `${imgId} 0 obj\n` +
        `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpegBytes.length} >>\n` +
        `stream\n`
      );
      pushBytes(p.jpegBytes);
      pushStr('\nendstream\nendobj\n');

      // Content stream
      const streamStr = `q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im0 Do\nQ\n`;
      const streamBytes = enc.encode(streamStr);
      offsets.push(offset);
      pushStr(`${contentId} 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`);
      pushBytes(streamBytes);
      pushStr('endstream\nendobj\n');

      // Page object
      offsets.push(offset);
      pushStr(
        `${pageId} 0 obj\n` +
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${a4W.toFixed(2)} ${a4H.toFixed(2)}] ` +
        `/Resources << /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>\n` +
        `endobj\n`
      );
    });

    const xrefOffset = offset;
    pushStr(`xref\n0 ${offsets.length}\n`);
    pushStr('0000000000 65535 f \n');
    for (let i = 1; i < offsets.length; i++) {
      pushStr(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
    }
    pushStr(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

    return new Blob(chunks, { type: 'application/pdf' });
  },

  _dataUrlToBytes(dataURL) {
    const body = dataURL.split(',')[1] || '';
    const bin = atob(body);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  },

  _prepareCanvas(canvas, quality) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    try {
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.fillStyle = '#FFFFFF';
      tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
      tempCtx.drawImage(canvas, 0, 0);
      return tempCanvas.toDataURL('image/jpeg', quality);
    } finally {
      tempCanvas.width = 0;
      tempCanvas.height = 0;
    }
  },

  /**
   * Embed an invisible searchable OCR text layer onto the current jsPDF page
   * so the exported PDF supports Ctrl+F text search and copy-paste.
   */
  _embedSearchableText(pdf, ocrData, x, y, imgW, imgH, canvasW, canvasH) {
    if (!pdf || typeof pdf.text !== 'function' || !ocrData) return;
    try {
      const words = Array.isArray(ocrData.words) ? ocrData.words : [];
      const rawText = (ocrData.text || '').trim();
      if (words.length === 0 && !rawText) return;

      const srcW = Math.max(1, ocrData.width || canvasW || 1);
      const srcH = Math.max(1, ocrData.height || canvasH || 1);

      if (typeof pdf.setTextColor === 'function') {
        pdf.setTextColor(255, 255, 255);
      }

      if (words.length > 0) {
        for (const w of words) {
          if (!w || !w.text || !w.bbox) continue;
          const bx0 = w.bbox.x0 || 0;
          const by0 = w.bbox.y0 || 0;
          const by1 = w.bbox.y1 || (by0 + 16);
          const boxH = Math.max(6, by1 - by0);
          const mmX = x + (bx0 / srcW) * imgW;
          const mmY = y + (by1 / srcH) * imgH;
          const fontPt = Math.max(4, Math.min(36, (boxH / srcH) * imgH * 2.83));
          if (typeof pdf.setFontSize === 'function') pdf.setFontSize(fontPt);
          try {
            pdf.text(String(w.text), mmX, mmY, { renderingMode: 'invisible' });
          } catch (_) {
            pdf.text(String(w.text), mmX, mmY);
          }
        }
      } else if (rawText) {
        const lines = rawText.split(/\r?\n/).filter((l) => l.trim().length > 0);
        const lineStep = imgH / Math.max(12, lines.length + 2);
        if (typeof pdf.setFontSize === 'function') pdf.setFontSize(9);
        lines.forEach((line, idx) => {
          const mmY = y + Math.min(imgH - 2, (idx + 1) * lineStep);
          try {
            pdf.text(line.trim(), x + 2, mmY, { renderingMode: 'invisible' });
          } catch (_) {
            pdf.text(line.trim(), x + 2, mmY);
          }
        });
      }
    } catch (err) {
      console.warn('Searchable PDF text layer warning:', err);
    }
  },

  /** Build PDF as Blob (no auto-download) — used by folder save path. */
  async toPdfBlob(canvases, qualityOverride, opts = {}) {
    const canvasList = Array.isArray(canvases) ? canvases : [canvases];
    const quality = qualityOverride || 0.85;
    const searchable = opts.searchable !== false;
    const ocrPages = Array.isArray(opts.ocrPages) ? opts.ocrPages : [];

    if (canvasList.length === 0) {
      throw new Error('Tidak ada halaman untuk diekspor.');
    }

    let jsPDF = null;
    try {
      jsPDF = await this.ensureJsPdf();
    } catch (err) {
      console.warn('jsPDF unavailable, using built-in offline PDF encoder:', err?.message || err);
    }

    if (!jsPDF) {
      const entries = canvasList.map((canvas) => {
        if (!canvas || canvas.width === 0 || canvas.height === 0) {
          throw new Error('Salah satu halaman tidak valid.');
        }
        const imgData = this._prepareCanvas(canvas, quality);
        return {
          jpegBytes: this._dataUrlToBytes(imgData),
          width: canvas.width,
          height: canvas.height
        };
      });
      return this._buildMinimalPdfBlob(entries);
    }

    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();

    for (let i = 0; i < canvasList.length; i++) {
      const canvas = canvasList[i];
      if (!canvas || canvas.width === 0 || canvas.height === 0) {
        throw new Error('Salah satu halaman tidak valid.');
      }

      const imgData = this._prepareCanvas(canvas, quality);
      const canvasRatio = canvas.width / canvas.height;
      const pdfRatio = pdfWidth / pdfHeight;

      let imgW, imgH;
      if (canvasRatio > pdfRatio) {
        imgW = pdfWidth - 20;
        imgH = imgW / canvasRatio;
      } else {
        imgH = pdfHeight - 20;
        imgW = imgH * canvasRatio;
      }

      const x = (pdfWidth - imgW) / 2;
      const y = (pdfHeight - imgH) / 2;

      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', x, y, imgW, imgH);
      if (searchable && ocrPages[i]) {
        this._embedSearchableText(pdf, ocrPages[i], x, y, imgW, imgH, canvas.width, canvas.height);
      }
    }

    return pdf.output('blob');
  },

  async toPdfBlobFromPages(pageCount, renderPage, qualityOverride, opts = {}) {
    if (!Number.isInteger(pageCount) || pageCount < 1 || typeof renderPage !== 'function') {
      throw new Error('Tidak ada halaman valid untuk diekspor.');
    }

    const quality = qualityOverride ?? 0.85;
    const searchable = opts.searchable !== false;
    const getOcrData = typeof opts.getOcrData === 'function' ? opts.getOcrData : null;

    let jsPDF = null;
    try {
      jsPDF = await this.ensureJsPdf();
    } catch (err) {
      console.warn('jsPDF unavailable, using built-in offline PDF encoder:', err?.message || err);
    }

    if (!jsPDF) {
      const entries = [];
      for (let index = 0; index < pageCount; index++) {
        const canvas = await renderPage(index);
        if (!canvas || canvas.width === 0 || canvas.height === 0) {
          throw new Error(`Halaman ${index + 1} tidak valid.`);
        }
        try {
          const imgData = this._prepareCanvas(canvas, quality);
          entries.push({
            jpegBytes: this._dataUrlToBytes(imgData),
            width: canvas.width,
            height: canvas.height
          });
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
      return this._buildMinimalPdfBlob(entries);
    }

    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();

    for (let index = 0; index < pageCount; index++) {
      const canvas = await renderPage(index);
      if (!canvas || canvas.width === 0 || canvas.height === 0) {
        throw new Error(`Halaman ${index + 1} tidak valid.`);
      }

      try {
        const imgData = this._prepareCanvas(canvas, quality);
        const canvasRatio = canvas.width / canvas.height;
        const pdfRatio = pdfWidth / pdfHeight;
        let imgW, imgH;

        if (canvasRatio > pdfRatio) {
          imgW = pdfWidth - 20;
          imgH = imgW / canvasRatio;
        } else {
          imgH = pdfHeight - 20;
          imgW = imgH * canvasRatio;
        }

        const x = (pdfWidth - imgW) / 2;
        const y = (pdfHeight - imgH) / 2;

        if (index > 0) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', x, y, imgW, imgH);
        if (searchable && getOcrData) {
          const ocrData = getOcrData(index);
          if (ocrData) {
            this._embedSearchableText(pdf, ocrData, x, y, imgW, imgH, canvas.width, canvas.height);
          }
        }
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    }

    return pdf.output('blob');
  },

  /**
   * Build PDF constrained under a target byte budget (e.g., 500 KB / 1 MB / 2 MB)
   * using binary search over JPEG quality and optional resolution downscaling.
   */
  async toPdfBlobWithTargetSize(pageCount, renderPageWithMaxDim, initialQuality, targetBytes, opts = {}) {
    const startQ = initialQuality ?? 0.85;
    let bestBlob = await this.toPdfBlobFromPages(
      pageCount,
      (idx) => renderPageWithMaxDim(idx, config?.IMAGE_MAX_SIZE || 3000),
      startQ,
      opts
    );
    if (!targetBytes || targetBytes <= 0 || bestBlob.size <= targetBytes) {
      return { blob: bestBlob, quality: startQ, matchedTarget: true };
    }

    // Binary search quality between 0.12 and startQ
    let lo = 0.12;
    let hi = startQ;
    let fitBlob = null;
    let fitQ = lo;

    for (let step = 0; step < 4; step++) {
      const mid = Math.round(((lo + hi) / 2) * 100) / 100;
      const candidate = await this.toPdfBlobFromPages(
        pageCount,
        (idx) => renderPageWithMaxDim(idx, config?.IMAGE_MAX_SIZE || 3000),
        mid,
        opts
      );
      if (candidate.size <= targetBytes) {
        fitBlob = candidate;
        fitQ = mid;
        lo = mid;
      } else {
        bestBlob = candidate;
        hi = mid;
      }
    }

    if (fitBlob) {
      return { blob: fitBlob, quality: fitQ, matchedTarget: true };
    }

    // If even lowest quality at full resolution exceeds target, downscale max dimension
    for (const dim of [1400, 1000, 720]) {
      const candidate = await this.toPdfBlobFromPages(
        pageCount,
        (idx) => renderPageWithMaxDim(idx, dim),
        0.55,
        opts
      );
      bestBlob = candidate;
      if (candidate.size <= targetBytes) {
        return { blob: candidate, quality: 0.55, matchedTarget: true };
      }
    }

    return { blob: bestBlob, quality: 0.12, matchedTarget: bestBlob.size <= targetBytes };
  },

  /** Build image as Blob (no auto-download). */
  toImageBlob(canvas, format, qualityOverride) {
    const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
    const quality = format === 'png' ? 1 : (qualityOverride || 0.85);

    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error('Canvas tidak valid untuk ekspor.');
    }

    const src = format === 'png'
      ? canvas.toDataURL(mimeType, quality)
      : this._prepareCanvas(canvas, quality);

    return this.dataURLToBlob(src);
  },

  dataURLToBlob(dataURL) {
    const [header, body] = dataURL.split(',');
    const mime = header.match(/data:(.*?);/)[1];
    const bin = atob(body);
    const len = bin.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  },

  /** Fallback path — browser anchor download (kept for compatibility). */
  async exportToPdf(canvases, qualityOverride) {
    const blob = await this.toPdfBlob(canvases, qualityOverride);
    this._downloadBlob(blob, 'scan_' + Date.now() + '.pdf');
    return true;
  },

  exportToImage(canvas, format, customName, qualityOverride) {
    const blob = this.toImageBlob(canvas, format, qualityOverride);
    this._downloadBlob(blob, customName || ('scan_' + Date.now() + '.' + format));
  },

  _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    // Tunda penghapusan node & revoke URL agar Android PWA/WebView sempat memicu unduhan
    setTimeout(() => {
      if (link.parentNode) link.parentNode.removeChild(link);
    }, 1500);
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
};

window.pdfExport = pdfExport;
