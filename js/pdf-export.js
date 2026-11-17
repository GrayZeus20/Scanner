const pdfExport = {
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
    if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
      throw new Error('jsPDF library tidak tersedia. Coba perbarui halaman.');
    }

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();

    const canvasList = Array.isArray(canvases) ? canvases : [canvases];
    const quality = qualityOverride || 0.85;
    const searchable = opts.searchable !== false;
    const ocrPages = Array.isArray(opts.ocrPages) ? opts.ocrPages : [];

    if (canvasList.length === 0) {
      throw new Error('Tidak ada halaman untuk diekspor.');
    }

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
    if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
      throw new Error('jsPDF library tidak tersedia. Coba perbarui halaman.');
    }
    if (!Number.isInteger(pageCount) || pageCount < 1 || typeof renderPage !== 'function') {
      throw new Error('Tidak ada halaman valid untuk diekspor.');
    }

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const quality = qualityOverride ?? 0.85;
    const searchable = opts.searchable !== false;
    const getOcrData = typeof opts.getOcrData === 'function' ? opts.getOcrData : null;

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
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
};

window.pdfExport = pdfExport;
