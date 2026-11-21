// "Possum Studio" icon: a sugar possum's face (light head, dark stripe, big eyes and ears) on a warm background.
// Drawn in code, no third-party images: build/icon.ico (256, 64, 48, 32, 16) and app/icon.ico for the window.
//   node scripts/make-icon.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// shapes in 0..1 coordinates; order — bottom to top
const C = { bg: [214, 128, 62], bg2: [240, 176, 96], ear: [74, 62, 58], earIn: [232, 170, 160], head: [226, 220, 212], stripe: [70, 60, 56], eye: [24, 20, 22], shine: [255, 255, 255], nose: [222, 120, 132], ring: [120, 104, 96] };
const roundRect = (x, y, r) => { const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0), dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0); return dx * dx + dy * dy <= r * r; };
const ellipse = (cx, cy, rx, ry) => (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const shapes = [
  [ellipse(0.25, 0.30, 0.17, 0.16), C.ear], [ellipse(0.75, 0.30, 0.17, 0.16), C.ear],
  [ellipse(0.26, 0.31, 0.10, 0.095), C.earIn], [ellipse(0.74, 0.31, 0.10, 0.095), C.earIn],
  [ellipse(0.5, 0.58, 0.33, 0.30), C.head],
  [(x, y) => Math.abs(x - 0.5) < 0.045 * (1 - (y - 0.28) * 0.9) && y > 0.28 && y < 0.66, C.stripe],
  [ellipse(0.355, 0.55, 0.095, 0.10), C.ring], [ellipse(0.645, 0.55, 0.095, 0.10), C.ring],
  [ellipse(0.355, 0.55, 0.08, 0.085), C.eye], [ellipse(0.645, 0.55, 0.08, 0.085), C.eye],
  [ellipse(0.33, 0.52, 0.022, 0.024), C.shine], [ellipse(0.62, 0.52, 0.022, 0.024), C.shine],
  [ellipse(0.5, 0.74, 0.045, 0.032), C.nose],
];
function colorAt(x, y) {
  if (!roundRect(x, y, 0.2)) return null;
  let c = C.bg.map((v, i) => v + (C.bg2[i] - v) * (1 - y));
  for (const [hit, col] of shapes) if (hit(x, y)) c = col;
  return c;
}

const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), cr = Buffer.alloc(4); len.writeUInt32BE(data.length); cr.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, cr]); };

function png(size) {
  const ss = 4, raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
        const c = colorAt((x + (i + 0.5) / ss) / size, (y + (j + 0.5) / ss) / size);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? r / a : 0; raw[o + 1] = a ? g / a : 0; raw[o + 2] = a ? b / a : 0; raw[o + 3] = (a / (ss * ss)) * 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const sizes = [256, 64, 48, 32, 16];
const imgs = sizes.map(png);
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let off = 6 + 16 * sizes.length;
const dir = sizes.map((s, k) => { const e = Buffer.alloc(16); e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(imgs[k].length, 8); e.writeUInt32LE(off, 12); off += imgs[k].length; return e; });
const ico = Buffer.concat([head, ...dir, ...imgs]);
mkdirSync(join(root, 'build'), { recursive: true });
writeFileSync(join(root, 'build', 'icon.ico'), ico);
copyFileSync(join(root, 'build', 'icon.ico'), join(root, 'app', 'icon.ico'));
if (process.argv[2]) writeFileSync(process.argv[2], imgs[0]);
console.log(`build/icon.ico и app/icon.ico: ${ico.length} байт, размеры ${sizes.join(', ')}`);
