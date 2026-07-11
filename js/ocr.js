const ocrEngine = {
  worker: null,
  _abortFlag: false,

  async getWorker() {
    if (this.worker) return this.worker;
    this.worker = await Tesseract.createWorker('ind+eng', 1, {
      logger: m => {
        if (this._progressCallback && m.status === 'recognizing text') {
          this._progressCallback(m.progress);
        }
      }
    });
    return this.worker;
  },

  abort() {
    this._abortFlag = true;
  },

  async recognize(canvas, progressCallback, abortCheck) {
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error(t('ocrCanvasEmpty'));
    }

    this._abortFlag = false;
    this._progressCallback = progressCallback || (() => {});

    try {
      const worker = await this.getWorker();

      if (this._abortFlag || (abortCheck && abortCheck())) {
        throw new Error(t('ocrCancelled'));
      }

      const result = await Promise.race([
        worker.recognize(canvas),
        new Promise((_, reject) => {
          const checkInterval = setInterval(() => {
            if (this._abortFlag || (abortCheck && abortCheck())) {
              clearInterval(checkInterval);
              reject(new Error(t('ocrCancelled')));
            }
          }, 200);
          setTimeout(() => {
            clearInterval(checkInterval);
            reject(new Error(t('ocrTimedOut')));
          }, 60000);
        })
      ]);

      this._progressCallback = null;
      return result.data.text;
    } catch (error) {
      this._progressCallback = null;
      console.error('OCR Error:', error);
      throw error;
    }
  },

  async terminate() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
};
