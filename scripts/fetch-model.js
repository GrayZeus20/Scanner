#!/usr/bin/env node
/**
 * scripts/fetch-model.js — Download the Real-ESRGAN ONNX weights (#step 1)
 *
 * Usage:
 *   node scripts/fetch-model.js [--force]
 *
 * Source : https://huggingface.co/Saimon8420/realesr-general-x4v3-web
 * Target : assets/models/realesr-general-x4v3.onnx
 *
 * The model is a dynamic-shape SRVGGNetCompact (x4). It is self-hosted so the
 * PWA works offline and satisfies CSP `connect-src 'self'`.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO = 'Saimon8420/realesr-general-x4v3-web';
const FILE = 'realesr-general-x4v3.onnx';
const MODEL_URL = `https://huggingface.co/${REPO}/resolve/main/${FILE}`;
const OUT_DIR = path.join(__dirname, '..', 'assets', 'models');
const OUT_FILE = path.join(OUT_DIR, FILE);
const MIN_BYTES = 1024 * 1024; // sanity: must be > 1 MB

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));

    const req = https.get(url, { headers: { 'User-Agent': 'scanner-build/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }

      const total = Number(res.headers['content-length'] || 0);
      let received = 0;
      let lastPct = -1;
      const tmp = `${dest}.part`;
      const out = fs.createWriteStream(tmp);

      res.on('data', (chunk) => {
        received += chunk.length;
        if (total) {
          const pct = Math.floor((received / total) * 100);
          if (pct !== lastPct && pct % 5 === 0) {
            lastPct = pct;
            process.stdout.write(`\r  ${pct}% (${(received / 1048576).toFixed(2)} MB)`);
          }
        }
      });

      res.pipe(out);
      out.on('finish', () => {
        out.close(() => {
          if (received < MIN_BYTES) {
            fs.unlinkSync(tmp);
            return reject(new Error(`File too small (${received} bytes) — likely an LFS pointer`));
          }
          fs.renameSync(tmp, dest);
          process.stdout.write('\r');
          resolve(received);
        });
      });
      out.on('error', (err) => {
        try { fs.unlinkSync(tmp); } catch (_) {}
        reject(err);
      });
    });

    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('Download timeout')));
  });
}

(async () => {
  const force = process.argv.includes('--force');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (fs.existsSync(OUT_FILE) && !force) {
    const size = fs.statSync(OUT_FILE).size;
    if (size >= MIN_BYTES) {
      console.log(`[ok] ${path.relative(process.cwd(), OUT_FILE)} already present (${(size / 1048576).toFixed(2)} MB)`);
      return;
    }
    console.log('[warn] existing file too small, re-downloading');
  }

  console.log(`[get] ${MODEL_URL}`);
  try {
    const bytes = await download(MODEL_URL, OUT_FILE);
    console.log(`[ok] saved ${path.relative(process.cwd(), OUT_FILE)} (${(bytes / 1048576).toFixed(2)} MB)`);
  } catch (err) {
    console.error(`[fail] ${err.message}`);
    process.exitCode = 1;
  }
})();
