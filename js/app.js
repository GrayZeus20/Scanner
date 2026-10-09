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
      threshold: 128
    },
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
    undoStack: [],
    redoStack: [],
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
      sessionsCount: this.state.sessionsCache.length
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
      // Create backdrop
      const backdrop = document.createElement('div');
      backdrop.className = 'sheet-backdrop';
      backdrop.id = 'sheetBackdrop';
      backdrop.addEventListener('click', () => this.toggleSheet(id, false));
      document.body.appendChild(backdrop);

      el.classList.remove('hidden');
      el.removeAttribute('inert');
      el.setAttribute('aria-hidden', 'false');
      el.setAttribute('aria-expanded', 'true');
      lucide.createIcons({ root: el });

      // Focus first interactive element
      const firstFocusable = el.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (firstFocusable) firstFocusable.focus();
    } else {
      // Exit animation
      el.classList.add('sheet-exit');
      const backdrop = document.getElementById('sheetBackdrop');
      if (backdrop) backdrop.classList.add('backdrop-exit');

      setTimeout(() => {
        el.classList.remove('sheet-exit');
        el.classList.add('hidden');
        el.setAttribute('inert', '');
        el.setAttribute('aria-hidden', 'true');
        el.setAttribute('aria-expanded', 'false');
        document.activeElement?.blur();

        // Remove backdrop
        const bd = document.getElementById('sheetBackdrop');
        if (bd) bd.remove();
      }, 200);
    }
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
    lucide.createIcons();
    this.registerEvents();
    storage.init().then(async () => {
      // One-time migration: legacy per-image scans → sessions
      try {
        const [sessions, legacy] = await Promise.all([storage.getSessions(), storage.getHistory()]);
        if (sessions.length === 0 && legacy.length > 0) {
          await storage.legacyMigrateToSessions();
        }
        const after = await storage.getSessions();
        if (after.length > 0) this.showHome();
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

    // PWA shortcut navigation actions
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const action = urlParams.get('action');
      if (action === 'camera') {
        setTimeout(() => this.openCamera(), 350);
      } else if (action === 'import') {
        setTimeout(() => document.getElementById('fileInput')?.click(), 350);
      }
    } catch (_) {}
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
        lucide.createIcons();
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

    // Network status listener
    window.addEventListener('offline', () => {
      this.showToast(t('offlineActive') || 'Mode offline aktif', 'warning');
      document.getElementById('offlineBadge')?.classList.remove('hidden');
    });
    window.addEventListener('online', () => {
      this.showToast(t('onlineActive') || 'Kembali online', 'info');
      document.getElementById('offlineBadge')?.classList.add('hidden');
    });
    if (!navigator.onLine) {
      document.getElementById('offlineBadge')?.classList.remove('hidden');
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
      if (sessionPages.length > 30) { this.showToast(t('sessionFull'), 'error'); return null; }
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
      lucide.createIcons();
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
      lucide.createIcons();
    });
    document.getElementById('toolOcrBtn').addEventListener('click', () => {
      this.startOcr();
      this.toggleSheet('toolsSheet', false);
    });
    document.getElementById('toolInpaintBtn').addEventListener('click', () => {
      this.startInpaint();
      this.toggleSheet('toolsSheet', false);
    });
    document.getElementById('toolHdEnhanceBtn')?.addEventListener('click', () => {
      this.enhanceHd(this.state.upscaleScale || 2.0);
      this.toggleSheet('toolsSheet', false);
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
      lucide.createIcons();
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

    this.initFilterControls();
    this.initExportButtons();
    this.initZoomControls();
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
      div.onclick = () => { this.state.currentPageIndex = idx; if (page.pendingSrc) this.renderPendingPage(idx); else this.renderPage(idx); this.renderDlPreviewStrip(); };
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

    // --- Touch events with inertia ---
    let lastDist = 0;

    wrapper.addEventListener('touchstart', (e) => {
      if (isInteractive(e)) return;
      if (this.state.isCropping) return;
      stopInertia();
      if (e.touches.length === 2) {
        lastDist = this.getTouchDistance(e.touches);
      } else if (e.touches.length === 1) {
        this.state.isPanning = true;
        this.state.panStartX = e.touches[0].clientX - this.state.panX;
        this.state.panStartY = e.touches[0].clientY - this.state.panY;
        lastMoveX = e.touches[0].clientX;
        lastMoveY = e.touches[0].clientY;
        lastMoveTime = performance.now();
      }
    }, { passive: true });

    wrapper.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        if (this.state.isCropping) return;
        e.preventDefault();
        const dist = this.getTouchDistance(e.touches);
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
    this.showToast(`Zoom: ${Math.round(this.state.zoom * 100)}%`);
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
    lucide.createIcons();
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
    camera.start();
  },

  /**
   * DeepScan batch import: validate → detect → load pages → one new session.
   */
  async importBatch(files) {
    if (!files || files.length === 0) return;
    const images = files.filter((f) => f.type.startsWith('image/'));
    const rejected = files.length - images.length;

    if (images.length === 0) {
      this.showToast(files[0]?.type === 'application/pdf' ? t('pdfNotSupported') : t('unsupportedFile'), 'error');
      return;
    }

    this.showToast(t('processing'));

    // ponytail: autoCrop warp off on import — keeps original dims (crop.spec floor); flip true + adjust tests if auto-warp on import wanted
    const { pages, errors } = await deepscan.batchImport(images, { autoCrop: false, createSession: false });

    // If editor already has an open unsaved doc, guard before appending new pages
    if (this.state.pages.length > 0 && this.state.dirty) {
      this._pendingBatch = pages;
      this.showSessionGuard(pages.length, { mode: 'import' });
      return;
    }

    this._applyBatch(pages, errors, rejected);
  },

  _applyBatch(pages, errors, rejected = 0) {
    if (pages.length === 0) {
      this.showToast(errors[0]?.error || t('unsupportedFile'), 'error');
      return;
    }

    // Append: batch adds pages into current working doc (1 sesi = semua gambar kerja)
    const startIdx = this.state.pages.length;
    pages.forEach((p) => {
      this.state.pages.push({ originalImage: null, currentImageData: null, name: p.name, pendingSrc: p.image, w: p.w, h: p.h });
    });
    this.state.currentPageIndex = startIdx;
    this.state.dirty = true;

    if (this.state.pages.length > 30) {
      this.state.pages.splice(30);
      this.showToast(t('sessionFull'), 'error');
    }

    this.showEditor();
    this.updatePagesTray();
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
      this.loadImageFromSrc(page.pendingSrc, { keepSession: true, index });
    } else if (page.originalImage) {
      this.renderPage(index);
    }
  },

  loadImageFromSrc(src, opts = {}) {
    const img = new Image();
    img.onload = async () => {
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
        this.state.activeSessionId = null;
      }

      this.showEditor();
      this.updatePagesTray();

      try {
        this.renderPage(this.state.currentPageIndex);
        this.autoEnhance();
      } catch (err) {
        console.error('Render error:', err);
        this.showToast(t('error'));
      }
    };
    img.onerror = () => this.showToast(t('error'));
    img.src = src;
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
    if (!page.originalImage) { this.renderPendingPage(index); return; }
    this.renderImage(page.originalImage);
    this.state.currentPageIndex = index;
    this.resetZoom();
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

    lucide.createIcons({ root: tray });

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

  async pickDownloadFolder() {
    if (!window.showDirectoryPicker) {
      this.showToast(t('folderFallback'), 'warning');
      return;
    }
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

  /** Write jobs [{name, blob}] into Scanner/ folder; anchor fallback. Returns true if folder write used. */
  async saveFiles(jobs) {
    const handle = await storage.getDirHandle().catch(() => null);
    if (handle && window.showDirectoryPicker) {
      try {
        if (handle.queryPermission) {
          let perm = await handle.queryPermission({ mode: 'readwrite' });
          if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'readwrite' });
          if (perm !== 'granted') throw new Error('permission-denied');
        }
        const dir = await handle.getDirectoryHandle(config.DOWNLOAD.dirName, { create: true });
        let i = 0;
        for (const job of jobs) {
          const fh = await dir.getFileHandle(job.name, { create: true });
          const writer = await fh.createWritable();
          await writer.write(job.blob);
          await writer.close();
          i++;
          this.showDlProgress(true, Math.round((i / jobs.length) * 100), t('downloadProgress'));
        }
        return true;
      } catch (err) {
        if (err?.name === 'AbortError') return false;
        console.warn('Folder write failed, falling back to browser download:', err);
      }
    }
    jobs.forEach((job) => pdfExport._downloadBlob(job.blob, 'Scanner-' + job.name));
    return false;
  },

  async performExport(format) {
    if (this.state.pages.length === 0) { this.showToast(t('noPagesYet'), 'error'); return; }
    const qualitySlider = document.getElementById('exportQuality');
    const quality = qualitySlider ? parseInt(qualitySlider.value) / 100 : 0.85;
    const base = `${this.sessionLabel()}_${new Date().toISOString().slice(0, 10)}`;

    this.showDlProgress(true, 10, t('downloadProgress'));
    try {
      let jobs = [];
      if (format === 'pdf' || format === 'batchPdf') {
        const canvases = await this.renderAllPagesForPdf();
        const blob = await pdfExport.toPdfBlob(canvases, quality);
        jobs = [{ name: `${base}.pdf`, blob }];
      } else if (format === 'batchJpg') {
        const canvases = await this.renderAllPagesForPdf();
        jobs = canvases.map((c, i) => ({
          name: `${base}_p${i + 1}.jpg`,
          blob: pdfExport.toImageBlob(c, 'jpg', quality)
        }));
      } else if (format === 'png') {
        jobs = [{ name: `${base}.png`, blob: pdfExport.toImageBlob(this.canvas, 'png', quality) }];
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
    }
  },

  async shareDoc() {
    if (!navigator.share) {
      this.showToast(t('error'));
      return;
    }
    try {
      const blob = await new Promise(r => this.canvas.toBlob(r, 'image/jpeg', 0.92));
      if (!blob) throw new Error('Failed to generate image');
      const file = new File([blob], 'scan_' + Date.now() + '.jpg', { type: 'image/jpeg' });
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
    }
  },

  async applyFilters() {
    if (!this.state.imageLoaded) return;
    if (this._filterPending) return;
    this._filterPending = true;
    try {
      const page = this.state.pages[this.state.currentPageIndex];
      if (!page || !page.originalImage) return;

      const filters = this.state.filters;
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
        await this.applySharpness(filters.sharpness);
      }

      page.currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } finally {
      this._filterPending = false;
    }
  },

  async applySharpness(amount) {
    if (this.state.isFilterWorkerRunning) return;
    this.state.isFilterWorkerRunning = true;

    // Add progress UI
    const progressEl = document.getElementById('filterProgress');
    const progressFill = document.getElementById('filterProgressBar');
    if (progressEl) progressEl.classList.remove('hidden');

    const worker = new Worker('js/filter-worker.js');
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

    return new Promise((resolve) => {
      worker.onmessage = (e) => {
        if (e.data.progress !== undefined) {
          if (progressFill) progressFill.style.width = e.data.progress + '%';
          return;
        }

        const output = new ImageData(e.data.output, this.canvas.width, this.canvas.height);
        this.ctx.putImageData(output, 0, 0);
        this.state.isFilterWorkerRunning = false;
        if (progressEl) progressEl.classList.add('hidden');
        worker.terminate();
        resolve();
      };

      worker.onerror = (err) => {
        console.error('Filter worker error:', err);
        this.state.isFilterWorkerRunning = false;
        if (progressEl) progressEl.classList.add('hidden');
        worker.terminate();
        resolve();
      };

      worker.postMessage({
        data: imageData.data,
        width: this.canvas.width,
        height: this.canvas.height,
        amount
      }, [imageData.data.buffer]);
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
    
    manualCrop.init();
    manualCrop.resetCropArea();
  },

  confirmManualCrop() {
    this.saveUndoState();
    const croppedCanvas = manualCrop.cropQuadrilateral();
    const canvas = this.canvas;

    if (!croppedCanvas || croppedCanvas.width < 10 || croppedCanvas.height < 10) {
      this.showToast(t('cropTooSmall'));
      return;
    }

    try {
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
      grayscale: false, sepia: false, invert: false, bw: false, threshold: 128
    };
    document.getElementById('filterBrightness').value = 0;
    document.getElementById('filterContrast').value = 0;
    document.getElementById('filterSaturation').value = 0;
    document.getElementById('filterSharpness').value = 0;
    document.getElementById('filterGrayscale').checked = false;
    document.getElementById('filterSepia').checked = false;
    document.getElementById('filterInvert').checked = false;
    document.getElementById('filterBW').checked = false;
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
    document.getElementById('historyView').classList.remove('hidden');
    this.setActiveNav('navHistory');
    this.renderHome();
  },

  renderHome() {
    const list = document.getElementById('historyList');
    const empty = document.getElementById('historyEmpty');
    if (!list) return;
    const sessions = this.state.sessionsCache;
    list.innerHTML = '';

    if (sessions.length === 0) {
      empty?.classList.remove('hidden');
      lucide.createIcons({ root: document.getElementById('historyView') });
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
    lucide.createIcons({ root: list });
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
    const modal = document.getElementById('sessionGuardModal');
    modal.classList.remove('hidden');
    modal.removeAttribute('inert');
    lucide.createIcons({ root: modal });
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
      this.state.undoStack = [];
      this.state.redoStack = [];
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
      grayscale: false, sepia: false, invert: false, bw: false, threshold: 128
    };
    this.updateFilterUI();
  },

  startNewSession() {
    this.state.pages = [];
    this.state.currentPageIndex = -1;
    this.state.activeSessionId = null;
    this.state.dirty = false;
    this.state.undoStack = [];
    this.state.redoStack = [];
    this.updateUndoRedoUI();
    this.resetFiltersSilent();
    document.getElementById('historyView').classList.add('hidden');
    document.getElementById('editorArea')?.classList.add('hidden');
    document.getElementById('bottomNav')?.classList.add('hidden');
    document.getElementById('emptyState')?.classList.remove('hidden');
    this.setActiveNav(null);
  },

  bindSessionGuard() {
    const save = async () => {
      const pending = this._guardPending;
      const batch = this._pendingBatch;
      this.closeSessionGuard();
      if (!pending) return;
      await this.emit('session:create', {});
      if (pending.mode === 'open') this.openSession(pending.id);
      else if (pending.mode === 'new') this.startNewSession();
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
      else if (pending.mode === 'import') {
        this.state.pages = [];
        this.state.activeSessionId = null;
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
    lucide.createIcons();
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
      lucide.createIcons();
    } catch (err) {
      resultDiv.innerHTML = `<div style="color: var(--color-destructive);"><strong>Error:</strong> ${this.escapeHtml(err.message)}</div>`;
    } finally {
      this.state.isAnalyzing = false;
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="sparkles" aria-hidden="true"></i> ${t('aiAnalyze')}`;
      lucide.createIcons();
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
    lucide.createIcons();
    const resultDiv = document.getElementById('ocrResult');
    resultDiv.innerHTML = `<p><i data-lucide="loader" aria-hidden="true"></i> ${t('ocrStarting')}</p>`;
    document.getElementById('aiResultArea').classList.add('hidden');
    this.showOcrProgress(true);
    this.updateOcrProgress(0);
    this.state.ocrAborted = false;
    lucide.createIcons();

    const langSelect = document.getElementById('ocrLangSelect');
    const selectedLang = langSelect ? langSelect.value : 'ind+eng';

    try {
      const text = await ocrEngine.recognize(this.canvas, (progress) => {
        this.updateOcrProgress(progress);
      }, () => this.state.ocrAborted, selectedLang);
      if (!this.state.ocrAborted) {
        resultDiv.innerText = text || '(Tidak ada teks terdeteksi)';
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
      lucide.createIcons();
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

    inpaint.init();
    inpaint.reset();
  },

  async confirmInpaint() {
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

      const result = await window.MLDetector.enhanceHD(this.canvas, { scale: scaleNum });
      if (!result || !result.canvas) {
        throw new Error('Gagal memproses peningkatan pixel');
      }

      // Update current canvas dimensions and content
      this.canvas.width = result.canvas.width;
      this.canvas.height = result.canvas.height;
      this.ctx.drawImage(result.canvas, 0, 0);

      this.state.canvasWidth = result.canvas.width;
      this.state.canvasHeight = result.canvas.height;

      // Update page original image and thumbnails
      const newImg = new Image();
      newImg.src = result.canvas.toDataURL('image/jpeg', 0.95);
      await new Promise(res => { newImg.onload = res; });
      this.setCurrentPageImage(newImg);

      const msg = `${t('hdDone')} (${oldW}×${oldH} → ${result.width}×${result.height} px, ${result.scale}x)`;
      this.showToast(msg, 'success');
    } catch (err) {
      console.error('HD enhance error:', err);
      this.showToast(t('error') + ': ' + err.message);
    }
  },

  // --- Undo/Redo ---
  saveUndoState() {
    const page = this.state.pages[this.state.currentPageIndex];
    if (!page || !page.originalImage) return;

    const stateSnapshot = {
      imageData: page.originalImage.src,
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
      filters: JSON.parse(JSON.stringify(this.state.filters))
    };

    this.state.undoStack.push(stateSnapshot);
    if (this.state.undoStack.length > this.state.maxUndoSteps) {
      this.state.undoStack.shift(); // Remove oldest
    }
    this.state.redoStack = []; // Clear redo on new action
    this.updateUndoRedoUI();
  },

  async undo() {
    if (this.state.undoStack.length === 0) return;

    const page = this.state.pages[this.state.currentPageIndex];
    if (!page) return;

    // Save current state to redo stack
    const currentState = {
      imageData: page.originalImage.src,
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
      filters: JSON.parse(JSON.stringify(this.state.filters))
    };
    this.state.redoStack.push(currentState);

    // Restore previous state
    const prevState = this.state.undoStack.pop();
    await this.restoreState(prevState);
    this.updateUndoRedoUI();
  },

  async redo() {
    if (this.state.redoStack.length === 0) return;

    const page = this.state.pages[this.state.currentPageIndex];
    if (!page) return;

    // Save current state to undo stack
    const currentState = {
      imageData: page.originalImage.src,
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
      filters: JSON.parse(JSON.stringify(this.state.filters))
    };
    this.state.undoStack.push(currentState);

    // Restore next state
    const nextState = this.state.redoStack.pop();
    await this.restoreState(nextState);
    this.updateUndoRedoUI();
  },

  async restoreState(state) {
    return new Promise((resolve) => {
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
    document.getElementById('thresholdGroup').classList.toggle('hidden', !f.bw);
  },

  updateUndoRedoUI() {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    if (undoBtn) undoBtn.disabled = this.state.undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = this.state.redoStack.length === 0;
  },

  // --- PDF Preview ---
  async showPdfPreview() {
    if (this.state.pages.length === 0) return;

    const modal = document.getElementById('pdfPreviewModal');
    const backdrop = document.getElementById('pdfPreviewBackdrop');
    const previewCanvas = document.getElementById('pdfPreviewCanvas');
    const ctx = previewCanvas.getContext('2d');

    this._pdfPreviewIndex = 0;
    this._pdfPreviewCanvases = await this.renderAllPagesForPdf();

    // Show first page
    this.updatePdfPreview();

    // Navigation
    document.getElementById('pdfPrevPage').onclick = () => {
      if (this._pdfPreviewIndex > 0) {
        this._pdfPreviewIndex--;
        this.updatePdfPreview();
      }
    };
    document.getElementById('pdfNextPage').onclick = () => {
      if (this._pdfPreviewIndex < this._pdfPreviewCanvases.length - 1) {
        this._pdfPreviewIndex++;
        this.updatePdfPreview();
      }
    };

    // Close
    document.getElementById('closePdfPreview').onclick = () => {
      modal.classList.add('hidden');
      modal.setAttribute('inert', '');
    };
    backdrop.onclick = () => {
      modal.classList.add('hidden');
      modal.setAttribute('inert', '');
    };

    // Confirm export → folder Scanner (fallback: browser download)
    document.getElementById('confirmPdfExport').onclick = async () => {
      modal.classList.add('hidden');
      modal.setAttribute('inert', '');
      const qualitySlider = document.getElementById('exportQuality');
      const quality = qualitySlider ? parseInt(qualitySlider.value) / 100 : 0.85;
      const base = `${this.sessionLabel()}_${new Date().toISOString().slice(0, 10)}`;
      this.toggleSheet('exportSheet', true);
      this.showDlProgress(true, 20, t('downloadProgress'));
      try {
        const blob = await pdfExport.toPdfBlob(this._pdfPreviewCanvases, quality);
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
        this.showToast(t('error'), 'error');
      }
    };

    modal.classList.remove('hidden');
    modal.removeAttribute('inert');
    lucide.createIcons({ root: modal });
  },

  updatePdfPreview() {
    const previewCanvas = document.getElementById('pdfPreviewCanvas');
    const ctx = previewCanvas.getContext('2d');
    const currentCanvas = this._pdfPreviewCanvases[this._pdfPreviewIndex];

    previewCanvas.width = currentCanvas.width;
    previewCanvas.height = currentCanvas.height;
    ctx.drawImage(currentCanvas, 0, 0);

    // Update page info
    document.getElementById('pdfPreviewPageInfo').textContent =
      `${this._pdfPreviewIndex + 1}/${this._pdfPreviewCanvases.length}`;

    // Update buttons
    document.getElementById('pdfPrevPage').disabled = this._pdfPreviewIndex === 0;
    document.getElementById('pdfNextPage').disabled =
      this._pdfPreviewIndex === this._pdfPreviewCanvases.length - 1;

    // Estimate size (rough JPEG estimate)
    const estimatedSize = Math.round(currentCanvas.width * currentCanvas.height * 0.15);
    const sizeText = estimatedSize > 1024 * 1024
      ? `~${(estimatedSize / (1024 * 1024)).toFixed(1)} MB`
      : `~${Math.round(estimatedSize / 1024)} KB`;
    document.getElementById('pdfPreviewSize').textContent = sizeText;
  },

  async renderAllPagesForPdf() {
    const filters = this.state.filters;
    const loadPage = async (page) => {
      let img = page.originalImage;
      if (!img && page.pendingSrc) {
        img = await new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = page.pendingSrc;
        });
        page.originalImage = img;
        page.pendingSrc = null;
      }
      if (!img) return null;
      const tempCanvas = document.createElement('canvas');
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      tempCanvas.width = w;
      tempCanvas.height = h;
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      tempCtx.filter = [
        `brightness(${100 + filters.brightness}%)`,
        `contrast(${100 + filters.contrast}%)`,
        `saturate(${100 + filters.saturation}%)`,
        filters.grayscale ? 'grayscale(100%)' : '',
        filters.sepia ? 'sepia(100%)' : '',
        filters.invert ? 'invert(100%)' : '',
      ].filter(Boolean).join(' ');
      tempCtx.drawImage(img, 0, 0, w, h);

      if (filters.bw) {
        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
          const val = avg > filters.threshold ? 255 : 0;
          data[i] = data[i + 1] = data[i + 2] = val;
        }
        tempCtx.putImageData(imageData, 0, 0);
      }
      return tempCanvas;
    };
    const canvases = await Promise.all(this.state.pages.map(loadPage));
    return canvases.filter(Boolean);
  }
};

window.app = app;
window.addEventListener('DOMContentLoaded', () => app.init());
