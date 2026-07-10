const app = {
  state: {
    pages: [], // Array of { originalImage, currentImageData }
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
    rotation: 0
  },

  canvas: document.getElementById('mainCanvas'),
  ctx: document.getElementById('mainCanvas').getContext('2d'),

  init() {
    this.state.lang = detectLanguage();
    setLanguage(this.state.lang);
    document.getElementById('langSwitcher').value = this.state.lang;
    this.initEventListeners();
    lucide.createIcons();
    storage.init().catch(console.warn);
    
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(console.warn);
    }
  },

  initEventListeners() {
    document.getElementById('langSwitcher').addEventListener('change', (e) => {
      setLanguage(e.target.value);
    });

    document.getElementById('darkToggle').addEventListener('click', () => {
      this.state.darkMode = !this.state.darkMode;
      document.body.classList.toggle('dark-mode', this.state.darkMode);
    });

    document.getElementById('navCamera').addEventListener('click', () => this.openCamera());
    document.getElementById('emptyCamera').addEventListener('click', () => this.openCamera());

    document.getElementById('navImport').addEventListener('click', () => document.getElementById('fileInput').click());
    document.getElementById('emptyImport').addEventListener('click', () => document.getElementById('fileInput').click());

    document.getElementById('fileInput').addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.loadFile(e.target.files[0]);
        e.target.value = '';
      }
    });

    document.getElementById('navHistory').addEventListener('click', () => this.showHistory());
    document.getElementById('closeHistory').addEventListener('click', () => {
      document.getElementById('historyView').classList.add('hidden');
    });

    document.getElementById('navFilter').addEventListener('click', () => {
      document.getElementById('filterSheet').classList.remove('hidden');
      lucide.createIcons();
    });
    document.getElementById('closeFilterSheet').addEventListener('click', () => document.getElementById('filterSheet').classList.add('hidden'));

    document.getElementById('navExport').addEventListener('click', () => {
      document.getElementById('exportSheet').classList.remove('hidden');
      lucide.createIcons();
    });
    document.getElementById('closeExportSheet').addEventListener('click', () => document.getElementById('exportSheet').classList.add('hidden'));

    document.getElementById('navCrop').addEventListener('click', () => this.autoCrop());

    document.getElementById('navOcr').addEventListener('click', () => this.startOcr());
    document.getElementById('closeOcrSheet').addEventListener('click', () => document.getElementById('ocrSheet').classList.add('hidden'));
    document.getElementById('copyOcrBtn').addEventListener('click', () => {
      const text = document.getElementById('ocrResult').innerText;
      navigator.clipboard.writeText(text).then(() => this.showToast(t('saved')));
    });

    this.initFilterControls();
    this.initExportButtons();
  },

  openCamera() {
    camera.start();
  },

  loadFile(file) {
    if (!file.type.startsWith('image/')) {
      this.showToast(t('error'));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => this.loadImageFromSrc(e.target.result);
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
      this.renderPage(this.state.currentPageIndex);
      this.showEditor();
      this.updatePagesTray();
    };
    img.src = src;
  },

  renderImage(img) {
    const canvas = this.canvas;
    const ctx = this.ctx;
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    this.state.currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    this.state.imageLoaded = true;
    this.applyFilters();
  },

  renderPage(index) {
    const page = this.state.pages[index];
    if (!page) return;
    this.renderImage(page.originalImage);
    this.state.currentPageIndex = index;
  },

  updatePagesTray() {
    const tray = document.getElementById('pagesTray');
    tray.innerHTML = '';
    this.state.pages.forEach((page, idx) => {
      const thumb = document.createElement('div');
      thumb.className = `page-thumb ${idx === this.state.currentPageIndex ? 'active' : ''}`;
      thumb.innerHTML = `<span>${idx + 1}</span>`;
      thumb.onclick = () => {
        this.renderPage(idx);
        this.updatePagesTray();
      };
      tray.appendChild(thumb);
    });
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
      const valSpan = document.getElementById(id.replace('filter', '').replace('Val', 'Val') || id + 'Val');
      const valMap = {
        filterBrightness: 'brightnessVal',
        filterContrast: 'contrastVal',
        filterSaturation: 'saturationVal',
        filterSharpness: 'sharpnessVal',
        filterThreshold: 'thresholdVal'
      };

      slider.addEventListener('input', () => {
        this.state.filters[key] = parseFloat(slider.value);
        const valEl = document.getElementById(valMap[id]);
        if (valEl) valEl.textContent = slider.value;
        this.applyFilters();
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
          // Export all pages in the current session to one PDF
          const pagesCanvases = this.state.pages.map(page => {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            const tempCtx = tempCanvas.getContext('2d');
            // Redraw page with filters applied
            tempCtx.filter = [
              `brightness(${100 + this.state.filters.brightness}%)`,
              `contrast(${100 + this.state.filters.contrast}%)`,
              `saturate(${100 + this.state.filters.saturation}%)`,
              this.state.filters.grayscale ? 'grayscale(100%)' : '',
            ].filter(Boolean).join(' ');
            tempCtx.drawImage(page.originalImage, 0, 0);
            // B&W Threshold needs manual pixel processing
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
            storage.saveScan(canvas, 'multi_scan_' + Date.now()).catch(console.warn);
          });
        } else {
          pdfExport.exportToImage(canvas, format);
          storage.saveScan(canvas, 'scan_' + Date.now()).catch(console.warn);
        }
        document.getElementById('exportSheet').classList.add('hidden');
      });
    });
  },

  applyFilters() {
    if (!this.state.imageLoaded) return;
    const filters = this.state.filters;
    const canvas = this.canvas;
    const ctx = this.ctx;
    const img = this.state.pages[this.state.currentPageIndex].originalImage;

    ctx.filter = [
      `brightness(${100 + filters.brightness}%)`,
      `contrast(${100 + filters.contrast}%)`,
      `saturate(${100 + filters.saturation}%)`,
      filters.grayscale ? 'grayscale(100%)' : '',
      filters.sepia ? 'sepia(100%)' : '',
      filters.invert ? 'invert(100%)' : '',
    ].filter(Boolean).join(' ');

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

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

    this.state.pages[this.state.currentPageIndex].currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
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

  autoCrop() {
    if (!this.state.imageLoaded) {
      this.showToast(t('noImage'));
      return;
    }
    this.showToast(t('processing'));
    setTimeout(() => {
      const success = edgeDetection.detectAndCrop(this.canvas, this.ctx);
      if (success) {
        this.state.canvasWidth = this.canvas.width;
        this.state.canvasHeight = this.canvas.height;
        this.state.currentImageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        this.showToast(t('cropSuccess'));
        this.applyFilters();
      } else {
        this.showToast(t('error'));
      }
    }, 100);
  },

  rotate(deg) {
    if (!this.state.imageLoaded) return;
    this.state.rotation = (this.state.rotation + deg) % 360;

    const canvas = this.canvas;
    const ctx = this.ctx;
    const img = this.state.originalImage;

    const radians = (this.state.rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const newW = Math.ceil(img.width * cos + img.height * sin);
    const newH = Math.ceil(img.width * sin + img.height * cos);

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = newW;
    tempCanvas.height = newH;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.translate(newW / 2, newH / 2);
    tempCtx.rotate(radians);
    tempCtx.drawImage(img, -img.width / 2, -img.height / 2);

    canvas.width = newW;
    canvas.height = newH;
    ctx.drawImage(tempCanvas, 0, 0);
    this.state.originalImage = new Image();
    this.state.originalImage.src = tempCanvas.toDataURL();
    this.state.originalImage.onload = () => {
      this.state.canvasWidth = canvas.width;
      this.state.canvasHeight = canvas.height;
      this.applyFilters();
    };
  },

  flip(direction) {
    if (!this.state.imageLoaded) return;
    const canvas = this.canvas;
    const ctx = this.ctx;
    const img = this.state.originalImage;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');

    if (direction === 'horizontal') {
      tempCtx.translate(canvas.width, 0);
      tempCtx.scale(-1, 1);
    } else {
      tempCtx.translate(0, canvas.height);
      tempCtx.scale(1, -1);
    }
    tempCtx.drawImage(img, 0, 0);

    ctx.drawImage(tempCanvas, 0, 0);
    this.state.originalImage = new Image();
    this.state.originalImage.src = tempCanvas.toDataURL();
    this.state.originalImage.onload = () => this.applyFilters();
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
          <img src="${scan.image}" alt="${scan.name}">
          <div class="history-meta">
            <span>${scan.name}</span><br>
            <small>${new Date(scan.timestamp).toLocaleString()}</small>
          </div>
          <div class="history-actions">
            <button data-action="load"><i data-lucide="file-edit"></i></button>
            <button data-action="delete"><i data-lucide="trash-2"></i></button>
          </div>
        `;
        item.querySelector('[data-action="load"]').addEventListener('click', (e) => {
          e.stopPropagation();
          this.loadImageFromSrc(scan.image);
          document.getElementById('historyView').classList.add('hidden');
        });
        item.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
          e.stopPropagation();
          storage.deleteScan(scan.id).then(() => this.showHistory());
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
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  },

  async startOcr() {
    document.getElementById('ocrSheet').classList.remove('hidden');
    lucide.createIcons();
    const resultDiv = document.getElementById('ocrResult');
    resultDiv.innerHTML = `<p><i data-lucide="loader"></i> ${t('processing')}</p>`;
    lucide.createIcons();
    
    try {
      const text = await ocrEngine.recognize(this.canvas);
      resultDiv.innerText = text || '(No text detected)';
      this.showToast(t('ocrDone'));
    } catch (err) {
      resultDiv.innerText = 'Error: ' + err.message;
    }
  }
};

window.addEventListener('DOMContentLoaded', () => app.init());
