const camera = {
  stream: null,
  video: document.getElementById('video'),

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      this.video.srcObject = this.stream;
      document.getElementById('cameraView').classList.remove('hidden');
      document.getElementById('captureBtn').addEventListener('click', () => this.capture());
    } catch (err) {
      console.error(err);
      alert(t('permissionDenied'));
    }
  },

  capture() {
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
    }
  }
};
