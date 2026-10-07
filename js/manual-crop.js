const manualCrop = {
  overlay: null,
  area: null,
  magnifier: null,
  wrapper: null,
  canvas: null,
  handleOffset: 27, // 54px handle / 2 = 27px offset untuk center

  // Aspect ratio presets: null = free, number = w/h ratio
  RATIO_MAP: { free: null, '1:1': 1, '3:4': 3 / 4, a4: 210 / 297 },
  lockedRatio: null,

  // Rotation state
  _rotation: 0,

  state: {
    resizing: false,
    activeCorner: null,
    startX: 0,
    startY: 0,
    initialCorners: {},
    corners: { tl: {x: 0, y: 0}, tr: {x: 0, y: 0}, bl: {x: 0, y: 0}, br: {x: 0, y: 0} }
  },

  // Cache bounding rect untuk menghindari layout thrashing
  _cache: { canvasRect: null, wrapperRect: null, areaLeft: 0, areaTop: 0 },

  _updateCache() {
    if (!this.canvas || !this.wrapper || !this.area) return;
    this._cache.canvasRect = this.canvas.getBoundingClientRect();
    this._cache.wrapperRect = this.wrapper.getBoundingClientRect();
    this._cache.areaLeft = parseFloat(this.area.style.left) || 0;
    this._cache.areaTop = parseFloat(this.area.style.top) || 0;
  },

  init() {
    this.overlay = document.getElementById('cropOverlay');
    this.area = document.getElementById('cropArea');
    this.magnifier = document.getElementById('cropMagnifier');
    this.wrapper = document.getElementById('canvasWrapper');
    this.canvas = document.getElementById('mainCanvas');

    if (!this.area || this.initialized) return;
    this.initialized = true;

    this.area.querySelectorAll('.crop-handle').forEach(handle => {
      handle.addEventListener('mousedown', (e) => this.onCornerStart(e));
      handle.addEventListener('touchstart', (e) => this.onCornerStart(e), { passive: false });
    });

    document.addEventListener('mousemove', (e) => this.onMove(e));
    document.addEventListener('touchmove', (e) => this.onMove(e), { passive: false });
    document.addEventListener('mouseup', () => this.onEnd());
    document.addEventListener('touchend', () => this.onEnd());

    // Rotation button in action bar
    const rotateBtn = document.getElementById('cropRotateBtn');
    if (rotateBtn) {
      rotateBtn.addEventListener('click', () => this.rotateStep());
    }
    const resetBtn = document.getElementById('resetCropBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => this.resetCropArea());
    }
  },

  rotateStep() {
    this._rotation = (this._rotation + 15) % 360;
    if (this._rotation > 180) this._rotation -= 360;
    this.area.style.transform = `rotate(${this._rotation}deg)`;
  },

  onCornerStart(e) {
    e.preventDefault();
    e.stopPropagation();
    this.state.resizing = true;
    this.state.activeCorner = e.target.closest('.crop-handle').dataset.handle;
    const pos = this.getPos(e);
    this.state.startX = pos.x;
    this.state.startY = pos.y;
    this.state.initialCorners = JSON.parse(JSON.stringify(this.state.corners));
    this.showMagnifier();
    this.updateMagnifier(pos);
  },

  onMove(e) {
    if (!this.state.resizing) return;
    if (!this._cache.canvasRect) this._updateCache();
    if (!this._cache.canvasRect) return; // Still null

    e.preventDefault();
    const pos = this.getPos(e);

    const cr = this._cache.canvasRect || this.canvas.getBoundingClientRect();
    const wr = this._cache.wrapperRect || this.wrapper.getBoundingClientRect();

    const dx = pos.x - this.state.startX;
    const dy = pos.y - this.state.startY;

    const key = this.state.activeCorner;
    const init = this.state.initialCorners[key];
    const corner = this.state.corners[key];

    const minBoundX = cr.left - wr.left;
    const minBoundY = cr.top - wr.top;
    const maxBoundX = cr.right - wr.left;
    const maxBoundY = cr.bottom - wr.top;

    let nextX = init.x + dx;
    let nextY = init.y + dy;

    // Constrain to canvas bounds
    nextX = Math.max(minBoundX, Math.min(nextX, maxBoundX));
    nextY = Math.max(minBoundY, Math.min(nextY, maxBoundY));

    // Apply aspect ratio constraint: keep opposite corner fixed
    if (this.lockedRatio) {
      const opposites = { tl: 'br', tr: 'bl', bl: 'tr', br: 'tl' };
      const opp = this.state.corners[opposites[key]];
      const ratio = this.lockedRatio; // width / height

      const dx2 = nextX - opp.x;
      const dy2 = nextY - opp.y;
      const absDx = Math.abs(dx2);
      const absDy = Math.abs(dy2);

      if (absDx / ratio > absDy) {
        // Width is dominant — derive H from W
        const newH = absDx / ratio;
        nextY = opp.y + Math.sign(dy2 || 1) * newH;
      } else {
        // Height is dominant — derive W from H
        const newW = absDy * ratio;
        nextX = opp.x + Math.sign(dx2 || 1) * newW;
      }
    }

    corner.x = nextX;
    corner.y = nextY;

    this.updateMagnifier(pos);
    this.renderQuadrilateral();
  },

  updateMagnifier(pos) {
    if (!this.magnifier) return;
    const cr = this._cache.canvasRect || this.canvas.getBoundingClientRect();
    const wr = this._cache.wrapperRect || this.wrapper.getBoundingClientRect();
    const scaleX = this.canvas.width / cr.width;
    const scaleY = this.canvas.height / cr.height;

    const magLeft = (pos.x - wr.left) - this._cache.areaLeft + 20;
    const magTop = (pos.y - wr.top) - this._cache.areaTop - 140;

    this.magnifier.style.left = magLeft + 'px';
    this.magnifier.style.top = magTop + 'px';

    const magSize = 120;
    const bgX = (pos.x - cr.left) * scaleX - magSize / 2;
    const bgY = (pos.y - cr.top) * scaleY - magSize / 2;
    this.magnifier.style.backgroundPosition = `${-bgX}px ${-bgY}px`;
  },

  onEnd() {
    this.state.resizing = false;
    this.state.activeCorner = null;
    this.hideMagnifier();
  },

  showMagnifier() {
    if (!this.magnifier) return;
    this.magnifier.style.display = 'block';
    this.magnifier.style.backgroundImage = `url(${this.canvas.toDataURL()})`;
    this.magnifier.style.backgroundSize = `${this.canvas.width}px ${this.canvas.height}px`;
  },

  hideMagnifier() { if (this.magnifier) this.magnifier.style.display = 'none'; },

  getPos(e) {
    if (e.touches && e.touches.length > 0) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  },

  renderQuadrilateral() {
    const c = this.state.corners;
    const aL = this._cache.areaLeft;
    const aT = this._cache.areaTop;
    const off = this.handleOffset;

    const txl = c.tl.x - aL;
    const tyl = c.tl.y - aT;
    const txr = c.tr.x - aL;
    const tyr = c.tr.y - aT;
    const bxr = c.br.x - aL;
    const byr = c.br.y - aT;
    const bxl = c.bl.x - aL;
    const byl = c.bl.y - aT;

    this.area.style.clipPath = `polygon(${txl}px ${tyl}px, ${txr}px ${tyr}px, ${bxr}px ${byr}px, ${bxl}px ${byl}px)`;

    this.area.querySelectorAll('.crop-handle').forEach(h => {
      const key = h.dataset.handle;
      if (c[key]) {
        h.style.left = (c[key].x - aL - off) + 'px';
        h.style.top = (c[key].y - aT - off) + 'px';
      }
    });
  },

  setRatio(ratioKey) {
    this.lockedRatio = this.RATIO_MAP[ratioKey] ?? null;
    if (this.lockedRatio && this.canvas) {
      this.resetCropArea();
    }
  },

  /**
   * Pre-fill crop handles from ML-detected corners.
   * corners: [{x,y}] in canvas pixel coords, 4 points TL TR BR BL
   */
  setDetectedCorners(corners, srcCanvas) {
    if (!corners || corners.length !== 4 || !this.canvas || !this.wrapper || !this.area) return;

    // Reset zoom and pan FIRST to ensure stable rects
    if (typeof app !== 'undefined' && app.resetZoom) {
      app.resetZoom();
    }

    // Force cache update to get fresh rects
    this._updateCache();

    const canvasRect = this._cache.canvasRect;
    const wrapperRect = this._cache.wrapperRect;

    if (!canvasRect || !wrapperRect) return;

    const scaleX = canvasRect.width / srcCanvas.width;
    const scaleY = canvasRect.height / srcCanvas.height;

    // Map canvas pixel coords to screen coords relative to wrapper
    const canvasLeft = canvasRect.left - wrapperRect.left;
    const canvasTop = canvasRect.top - wrapperRect.top;

    const screenCorners = corners.map(p => ({
      x: p.x * scaleX + canvasLeft,
      y: p.y * scaleY + canvasTop
    }));

    // Fit crop area to bounding box of corners
    const xs = screenCorners.map(p => p.x);
    const ys = screenCorners.map(p => p.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const maxX = Math.max(...xs), maxY = Math.max(...ys);
    const cw = maxX - minX, ch = maxY - minY;

    if (cw < 20 || ch < 20) return;

    this.area.style.left = minX + 'px';
    this.area.style.top = minY + 'px';
    this.area.style.width = cw + 'px';
    this.area.style.height = ch + 'px';
    this.area.style.clipPath = '';
    this.area.style.transform = '';
    this._rotation = 0;

    // Update state corners
    this.state.corners = {
      tl: screenCorners[0],
      tr: screenCorners[1],
      br: screenCorners[2],
      bl: screenCorners[3]
    };

    // Cache updated position
    this._updateCache();
    this.renderQuadrilateral();
  },

  resetCropArea() {
    if (!this.canvas || !this.wrapper || !this.area) return;

    if (typeof app !== 'undefined' && app.resetZoom) {
      app.resetZoom();
    }

    const canvasRect = this.canvas.getBoundingClientRect();
    const wrapperRect = this.wrapper.getBoundingClientRect();

    const cx = canvasRect.left - wrapperRect.left;
    const cy = canvasRect.top - wrapperRect.top;
    let cw = canvasRect.width;
    let ch = canvasRect.height;

    // Apply aspect ratio constraint to initial crop area
    if (this.lockedRatio) {
      if (cw / ch > this.lockedRatio) {
        cw = ch * this.lockedRatio;
      } else {
        ch = cw / this.lockedRatio;
      }
      // Center the crop area
      const offsetX = (canvasRect.width - cw) / 2;
      const offsetY = (canvasRect.height - ch) / 2;
      this.area.style.left = (cx + offsetX) + 'px';
      this.area.style.top = (cy + offsetY) + 'px';
    } else {
      this.area.style.left = cx + 'px';
      this.area.style.top = cy + 'px';
    }

    this.area.style.width = cw + 'px';
    this.area.style.height = ch + 'px';
    this.area.style.clipPath = '';
    this.area.style.transform = '';
    this._rotation = 0;

    // Read actual position (may differ when ratio-constrained)
    const aL = parseFloat(this.area.style.left) || cx;
    const aT = parseFloat(this.area.style.top) || cy;

    this.state.corners = {
      tl: { x: aL, y: aT },
      tr: { x: aL + cw, y: aT },
      bl: { x: aL, y: aT + ch },
      br: { x: aL + cw, y: aT + ch }
    };

    // Cache setelah area di-posisi
    this._updateCache();
    this.renderQuadrilateral();
  },

  cropQuadrilateral() {
    const srcCanvas = this.canvas;
    const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
    const c = this.state.corners;
    const cr = this.canvas.getBoundingClientRect();
    const wr = this.wrapper.getBoundingClientRect();
    const scaleX = srcCanvas.width / cr.width;
    const scaleY = srcCanvas.height / cr.height;
    const canvasLeft = cr.left - wr.left;
    const canvasTop = cr.top - wr.top;

    const pts = [
      { x: (c.tl.x - canvasLeft) * scaleX, y: (c.tl.y - canvasTop) * scaleY },
      { x: (c.tr.x - canvasLeft) * scaleX, y: (c.tr.y - canvasTop) * scaleY },
      { x: (c.br.x - canvasLeft) * scaleX, y: (c.br.y - canvasTop) * scaleY },
      { x: (c.bl.x - canvasLeft) * scaleX, y: (c.bl.y - canvasTop) * scaleY }
    ];

    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    const minX = Math.max(0, Math.min(...xs));
    const minY = Math.max(0, Math.min(...ys));
    const maxX = Math.min(srcCanvas.width, Math.max(...xs));
    const maxY = Math.min(srcCanvas.height, Math.max(...ys));

    const w = Math.round(maxX - minX);
    const h = Math.round(maxY - minY);

    if (w < 10 || h < 10) return null;

    // Apply rotation if non-zero
    if (Math.abs(this._rotation) > 0.5) {
      const radians = (this._rotation * Math.PI) / 180;
      const cos = Math.abs(Math.cos(radians));
      const sin = Math.abs(Math.sin(radians));
      const rotW = Math.ceil(w * cos + h * sin);
      const rotH = Math.ceil(w * sin + h * cos);

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = w;
      tempCanvas.height = h;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(srcCanvas, minX, minY, w, h, 0, 0, w, h);

      const outCanvas = document.createElement('canvas');
      outCanvas.width = rotW;
      outCanvas.height = rotH;
      const outCtx = outCanvas.getContext('2d');
      outCtx.translate(rotW / 2, rotH / 2);
      outCtx.rotate(radians);
      outCtx.drawImage(tempCanvas, -w / 2, -h / 2);
      return outCanvas;
    }

    const imageData = srcCtx.getImageData(minX, minY, w, h);
    const outCanvas = document.createElement('canvas');
    outCanvas.width = w;
    outCanvas.height = h;
    const outCtx = outCanvas.getContext('2d');
    outCtx.putImageData(imageData, 0, 0);
    return outCanvas;
  }
};

window.manualCrop = manualCrop;
