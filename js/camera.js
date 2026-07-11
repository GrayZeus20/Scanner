const camera = {
  stream: null,
  video: document.getElementById('video'),
  captureHandlerBound: false,
  capturedCount: 0,

  bindCaptureHandler() {
    if (this.captureHandlerBound) return;
    document.getElementById('captureBtn').addEventListener('click', () => this.capture());
    document.getElementById('finishCamera').addEventListener('click', () => this.finish());
    document.getElementById('cancelCamera').addEventListener('click', () => this.cancel());
    
    // Add Tap to Focus behavior
    const videoContainer = document.getElementById('cameraView');
    videoContainer.addEventListener('click', (e) => {
      const t = e.target;
      if (t.id === 'captureBtn' || t.id === 'finishCamera' || t.id === 'cancelCamera' || t.closest('#captureBtn') || t.closest('.camera-action-btn')) return;
      this.tapToFocus(e);
    });
    
    this.captureHandlerBound = true;
  },

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.showError('unsupported');
      return;
    }

    this.capturedCount = 0;
    try {
      const constraints = {
        video: { 
          facingMode: 'environment',
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
        console.log('Camera enhancements applied (Continuous Focus Enabled)');
      }
    } catch (err) {
      console.warn('Partial camera enhancement failed:', err);
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
    app.showToast('Foto ke-' + this.capturedCount + ' diambil');
    
    // Flash effect
    const video = document.getElementById('video');
    video.style.opacity = '0.5';
    setTimeout(() => { video.style.opacity = '1'; }, 100);
  },

  finish() {
    if (this.capturedCount > 0) {
      app.showToast(this.capturedCount + ' foto berhasil disimpan');
    }
    this.stop();
  },

  cancel() {
    if (this.capturedCount > 0) {
      app.showToast('Pengambilan dibatalkan');
    }
    this.stop();
  },

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
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
    const key = type === 'notFound' ? 'cameraNotFound' : type === 'permissionDenied' ? 'cameraPermissionDenied' : 'cameraUnsupported';
    app.showToast(t(key));
  }
};
