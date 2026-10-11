const config = {
  IMAGE_MAX_SIZE: 3000,
  MAX_SESSION_PAGES: 30,
  MAX_UNDO_BYTES: 48 * 1024 * 1024,
  INPAINT_MAX_WORK_PIXELS: 1000000,
  AUTO_ENHANCE: {
    sharpness: 30,
    contrast: 20
  },
  STORAGE: {
    dbName: 'WebScannerDB',
    version: 2
  },
  OCR: {
    timeout: 60000,
    lang: 'ind',
    langs: ['ind', 'eng']
  },
  ML: {
    cnnModel: 'mobilenet_v2',
    enableCnn: true,
    localOnly: true
  },
  CAMERA: {
    metadataTimeout: 5000
  },
  DOWNLOAD: {
    dirName: 'Scanner'
  }
};
