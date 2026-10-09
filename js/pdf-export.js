const pdfExport = {
  _prepareCanvas(canvas, quality) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.fillStyle = '#FFFFFF';
    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.drawImage(canvas, 0, 0);
    return tempCanvas.toDataURL('image/jpeg', quality);
  },

  /** Build PDF as Blob (no auto-download) — used by folder save path. */
  async toPdfBlob(canvases, qualityOverride) {
    if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
      throw new Error('jsPDF library tidak tersedia. Coba perbarui halaman.');
    }

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();

    const canvasList = Array.isArray(canvases) ? canvases : [canvases];
    const quality = qualityOverride || 0.85;

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
