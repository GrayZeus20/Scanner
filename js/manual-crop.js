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

    const pos = this.getPos(e);
    const handle = e.target.closest('.crop-handle');

    this.state.resizing = true;
    this.state.activeCorner = handle.dataset.handle;
    this.state.startX = pos.x;
    this.state.startY = pos.y;

    this.showMagnifier();
  },

  onMove(e) {
    if (!this.state.resizing) return;
    e.preventDefault();

    const pos = this.getPos(e);
    const canvasRect = this.canvas.getBoundingClientRect();
    const wrapperRect = this.wrapper.getBoundingClientRect();

    const dx = pos.x - this.state.startX;
    const dy = pos.y - this.state.startY;

    const canvasLeft = canvasRect.left - wrapperRect.left;
    const canvasTop = canvasRect.top - wrapperRect.top;
    const canvasRight = canvasRect.right - wrapperRect.left;
    const canvasBottom = canvasRect.bottom - wrapperRect.top;

    if (this.state.activeCorner) {
      const key = this.state.activeCorner;
      const corner = this.state.corners[key];
      
      corner.x = Math.max(canvasLeft, Math.min(corner.x + dx, canvasRight));
      corner.y = Math.max(canvasTop, Math.min(corner.y + dy, canvasBottom));
    }

    this.state.startX = pos.x;
    this.state.startY = pos.y;

    this.renderQuadrilateral();
  },

  onEnd() {
    this.state.resizing = false;
    this.state.activeCorner = null;
    this.hideMagnifier();
  },

  showMagnifier() {
    if (!this.magnifier) return;
    this.magnifier.style.display = 'block';
  },

  hideMagnifier() {
    if (!this.magnifier) return;
    this.magnifier.style.display = 'none';
  },

  getPos(e) {
    if (e.touches && e.touches.length > 0) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  },

  renderQuadrilateral() {
    const c = this.state.corners;
    const areaLeft = this.area.offsetLeft;
    const areaTop = this.area.offsetTop;

    const txl = c.tl.x - areaLeft, tyl = c.tl.y - areaTop;
    const txr = c.tr.x - areaLeft, tyr = c.tr.y - areaTop;
    const bxr = c.br.x - areaLeft, byr = c.br.y - areaTop;
    const bxl = c.bl.x - areaLeft, byl = c.bl.y - areaTop;

    this.area.style.clipPath = `polygon(${txl}px ${tyl}px, ${txr}px ${tyr}px, ${bxr}px ${byr}px, ${bxl}px ${byl}px)`;

    const handles = this.area.querySelectorAll('.crop-handle');
    handles.forEach(h => {
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
    
    const margin = Math.min(cw, ch) * 0.05;
    
    this.state.corners = {
      tl: { x: cx + margin, y: cy + margin },
      tr: { x: cx + cw - margin, y: cy + margin },
      bl: { x: cx + margin, y: cy + ch - margin },
      br: { x: cx + cw - margin, y: cy + ch - margin }
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
