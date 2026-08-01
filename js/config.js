const config = {
  IMAGE_MAX_SIZE: 2000,
  AUTO_ENHANCE: {
    sharpness: 30,
    contrast: 20
  },
  STORAGE: {
    dbName: 'WebScannerDB',
    storeName: 'scans',
    version: 1
  },
  OCR: {
    timeout: 60000,
    lang: 'ind+eng'
  },
  AI: {
    timeout: 15000,
    workerUrl: 'https://scanner-ai-proxy.ace-suka-main-game.workers.dev'
  },
  CAMERA: {
    metadataTimeout: 5000
  }
};
