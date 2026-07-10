const pdfExport = {
  async exportToPdf(canvases) {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();

    const canvasList = Array.isArray(canvases) ? canvases : [canvases];

    for (let i = 0; i < canvasList.length; i++) {
      const canvas = canvasList[i];
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      
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

    return pdf.save('scan_' + Date.now() + '.pdf');
  },

  exportToImage(canvas, format) {
    const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
    const quality = format === 'png' ? 1 : 0.92;
    const dataURL = canvas.toDataURL(mimeType, quality);

    const link = document.createElement('a');
    link.download = 'scan_' + Date.now() + '.' + format;
    link.href = dataURL;
    link.click();
  }
};
