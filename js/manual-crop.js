const manualCrop = {
  overlay: null,
  area: null,
  magnifier: null,
  wrapper: null,
  canvas: null,
  handleOffset: 22, // 44px handle / 2 = 22px offset untuk center

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
    e.preventDefault();
    const pos = this.getPos(e);

    const cr = this._cache.canvasRect;
    const wr = this._cache.wrapperRect;

    const dx = pos.x - this.state.startX;
    const dy = pos.y - this.state.startY;

    const key = this.state.activeCorner;
    const init = this.state.initialCorners[key];
    const corner = this.state.corners[key];

    const nextX = init.x + dx;
    const nextY = init.y + dy;

    const minBoundX = cr.left - wr.left;
    const minBoundY = cr.top - wr.top;
    const maxBoundX = cr.right - wr.left;
    const maxBoundY = cr.bottom - wr.top;

    corner.x = Math.max(minBoundX, Math.min(nextX, maxBoundX));
    corner.y = Math.max(minBoundY, Math.min(nextY, maxBoundY));

    this.updateMagnifier(pos);
    this.renderQuadrilateral();
  },

  updateMagnifier(pos) {
    if (!this.magnifier) return;
    const cr = this._cache.canvasRect;
    const wr = this._cache.wrapperRect;
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

  resetCropArea() {
    if (!this.canvas || !this.wrapper || !this.area) return;

    if (typeof app !== 'undefined' && app.resetZoom) {
      app.resetZoom();
    }

    // Hitung semua posisi dalam satu batch
    const canvasRect = this.canvas.getBoundingClientRect();
    const wrapperRect = this.wrapper.getBoundingClientRect();

    const cx = canvasRect.left - wrapperRect.left;
    const cy = canvasRect.top - wrapperRect.top;
    const cw = canvasRect.width;
    const ch = canvasRect.height;

    this.area.style.left = cx + 'px';
    this.area.style.top = cy + 'px';
    this.area.style.width = cw + 'px';
    this.area.style.height = ch + 'px';
    this.area.style.clipPath = '';

    this.state.corners = {
      tl: { x: cx, y: cy },
      tr: { x: cx + cw, y: cy },
      bl: { x: cx, y: cy + ch },
      br: { x: cx + cw, y: cy + ch }
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

    const imageData = srcCtx.getImageData(minX, minY, w, h);
    const outCanvas = document.createElement('canvas');
    outCanvas.width = w;
    outCanvas.height = h;
    const outCtx = outCanvas.getContext('2d');
    outCtx.putImageData(imageData, 0, 0);
    return outCanvas;
  }
};
