const config = {
  IMAGE_MAX_SIZE: 3000,
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
  }
};
