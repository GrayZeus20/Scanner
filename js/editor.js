const editor = {
  canvas: document.getElementById('mainCanvas'),
  ctx: document.getElementById('mainCanvas').getContext('2d'),

  applyFilters() {
    const { brightness, contrast, saturation, grayscale, bw, threshold } = app.state.filters;
    const imageData = app.state.currentImage;
    const data = imageData.data;

    // Apply basic filters using Canvas 2D filters
    this.ctx.filter = `
      brightness(${100 + brightness}%)
      contrast(${100 + contrast}%)
      saturate(${100 + saturation}%)
      ${grayscale ? 'grayscale(100%)' : ''}
    `;

    this.ctx.drawImage(app.state.originalImage, 0, 0);

    if (bw) {
      this.applyBW(threshold);
    }
  },

  applyBW(threshold) {
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const val = avg > threshold ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = val;
    }
    this.ctx.putImageData(imageData, 0, 0);
  },

  rotate(deg) {
    // Basic rotation logic for now
  }
};
