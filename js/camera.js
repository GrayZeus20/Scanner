const camera = {
  stream: null,
  video: document.getElementById('video'),
  captureHandlerBound: false,

  bindCaptureHandler() {
    if (this.captureHandlerBound) return;
    document.getElementById('captureBtn').addEventListener('click', () => this.capture());
    this.captureHandlerBound = true;
  },

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.showError('unsupported');
      return;
    }

    try {
      // Try to get the highest resolution possible for better detail
      const constraints = {
        video: { 
          facingMode: 'environment',
          width: { max: 4096 },
          height: { max: 4096 }
        } 
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;
      document.getElementById('cameraView').classList.remove('hidden');

      // Apply continuous auto-focus and high quality settings
      this.applyCameraEnhancements();
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
      const settings = {};

      // 1. Continuous Auto-Focus
      if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
        settings.focusMode = 'continuous';
      }

      // 2. High Resolution Constraint (try to override if supported)
      if (capabilities.width && capabilities.width.max) {
        settings.width = { ideal: capabilities.width.max };
      }
      if (capabilities.height && capabilities.height.max) {
        settings.height = { ideal: capabilities.height.max };
      }

      // 3. Exposure and White Balance for better clarity
      if (capabilities.exposureMode && capabilities.exposureMode.includes('continuous')) {
        settings.exposureMode = 'continuous';
      }
      if (capabilities.whiteBalanceMode && capabilities.whiteBalanceMode.includes('continuous')) {
        settings.whiteBalanceMode = 'continuous';
      }

      await track.applyConstraints({ advanced: [settings] });
      console.log('Camera enhancements applied:', settings);
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

    this.stop();
    document.getElementById('cameraView').classList.add('hidden');
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

  showError(type) {
    const key = type === 'notFound' ? 'cameraNotFound' : type === 'permissionDenied' ? 'cameraPermissionDenied' : 'cameraUnsupported';
    app.showToast(t(key));
  }
};
