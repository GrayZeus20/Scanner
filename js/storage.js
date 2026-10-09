const storage = {
  dbName: config.STORAGE.dbName,
  db: null,
  initPromise: null,

  async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, config.STORAGE.version);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;

        if (!db.objectStoreNames.contains('scans')) {
          const store = db.createObjectStore('scans', { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (!db.objectStoreNames.contains('sessions')) {
          const store = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv', { keyPath: 'key' });
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

  // ---------- legacy scans (per-image, read-only after migration) ----------
  async saveScan(canvas, name) {
    if (!canvas) throw new Error('Canvas tidak ditemukan untuk disimpan.');
    await this.init();

    try {
      const imgData = canvas.toDataURL('image/jpeg', 0.85);
      if (!imgData || imgData === 'data:,') throw new Error('Data gambar kosong.');

      return new Promise((resolve, reject) => {
        const tx = this.db.transaction('scans', 'readwrite');
        tx.onabort = () => reject(new Error('Storage transaction aborted'));
        tx.onerror = () => reject(tx.error || new Error('Storage transaction failed'));

        const store = tx.objectStore('scans');
        const scan = { name: name || 'Scan_' + Date.now(), image: imgData, timestamp: Date.now() };
        const request = store.add(scan);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error('Save scan error:', err);
      throw err;
    }
  },

  async getHistory() {
    await this.init();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction('scans', 'readonly');
        const store = tx.objectStore('scans');
        const index = store.index('timestamp');
        const request = index.openCursor(null, 'prev');
        const scans = [];
        request.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) { scans.push(cursor.value); cursor.continue(); }
          else resolve(scans);
        };
        request.onerror = () => reject(request.error);
      } catch (err) { reject(err); }
    });
  },

  async deleteScan(id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('scans', 'readwrite');
      tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
      tx.onerror = () => reject(tx.error || new Error('Storage transaction failed'));
      const store = tx.objectStore('scans');
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  async legacyMigrateToSessions() {
    await this.init();
    return new Promise(async (resolve, reject) => {
      const tx = this.db.transaction(['scans', 'sessions'], 'readwrite');
      const scanStore = tx.objectStore('scans');
      const sessionStore = tx.objectStore('sessions');
      let count = 0;
      scanStore.openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          sessionStore.add({
            name: 'Sesi (' + new Date(cursor.value.timestamp).toLocaleDateString('id-ID') + ')',
            pages: [{ name: cursor.value.name, image: cursor.value.image }],
            createdAt: cursor.value.timestamp,
            updatedAt: cursor.value.timestamp,
            fromLegacy: true
          });
          count++;
          cursor.continue();
        } else {
          console.info('Migrated', count, 'legacy scans into sessions.');
          resolve(count);
        }
      };
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error || new Error('Migration failed'));
    });
  },

  // ---------- sessions ----------
  async saveSession(name, pages) {
    if (!Array.isArray(pages) || pages.length === 0) throw new Error('Sesi harus berisi minimal 1 gambar.');
    await this.init();

    const now = Date.now();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('sessions', 'readwrite');
      tx.onabort = () => reject(new Error('Storage transaction aborted'));
      tx.onerror = () => reject(tx.error || new Error('Storage transaction failed'));

      const store = tx.objectStore('sessions');
      // never set id: undefined — inline keyPath + explicit undefined = DataError
      const session = {
        name: name || 'Sesi ' + new Date().toLocaleString('id-ID'),
        pages,
        createdAt: now,
        updatedAt: now
      };

      const request = store.add(session);
      request.onsuccess = () => resolve({ ...session, id: request.result, _isNew: true });
      request.onerror = () => reject(request.error);
    });
  },

  async updateSession(sessionId, updates) {
    if (!sessionId) return;
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('sessions', 'readwrite');
      tx.onerror = () => reject(tx.error);
      const store = tx.objectStore('sessions');
      const getReq = store.get(sessionId);
      getReq.onsuccess = () => {
        const session = getReq.result;
        if (!session) { reject(new Error('Sesi tidak ditemukan')); return; }
        const now = Date.now();
        session.name = updates.name ?? session.name;
        session.pages = updates.pages ?? session.pages;
        session.updatedAt = now;
        const putReq = store.put(session);
        putReq.onsuccess = () => resolve(putReq.result);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  },

  async deleteSession(sessionId) {
    if (!sessionId) return;
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('sessions', 'readwrite');
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error || new Error('Storage transaction failed'));
      const store = tx.objectStore('sessions');
      const request = store.delete(sessionId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  async getSessions() {
    await this.init();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction('sessions', 'readonly');
        const store = tx.objectStore('sessions');
        const index = store.index('updatedAt');
        const request = index.openCursor(null, 'prev');
        const sessions = [];
        request.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) { sessions.push(cursor.value); cursor.continue(); }
          else resolve(sessions);
        };
        request.onerror = () => reject(request.error);
      } catch (err) { reject(err); }
    });
  },

  async getSession(sessionId) {
    if (!sessionId) return null;
    await this.init();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction('sessions', 'readonly');
        const store = tx.objectStore('sessions');
        const request = store.get(sessionId);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      } catch (err) { reject(err); }
    });
  },

  async setDirHandle(handle) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('kv', 'readwrite');
      const store = tx.objectStore('kv');
      const request = store.put({ key: 'scanner_dir_handle', value: handle });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  async getDirHandle() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('kv', 'readonly');
      const store = tx.objectStore('kv');
      const request = store.get('scanner_dir_handle');
      request.onsuccess = () => resolve(request.result ? request.result.value : null);
      request.onerror = () => reject(request.error);
    });
  },

  async clearDirHandle() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('kv', 'readwrite');
      const store = tx.objectStore('kv');
      const request = store.delete('scanner_dir_handle');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
};
