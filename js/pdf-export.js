const pdfExport = {
  async exportToPdf(canvases) {
    if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
      throw new Error('jsPDF library tidak tersedia. Coba perbarui halaman.');
    }

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();

    const canvasList = Array.isArray(canvases) ? canvases : [canvases];

    if (canvasList.length === 0) {
      throw new Error('Tidak ada halaman untuk diekspor.');
    }

    for (let i = 0; i < canvasList.length; i++) {
      const canvas = canvasList[i];
      if (!canvas || canvas.width === 0 || canvas.height === 0) {
        throw new Error('Salah satu halaman tidak valid.');
      }

      // --- FIX: Ensure white background to prevent PDF color shifts ---
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.fillStyle = '#FFFFFF';
      tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
      tempCtx.drawImage(canvas, 0, 0);
      
      const imgData = tempCanvas.toDataURL('image/jpeg', 0.95);
      
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

    pdf.save('scan_' + Date.now() + '.pdf');
    return true;
  },

  exportToImage(canvas, format) {
    const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
    const quality = format === 'png' ? 1 : 0.92;

    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error('Canvas tidak valid untuk ekspor.');
    }

    let dataURL;
    if (format === 'png') {
        // PNG supports transparency: no background fill needed
        dataURL = canvas.toDataURL(mimeType, quality);
    } else {
        // JPEG doesn't support transparency: add white background
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.fillStyle = '#FFFFFF';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        tempCtx.drawImage(canvas, 0, 0);
        dataURL = tempCanvas.toDataURL(mimeType, quality);
    }

    const link = document.createElement('a');
    link.download = 'scan_' + Date.now() + '.' + format;
    link.href = dataURL;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};
