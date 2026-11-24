window.lucide = window.lucide || { createIcons() {} };
document.querySelector('[data-optional-icons]')?.addEventListener('load', () => {
  window.lucide?.createIcons();
});

const app = {
  state: {
    pages: [],
    currentPageIndex: -1,
    activeSessionId: null,
    dirty: false,
    sessionsCache: [],
    pendingOpenSessionId: null,
    lang: 'id',
    darkMode: false,
    imageLoaded: false,
    filters: {
      brightness: 0,
      contrast: 0,
      saturation: 0,
      sharpness: 0,
      grayscale: false,
      sepia: false,
      invert: false,
      bw: false,
      threshold: 128,
      shadowRemove: false
    },
    autoCropOnImport: false,
    searchablePdf: true,
    sigColor: '#0f172a',
    wmColor: '#475569',
    _sigHasInk: false,
    ocrAborted: false,
    isAnalyzing: false,
    isOcrRunning: false,
    isFilterWorkerRunning: false,
    zoom: 1,
    panX: 0,
    panY: 0,
    isPanning: false,
    lastPinchDist: 0,
    isCropping: false,
    upscaleScale: 2.0,
    upscaleMode: 'auto',
    /* Persisten storage: null = belum dicek, true = granted, false = best-effort */
    storagePersisted: null,
    storagePersistSupported: null,
    /* undo/redo kini per-halaman (page._undoStack / page._redoStack) */
    maxUndoSteps: 30
  },

  canvas: document.getElementById('mainCanvas'),
  ctx: document.getElementById('mainCanvas').getContext('2d', { willReadFrequently: true }),

  // ─── Event registry (state changes only via these) ───
  EVENTS: {
    'session:create': null,   // payload: { name?, pages } — emitter: camera.finish, import batch, saveActiveSession
    'session:open': null,     // payload: { id } — emitter: home card click
    'session:delete': null,   // payload: { id } — emitter: home card delete
    'session:rename': null,   // payload: { id, name } — emitter: home card rename
    'deepscan:run': null,     // payload: { files } — emitter: import / drop
    'export:save': null       // payload: { format } — emitter: download center
  },

  emit(event, payload) {
    const handler = this.EVENTS[event];
    if (!handler) {
      console.warn('[events] unhandled event:', event, payload);
      return;
    }
    return handler(payload);
  },

  dumpState() {
    const dump = {
      activeSessionId: this.state.activeSessionId,
      dirty: this.state.dirty,
      pages: this.state.pages.length,
      currentPageIndex: this.state.currentPageIndex,
      sessionsCount: this.state.sessionsCache.length,
      storagePersisted: this.state.storagePersisted
    };
    console.log('[dumpState]', dump, this.state.sessionsCache);
    return dump;
  },

  setActiveNav(id) {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.remove('active');
      btn.setAttribute('aria-selected', 'false');
    });
    const btn = document.getElementById(id);
    if (btn) {
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
    }
  },

  toggleSheet(id, show) {
    const el = document.getElementById(id);
    if (!el) return;
    if (show) {
      // Hanya satu sheet terbuka pada satu waktu — tutup sheet lain dulu
      // (mencegah dobel backdrop / sheet kedua kehilangan backdrop saat race)
      ['toolsSheet', 'filterSheet', 'ocrSheet', 'exportSheet'].forEach((other) => {
        if (other !== id) {
          const otherEl = document.getElementById(other);
          if (otherEl && !otherEl.classList.contains('hidden')) {
            this._closeSheetNow(otherEl);
          }
        }
      });

      let backdrop = document.getElementById('sheetBackdrop');
      if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.className = 'sheet-backdrop';
        backdrop.id = 'sheetBackdrop';
        document.body.appendChild(backdrop);
      }
      // backdrop selalu milik sheet yang sedang terbuka
      backdrop.onclick = () => this.toggleSheet(id, false);

      el.classList.remove('hidden');
      el.removeAttribute('inert');
      el.setAttribute('aria-hidden', 'false');
      delete el.dataset.ariaExpanded; // role=dialog tidak punya aria-expanded
      window.lucide?.createIcons({ root: el });

      // Focus first interactive element
      const firstFocusable = el.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (firstFocusable) firstFocusable.focus();
    } else {
      // Exit animation
      el.classList.add('sheet-exit');
      const backdrop = document.getElementById('sheetBackdrop');
      if (backdrop) backdrop.classList.add('backdrop-exit');

      setTimeout(() => {
        // Sheet mungkin sudah ditutup paksa oleh sheet lain — jangan
        // tambahkan hidden ke sheet yang justru sedang terbuka
        if (el.classList.contains('sheet-exit')) {
          this._closeSheetNow(el);
        }
        // Hapus backdrop hanya bila tidak ada sheet lain yang sedang memakainya
        const anyOpen = ['toolsSheet', 'filterSheet', 'ocrSheet', 'exportSheet']
          .some((sid) => !document.getElementById(sid)?.classList.contains('hidden'));
        if (!anyOpen) document.getElementById('sheetBackdrop')?.remove();
      }, 200);
    }
  },

  /** Tutup sheet seketika tanpa animasi (cleanup tanpa race timeout). */
  _closeSheetNow(el) {
    el.classList.remove('sheet-exit');
    el.classList.add('hidden');
    el.setAttribute('inert', '');
    el.setAttribute('aria-hidden', 'true');
  },

  escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  },

  init() {
    const savedMode = localStorage.getItem('scanner.darkMode');
    if (savedMode !== null) {
      this.state.darkMode = savedMode === 'true';
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      this.state.darkMode = true;
    }

    this.state.lang = localStorage.getItem('scanner.lang') || detectLanguage();
    setLanguage(this.state.lang);
    document.querySelectorAll('#langMenu [data-lang]').forEach((el) => {
      el.setAttribute('aria-selected', String(el.dataset.lang === this.state.lang));
    });
    this.initEventListeners();
    this.syncDarkModeUI();
    camera.bindCaptureHandler();
    window.lucide?.createIcons();
    this.registerEvents();
    storage.init().then(async () => {
      // One-time migration: legacy per-image scans → sessions
      try {
        const [sessions, legacy] = await Promise.all([storage.getSessions(), storage.getHistory()]);
        if (sessions.length === 0 && legacy.length > 0) {
          await storage.legacyMigrateToSessions();
        }
        const after = await storage.getSessions();
        // Jangan tampilkan home saat kamera sedang aktif (shortcut ?action=camera)
        if (after.length > 0 && document.getElementById('cameraView')?.classList.contains('hidden')) {
          this.showHome();
        }
      } catch (err) {
        console.warn('Migration skipped:', err);
      }
    }).catch(err => {
      console.warn('Storage init failed:', err);
      this.showToast(t('storageError'), 'error');
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              this.showToast(t('newVersion'), 'info');
            }
          });
        });
      }).catch(console.warn);

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        this.showToast(t('newVersion'), 'info');
      });
    }

    // PWA Install prompt and offline/online status
    this.initPwaInstall();

    // PWA shortcut navigation actions — jalankan SETELAH storage.init selesai
    // agar showHome() tidak menutup kamera yang baru terbuka (race saat cold start)
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const action = urlParams.get('action');
      if (action === 'camera') {
        setTimeout(() => this.openCamera(), 350);
      } else if (action === 'import') {
        setTimeout(() => document.getElementById('fileInput')?.click(), 350);
      } else if (action === 'share-target') {
        setTimeout(() => this.consumeSharedFiles(), 250);
      }
    } catch (_) {}

    // Desktop PWA File Handlers (launchQueue)
    this.initFileLaunchQueue();

    // PWA Back button handler & lifecycle cleanup (mencegah tombol Back Android langsung keluar)
    this.initPwaBackHandler();

    // Render ikon otomatis bila script lucide selesai dimuat async belakangan
    const lucideScript = document.querySelector('script[src*="lucide"]');
    if (lucideScript && !window.lucide) {
      lucideScript.addEventListener('load', () => window.lucide?.createIcons(), { once: true });
    }

    // moved from inline <script> (CSP: no unsafe-inline) — same DOMContentLoaded timing
    if (window.MLDetector?.init) window.MLDetector.init();
  },

  /**
   * Mencegah tombol Back hardware/gestur di PWA Android langsung menutup aplikasi.
   * Urutan tutup: Kamera → Crop/Inpaint → Modal → Bottom Sheet → Riwayat → Editor (goHome) → Double-back keluar.
   */
  initPwaBackHandler() {
    if (this._pwaBackBound) return;
    this._pwaBackBound = true;
    this._lastBackPress = 0;

    const pushGuard = () => {
      try {
        window.history.pushState({ pwaGuard: true }, '', window.location.href);
      } catch (_) {}
    };

    // Pasang satu sentinel state di awal agar tombol Back pertama ditangkap popstate
    if (!window.history.state?.pwaGuard) {
      pushGuard();
    }

    window.addEventListener('popstate', () => {
      const handled = this.handleBackNavigation();
      if (handled) {
        pushGuard();
        return;
      }
      // Sudah di beranda tanpa overlay: pola double-back Android (2 detik)
      const now = Date.now();
      if (now - this._lastBackPress > 2000) {
        this._lastBackPress = now;
        this.showToast(t('pressBackAgain') || 'Tekan kembali sekali lagi untuk keluar', 'info');
        pushGuard();
      }
    });

    // Hentikan stream kamera saat PWA masuk background agar tidak freeze/lock saat dibuka lagi
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && typeof camera !== 'undefined' && camera.stream) {
        camera.stop();
        document.getElementById('cameraView')?.classList.add('hidden');
        if (this.state.pages.length > 0) {
          document.getElementById('editorArea')?.classList.remove('hidden');
          document.getElementById('bottomNav')?.classList.remove('hidden');
          document.getElementById('homeBackBtn')?.classList.remove('hidden');
        } else {
          document.getElementById('emptyState')?.classList.remove('hidden');
        }
      }
    });
  },

  handleBackNavigation() {
    // 1. Kamera aktif
    const cameraView = document.getElementById('cameraView');
    if (cameraView && !cameraView.classList.contains('hidden')) {
      camera.stop();
      cameraView.classList.add('hidden');
      if (this.state.pages.length > 0) {
        document.getElementById('editorArea')?.classList.remove('hidden');
        document.getElementById('bottomNav')?.classList.remove('hidden');
        document.getElementById('homeBackBtn')?.classList.remove('hidden');
      } else {
        document.getElementById('emptyState')?.classList.remove('hidden');
      }
      return true;
    }

    // 2. Manual crop / Inpaint aktif
    if (this.state.isCropping) {
      const cropOverlay = document.getElementById('cropOverlay');
      const inpaintOverlay = document.getElementById('inpaintOverlay');
      if (cropOverlay && !cropOverlay.classList.contains('hidden')) {
        this.cancelManualCrop();
        return true;
      }
      if (inpaintOverlay && !inpaintOverlay.classList.contains('hidden')) {
        this.cancelInpaint();
        return true;
      }
    }

    // 3. Modal terbuka
    const modals = [
      ['sessionGuardModal', () => this.closeSessionGuard()],
      ['pdfPreviewModal', () => {
        const m = document.getElementById('pdfPreviewModal');
        m.classList.add('hidden');
        m.setAttribute('inert', '');
        this.releasePdfPreview();
      }],
      ['permissionModal', () => {
        const m = document.getElementById('permissionModal');
        m.classList.add('hidden');
        m.setAttribute('inert', '');
      }],
      ['signatureModal', () => this.closeSignatureModal()]
    ];
    for (const [modalId, close] of modals) {
      const modal = document.getElementById(modalId);
      if (modal && !modal.classList.contains('hidden')) {
        close();
        return true;
      }
    }

    // 4. Bottom sheet terbuka
    const sheets = ['toolsSheet', 'filterSheet', 'ocrSheet', 'exportSheet'];
    for (const sheetId of sheets) {
      const sheet = document.getElementById(sheetId);
      if (sheet && !sheet.classList.contains('hidden')) {
        if (sheetId === 'ocrSheet') {
          this.cancelOcr();
          ocrEngine.terminate();
        }
        this.toggleSheet(sheetId, false);
        return true;
      }
    }

    // 5. Tampilan Riwayat terbuka
    const historyView = document.getElementById('historyView');
    if (historyView && !historyView.classList.contains('hidden')) {
      historyView.classList.add('hidden');
      if (this.state.pages.length > 0) {
        document.getElementById('editorArea')?.classList.remove('hidden');
        document.getElementById('bottomNav')?.classList.remove('hidden');
      } else {
        document.getElementById('emptyState')?.classList.remove('hidden');
        document.getElementById('bottomNav')?.classList.add('hidden');
        document.getElementById('homeBackBtn')?.classList.add('hidden');
      }
      this.setActiveNav(null);
      return true;
    }

    // 6. Sedang di Editor (ada halaman terbuka) -> kembali ke Beranda (dengan guard)
    const editorArea = document.getElementById('editorArea');
    if (editorArea && !editorArea.classList.contains('hidden') && this.state.pages.length > 0) {
      this.goHome();
      return true;
    }

    return false;
  },

  async consumeSharedFiles() {
    if (!('caches' in window)) return;
    try {
      const cache = await caches.open('webscanner-share-target');
      const manifestRes = await cache.match('./__shared_manifest');
      if (!manifestRes) return;
      const meta = await manifestRes.json();
      const files = [];
      for (const item of meta) {
        const res = await cache.match(item.key);
        if (!res) continue;
        const blob = await res.blob();
        files.push(new File([blob], item.name || 'shared_image.jpg', { type: item.type || blob.type || 'image/jpeg' }));
      }
      await caches.delete('webscanner-share-target');
      try {
        window.history.replaceState({}, '', window.location.pathname);
      } catch (_) {}
      if (files.length > 0) {
        await this.emit('deepscan:run', { files });
        this.showToast(t('sharedFilesLoaded', files.length), 'success');
      }
    } catch (err) {
      console.warn('consumeSharedFiles error:', err);
    }
  },

  initFileLaunchQueue() {
    if (!('launchQueue' in window) || typeof window.launchQueue?.setConsumer !== 'function') return;
    try {
      window.launchQueue.setConsumer(async (launchParams) => {
        if (!launchParams?.files?.length) return;
        const files = [];
        for (const handle of launchParams.files) {
          try {
            if (typeof handle.getFile === 'function') {
              files.push(await handle.getFile());
            }
          } catch (err) {
            console.warn('launchQueue file read error:', err);
          }
        }
        if (files.length > 0) {
          await this.emit('deepscan:run', { files });
        }
      });
    } catch (err) {
      console.warn('initFileLaunchQueue error:', err);
    }
  },

  initPwaInstall() {
    let deferredPrompt = null;
    const pwaBtn = document.getElementById('pwaInstallBtn');

    // Check if running as standalone PWA
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;

    if (!isStandalone) {
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        if (pwaBtn) pwaBtn.classList.remove('hidden');
        window.lucide?.createIcons();
      });

      const handleInstall = async () => {
        if (!deferredPrompt) {
          this.showToast('Gunakan menu browser untuk menginstal WebScanner', 'info');
          return;
        }
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          this.showToast(t('installSuccess') || 'Aplikasi berhasil dipasang!', 'info');
        }
        deferredPrompt = null;
        if (pwaBtn) pwaBtn.classList.add('hidden');
      };

      pwaBtn?.addEventListener('click', handleInstall);

      window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        if (pwaBtn) pwaBtn.classList.add('hidden');
        this.showToast(t('installSuccess') || 'Aplikasi berhasil dipasang!', 'info');
      });
    }

    // Network status & slow-network (lie-fi) offline fallback indicator
    const updateNetworkBadge = (announceSlow = false) => {
      const badge = document.getElementById('offlineBadge');
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      const isSlow = !!(conn && (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g' || conn.saveData));
      const isOfflineMode = !navigator.onLine || isSlow;
      if (badge) badge.classList.toggle('hidden', !isOfflineMode);
      if (announceSlow && navigator.onLine && isSlow) {
        this.showToast(t('slowNetworkOffline') || 'Jaringan lemah — berjalan dalam mode offline', 'info');
      }
    };

    window.addEventListener('offline', () => {
      this.showToast(t('offlineActive') || 'Mode offline aktif', 'warning');
      updateNetworkBadge(false);
    });
    window.addEventListener('online', () => {
      this.showToast(t('onlineActive') || 'Kembali online', 'info');
      updateNetworkBadge(false);
    });
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && typeof conn.addEventListener === 'function') {
      conn.addEventListener('change', () => updateNetworkBadge(true));
    }
    updateNetworkBadge(false);

    // Persisten storage: minta browser untuk TIDAK menghapus IndexedDB + cache SW
    // saat storage pressure. Best-effort — Chrome bisa menolak tanpa user gesture,
    // jadi hasilnya dicatat di state (bukan dianggap sukses).
    this.requestPersistentStorage();
  },

  /**
   * Minta `navigator.storage.persist()`. Idempoten: kalau sudah granted,
   * tidak memanggil ulang. Tidak pernah throw ke caller.
   * State: storagePersisted (null|true|false), storagePersistSupported (null|true|false)
   */
  async requestPersistentStorage() {
    const supported = !!(navigator.storage && typeof navigator.storage.persist === 'function');
    this.state.storagePersistSupported = supported;
    if (!supported) {
      this.state.storagePersisted = false;
      return false;
    }
    try {
      const already = typeof navigator.storage.persisted === 'function'
        ? await navigator.storage.persisted()
        : false;
      if (already) {
        this.state.storagePersisted = true;
        return true;
      }
      const granted = await navigator.storage.persist();
      this.state.storagePersisted = !!granted;
      if (!granted) {
        // Bukan error: browser memutuskan best-effort. Data tetap ditulis,
        // hanya bisa dibersihkan otomatis di bawah storage pressure.
        console.info('[storage] persistent storage not granted — running best-effort');
      }
      return !!granted;
    } catch (err) {
      // Private mode / kebijakan browser: jangan sampai blok init app.
      console.warn('[storage] persist() failed:', err);
      this.state.storagePersisted = false;
      return false;
    }
  },

  registerEvents() {
    this.EVENTS['session:create'] = async ({ name, pages } = {}) => {
      const src = pages || this.state.pages;
      if (!src.length) return null;
      const sessionPages = src.map((p, i) => ({
        name: p.name || `page_${i + 1}.jpg`,
        image: p.originalImage?.src || p.image || p.pendingSrc || '',
        w: p.w || p.originalImage?.naturalWidth || 0,
        h: p.h || p.originalImage?.naturalHeight || 0
      }));
      if (sessionPages.length > config.MAX_SESSION_PAGES) { this.showToast(t('sessionFull'), 'error'); return null; }
      try {
        let saved;
        if (this.state.activeSessionId) {
          saved = await storage.updateSession(this.state.activeSessionId, { pages: sessionPages });
        } else {
          saved = await storage.saveSession(name, sessionPages);
          this.state.activeSessionId = saved.id;
        }
        this.state.dirty = false;
        this.emit('session:refresh');
        return saved;
      } catch (err) {
        console.error('session:create failed:', err);
        if (err?.name === 'QuotaExceededError') this.showToast(t('storageFull'), 'error');
        else this.showToast(t('error'), 'error');
        return null;
      }
    };

    this.EVENTS['session:open'] = ({ id } = {}) => this.openSession(id);

    this.EVENTS['session:delete'] = async ({ id } = {}) => {
      if (!id) return;
      await storage.deleteSession(id);
      if (this.state.activeSessionId === id) this.state.activeSessionId = null;
      this.emit('session:refresh');
    };

    this.EVENTS['session:rename'] = async ({ id, name } = {}) => {
      if (!id || !name) return;
      await storage.updateSession(id, { name });
      this.emit('session:refresh');
    };

    this.EVENTS['session:refresh'] = () => this.refreshHome();

    this.EVENTS['deepscan:run'] = async ({ files } = {}) => this.importBatch(files);

    this.EVENTS['export:save'] = ({ format } = {}) => this.performExport(format);
  },

  initEventListeners() {
    // Escape key to close sheets
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        // Close crop overlay first
        if (this.state.isCropping) {
          const cropOverlay = document.getElementById('cropOverlay');
          const inpaintOverlay = document.getElementById('inpaintOverlay');
          if (cropOverlay && !cropOverlay.classList.contains('hidden')) {
            this.cancelManualCrop();
            return;
          }
          if (inpaintOverlay && !inpaintOverlay.classList.contains('hidden')) {
            this.cancelInpaint();
            return;
          }
        }
        const sheets = ['toolsSheet', 'filterSheet', 'ocrSheet', 'exportSheet'];
        for (const sheetId of sheets) {
          const sheet = document.getElementById(sheetId);
          if (sheet && !sheet.classList.contains('hidden')) {
            this.toggleSheet(sheetId, false);
            break;
          }
        }
        // Modal dialog (guard / PDF preview / permission) juga harus bisa
        // ditutup dengan Escape — sebelumnya keyboard user terjebak
        const modals = [
          ['sessionGuardModal', () => this.closeSessionGuard()],
          ['pdfPreviewModal', () => {
            const m = document.getElementById('pdfPreviewModal');
            m.classList.add('hidden');
            m.setAttribute('inert', '');
            this.releasePdfPreview();
          }],
          ['permissionModal', () => {
            const m = document.getElementById('permissionModal');
            m.classList.add('hidden');
            m.setAttribute('inert', '');
          }],
          ['signatureModal', () => this.closeSignatureModal()]
        ];
        for (const [modalId, close] of modals) {
          const modal = document.getElementById(modalId);
          if (modal && !modal.classList.contains('hidden')) {
            close();
            break;
          }
        }
        return;
      }

      // Abaikan shortcut keyboard saat fokus di dalam input/textarea/select/contentEditable
      const target = e.target;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) {
        return;
      }

      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && !e.shiftKey && key === 'z') {
        e.preventDefault();
        this.undo();
        return;
      }
      if (mod && (key === 'y' || (e.shiftKey && key === 'z'))) {
        e.preventDefault();
        this.redo();
        return;
      }
      if (mod && key === 's') {
        if (this.state.pages.length > 0) {
          e.preventDefault();
          this.renderDlPreviewStrip();
          this.updateFolderStatus();
          this.toggleSheet('exportSheet', true);
          if (window.lucide) window.lucide?.createIcons();
        }
        return;
      }

      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !this.state.isCropping && this.state.pages.length > 1) {
        const hasOpenOverlay = ['toolsSheet', 'filterSheet', 'ocrSheet', 'exportSheet', 'sessionGuardModal', 'pdfPreviewModal', 'permissionModal', 'signatureModal']
          .some((id) => {
            const el = document.getElementById(id);
            return el && !el.classList.contains('hidden');
          });
        if (!hasOpenOverlay) {
          e.preventDefault();
          this.goToPage(this.state.currentPageIndex + (e.key === 'ArrowRight' ? 1 : -1));
        }
      }
    });

    // Lang picker: button shows compact "ID/ENG", menu shows full labels
    const langBtn = document.getElementById('langSwitcher');
    const langMenu = document.getElementById('langMenu');
    const syncLangOptions = () => {
      langMenu.querySelectorAll('[data-lang]').forEach((el) => {
        el.setAttribute('aria-selected', String(el.dataset.lang === this.state.lang));
      });
    };
    const closeLangMenu = () => {
      langMenu.classList.add('hidden');
      langBtn.setAttribute('aria-expanded', 'false');
    };
    langBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nowHidden = langMenu.classList.toggle('hidden');
      langBtn.setAttribute('aria-expanded', String(!nowHidden));
      if (!nowHidden) syncLangOptions();
    });
    langMenu.addEventListener('click', (e) => {
      const opt = e.target.closest('[data-lang]');
      if (!opt) return;
      this.state.lang = opt.dataset.lang;
      localStorage.setItem('scanner.lang', this.state.lang);
      setLanguage(this.state.lang);
      syncLangOptions();
      closeLangMenu();
    });
    document.addEventListener('click', (e) => {
      if (!langMenu.classList.contains('hidden') && !e.target.closest('.lang-picker')) {
        closeLangMenu();
      }
    });

    document.getElementById('darkToggle').addEventListener('click', () => {
      this.state.darkMode = !this.state.darkMode;
      localStorage.setItem('scanner.darkMode', String(this.state.darkMode));
      this.syncDarkModeUI();
    });

    document.getElementById('navCamera').addEventListener('click', () => this.openCamera());
    document.getElementById('emptyCamera').addEventListener('click', () => this.openCamera());

    document.getElementById('navImport').addEventListener('click', () => {
      camera.stop();
      document.getElementById('fileInput').click();
    });
    document.getElementById('emptyImport').addEventListener('click', () => {
      camera.stop();
      document.getElementById('fileInput').click();
    });

    document.getElementById('fileInput').addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.emit('deepscan:run', { files: Array.from(e.target.files) });
        e.target.value = '';
      }
    });

    // Drag and drop support
    const mainEl = document.getElementById('main');
    const preventDefaults = (e) => { e.preventDefault(); e.stopPropagation(); };

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      mainEl.addEventListener(eventName, preventDefaults, false);
      document.body.addEventListener(eventName, preventDefaults, false);
    });

    mainEl.addEventListener('dragenter', () => mainEl.classList.add('drag-over'));
    mainEl.addEventListener('dragover', () => mainEl.classList.add('drag-over'));
    mainEl.addEventListener('dragleave', (e) => {
      if (!mainEl.contains(e.relatedTarget)) {
        mainEl.classList.remove('drag-over');
      }
    });

    mainEl.addEventListener('drop', (e) => {
      mainEl.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        this.emit('deepscan:run', { files: Array.from(files) });
      }
    });

    document.getElementById('navHistory').addEventListener('click', () => {
      this.setActiveNav('navHistory');
      camera.stop();
      this.showHistory();
    });

    // Home surface: open riwayat directly (nav hidden on home)
    document.getElementById('homeHistoryBtn').addEventListener('click', () => {
      camera.stop();
      this.showHistory();
    });
    // Back to home from edit / riwayat (guarded when unsaved work)
    document.getElementById('homeBackBtn').addEventListener('click', () => this.goHome());
    document.getElementById('closeHistory').addEventListener('click', () => {
      camera.stop();
      document.getElementById('historyView').classList.add('hidden');
      if (this.state.pages.length > 0) {
        document.getElementById('editorArea')?.classList.remove('hidden');
        document.getElementById('bottomNav')?.classList.remove('hidden');
      } else {
        document.getElementById('emptyState')?.classList.remove('hidden');
        document.getElementById('bottomNav')?.classList.add('hidden');
      }
      this.setActiveNav(null);
    });
    document.getElementById('newSessionBtn')?.addEventListener('click', () => {
      if (this.state.pages.length > 0 && this.state.dirty) {
        this.showSessionGuard(this.state.pages.length, { mode: 'new' });
      } else {
        this.startNewSession();
      }
    });
    this.bindSessionGuard();

    document.getElementById('navTools').addEventListener('click', () => {
      this.toggleSheet('toolsSheet', true);
      window.lucide?.createIcons();
    });
    document.getElementById('closeToolsSheet').addEventListener('click', () => this.toggleSheet('toolsSheet', false));

    document.getElementById('toolCropBtn').addEventListener('click', async () => {
      this.toggleSheet('toolsSheet', false);
      await this.autoCrop();
    });

    document.getElementById('toolManualCropBtn').addEventListener('click', () => {
      this.startManualCrop();
      this.toggleSheet('toolsSheet', false);
    });
    document.getElementById('confirmCropBtn').addEventListener('click', () => this.confirmManualCrop());
    document.getElementById('cancelCropBtn').addEventListener('click', () => this.cancelManualCrop());

    // Crop preset ratio buttons
    document.querySelectorAll('.crop-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.crop-preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        manualCrop.setRatio(btn.dataset.ratio);
      });
    });

    document.getElementById('toolFilterBtn').addEventListener('click', () => {
      this.toggleSheet('filterSheet', true);
      this.toggleSheet('toolsSheet', false);
      window.lucide?.createIcons();
    });
    document.getElementById('toolOcrBtn').addEventListener('click', () => {
      this.startOcr();
      this.toggleSheet('toolsSheet', false);
    });
    document.getElementById('toolInpaintBtn').addEventListener('click', () => {
      this.startInpaint();
      this.toggleSheet('toolsSheet', false);
    });
    document.getElementById('toolBatchCropBtn')?.addEventListener('click', async () => {
      this.toggleSheet('toolsSheet', false);
      await this.batchAutoCropAllPages();
    });
    document.getElementById('autoCropOnImportToggle')?.addEventListener('change', (e) => {
      this.state.autoCropOnImport = !!e.target.checked;
    });
    document.getElementById('toolShadowRemoveBtn')?.addEventListener('click', async () => {
      this.toggleSheet('toolsSheet', false);
      await this.removeDocumentShadows();
    });
    document.getElementById('toolSignatureBtn')?.addEventListener('click', () => {
      this.toggleSheet('toolsSheet', false);
      this.openSignatureModal();
    });
    document.getElementById('toolHdEnhanceBtn')?.addEventListener('click', () => {
      this.enhanceHd(this.state.upscaleScale || 2.0);
      this.toggleSheet('toolsSheet', false);
    });
    document.querySelectorAll('#upscaleModesRow .mode-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('#upscaleModesRow .mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const m = btn.dataset.mode || 'auto';
        this.state.upscaleMode = m;
      });
    });
    document.querySelectorAll('#upscaleScalesRow .scale-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('#upscaleScalesRow .scale-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const s = parseFloat(btn.dataset.scale) || 2.0;
        this.state.upscaleScale = s;
        const hdBtnStrong = document.querySelector('#toolHdEnhanceBtn strong');
        if (hdBtnStrong) {
          hdBtnStrong.textContent = `Upscale ${s}x HD (ML)`;
        }
      });
    });
    document.getElementById('toolThemeBtn')?.addEventListener('click', () => {
      this.state.darkMode = !this.state.darkMode;
      localStorage.setItem('scanner.darkMode', String(this.state.darkMode));
      this.syncDarkModeUI();
      this.toggleSheet('toolsSheet', false);
    });
    document.getElementById('confirmInpaintBtn').addEventListener('click', () => this.confirmInpaint());
    document.getElementById('cancelInpaintBtn').addEventListener('click', () => this.cancelInpaint());

    document.getElementById('closeFilterSheet').addEventListener('click', () => this.toggleSheet('filterSheet', false));
    document.getElementById('closeOcrSheet').addEventListener('click', () => {
      this.cancelOcr();
      this.toggleSheet('ocrSheet', false);
      ocrEngine.terminate();
    });
    document.getElementById('cancelOcrBtn')?.addEventListener('click', () => {
      this.cancelOcr();
    });
    document.getElementById('retryOcrBtn')?.addEventListener('click', () => {
      this.startOcr();
    });
    document.getElementById('ocrLangSelect')?.addEventListener('change', () => {
      this.startOcr();
    });

    document.getElementById('navExport').addEventListener('click', () => {
      this.renderDlPreviewStrip();
      this.updateFolderStatus();
      this.toggleSheet('exportSheet', true);
      window.lucide?.createIcons();
    });
    document.getElementById('closeExportSheet').addEventListener('click', () => this.toggleSheet('exportSheet', false));
    document.getElementById('shareBtn').addEventListener('click', () => this.shareDoc());
    if (!navigator.share) {
      document.getElementById('shareBtn').classList.add('hidden');
    }

    document.getElementById('copyOcrBtn').addEventListener('click', () => {
      const text = document.getElementById('ocrResult').innerText;
      navigator.clipboard.writeText(text)
        .then(() => this.showToast(t('saved')))
        .catch(() => {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          document.body.appendChild(textarea);
          textarea.select();
          try {
            document.execCommand('copy');
            this.showToast(t('saved'));
          } catch (err) {
            this.showToast(t('error'));
          }
          document.body.removeChild(textarea);
        });
    });

    document.getElementById('aiAnalyzeBtn').addEventListener('click', () => this.runAiAnalysis());

    document.getElementById('undoBtn').addEventListener('click', () => this.undo());
    document.getElementById('redoBtn').addEventListener('click', () => this.redo());

    document.getElementById('ocrResult')?.addEventListener('input', () => {
      const page = this.state.pages[this.state.currentPageIndex];
      const txt = document.getElementById('ocrResult')?.innerText?.trim() || '';
      if (page && txt) page.ocrText = txt;
    });

    this.initFilterControls();
    this.initExportButtons();
    this.initZoomControls();
    this.initSignatureControls();
    this.initSheetSwipeClose();
  },

  goToPage(index) {
    if (!this.state.pages.length) return;
    const clamped = Math.max(0, Math.min(index, this.state.pages.length - 1));
    if (clamped === this.state.currentPageIndex) return;
    const page = this.state.pages[clamped];
    this.state.currentPageIndex = clamped;
    if (page?.pendingSrc) this.renderPendingPage(clamped);
    else this.renderPage(clamped);
    this.updatePagesTray();
  },

  initSheetSwipeClose() {
    const sheets = ['toolsSheet', 'filterSheet', 'ocrSheet', 'exportSheet'];
    sheets.forEach((sheetId) => {
      const sheet = document.getElementById(sheetId);
      const header = sheet?.querySelector('.sheet-header');
      if (!sheet || !header) return;
      let startY = 0;
      let deltaY = 0;
      let dragging = false;

      header.addEventListener('touchstart', (e) => {
        if (window.innerWidth > 768 || e.touches.length !== 1) return;
        if (e.target.closest('button')) return;
        dragging = true;
        startY = e.touches[0].clientY;
        deltaY = 0;
        sheet.style.transition = 'none';
      }, { passive: true });

      header.addEventListener('touchmove', (e) => {
        if (!dragging || e.touches.length !== 1) return;
        deltaY = Math.max(0, e.touches[0].clientY - startY);
        if (deltaY > 0) {
          sheet.style.transform = `translateY(${deltaY}px)`;
        }
      }, { passive: true });

      const endDrag = () => {
        if (!dragging) return;
        dragging = false;
        sheet.style.transition = '';
        sheet.style.transform = '';
        if (deltaY > 55) {
          if (sheetId === 'ocrSheet') {
            this.cancelOcr();
            ocrEngine.terminate();
          }
          this.toggleSheet(sheetId, false);
        }
      };

      header.addEventListener('touchend', endDrag, { passive: true });
      header.addEventListener('touchcancel', endDrag, { passive: true });
    });
  },

  renderDlPreviewStrip() {
    const strip = document.getElementById('dlPreviewStrip');
    if (!strip) return;
    strip.innerHTML = '';
    this.state.pages.forEach((page, idx) => {
      const src = page.originalImage?.src || page.pendingSrc || '';
      const div = document.createElement('div');
      div.className = 'dl-thumb' + (idx === this.state.currentPageIndex ? ' active' : '');
      div.innerHTML = `<img src="${src}" alt="${this.escapeHtml(page.name || 'page ' + (idx + 1))}"><span>${idx + 1}</span>`;
      div.onclick = () => { this.goToPage(idx); this.renderDlPreviewStrip(); };
      strip.appendChild(div);
    });
  },

  initZoomControls() {
    const canvas = document.getElementById('mainCanvas');
    const wrapper = document.getElementById('canvasWrapper');

    const isInteractive = (e) => {
      const t = e.target;
      return t.closest('button') || t.closest('.nav-btn') || t.closest('.zoom-btn') || 
             t.closest('.camera-action-btn') || t.closest('.filter-action-btn') || 
             t.closest('.export-btn') || t.closest('.tool-action-btn') || 
             t.closest('.crop-action-btn') || t.closest('.crop-handle') || 
             t.closest('.toggle') || t.closest('select') || t.closest('input') ||
             t.closest('.flash-btn') || t.closest('.inpaint-toolbar') ||
             t.closest('#maskCanvas');
    };

    // --- Inertia state ---
    let velX = 0, velY = 0, inertiaId = null;

    const stopInertia = () => {
      if (inertiaId) { cancelAnimationFrame(inertiaId); inertiaId = null; }
    };

    const startInertia = () => {
      stopInertia();
      const step = () => {
        velX *= 0.92; velY *= 0.92;
        if (Math.abs(velX) < 0.5 && Math.abs(velY) < 0.5) return;
        this.state.panX += velX;
        this.state.panY += velY;
        this.updatePan();
        inertiaId = requestAnimationFrame(step);
      };
      inertiaId = requestAnimationFrame(step);
    };

    // Track velocity for inertia
    let lastMoveX = 0, lastMoveY = 0, lastMoveTime = 0;

    // --- Mouse wheel zoom (pinch-friendly) ---
    wrapper.addEventListener('wheel', (e) => {
      if (isInteractive(e)) return;
      if (this.state.isCropping) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      this.setZoom(this.state.zoom * factor, e.clientX, e.clientY);
    }, { passive: false });

    // --- Touch events with inertia & horizontal page swipe ---
    let lastDist = 0;
    let swipeStartX = 0, swipeStartY = 0, swipeStartTime = 0, swipeEligible = false;

    wrapper.addEventListener('touchstart', (e) => {
      if (isInteractive(e)) return;
      if (this.state.isCropping) return;
      stopInertia();
      if (e.touches.length === 2) {
        lastDist = this.getTouchDistance(e.touches);
        this.state.isPanning = false; // gestur pinch dimulai — batalkan pan
        swipeEligible = false;
      } else if (e.touches.length === 1) {
        this.state.isPanning = true;
        this.state.panStartX = e.touches[0].clientX - this.state.panX;
        this.state.panStartY = e.touches[0].clientY - this.state.panY;
        lastMoveX = e.touches[0].clientX;
        lastMoveY = e.touches[0].clientY;
        lastMoveTime = performance.now();
        swipeStartX = e.touches[0].clientX;
        swipeStartY = e.touches[0].clientY;
        swipeStartTime = lastMoveTime;
        swipeEligible = this.state.zoom <= 1.05 && this.state.pages.length > 1;
      }
    }, { passive: true });

    wrapper.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        if (this.state.isCropping) return;
        e.preventDefault();
        const dist = this.getTouchDistance(e.touches);
        // lastDist bisa 0 kalau touchstart tadi early-return (gestur mulai
        // di atas kontrol) — hindari div-by-zero yang melonjakkan zoom ke 500%
        if (!lastDist || dist <= 0) { lastDist = dist || 1; return; }
        const mid = this.getTouchMidpoint(e.touches);
        this.setZoom(this.state.zoom * (dist / lastDist), mid.x, mid.y);
        lastDist = dist;
      } else if (e.touches.length === 1 && this.state.isPanning) {
        if (this.state.isCropping) return;
        e.preventDefault();
        const cx = e.touches[0].clientX;
        const cy = e.touches[0].clientY;
        this.state.panX = cx - this.state.panStartX;
        this.state.panY = cy - this.state.panStartY;
        velX = cx - lastMoveX;
        velY = cy - lastMoveY;
        lastMoveX = cx;
        lastMoveY = cy;
        lastMoveTime = performance.now();
        this.updatePan();
      }
    }, { passive: false });

    wrapper.addEventListener('touchend', (e) => {
      if (e.touches.length === 0 && this.state.isPanning) {
        this.state.isPanning = false;
        if (swipeEligible && this.state.zoom <= 1.05 && this.state.pages.length > 1 && !this.state.isCropping) {
          const touch = e.changedTouches?.[0];
          const dx = (touch ? touch.clientX : lastMoveX) - swipeStartX;
          const dy = (touch ? touch.clientY : lastMoveY) - swipeStartY;
          const dt = performance.now() - swipeStartTime;
          swipeEligible = false;
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 450) {
            const nextIdx = this.state.currentPageIndex + (dx < 0 ? 1 : -1);
            if (nextIdx >= 0 && nextIdx < this.state.pages.length) {
              this.goToPage(nextIdx);
              return;
            }
          }
        }
        swipeEligible = false;
        if (Math.abs(velX) > 1 || Math.abs(velY) > 1) startInertia();
      }
    });

    wrapper.addEventListener('touchcancel', () => {
      this.state.isPanning = false;
    });

    // --- Mouse drag with inertia ---
    wrapper.addEventListener('mousedown', (e) => {
      if (isInteractive(e)) return;
      if (this.state.isCropping) return;
      stopInertia();
      this.state.isPanning = true;
      this.state.panStartX = e.clientX - this.state.panX;
      this.state.panStartY = e.clientY - this.state.panY;
      lastMoveX = e.clientX;
      lastMoveY = e.clientY;
      lastMoveTime = performance.now();
      velX = 0; velY = 0;
      wrapper.style.cursor = 'grabbing';
    });

    wrapper.addEventListener('mousemove', (e) => {
      if (!this.state.isPanning) return;
      const cx = e.clientX, cy = e.clientY;
      this.state.panX = cx - this.state.panStartX;
      this.state.panY = cy - this.state.panStartY;
      velX = cx - lastMoveX;
      velY = cy - lastMoveY;
      lastMoveX = cx;
      lastMoveY = cy;
      lastMoveTime = performance.now();
      this.updatePan();
    });

    wrapper.addEventListener('mouseup', () => {
      if (!this.state.isPanning) return;
      this.state.isPanning = false;
      wrapper.style.cursor = 'grab';
      if (Math.abs(velX) > 1 || Math.abs(velY) > 1) startInertia();
    });

    wrapper.addEventListener('mouseleave', () => {
      if (!this.state.isPanning) return;
      this.state.isPanning = false;
      wrapper.style.cursor = 'grab';
    });

    // --- Zoom buttons ---
    document.getElementById('zoomInBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.setZoom(this.state.zoom + 0.2);
    });
    document.getElementById('zoomOutBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.setZoom(this.state.zoom - 0.2);
    });
    document.getElementById('zoomResetBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.resetZoom();
      this.showToast(t('resetPosition'));
    });
  },

  setZoom(newZoom, centerX, centerY) {
    const canvas = document.getElementById('mainCanvas');
    const wrapper = document.getElementById('canvasWrapper');
    const oldZoom = this.state.zoom;
    
    this.state.zoom = Math.max(0.3, Math.min(newZoom, 5));
    if (this.state.zoom === 1) {
      this.state.panX = 0;
      this.state.panY = 0;
    }
    
    // Adjust pan to zoom toward center
    if (centerX !== undefined && centerY !== undefined) {
      const rect = wrapper.getBoundingClientRect();
      const x = centerX - rect.left - rect.width / 2;
      const y = centerY - rect.top - rect.height / 2;
      this.state.panX = x - (x - this.state.panX) * (this.state.zoom / oldZoom);
      this.state.panY = y - (y - this.state.panY) * (this.state.zoom / oldZoom);
    }
    
    this.updatePan();
    // Tanpa toast per-frame: spam pada tiap wheel tick / pinch frame
  },

  resetZoom() {
    this.state.zoom = 1;
    this.state.panX = 0;
    this.state.panY = 0;
    this.updatePan();
  },

  updatePan() {
    const canvas = document.getElementById('mainCanvas');
    // Allow panning even at zoom 1 for a more natural feel
    const limit = (val, max) => Math.max(-max, Math.min(max, val));
    // Provide a reasonable panning area, e.g. 50% of the image size beyond edges
    const maxPanX = (this.canvas.width * this.state.zoom) / 2;
    const maxPanY = (this.canvas.height * this.state.zoom) / 2;
    
    this.state.panX = limit(this.state.panX, maxPanX);
    this.state.panY = limit(this.state.panY, maxPanY);

    canvas.style.transform = `scale(${this.state.zoom}) translate(${this.state.panX / this.state.zoom}px, ${this.state.panY / this.state.zoom}px)`;
  },

  getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  },

  getTouchMidpoint(touches) {
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2
    };
  },

  showEditor() {
    document.getElementById('historyView')?.classList.add('hidden');
    document.getElementById('editorArea')?.classList.remove('hidden');
    document.getElementById('bottomNav')?.classList.remove('hidden');
    document.getElementById('emptyState')?.classList.add('hidden');
    document.getElementById('homeBackBtn')?.classList.remove('hidden');
    this.setActiveNav(null);
  },

  syncDarkModeUI() {
    const darkToggle = document.getElementById('darkToggle');
    if (darkToggle) {
      darkToggle.innerHTML = `<i data-lucide="${this.state.darkMode ? 'sun' : 'moon'}" aria-hidden="true"></i>`;
      darkToggle.setAttribute('aria-label', this.state.darkMode ? t('switchToLight') : t('switchToDark'));
    }
    const toolThemeBtn = document.getElementById('toolThemeBtn');
    if (toolThemeBtn) {
      const icon = toolThemeBtn.querySelector('i, svg');
      if (icon) {
        toolThemeBtn.innerHTML = `
          <i data-lucide="${this.state.darkMode ? 'sun' : 'moon'}" aria-hidden="true"></i>
          <div>
            <strong>${this.state.darkMode ? (t('switchToLight') || 'Mode Terang') : (t('switchToDark') || 'Mode Gelap')}</strong>
            <small>${t('themeToggleDesc') || 'Beralih tampilan antara mode gelap dan terang'}</small>
          </div>
        `;
      }
    }
    document.documentElement.classList.toggle('dark-mode', this.state.darkMode);
    document.body.classList.toggle('dark-mode', this.state.darkMode);
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute('content', this.state.darkMode ? '#090B10' : '#2563EB');
    }
    window.lucide?.createIcons();
  },

  setCurrentPageImage(image) {
    const page = this.state.pages[this.state.currentPageIndex];
    if (!page) return;
    page.originalImage = image;
    page.currentImageData = null;
    this.updatePagesTray();
  },

  openCamera() {
    camera.stop();
    document.getElementById('historyView')?.classList.add('hidden');
    document.getElementById('homeBackBtn')?.classList.add('hidden');
    camera.start();
  },

  /**
   * DeepScan batch import: validate → detect → load pages → one new session.
   */
  async importBatch(files) {
    if (!files || files.length === 0) return;
    const supported = files.filter((file) =>
      deepscan.isPdfFile(file) ||
      deepscan.ACCEPTED_TYPES.includes(file.type) ||
      deepscan.ACCEPTED_EXTENSIONS.some((ext) => (file.name || '').toLowerCase().endsWith(ext))
    );
    const unsupported = files.length - supported.length;

    if (supported.length === 0) {
      this.showToast(files[0]?.type === 'application/pdf' ? t('pdfNotSupported') : t('unsupportedFile'), 'error');
      return;
    }

    const capacity = Math.max(0, config.MAX_SESSION_PAGES - this.state.pages.length);
    if (capacity === 0) {
      this.showToast(t('sessionFull'), 'error');
      return;
    }
    const batch = supported.slice(0, capacity);
    const rejected = unsupported + supported.length - batch.length;

    this.showToast(t('processing'));

    // lock undo/redo while importing (no history actions mid-batch)
    this._importing = true;
    this.syncUndoRedoLock();
    try {
      const { pages, errors } = await deepscan.batchImport(batch, {
        autoCrop: !!this.state.autoCropOnImport,
        createSession: false
      });

      // If editor already has an open unsaved doc, guard before appending new pages
      if (this.state.pages.length > 0 && this.state.dirty) {
        this._pendingBatch = pages;
        // Deskripsi modal = jumlah gambar yang SEDANG TERBUKA, bukan ukuran batch
        this.showSessionGuard(this.state.pages.length, { mode: 'import' });
        return;
      }

      this._applyBatch(pages, errors, rejected);
    } catch (err) {
      console.error('Import failed:', err);
      this.showToast(t('error') + ': ' + err.message, 'error');
    } finally {
      this._importing = false;
      this.syncUndoRedoLock();
    }
  },

  syncUndoRedoLock() {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    if (this._importing) {
      if (undoBtn) undoBtn.disabled = true;
      if (redoBtn) redoBtn.disabled = true;
    } else {
      this.updateUndoRedoUI();
    }
  },

  _applyBatch(pages, errors, rejected = 0) {
    if (pages.length === 0) {
      this.showToast(errors[0]?.error || t('unsupportedFile'), 'error');
      return;
    }

    // Append: batch adds pages into current working doc (1 sesi = semua gambar kerja)
    const startIdx = this.state.pages.length;
    pages.forEach((p, idx) => {
      this.state.pages.push({
        originalImage: null,
        currentImageData: null,
        name: p.name,
        pendingSrc: p.image,
        w: p.w,
        h: p.h,
        detected: !!p.detected,
        confidence: p.confidence || 0,
        corners: p.corners || null,
        category: p.category || 'Dokumen',
        quality: p.quality || null,
        needsAutoEnhance: idx === 0
      });
    });
    this.state.currentPageIndex = startIdx;
    this.state.dirty = true;

    if (this.state.pages.length > config.MAX_SESSION_PAGES) {
      this.state.pages.splice(config.MAX_SESSION_PAGES);
      this.showToast(t('sessionFull'), 'error');
    }

    this.showEditor();
    this.updatePagesTray();
    // wipe stale frame first — previously open image must not flash during import
    const canvas = document.getElementById('mainCanvas');
    const ctx = canvas?.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.renderPendingPage(this.state.currentPageIndex);

    if (errors.length > 0 || rejected > 0) {
      this.showToast(t('batchErrors', errors.length + rejected), 'error');
    }

    this.emit('session:create', {});
  },

  renderPendingPage(index) {
    const page = this.state.pages[index];
    if (!page) return;
    if (page.pendingSrc) {
      // keep pendingSrc until img.onload attaches originalImage (session:create may map it first)
      // opts.enhance: hanya halaman pertama sesi/import baru yang di-auto-enhance
      const shouldEnhance = !!page.needsAutoEnhance;
      page.needsAutoEnhance = false;
      this.loadImageFromSrc(page.pendingSrc, { keepSession: true, index, enhance: shouldEnhance });
    } else if (page.originalImage) {
      this.renderPage(index);
    }
  },

  loadImageFromSrc(src, opts = {}) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        if (opts.keepSession) {
          // existing page (session open / batch): attach to pinned index, dirty unchanged
          const idx = opts.index ?? this.state.currentPageIndex;
          if (this.state.pages[idx]) {
            this.state.pages[idx].originalImage = img;
            this.state.pages[idx].pendingSrc = null;
          }
        } else {
          this.state.dirty = true;
          const page = { originalImage: img, currentImageData: null };
          this.state.pages.push(page);
          this.state.currentPageIndex = this.state.pages.length - 1;
          // CATATAN: activeSessionId sengaja TIDAK di-reset — capture baru
          // selama sesi masih terbuka harus update sesi yang sama, bukan
          // membuat sesi duplikat (regresi session:create).
        }

        try {
          this.showEditor();
          this.updatePagesTray();
          this.renderPage(this.state.currentPageIndex);
          // Auto-enhance hanya untuk gambar baru (capture/impor) —
          // bukan setiap lazy-load halaman (dulu menimpa filter user saat ganti halaman)
          if (opts.enhance !== false) this.autoEnhance();
        } catch (err) {
          console.error('Render error:', err);
          this.showToast(t('error'), 'error');
        }
        resolve(img);
      };
      img.onerror = () => {
        this.showToast(t('error'), 'error');
        resolve(null);
      };
      img.src = src;
    });
  },

  renderImage(img) {
    const canvas = this.canvas;
    const ctx = this.ctx;
    const MAX_SIZE = config.IMAGE_MAX_SIZE;
    
    let w = img.width;
    let h = img.height;
    
    if (w > MAX_SIZE || h > MAX_SIZE) {
      const ratio = Math.min(MAX_SIZE / w, MAX_SIZE / h);
      w = Math.floor(w * ratio);
      h = Math.floor(h * ratio);
    }
    
    // Use 1:1 pixel ratio for consistent coordinate mapping
    // DPR scaling causes issues with crop overlay, zoom, and filter pixel ops
    canvas.width = w;
    canvas.height = h;
    
    // Store logical size for calculations
    this.state.canvasWidth = w;
    this.state.canvasHeight = h;
    this.state.logicalWidth = w;
    this.state.logicalHeight = h;
    
    // Reset transform to identity
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    
    // Draw image at full logical size
    ctx.drawImage(img, 0, 0, w, h);
    
    // CSS handles responsive display sizing via max-width/max-height
    canvas.style.width = '';
    canvas.style.height = '';
    
    this.state.baseDisplayW = w;
    this.state.baseDisplayH = h;
    this.state.imageLoaded = true;
    this.applyFilters();
  },

  renderPage(index) {
    const page = this.state.pages[index];
    if (!page) return;
    this.state.currentPageIndex = index;
    if (!page.originalImage) { this.renderPendingPage(index); return; }
    if (page._filters) {
      this.state.filters = { ...page._filters };
      this.updateFilterUI();
    } else {
      this.resetFiltersSilent();
    }
    this.renderImage(page.originalImage);
    this.resetZoom();
    this.updateUndoRedoUI();
  },

  updatePagesTray() {
    const tray = document.getElementById('pagesTray');
    tray.innerHTML = '';
    this.state.pages.forEach((page, idx) => {
      const thumb = document.createElement('div');
      thumb.className = `page-thumb ${idx === this.state.currentPageIndex ? 'active' : ''}`;
      thumb.draggable = true;
      thumb.dataset.index = idx;
      
      const thumbSrc = page.originalImage?.src || page.pendingSrc;
      if (thumbSrc) {
        const img = document.createElement('img');
        img.src = thumbSrc;
        img.alt = t('appName') + ' page ' + (idx + 1);
        thumb.appendChild(img);
      } else {
        thumb.innerHTML = `<span>${idx + 1}</span>`;
      }

      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.innerHTML = '<i data-lucide="x-circle" aria-hidden="true"></i>';
      removeBtn.className = 'remove-page-btn';
      removeBtn.setAttribute('aria-label', t('removePage'));
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        this.deletePage(idx);
      };
      thumb.appendChild(removeBtn);

      thumb.onclick = () => {
        this.state.currentPageIndex = idx;
        if (page.pendingSrc) this.renderPendingPage(idx);
        else this.renderPage(idx);
        this.updatePagesTray();
      };

      // Drag and drop
      thumb.ondragstart = (e) => {
        e.dataTransfer.setData('text/plain', idx);
      };
      thumb.ondragover = (e) => e.preventDefault();
      thumb.ondrop = (e) => {
        e.preventDefault();
        const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
        this.reorderPages(fromIdx, idx);
      };

      tray.appendChild(thumb);
    });

    window.lucide?.createIcons({ root: tray });

    setTimeout(() => {
      const active = tray.querySelector('.page-thumb.active');
      if (active) {
        active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }, 100);
  },

  deletePage(idx) {
    if (this.state.pages.length <= 1) {
      this.showToast(t('lastPage'));
      return;
    }
    this.state.pages.splice(idx, 1);
    this.state.dirty = true;
    if (idx <= this.state.currentPageIndex) {
      this.state.currentPageIndex = Math.max(0, this.state.currentPageIndex - 1);
    }
    this.renderPage(this.state.currentPageIndex);
    this.updatePagesTray();
  },

  reorderPages(from, to) {
    // Guard: parseInt dataTransfer bisa NaN untuk drop rusak —
    // splice(NaN,1) dulu diam-diam menghapus halaman pertama
    if (!Number.isInteger(from) || from < 0 || from >= this.state.pages.length) return;
    if (!Number.isInteger(to) || to < 0 || to >= this.state.pages.length || from === to) {
      this.updatePagesTray();
      return;
    }
    const page = this.state.pages.splice(from, 1)[0];
    this.state.pages.splice(to, 0, page);
    this.state.currentPageIndex = to;
    this.state.dirty = true;
    this.renderPage(to);
    this.updatePagesTray();
  },

  initFilterControls() {
    const sliderMap = {
      filterBrightness: 'brightness',
      filterContrast: 'contrast',
      filterSaturation: 'saturation',
      filterSharpness: 'sharpness',
      filterThreshold: 'threshold'
    };

    Object.entries(sliderMap).forEach(([id, key]) => {
      const slider = document.getElementById(id);
      const valMap = {
        filterBrightness: 'brightnessVal',
        filterContrast: 'contrastVal',
        filterSaturation: 'saturationVal',
        filterSharpness: 'sharpnessVal',
        filterThreshold: 'thresholdVal'
      };

      let filterTimeout;
      slider.addEventListener('input', () => {
        this.state.filters[key] = parseFloat(slider.value);
        const valEl = document.getElementById(valMap[id]);
        if (valEl) valEl.textContent = slider.value;
        
        clearTimeout(filterTimeout);
        filterTimeout = setTimeout(() => this.applyFilters(), 10);
      });
    });

    document.getElementById('filterGrayscale').addEventListener('change', (e) => {
      this.state.filters.grayscale = e.target.checked;
      this.applyFilters();
    });

    document.getElementById('filterSepia').addEventListener('change', (e) => {
      this.state.filters.sepia = e.target.checked;
      this.applyFilters();
    });

    document.getElementById('filterInvert').addEventListener('change', (e) => {
      this.state.filters.invert = e.target.checked;
      this.applyFilters();
    });

    document.getElementById('filterBW').addEventListener('change', (e) => {
      this.state.filters.bw = e.target.checked;
      document.getElementById('thresholdGroup').classList.toggle('hidden', !e.target.checked);
      this.applyFilters();
    });

    document.getElementById('filterShadowRemove')?.addEventListener('change', (e) => {
      this.state.filters.shadowRemove = e.target.checked;
      this.applyFilters();
    });

    document.getElementById('applyFilterAllBtn')?.addEventListener('click', () => {
      this.applyFiltersToAllPages();
    });

    document.getElementById('rotateLeftBtn').addEventListener('click', () => this.rotate(-90));
    document.getElementById('rotateRightBtn').addEventListener('click', () => this.rotate(90));
    document.getElementById('flipHBtn').addEventListener('click', () => this.flip('horizontal'));
    document.getElementById('flipVBtn').addEventListener('click', () => this.flip('vertical'));

    document.getElementById('resetFilterBtn').addEventListener('click', () => this.resetFilters());
    document.getElementById('compareFilterBtn').addEventListener('mousedown', () => this.showOriginal());
    document.getElementById('compareFilterBtn').addEventListener('mouseup', () => { this._filterPending = false; this.applyFilters(); });
    document.getElementById('compareFilterBtn').addEventListener('touchstart', (e) => { e.preventDefault(); this.showOriginal(); });
    document.getElementById('compareFilterBtn').addEventListener('touchend', (e) => { e.preventDefault(); this._filterPending = false; this.applyFilters(); });
  },

  initExportButtons() {
    const qualitySlider = document.getElementById('exportQuality');
    const qualityVal = document.getElementById('exportQualityVal');
    if (qualitySlider) {
      qualitySlider.addEventListener('input', () => {
        if (qualityVal) qualityVal.textContent = qualitySlider.value + '%';
      });
    }

    document.querySelectorAll('.export-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const format = btn.dataset.format;
        if (!format) return; // Do not trigger download for buttons without format like shareBtn
        if (this.state.pages.length === 0) { this.showToast(t('noPagesYet'), 'error'); return; }
        if (format === 'pdf' || format === 'batchPdf') {
          this.toggleSheet('exportSheet', false);
          this.showPdfPreview();
          return;
        }
        this.emit('export:save', { format });
      });
    });

    document.getElementById('searchablePdfToggle')?.addEventListener('change', (e) => {
      this.state.searchablePdf = !!e.target.checked;
    });
    document.getElementById('pickFolderBtn')?.addEventListener('click', () => this.pickDownloadFolder());
    document.getElementById('saveToFolderBtn')?.addEventListener('click', () => {
      if (this.state.pages.length === 0) { this.showToast(t('noPagesYet'), 'error'); return; }
      this.emit('export:save', { format: 'pdf' });
    });
    this.updateFolderStatus();
  },

  sessionLabel() {
    const s = this.state.sessionsCache.find(x => x.id === this.state.activeSessionId);
    if (s) return s.name.replace(/[^\w\-]+/g, '_').slice(0, 40);
    return 'Sesi_' + Date.now().toString(36);
  },

  getExportFilename() {
    const input = document.getElementById('exportFilename');
    const raw = (input?.value || '').trim();
    if (raw) {
      const sanitized = raw
        .replace(/\.(pdf|png|jpe?g)$/i, '')
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80);
      if (sanitized) return sanitized;
    }
    return `${this.sessionLabel()}_${new Date().toISOString().slice(0, 10)}`;
  },

  getExportTargetBytes() {
    const sel = document.getElementById('exportTargetSize');
    const val = parseInt(sel?.value || '0', 10);
    return Number.isFinite(val) && val > 0 ? val : 0;
  },

  async updateFolderStatus() {
    const el = document.getElementById('folderStatus');
    if (!el) return;
    try {
      const handle = await storage.getDirHandle();
      el.textContent = handle ? `${handle.name}/${config.DOWNLOAD.dirName}/` : `${config.DOWNLOAD.dirName}/ (browser download)`;
    } catch (_) {
      el.textContent = `${config.DOWNLOAD.dirName}/ (browser download)`;
    }
  },

  /** Explain-then-ask helper: modal klarifikasi izin folder, resolve true = lanjut minta akses browser. */
  requestFolderPermission() {
    return new Promise((resolve) => {
      const modal = document.getElementById('permissionModal');
      if (!modal) { resolve(true); return; }
      const allowBtn = document.getElementById('permAllowBtn');
      const denyBtn = document.getElementById('permDenyBtn');
      const closeBtn = document.getElementById('closePermissionModal');
      const backdrop = document.getElementById('permissionBackdrop');
      const onAllow = () => done(true);
      const onDeny = () => done(false);
      const done = (ok) => {
        allowBtn.removeEventListener('click', onAllow);
        denyBtn.removeEventListener('click', onDeny);
        closeBtn.removeEventListener('click', onDeny);
        backdrop.removeEventListener('click', onDeny);
        modal.classList.add('hidden');
        modal.setAttribute('inert', '');
        resolve(ok);
      };
      allowBtn.addEventListener('click', onAllow);
      denyBtn.addEventListener('click', onDeny);
      closeBtn.addEventListener('click', onDeny);
      backdrop.addEventListener('click', onDeny);
      modal.classList.remove('hidden');
      modal.removeAttribute('inert');
      window.lucide?.createIcons({ root: modal });
    });
  },

  async pickDownloadFolder() {
    if (!window.showDirectoryPicker) {
      this.showToast(t('folderFallback'), 'warning');
      return;
    }
    const allowed = await this.requestFolderPermission();
    if (!allowed) return;
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await storage.setDirHandle(handle);
      this.updateFolderStatus();
      this.showToast(t('folderPicked'), 'success');
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.warn('pickFolder error:', err);
        this.showToast(t('error'), 'error');
      }
    }
  },

  showDlProgress(show, pct = 0, text) {
    const wrap = document.getElementById('dlProgress');
    const fill = document.getElementById('dlProgressFill');
    const label = document.getElementById('dlProgressText');
    if (!wrap) return;
    wrap.classList.toggle('hidden', !show);
    if (show) {
      if (fill) fill.style.width = pct + '%';
      if (label) label.textContent = text || t('downloadProgress');
    }
  },

  /** Write jobs [{name, blob}] into Scanner/ folder; anchor fallback with timeout guard so export never hangs. */
  async saveFiles(jobs) {
    const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('folder-timeout')), ms);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); }
      );
    });

    const handle = await storage.getDirHandle().catch(() => null);
    if (handle && window.showDirectoryPicker) {
      try {
        if (handle.queryPermission) {
          let perm = await withTimeout(handle.queryPermission({ mode: 'readwrite' }), 4000);
          if (perm !== 'granted') perm = await withTimeout(handle.requestPermission({ mode: 'readwrite' }), 8000);
          if (perm !== 'granted') throw new Error('permission-denied');
        }
        const dir = await withTimeout(handle.getDirectoryHandle(config.DOWNLOAD.dirName, { create: true }), 5000);
        let i = 0;
        for (const job of jobs) {
          const fh = await withTimeout(dir.getFileHandle(job.name, { create: true }), 5000);
          const writer = await withTimeout(fh.createWritable(), 5000);
          await withTimeout(writer.write(job.blob), 15000);
          await withTimeout(writer.close(), 5000);
          i++;
          this.showDlProgress(true, Math.round((i / jobs.length) * 100), t('downloadProgress'));
        }
        return true;
      } catch (err) {
        if (err?.name === 'AbortError') return false;
        console.warn('Folder write failed, falling back to browser download:', err);
      }
    }
    for (let i = 0; i < jobs.length; i++) {
      pdfExport._downloadBlob(jobs[i].blob, 'Scanner-' + jobs[i].name);
      if (i < jobs.length - 1) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    return false;
  },

  async performExport(format) {
    if (this._exporting) return; // guard double-submission (dobel klik save)
    if (this.state.pages.length === 0) { this.showToast(t('noPagesYet'), 'error'); return; }
    this._exporting = true;
    const qualitySlider = document.getElementById('exportQuality');
    const quality = qualitySlider ? parseInt(qualitySlider.value) / 100 : 0.85;
    const base = this.getExportFilename();
    const targetBytes = this.getExportTargetBytes();

    this.showDlProgress(true, 10, t('downloadProgress'));
    try {
      let jobs = [];
      if (format === 'pdf' || format === 'batchPdf') {
        const pdfOpts = {
          searchable: this.state.searchablePdf !== false,
          getOcrData: (index) => this.getPageOcrData(index)
        };
        const blob = targetBytes > 0
          ? (await pdfExport.toPdfBlobWithTargetSize(
              this.state.pages.length,
              (index, maxDim) => this.renderPageForPdf(index, maxDim),
              quality,
              targetBytes,
              pdfOpts
            )).blob
          : await pdfExport.toPdfBlobFromPages(
              this.state.pages.length,
              (index) => this.renderPageForPdf(index),
              quality,
              pdfOpts
            );
        jobs = [{ name: `${base}.pdf`, blob }];
      } else if (format === 'batchJpg') {
        for (let index = 0; index < this.state.pages.length; index++) {
          const canvas = await this.renderPageForPdf(index);
          if (!canvas) continue;
          try {
            jobs.push({
              name: `${base}_p${index + 1}.jpg`,
              blob: pdfExport.toImageBlob(canvas, 'jpg', quality)
            });
          } finally {
            canvas.width = 0;
            canvas.height = 0;
          }
        }
      } else if (format === 'png' || format === 'jpg') {
        const ext = format === 'png' ? 'png' : 'jpg';
        const rendered = await this.renderPageForPdf(this.state.currentPageIndex);
        if (rendered) {
          try {
            jobs = [{ name: `${base}.${ext}`, blob: pdfExport.toImageBlob(rendered, ext, quality) }];
          } finally {
            rendered.width = 0;
            rendered.height = 0;
          }
        } else {
          jobs = [{ name: `${base}.${ext}`, blob: pdfExport.toImageBlob(this.canvas, ext, quality) }];
        }
      } else {
        jobs = [{ name: `${base}.jpg`, blob: pdfExport.toImageBlob(this.canvas, 'jpg', quality) }];
      }

      this.showDlProgress(true, 60, t('downloadProgress'));
      const usedFolder = await this.saveFiles(jobs);
      this.showDlProgress(true, 100, t('downloadDone'));
      this.showToast(usedFolder ? t('downloadDone') : t('folderFallback'), 'success');
      this.toggleSheet('exportSheet', false);
      setTimeout(() => this.showDlProgress(false), 800);
    } catch (err) {
      console.error('Export error:', err);
      this.showDlProgress(false);
      this.showToast(t('error') + ': ' + err.message, 'error');
    } finally {
      this._exporting = false;
    }
  },

  async shareDoc() {
    if (!navigator.share) {
      this.showToast(t('error'));
      return;
    }
    let rendered = null;
    try {
      rendered = await this.renderPageForPdf(this.state.currentPageIndex);
      const srcCanvas = rendered || this.canvas;
      const blob = await new Promise(r => srcCanvas.toBlob(r, 'image/jpeg', 0.92));
      if (!blob) throw new Error('Failed to generate image');
      const file = new File([blob], `${this.getExportFilename()}.jpg`, { type: 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ title: 'WebScanner', files: [file] });
      } else {
        await navigator.share({ title: 'WebScanner' });
      }
      this.toggleSheet('exportSheet', false);
    } catch (err) {
      // User cancelled sharing in system dialog (AbortError) - do nothing
      if (err.name === 'AbortError') {
        return;
      }
      console.warn('Share error:', err);
      this.showToast(t('error'));
    } finally {
      if (rendered) {
        rendered.width = 0;
        rendered.height = 0;
      }
    }
  },

  async applyFilters() {
    if (!this.state.imageLoaded) return;
    const currentPage = this.state.pages[this.state.currentPageIndex];
    if (currentPage) {
      currentPage._filters = { ...this.state.filters };
    }
    if (this._filterPending) {
      this._filterQueued = true;
      return;
    }
    this._filterPending = true;
    try {
      const pageIndex = this.state.currentPageIndex;
      const page = this.state.pages[pageIndex];
      if (!page || !page.originalImage) return;

      const filters = { ...(page._filters || this.state.filters) };
      const canvas = this.canvas;
      const ctx = this.ctx;
      const img = page.originalImage;

      // Restore opacity if coming from Before/After
      canvas.style.opacity = '1';

      const w = this.state.canvasWidth;
      const h = this.state.canvasHeight;

      ctx.filter = [
        `brightness(${100 + filters.brightness}%)`,
        `contrast(${100 + filters.contrast}%)`,
        `saturate(${100 + filters.saturation}%)`,
        filters.grayscale ? 'grayscale(100%)' : '',
        filters.sepia ? 'sepia(100%)' : '',
        filters.invert ? 'invert(100%)' : '',
      ].filter(Boolean).join(' ');

      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      // Reset filter after drawing so getImageData reads actual pixel values
      ctx.filter = 'none';

      if (filters.shadowRemove && window.MLDetector?.applyShadowRemovalInPlace) {
        window.MLDetector.applyShadowRemovalInPlace(ctx, canvas.width, canvas.height, 1.0);
      }

      if (filters.bw) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
          const val = avg > filters.threshold ? 255 : 0;
          data[i] = data[i + 1] = data[i + 2] = val;
        }
        ctx.putImageData(imageData, 0, 0);
      }

      if (filters.sharpness > 0) {
        try {
          await this.applySharpness(filters.sharpness);
        } catch (err) {
          console.error('Sharpness filter failed:', err);
          this.showToast(t('error') + ': ' + err.message, 'error');
        }
      }

      if (this.state.currentPageIndex === pageIndex) {
        page.currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
    } finally {
      this._filterPending = false;
      if (this._filterQueued) {
        this._filterQueued = false;
        await this.applyFilters();
      }
    }
  },

  async applySharpness(amount) {
    // Jangan silent no-op: tunggu worker selesai lalu jalankan — kalau tidak,
    // ketajaman tidak pernah diterapkan ke currentImageData/ekspor
    while (this.state.isFilterWorkerRunning) {
      await new Promise((r) => setTimeout(r, 50));
    }
    this.state.isFilterWorkerRunning = true;

    // Add progress UI
    const progressEl = document.getElementById('filterProgress');
    const progressFill = document.getElementById('filterProgressBar');
    if (progressEl) progressEl.classList.remove('hidden');

    let worker;
    let imageData;
    try {
      imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      worker = new Worker('js/filter-worker.js');
    } catch (err) {
      worker?.terminate();
      this.state.isFilterWorkerRunning = false;
      if (progressEl) progressEl.classList.add('hidden');
      throw err;
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        this.state.isFilterWorkerRunning = false;
        if (progressEl) progressEl.classList.add('hidden');
        worker.terminate();
        if (error) reject(error);
        else resolve();
      };

      worker.onmessage = (e) => {
        if (e.data.progress !== undefined) {
          if (progressFill) progressFill.style.width = e.data.progress + '%';
          return;
        }

        try {
          if (!e.data.output) throw new Error('Worker filter returned no image data.');
          const output = new ImageData(e.data.output, this.canvas.width, this.canvas.height);
          this.ctx.putImageData(output, 0, 0);
          finish();
        } catch (err) {
          finish(err);
        }
      };

      worker.onerror = (err) => {
        console.error('Filter worker error:', err);
        finish(err);
      };

      try {
        worker.postMessage({
          data: imageData.data,
          width: this.canvas.width,
          height: this.canvas.height,
          amount
        }, [imageData.data.buffer]);
      } catch (err) {
        finish(err);
      }
    });
  },

  startManualCrop() {
    if (!this.state.imageLoaded) {
      this.showToast(t('noImage'));
      return;
    }
    this.showToast(t('cropInstruction'));
    
    // Reset zoom and pan so crop overlay aligns with the center image
    this.resetZoom();
    
    const overlay = document.getElementById('cropOverlay');
    const actionBar = document.getElementById('cropActionBar');
    overlay.classList.remove('hidden');
    actionBar.classList.remove('hidden');
    this.state.isCropping = true;
    // Zoom controls mengganggu & bertabrakan dengan crop action bar di layar kecil
    document.getElementById('zoomControls')?.classList.add('hidden');
    
    manualCrop.init();
    manualCrop.resetCropArea();
  },

  confirmManualCrop() {
    try {
      const croppedCanvas = manualCrop.cropQuadrilateral();
      if (!croppedCanvas || croppedCanvas.width < 10 || croppedCanvas.height < 10) {
        this.showToast(t('cropTooSmall'));
        return;
      }

      this.saveUndoState();
      const canvas = this.canvas;
      canvas.width = croppedCanvas.width;
      canvas.height = croppedCanvas.height;
      this.ctx.drawImage(croppedCanvas, 0, 0);

      this.state.canvasWidth = croppedCanvas.width;
      this.state.canvasHeight = croppedCanvas.height;
      this.state.imageLoaded = true;
      this.showToast(t('cropSuccess'));

      const croppedImage = new Image();
      croppedImage.src = canvas.toDataURL();
      croppedImage.onload = () => {
        this.setCurrentPageImage(croppedImage);
        this.applyFilters();
      };
    } catch (err) {
      console.error("Crop error:", err);
      this.showToast(t('error'));
    }

    this.cancelManualCrop();
  },

  cancelManualCrop() {
    document.getElementById('cropOverlay')?.classList.add('hidden');
    document.getElementById('cropActionBar')?.classList.add('hidden');
    this.state.isCropping = false;
    manualCrop.hideMagnifier();
    document.getElementById('zoomControls')?.classList.remove('hidden');
  },

  async autoCrop() {
    if (!this.state.imageLoaded) {
      this.showToast(t('noImage'));
      return false;
    }
    this.showToast(t('processing'));

    try {
      // 1. Detect document contour & corners using on-device ML/CV
      let result = window.MLDetector?.detect
        ? await window.MLDetector.detect(this.canvas)
        : (typeof edgeDetection !== 'undefined' ? edgeDetection.detectContour(this.canvas) : null);

      if (!result || result.confidence < 0.3) {
        if (typeof edgeDetection !== 'undefined') {
          result = edgeDetection.detectContour(this.canvas, { relaxed: true });
        }
      }

      // 2. If valid 4 corners found, perform perspective warp directly
      if (result && result.corners && result.corners.length === 4) {
        const ordered = (typeof edgeDetection !== 'undefined' && edgeDetection.orderCorners)
          ? edgeDetection.orderCorners(result.corners)
          : result.corners;

        const topW = Math.hypot(ordered[1].x - ordered[0].x, ordered[1].y - ordered[0].y);
        const botW = Math.hypot(ordered[2].x - ordered[3].x, ordered[2].y - ordered[3].y);
        const leftH = Math.hypot(ordered[3].x - ordered[0].x, ordered[3].y - ordered[0].y);
        const rightH = Math.hypot(ordered[2].x - ordered[1].x, ordered[2].y - ordered[1].y);
        const targetW = Math.max(30, Math.round(Math.max(topW, botW)));
        const targetH = Math.max(30, Math.round(Math.max(leftH, rightH)));

        const warped = (typeof edgeDetection !== 'undefined' && edgeDetection.warpPerspective)
          ? edgeDetection.warpPerspective(this.canvas, ordered, targetW, targetH)
          : null;

        if (warped && warped.width >= 20 && warped.height >= 20) {
          this.saveUndoState();
          this.canvas.width = warped.width;
          this.canvas.height = warped.height;
          this.ctx.drawImage(warped, 0, 0);

          this.state.canvasWidth = warped.width;
          this.state.canvasHeight = warped.height;
          this.state.imageLoaded = true;

          const croppedImage = new Image();
          croppedImage.onload = () => {
            this.setCurrentPageImage(croppedImage);
            this.applyFilters();
          };
          croppedImage.src = this.canvas.toDataURL();

          this.showToast(t('cropSuccess'));
          return true;
        }
      }

      // If confidence too low or no distinct quadrilateral detected, gracefully open manual crop
      this.showToast('Sudut dokumen tidak terdeteksi jelas. Membuka potong manual.');
      this.startManualCrop();
      if (result && result.corners && result.corners.length === 4) {
        requestAnimationFrame(() => {
          manualCrop.setDetectedCorners(result.corners, this.canvas);
        });
      }
      return false;
    } catch (err) {
      console.error('Auto crop error:', err);
      this.startManualCrop();
      return false;
    }
  },

  async autoDetectForManualCrop() {
    if (!this.state.imageLoaded) return;
    this.showToast(t('processing'));
    try {
      let result = window.MLDetector?.detect
        ? await window.MLDetector.detect(this.canvas)
        : (typeof edgeDetection !== 'undefined' ? edgeDetection.detectContour(this.canvas) : null);

      if (!result || result.confidence < 0.25) {
        if (typeof edgeDetection !== 'undefined') {
          result = edgeDetection.detectContour(this.canvas, { relaxed: true });
        }
      }

      if (result && result.corners && result.corners.length === 4) {
        manualCrop.setDetectedCorners(result.corners, this.canvas);
        this.showToast(t('cropInstruction'));
      } else {
        manualCrop.resetCropArea();
        this.showToast('Sudut tidak ditemukan, area direset');
      }
    } catch (err) {
      console.error('Auto detect for manual crop failed:', err);
      manualCrop.resetCropArea();
    }
  },

  rotate(deg) {
    if (!this.state.imageLoaded) return;
    this.saveUndoState();

    const canvas = this.canvas;
    const ctx = this.ctx;
    const page = this.state.pages[this.state.currentPageIndex];
    const img = page ? page.originalImage : null;
    if (!img) return;

    let srcW = img.width;
    let srcH = img.height;
    const MAX_SIZE = config.IMAGE_MAX_SIZE;
    if (srcW > MAX_SIZE || srcH > MAX_SIZE) {
      const ratio = Math.min(MAX_SIZE / srcW, MAX_SIZE / srcH);
      srcW = Math.floor(srcW * ratio);
      srcH = Math.floor(srcH * ratio);
    }

    const radians = (deg * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const newW = Math.ceil(srcW * cos + srcH * sin);
    const newH = Math.ceil(srcW * sin + srcH * cos);

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = newW;
    tempCanvas.height = newH;
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
    tempCtx.translate(newW / 2, newH / 2);
    tempCtx.rotate(radians);
    tempCtx.drawImage(img, 0, 0, srcW, srcH, -srcW / 2, -srcH / 2, srcW, srcH);

    canvas.width = newW;
    canvas.height = newH;
    this.state.canvasWidth = newW;
    this.state.canvasHeight = newH;
    this.state.logicalWidth = newW;
    this.state.logicalHeight = newH;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(tempCanvas, 0, 0);
    canvas.style.width = '';
    canvas.style.height = '';
    this.state.baseDisplayW = newW;
    this.state.baseDisplayH = newH;

    const transformedImage = new Image();
    transformedImage.onload = () => {
      this.setCurrentPageImage(transformedImage);
      this.state.imageLoaded = true;
      this.resetZoom();
      this.applyFilters();
    };
    transformedImage.src = tempCanvas.toDataURL();
  },

  flip(direction) {
    if (!this.state.imageLoaded) return;
    this.saveUndoState();
    const canvas = this.canvas;
    const ctx = this.ctx;
    const page = this.state.pages[this.state.currentPageIndex];
    const img = page ? page.originalImage : null;
    if (!img) return;

    const MAX_SIZE = config.IMAGE_MAX_SIZE;
    let w = img.width;
    let h = img.height;
    if (w > MAX_SIZE || h > MAX_SIZE) {
      const ratio = Math.min(MAX_SIZE / w, MAX_SIZE / h);
      w = Math.floor(w * ratio);
      h = Math.floor(h * ratio);
    }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

    if (direction === 'horizontal') {
      tempCtx.translate(w, 0);
      tempCtx.scale(-1, 1);
    } else {
      tempCtx.translate(0, h);
      tempCtx.scale(1, -1);
    }
    tempCtx.drawImage(img, 0, 0, w, h);

    canvas.width = w;
    canvas.height = h;
    this.state.canvasWidth = w;
    this.state.canvasHeight = h;
    this.state.logicalWidth = w;
    this.state.logicalHeight = h;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(tempCanvas, 0, 0);
    canvas.style.width = '';
    canvas.style.height = '';
    this.state.baseDisplayW = w;
    this.state.baseDisplayH = h;

    const transformedImage = new Image();
    transformedImage.onload = () => {
      this.setCurrentPageImage(transformedImage);
      this.state.imageLoaded = true;
      this.resetZoom();
      this.applyFilters();
    };
    transformedImage.src = tempCanvas.toDataURL();
  },

  resetFilters() {
    this.state.filters = {
      brightness: 0, contrast: 0, saturation: 0, sharpness: 0,
      grayscale: false, sepia: false, invert: false, bw: false, threshold: 128, shadowRemove: false
    };
    document.getElementById('filterBrightness').value = 0;
    document.getElementById('filterContrast').value = 0;
    document.getElementById('filterSaturation').value = 0;
    document.getElementById('filterSharpness').value = 0;
    document.getElementById('filterGrayscale').checked = false;
    document.getElementById('filterSepia').checked = false;
    document.getElementById('filterInvert').checked = false;
    document.getElementById('filterBW').checked = false;
    const srEl = document.getElementById('filterShadowRemove');
    if (srEl) srEl.checked = false;
    document.getElementById('filterThreshold').value = 128;
    document.getElementById('brightnessVal').textContent = '0';
    document.getElementById('contrastVal').textContent = '0';
    document.getElementById('saturationVal').textContent = '0';
    document.getElementById('sharpnessVal').textContent = '0';
    document.getElementById('thresholdVal').textContent = '128';
    document.getElementById('thresholdGroup').classList.add('hidden');
    this.showToast(t('resetSuccess'));
    this.applyFilters();
  },

  showOriginal() {
    if (!this.state.imageLoaded) return;
    const page = this.state.pages[this.state.currentPageIndex];
    if (!page || !page.originalImage) return;
    this.canvas.style.opacity = '0.7';
    this.ctx.filter = 'none';
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(page.originalImage, 0, 0, this.state.canvasWidth, this.state.canvasHeight);
  },

  // ─── Home: session-based history ───
  async refreshHome() {
    try {
      this.state.sessionsCache = await storage.getSessions();
    } catch (err) {
      console.error(err);
      this.state.sessionsCache = [];
    }
    if (!document.getElementById('historyView').classList.contains('hidden')) {
      this.renderHome();
    }
  },

  async showHome() {
    await this.refreshHome();
    camera.stop();
    document.getElementById('emptyState')?.classList.add('hidden');
    document.getElementById('editorArea')?.classList.add('hidden');
    document.getElementById('bottomNav')?.classList.add('hidden'); // nav = edit-session only
    // riwayat surface: back button returns to home (goHome guards unsaved work)
    document.getElementById('homeBackBtn')?.classList.remove('hidden');
    document.getElementById('historyView').classList.remove('hidden');
    this.setActiveNav('navHistory');
    this.renderHome();
  },

  /** Back to home surface (emptyState). Warns first when unsaved work would be left behind. */
  goHome() {
    if (this.state.pages.length > 0 && this.state.dirty) {
      this.showSessionGuard(this.state.pages.length, { mode: 'home' });
    } else {
      this.startNewSession();
    }
  },

  renderHome() {
    const list = document.getElementById('historyList');
    const empty = document.getElementById('historyEmpty');
    if (!list) return;
    const sessions = this.state.sessionsCache;
    list.innerHTML = '';

    if (sessions.length === 0) {
      empty?.classList.remove('hidden');
      window.lucide?.createIcons({ root: document.getElementById('historyView') });
      return;
    }
    empty?.classList.add('hidden');

    sessions.forEach((session) => {
      const item = document.createElement('div');
      item.className = 'history-item session-card';
      if (session.id === this.state.activeSessionId) item.classList.add('active');
      const cover = session.pages?.[0]?.image || '';
      const count = session.pages?.length || 0;
      item.innerHTML = `
        <img src="${cover}" alt="${this.escapeHtml(session.name)}">
        <div class="history-meta">
          <span class="session-name">${this.escapeHtml(session.name)}</span>
          <small class="session-info">${count} ${t('sessionPages')} · ${new Date(session.updatedAt).toLocaleString()}</small>
        </div>
        <div class="history-actions">
          <button data-action="open" aria-label="${t('openSession')}"><i data-lucide="folder-open" aria-hidden="true"></i></button>
          <button data-action="rename" aria-label="${t('renameSession')}"><i data-lucide="pencil" aria-hidden="true"></i></button>
          <button data-action="delete" aria-label="${t('deleteSession')}"><i data-lucide="trash-2" aria-hidden="true"></i></button>
        </div>
      `;
      item.querySelector('[data-action="open"]').addEventListener('click', (e) => {
        e.stopPropagation();
        this.requestOpenSession(session.id);
      });
      item.addEventListener('click', () => this.requestOpenSession(session.id));
      item.querySelector('[data-action="rename"]').addEventListener('click', (e) => {
        e.stopPropagation();
        const name = prompt(t('renameSession'), session.name);
        if (name && name.trim()) this.emit('session:rename', { id: session.id, name: name.trim() });
      });
      item.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(t('confirmDeleteSession'))) this.emit('session:delete', { id: session.id });
      });
      list.appendChild(item);
    });
    window.lucide?.createIcons({ root: list });
  },

  async showHistory() { return this.showHome(); }, // backward compat

  requestOpenSession(id) {
    if (this.state.pages.length > 0 && this.state.dirty) {
      this.showSessionGuard(this.state.pages.length, { mode: 'open', id });
      return;
    }
    this.emit('session:open', { id });
  },

  showSessionGuard(count, pending) {
    this.state.pendingOpenSessionId = pending.id ?? null;
    this._guardPending = pending;
    const desc = document.getElementById('sessionGuardDesc');
    if (desc) desc.textContent = t('sessionGuardDesc', count);
    // button labels follow the pending action (home vs open vs new)
    const saveKey = pending.mode === 'home' ? 'sessionGuardSaveHome' : 'sessionGuardSave';
    const discardKey = pending.mode === 'home' ? 'sessionGuardDiscardHome' : 'sessionGuardDiscard';
    const saveSpan = document.querySelector('#guardSaveBtn [data-i18n]');
    const discardSpan = document.querySelector('#guardDiscardBtn [data-i18n]');
    if (saveSpan) { saveSpan.dataset.i18n = saveKey; saveSpan.textContent = t(saveKey); }
    if (discardSpan) { discardSpan.dataset.i18n = discardKey; discardSpan.textContent = t(discardKey); }
    const modal = document.getElementById('sessionGuardModal');
    modal.classList.remove('hidden');
    modal.removeAttribute('inert');
    window.lucide?.createIcons({ root: modal });
  },

  closeSessionGuard() {
    const modal = document.getElementById('sessionGuardModal');
    modal.classList.add('hidden');
    modal.setAttribute('inert', '');
    this.state.pendingOpenSessionId = null;
    this._guardPending = null;
    this._pendingBatch = null;
  },

  async openSession(id) {
    if (!id) return;
    try {
      const session = await storage.getSession(id);
      if (!session) { this.showToast(t('error'), 'error'); return; }

      // Load all pages; first rendered immediately, rest lazy via pendingSrc
      this.state.pages = (session.pages || []).map((p) => ({
        originalImage: null,
        currentImageData: null,
        name: p.name,
        pendingSrc: p.image,
        w: p.w,
        h: p.h
      }));
      this.state.currentPageIndex = 0;
      this.state.activeSessionId = session.id;
      this.state.dirty = false;
      this.updateUndoRedoUI();
      this.resetFiltersSilent();
      this.showEditor();
      this.updatePagesTray();
      this.renderPendingPage(0);
      document.getElementById('historyView').classList.add('hidden');
      this.setActiveNav(null);
      this.showToast(t('sessionOpened'));
    } catch (err) {
      console.error('openSession error:', err);
      this.showToast(t('error'), 'error');
    }
  },

  resetFiltersSilent() {
    this.state.filters = {
      brightness: 0, contrast: 0, saturation: 0, sharpness: 0,
      grayscale: false, sepia: false, invert: false, bw: false, threshold: 128, shadowRemove: false
    };
    this.updateFilterUI();
  },

  startNewSession() {
    this.state.pages = []; // pages lama (beserta undo stack per-halaman) ikut terbuang
    this.state.currentPageIndex = -1;
    this.state.activeSessionId = null;
    this.state.dirty = false;
    this.updateUndoRedoUI();
    this.resetFiltersSilent();
    document.getElementById('historyView').classList.add('hidden');
    document.getElementById('editorArea')?.classList.add('hidden');
    document.getElementById('bottomNav')?.classList.add('hidden');
    document.getElementById('homeBackBtn')?.classList.add('hidden');
    document.getElementById('emptyState')?.classList.remove('hidden');
    this.setActiveNav(null);
  },

  bindSessionGuard() {
    const save = async () => {
      const pending = this._guardPending;
      const batch = this._pendingBatch;
      this.closeSessionGuard();
      if (!pending) return;
      const saved = await this.emit('session:create', {});
      if (!saved) {
        this._pendingBatch = batch;
        this.showSessionGuard(this.state.pages.length, pending);
        return;
      }
      if (pending.mode === 'open') this.openSession(pending.id);
      else if (pending.mode === 'new') this.startNewSession();
      else if (pending.mode === 'home') this.startNewSession();
      else if (pending.mode === 'import' && batch) this._applyBatch(batch, []);
    };
    const discard = () => {
      const pending = this._guardPending;
      const batch = this._pendingBatch;
      this.state.dirty = false;
      this.closeSessionGuard();
      if (!pending) return;
      if (pending.mode === 'open') this.openSession(pending.id);
      else if (pending.mode === 'new') this.startNewSession();
      else if (pending.mode === 'home') this.startNewSession();
      else if (pending.mode === 'import') {
        this.state.pages = []; // buang juga undo stack per-halaman
        this.state.activeSessionId = null;
        this.state.dirty = false;
        if (batch) this._applyBatch(batch, []);
      }
    };
    document.getElementById('guardSaveBtn')?.addEventListener('click', save);
    document.getElementById('guardDiscardBtn')?.addEventListener('click', discard);
    document.getElementById('guardCancelBtn')?.addEventListener('click', () => this.closeSessionGuard());
    document.getElementById('closeSessionGuard')?.addEventListener('click', () => this.closeSessionGuard());
    document.getElementById('sessionGuardBackdrop')?.addEventListener('click', () => this.closeSessionGuard());
  },

  showToast(message, type = 'info') {
    // single toast slot: drop any existing immediately (avoids stacked/duplicate toasts)
    document.querySelectorAll('.toast').forEach((el) => el.remove());

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;
    document.body.appendChild(toast);

    // Adaptive timeout based on message length
    const duration = Math.min(4000, Math.max(2000, message.length * 50));
    setTimeout(() => {
      toast.style.animation = 'toastOut 0.2s ease forwards';
      setTimeout(() => toast.remove(), 200);
    }, duration);
  },

  async autoEnhance() {
    if (window.MLDetector?.detectContentType && this.canvas?.width > 0) {
      if (window.MLDetector.detectContentType(this.canvas) === 'photo') {
        const page = this.state.pages[this.state.currentPageIndex];
        if (page) page._filters = { ...this.state.filters };
        return;
      }
    }
    this.state.filters.sharpness = config.AUTO_ENHANCE.sharpness;
    this.state.filters.contrast = config.AUTO_ENHANCE.contrast;
    
    const sharpnessSlider = document.getElementById('filterSharpness');
    if (sharpnessSlider) {
      sharpnessSlider.value = config.AUTO_ENHANCE.sharpness;
      document.getElementById('sharpnessVal').textContent = String(config.AUTO_ENHANCE.sharpness);
    }
    const contrastSlider = document.getElementById('filterContrast');
    if (contrastSlider) {
      contrastSlider.value = config.AUTO_ENHANCE.contrast;
      document.getElementById('contrastVal').textContent = String(config.AUTO_ENHANCE.contrast);
    }
    
    this.applyFilters();
  },

  async runAiAnalysis() {
    if (this.state.isAnalyzing) return;
    this.state.isAnalyzing = true;

    const resultDiv = document.getElementById('aiResultArea');
    const btn = document.getElementById('aiAnalyzeBtn');
    const ocrResultDiv = document.getElementById('ocrResult');
    const rawText = ocrResultDiv ? ocrResultDiv.innerText.trim() : '';

    const placeholderTexts = [
      t('processing'), t('ocrStarting'), t('ocrCancelled'),
      t('ocrDone'), '(No text detected)', 'Memproses...', 'Memulai OCR...',
      'ocrStarting', 'OCR cancelled'
    ];
    const isResultValid = rawText && !placeholderTexts.some(p => rawText === p || rawText.includes(p));

    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader" aria-hidden="true"></i> ${t('aiAnalyzing')}`;
    window.lucide?.createIcons();
    resultDiv.classList.remove('hidden');
    resultDiv.innerText = t('aiStarting');

    try {
      const textToAnalyze = isResultValid ? rawText : '';
      const analysis = await aiEngine.analyze(textToAnalyze, this.canvas);

      let html = '';
      html += `<div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;">
        <span class="ai-tag">CNN MobileNet v2</span>
        <span class="ai-tag private-tag">100% On-Device & Privat</span>
      </div>`;
      html += `<div style="white-space: pre-wrap; font-size: 13px; line-height: 1.6;">${this.escapeHtml(analysis.fullAnalysis)}</div>`;

      if (analysis.structuredData) {
        const hasKeys = Object.keys(analysis.structuredData).some(k => {
          const val = analysis.structuredData[k];
          return Array.isArray(val) ? val.length > 0 : (val && val !== '-');
        });
        if (hasKeys) {
          const structuredText = this.escapeHtml(JSON.stringify(analysis.structuredData, null, 2));
          html += `<div style="margin-top: 10px; border-top: 1px solid var(--color-border); padding-top: 8px;">
            <span style="font-size: 11px; font-weight: 700; color: var(--color-text-secondary); text-transform: uppercase;">Data Terstruktur JSON</span>
            <pre style="font-size: 11px; white-space: pre-wrap; margin-top: 4px; padding: 8px; border-radius: 6px; background: rgba(0,0,0,0.04); color: var(--color-text); font-family: monospace;">${structuredText}</pre>
          </div>`;
        }
      }
      
      resultDiv.innerHTML = html;
      window.lucide?.createIcons();
    } catch (err) {
      resultDiv.innerHTML = `<div style="color: var(--color-destructive);"><strong>Error:</strong> ${this.escapeHtml(err.message)}</div>`;
    } finally {
      this.state.isAnalyzing = false;
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="sparkles" aria-hidden="true"></i> ${t('aiAnalyze')}`;
      window.lucide?.createIcons();
    }
  },

  showOcrProgress(show) {
    const progressEl = document.getElementById('ocrProgress');
    const cancelBtn = document.getElementById('cancelOcrBtn');
    if (show) {
      progressEl?.classList.remove('hidden');
      cancelBtn?.classList.remove('hidden');
    } else {
      progressEl?.classList.add('hidden');
      cancelBtn?.classList.add('hidden');
    }
  },

  updateOcrProgress(progress) {
    const bar = document.getElementById('ocrProgressBar');
    const text = document.getElementById('ocrProgressText');
    const pct = Math.round(progress * 100);
    if (bar) bar.style.width = pct + '%';
    if (text) text.textContent = pct + '%';
  },

  async startOcr() {
    if (this.state.isOcrRunning) return;
    if (!this.state.imageLoaded || !this.state.pages[this.state.currentPageIndex]) {
      this.showToast(t('noImage'));
      return;
    }
    this.state.isOcrRunning = true;

    this.toggleSheet('ocrSheet', true);
    window.lucide?.createIcons();
    const resultDiv = document.getElementById('ocrResult');
    resultDiv.innerHTML = `<p><i data-lucide="loader" aria-hidden="true"></i> ${t('ocrStarting')}</p>`;
    document.getElementById('aiResultArea').classList.add('hidden');
    this.showOcrProgress(true);
    this.updateOcrProgress(0);
    this.state.ocrAborted = false;
    window.lucide?.createIcons();

    const langSelect = document.getElementById('ocrLangSelect');
    const selectedLang = langSelect ? langSelect.value : 'ind+eng';

    try {
      const text = await ocrEngine.recognize(this.canvas, (progress) => {
        this.updateOcrProgress(progress);
      }, () => this.state.ocrAborted, selectedLang);
      if (!this.state.ocrAborted) {
        resultDiv.innerText = text || '(Tidak ada teks terdeteksi)';
        const curPage = this.state.pages[this.state.currentPageIndex];
        if (curPage && text) {
          curPage.ocrText = text;
          curPage.ocrWords = ocrEngine.lastResult?.words || [];
          curPage.ocrWidth = ocrEngine.lastResult?.width || this.canvas.width;
          curPage.ocrHeight = ocrEngine.lastResult?.height || this.canvas.height;
        }
        this.showToast(t('ocrDone'));
      }
    } catch (err) {
      if (this.state.ocrAborted) {
        resultDiv.innerHTML = `<p style="color: var(--color-text-secondary)">${t('ocrCancelled')}</p>`;
      } else {
        resultDiv.innerHTML = `<p style="color: var(--color-destructive)"><strong>Gagal memproses OCR:</strong><br>${this.escapeHtml(err.message)}</p>`;
      }
    } finally {
      this.state.isOcrRunning = false;
      this.showOcrProgress(false);
      window.lucide?.createIcons();
    }
  },

  cancelOcr() {
    this.state.ocrAborted = true;
    ocrEngine.abort();
  },

  startInpaint() {
    if (!this.state.imageLoaded) { this.showToast(t('noImage')); return; }
    
    // Reset zoom agar koordinat masker presisi
    this.resetZoom();

    document.getElementById('inpaintOverlay').classList.remove('hidden');
    document.getElementById('inpaintActionBar').classList.remove('hidden');
    this.state.isCropping = true;
    document.getElementById('zoomControls')?.classList.add('hidden');

    inpaint.init();
    inpaint.reset();
  },

  async confirmInpaint() {
    if (!inpaint.maskBounds) {
      this.showToast(t('noImage') || 'Pilih area objek terlebih dahulu');
      this.cancelInpaint();
      return;
    }
    this.saveUndoState();
    const progressEl = document.getElementById('inpaintProgress');
    if (progressEl) progressEl.classList.remove('hidden');

    // Give browser a frame to show progress indicator
    await new Promise(r => setTimeout(r, 20));

    try {
      const success = inpaint.applyInpaint(this.canvas);
      if (!success) {
        this.showToast(t('noImage') || 'Pilih area objek terlebih dahulu');
        return;
      }

      // Update current page with newly inpainted canvas
      const newImg = new Image();
      newImg.src = this.canvas.toDataURL('image/jpeg', 0.95);
      await new Promise(res => { newImg.onload = res; });
      this.setCurrentPageImage(newImg);
      this.showToast(t('removeDone'));
    } catch (err) {
      console.error("Inpaint error:", err);
      this.showToast(t('removeError') + ': ' + err.message);
    } finally {
      if (progressEl) progressEl.classList.add('hidden');
      this.cancelInpaint();
    }
  },

  cancelInpaint() {
    document.getElementById('inpaintOverlay')?.classList.add('hidden');
    document.getElementById('inpaintActionBar')?.classList.add('hidden');
    this.state.isCropping = false;
    inpaint.clear();
    document.getElementById('zoomControls')?.classList.remove('hidden');
  },

  async enhanceHd(scale) {
    if (!this.state.imageLoaded || !this.state.pages[this.state.currentPageIndex]) {
      this.showToast(t('noImage'));
      return;
    }

    let scaleNum = parseFloat(scale) || this.state.upscaleScale;
    if (!scaleNum) {
      // Auto-detect small image (e.g. 300px -> 1200px)
      scaleNum = (Math.max(this.canvas.width, this.canvas.height) <= 400) ? 4.0 : 2.0;
    }
    this.showToast(t('hdEnhancing'));
    await new Promise(r => setTimeout(r, 30));

    try {
      if (!window.MLDetector?.enhanceHD) {
        throw new Error('Fitur ML belum siap');
      }

      this.saveUndoState();

      const oldW = this.canvas.width;
      const oldH = this.canvas.height;

      const mode = this.state.upscaleMode || 'auto';
      const result = await window.MLDetector.enhanceHD(this.canvas, { scale: scaleNum, mode });
      if (!result || !result.canvas) {
        throw new Error('Gagal memproses peningkatan pixel');
      }

      // Update current canvas dimensions and content
      this.canvas.width = result.canvas.width;
      this.canvas.height = result.canvas.height;
      this.ctx.drawImage(result.canvas, 0, 0);

      this.state.canvasWidth = result.canvas.width;
      this.state.canvasHeight = result.canvas.height;
      this.state.logicalWidth = result.canvas.width;
      this.state.logicalHeight = result.canvas.height;

      // Simpan hasil HD tanpa re-compress yang bikin teks "pecah" lagi:
      // PNG untuk kanvas kecil/sedang, JPEG kualitas tinggi hanya untuk kanvas besar.
      // (toDataURL jpeg 0.95 sebelumnya justru menambah ringing di tepi huruf)
      const lossless = (result.width * result.height) <= 2500000;
      const hdDataUrl = lossless
        ? result.canvas.toDataURL('image/png')
        : result.canvas.toDataURL('image/jpeg', 0.97);
      result.canvas.width = 0;
      result.canvas.height = 0;

      const newImg = new Image();
      newImg.src = hdDataUrl;
      await new Promise(res => { newImg.onload = res; });

      // Reset default auto-enhance filters because HD output already has optimal sharpening/contrast baked in
      if (
        this.state.filters.sharpness === config.AUTO_ENHANCE.sharpness &&
        this.state.filters.contrast === config.AUTO_ENHANCE.contrast
      ) {
        this.state.filters.sharpness = 0;
        this.state.filters.contrast = 0;
        this.updateFilterUI();
      }
      const curPage = this.state.pages[this.state.currentPageIndex];
      if (curPage) {
        curPage.w = result.width;
        curPage.h = result.height;
        curPage._filters = { ...this.state.filters };
      }

      this.setCurrentPageImage(newImg);
      this.state.dirty = true;

      const modeLabel = result.mode === 'photo' ? (t('modePhoto') || 'Foto') : (t('modeDoc') || 'Dokumen');
      const msg = `${t('hdDone')} [${modeLabel}] (${oldW}×${oldH} → ${result.width}×${result.height} px, ${result.scale}x)`;
      this.showToast(msg, 'success');
    } catch (err) {
      console.error('HD enhance error:', err);
      this.showToast(t('error') + ': ' + err.message);
    }
  },

  // --- Undo/Redo ---
  // Stack di-scope per halaman: snapshot page 1 tidak boleh dipulihkan ke page 2
  pageUndoStack() {
    const page = this.state.pages[this.state.currentPageIndex];
    if (!page) return null;
    if (!page._undoStack) { page._undoStack = []; page._redoStack = []; }
    return page._undoStack;
  },

  pageRedoStack() {
    const page = this.state.pages[this.state.currentPageIndex];
    if (!page) return null;
    if (!page._undoStack) { page._undoStack = []; page._redoStack = []; }
    return page._redoStack;
  },

  saveUndoState() {
    const page = this.state.pages[this.state.currentPageIndex];
    if (!page || !page.originalImage) return;

    const stateSnapshot = {
      imageData: page.originalImage.src,
      bytes: Math.ceil(page.originalImage.src.length * 0.75),
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
      filters: JSON.parse(JSON.stringify(this.state.filters))
    };

    const undoStack = this.pageUndoStack();
    if (!undoStack) return;
    undoStack.push(stateSnapshot);
    if (undoStack.length > this.state.maxUndoSteps) {
      undoStack.shift(); // Remove oldest
    }
    page._redoStack = []; // Clear redo on new action
    this.trimUndoHistory();
    this.updateUndoRedoUI();
  },

  trimUndoHistory() {
    const maxBytes = config.MAX_UNDO_BYTES;
    const allPages = this.state.pages;
    const history = () => allPages.flatMap((p) => (p._undoStack || []).concat(p._redoStack || []));
    const bytes = (state) => state.bytes || Math.ceil((state.imageData?.length || 0) * 0.75);

    let snapshots = history();
    let totalBytes = snapshots.reduce((sum, state) => sum + bytes(state), 0);
    while (totalBytes > maxBytes && snapshots.length > 1) {
      // buang snapshot tertua dari halaman mana pun
      let oldest = null;
      for (const p of allPages) {
        if (p._undoStack?.length) { oldest = p._undoStack.shift(); break; }
      }
      if (!oldest) {
        for (const p of allPages) {
          if (p._redoStack?.length) { oldest = p._redoStack.shift(); break; }
        }
      }
      if (!oldest) break;
      totalBytes -= bytes(oldest);
      snapshots = history();
    }
  },

  async undo() {
    if (this._importing) return;
    const page = this.state.pages[this.state.currentPageIndex];
    const undoStack = this.pageUndoStack();
    if (!page || !undoStack || undoStack.length === 0) return;

    // Guard: jangan sampai originalImage belum ter-attach (lazy load)
    if (!page.originalImage?.src) return;

    // Save current state to redo stack
    const currentState = {
      imageData: page.originalImage.src,
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
      filters: JSON.parse(JSON.stringify(this.state.filters))
    };
    page._redoStack.push(currentState);

    // Restore previous state
    const prevState = undoStack.pop();
    try {
      await this.restoreState(prevState);
    } catch (err) {
      undoStack.push(prevState);
      page._redoStack.pop();
      this.showToast(t('error') + ': ' + err.message, 'error');
      this.updateUndoRedoUI();
      return;
    }
    this.trimUndoHistory();
    this.updateUndoRedoUI();
  },

  async redo() {
    if (this._importing) return;
    const page = this.state.pages[this.state.currentPageIndex];
    const redoStack = this.pageRedoStack();
    if (!page || !redoStack || redoStack.length === 0) return;

    if (!page.originalImage?.src) return;

    // Save current state to undo stack
    const currentState = {
      imageData: page.originalImage.src,
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
      filters: JSON.parse(JSON.stringify(this.state.filters))
    };
    page._undoStack.push(currentState);

    // Restore next state
    const nextState = redoStack.pop();
    try {
      await this.restoreState(nextState);
    } catch (err) {
      redoStack.push(nextState);
      page._undoStack.pop();
      this.showToast(t('error') + ': ' + err.message, 'error');
      this.updateUndoRedoUI();
      return;
    }
    this.trimUndoHistory();
    this.updateUndoRedoUI();
  },

  async restoreState(state) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const page = this.state.pages[this.state.currentPageIndex];
        if (page) {
          page.originalImage = img;
          page.currentImageData = null;
        }

        // Use the image's natural dimensions for consistent sizing
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        this.canvas.width = w;
        this.canvas.height = h;
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.drawImage(img, 0, 0, w, h);

        this.state.filters = state.filters;
        this.state.canvasWidth = w;
        this.state.canvasHeight = h;
        this.state.logicalWidth = w;
        this.state.logicalHeight = h;
        this.state.imageLoaded = true;

        // Update filter UI and re-apply filters
        this.updateFilterUI();
        this.applyFilters();
        this.resetZoom();
        resolve();
      };
      img.onerror = () => reject(new Error('Gagal memulihkan gambar dari riwayat.'));
      img.src = state.imageData;
    });
  },

  updateFilterUI() {
    const f = this.state.filters;
    const updates = [
      ['filterBrightness', f.brightness, 'brightnessVal'],
      ['filterContrast', f.contrast, 'contrastVal'],
      ['filterSaturation', f.saturation, 'saturationVal'],
      ['filterSharpness', f.sharpness, 'sharpnessVal'],
      ['filterThreshold', f.threshold, 'thresholdVal']
    ];
    updates.forEach(([id, val, valId]) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
      const valEl = document.getElementById(valId);
      if (valEl) valEl.textContent = val;
    });
    document.getElementById('filterGrayscale').checked = f.grayscale;
    document.getElementById('filterSepia').checked = f.sepia;
    document.getElementById('filterInvert').checked = f.invert;
    document.getElementById('filterBW').checked = f.bw;
    const srCheckbox = document.getElementById('filterShadowRemove');
    if (srCheckbox) srCheckbox.checked = !!f.shadowRemove;
    document.getElementById('thresholdGroup').classList.toggle('hidden', !f.bw);
  },

  updateUndoRedoUI() {
    const page = this.state.pages[this.state.currentPageIndex];
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    if (undoBtn) undoBtn.disabled = !page || (page._undoStack?.length || 0) === 0;
    if (redoBtn) redoBtn.disabled = !page || (page._redoStack?.length || 0) === 0;
  },

  // --- PDF Preview ---
  async showPdfPreview() {
    if (this.state.pages.length === 0) return;

    const modal = document.getElementById('pdfPreviewModal');
    const backdrop = document.getElementById('pdfPreviewBackdrop');

    this.releasePdfPreview();
    this._pdfPreviewIndex = 0;
    this._pdfPreviewPageCount = this.state.pages.length;
    try {
      await this.updatePdfPreview();
    } catch (err) {
      console.error('PDF preview error:', err);
      this.showToast(t('error') + ': ' + err.message, 'error');
      return;
    }

    // Navigation
    document.getElementById('pdfPrevPage').onclick = () => {
      if (this._pdfPreviewIndex > 0) {
        this._pdfPreviewIndex--;
        this.updatePdfPreview().catch((err) => this.showToast(err.message, 'error'));
      }
    };
    document.getElementById('pdfNextPage').onclick = () => {
      if (this._pdfPreviewIndex < this._pdfPreviewPageCount - 1) {
        this._pdfPreviewIndex++;
        this.updatePdfPreview().catch((err) => this.showToast(err.message, 'error'));
      }
    };

    // Close
    document.getElementById('closePdfPreview').onclick = () => {
      modal.classList.add('hidden');
      modal.setAttribute('inert', '');
      this.releasePdfPreview();
    };
    backdrop.onclick = () => {
      modal.classList.add('hidden');
      modal.setAttribute('inert', '');
      this.releasePdfPreview();
    };

    // Confirm export → folder Scanner (fallback: browser download)
    const confirmPdfBtn = document.getElementById('confirmPdfExport');
    confirmPdfBtn.onclick = async () => {
      if (this._exporting) return; // guard dobel klik
      this._exporting = true;
      confirmPdfBtn.disabled = true;
      modal.classList.add('hidden');
      modal.setAttribute('inert', '');
      const qualitySlider = document.getElementById('exportQuality');
      const quality = qualitySlider ? parseInt(qualitySlider.value) / 100 : 0.85;
      const base = this.getExportFilename();
      const targetBytes = this.getExportTargetBytes();
      this.toggleSheet('exportSheet', true);
      this.showDlProgress(true, 20, t('downloadProgress'));
      try {
        const pdfOpts = {
          searchable: this.state.searchablePdf !== false,
          getOcrData: (index) => this.getPageOcrData(index)
        };
        const blob = targetBytes > 0
          ? (await pdfExport.toPdfBlobWithTargetSize(
              this._pdfPreviewPageCount,
              (index, maxDim) => this.renderPageForPdf(index, maxDim),
              quality,
              targetBytes,
              pdfOpts
            )).blob
          : await pdfExport.toPdfBlobFromPages(
              this._pdfPreviewPageCount,
              (index) => this.renderPageForPdf(index),
              quality,
              pdfOpts
            );
        const usedFolder = await this.saveFiles([{ name: `${base}.pdf`, blob }]);
        this.showDlProgress(true, 100, t('downloadDone'));
        this.showToast(usedFolder ? t('downloadDone') : t('folderFallback'), 'success');
        this.emit('session:create', {});
        setTimeout(() => {
          this.showDlProgress(false);
          this.toggleSheet('exportSheet', false);
        }, 900);
      } catch (err) {
        console.error('PDF export error:', err);
        this.showDlProgress(false);
        this.toggleSheet('exportSheet', false);
        this.showToast(t('error') + ': ' + err.message, 'error');
      } finally {
        this._exporting = false;
        confirmPdfBtn.disabled = false;
        this.releasePdfPreview();
      }
    };

    modal.classList.remove('hidden');
    modal.removeAttribute('inert');
    window.lucide?.createIcons({ root: modal });
  },

  updatePdfPreview() {
    const previewCanvas = document.getElementById('pdfPreviewCanvas');
    const ctx = previewCanvas.getContext('2d');
    this.releasePdfPreview();
    const pageIndex = this._pdfPreviewIndex;
    const requestId = (this._pdfPreviewRequestId || 0) + 1;
    this._pdfPreviewRequestId = requestId;

    return this.renderPageForPdf(pageIndex, 960).then((currentCanvas) => {
      if (requestId !== this._pdfPreviewRequestId || !currentCanvas) {
        if (currentCanvas) {
          currentCanvas.width = 0;
          currentCanvas.height = 0;
        }
        return;
      }
      previewCanvas.width = currentCanvas.width;
      previewCanvas.height = currentCanvas.height;
      ctx.drawImage(currentCanvas, 0, 0);
      const qualitySlider = document.getElementById('exportQuality');
      const q = qualitySlider ? parseInt(qualitySlider.value) / 100 : 0.85;
      const estimatedSize = Math.round(currentCanvas.width * currentCanvas.height * (0.05 + q * 0.16));
      currentCanvas.width = 0;
      currentCanvas.height = 0;

      document.getElementById('pdfPreviewPageInfo').textContent =
        `${pageIndex + 1}/${this._pdfPreviewPageCount}`;
      document.getElementById('pdfPrevPage').disabled = pageIndex === 0;
      document.getElementById('pdfNextPage').disabled = pageIndex === this._pdfPreviewPageCount - 1;

      const sizeText = estimatedSize > 1024 * 1024
        ? `~${(estimatedSize / (1024 * 1024)).toFixed(1)} MB`
        : `~${Math.round(estimatedSize / 1024)} KB`;
      document.getElementById('pdfPreviewSize').textContent = sizeText;
    });
  },

  releasePdfPreview() {
    this._pdfPreviewRequestId = (this._pdfPreviewRequestId || 0) + 1;
    const previewCanvas = document.getElementById('pdfPreviewCanvas');
    if (previewCanvas) {
      previewCanvas.width = 0;
      previewCanvas.height = 0;
    }
  },

  async renderPageForPdf(index, maxDimension = config.IMAGE_MAX_SIZE) {
    const page = this.state.pages[index];
    if (!page) return null;
    // Filter PER-HALAMAN: dulu filter halaman aktif bocor ke semua halaman.
    // Halaman yang belum pernah difilter memakai snapshot filters-nya sendiri.
    const filters = page._filters || this.state.filters;
    let img = page.originalImage;
    if (!img && page.pendingSrc) {
      img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Gagal memuat halaman ${index + 1}.`));
        image.src = page.pendingSrc;
      });
    }
    if (!img) return null;

    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error(`Canvas halaman ${index + 1} tidak dapat dibuat.`);
    ctx.filter = [
      `brightness(${100 + filters.brightness}%)`,
      `contrast(${100 + filters.contrast}%)`,
      `saturate(${100 + filters.saturation}%)`,
      filters.grayscale ? 'grayscale(100%)' : '',
      filters.sepia ? 'sepia(100%)' : '',
      filters.invert ? 'invert(100%)' : '',
    ].filter(Boolean).join(' ');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    if (filters.shadowRemove && window.MLDetector?.applyShadowRemovalInPlace) {
      window.MLDetector.applyShadowRemovalInPlace(ctx, canvas.width, canvas.height, 1.0);
    }

    if (filters.bw) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const value = avg > filters.threshold ? 255 : 0;
        data[i] = data[i + 1] = data[i + 2] = value;
      }
      ctx.putImageData(imageData, 0, 0);
    }

    // Ketajaman ikut diekspor — sebelumnya halaman yang di-sharpen tampil
    // soft di PDF/JPG karena path ekspor melewati applySharpness
    if (filters.sharpness > 0) {
      try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const sharpened = this._sharpenImageData(imageData, filters.sharpness);
        ctx.putImageData(sharpened, 0, 0);
      } catch (err) {
        console.warn('Export sharpness skipped:', err);
      }
    }
    return canvas;
  },

  /** Convolution sharpen sinkron (tanpa worker) untuk path ekspor. */
  _sharpenImageData(imageData, amount) {
    const { width, height } = imageData;
    const src = imageData.data;
    const out = new ImageData(width, height);
    const dst = out.data;
    const k = amount / 50; // sinkron dengan filter-worker.js
    const center = 1 + 4 * k;
    const neighbor = -k;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const up = y > 0 ? src[i - width * 4 + ch] : src[i + ch];
          const down = y < height - 1 ? src[i + width * 4 + ch] : src[i + ch];
          const left = x > 0 ? src[i - 4 + ch] : src[i + ch];
          const right = x < width - 1 ? src[i + 4 + ch] : src[i + ch];
          dst[i + ch] = Math.max(0, Math.min(255,
            center * src[i + ch] + neighbor * (up + down + left + right)));
        }
        dst[i + 3] = src[i + 3];
      }
    }
    return out;
  },

  getPageOcrData(index) {
    const page = this.state.pages[index];
    if (!page) return null;
    if (page.ocrText || (page.ocrWords && page.ocrWords.length > 0)) {
      return {
        text: page.ocrText || '',
        words: page.ocrWords || [],
        width: page.ocrWidth || page.w || this.canvas.width,
        height: page.ocrHeight || page.h || this.canvas.height
      };
    }
    if (index === this.state.currentPageIndex) {
      const ocrResultDiv = document.getElementById('ocrResult');
      const raw = ocrResultDiv ? ocrResultDiv.innerText.trim() : '';
      const placeholders = [t('processing'), t('ocrStarting'), t('ocrCancelled'), '(Tidak ada teks terdeteksi)', 'Memproses...'];
      if (raw && !placeholders.some(p => raw === p || raw.includes(p))) {
        return { text: raw, words: [], width: this.canvas.width, height: this.canvas.height };
      }
    }
    return null;
  },

  applyFiltersToAllPages() {
    if (this.state.pages.length === 0) {
      this.showToast(t('noImage'));
      return;
    }
    const snapshot = { ...this.state.filters };
    this.state.pages.forEach((p) => {
      p._filters = { ...snapshot };
    });
    this.state.dirty = true;
    this.showToast(t('applyFilterAllDone', this.state.pages.length), 'success');
  },

  async batchAutoCropAllPages() {
    if (this.state.pages.length === 0) {
      this.showToast(t('noImage'));
      return 0;
    }
    this.showToast(t('processing'));
    let croppedCount = 0;
    const total = this.state.pages.length;

    for (let idx = 0; idx < total; idx++) {
      const page = this.state.pages[idx];
      if (!page) continue;
      try {
        let img = page.originalImage;
        if (!img && page.pendingSrc) {
          img = await new Promise((resolve) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => resolve(null);
            im.src = page.pendingSrc;
          });
        }
        if (!img) continue;

        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        const workCanvas = document.createElement('canvas');
        workCanvas.width = w;
        workCanvas.height = h;
        const workCtx = workCanvas.getContext('2d', { willReadFrequently: true });
        workCtx.drawImage(img, 0, 0, w, h);

        let det = null;
        if (page.corners && page.corners.length === 4 && (page.confidence ?? 0) >= 0.3) {
          det = { corners: page.corners, confidence: page.confidence };
        } else {
          det = await deepscan.detect(workCanvas);
        }

        if (det && det.corners && det.corners.length === 4 && (det.confidence ?? 0) >= 0.25) {
          const ordered = (typeof edgeDetection !== 'undefined' && edgeDetection.orderCorners)
            ? edgeDetection.orderCorners(det.corners)
            : det.corners;
          const topW = Math.hypot(ordered[1].x - ordered[0].x, ordered[1].y - ordered[0].y);
          const botW = Math.hypot(ordered[2].x - ordered[3].x, ordered[2].y - ordered[3].y);
          const leftH = Math.hypot(ordered[3].x - ordered[0].x, ordered[3].y - ordered[0].y);
          const rightH = Math.hypot(ordered[2].x - ordered[1].x, ordered[2].y - ordered[1].y);
          const targetW = Math.max(30, Math.round(Math.max(topW, botW)));
          const targetH = Math.max(30, Math.round(Math.max(leftH, rightH)));
          const warped = (typeof edgeDetection !== 'undefined' && edgeDetection.warpPerspective)
            ? edgeDetection.warpPerspective(workCanvas, ordered, targetW, targetH)
            : null;

          if (warped && warped.width >= 20 && warped.height >= 20) {
            if (idx === this.state.currentPageIndex && page.originalImage) {
              this.saveUndoState();
            }
            const dataUrl = warped.toDataURL('image/jpeg', 0.92);
            warped.width = 0;
            warped.height = 0;
            const newImg = await new Promise((resolve) => {
              const im = new Image();
              im.onload = () => resolve(im);
              im.onerror = () => resolve(null);
              im.src = dataUrl;
            });
            if (newImg) {
              page.originalImage = newImg;
              page.pendingSrc = null;
              page.w = newImg.naturalWidth || newImg.width;
              page.h = newImg.naturalHeight || newImg.height;
              page.corners = null;
              croppedCount++;
            }
          }
        }
        workCanvas.width = 0;
        workCanvas.height = 0;
      } catch (err) {
        console.warn('Batch crop error on page', idx, err);
      }
    }

    if (croppedCount > 0) {
      this.state.dirty = true;
      this.renderPage(this.state.currentPageIndex);
      this.updatePagesTray();
    }
    this.showToast(t('batchCropDone', croppedCount, total), croppedCount > 0 ? 'success' : 'info');
    return croppedCount;
  },

  async removeDocumentShadows() {
    if (!this.state.imageLoaded || !this.state.pages[this.state.currentPageIndex]) {
      this.showToast(t('noImage'));
      return false;
    }
    if (!window.MLDetector?.removeShadows) return false;

    this.saveUndoState();
    const res = window.MLDetector.removeShadows(this.canvas, { strength: 1.0 });
    if (!res || !res.canvas) return false;

    this.ctx.drawImage(res.canvas, 0, 0);
    const dataUrl = res.canvas.toDataURL('image/jpeg', 0.95);
    res.canvas.width = 0;
    res.canvas.height = 0;

    const newImg = new Image();
    newImg.src = dataUrl;
    await new Promise(r => { newImg.onload = r; });
    this.setCurrentPageImage(newImg);
    this.state.dirty = true;
    this.showToast(t('shadowRemoveDone'), 'success');
    return true;
  },

  // --- Digital Signature & Watermark Overlay ---
  initSignatureControls() {
    const modal = document.getElementById('signatureModal');
    const pad = document.getElementById('signaturePadCanvas');
    if (!modal || !pad) return;

    const ctx = pad.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.8;
    ctx.strokeStyle = this.state.sigColor || '#0f172a';

    let drawing = false;
    let lastX = 0;
    let lastY = 0;

    const getCoords = (e) => {
      const rect = pad.getBoundingClientRect();
      const clientX = e.touches?.[0]?.clientX ?? e.clientX;
      const clientY = e.touches?.[0]?.clientY ?? e.clientY;
      const scaleX = pad.width / Math.max(1, rect.width);
      const scaleY = pad.height / Math.max(1, rect.height);
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
      };
    };

    const startDraw = (e) => {
      e.preventDefault();
      drawing = true;
      this.state._sigHasInk = true;
      const { x, y } = getCoords(e);
      lastX = x;
      lastY = y;
      ctx.strokeStyle = this.state.sigColor || '#0f172a';
      ctx.fillStyle = this.state.sigColor || '#0f172a';
      ctx.beginPath();
      ctx.arc(x, y, 1.4, 0, Math.PI * 2);
      ctx.fill();
    };

    const moveDraw = (e) => {
      if (!drawing) return;
      e.preventDefault();
      const { x, y } = getCoords(e);
      ctx.strokeStyle = this.state.sigColor || '#0f172a';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(x, y);
      ctx.stroke();
      lastX = x;
      lastY = y;
    };

    const endDraw = () => {
      drawing = false;
    };

    pad.addEventListener('mousedown', startDraw);
    pad.addEventListener('mousemove', moveDraw);
    window.addEventListener('mouseup', endDraw);
    pad.addEventListener('touchstart', startDraw, { passive: false });
    pad.addEventListener('touchmove', moveDraw, { passive: false });
    window.addEventListener('touchend', endDraw);

    // Tab switching
    const tabSig = document.getElementById('tabSignatureBtn');
    const tabWm = document.getElementById('tabWatermarkBtn');
    const paneSig = document.getElementById('sigPaneSignature');
    const paneWm = document.getElementById('sigPaneWatermark');

    tabSig?.addEventListener('click', () => {
      tabSig.classList.add('active');
      tabWm?.classList.remove('active');
      paneSig?.classList.remove('hidden');
      paneWm?.classList.add('hidden');
    });
    tabWm?.addEventListener('click', () => {
      tabWm.classList.add('active');
      tabSig?.classList.remove('active');
      paneWm?.classList.remove('hidden');
      paneSig?.classList.add('hidden');
    });

    // Color pickers
    document.querySelectorAll('.sig-color-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sig-color-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.state.sigColor = btn.dataset.color || '#0f172a';
      });
    });

    document.querySelectorAll('.wm-color-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.wm-color-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.state.wmColor = btn.dataset.color || '#475569';
      });
    });

    const wmOpacity = document.getElementById('watermarkOpacity');
    const wmOpacityVal = document.getElementById('watermarkOpacityVal');
    wmOpacity?.addEventListener('input', () => {
      if (wmOpacityVal) wmOpacityVal.textContent = wmOpacity.value + '%';
    });

    document.getElementById('clearSignatureBtn')?.addEventListener('click', () => this.clearSignaturePad());
    document.getElementById('applySignatureBtn')?.addEventListener('click', () => this.applySignatureToPage());
    document.getElementById('applyWatermarkBtn')?.addEventListener('click', () => this.applyWatermarkToPage());
    document.getElementById('closeSignatureModal')?.addEventListener('click', () => this.closeSignatureModal());
    document.getElementById('signatureBackdrop')?.addEventListener('click', () => this.closeSignatureModal());
  },

  clearSignaturePad() {
    const pad = document.getElementById('signaturePadCanvas');
    if (!pad) return;
    const ctx = pad.getContext('2d');
    ctx.clearRect(0, 0, pad.width, pad.height);
    this.state._sigHasInk = false;
  },

  openSignatureModal() {
    if (!this.state.imageLoaded || !this.state.pages[this.state.currentPageIndex]) {
      this.showToast(t('noImage'));
      return;
    }
    const modal = document.getElementById('signatureModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.removeAttribute('inert');
    window.lucide?.createIcons({ root: modal });
  },

  closeSignatureModal() {
    const modal = document.getElementById('signatureModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('inert', '');
  },

  async applySignatureToPage() {
    if (!this.state.imageLoaded || !this.state.pages[this.state.currentPageIndex]) return;
    const pad = document.getElementById('signaturePadCanvas');
    if (!pad || !this.state._sigHasInk) {
      this.showToast(t('signatureEmpty'), 'warning');
      return;
    }

    this.saveUndoState();
    const pos = document.getElementById('signaturePosition')?.value || 'br';
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const sigW = Math.round(cw * 0.28);
    const sigH = Math.round(sigW * (pad.height / pad.width));
    const margin = Math.max(16, Math.round(Math.min(cw, ch) * 0.04));

    let dx = cw - sigW - margin;
    let dy = ch - sigH - margin;
    if (pos === 'bl') {
      dx = margin;
    } else if (pos === 'bc') {
      dx = Math.round((cw - sigW) / 2);
    } else if (pos === 'cc') {
      dx = Math.round((cw - sigW) / 2);
      dy = Math.round((ch - sigH) / 2);
    }

    const page = this.state.pages[this.state.currentPageIndex];
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = cw;
    baseCanvas.height = ch;
    const bCtx = baseCanvas.getContext('2d');
    if (page?.originalImage) {
      bCtx.drawImage(page.originalImage, 0, 0, cw, ch);
    } else {
      bCtx.drawImage(this.canvas, 0, 0, cw, ch);
    }
    bCtx.drawImage(pad, 0, 0, pad.width, pad.height, dx, dy, sigW, sigH);

    const dataUrl = baseCanvas.toDataURL('image/png');
    baseCanvas.width = 0;
    baseCanvas.height = 0;

    const newImg = new Image();
    newImg.src = dataUrl;
    await new Promise(r => { newImg.onload = r; });
    this.setCurrentPageImage(newImg);
    await this.applyFilters();
    this.state.dirty = true;
    this.closeSignatureModal();
    this.showToast(t('signatureApplied'), 'success');
  },

  async applyWatermarkToPage() {
    if (!this.state.imageLoaded || !this.state.pages[this.state.currentPageIndex]) return;
    const textInput = document.getElementById('watermarkTextInput');
    const wmText = (textInput?.value || '').trim();
    if (!wmText) {
      this.showToast(t('watermarkText'), 'warning');
      return;
    }

    const style = document.getElementById('watermarkStyle')?.value || 'tiled';
    const opacityPct = parseInt(document.getElementById('watermarkOpacity')?.value || '25', 10);
    const alpha = Math.max(0.05, Math.min(0.85, opacityPct / 100));
    const color = this.state.wmColor || '#475569';

    this.saveUndoState();
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const page = this.state.pages[this.state.currentPageIndex];

    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = cw;
    baseCanvas.height = ch;
    const bCtx = baseCanvas.getContext('2d');
    if (page?.originalImage) {
      bCtx.drawImage(page.originalImage, 0, 0, cw, ch);
    } else {
      bCtx.drawImage(this.canvas, 0, 0, cw, ch);
    }

    bCtx.save();
    bCtx.globalAlpha = alpha;
    bCtx.fillStyle = color;
    bCtx.strokeStyle = color;
    bCtx.textAlign = 'center';
    bCtx.textBaseline = 'middle';

    const diag = Math.hypot(cw, ch);
    if (style === 'tiled') {
      const fontSize = Math.max(14, Math.round(Math.min(cw, ch) * 0.045));
      bCtx.font = `700 ${fontSize}px sans-serif`;
      bCtx.translate(cw / 2, ch / 2);
      bCtx.rotate(-Math.PI / 6);
      const stepX = Math.max(fontSize * 6, Math.round( bCtx.measureText(wmText).width + fontSize * 3 ));
      const stepY = Math.max(fontSize * 3.5, Math.round(fontSize * 4));
      for (let y = -diag; y <= diag; y += stepY) {
        for (let x = -diag; x <= diag; x += stepX) {
          bCtx.fillText(wmText, x, y);
        }
      }
    } else if (style === 'single') {
      const fontSize = Math.max(24, Math.round(Math.min(cw, ch) * 0.09));
      bCtx.font = `800 ${fontSize}px sans-serif`;
      bCtx.translate(cw / 2, ch / 2);
      bCtx.rotate(-Math.PI / 6);
      bCtx.fillText(wmText, 0, 0);
    } else if (style === 'stamp') {
      const fontSize = Math.max(18, Math.round(Math.min(cw, ch) * 0.055));
      bCtx.font = `800 ${fontSize}px sans-serif`;
      bCtx.translate(cw / 2, ch / 2);
      bCtx.rotate(-Math.PI / 10);
      const tw = bCtx.measureText(wmText).width;
      const padX = fontSize * 0.8;
      const padY = fontSize * 0.6;
      bCtx.lineWidth = Math.max(3, Math.round(fontSize * 0.14));
      bCtx.strokeRect(-tw / 2 - padX, -fontSize / 2 - padY, tw + padX * 2, fontSize + padY * 2);
      bCtx.fillText(wmText, 0, 0);
    }
    bCtx.restore();

    const dataUrl = baseCanvas.toDataURL('image/png');
    baseCanvas.width = 0;
    baseCanvas.height = 0;

    const newImg = new Image();
    newImg.src = dataUrl;
    await new Promise(r => { newImg.onload = r; });
    this.setCurrentPageImage(newImg);
    await this.applyFilters();
    this.state.dirty = true;
    this.closeSignatureModal();
    this.showToast(t('watermarkApplied'), 'success');
  },

  async renderAllPagesForPdf(maxDimension = config.IMAGE_MAX_SIZE) {
    const canvases = [];
    for (let index = 0; index < this.state.pages.length; index++) {
      const canvas = await this.renderPageForPdf(index, maxDimension);
      if (canvas) canvases.push(canvas);
    }
    return canvases;
  }
};

window.app = app;
window.addEventListener('DOMContentLoaded', () => app.init());
