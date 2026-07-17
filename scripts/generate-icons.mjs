// 生成 PWA/站点图标：程序化 16x16 草方块像素画，近邻放大到各尺寸
// 零依赖手写 PNG 编码（zlib 来自 Node 标准库）。用法：node scripts/generate-icons.mjs

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

// ---------- CRC32 / PNG 编码 ----------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter: none
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// ---------- 16x16 草方块像素画 ----------
function hash(x, y) {
  let h = (x * 374761393) ^ (y * 668265263) ^ 0x5bf03635;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const GRASS = ['#6aa84f', '#63a049', '#71b356', '#5d9445'];
const DIRT = ['#8a6a48', '#7d5f40', '#846645', '#95714e'];

function pixelAt(x, y) {
  const r = hash(x, y);
  if (y <= 3) return GRASS[Math.floor(r * GRASS.length)]; // 草顶层
  if (y === 4) return r < 0.45 ? GRASS[Math.floor(r * 2) ] : DIRT[Math.floor(r * DIRT.length)]; // 过渡带
  return DIRT[Math.floor(r * DIRT.length)]; // 泥土
}

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.floor((x * 16) / size);
      const sy = Math.floor((y * 16) / size);
      const [r, g, b] = hexToRgb(pixelAt(sx, sy));
      const i = (y * size + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

// ---------- 输出 ----------
const root = path.resolve(import.meta.dirname, '..');
const targets = [
  { file: 'public/icons/icon-192.png', size: 192 },
  { file: 'public/icons/icon-512.png', size: 512 },
  { file: 'app/icon.png', size: 32 },
  { file: 'app/apple-icon.png', size: 180 },
];

for (const { file, size } of targets) {
  const out = encodePng(size, size, renderIcon(size));
  const p = path.join(root, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, out);
  console.log(`${file} (${size}x${size}, ${out.length} bytes)`);
}
