// Features of one 64×96 frame (RGB): brightness, saturation (IR ≈ gray), sharpness (gradient energy), 64-bit dHash.
export const FW = 64, FH = 96;

/** rgb — Buffer/Uint8Array, offset — start of the frame, w×h×3 bytes. */
export function frameStats(rgb, offset = 0, w = FW, h = FH) {
  const n = w * h;
  const gray = new Float32Array(n);
  let sum = 0, sat = 0;
  for (let k = 0; k < n; k++) {
    const o = offset + k * 3, r = rgb[o], g = rgb[o + 1], b = rgb[o + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[k] = y; sum += y;
    sat += Math.max(r, g, b) - Math.min(r, g, b);
  }
  const luma = sum / n;
  // sharpness: mean |dx|+|dy| divided by the frame contrast — so that dark frames are not counted as blurry
  let grad = 0, dev = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x, v = gray[k];
      dev += Math.abs(v - luma);
      if (x + 1 < w) grad += Math.abs(gray[k + 1] - v);
      if (y + 1 < h) grad += Math.abs(gray[k + w] - v);
    }
  }
  const contrast = dev / n;
  const sharp = contrast < 1 ? 0 : (grad / n) / contrast;
  return { luma, sat: sat / n, sharp, hash: dhash(gray, w, h) };
}

/** dHash: frame → 9×8 mean blocks, bit = left is brighter than right. 16 hex characters. */
export function dhash(gray, w = FW, h = FH) {
  const cells = new Float64Array(9 * 8);
  for (let cy = 0; cy < 8; cy++) {
    const y0 = Math.floor((cy * h) / 8), y1 = Math.floor(((cy + 1) * h) / 8);
    for (let cx = 0; cx < 9; cx++) {
      const x0 = Math.floor((cx * w) / 9), x1 = Math.floor(((cx + 1) * w) / 9);
      let s = 0, c = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += gray[y * w + x]; c++; }
      cells[cy * 9 + cx] = c ? s / c : 0;
    }
  }
  let hex = '';
  for (let cy = 0; cy < 8; cy++) {
    let byte = 0;
    for (let cx = 0; cx < 8; cx++) byte = (byte << 1) | (cells[cy * 9 + cx] > cells[cy * 9 + cx + 1] ? 1 : 0);
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

const POP = Array.from({ length: 16 }, (_, i) => (i & 1) + ((i >> 1) & 1) + ((i >> 2) & 1) + ((i >> 3) & 1));
/** Hamming distance between two dHash values (hex). */
export function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return d;
}
