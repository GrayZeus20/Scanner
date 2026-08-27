const camera = {
  stream: null,
  _video: null,
  captureHandlerBound: false,
  capturedCount: 0,
  flashMode: 'off', // 'off' | 'auto' | 'on'
  facingMode: 'environment',

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
      document.getElementById('cameraView').classList.remove('hidden');
      document.getElementById('editorArea')?.classList.add('hidden');
      document.getElementById('bottomNav')?.classList.add('hidden');
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

  stop() {
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
    } else {
      document.getElementById('emptyState')?.classList.remove('hidden');
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
