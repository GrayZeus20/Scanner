const edgeDetection = {
  detectAndCrop(canvas, ctx) {
    const origW = canvas.width;
    const origH = canvas.height;
    const MAX_WORK = 800;
    const scale = Math.min(1, MAX_WORK / Math.max(origW, origH));

    const workCanvas = document.createElement('canvas');
    workCanvas.width = Math.round(origW * scale);
    workCanvas.height = Math.round(origH * scale);
    const workCtx = workCanvas.getContext('2d');
    workCtx.drawImage(canvas, 0, 0, workCanvas.width, workCanvas.height);

    try {
      const imageData = workCtx.getImageData(0, 0, workCanvas.width, workCanvas.height);
      const data = imageData.data;
      const w = workCanvas.width;
      const h = workCanvas.height;

      const gray = this.toGrayscale(data);
      const blurred = this.gaussianBlur(gray, w, h);
      const edges = this.sobel(blurred, w, h);
      const threshold = this.adaptiveThreshold(edges, w, h);

      let cropRect = this.findLargestRect(edges, w, h, threshold);

      if (!cropRect && threshold > 15) {
        cropRect = this.findLargestRect(edges, w, h, Math.max(10, threshold * 0.5));
      }

      if (!cropRect || cropRect.w < 20 || cropRect.h < 20) {
        return false;
      }

      const invScale = 1 / scale;
      const padding = 10;
      const cropX = Math.max(0, Math.round(cropRect.x * invScale) - padding);
      const cropY = Math.max(0, Math.round(cropRect.y * invScale) - padding);
      const cropW = Math.min(origW - cropX, Math.round(cropRect.w * invScale) + padding * 2);
      const cropH = Math.min(origH - cropY, Math.round(cropRect.h * invScale) + padding * 2);

      this.cropCanvas(canvas, ctx, { x: cropX, y: cropY, w: cropW, h: cropH });
      return true;
    } catch (err) {
      console.error('Edge detection failed:', err);
      return false;
    }
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

  adaptiveThreshold(edges, w, h) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < edges.length; i++) {
      if (edges[i] > 0) {
        sum += edges[i];
        count++;
      }
    }
    if (count === 0) return 30;
    const mean = sum / count;
    let variance = 0;
    for (let i = 0; i < edges.length; i++) {
      if (edges[i] > 0) {
        variance += (edges[i] - mean) * (edges[i] - mean);
      }
    }
    variance /= count;
    return Math.max(15, Math.min(60, mean + Math.sqrt(variance) * 0.5));
  },

  findLargestRect(edges, w, h, threshold) {
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

    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  },

  cropCanvas(canvas, ctx, rect) {
    const cropped = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
    canvas.width = rect.w;
    canvas.height = rect.h;
    ctx.putImageData(cropped, 0, 0);
  }
};
