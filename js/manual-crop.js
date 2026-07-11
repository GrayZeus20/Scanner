const manualCrop = {
  overlay: null,
  area: null,
  magnifier: null,
  wrapper: null,
  canvas: null,
  
  state: {
    dragging: false,
    resizing: false,
    activeHandle: null,
    startX: 0,
    startY: 0,
    // Store individual corner positions (relative to wrapper)
    corners: { tl: {x: 0, y: 0}, tr: {x: 0, y: 0}, bl: {x: 0, y: 0}, br: {x: 0, y: 0} },
    minCornerDist: 20,
    activeCorner: null
  },

  init() {
    this.overlay = document.getElementById('cropOverlay');
    this.area = document.getElementById('cropArea');
    this.magnifier = document.getElementById('cropMagnifier');
    this.wrapper = document.getElementById('canvasWrapper');
    this.canvas = document.getElementById('mainCanvas');

    if (!this.area || this.initialized) return;
    this.initialized = true;

    // Each corner handle moves independently
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

  getPos(e) {
    if (e.touches && e.touches.length > 0) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  },

  renderQuadrilateral() {
    const c = this.state.corners;
    // Update the crop area polygon via clip-path
    this.area.style.clipPath = `polygon(${c.tl.x}px ${c.tl.y}px, ${c.tr.x}px ${c.tr.y}px, ${c.br.x}px ${c.br.y}px, ${c.bl.x}px ${c.bl.y}px)`;
    
    // Position handles at corners
    const handles = this.area.querySelectorAll('.crop-handle');
    handles.forEach(h => {
      const key = h.dataset.handle;
      if (c[key]) {
        h.style.position = 'absolute';
        h.style.left = (c[key].x - this.area.offsetLeft - 14) + 'px';
        h.style.top = (c[key].y - this.area.offsetTop - 14) + 'px';
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
    
    // Position handles absolutely within wrapper
    this.area.querySelectorAll('.crop-handle').forEach(h => {
      h.style.position = 'fixed';
    });
    
    this.renderFixedHandles();
  },

  renderFixedHandles() {
    const c = this.state.corners;
    const wrapperRect = this.wrapper.getBoundingClientRect();
    const handles = this.area.querySelectorAll('.crop-handle');
    
    handles.forEach(h => {
      const key = h.dataset.handle;
      if (c[key]) {
        // Convert to fixed position on screen
        const wrapperRect2 = this.wrapper.getBoundingClientRect();
        h.style.position = 'fixed';
        h.style.left = (wrapperRect2.left + c[key].x - 14) + 'px';
        h.style.top = (wrapperRect2.top + c[key].y - 14) + 'px';
      }
    });
  },

  getCropRect() {
    const c = this.state.corners;
    const canvasRect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / canvasRect.width;
    const scaleY = this.canvas.height / canvasRect.height;
    const canvasLeft = canvasRect.left;
    const canvasTop = canvasRect.top;

    return {
      tl: { x: (c.tl.x * scaleX), y: (c.tl.y * scaleY) },
      tr: { x: (c.tr.x * scaleX), y: (c.tr.y * scaleY) },
      bl: { x: (c.bl.x * scaleX), y: (c.bl.y * scaleY) },
      br: { x: (c.br.x * scaleX), y: (c.br.y * scaleY) }
    };
  },

  // Extract quadrilateral region from canvas and draw to new canvas
  cropQuadrilateral() {
    const srcCanvas = this.canvas;
    const srcCtx = srcCanvas.getContext('2d');
    const c = this.state.corners;
    const canvasRect = srcCanvas.getBoundingClientRect();
    const scaleX = srcCanvas.width / canvasRect.width;
    const scaleY = srcCanvas.height / canvasRect.height;

    // Convert corners to canvas pixel coordinates
    const pts = [
      { x: c.tl.x * scaleX, y: c.tl.y * scaleY },
      { x: c.tr.x * scaleX, y: c.tr.y * scaleY },
      { x: c.br.x * scaleX, y: c.br.y * scaleY },
      { x: c.bl.x * scaleX, y: c.bl.y * scaleY }
    ];

    // Bounding box
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    const minX = Math.max(0, Math.min(...xs));
    const minY = Math.max(0, Math.min(...ys));
    const maxX = Math.min(srcCanvas.width, Math.max(...xs));
    const maxY = Math.min(srcCanvas.height, Math.max(...ys));
    
    const w = Math.round(maxX - minX);
    const h = Math.round(maxY - minY);
    
    if (w < 10 || h < 10) return null;

    // Use bounding box crop for simplicity (perspective warp requires WebGL)
    const imageData = srcCtx.getImageData(minX, minY, w, h);
    const outCanvas = document.createElement('canvas');
    outCanvas.width = w;
    outCanvas.height = h;
    const outCtx = outCanvas.getContext('2d');
    outCtx.putImageData(imageData, 0, 0);

    return outCanvas;
  }
};
