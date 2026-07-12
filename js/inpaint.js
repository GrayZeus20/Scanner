const inpaint = {
  overlay: null,
  maskCanvas: null,
  maskCtx: null,
  wrapper: null,
  canvas: null,
  brushSize: 30,
  isDrawing: false,
  initialized: false,

  init() {
    this.overlay = document.getElementById('inpaintOverlay');
    this.maskCanvas = document.getElementById('maskCanvas');
    this.maskCtx = this.maskCanvas.getContext('2d');
    this.wrapper = document.getElementById('canvasWrapper');
    this.canvas = document.getElementById('mainCanvas');

    if (this.initialized) return;
    this.initialized = true;

    // Drawing events
    const startDraw = (e) => this.onStart(e);
    const draw = (e) => this.onMove(e);
    const endDraw = () => this.onEnd();

    this.maskCanvas.addEventListener('mousedown', startDraw);
    this.maskCanvas.addEventListener('touchstart', startDraw, { passive: false });

    document.addEventListener('mousemove', draw);
    document.addEventListener('touchmove', draw, { passive: false });
    document.addEventListener('mouseup', endDraw);
    document.addEventListener('touchend', endDraw);

    // Brush size control
    const brushSlider = document.getElementById('brushSizeSlider');
    brushSlider.addEventListener('input', (e) => {
      this.brushSize = parseInt(e.target.value);
      document.getElementById('brushSizeVal').textContent = this.brushSize;
    });
  },

  reset() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const w = this.canvas.width;
    const h = this.canvas.height;

    this.maskCanvas.width = w;
    this.maskCanvas.height = h;
    
    // Fill with transparent black (mask is black=background, white=inpaint)
    // Actually, SD inpainting usually expects white mask for inpainting area
    this.maskCtx.fillStyle = 'black';
    this.maskCtx.fillRect(0, 0, w, h);

    const canvasRect = this.canvas.getBoundingClientRect();
    const wrapperRect = this.wrapper.getBoundingClientRect();
    this.maskCanvas.style.width = canvasRect.width + 'px';
    this.maskCanvas.style.height = canvasRect.height + 'px';
    this.maskCanvas.style.left = (canvasRect.left - wrapperRect.left) + 'px';
    this.maskCanvas.style.top = (canvasRect.top - wrapperRect.top) + 'px';
  },

  onStart(e) {
    this.isDrawing = true;
    this.onMove(e);
  },

  onMove(e) {
    if (!this.isDrawing) return;
    e.preventDefault();

    const pos = this.getPos(e);
    const rect = this.maskCanvas.getBoundingClientRect();
    const scaleX = this.maskCanvas.width / rect.width;
    const scaleY = this.maskCanvas.height / rect.height;

    const x = (pos.x - rect.left) * scaleX;
    const y = (pos.y - rect.top) * scaleY;

    this.maskCtx.fillStyle = 'white';
    this.maskCtx.beginPath();
    this.maskCtx.arc(x, y, this.brushSize / 2 * scaleX, 0, Math.PI * 2);
    this.maskCtx.fill();
  },

  onEnd() {
    this.isDrawing = false;
  },

  getPos(e) {
    if (e.touches && e.touches.length > 0) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  },

  getMaskDataURL() {
    return this.maskCanvas.toDataURL('image/png');
  },

  clear() {
    this.maskCtx.fillStyle = 'black';
    this.maskCtx.fillRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
  }
};