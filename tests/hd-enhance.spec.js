const { test, expect } = require('@playwright/test');

/**
 * HD Upscale pipeline (photo/meme text-safe + document ink)
 *
 * Fokus test: "logika HD"-nya tidak boleh merusak gambar.
 *  - teks/tepi harus makin tegas (slope tepi naik)
 *  - area datar / gradient kulit tidak boleh ikut ditajamkan (delta ~0)
 *  - implementasi streaming (ring buffer) harus sama dengan referensi full-array
 */
test.describe('HD Upscale pipeline', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => window.MLDetector && window.MLDetector.enhanceHD);
  });

  test('photo mode: streaming luma pass == full-array reference math', async ({ page }) => {
    const diff = await page.evaluate(() => {
      const w = 97;
      const h = 61;
      const src = document.createElement('canvas');
      src.width = w;
      src.height = h;
      const sctx = src.getContext('2d');
      // pseudo-random tapi deterministik (pola kotak + noise) supaya semua radius teruji
      const img = sctx.createImageData(w, h);
      let seed = 12345;
      const rnd = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const block = (Math.floor(x / 7) + Math.floor(y / 5)) % 2 ? 90 : 200;
          const n = rnd() * 14 - 7;
          img.data[i] = block + n;
          img.data[i + 1] = block * 0.85 + n;
          img.data[i + 2] = block * 0.7 + n;
          img.data[i + 3] = 255;
        }
      }
      sctx.putImageData(img, 0, 0);

      const M = window.MLDetector;

      // --- implementasi yang dipakai app ---
      const actual = document.createElement('canvas');
      actual.width = w;
      actual.height = h;
      const actx = actual.getContext('2d', { willReadFrequently: true });
      actx.drawImage(src, 0, 0);
      M._photoTextSafePass(actx, w, h);

      // --- referensi: full-array box mean + rumus yang sama ---
      const ref = document.createElement('canvas');
      ref.width = w;
      ref.height = h;
      const rctx = ref.getContext('2d', { willReadFrequently: true });
      rctx.drawImage(src, 0, 0);
      const rImg = rctx.getImageData(0, 0, w, h);
      const rd = rImg.data;
      const n = w * h;
      const Y = new Float32Array(n);
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        Y[i] = 0.299 * rd[p] + 0.587 * rd[p + 1] + 0.114 * rd[p + 2];
      }
      const low3 = M._boxMean(Y, w, h, 1);
      const low5 = M._boxMean(Y, w, h, 2);
      const low9 = M._boxMean(Y, w, h, 4);
      // CATATAN: angka di bawah harus sama dengan default di
      // MLDetector._photoTextSafePass (P = {...}).
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const c = Y[i];
          const det3 = c - low3[i];
          const det5 = c - low5[i];
          const det9 = c - low9[i];
          const ad3 = Math.abs(det3);
          const ad5 = Math.abs(det5);
          const ad9 = Math.abs(det9);
          let lum = c;

          let wA = (ad5 - 2) / 5;
          if (wA < 0) wA = 0; else if (wA > 1) wA = 1;
          let wB = (ad9 - 5) / 8;
          if (wB < 0) wB = 0; else if (wB > 1) wB = 1;
          let wt = wA < wB ? wA : wB;
          wt = wt * wt * (3 - 2 * wt);

          if (wt > 0) {
            const l = Y[y * w + Math.max(0, x - 1)];
            const r = Y[y * w + Math.min(w - 1, x + 1)];
            const u = Y[Math.max(0, y - 1) * w + x];
            const dn = Y[Math.min(h - 1, y + 1) * w + x];
            const lo = Math.min(c, l, r, u, dn);
            const hi = Math.max(c, l, r, u, dn);
            lum = c + det3 * 3.2 * wt + det5 * 1.6 * wt + det9 * 0.6 * wt;
            const m = 4 + 20 * wt;
            if (lum < lo - m) lum = lo - m;
            else if (lum > hi + m) lum = hi + m;
          } else if (ad3 < 3 && ad9 < 7) {
            lum = c - det9 * 0.75;
          }
          const delta = lum - c;
          const p = i * 4;
          rd[p] += delta;
          rd[p + 1] += delta;
          rd[p + 2] += delta;
        }
      }
      rctx.putImageData(rImg, 0, 0);

      const a = actx.getImageData(0, 0, w, h).data;
      const b = rctx.getImageData(0, 0, w, h).data;
      let maxDiff = 0;
      for (let i = 0; i < a.length; i++) {
        if (i % 4 === 3) continue; // alpha tidak disentuh
        const dd = Math.abs(a[i] - b[i]);
        if (dd > maxDiff) maxDiff = dd;
      }
      return maxDiff;
    });

    expect(diff).toBeLessThanOrEqual(2);
  });

  test('photo mode: text edges get crisper, skin gradient stays untouched', async ({ page }) => {
    const m = await page.evaluate(async () => {
      const w = 240;
      const h = 160;
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d', { willReadFrequently: true });

      // Kiri: gradient "kulit" (halus). Kanan: teks tebal putih + stroke hitam.
      const grad = ctx.createLinearGradient(0, 0, 120, h);
      grad.addColorStop(0, 'rgb(200,155,125)');
      grad.addColorStop(1, 'rgb(150,105,80)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 120, h);

      ctx.fillStyle = '#2b2b2b';
      ctx.fillRect(120, 0, 120, h);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 44px Arial, sans-serif';
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#000';
      ctx.fillStyle = '#fff';
      ctx.strokeText('HD', 180, 60);
      ctx.fillText('HD', 180, 60);

      // Sumber dibuat sedikit blur (seperti screenshot meme yang di-compress),
      // supaya ketajaman punya ruang untuk naik dan tidak mentok di kontras maksimum.
      const soft = document.createElement('canvas');
      soft.width = w;
      soft.height = h;
      const sctx = soft.getContext('2d', { willReadFrequently: true });
      sctx.filter = 'blur(1px)';
      sctx.drawImage(cv, 0, 0);
      sctx.filter = 'none';

      const before = sctx.getImageData(0, 0, w, h);
      const luma = (data, i) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const beforeY = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) beforeY[i] = luma(before.data, i * 4);

      const out = await window.MLDetector.enhanceHD(soft, { mode: 'photo', scale: 2 });
      const oc = out.canvas.getContext('2d', { willReadFrequently: true });
      const afterData = oc.getImageData(0, 0, out.width, out.height);
      const afterY = new Float32Array(out.width * out.height);
      for (let i = 0; i < out.width * out.height; i++) afterY[i] = luma(afterData.data, i * 4);

      // baseline pembanding: upscale biasa (tanpa pipeline HD) pada ukuran yang sama
      const base = document.createElement('canvas');
      base.width = out.width;
      base.height = out.height;
      const bctx = base.getContext('2d', { willReadFrequently: true });
      bctx.imageSmoothingEnabled = true;
      bctx.imageSmoothingQuality = 'high';
      bctx.drawImage(soft, 0, 0, out.width, out.height);
      const baseData = bctx.getImageData(0, 0, out.width, out.height);
      const baseY = new Float32Array(out.width * out.height);
      for (let i = 0; i < out.width * out.height; i++) baseY[i] = luma(baseData.data, i * 4);

      // 1) gradient kulit (area datar) -> delta maksimum harus ~0 (tidak ada grain/halo)
      let maxSkinDelta = 0;
      for (let y = 8; y < 150; y++) {
        for (let x = 12; x < 220; x++) {
          const i = y * out.width + x;
          const d = Math.abs(afterY[i] - baseY[i]);
          if (d > maxSkinDelta) maxSkinDelta = d;
        }
      }

      // 2) ketajaman tepi teks: slope maksimum pada scanline horizontal (grid sama)
      const slope = (Y, W, y0, y1) => {
        let best = 0;
        for (let y = y0; y <= y1; y++) {
          for (let x = 1; x < W - 1; x++) {
            const g = Math.abs(Y[y * W + x + 1] - Y[y * W + x - 1]);
            if (g > best) best = g;
          }
        }
        return best;
      };
      const beforeSlope = slope(baseY, out.width, 108, 134);
      const afterSlope = slope(afterY, out.width, 108, 134);

      // 3) warna kulit tidak bergeser (mean RGB patch tengah)
      const patchMean = (data, W, x0, y0, x1, y1) => {
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * W + x) * 4;
            r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
          }
        }
        return [r / n, g / n, b / n];
      };
      const mb = patchMean(baseData.data, out.width, 80, 180, 180, 260);
      const ma = patchMean(afterData.data, out.width, 80, 180, 180, 260);
      const shift = Math.max(Math.abs(mb[0] - ma[0]), Math.abs(mb[1] - ma[1]), Math.abs(mb[2] - ma[2]));

      return {
        size: [out.width, out.height],
        maxSkinDelta,
        beforeSlope,
        afterSlope,
        shift,
        engine: out.engine,
        mode: out.mode
      };
    });

    expect(m.size).toEqual([480, 320]);
    expect(m.mode).toBe('photo');
    expect(m.engine).toBe('Text-Safe Luma Pipeline');
    // area datar tidak diutak-atik (gate smoothstep) -> toleransi kecil untuk pembulatan
    expect(m.maxSkinDelta).toBeLessThanOrEqual(6);
    // tepi teks makin tegas
    expect(m.afterSlope).toBeGreaterThan(m.beforeSlope * 1.05);
    // hue/tone kulit tidak bergeser
    expect(m.shift).toBeLessThanOrEqual(2);
  });

  test('photo mode: flat noisy area is smoothed, not amplified (unsharp only on structure)', async ({ page }) => {
    const m = await page.evaluate(async () => {
      // background gelap + grain JPEG (meniru area flat pada foto portrait/meme)
      const w = 200;
      const h = 140;
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const img = ctx.createImageData(w, h);
      let seed = 987654321;
      const rnd = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      for (let i = 0; i < w * h; i++) {
        const n = (rnd() - 0.5) * 20; // grain kasar (JPEG low quality)
        const base = 58 + n;          // abu gelap rata
        img.data[i * 4] = base;
        img.data[i * 4 + 1] = base;
        img.data[i * 4 + 2] = base;
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);

      const out = await window.MLDetector.enhanceHD(cv, { mode: 'photo', scale: 2 });

      // baseline: upscale biasa, ukuran sama
      const base = document.createElement('canvas');
      base.width = out.width;
      base.height = out.height;
      const bctx = base.getContext('2d', { willReadFrequently: true });
      bctx.imageSmoothingEnabled = true;
      bctx.imageSmoothingQuality = 'high';
      bctx.drawImage(cv, 0, 0, out.width, out.height);

      const stats = (c) => {
        const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
        let s = 0, s2 = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          s += y; s2 += y * y; n++;
        }
        const mean = s / n;
        return { mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)) };
      };
      return { base: stats(base), hd: stats(out.canvas) };
    });

    // grain tidak boleh ikut ditajamkan: std HD harus <= baseline
    expect(m.hd.std).toBeLessThanOrEqual(m.base.std * 1.02);
    // tone tetap (tidak menggelap/menerang)
    expect(Math.abs(m.hd.mean - m.base.mean)).toBeLessThanOrEqual(1.5);
  });

  test('document mode: paper whitened and ink deepened', async ({ page }) => {
    const m = await page.evaluate(async () => {
      const w = 200;
      const h = 120;
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = 'rgb(226,226,226)'; // kertas agak abu
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgb(72,72,72)';    // tinta abu gelap
      ctx.fillRect(30, 40, 140, 12);

      const out = await window.MLDetector.enhanceHD(cv, { mode: 'document', scale: 2 });
      const oc = out.canvas.getContext('2d', { willReadFrequently: true });
      const d = oc.getImageData(0, 0, out.width, out.height).data;
      const px = (x, y) => {
        const i = (y * out.width + x) * 4;
        return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      };
      return {
        paper: px(20, 20),
        ink: px(out.width / 2, Math.round(46 * 2)),
        mode: out.mode,
        size: [out.width, out.height]
      };
    });

    expect(m.mode).toBe('document');
    expect(m.size).toEqual([400, 240]);
    expect(m.paper).toBeGreaterThan(226); // kertas makin putih
    expect(m.ink).toBeLessThan(72);       // tinta makin pekat
  });

  test('auto mode detects colorful meme as photo and caps at 4096px', async ({ page }) => {
    const m = await page.evaluate(async () => {
      const mk = (w, h, colorful) => {
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = colorful ? 'rgb(196,140,110)' : 'rgb(248,248,248)';
        ctx.fillRect(0, 0, w, h);
        if (colorful) {
          ctx.fillStyle = 'rgb(20,90,180)';
          ctx.fillRect(0, 0, w, h / 3);
        }
        return cv;
      };

      const meme = mk(300, 200, true);
      const doc = mk(300, 200, false);
      const auto = await window.MLDetector.enhanceHD(meme, { mode: 'auto' });
      const docRes = await window.MLDetector.enhanceHD(doc, { mode: 'auto' });

      // 2600px source + 2x -> harus di-clamp supaya sisi terpanjang <= 4096
      const huge = mk(2600, 40, true);
      const hugeRes = await window.MLDetector.enhanceHD(huge, { mode: 'photo', scale: 4 });

      return {
        autoMode: auto.mode,
        autoScale: auto.scale,
        docMode: docRes.mode,
        hugeW: hugeRes.width,
        hugeScale: hugeRes.scale
      };
    });

    expect(m.autoMode).toBe('photo');
    expect(m.autoScale).toBe(4); // sumber <= 400px -> 4x (300*4 = 1200)
    expect(m.docMode).toBe('document');
    expect(m.hugeW).toBeLessThanOrEqual(4096);
  });

  test('UI: HD button upscales the open page and keeps edit history', async ({ page }) => {
    // buat gambar kecil lalu impor lewat #fileInput
    const dataUrl = await page.evaluate(() => {
      const cv = document.createElement('canvas');
      cv.width = 160;
      cv.height = 120;
      const ctx = cv.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 160, 120);
      g.addColorStop(0, '#d8a887');
      g.addColorStop(1, '#8a5a3d');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 160, 120);
      ctx.fillStyle = '#101010';
      ctx.fillRect(20, 90, 120, 12);
      return cv.toDataURL('image/png');
    });
    const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');

    await page.locator('#fileInput').setInputFiles({ name: 'meme.png', mimeType: 'image/png', buffer });
    await expect(page.locator('#editorArea')).not.toHaveClass(/hidden/, { timeout: 8000 });

    const before = await page.evaluate(() => {
      const c = document.getElementById('mainCanvas');
      return { w: c.width, h: c.height };
    });

    await page.click('#navTools');
    await expect(page.locator('#toolsSheet')).toBeVisible();
    await page.click('#toolHdEnhanceBtn');

    await page.waitForFunction(
      (b) => {
        const c = document.getElementById('mainCanvas');
        return c.width > b.w && c.height > b.h;
      },
      before,
      { timeout: 20000 }
    );

    const after = await page.evaluate(() => {
      const c = document.getElementById('mainCanvas');
      const page0 = window.app?.state?.pages?.[0];
      return { w: c.width, h: c.height, thumb: !!page0?.originalImage?.src, dirty: !!window.app?.state?.dirty };
    });

    expect(after.w).toBeGreaterThan(before.w);
    expect(after.h).toBeGreaterThan(before.h);
    expect(after.thumb).toBe(true);
    expect(after.dirty).toBe(true);

    // undo harus bisa balik ke resolusi awal
    await page.click('#undoBtn');
    await page.waitForFunction((b) => document.getElementById('mainCanvas').width === b.w, before, { timeout: 10000 });
    const restored = await page.evaluate(() => document.getElementById('mainCanvas').width);
    expect(restored).toBe(before.w);
  });
});
