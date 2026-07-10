const edgeDetection = {
  detectAndCrop(canvas, ctx) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const w = canvas.width;
    const h = canvas.height;

    const gray = this.toGrayscale(data);
    const blurred = this.gaussianBlur(gray, w, h);
    const edges = this.sobel(blurred, w, h);
    const cropRect = this.findLargestRect(edges, w, h);

    if (cropRect) {
      this.cropCanvas(canvas, ctx, cropRect);
      return true;
    }
    return false;
  },

  toGrayscale(data) {
    const gray = new Uint8Array(data.length / 4);
    for (let i = 0; i < data.length; i += 4) {
      gray[i / 4] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    }
    return gray;
  },

  gaussianBlur(gray, w, h) {
    const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];
    const blurred = new Uint8Array(gray.length);

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let sum = 0;
        let ki = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            sum += gray[(y + ky) * w + (x + kx)] * kernel[ki++];
          }
        }
        blurred[y * w + x] = (sum / 16) | 0;
      }
    }
    return blurred;
  },

  sobel(gray, w, h) {
    const edges = new Uint8Array(gray.length);
    const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let sumX = 0, sumY = 0, ki = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const val = gray[(y + ky) * w + (x + kx)];
            sumX += val * gx[ki];
            sumY += val * gy[ki];
            ki++;
          }
        }
        edges[y * w + x] = Math.min(255, Math.sqrt(sumX * sumX + sumY * sumY)) | 0;
      }
    }
    return edges;
  },

  findLargestRect(edges, w, h) {
    const threshold = 30;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    let found = false;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (edges[y * w + x] > threshold) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          found = true;
        }
      }
    }

    if (!found) return null;

    const padding = 10;
    const x = Math.max(0, minX - padding);
    const y = Math.max(0, minY - padding);
    const w = Math.max(1, Math.min(canvas.width - x, maxX - minX + padding * 2));
    const h = Math.max(1, Math.min(canvas.height - y, maxY - minY + padding * 2));
    return { x, y, w, h };
  },

  cropCanvas(canvas, ctx, rect) {
    const cropped = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
    canvas.width = rect.w;
    canvas.height = rect.h;
    ctx.putImageData(cropped, 0, 0);
  }
};
