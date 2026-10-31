#!/usr/bin/env node
/** scripts/resolve-version.js — query jsDelivr for a package's resolved version. */
'use strict';
const https = require('https');
const pkg = process.argv[2] || 'onnxruntime-web';
https.get(`https://data.jsdelivr.com/v1/packages/npm/${pkg}/resolved`, (r) => {
  let d = '';
  r.on('data', (c) => (d += c));
  r.on('end', () => console.log(pkg, d));
}).on('error', (e) => {
  console.error('ERR', e.message);
  process.exitCode = 1;
});
