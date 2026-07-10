const ocrEngine = {
  async recognize(canvas) {
    const result = await Tesseract.recognize(canvas, 'ind+eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          // console.log(`OCR Progress: ${m.progress}`);
        }
      }
    });
    return result.data.text;
  }
};
