const manualCrop = {
  overlay: null,
  area: null,
  magnifier: null,
  wrapper: null,
  canvas: null,
  
  state: {
    resizing: false,
    activeCorner: null,
    startX: 0,
    startY: 0,
    initialCorners: {},
    corners: { tl: {x: 0, y: 0}, tr: {x: 0, y: 0}, bl: {x: 0, y: 0}, br: {x: 0, y: 0} }
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
    // Simpan posisi awal sudut untuk absolute delta
    this.state.initialCorners = JSON.parse(JSON.stringify(this.state.corners));
    this.showMagnifier();
    this.updateMagnifier(pos);
  },

  onMove(e) {
    if (!this.state.resizing) return;
    e.preventDefault();
    const pos = this.getPos(e);

    const canvasRect = this.canvas.getBoundingClientRect();
    const wrapperRect = this.wrapper.getBoundingClientRect();
    
    // Hitung delta dari posisi awal klik
    const dx = pos.x - this.state.startX;
    const dy = pos.y - this.state.startY;

    const key = this.state.activeCorner;
    const init = this.state.initialCorners[key];
    const corner = this.state.corners[key];

    // Posisi absolut = posisi awal + delta
    const nextX = init.x + dx;
    const nextY = init.y + dy;

    // Batasi dalam area canvas
    const minBoundX = canvasRect.left - wrapperRect.left;
    const minBoundY = canvasRect.top - wrapperRect.top;
    const maxBoundX = canvasRect.right - wrapperRect.left;
    const maxBoundY = canvasRect.bottom - wrapperRect.top;

    corner.x = Math.max(minBoundX, Math.min(nextX, maxBoundX));
    corner.y = Math.max(minBoundY, Math.min(nextY, maxBoundY));

    // Update magnifier & view
    this.updateMagnifier(pos);
    this.renderQuadrilateral();
  },

  updateMagnifier(pos) {
    if (!this.magnifier) return;
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    
    // Magnifier is inside cropArea, so position relative to it
    const wrapperRect = this.wrapper.getBoundingClientRect();
    const areaLeft = parseFloat(this.area.style.left) || 0;
    const areaTop = parseFloat(this.area.style.top) || 0;
    const magLeft = (pos.x - wrapperRect.left) - areaLeft + 20;
    const magTop = (pos.y - wrapperRect.top) - areaTop - 140;
    
    this.magnifier.style.left = magLeft + 'px';
    this.magnifier.style.top = magTop + 'px';

    // Show a 120x120 area centered on cursor
    const magSize = 120;
    const bgX = (pos.x - rect.left) * scaleX - magSize / 2;
    const bgY = (pos.y - rect.top) * scaleY - magSize / 2;
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
    const wrapperRect = this.wrapper.getBoundingClientRect();

    // Convert corner positions (wrapper-relative) to area-relative coordinates
    const areaLeft = parseFloat(this.area.style.left) || 0;
    const areaTop = parseFloat(this.area.style.top) || 0;

    const txl = c.tl.x - areaLeft;
    const tyl = c.tl.y - areaTop;
    const txr = c.tr.x - areaLeft;
    const tyr = c.tr.y - areaTop;
    const bxr = c.br.x - areaLeft;
    const byr = c.br.y - areaTop;
    const bxl = c.bl.x - areaLeft;
    const byl = c.bl.y - areaTop;

    this.area.style.clipPath = `polygon(${txl}px ${tyl}px, ${txr}px ${tyr}px, ${bxr}px ${byr}px, ${bxl}px ${byl}px)`;

    // Position handles relative to the area element
    this.area.querySelectorAll('.crop-handle').forEach(h => {
      const key = h.dataset.handle;
      if (c[key]) {
        h.style.left = (c[key].x - areaLeft - 14) + 'px';
        h.style.top = (c[key].y - areaTop - 14) + 'px';
      }
    });
  },

  resetCropArea() {
    if (!this.canvas) return;
    const canvasRect = this.canvas.getBoundingClientRect();
    const wrapperRect = this.wrapper.getBoundingClientRect();
    
    const cx = canvasRect.left - wrapperRect.left;
    const cy = canvasRect.top - wrapperRect.top;
    const cw = canvasRect.width;
    const ch = canvasRect.height;
    const margin = 0; // start exactly at image edge, no margin so it snaps to canvas
    
    this.state.corners = {
      tl: { x: cx, y: cy },
      tr: { x: cx + cw, y: cy },
      bl: { x: cx, y: cy + ch },
      br: { x: cx + cw, y: cy + ch }
    };
    
    this.area.style.left = cx + 'px';
    this.area.style.top = cy + 'px';
    this.area.style.width = cw + 'px';
    this.area.style.height = ch + 'px';
    this.area.style.clipPath = '';
    this.renderQuadrilateral();
  },

  getCropRect() {
    const c = this.state.corners;
    const canvasRect = this.canvas.getBoundingClientRect();
    const wrapperRect = this.wrapper.getBoundingClientRect();
    const scaleX = this.canvas.width / canvasRect.width;
    const scaleY = this.canvas.height / canvasRect.height;
    const canvasLeft = canvasRect.left - wrapperRect.left;
    const canvasTop = canvasRect.top - wrapperRect.top;

    return {
      tl: { x: (c.tl.x - canvasLeft) * scaleX, y: (c.tl.y - canvasTop) * scaleY },
      tr: { x: (c.tr.x - canvasLeft) * scaleX, y: (c.tr.y - canvasTop) * scaleY },
      bl: { x: (c.bl.x - canvasLeft) * scaleX, y: (c.bl.y - canvasTop) * scaleY },
      br: { x: (c.br.x - canvasLeft) * scaleX, y: (c.br.y - canvasTop) * scaleY }
    };
  },

  cropQuadrilateral() {
    const srcCanvas = this.canvas;
    const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
    const c = this.state.corners;
    const canvasRect = srcCanvas.getBoundingClientRect();
    const wrapperRect = this.wrapper.getBoundingClientRect();
    const scaleX = srcCanvas.width / canvasRect.width;
    const scaleY = srcCanvas.height / canvasRect.height;
    const canvasLeft = canvasRect.left - wrapperRect.left;
    const canvasTop = canvasRect.top - wrapperRect.top;

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
