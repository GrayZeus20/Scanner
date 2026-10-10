const camera = {
  stream: null,
  _video: null,
  captureHandlerBound: false,
  capturedCount: 0,
  flashMode: 'off', // 'off' | 'auto' | 'on'
  facingMode: 'environment',

  // Live edge overlay state
  _overlayCanvas: null,
  _overlayCtx: null,
  _overlayActive: false,
  _overlayRafId: null,
  _lastDetectTime: 0,
  _DETECT_INTERVAL: 100, // ~10fps detection (not every frame)
  _smoothedCorners: null, // EMA smoothed corners
  _SMOOTH_ALPHA: 0.35, // Exponential moving average factor

  get video() {
    if (!this._video) this._video = document.getElementById('video');
    return this._video;
  },

  bindCaptureHandler() {
    if (this.captureHandlerBound) return;
    document.getElementById('captureBtn').addEventListener('click', () => this.capture());
    document.getElementById('finishCamera').addEventListener('click', () => this.finish());
    document.getElementById('cancelCamera').addEventListener('click', () => this.cancel());
    document.getElementById('flashToggle').addEventListener('click', () => this.toggleFlash());
    
    const cameraToggle = document.getElementById('cameraToggle');
    if (cameraToggle) {
      cameraToggle.addEventListener('click', () => this.toggleFacing());
    }

    const videoContainer = document.getElementById('cameraView');
    videoContainer.addEventListener('click', (e) => {
      const t = e.target;
      if (t.id === 'captureBtn' || t.id === 'finishCamera' || t.id === 'cancelCamera' || t.id === 'flashToggle' || t.id === 'cameraToggle') return;
      if (t.closest('.capture-preview')) {
        this.cancel();
        return;
      }
      if (t.closest('.camera-action-btn') || t.closest('.flash-btn') || t.closest('.camera-switch-btn')) return;
      this.tapToFocus(e);
    });
    
    this.captureHandlerBound = true;
  },

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      if (!window.isSecureContext) {
        this.showError('notSecure');
      } else {
        this.showError('unsupported');
      }
      return;
    }

    this.capturedCount = 0;
    try {
      const constraints = {
        video: { 
          facingMode: this.facingMode,
          width: { ideal: 4096 },
          height: { ideal: 2160 }
        } 
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;
      
      await new Promise((resolve, reject) => {
        if (this.video.readyState >= 2) {
          resolve();
        } else {
          const timer = setTimeout(() => {
            this.video.removeEventListener('loadedmetadata', handler);
            this.stop();
            reject(new Error('Timeout waiting for metadata'));
          }, 5000);

          const handler = () => {
            clearTimeout(timer);
            resolve();
          };
          this.video.addEventListener('loadedmetadata', handler, { once: true });
        }
      });

      this.applyCameraEnhancements();
      this._startOverlay();
      document.getElementById('cameraView').classList.remove('hidden');
      document.getElementById('editorArea')?.classList.add('hidden');
      document.getElementById('bottomNav')?.classList.add('hidden');
      document.getElementById('homeBackBtn')?.classList.add('hidden');
      document.getElementById('emptyState')?.classList.add('hidden');
      lucide.createIcons();
    } catch (err) {
      console.error(err);
      if (err?.name === 'NotFoundError') {
        this.showError('notFound');
      } else if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
        this.showError('permissionDenied');
      } else if (!window.isSecureContext) {
        this.showError('notSecure');
      } else {
        this.showError('unsupported');
      }
    }
  },

  async applyCameraEnhancements() {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return;

    try {
      const capabilities = track.getCapabilities();
      const advancedConstraints = [];

      const flashBtn = document.getElementById('flashToggle');
      if (capabilities.torch) {
        flashBtn.classList.remove('hidden');
      } else {
        flashBtn.classList.add('hidden');
      }

      if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
        advancedConstraints.push({ focusMode: 'continuous' });
      }

      if (capabilities.exposureMode && capabilities.exposureMode.includes('continuous')) {
        advancedConstraints.push({ exposureMode: 'continuous' });
      }
      if (capabilities.whiteBalanceMode && capabilities.whiteBalanceMode.includes('continuous')) {
        advancedConstraints.push({ whiteBalanceMode: 'continuous' });
      }

      if (advancedConstraints.length > 0) {
        await track.applyConstraints({ advanced: advancedConstraints });
      }

      this.updateFlashUI();
    } catch (err) {
      console.warn('Partial camera enhancement failed:', err);
    }
  },

  async toggleFacing() {
    this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';
    
    // Attempt to update existing stream first
    if (this.stream) {
      const track = this.stream.getVideoTracks()[0];
      try {
        await track.applyConstraints({
          facingMode: { exact: this.facingMode }
        });
        return;
      } catch (err) {
        console.warn('applyConstraints failed, falling back to restart', err);
      }
    }
    
    // Restart stream if applyConstraints is not supported or failed
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    await this.start();
  },

  async capture() {
    if (!this.video.videoWidth || !this.video.videoHeight) return;

    // Auto flash: briefly turn on torch
    const track = this.stream?.getVideoTracks()[0];
    if (this.flashMode === 'auto' && track?.getCapabilities?.()?.torch) {
      try {
        await track.applyConstraints({ advanced: [{ torch: true }] });
        await new Promise(r => setTimeout(r, 80));
      } catch (_) {}
    }

    const canvas = document.createElement('canvas');
    canvas.width = this.video.videoWidth;
    canvas.height = this.video.videoHeight;
    canvas.getContext('2d').drawImage(this.video, 0, 0);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    app.loadImageFromSrc(dataUrl);

    this.capturedCount++;
    app.showToast(t('photoCaptured') + this.capturedCount + ' ' + t('photoTaken'));

    // Turn off torch after auto flash
    if (this.flashMode === 'auto' && track?.getCapabilities?.()?.torch) {
      try {
        await track.applyConstraints({ advanced: [{ torch: false }] });
      } catch (_) {}
    }

    // Flash animation
    const flash = document.getElementById('cameraFlash');
    if (flash) {
      flash.classList.remove('flash');
      void flash.offsetWidth;
      flash.classList.add('flash');
    }

    // Update counter badge
    const counter = document.getElementById('captureCounter');
    if (counter) {
      counter.textContent = this.capturedCount;
      counter.classList.remove('hidden');
    }

    // Update thumbnail preview
    const preview = document.getElementById('capturePreview');
    const previewImg = document.getElementById('capturePreviewImg');
    if (preview && previewImg) {
      previewImg.src = dataUrl;
      preview.classList.remove('hidden');
    }
  },

  finish() {
    if (this.capturedCount > 0) {
      app.showToast(this.capturedCount + ' ' + t('photoCount'));
      // One camera burst = one session
      app.emit('session:create', {});
    }
    this.resetCameraUI();
    this.stop();
  },

  cancel() {
    if (this.capturedCount > 0) {
      app.showToast(t('captureCancelled'));
    }
    this.resetCameraUI();
    this.stop();
  },

  resetCameraUI() {
    this.capturedCount = 0;
    this.flashMode = 'off';
    const counter = document.getElementById('captureCounter');
    if (counter) {
      counter.textContent = '0';
      counter.classList.add('hidden');
    }
    const preview = document.getElementById('capturePreview');
    if (preview) {
      preview.classList.add('hidden');
    }
    this.updateFlashUI();
  },

  async toggleFlash() {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return;

    // Cycle: off → auto → on → off
    const modes = ['off', 'auto', 'on'];
    const idx = modes.indexOf(this.flashMode);
    this.flashMode = modes[(idx + 1) % modes.length];

    try {
      // Turn torch on only in 'on' mode
      await track.applyConstraints({
        advanced: [{ torch: this.flashMode === 'on' }]
      });

      this.updateFlashUI();
    } catch (err) {
      console.error('Flash error:', err);
      app.showToast(t('flashUnavailable'));
    }
  },

  updateFlashUI() {
    const flashBtn = document.getElementById('flashToggle');
    if (!flashBtn) return;

    flashBtn.classList.remove('flash-off', 'flash-auto', 'flash-on');
    flashBtn.classList.add('flash-' + this.flashMode);

    if (this.flashMode === 'off') {
      flashBtn.innerHTML = '<i data-lucide="zap-off" aria-hidden="true"></i>';
      flashBtn.setAttribute('aria-label', t('flashOff'));
    } else if (this.flashMode === 'auto') {
      flashBtn.innerHTML = '<i data-lucide="zap" aria-hidden="true"></i><span class="flash-label">A</span>';
      flashBtn.setAttribute('aria-label', t('flashAuto'));
    } else {
      flashBtn.innerHTML = '<i data-lucide="zap" aria-hidden="true"></i>';
      flashBtn.setAttribute('aria-label', t('flashOn'));
    }
    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
  },

  // ==================== Live Edge Overlay ====================

  _startOverlay() {
    if (this._overlayActive) return;
    this._overlayActive = true;
    this._smoothedCorners = null;

    this._overlayCanvas = document.getElementById('edgeOverlayCanvas');
    if (!this._overlayCanvas) return;

    this._overlayCanvas.classList.add('active');
    this._overlayCtx = this._overlayCanvas.getContext('2d');
    this._lastDetectTime = 0;

    // Match canvas size to video display size
    this._resizeOverlay();
    window.addEventListener('resize', this._resizeOverlayBound = () => this._resizeOverlay());

    this._overlayLoop(performance.now());
  },

  _stopOverlay() {
    this._overlayActive = false;
    if (this._overlayRafId) {
      cancelAnimationFrame(this._overlayRafId);
      this._overlayRafId = null;
    }
    if (this._overlayCanvas) {
      this._overlayCanvas.classList.remove('active');
      const ctx = this._overlayCanvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, this._overlayCanvas.width, this._overlayCanvas.height);
    }
    if (this._resizeOverlayBound) {
      window.removeEventListener('resize', this._resizeOverlayBound);
    }
    this._smoothedCorners = null;
  },

  _resizeOverlay() {
    if (!this._overlayCanvas || !this.video) return;
    const rect = this.video.getBoundingClientRect();
    this._overlayCanvas.width = Math.round(rect.width);
    this._overlayCanvas.height = Math.round(rect.height);
  },

  /**
   * Main overlay render loop — runs via rAF, detection throttled to ~10fps
   */
  _overlayLoop(now) {
    if (!this._overlayActive) return;

    this._overlayRafId = requestAnimationFrame((t) => this._overlayLoop(t));

    // Throttle detection to ~10fps (every 100ms)
    if (now - this._lastDetectTime < this._DETECT_INTERVAL) {
      // Still draw the last known corners (smooth animation)
      this._drawOverlay();
      return;
    }
    this._lastDetectTime = now;

    // Capture current video frame to a small work canvas
    if (!this.video.videoWidth || !this.video.videoHeight) return;

    const MAX_DETECT = 640;
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    const scale = Math.min(1, MAX_DETECT / Math.max(vw, vh));
    const dw = Math.round(vw * scale), dh = Math.round(vh * scale);

    const tmp = document.createElement('canvas');
    tmp.width = dw; tmp.height = dh;
    tmp.getContext('2d').drawImage(this.video, 0, 0, dw, dh);

    // Detect edges on the small canvas
    const result = edgeDetection.detectContour(tmp);

    if (result && result.confidence > 0.35) {
      // Scale corners back to overlay canvas coordinates
      const overlayW = this._overlayCanvas.width;
      const overlayH = this._overlayCanvas.height;
      const cxScale = overlayW / vw;
      const cyScale = overlayH / vh;

      const rawCorners = result.corners.map(p => ({
        x: p.x * cxScale,
        y: p.y * cyScale
      }));

      // Smooth corners with EMA
      this._smoothedCorners = this._smoothCorners(this._smoothedCorners, rawCorners);
    } else {
      // No detection — fade out
      this._smoothedCorners = null;
    }

    this._drawOverlay();
  },

  /**
   * Exponential moving average for corner positions (anti-jitter)
   */
  _smoothCorners(prev, next) {
    if (!prev || prev.length !== 4) return next;
    const a = this._SMOOTH_ALPHA;
    return next.map((p, i) => ({
      x: prev[i].x * (1 - a) + p.x * a,
      y: prev[i].y * (1 - a) + p.y * a
    }));
  },

  /**
   * Draw the overlay quad on the canvas
   */
  _drawOverlay() {
    const ctx = this._overlayCtx;
    if (!ctx) return;
    const w = this._overlayCanvas.width, h = this._overlayCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const corners = this._smoothedCorners;
    if (!corners || corners.length < 4) return;

    const [tl, tr, br, bl] = corners;

    // Semi-transparent fill
    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y);
    ctx.lineTo(tr.x, tr.y);
    ctx.lineTo(br.x, br.y);
    ctx.lineTo(bl.x, bl.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(37, 99, 235, 0.12)';
    ctx.fill();

    // Solid stroke
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.9)';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Corner dots
    ctx.fillStyle = 'rgba(37, 99, 235, 1)';
    for (const p of corners) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // White center dot on each corner
    ctx.fillStyle = '#fff';
    for (const p of corners) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  stop() {
    this._stopOverlay();
    if (this.stream) {
      // Ensure torch is off before stopping
      const track = this.stream?.getVideoTracks()[0];
      if (track?.applyConstraints) {
        track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
      }
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
    this.flashMode = 'off';
    this.facingMode = 'environment';
    document.getElementById('cameraView')?.classList.add('hidden');
    if (app.state.imageLoaded) {
      document.getElementById('editorArea')?.classList.remove('hidden');
      document.getElementById('bottomNav')?.classList.remove('hidden');
      document.getElementById('homeBackBtn')?.classList.remove('hidden');
    } else {
      // never surface emptyState on top of an open riwayat (double-view during import)
      if (document.getElementById('historyView')?.classList.contains('hidden')) {
        document.getElementById('emptyState')?.classList.remove('hidden');
      }
      document.getElementById('bottomNav')?.classList.add('hidden');
      document.getElementById('homeBackBtn')?.classList.add('hidden');
    }
  },

  tapToFocus(e) {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    const indicator = document.getElementById('focusIndicator');
    if (indicator) {
      indicator.style.left = `${e.clientX - rect.left}px`;
      indicator.style.top = `${e.clientY - rect.top}px`;
      indicator.classList.remove('hidden');
      indicator.classList.add('active');
      setTimeout(() => {
        indicator.classList.remove('active');
        indicator.classList.add('hidden');
      }, 800);
    }

    try {
      if (typeof track.getCapabilities === 'function') {
        const caps = track.getCapabilities();
        if (caps.focusMode && caps.focusMode.includes('continuous')) {
          const vw = this.video.videoWidth;
          const vh = this.video.videoHeight;
          const cw = rect.width;
          const ch = rect.height;

          const scale = Math.max(cw / vw, ch / vh);
          const displayedW = vw * scale;
          const displayedH = vh * scale;
          const offsetX = (cw - displayedW) / 2;
          const offsetY = (ch - displayedH) / 2;

          const sx = Math.max(0, Math.min(1, (x * cw - offsetX) / displayedW));
          const sy = Math.max(0, Math.min(1, (y * ch - offsetY) / displayedH));

          track.applyConstraints({
            advanced: [{
              focusMode: 'continuous',
              pointsOfInterest: [{ x: sx, y: sy }]
            }]
          });
        }
      }
    } catch (err) {
      console.warn('Focus re-trigger failed:', err);
    }
  },

  showError(type) {
    const key = type === 'notFound' ? 'cameraNotFound' : type === 'permissionDenied' ? 'cameraPermissionDenied' : type === 'notSecure' ? 'cameraNotSecure' : 'cameraUnsupported';
    app.showToast(t(key));
  }
};
