#!/usr/bin/env node
/**
 * scripts/inspect-onnx.js — dump the I/O signature of a local ONNX file.
 * Zero-dependency protobuf walk covering just the ModelProto/GraphProto parts
 * we need to verify tensor names and dynamic shapes before wiring rt-web.
 *
 * Usage: node scripts/inspect-onnx.js assets/models/realesr-general-x4v3.onnx
 */
'use strict';
const fs = require('fs');

function readVarint(buf, pos) {
  let result = 0, shift = 0, b;
  do {
    if (pos >= buf.length) throw new Error('truncated varint at ' + pos);
    b = buf[pos++];
    result += (b & 0x7f) * Math.pow(2, shift);
    shift += 7;
  } while (b & 0x80);
  return [result, pos];
}

function fields(buf) {
  const out = [];
  let pos = 0;
  while (pos < buf.length) {
    const [key, p1] = readVarint(buf, pos);
    pos = p1;
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (wire === 0) {
      const [v, p2] = readVarint(buf, pos);
      pos = p2;
      out.push({ field, wire, value: v });
    } else if (wire === 2) {
      const [len, p2] = readVarint(buf, pos);
      pos = p2;
      out.push({ field, wire, bytes: buf.subarray(pos, pos + len) });
      pos += len;
    } else if (wire === 5) { out.push({ field, wire, bytes: buf.subarray(pos, pos + 4) }); pos += 4; }
    else if (wire === 1) { out.push({ field, wire, bytes: buf.subarray(pos, pos + 8) }); pos += 8; }
    else throw new Error('unsupported wire type ' + wire);
  }
  return out;
}

const ELEM = { 1: 'float32', 2: 'uint8', 3: 'int8', 6: 'int32', 7: 'int64', 10: 'float16', 11: 'float64' };

function parseValueInfo(b) {
  const f = fields(b);
  const name = f.find(x => x.field === 1 && x.wire === 2);
  const typeBytes = f.find(x => x.field === 2 && x.wire === 2);
  let dtype = '?', shape = [];
  if (typeBytes) {
    const tf = fields(typeBytes.bytes);
    const tensor = tf.find(x => x.field === 1 && x.wire === 2);
    if (tensor) {
      const t = fields(tensor.bytes);
      const elem = t.find(x => x.field === 1 && x.wire === 0);
      if (elem) dtype = ELEM[elem.value] || String(elem.value);
      const shapeField = t.find(x => x.field === 2 && x.wire === 2);
      if (shapeField) {
        const sf = fields(shapeField.bytes);
        for (const dim of sf) {
          if (dim.field !== 1 || dim.wire !== 2) continue;
          const d = fields(dim.bytes);
          const dv = d.find(x => x.field === 1 && x.wire === 0);
          const dp = d.find(x => x.field === 2 && x.wire === 2);
          if (dv) shape.push(dv.value);
          else if (dp) shape.push(dp.bytes.toString('utf8'));
        }
      }
    }
  }
  return { name: name ? name.bytes.toString('utf8') : '?', dtype, shape };
}

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/inspect-onnx.js <model.onnx>'); process.exit(1); }
const buf = fs.readFileSync(file);
const model = fields(buf);

const graph = model.find(x => x.field === 7 && x.wire === 2);
if (!graph) { console.error('no GraphProto found'); process.exit(1); }
const gf = fields(graph.bytes);

const opsets = model.filter(x => x.field === 8 && x.wire === 2).map(o => {
  const of = fields(o.bytes);
  const dom = of.find(x => x.field === 1 && x.wire === 2);
  const ver = of.find(x => x.field === 2 && x.wire === 0);
  return `${dom ? dom.bytes.toString('utf8') : 'ai.onnx'}=${ver ? ver.value : '?'}`;
});

const ops = {};
for (const node of gf.filter(x => x.field === 1 && x.wire === 2)) {
  const nf = fields(node.bytes);
  const op = nf.find(x => x.field === 4 && x.wire === 2);
  if (op) { const k = op.bytes.toString('utf8'); ops[k] = (ops[k] || 0) + 1; }
}

console.log(`[file] ${file}  (${(buf.length / 1048576).toFixed(2)} MB)`);
console.log(`[opset] ${opsets.join(', ') || '?'}`);
console.log('[inputs]');
for (const v of gf.filter(x => x.field === 11 && x.wire === 2)) {
  const i = parseValueInfo(v.bytes);
  console.log(`  ${i.name}  ${i.dtype}  ${JSON.stringify(i.shape)}`);
}
console.log('[outputs]');
for (const v of gf.filter(x => x.field === 12 && x.wire === 2)) {
  const i = parseValueInfo(v.bytes);
  console.log(`  ${i.name}  ${i.dtype}  ${JSON.stringify(i.shape)}`);
}
const top = Object.entries(ops).sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log(`[nodes] ${Object.values(ops).reduce((a, b) => a + b, 0)} — ${top.map(([k, v]) => `${k}:${v}`).join(' ')}`);
