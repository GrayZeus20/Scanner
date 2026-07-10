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
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      this.video.srcObject = this.stream;
      document.getElementById('cameraView').classList.remove('hidden');
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
