/**
 * edge-detection.js — Document boundary detection engine
 * Pipeline: grayscale → blur → threshold → morphology → contour → score → corners → warp
 *
 * Key improvements over previous version:
 * - Adaptive epsilon for Douglas-Peucker (proportional to contour perimeter)
 * - Better contour scoring (weighted rectangularity + minAreaRect fit)
 * - Dual-threshold Otsu (tries both light-on-dark AND dark-on-light)
 * - Invert detection: tries original, then inverted, picks best
 */
const edgeDetection = {

  // ==================== PUBLIC API ====================

  /**
   * Original bounding-box crop (backward compat for app.autoCrop)
   */
  detectAndCrop(canvas, ctx) {
    const origW = canvas.width, origH = canvas.height;
    const MAX_WORK = 800;
    const scale = Math.min(1, MAX_WORK / Math.max(origW, origH));

    const work = document.createElement('canvas');
    work.width = Math.round(origW * scale);
    work.height = Math.round(origH * scale);
    const wCtx = work.getContext('2d');
    wCtx.drawImage(canvas, 0, 0, work.width, work.height);

    try {
      const data = wCtx.getImageData(0, 0, work.width, work.height).data;
      const w = work.width, h = work.height;
      const gray = this.toGrayscale(data);
      const blurred = this.gaussianBlur5(gray, w, h);
      const edges = this.sobel(blurred, w, h);
      const threshold = this.adaptiveThreshold(edges, w, h);
      let rect = this.findLargestRect(edges, w, h, threshold);
      if (!rect && threshold > 15) rect = this.findLargestRect(edges, w, h, Math.max(10, threshold * 0.5));
      if (!rect || rect.w < 20 || rect.h < 20) return false;

      const inv = 1 / scale, pad = 10;
      const cx = Math.max(0, Math.round(rect.x * inv) - pad);
      const cy = Math.max(0, Math.round(rect.y * inv) - pad);
      const cw = Math.min(origW - cx, Math.round(rect.w * inv) + pad * 2);
      const ch = Math.min(origH - cy, Math.round(rect.h * inv) + pad * 2);
      this.cropCanvas(canvas, ctx, { x: cx, y: cy, w: cw, h: ch });
      return true;
    } catch (e) {
      console.error('Edge detection failed:', e);
      return false;
    }
  },

  /**
   * Main contour-based detection. Returns { corners, width, height, confidence } or null.
   * Tries both original and inverted threshold — picks whichever finds a better quad.
   */
  detectContour(canvas, opts = {}) {
    const origW = canvas.width, origH = canvas.height;
    const MAX_WORK = opts.relaxed ? 600 : 800;
    const scale = Math.min(1, MAX_WORK / Math.max(origW, origH));
    const w = Math.round(origW * scale), h = Math.round(origH * scale);

    const work = document.createElement('canvas');
    work.width = w; work.height = h;
    work.getContext('2d').drawImage(canvas, 0, 0, w, h);
    const data = work.getContext('2d').getImageData(0, 0, w, h).data;
    const gray = this.toGrayscale(data);
    const blurred = this.gaussianBlur5(gray, w, h);

    // Try both orientations — pick the one with higher confidence
    const resultA = this._detectFromThreshold(blurred, w, h, opts, false);
    const resultB = this._detectFromThreshold(blurred, w, h, opts, true);

    let best = null;
    if (resultA && resultB) {
      best = resultA.confidence >= resultB.confidence ? resultA : resultB;
    } else {
      best = resultA || resultB;
    }

    if (!best) return null;

    // Scale corners back to original image coords
    const inv = 1 / scale;
    best.corners = best.corners.map(p => ({ x: p.x * inv, y: p.y * inv }));
    best.width = Math.round(best.width * inv);
    best.height = Math.round(best.height * inv);
    return best;
  },

  /**
   * Internal: run one pass of detection with a specific threshold polarity.
   * @param {boolean} invert - if true, threshold is inverted (dark doc on light bg)
   */
  _detectFromThreshold(blurred, w, h, opts, invert) {
    const bw = this.otsuThreshold(blurred, w, h, opts.relaxed, invert);

    // Morphological cleanup: close gaps, then remove noise
    let processed = this.close(bw, w, h);
    processed = this.open(processed, w, h);

    const contours = this.findContours(processed, w, h);
    if (contours.length === 0) return null;

    const candidates = [];
    const imgArea = w * h;

    for (const contour of contours) {
      if (contour.length < 8) continue;

      // Adaptive epsilon: 2% of contour perimeter
      const perimeter = this.contourPerimeter(contour);
      const epsilon = Math.max(3, perimeter * 0.02);
      const simplified = this.douglasPeucker(contour, epsilon);

      // Accept 4-6 vertices (4 = perfect quad, 5-6 = slight curve/noise)
      if (simplified.length < 4 || simplified.length > 6) continue;

      // If >4, force to 4 by merging closest pair until we hit 4
      let corners = simplified;
      while (corners.length > 4) {
        corners = this._mergeClosestPair(corners);
      }
      if (corners.length !== 4) continue;

      const area = Math.abs(this.contourArea(corners));
      const bbox = this.getBoundingBox(corners);
      const bboxArea = bbox.w * bbox.h;
      if (bboxArea === 0) continue;

      // Area constraints: must be 8%-98% of image
      const areaRatio = area / imgArea;
      if (areaRatio < 0.08 || areaRatio > 0.98) continue;

      // Scoring
      let score = 0;

      // 1. Rectangularity: how close to a rectangle? (area / bbox)
      score += (area / bboxArea) * 0.35;

      // 2. Convexity: area / convex hull area
      const hull = this.convexHull(corners);
      const hullArea = Math.abs(this.contourArea(hull));
      if (hullArea > 0) score += (area / hullArea) * 0.2;

      // 3. Center bias: prefer documents near image center
      const cx = bbox.x + bbox.w / 2;
      const cy = bbox.y + bbox.h / 2;
      const distFromCenter = Math.hypot((cx - w / 2) / w, (cy - h / 2) / h);
      score += (1 - Math.min(distFromCenter, 1)) * 0.15;

      // 4. Aspect ratio penalty: paper is usually 1:1 to 1:1.5
      const aspect = Math.max(bbox.w, bbox.h) / Math.max(1, Math.min(bbox.w, bbox.h));
      if (aspect < 1 || aspect > 2.0) score *= 0.7;

      // 5. Edge margin bonus: document not touching image border = more likely real
      const margin = 0.03;
      const touchesEdge = bbox.x < w * margin || bbox.y < h * margin ||
        bbox.x + bbox.w > w * (1 - margin) || bbox.y + bbox.h > h * (1 - margin);
      if (touchesEdge) score *= 0.85;

      candidates.push({ corners, bbox, score, area });
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    // Order corners TL TR BR BL
    const ordered = this.orderCorners(best.corners);

    // Compute output dimensions
    const tl = ordered[0], tr = ordered[1], br = ordered[2], bl = ordered[3];
    const topW = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const botW = Math.hypot(br.x - bl.x, br.y - bl.y);
    const leftH = Math.hypot(bl.x - tl.x, bl.y - tl.y);
    const rightH = Math.hypot(br.x - tr.x, br.y - tr.y);
    const outW = Math.round(Math.max(topW, botW));
    const outH = Math.round(Math.max(leftH, rightH));

    if (outW < 20 || outH < 20) return null;

    return {
      corners: ordered,
      width: outW,
      height: outH,
      confidence: Math.min(1, best.score * 1.1)
    };
  },

  // ==================== Image Processing ====================

  toGrayscale(data) {
    const gray = new Uint8Array(data.length / 4);
    for (let i = 0; i < data.length; i += 4) {
      gray[i / 4] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    }
    return gray;
  },

  gaussianBlur5(gray, w, h) {
    const K = [1,4,7,4,1, 4,16,26,16,4, 7,26,41,26,7, 4,16,26,16,4, 1,4,7,4,1];
    const out = new Uint8Array(gray.length);
    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        let sum = 0, ki = 0;
        for (let ky = -2; ky <= 2; ky++)
          for (let kx = -2; kx <= 2; kx++)
            sum += gray[(y + ky) * w + (x + kx)] * K[ki++];
        out[y * w + x] = (sum / 273) | 0;
      }
    }
    return out;
  },

  sobel(gray, w, h) {
    const edges = new Uint8Array(gray.length);
    const gx = [-1,0,1,-2,0,2,-1,0,1];
    const gy = [-1,-2,-1,0,0,0,1,2,1];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let sX = 0, sY = 0, ki = 0;
        for (let ky = -1; ky <= 1; ky++)
          for (let kx = -1; kx <= 1; kx++) {
            const v = gray[(y + ky) * w + (x + kx)];
            sX += v * gx[ki]; sY += v * gy[ki]; ki++;
          }
        edges[y * w + x] = Math.min(255, Math.sqrt(sX * sX + sY * sY)) | 0;
      }
    }
    return edges;
  },

  adaptiveThreshold(edges, w, h) {
    let sum = 0, count = 0;
    for (let i = 0; i < edges.length; i++) {
      if (edges[i] > 0) { sum += edges[i]; count++; }
    }
    if (count === 0) return 30;
    const mean = sum / count;
    let variance = 0;
    for (let i = 0; i < edges.length; i++) {
      if (edges[i] > 0) variance += (edges[i] - mean) ** 2;
    }
    return Math.max(15, Math.min(60, mean + Math.sqrt(variance / count) * 0.5));
  },

  /**
   * Otsu's method with optional polarity inversion
   * @param {boolean} invert - if true, foreground=dark (document darker than bg)
   */
  otsuThreshold(gray, w, h, relaxed, invert = false) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;

    const total = gray.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];

    let sumB = 0, wB = 0, maxVar = 0, threshold = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const variance = wB * wF * (mB - mF) ** 2;
      if (variance > maxVar) { maxVar = variance; threshold = t; }
    }

    if (relaxed) threshold = Math.max(80, threshold - 20);

    const bw = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i++) {
      if (invert) {
        bw[i] = gray[i] > threshold ? 255 : 0;
      } else {
        bw[i] = gray[i] < threshold ? 255 : 0;
      }
    }
    return bw;
  },

  // ==================== Morphology ====================

  dilate(bw, w, h) {
    const out = new Uint8Array(bw.length);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (bw[i] || bw[i-1] || bw[i+1] || bw[i-w] || bw[i+w] ||
            bw[i-w-1] || bw[i-w+1] || bw[i+w-1] || bw[i+w+1]) out[i] = 255;
      }
    return out;
  },

  erode(bw, w, h) {
    const out = new Uint8Array(bw.length);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        out[i] = (bw[i] && bw[i-1] && bw[i+1] && bw[i-w] && bw[i+w]) ? 255 : 0;
      }
    return out;
  },

  close(bw, w, h) { return this.erode(this.dilate(bw, w, h), w, h); },
  open(bw, w, h) { return this.dilate(this.erode(bw, w, h), w, h); },

  // ==================== Contour Detection ====================

  findContours(bw, w, h) {
    const visited = new Uint8Array(bw.length);
    const contours = [];

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (bw[i] === 255 && !visited[i]) {
          if (bw[i-1] === 0 || bw[i+1] === 0 || bw[i-w] === 0 || bw[i+w] === 0) {
            const contour = this._traceContour(bw, visited, x, y, w, h);
            if (contour.length >= 8) contours.push(contour);
          }
        }
      }
    }
    return contours;
  },

  _traceContour(bw, visited, sx, sy, w, h) {
    const contour = [];
    const dx = [1,1,0,-1,-1,-1,0,1];
    const dy = [0,1,1,1,0,-1,-1,-1];
    let x = sx, y = sy, dir = 6, steps = 0;
    const maxSteps = w * h;

    do {
      contour.push({ x, y });
      visited[y * w + x] = 1;
      let startDir = (dir + 5) % 8, found = false;
      for (let d = 0; d < 8; d++) {
        const nd = (startDir + d) % 8;
        const nx = x + dx[nd], ny = y + dy[nd];
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && bw[ny * w + nx] === 255) {
          x = nx; y = ny; dir = nd; found = true; break;
        }
      }
      if (!found) break;
      steps++;
    } while ((x !== sx || y !== sy) && steps < maxSteps);

    return contour;
  },

  // ==================== Geometry ====================

  contourPerimeter(c) {
    let p = 0;
    for (let i = 0; i < c.length; i++) {
      const j = (i + 1) % c.length;
      p += Math.hypot(c[j].x - c[i].x, c[j].y - c[i].y);
    }
    return p;
  },

  contourArea(c) {
    let area = 0;
    for (let i = 0; i < c.length; i++) {
      const j = (i + 1) % c.length;
      area += c[i].x * c[j].y - c[j].x * c[i].y;
    }
    return area / 2;
  },

  getBoundingBox(c) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of c) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  },

  /**
   * Merge the two closest vertices in a polygon until only 4 remain.
   * This handles contours with 5-6 vertices by collapsing near-duplicate points.
   */
  _mergeClosestPair(corners) {
    let minDist = Infinity, minI = 0;
    for (let i = 0; i < corners.length; i++) {
      const j = (i + 1) % corners.length;
      const d = Math.hypot(corners[j].x - corners[i].x, corners[j].y - corners[i].y);
      if (d < minDist) { minDist = d; minI = i; }
    }
    // Merge: replace pair with their midpoint
    const i1 = minI, i2 = (minI + 1) % corners.length;
    const mid = {
      x: (corners[i1].x + corners[i2].x) / 2,
      y: (corners[i1].y + corners[i2].y) / 2
    };
    const result = [];
    for (let i = 0; i < corners.length; i++) {
      if (i === i1) result.push(mid);
      else if (i !== i2) result.push(corners[i]);
    }
    return result;
  },

  convexHull(points) {
    const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    if (pts.length <= 1) return pts;
    const cross = (O, A, B) => (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  },

  douglasPeucker(points, epsilon) {
    if (points.length <= 2) return points.slice();
    let maxDist = 0, maxIdx = 0;
    const first = points[0], last = points[points.length - 1];
    for (let i = 1; i < points.length - 1; i++) {
      const d = this._pointLineDist(points[i], first, last);
      if (d > maxDist) { maxDist = d; maxIdx = i; }
    }
    if (maxDist > epsilon) {
      const left = this.douglasPeucker(points.slice(0, maxIdx + 1), epsilon);
      const right = this.douglasPeucker(points.slice(maxIdx), epsilon);
      return left.slice(0, -1).concat(right);
    }
    return [first, last];
  },

  _pointLineDist(pt, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(pt.x - a.x, pt.y - a.y);
    const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq));
    return Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy));
  },

  /**
   * Order corners: TL, TR, BR, BL using centroid-based angle sort
   */
  orderCorners(corners) {
    const cx = corners.reduce((s, p) => s + p.x, 0) / corners.length;
    const cy = corners.reduce((s, p) => s + p.y, 0) / corners.length;
    const sorted = corners.slice().sort((a, b) =>
      Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));

    // Find top-left (smallest x+y)
    let minDist = Infinity, tlIdx = 0;
    for (let i = 0; i < sorted.length; i++) {
      const d = sorted[i].x + sorted[i].y;
      if (d < minDist) { minDist = d; tlIdx = i; }
    }

    const ordered = [];
    for (let i = 0; i < 4; i++) ordered.push(sorted[(tlIdx + i) % sorted.length]);

    // Ensure TR is to the right of TL
    if (ordered[1].x < ordered[0].x) {
      ordered.splice(0, 2, ordered[1], ordered[0]);
    }

    return ordered;
  },

  /**
   * Perspective warp — bilinear interpolation from quad to rectangle
   */
  warpPerspective(canvas, corners, outW, outH) {
    if (!corners || corners.length < 4 || outW < 1 || outH < 1) return null;

    const out = document.createElement('canvas');
    out.width = outW; out.height = outH;
    const outCtx = out.getContext('2d');

    const srcCtx = canvas.getContext('2d', { willReadFrequently: true });
    const srcData = srcCtx.getImageData(0, 0, canvas.width, canvas.height);
    const src = srcData.data;
    const srcW = canvas.width, srcH = canvas.height;

    const dstData = outCtx.createImageData(outW, outH);
    const dst = dstData.data;

    const tl = corners[0], tr = corners[1], br = corners[2], bl = corners[3];

    const sample = (sx, sy) => {
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, srcW - 1), y1 = Math.min(y0 + 1, srcH - 1);
      const fx = sx - x0, fy = sy - y0;
      const x0c = Math.max(0, x0), y0c = Math.max(0, y0);
      const i00 = (y0c * srcW + x0c) * 4, i10 = (y0c * srcW + x1) * 4;
      const i01 = (y1 * srcW + x0c) * 4, i11 = (y1 * srcW + x1) * 4;
      const iF = 1 - fx, iG = 1 - fy;
      return [
        (src[i00]*iF*iG + src[i10]*fx*iG + src[i01]*iF*fy + src[i11]*fx*fy) | 0,
        (src[i00+1]*iF*iG + src[i10+1]*fx*iG + src[i01+1]*iF*fy + src[i11+1]*fx*fy) | 0,
        (src[i00+2]*iF*iG + src[i10+2]*fx*iG + src[i01+2]*iF*fy + src[i11+2]*fx*fy) | 0
      ];
    };

    for (let dy = 0; dy < outH; dy++) {
      const t = dy / outH;
      const lX = tl.x + (bl.x - tl.x) * t, lY = tl.y + (bl.y - tl.y) * t;
      const rX = tr.x + (br.x - tr.x) * t, rY = tr.y + (br.y - tr.y) * t;
      for (let dx = 0; dx < outW; dx++) {
        const s = dx / outW;
        const sx = lX + (rX - lX) * s, sy = lY + (rY - lY) * s;
        if (sx >= 0 && sx < srcW - 1 && sy >= 0 && sy < srcH - 1) {
          const [r, g, b] = sample(sx, sy);
          const di = (dy * outW + dx) * 4;
          dst[di] = r; dst[di+1] = g; dst[di+2] = b; dst[di+3] = 255;
        }
      }
    }

    outCtx.putImageData(dstData, 0, 0);
    return out;
  },

  // ==================== Legacy helpers ====================

  findLargestRect(edges, w, h, threshold) {
    let minX = w, minY = h, maxX = 0, maxY = 0, found = false;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (edges[y * w + x] > threshold) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          found = true;
        }
    return found ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
  },

  cropCanvas(canvas, ctx, rect) {
    const cropped = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
    canvas.width = rect.w; canvas.height = rect.h;
    ctx.putImageData(cropped, 0, 0);
  }
};

window.edgeDetection = edgeDetection;
