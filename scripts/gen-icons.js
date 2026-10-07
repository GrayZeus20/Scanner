const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const iconDir = path.join(__dirname, '..', 'icons');
  if (!fs.existsSync(iconDir)) {
    fs.mkdirSync(iconDir, { recursive: true });
  }

  for (const size of [192, 512]) {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body style="margin:0;padding:0;overflow:hidden;">
        <canvas id="c" width="${size}" height="${size}"></canvas>
      </body>
      </html>
    `);

    await page.evaluate((s) => {
      const c = document.getElementById('c');
      const ctx = c.getContext('2d');
      const r = s * 0.14;

      // Background gradient
      const grad = ctx.createLinearGradient(0, 0, s, s);
      grad.addColorStop(0, '#1D4ED8');
      grad.addColorStop(1, '#2563EB');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(0, 0, s, s, r);
      ctx.fill();

      // Document paper
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.roundRect(s * 0.24, s * 0.18, s * 0.52, s * 0.64, r * 0.4);
      ctx.fill();

      // Folded corner or shadow
      ctx.fillStyle = '#E2E8F0';
      ctx.beginPath();
      ctx.roundRect(s * 0.58, s * 0.18, s * 0.18, s * 0.18, [0, r * 0.4, 0, 0]);
      ctx.fill();

      // Text lines on paper
      ctx.fillStyle = '#94A3B8';
      ctx.fillRect(s * 0.32, s * 0.40, s * 0.36, s * 0.035);
      ctx.fillRect(s * 0.32, s * 0.48, s * 0.36, s * 0.035);
      ctx.fillRect(s * 0.32, s * 0.56, s * 0.24, s * 0.035);

      // Scanner laser beam line
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = Math.max(3, s * 0.025);
      ctx.shadowColor = '#38BDF8';
      ctx.shadowBlur = s * 0.04;
      ctx.beginPath();
      ctx.moveTo(s * 0.18, s * 0.5);
      ctx.lineTo(s * 0.82, s * 0.5);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Scan viewfinder corner brackets
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = Math.max(3, s * 0.028);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const m = s * 0.12;
      const len = s * 0.14;

      // TL
      ctx.beginPath(); ctx.moveTo(m, m + len); ctx.lineTo(m, m); ctx.lineTo(m + len, m); ctx.stroke();
      // TR
      ctx.beginPath(); ctx.moveTo(s - m - len, m); ctx.lineTo(s - m, m); ctx.lineTo(s - m, m + len); ctx.stroke();
      // BL
      ctx.beginPath(); ctx.moveTo(m, s - m - len); ctx.lineTo(m, s - m); ctx.lineTo(m + len, s - m); ctx.stroke();
      // BR
      ctx.beginPath(); ctx.moveTo(s - m - len, s - m); ctx.lineTo(s - m, s - m); ctx.lineTo(s - m, s - m - len); ctx.stroke();
    }, size);

    const canvas = await page.locator('#c');
    const buf = await canvas.screenshot();
    const dest = path.join(iconDir, `icon-${size}.png`);
    fs.writeFileSync(dest, buf);
    console.log(`Saved ${dest}`);
  }

  await browser.close();
})();
