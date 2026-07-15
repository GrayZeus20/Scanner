const app = {
  state: {
    pages: [],
    currentPageIndex: -1,
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
    zoom: 1,
    panX: 0,
    panY: 0,
    isPanning: false,
    lastPinchDist: 0,
    isCropping: false
  },

  canvas: document.getElementById('mainCanvas'),
  ctx: document.getElementById('mainCanvas').getContext('2d', { willReadFrequently: true }),

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
      el.classList.remove('hidden');
      el.removeAttribute('inert');
      el.setAttribute('aria-hidden', 'false');
      el.setAttribute('aria-expanded', 'true');
      lucide.createIcons({ root: el });
    } else {
      el.classList.add('hidden');
      el.setAttribute('inert', '');
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('aria-expanded', 'false');
      document.activeElement?.blur();
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
    document.getElementById('langSwitcher').value = this.state.lang;
    this.initEventListeners();
    this.syncDarkModeUI();
    camera.bindCaptureHandler();
    lucide.createIcons();
    storage.init().catch(console.warn);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              this.showToast('New version available. Reload to update.');
            }
          });
        });
      }).catch(console.warn);

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    }
  },

  initEventListeners() {
    document.getElementById('langSwitcher').addEventListener('change', (e) => {
      this.state.lang = e.target.value;
      localStorage.setItem('scanner.lang', this.state.lang);
      setLanguage(e.target.value);
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
        Array.from(e.target.files).forEach(file => {
          if (file.type.startsWith('image/')) {
            this.loadFile(file);
          }
        });
        e.target.value = '';
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
      this.setActiveNav(null);
    });

    document.getElementById('navTools').addEventListener('click', () => {
      this.toggleSheet('toolsSheet', true);
      lucide.createIcons();
    });
    document.getElementById('closeToolsSheet').addEventListener('click', () => this.toggleSheet('toolsSheet', false));

    document.getElementById('toolCropBtn').addEventListener('click', () => {
      this.startManualCrop();
      this.toggleSheet('toolsSheet', false);
    });
    document.getElementById('confirmCropBtn').addEventListener('click', () => this.confirmManualCrop());
    document.getElementById('cancelCropBtn').addEventListener('click', () => this.cancelManualCrop());
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
    document.getElementById('confirmInpaintBtn').addEventListener('click', () => this.confirmInpaint());
    document.getElementById('cancelInpaintBtn').addEventListener('click', () => this.cancelInpaint());

    document.getElementById('closeFilterSheet').addEventListener('click', () => this.toggleSheet('filterSheet', false));
    document.getElementById('closeOcrSheet').addEventListener('click', () => {
      this.cancelOcr();
      this.toggleSheet('ocrSheet', false);
    });
    document.getElementById('cancelOcrBtn')?.addEventListener('click', () => {
      this.cancelOcr();
    });

    document.getElementById('navExport').addEventListener('click', () => {
      this.toggleSheet('exportSheet', true);
      lucide.createIcons();
    });
    document.getElementById('closeExportSheet').addEventListener('click', () => this.toggleSheet('exportSheet', false));

    document.getElementById('copyOcrBtn').addEventListener('click', () => {
      const text = document.getElementById('ocrResult').innerText;
      navigator.clipboard.writeText(text).then(() => this.showToast(t('saved')));
    });

    document.getElementById('aiAnalyzeBtn').addEventListener('click', () => this.runAiAnalysis());

    this.initFilterControls();
    this.initExportButtons();
    this.initZoomControls();
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
    document.getElementById('editorArea')?.classList.remove('hidden');
    document.getElementById('bottomNav')?.classList.remove('hidden');
    document.getElementById('emptyState')?.classList.add('hidden');
  },

  syncDarkModeUI() {
    const darkToggle = document.getElementById('darkToggle');
    if (darkToggle) {
      darkToggle.innerHTML = `<i data-lucide="${this.state.darkMode ? 'sun' : 'moon'}" aria-hidden="true"></i>`;
    }
    document.body.classList.toggle('dark-mode', this.state.darkMode);
    lucide.createIcons();
  },

  setCurrentPageImage(image) {
    const page = this.state.pages[this.state.currentPageIndex];
    if (!page) return;
    page.originalImage = image;
    page.currentImageData = null;
  },

  openCamera() {
    camera.stop();
    camera.start();
  },

  loadFile(file) {
    if (!file.type.startsWith('image/')) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      this.loadImageFromSrc(e.target.result);
    };
    reader.readAsDataURL(file);
  },

  loadImageFromSrc(src) {
    const img = new Image();
    img.onload = () => {
      const page = {
        originalImage: img,
        currentImageData: null
      };
      this.state.pages.push(page);
      this.state.currentPageIndex = this.state.pages.length - 1;
      
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
    const MAX_SIZE = 2000;
    
    let w = img.width;
    let h = img.height;
    
    if (w > MAX_SIZE || h > MAX_SIZE) {
      const ratio = Math.min(MAX_SIZE / w, MAX_SIZE / h);
      w = Math.floor(w * ratio);
      h = Math.floor(h * ratio);
    }
    
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    
    // Store logical size for calculations
    this.state.canvasWidth = w;
    this.state.canvasHeight = h;
    this.state.logicalWidth = w;
    this.state.logicalHeight = h;
    
    // Reset transform and set context scale
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    
    // Draw image at logical size (fills buffer proportionally)
    ctx.drawImage(img, 0, 0, w, h);
    
    // Let CSS handle display sizing - no explicit style width/height
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
      
      if (page.originalImage) {
        const img = document.createElement('img');
        img.src = page.originalImage.src;
        img.alt = t('appName') + ' page ' + (idx + 1);
        thumb.appendChild(img);
      } else {
        thumb.innerHTML = `<span>${idx + 1}</span>`;
      }

      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.innerHTML = '<i data-lucide="x-circle" aria-hidden="true"></i>';
      removeBtn.className = 'remove-page-btn';
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        this.deletePage(idx);
      };
      thumb.appendChild(removeBtn);

      thumb.onclick = () => {
        this.renderPage(idx);
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
  },

  initExportButtons() {
    document.querySelectorAll('.export-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const format = btn.dataset.format;
        const canvas = this.canvas;
        if (format === 'pdf') {
          const pagesCanvases = this.state.pages.map(page => {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
            tempCtx.filter = [
              `brightness(${100 + this.state.filters.brightness}%)`,
              `contrast(${100 + this.state.filters.contrast}%)`,
              `saturate(${100 + this.state.filters.saturation}%)`,
              this.state.filters.grayscale ? 'grayscale(100%)' : '',
            ].filter(Boolean).join(' ');
            tempCtx.drawImage(page.originalImage, 0, 0);
            if (this.state.filters.bw) {
              const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
              const data = imageData.data;
              for (let i = 0; i < data.length; i += 4) {
                const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
                const val = avg > this.state.filters.threshold ? 255 : 0;
                data[i] = data[i + 1] = data[i + 2] = val;
              }
              tempCtx.putImageData(imageData, 0, 0);
            }
            return tempCanvas;
          });

          pdfExport.exportToPdf(pagesCanvases).then(() => {
            this.showToast(t('saved'));
            storage.saveScan(canvas, 'multi_scan_' + Date.now()).catch((err) => {
              if (err?.name === 'QuotaExceededError') {
                this.showToast(t('storageFull'));
              } else {
                console.warn(err);
              }
            });
          });
        } else {
          pdfExport.exportToImage(canvas, format);
          storage.saveScan(canvas, 'scan_' + Date.now()).catch((err) => {
            if (err?.name === 'QuotaExceededError') {
              this.showToast(t('storageFull'));
            } else {
              console.warn(err);
            }
          });
        }
        this.toggleSheet('exportSheet', false);
      });
    });
  },

  applyFilters() {
    if (!this.state.imageLoaded) return;
    const page = this.state.pages[this.state.currentPageIndex];
    if (!page || !page.originalImage) return;

    const filters = this.state.filters;
    const canvas = this.canvas;
    const ctx = this.ctx;
    const img = page.originalImage;

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
      this.applySharpness(filters.sharpness);
    }

    page.currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  },

  applySharpness(amount) {
    const ctx = this.ctx;
    const canvas = this.canvas;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const w = canvas.width;
    const h = canvas.height;
    const factor = amount / 50;

    const kernel = [0, -factor, 0, -factor, 1 + 4 * factor, -factor, 0, -factor, 0];
    const output = new Uint8ClampedArray(data);

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          let ki = 0;
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const pidx = ((y + ky) * w + (x + kx)) * 4 + c;
              sum += data[pidx] * kernel[ki++];
            }
          }
          output[idx + c] = Math.min(255, Math.max(0, sum));
        }
      }
    }

    ctx.putImageData(new ImageData(output, w, h), 0, 0);
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
    
    manualCrop.resetCropArea();
    manualCrop.init();
  },

  confirmManualCrop() {
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
      this.state.currentImageData = this.ctx.getImageData(0, 0, canvas.width, canvas.height);
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

  autoCrop() {
    if (!this.state.imageLoaded) {
      this.showToast(t('noImage'));
      return;
    }
    this.showToast(t('processing'));
    setTimeout(() => {
      try {
        const success = edgeDetection.detectAndCrop(this.canvas, this.ctx);
        if (success) {
          const croppedImage = new Image();
          croppedImage.onload = () => {
            this.setCurrentPageImage(croppedImage);
            this.state.canvasWidth = this.canvas.width;
            this.state.canvasHeight = this.canvas.height;
            this.state.currentImageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
            this.state.imageLoaded = true;
            this.showToast(t('cropSuccess'));
            this.applyFilters();
          };
          croppedImage.src = this.canvas.toDataURL();
        } else {
          this.showToast(t('error'));
        }
      } catch (err) {
        console.error('Auto crop failed:', err);
        this.showToast(t('error'));
      }
    }, 100);
  },

  rotate(deg) {
    if (!this.state.imageLoaded) return;

    const canvas = this.canvas;
    const ctx = this.ctx;
    const page = this.state.pages[this.state.currentPageIndex];
    const img = page ? page.originalImage : null;
    if (!img) return;

    let srcW = img.width;
    let srcH = img.height;
    const MAX_SIZE = 2000;
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

    const dpr = window.devicePixelRatio || 1;
    canvas.width = newW * dpr;
    canvas.height = newH * dpr;
    this.state.canvasWidth = newW;
    this.state.canvasHeight = newH;
    this.state.logicalWidth = newW;
    this.state.logicalHeight = newH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    const canvas = this.canvas;
    const ctx = this.ctx;
    const page = this.state.pages[this.state.currentPageIndex];
    const img = page ? page.originalImage : null;
    if (!img) return;

    const MAX_SIZE = 2000;
    let w = img.width;
    let h = img.height;
    if (w > MAX_SIZE || h > MAX_SIZE) {
      const ratio = Math.min(MAX_SIZE / w, MAX_SIZE / h);
      w = Math.floor(w * ratio);
      h = Math.floor(h * ratio);
    }

    const dpr = window.devicePixelRatio || 1;
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

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    this.state.canvasWidth = w;
    this.state.canvasHeight = h;
    this.state.logicalWidth = w;
    this.state.logicalHeight = h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

  async showHistory() {
    const historyList = document.getElementById('historyList');
    historyList.innerHTML = '';
    try {
      const scans = await storage.getHistory();
      scans.forEach(scan => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `
          <img src="${scan.image}" alt="${this.escapeHtml(scan.name)}">
          <div class="history-meta">
            <span>${this.escapeHtml(scan.name)}</span><br>
            <small>${new Date(scan.timestamp).toLocaleString()}</small>
          </div>
          <div class="history-actions">
            <button data-action="load" aria-label="${t('loadScan')}"><i data-lucide="file-edit" aria-hidden="true"></i></button>
            <button data-action="delete" aria-label="${t('deleteScan')}"><i data-lucide="trash-2" aria-hidden="true"></i></button>
          </div>
        `;
        item.querySelector('[data-action="load"]').addEventListener('click', (e) => {
          e.stopPropagation();
          this.loadImageFromSrc(scan.image);
          document.getElementById('historyView').classList.add('hidden');
        });
        item.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm(t('confirmDelete'))) {
            storage.deleteScan(scan.id).then(() => this.showHistory());
          }
        });
        historyList.appendChild(item);
      });
      lucide.createIcons();
      document.getElementById('historyView').classList.remove('hidden');
    } catch (err) {
      console.error(err);
      this.showToast(t('error'));
    }
  },

  showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  },

  async autoEnhance() {
    this.state.filters.sharpness = 30;
    this.state.filters.contrast = 20;
    
    const sharpnessSlider = document.getElementById('filterSharpness');
    if (sharpnessSlider) {
      sharpnessSlider.value = 30;
      document.getElementById('sharpnessVal').textContent = '30';
    }
    const contrastSlider = document.getElementById('filterContrast');
    if (contrastSlider) {
      contrastSlider.value = 20;
      document.getElementById('contrastVal').textContent = '20';
    }
    
    this.applyFilters();
  },

  async runAiAnalysis() {
    const resultDiv = document.getElementById('aiResultArea');
    const btn = document.getElementById('aiAnalyzeBtn');
    const ocrResultDiv = document.getElementById('ocrResult');
    const rawText = ocrResultDiv.innerText.trim();

    // Bersihkan teks placeholder / status yang bukan hasil OCR
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
      let analysis;
      if (!isResultValid) {
        // Tidak ada teks OCR valid → analisis gambar langsung
        analysis = await aiEngine.analyzeCloud('Analisis dokumen ini berdasarkan gambar.', this.canvas.toDataURL());
      } else {
        const localResult = await aiEngine.analyzeLocal(rawText);
        if (aiEngine.isCloudAvailable()) {
          analysis = await aiEngine.analyzeCloud(rawText);
          analysis.structuredData = localResult.structuredData;
        } else {
          analysis = localResult;
        }
      }

      let html = '';
      if (analysis.mode === 'CLOUD') {
        html += `<span class="ai-tag">Cloud AI (Gemini)</span>`;
        html += `<div style="margin-top: 8px; white-space: pre-wrap; border-bottom: 1px solid var(--color-border); padding-bottom: 12px; margin-bottom: 12px;">${this.escapeHtml(analysis.fullAnalysis)}</div>`;
        if (analysis.structuredData) {
          const structuredText = this.escapeHtml(JSON.stringify(analysis.structuredData, null, 2));
          html += `<span class="ai-tag">Data Lokal</span><pre style="font-size: 12px; white-space: pre-wrap; margin-top: 4px; color: var(--color-text-secondary);">${structuredText}</pre>`;
        }
      } else {
        html += `<div style="white-space: pre-wrap;">${this.escapeHtml(analysis.fullAnalysis)}</div>`;
      }
      
      resultDiv.innerHTML = html;
    } catch (err) {
      resultDiv.innerText = 'Error: ' + err.message;
    } finally {
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
    if (!this.state.imageLoaded || !this.state.pages[this.state.currentPageIndex]) {
      this.showToast(t('noImage'));
      return;
    }

    this.toggleSheet('ocrSheet', true);
    lucide.createIcons();
    const resultDiv = document.getElementById('ocrResult');
    resultDiv.innerHTML = `<p><i data-lucide="loader" aria-hidden="true"></i> ${t('ocrStarting')}</p>`;
    document.getElementById('aiResultArea').classList.add('hidden');
    this.showOcrProgress(true);
    this.updateOcrProgress(0);
    this.state.ocrAborted = false;
    lucide.createIcons();

    try {
      const text = await ocrEngine.recognize(this.canvas, (progress) => {
        this.updateOcrProgress(progress);
      }, () => this.state.ocrAborted);
      if (!this.state.ocrAborted) {
        resultDiv.innerText = text || '(No text detected)';
        this.showToast(t('ocrDone'));
      }
    } catch (err) {
      if (this.state.ocrAborted) {
        resultDiv.innerHTML = `<p style="color: var(--color-text-secondary)">${t('ocrCancelled')}</p>`;
      } else {
        resultDiv.innerText = 'Error: ' + err.message;
      }
    } finally {
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
    document.getElementById('inpaintProgress').classList.remove('hidden');
    
    try {
      const srcCanvas = this.canvas;
      const origDataURL = srcCanvas.toDataURL('image/png');
      const maskDataURL = inpaint.getMaskDataURL();
      const workerUrl = aiEngine._workerUrl;

      const response = await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'inpaint',
          image: origDataURL,
          mask: maskDataURL
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown server error' }));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }
      const data = await response.json();
      
      if (!data.image) throw new Error(data.error || 'Inpainting failed');

      const img = new Image();
      img.onload = () => {
        srcCanvas.width = img.width;
        srcCanvas.height = img.height;
        this.ctx.drawImage(img, 0, 0);
        
        this.state.canvasWidth = img.width;
        this.state.canvasHeight = img.height;
        this.state.currentImageData = this.ctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
        this.setCurrentPageImage(img);
        this.showToast(t('removeDone'));
      };
      img.src = data.image.startsWith('data:') ? data.image : 'data:image/png;base64,' + data.image;

    } catch (err) {
      console.error("Inpaint error:", err);
      this.showToast(t('removeError') + ': ' + err.message);
    } finally {
      document.getElementById('inpaintProgress').classList.add('hidden');
      this.cancelInpaint();
    }
  },

  cancelInpaint() {
    document.getElementById('inpaintOverlay')?.classList.add('hidden');
    document.getElementById('inpaintActionBar')?.classList.add('hidden');
    this.state.isCropping = false;
    inpaint.clear();
  }
};

window.addEventListener('DOMContentLoaded', () => app.init());
