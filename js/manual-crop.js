const manualCrop = {
  overlay: null,
  area: null,
  magnifier: null,
  wrapper: null,
  canvas: null,
  handleSize: 50,   // harus sinkron dengan .crop-handle di style.css
  handleOffset: 25, // handleSize / 2 — center handle tepat di corner
  magSize: 110,     // harus sinkron dengan .crop-magnifier di style.css

  // SVG elements for non-clipped rendering
  _svg: null,
  _svgPoly: null,
  _svgPolyOuter: null,
  _svgMaskPoly: null,
  _gridH1: null,
  _gridH2: null,
  _gridV1: null,
  _gridV2: null,
  // Titik pas: titik potong persis di tiap sudut
  _dotTl: null,
  _dotTr: null,
  _dotBl: null,
  _dotBr: null,

  // Aspect ratio presets: null = free, number = w/h ratio
  RATIO_MAP: { free: null, '1:1': 1, '3:4': 3 / 4, a4: 210 / 297 },
  lockedRatio: null,

  // Rotation state
  _rotation: 0,

  state: {
    resizing: false,
    draggingArea: false,
    activeCorner: null,
    startX: 0,
    startY: 0,
    initialCorners: {},
    corners: { tl: {x: 0, y: 0}, tr: {x: 0, y: 0}, bl: {x: 0, y: 0}, br: {x: 0, y: 0} }
  },

  // Cache bounding rect untuk menghindari layout thrashing
  _cache: { canvasRect: null, wrapperRect: null },

  _updateCache() {
    if (!this.canvas || !this.wrapper) return;
    this._cache.canvasRect = this.canvas.getBoundingClientRect();
    this._cache.wrapperRect = this.wrapper.getBoundingClientRect();
  },

  init() {
    this.overlay = document.getElementById('cropOverlay');
    this.area = document.getElementById('cropArea');
    this.magnifier = document.getElementById('cropMagnifier');
    this.wrapper = document.getElementById('canvasWrapper');
    this.canvas = document.getElementById('mainCanvas');

    this._svg = document.getElementById('cropSvg');
    this._svgPoly = document.getElementById('cropPolygon');
    this._svgPolyOuter = document.getElementById('cropPolygonOuter');
    this._svgMaskPoly = document.getElementById('cropMaskPolygon');
    this._gridH1 = document.getElementById('cropGridH1');
    this._gridH2 = document.getElementById('cropGridH2');
    this._gridV1 = document.getElementById('cropGridV1');
    this._gridV2 = document.getElementById('cropGridV2');
    this._dotTl = document.getElementById('cropDotTl');
    this._dotTr = document.getElementById('cropDotTr');
    this._dotBl = document.getElementById('cropDotBl');
    this._dotBr = document.getElementById('cropDotBr');

    if (!this.area || this.initialized) return;
    this.initialized = true;

    // Corner handle listeners
    this.area.querySelectorAll('.crop-handle').forEach(handle => {
      handle.addEventListener('mousedown', (e) => this.onCornerStart(e));
      handle.addEventListener('touchstart', (e) => this.onCornerStart(e), { passive: false });
    });

    // Whole area drag listener on the SVG polygon
    if (this._svgPoly) {
      this._svgPoly.addEventListener('mousedown', (e) => this.onAreaDragStart(e));
      this._svgPoly.addEventListener('touchstart', (e) => this.onAreaDragStart(e), { passive: false });
    }

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
    const autoDetectBtn = document.getElementById('cropAutoDetectBtn');
    if (autoDetectBtn) {
      autoDetectBtn.addEventListener('click', async () => {
        if (typeof app !== 'undefined' && app.autoDetectForManualCrop) {
          await app.autoDetectForManualCrop();
        }
      });
    }

    this._updateCache();
    if (!this.state.corners.tr.x && !this.state.corners.br.x) {
      this.resetCropArea();
    } else {
      this.renderQuadrilateral();
    }
  },

  rotateStep() {
    this._rotation = (this._rotation + 15) % 360;
    if (this._rotation > 180) this._rotation -= 360;
    if (this._svg) {
      this._svg.style.transform = `rotate(${this._rotation}deg)`;
    }
    if (this.area) {
      this.area.style.transform = `rotate(${this._rotation}deg)`;
    }
  },

  onCornerStart(e) {
    e.preventDefault();
    e.stopPropagation();
    this.state.resizing = true;
    this.state.draggingArea = false;
    this.state.activeCorner = e.target.closest('.crop-handle').dataset.handle;
    const pos = this.getPos(e);
    this.state.startX = pos.x;
    this.state.startY = pos.y;
    this.state.initialCorners = JSON.parse(JSON.stringify(this.state.corners));
    this.showMagnifier();
    this.updateMagnifier(pos);
  },

  onAreaDragStart(e) {
    if (e.target.closest('.crop-handle')) return;
    e.preventDefault();
    e.stopPropagation();
    this.state.draggingArea = true;
    this.state.resizing = false;
    const pos = this.getPos(e);
    this.state.startX = pos.x;
    this.state.startY = pos.y;
    this.state.initialCorners = JSON.parse(JSON.stringify(this.state.corners));
  },

  onMove(e) {
    if (!this.state.resizing && !this.state.draggingArea) return;
    if (!this._cache.canvasRect) this._updateCache();
    if (!this._cache.canvasRect) return;

    e.preventDefault();
    const pos = this.getPos(e);

    const cr = this._cache.canvasRect || this.canvas.getBoundingClientRect();
    const wr = this._cache.wrapperRect || this.wrapper.getBoundingClientRect();

    const dx = pos.x - this.state.startX;
    const dy = pos.y - this.state.startY;

    // Corner drag bounds = canvas ∩ visible wrapper — corner selalu terlihat
    const minBoundX = Math.max(0, cr.left - wr.left);
    const minBoundY = Math.max(0, cr.top - wr.top);
    const maxBoundX = Math.min(wr.width, cr.right - wr.left);
    const maxBoundY = Math.min(wr.height, cr.bottom - wr.top);

    if (this.state.draggingArea) {
      // Drag entire quadrilateral
      const inits = this.state.initialCorners;
      const cur = this.state.corners;
      const keys = ['tl', 'tr', 'bl', 'br'];

      // Check bounds so entire quad stays inside canvas bounds
      let safeDx = dx;
      let safeDy = dy;
      for (const k of keys) {
        const nx = inits[k].x + safeDx;
        const ny = inits[k].y + safeDy;
        if (nx < minBoundX) safeDx += (minBoundX - nx);
        if (nx > maxBoundX) safeDx -= (nx - maxBoundX);
        if (ny < minBoundY) safeDy += (minBoundY - ny);
        if (ny > maxBoundY) safeDy -= (ny - maxBoundY);
      }

      for (const k of keys) {
        cur[k].x = inits[k].x + safeDx;
        cur[k].y = inits[k].y + safeDy;
      }
      this.renderQuadrilateral();
      return;
    }

    // Dragging single corner
    const key = this.state.activeCorner;
    const init = this.state.initialCorners[key];
    const corner = this.state.corners[key];

    let nextX = init.x + dx;
    let nextY = init.y + dy;

    // Constrain to canvas bounds
    nextX = Math.max(minBoundX, Math.min(nextX, maxBoundX));
    nextY = Math.max(minBoundY, Math.min(nextY, maxBoundY));

    // Apply aspect ratio constraint: keep opposite corner fixed
    if (this.lockedRatio) {
      const opposites = { tl: 'br', tr: 'bl', bl: 'tr', br: 'tl' };
      const opp = this.state.corners[opposites[key]];
      const ratio = this.lockedRatio;

      const dx2 = nextX - opp.x;
      const dy2 = nextY - opp.y;
      const absDx = Math.abs(dx2);
      const absDy = Math.abs(dy2);

      if (absDx / ratio > absDy) {
        const newH = absDx / ratio;
        nextY = opp.y + Math.sign(dy2 || 1) * newH;
      } else {
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

    // Clamp magnifier fully inside wrapper — never overflow / get clipped
    const pad = 8;
    let magLeft = (pos.x - wr.left) + 20;
    let magTop = (pos.y - wr.top) - 140;
    magLeft = Math.max(pad, Math.min(magLeft, wr.width - this.magSize - pad));
    magTop = Math.max(pad, Math.min(magTop, wr.height - this.magSize - pad));

    this.magnifier.style.left = magLeft + 'px';
    this.magnifier.style.top = magTop + 'px';

    const magSize = this.magSize;
    const bgX = (pos.x - cr.left) * scaleX - magSize / 2;
    const bgY = (pos.y - cr.top) * scaleY - magSize / 2;
    this.magnifier.style.backgroundPosition = `${-bgX}px ${-bgY}px`;
  },

  onEnd() {
    this.state.resizing = false;
    this.state.draggingArea = false;
    this.state.activeCorner = null;
    this.hideMagnifier();
  },

  showMagnifier() {
    if (!this.magnifier) return;
    this.magnifier.style.display = 'block';
    this.magnifier.style.backgroundImage = `url(${this.canvas.toDataURL()})`;
    this.magnifier.style.backgroundSize = `${this.canvas.width}px ${this.canvas.height}px`;
  },

  hideMagnifier() {
    if (this.magnifier) this.magnifier.style.display = 'none';
  },

  getPos(e) {
    if (e.touches && e.touches.length > 0) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  },

  renderQuadrilateral() {
    const c = this.state.corners;
    const off = this.handleOffset;

    // Wrapper-relative bounds — handles must never overflow the visible area
    const wr = this._cache.wrapperRect || (this.wrapper && this.wrapper.getBoundingClientRect());
    const maxLeft = wr ? wr.width - this.handleSize : Infinity;
    const maxTop = wr ? wr.height - this.handleSize : Infinity;

    // 1. Position handles; clamp visual box inside wrapper so it stays grabbable
    if (this.area) {
      this.area.querySelectorAll('.crop-handle').forEach(h => {
        const key = h.dataset.handle;
        if (c[key]) {
          const rawLeft = c[key].x - off;
          const rawTop = c[key].y - off;
          h.style.left = Math.max(0, Math.min(rawLeft, maxLeft)) + 'px';
          h.style.top = Math.max(0, Math.min(rawTop, maxTop)) + 'px';
        }
      });
    }

    // 2. Render SVG polygon lines and dark scrim
    const ptsStr = `${c.tl.x},${c.tl.y} ${c.tr.x},${c.tr.y} ${c.br.x},${c.br.y} ${c.bl.x},${c.bl.y}`;
    if (this._svgPoly) this._svgPoly.setAttribute('points', ptsStr);
    if (this._svgPolyOuter) this._svgPolyOuter.setAttribute('points', ptsStr);
    if (this._svgMaskPoly) this._svgMaskPoly.setAttribute('points', ptsStr);

    // 2b. Titik pas — exact crop points at each corner (never clamped)
    if (this._dotTl) { this._dotTl.setAttribute('cx', c.tl.x); this._dotTl.setAttribute('cy', c.tl.y); }
    if (this._dotTr) { this._dotTr.setAttribute('cx', c.tr.x); this._dotTr.setAttribute('cy', c.tr.y); }
    if (this._dotBl) { this._dotBl.setAttribute('cx', c.bl.x); this._dotBl.setAttribute('cy', c.bl.y); }
    if (this._dotBr) { this._dotBr.setAttribute('cx', c.br.x); this._dotBr.setAttribute('cy', c.br.y); }

    // 3. Render rule-of-thirds grid
    if (this._gridH1 && this._gridH2 && this._gridV1 && this._gridV2) {
      // Horizontal lines (interpolated between left and right edges)
      const h1x1 = c.tl.x + (c.bl.x - c.tl.x) / 3, h1y1 = c.tl.y + (c.bl.y - c.tl.y) / 3;
      const h1x2 = c.tr.x + (c.br.x - c.tr.x) / 3, h1y2 = c.tr.y + (c.br.y - c.tr.y) / 3;
      this._gridH1.setAttribute('x1', h1x1); this._gridH1.setAttribute('y1', h1y1);
      this._gridH1.setAttribute('x2', h1x2); this._gridH1.setAttribute('y2', h1y2);

      const h2x1 = c.tl.x + ((c.bl.x - c.tl.x) * 2) / 3, h2y1 = c.tl.y + ((c.bl.y - c.tl.y) * 2) / 3;
      const h2x2 = c.tr.x + ((c.br.x - c.tr.x) * 2) / 3, h2y2 = c.tr.y + ((c.br.y - c.tr.y) * 2) / 3;
      this._gridH2.setAttribute('x1', h2x1); this._gridH2.setAttribute('y1', h2y1);
      this._gridH2.setAttribute('x2', h2x2); this._gridH2.setAttribute('y2', h2y2);

      // Vertical lines (interpolated between top and bottom edges)
      const v1x1 = c.tl.x + (c.tr.x - c.tl.x) / 3, v1y1 = c.tl.y + (c.tr.y - c.tl.y) / 3;
      const v1x2 = c.bl.x + (c.br.x - c.bl.x) / 3, v1y2 = c.bl.y + (c.br.y - c.bl.y) / 3;
      this._gridV1.setAttribute('x1', v1x1); this._gridV1.setAttribute('y1', v1y1);
      this._gridV1.setAttribute('x2', v1x2); this._gridV1.setAttribute('y2', v1y2);

      const v2x1 = c.tl.x + ((c.tr.x - c.tl.x) * 2) / 3, v2y1 = c.tl.y + ((c.tr.y - c.tl.y) * 2) / 3;
      const v2x2 = c.bl.x + ((c.br.x - c.bl.x) * 2) / 3, v2y2 = c.bl.y + ((c.br.y - c.bl.y) * 2) / 3;
      this._gridV2.setAttribute('x1', v2x1); this._gridV2.setAttribute('y1', v2y1);
      this._gridV2.setAttribute('x2', v2x2); this._gridV2.setAttribute('y2', v2y2);
    }
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

    if (typeof app !== 'undefined' && app.resetZoom) {
      app.resetZoom();
    }

    this._updateCache();

    const canvasRect = this._cache.canvasRect || this.canvas.getBoundingClientRect();
    const wrapperRect = this._cache.wrapperRect || this.wrapper.getBoundingClientRect();

    if (!canvasRect || !wrapperRect) return;

    const scaleX = canvasRect.width / srcCanvas.width;
    const scaleY = canvasRect.height / srcCanvas.height;

    const canvasLeft = canvasRect.left - wrapperRect.left;
    const canvasTop = canvasRect.top - wrapperRect.top;

    const screenCorners = corners.map(p => ({
      x: p.x * scaleX + canvasLeft,
      y: p.y * scaleY + canvasTop
    }));

    // Area is full-size overlay unclipped
    this.area.style.left = '0px';
    this.area.style.top = '0px';
    this.area.style.width = '100%';
    this.area.style.height = '100%';
    this.area.style.clipPath = '';
    this.area.style.transform = '';
    if (this._svg) {
      this._svg.style.transform = '';
    }
    this._rotation = 0;

    this.state.corners = {
      tl: screenCorners[0],
      tr: screenCorners[1],
      br: screenCorners[2],
      bl: screenCorners[3]
    };

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

    let offX = 0, offY = 0;
    if (this.lockedRatio) {
      if (cw / ch > this.lockedRatio) {
        const newW = ch * this.lockedRatio;
        offX = (cw - newW) / 2;
        cw = newW;
      } else {
        const newH = cw / this.lockedRatio;
        offY = (ch - newH) / 2;
        ch = newH;
      }
    }

    this.area.style.left = '0px';
    this.area.style.top = '0px';
    this.area.style.width = '100%';
    this.area.style.height = '100%';
    this.area.style.clipPath = '';
    this.area.style.transform = '';
    if (this._svg) {
      this._svg.style.transform = '';
    }
    this._rotation = 0;

    const x1 = cx + offX;
    const y1 = cy + offY;
    const x2 = x1 + cw;
    const y2 = y1 + ch;

    this.state.corners = {
      tl: { x: x1, y: y1 },
      tr: { x: x2, y: y1 },
      bl: { x: x1, y: y2 },
      br: { x: x2, y: y2 }
    };

    this._updateCache();
    this.renderQuadrilateral();
  },

  cropQuadrilateral() {
    const srcCanvas = this.canvas;
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

    const clampedPts = pts.map(p => ({
      x: Math.max(0, Math.min(srcCanvas.width, p.x)),
      y: Math.max(0, Math.min(srcCanvas.height, p.y))
    }));

    const ordered = (typeof edgeDetection !== 'undefined' && edgeDetection.orderCorners)
      ? edgeDetection.orderCorners(clampedPts)
      : clampedPts;

    const topW = Math.hypot(ordered[1].x - ordered[0].x, ordered[1].y - ordered[0].y);
    const botW = Math.hypot(ordered[2].x - ordered[3].x, ordered[2].y - ordered[3].y);
    const leftH = Math.hypot(ordered[3].x - ordered[0].x, ordered[3].y - ordered[0].y);
    const rightH = Math.hypot(ordered[2].x - ordered[1].x, ordered[2].y - ordered[1].y);

    let targetW = Math.max(10, Math.round(Math.max(topW, botW)));
    let targetH = Math.max(10, Math.round(Math.max(leftH, rightH)));

    if (this.lockedRatio) {
      if (targetW / targetH > this.lockedRatio) {
        targetW = Math.round(targetH * this.lockedRatio);
      } else {
        targetH = Math.round(targetW / this.lockedRatio);
      }
    }

    if (targetW < 10 || targetH < 10) return null;

    let outCanvas = null;
    if (typeof edgeDetection !== 'undefined' && edgeDetection.warpPerspective) {
      outCanvas = edgeDetection.warpPerspective(srcCanvas, ordered, targetW, targetH);
    }

    if (!outCanvas) {
      const xs = clampedPts.map(p => p.x);
      const ys = clampedPts.map(p => p.y);
      const minX = Math.round(Math.min(...xs));
      const minY = Math.round(Math.min(...ys));
      const w = Math.round(Math.max(...xs) - minX);
      const h = Math.round(Math.max(...ys) - minY);
      outCanvas = document.createElement('canvas');
      outCanvas.width = Math.max(1, w);
      outCanvas.height = Math.max(1, h);
      outCanvas.getContext('2d').drawImage(srcCanvas, minX, minY, w, h, 0, 0, w, h);
    }

    // Apply rotation if non-zero
    if (Math.abs(this._rotation) > 0.5) {
      const radians = (this._rotation * Math.PI) / 180;
      const cos = Math.abs(Math.cos(radians));
      const sin = Math.abs(Math.sin(radians));
      const curW = outCanvas.width;
      const curH = outCanvas.height;
      const rotW = Math.ceil(curW * cos + curH * sin);
      const rotH = Math.ceil(curW * sin + curH * cos);

      const rotCanvas = document.createElement('canvas');
      rotCanvas.width = rotW;
      rotCanvas.height = rotH;
      const rotCtx = rotCanvas.getContext('2d');
      rotCtx.translate(rotW / 2, rotH / 2);
      rotCtx.rotate(radians);
      rotCtx.drawImage(outCanvas, -curW / 2, -curH / 2);
      return rotCanvas;
    }

    return outCanvas;
  }
};

window.manualCrop = manualCrop;
