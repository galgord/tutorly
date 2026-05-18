#!/usr/bin/env node
// One-off PWA icon generator. Writes 192x192, 512x512, and 512x512-maskable
// PNGs into `apps/web/public/`. Pure Node — no native deps — so it runs in
// CI without a sharp/canvas install.
//
// Design: deep-slate background with a brand wordmark ("TA") centered. The
// maskable variant has 20% safe-zone padding around the mark so platforms
// that mask to a circle / squircle don't clip the letters.
//
// Re-run with `node apps/web/scripts/generate-pwa-icons.mjs` after the brand
// changes. The output PNGs are checked into the repo.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public');
mkdirSync(outDir, { recursive: true });

// --- Brand palette + glyph paths --------------------------------------------
// Slate-900 background to match the app's primary `bg-slate-900` button.
const BG = [15, 23, 42, 255]; // RGBA
const FG = [248, 250, 252, 255]; // slate-50

// We rasterize a 5x7 bitmap font for "TA" so the mark stays legible at 192px
// without antialiasing artifacts. Each glyph is a 5-wide x 7-tall block of
// 0/1 pixels; a 'pixel' in the bitmap is a square block in the output.
const GLYPHS = {
  T: [
    '11111',
    '00100',
    '00100',
    '00100',
    '00100',
    '00100',
    '00100',
  ],
  A: [
    '01110',
    '10001',
    '10001',
    '11111',
    '10001',
    '10001',
    '10001',
  ],
};
const GLYPH_W = 5;
const GLYPH_H = 7;

function setPixel(buf, width, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= width) return;
  const i = (y * width + x) * 4;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
  buf[i + 3] = a;
}

function fillRect(buf, width, x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      setPixel(buf, width, x, y, color);
    }
  }
}

function drawGlyph(buf, width, originX, originY, scale, glyph, color) {
  for (let gy = 0; gy < GLYPH_H; gy++) {
    for (let gx = 0; gx < GLYPH_W; gx++) {
      if (glyph[gy][gx] === '1') {
        fillRect(buf, width, originX + gx * scale, originY + gy * scale, scale, scale, color);
      }
    }
  }
}

function buildIcon(size, { safeZoneRatio = 1 } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  // Background fill.
  fillRect(buf, size, 0, 0, size, size, BG);

  // Glyph metrics: two glyphs ("T", "A") with a 1-pixel gap, fit into the
  // safe zone (full canvas for normal, 60% center for maskable).
  const totalGlyphCols = GLYPH_W * 2 + 1; // 5 + 1 gap + 5
  const safeSize = Math.floor(size * safeZoneRatio);
  const safeOrigin = Math.floor((size - safeSize) / 2);
  const scale = Math.floor(Math.min(safeSize / totalGlyphCols, safeSize / GLYPH_H) * 0.85);
  const renderedW = totalGlyphCols * scale;
  const renderedH = GLYPH_H * scale;
  const originX = safeOrigin + Math.floor((safeSize - renderedW) / 2);
  const originY = safeOrigin + Math.floor((safeSize - renderedH) / 2);

  drawGlyph(buf, size, originX, originY, scale, GLYPHS.T, FG);
  drawGlyph(buf, size, originX + (GLYPH_W + 1) * scale, originY, scale, GLYPHS.A, FG);

  return buf;
}

// --- PNG encoder (no external deps) -----------------------------------------
// Spec: https://www.w3.org/TR/PNG/

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT: prefix each scanline with filter byte 0 (none), then deflate.
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw);

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Emit -------------------------------------------------------------------
const targets = [
  { name: 'pwa-192.png', size: 192, opts: { safeZoneRatio: 1 } },
  { name: 'pwa-512.png', size: 512, opts: { safeZoneRatio: 1 } },
  // Maskable: glyphs fit inside a 60%-of-canvas safe zone so platforms that
  // mask the icon to a circle/squircle don't clip the letters.
  { name: 'pwa-512-maskable.png', size: 512, opts: { safeZoneRatio: 0.6 } },
  // Small favicon-style PNG for browser tab.
  { name: 'pwa-favicon.png', size: 64, opts: { safeZoneRatio: 1 } },
];

for (const { name, size, opts } of targets) {
  const rgba = buildIcon(size, opts);
  const png = encodePng(size, size, rgba);
  writeFileSync(join(outDir, name), png);
  console.log(`wrote ${name} (${size}x${size}, ${png.length} bytes)`);
}
