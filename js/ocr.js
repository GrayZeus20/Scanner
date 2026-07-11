const ocrEngine = {
  async recognize(canvas) {
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error('Canvas kosong atau tidak valid untuk OCR.');
    }

    try {
      const result = await Promise.race([
        Tesseract.recognize(canvas, 'ind+eng', {
          logger: m => {
            if (m.status === 'recognizing text') {
              // console.log(`OCR Progress: ${m.progress}`);
            }
          }
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Waktu OCR habis. Gambar mungkin terlalu besar atau kompleks.')), 30000))
      ]);
      return result.data.text;
    } catch (error) {
      console.error('OCR Error:', error);
      throw error;
    }
  }
};
