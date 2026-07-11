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
    startLeft: 0,
    startTop: 0,
    startWidth: 0,
    startHeight: 0,
    minSize: 40
  },

  init() {
    this.overlay = document.getElementById('cropOverlay');
    this.area = document.getElementById('cropArea');
    this.magnifier = document.getElementById('cropMagnifier');
    this.wrapper = document.getElementById('canvasWrapper');
    this.canvas = document.getElementById('mainCanvas');

    if (!this.area) return;

    // Drag the entire crop area
    this.area.addEventListener('mousedown', (e) => this.onAreaStart(e));
    this.area.addEventListener('touchstart', (e) => this.onAreaStart(e), { passive: false });

    // Resize handles
    this.area.querySelectorAll('.crop-handle').forEach(handle => {
      handle.addEventListener('mousedown', (e) => this.onHandleStart(e));
      handle.addEventListener('touchstart', (e) => this.onHandleStart(e), { passive: false });
    });

    // Global move/end
    document.addEventListener('mousemove', (e) => this.onMove(e));
    document.addEventListener('touchmove', (e) => this.onMove(e), { passive: false });
    document.addEventListener('mouseup', () => this.onEnd());
    document.addEventListener('touchend', () => this.onEnd());
  },

  onAreaStart(e) {
    // Ignore if clicking a handle
    if (e.target.classList.contains('crop-handle')) return;
    e.preventDefault();
    e.stopPropagation();

    const pos = this.getPos(e);
    this.state.dragging = true;
    this.state.startX = pos.x;
    this.state.startY = pos.y;
    this.state.startLeft = this.area.offsetLeft;
    this.state.startTop = this.area.offsetTop;
  },

  onHandleStart(e) {
    e.preventDefault();
    e.stopPropagation();

    const pos = this.getPos(e);
    const handle = e.target.closest('.crop-handle');
    const rect = this.area.getBoundingClientRect();
    const wrapperRect = this.wrapper.getBoundingClientRect();

    this.state.resizing = true;
    this.state.activeHandle = handle.dataset.handle;
    this.state.startX = pos.x;
    this.state.startY = pos.y;
    this.state.startLeft = rect.left - wrapperRect.left;
    this.state.startTop = rect.top - wrapperRect.top;
    this.state.startWidth = rect.width;
    this.state.startHeight = rect.height;

    this.showMagnifier(pos.x - wrapperRect.left, pos.y - wrapperRect.top);
  },

  onMove(e) {
    if (!this.state.dragging && !this.state.resizing) return;
    e.preventDefault();

    const pos = this.getPos(e);
    const wrapperRect = this.wrapper.getBoundingClientRect();
    const canvasRect = this.canvas.getBoundingClientRect();
    const maxX = canvasRect.width;
    const maxY = canvasRect.height;

    if (this.state.dragging) {
      const dx = pos.x - this.state.startX;
      const dy = pos.y - this.state.startY;
      
      let newLeft = this.state.startLeft + dx;
      let newTop = this.state.startTop + dy;

      // Clamp to canvas area
      newLeft = Math.max(0, Math.min(newLeft, maxX - this.area.offsetWidth));
      newTop = Math.max(0, Math.min(newTop, maxY - this.area.offsetHeight));

      this.area.style.left = newLeft + 'px';
      this.area.style.top = newTop + 'px';
    }

    if (this.state.resizing) {
      const dx = pos.x - this.state.startX;
      const dy = pos.y - this.state.startY;
      const handle = this.state.activeHandle;

      let newLeft = this.state.startLeft;
      let newTop = this.state.startTop;
      let newWidth = this.state.startWidth;
      let newHeight = this.state.startHeight;

      if (handle.includes('r')) {
        newWidth = Math.max(this.state.minSize, Math.min(this.state.startWidth + dx, maxX - newLeft));
      }
      if (handle.includes('l')) {
        const delta = dx;
        newWidth = Math.max(this.state.minSize, this.state.startWidth - delta);
        newLeft = this.state.startLeft + (this.state.startWidth - newWidth);
      }
      if (handle.includes('b')) {
        newHeight = Math.max(this.state.minSize, Math.min(this.state.startHeight + dy, maxY - newTop));
      }
      if (handle.includes('t')) {
        const delta = dy;
        newHeight = Math.max(this.state.minSize, this.state.startHeight - delta);
        newTop = this.state.startTop + (this.state.startHeight - newHeight);
      }

      // Maintain minimum size
      if (newLeft < 0) { newLeft = 0; }
      if (newTop < 0) { newTop = 0; }
      if (newWidth < this.state.minSize) newWidth = this.state.minSize;
      if (newHeight < this.state.minSize) newHeight = this.state.minSize;

      this.area.style.left = newLeft + 'px';
      this.area.style.top = newTop + 'px';
      this.area.style.width = newWidth + 'px';
      this.area.style.height = newHeight + 'px';

      // Update magnifier position near the handle being dragged
      this.updateMagnifier(newLeft, newTop, newWidth, newHeight, handle);
    }
  },

  onEnd() {
    this.state.dragging = false;
    this.state.resizing = false;
    this.state.activeHandle = null;
    this.hideMagnifier();
  },

  getPos(e) {
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  },

  showMagnifier(x, y) {
    if (!this.magnifier) return;
    this.magnifier.style.display = 'block';
    this.magnifier.style.left = (x - 60) + 'px';
    this.magnifier.style.top = (y - 140) + 'px';

    // Show zoomed canvas content
    const canvasRect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / canvasRect.width;
    const scaleY = this.canvas.height / canvasRect.height;
    const cx = (x - canvasRect.left) * scaleX;
    const cy = (y - canvasRect.top) * scaleY;

    this.magnifier.style.backgroundImage = `url(${this.canvas.toDataURL()})`;
    this.magnifier.style.backgroundSize = `${canvasRect.width * scaleX}px ${canvasRect.height * scaleY}px`;
    this.magnifier.style.backgroundPosition = `-${x - 60}px -${y - 140}px`;
  },

  updateMagnifier(left, top, width, height, handle) {
    if (!this.magnifier) return;

    let x, y;
    if (handle === 'tl') { x = left; y = top; }
    else if (handle === 'tr') { x = left + width; y = top; }
    else if (handle === 'bl') { x = left; y = top + height; }
    else if (handle === 'br') { x = left + width; y = top + height; }

    this.magnifier.style.left = (x - 60) + 'px';
    this.magnifier.style.top = (y - 180) + 'px';

    const canvasRect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / canvasRect.width;
    const scaleY = this.canvas.height / canvasRect.height;
    const cx = (x - canvasRect.left) * scaleX;
    const cy = (y - canvasRect.top) * scaleY;

    this.magnifier.style.backgroundPosition = `-${cx * (120 / 30)}px -${cy * (120 / 30)}px`;
  },

  hideMagnifier() {
    if (this.magnifier) this.magnifier.style.display = 'none';
  },

  getCropRect() {
    const canvasRect = this.canvas.getBoundingClientRect();
    const areaRect = this.area.getBoundingClientRect();

    const scaleX = this.canvas.width / canvasRect.width;
    const scaleY = this.canvas.height / canvasRect.height;

    return {
      x: Math.round((areaRect.left - canvasRect.left) * scaleX),
      y: Math.round((areaRect.top - canvasRect.top) * scaleY),
      width: Math.round(areaRect.width * scaleX),
      height: Math.round(areaRect.height * scaleY)
    };
  },

  resetCropArea() {
    if (!this.area || !this.canvas) return;

    const canvasRect = this.canvas.getBoundingClientRect();
    
    // Set crop area to full canvas with padding
    const padding = Math.min(canvasRect.width, canvasRect.height) * 0.05;
    
    this.area.style.left = padding + 'px';
    this.area.style.top = padding + 'px';
    this.area.style.width = (canvasRect.width - padding * 2) + 'px';
    this.area.style.height = (canvasRect.height - padding * 2) + 'px';
  }
};
