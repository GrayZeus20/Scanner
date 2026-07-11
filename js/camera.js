const camera = {
  stream: null,
  video: document.getElementById('video'),
  captureHandlerBound: false,
  capturedCount: 0,
  isTorchOn: false,
  facingMode: 'environment',

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
      if (t.id === 'captureBtn' || t.id === 'finishCamera' || t.id === 'cancelCamera' || t.id === 'flashToggle' || t.id === 'cameraToggle' || t.closest('#captureBtn') || t.closest('.camera-action-btn') || t.closest('.flash-btn')) return;
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
          width: { ideal: 1920 },
          height: { ideal: 1080 }
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
    } catch (err) {
      console.warn('Partial camera enhancement failed:', err);
    }
  },

  async toggleFacing() {
    this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';
    const cameraToggle = document.getElementById('cameraToggle');
    if (cameraToggle) {
      cameraToggle.classList.toggle('active', this.facingMode === 'user');
    }
    const track = this.stream?.getVideoTracks()[0];
    if (track) {
      await track.applyConstraints({ facingMode: this.facingMode });
    } else {
      this.stop();
      this.start();
    }
  },

  capture() {
    if (!this.video.videoWidth || !this.video.videoHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = this.video.videoWidth;
    canvas.height = this.video.videoHeight;
    canvas.getContext('2d').drawImage(this.video, 0, 0);

    const dataUrl = canvas.toDataURL('image/jpeg');
    app.loadImageFromSrc(dataUrl);
    
    this.capturedCount++;
    app.showToast(t('photoCaptured') + this.capturedCount + ' ' + t('photoTaken'));
    
    const video = document.getElementById('video');
    video.style.opacity = '0.5';
    setTimeout(() => { video.style.opacity = '1'; }, 100);
  },

  finish() {
    if (this.capturedCount > 0) {
      app.showToast(this.capturedCount + ' ' + t('photoCount'));
    }
    if (this.isTorchOn) this.toggleFlash();
    this.stop();
  },

  cancel() {
    if (this.capturedCount > 0) {
      app.showToast(t('captureCancelled'));
    }
    if (this.isTorchOn) this.toggleFlash();
    this.stop();
  },

  async toggleFlash() {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return;

    try {
      this.isTorchOn = !this.isTorchOn;
      await track.applyConstraints({
        advanced: [{ torch: this.isTorchOn }]
      });
      
      const flashBtn = document.getElementById('flashToggle');
      flashBtn.classList.toggle('active', this.isTorchOn);
      flashBtn.innerHTML = this.isTorchOn ? '<i data-lucide="zap" aria-hidden="true"></i>' : '<i data-lucide="zap-off" aria-hidden="true"></i>';
      if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    } catch (err) {
      console.error('Torch error:', err);
      app.showToast(t('flashUnavailable'));
    }
  },

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
    this.facingMode = 'environment';
    document.getElementById('cameraView')?.classList.add('hidden');
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
