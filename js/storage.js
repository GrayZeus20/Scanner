const storage = {
  dbName: 'WebScannerDB',
  storeName: 'scans',
  db: null,
  initPromise: null,

  async init() {
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve();
      };

      request.onerror = (e) => reject(e.target.error);
    });

    return this.initPromise;
  },

  async saveScan(canvas, name) {
    await this.init();
    const imgData = canvas.toDataURL('image/jpeg', 0.9);

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
      tx.onerror = () => reject(tx.error || new Error('Storage transaction failed'));

      const store = tx.objectStore(this.storeName);
      const scan = {
        name: name || 'Scan_' + Date.now(),
        image: imgData,
        timestamp: Date.now()
      };

      const request = store.add(scan);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async getHistory() {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readonly');
      tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
      tx.onerror = () => reject(tx.error || new Error('Storage transaction failed'));

      const store = tx.objectStore(this.storeName);
      const index = store.index('timestamp');
      const request = index.openCursor(null, 'prev');
      const scans = [];

      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          scans.push(cursor.value);
          cursor.continue();
        } else {
          resolve(scans);
        }
      };

      request.onerror = () => reject(request.error);
    });
  },

  async deleteScan(id) {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
      tx.onerror = () => reject(tx.error || new Error('Storage transaction failed'));

      const store = tx.objectStore(this.storeName);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
};
