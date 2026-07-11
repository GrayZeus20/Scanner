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
      this.stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        } 
      });
      this.video.srcObject = this.stream;
      document.getElementById('cameraView').classList.remove('hidden');

      // Attempt to enable continuous auto-focus
      this.applyAutoFocus();
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

  async applyAutoFocus() {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return;

    try {
      const capabilities = track.getCapabilities();
      if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
        await track.applyConstraints({
          advanced: [{ focusMode: 'continuous' }]
        });
        console.log('Continuous auto-focus enabled');
      }
    } catch (err) {
      console.warn('Auto-focus not supported on this device:', err);
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
