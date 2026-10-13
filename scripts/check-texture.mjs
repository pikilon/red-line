// Deterministic texture checks and transforms for the asset-generation loop
// (no dependencies). Pure functions operate on RGBA byte arrays; `decodePng`
// reads and `encodePng` writes an 8-bit RGB/RGBA, non-interlaced PNG using
// Node's built-in zlib.
import { readFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

/** Average colour of `rgba` (length width*height*4), ignoring alpha. */
export function meanColor(rgba, width, height) {
  let r = 0;
  let g = 0;
  let b = 0;
  const count = width * height;
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    r += rgba[o];
    g += rgba[o + 1];
    b += rgba[o + 2];
  }
  return { r: r / count, g: g / count, b: b / count };
}

/** Per-channel variance (mean squared deviation) of `rgba`. */
export function channelVariance(rgba, width, height) {
  const mean = meanColor(rgba, width, height);
  const count = width * height;
  let dr = 0;
  let dg = 0;
  let db = 0;
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const r = rgba[o] - mean.r;
    const g = rgba[o + 1] - mean.g;
    const b = rgba[o + 2] - mean.b;
    dr += r * r;
    dg += g * g;
    db += b * b;
  }
  return { r: dr / count, g: dg / count, b: db / count };
}

/** Max absolute per-channel difference between opposite edges (seam check). */
export function seamMaxDiff(rgba, width, height) {
  let horizontal = 0;
  let vertical = 0;
  for (let y = 0; y < height; y++) {
    const left = y * width * 4;
    const right = (y * width + width - 1) * 4;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(rgba[left + c] - rgba[right + c]);
      if (d > horizontal) horizontal = d;
    }
  }
  for (let x = 0; x < width; x++) {
    const top = x * 4;
    const bottom = ((height - 1) * width + x) * 4;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(rgba[top + c] - rgba[bottom + c]);
      if (d > vertical) vertical = d;
    }
  }
  return { horizontal, vertical };
}

/**
 * Validates `rgba` against `spec`, where spec is:
 *   { width, height, palette: { base: [r,g,b] }, meanTolerance?, seamTolerance?, minVariance? }
 * Returns { valid, reasons }.
 */
export function checkTexture(rgba, width, height, spec) {
  const reasons = [];
  if (width !== spec.width || height !== spec.height) {
    reasons.push(`size ${width}x${height}, expected ${spec.width}x${spec.height}`);
  }
  const mean = meanColor(rgba, width, height);
  const base = spec.palette.base;
  const meanTolerance = spec.meanTolerance ?? 24;
  const channels = ["r", "g", "b"];
  for (let i = 0; i < 3; i++) {
    const ch = channels[i];
    if (Math.abs(mean[ch] - base[i]) > meanTolerance) {
      reasons.push(`mean ${ch} ${mean[ch].toFixed(1)} far from base ${base[i]} (tol ${meanTolerance})`);
    }
  }
  const seam = seamMaxDiff(rgba, width, height);
  const seamTolerance = spec.seamTolerance ?? 12;
  if (seam.horizontal > seamTolerance) {
    reasons.push(`not seamless horizontally (${seam.horizontal})`);
  }
  if (seam.vertical > seamTolerance) {
    reasons.push(`not seamless vertically (${seam.vertical})`);
  }
  const variance = channelVariance(rgba, width, height);
  const minVariance = spec.minVariance ?? 16;
  for (const ch of ["r", "g", "b"]) {
    if (variance[ch] < minVariance) {
      reasons.push(`channel ${ch} too flat (variance ${variance[ch].toFixed(1)})`);
    }
  }
  return { valid: reasons.length === 0, reasons };
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Decodes an 8-bit RGB/RGBA, non-interlaced PNG into RGBA bytes. */
export function decodePng(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) throw new Error("not a PNG file");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error("interlaced PNG not supported");
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : null;
  if (channels === null) throw new Error(`unsupported PNG colour type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    const line = raw.subarray(rowStart + 1, rowStart + 1 + stride);
    const out = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pr) & 0xff;
      } else if (filter !== 0) {
        throw new Error(`unsupported PNG filter ${filter}`);
      }
      out[i] = v;
    }
    prev = out;
    for (let x = 0; x < width; x++) {
      const si = x * channels;
      const di = (y * width + x) * 4;
      rgba[di] = out[si];
      rgba[di + 1] = out[si + 1];
      rgba[di + 2] = out[si + 2];
      rgba[di + 3] = channels === 4 ? out[si + 3] : 255;
    }
  }
  return { width, height, rgba };
}

/** Reads and decodes a PNG file from disk. */
export function readPngFile(path) {
  return decodePng(readFileSync(path));
}

function lerpByte(a, b, t) {
  return Math.round(a + (b - a) * t);
}

/**
 * Makes `rgba` tile seamlessly by crossfading the two opposite edge pairs
 * (top/bottom, then left/right) over a band of `blend` pixels. Returns a new
 * buffer; the input is not mutated. The exact seam rows/columns become equal,
 * so `seamMaxDiff` reads 0 on the result.
 */
export function makeSeamless(rgba, width, height, blend = 32) {
  const b = Math.max(
    1,
    Math.min(Math.floor(blend), Math.floor(width / 2), Math.floor(height / 2)),
  );
  const weight = (i) => (b === 1 ? 1 : (b - 1 - i) / (b - 1));
  const out = new Uint8Array(rgba);
  for (let x = 0; x < width; x++) {
    for (let i = 0; i < b; i++) {
      const w = weight(i);
      const top = (i * width + x) * 4;
      const bot = ((height - 1 - i) * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        const avg = (rgba[top + c] + rgba[bot + c]) / 2;
        out[top + c] = lerpByte(rgba[top + c], avg, w);
        out[bot + c] = lerpByte(rgba[bot + c], avg, w);
      }
    }
  }
  const result = new Uint8Array(out);
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let i = 0; i < b; i++) {
      const w = weight(i);
      const left = row + i * 4;
      const right = row + (width - 1 - i) * 4;
      for (let c = 0; c < 4; c++) {
        const avg = (out[left + c] + out[right + c]) / 2;
        result[left + c] = lerpByte(out[left + c], avg, w);
        result[right + c] = lerpByte(out[right + c], avg, w);
      }
    }
  }
  return result;
}

function crc32(buf) {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

/** Encodes RGBA bytes as an 8-bit RGBA PNG (non-interlaced). */
export function encodePng(rgba, width, height) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Euclidean RGB distance between two colours. */
export function colorDistance(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Flags adjacent kinds (per each kind's `neighbors`) whose mean colours are
 * too close to tell apart on screen. `means` maps kind id -> mean colour.
 */
export function checkDistinctKinds(means, kinds, threshold = 40) {
  const seen = new Set();
  const reasons = [];
  for (const [id, kind] of Object.entries(kinds)) {
    const mean = means[id];
    if (!mean) continue;
    for (const neighbor of kind.neighbors ?? []) {
      const other = means[neighbor.kind];
      if (!other) continue;
      const pair = [id, neighbor.kind].sort().join("/");
      if (seen.has(pair)) continue;
      seen.add(pair);
      const d = colorDistance(mean, other);
      if (d < threshold) {
        reasons.push(`${id} and ${neighbor.kind} mean colours too close (${d.toFixed(0)})`);
      }
    }
  }
  return reasons;
}
