// Images for the screenshot quality gate (perf/quality.mjs), no dependencies: a PNG decoder (8-bit grey, grey+alpha,
// RGB, RGBA; non-interlaced; all five filter types) and encoder (zlib deflate, CRC), SSIM (Wang et al. 2004) on BT.601
// luma, and the per-pixel diff with its heat map.
//   node perf/image.mjs --selftest
// SSIM: an 11x11 Gaussian window (sigma 1.5, separable, normalised), K1 0.01, K2 0.03, L 255, over the 'valid' region
// (the window wholly inside the image: (W-10) x (H-10) values), at full resolution (no downsampling, unlike the
// reference MATLAB code's automatic factor: stricter, every pixel counts). `mean` is the mean of the SSIM map; `tiles`
// the map's mean over a TILES x TILES grid, so a small local change cannot hide in the full-frame mean.
import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Channels per colour type: grey, RGB, grey+alpha, RGBA (palette is not supported). */
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/** Decode a PNG to { width, height, channels, data } (data: Uint8Array, `channels` bytes a pixel, rows top-down). */
export function decodePng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let pos = 8, width = 0, height = 0, depth = 0, type = -1, interlace = 0;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos), name = buf.toString('latin1', pos + 4, pos + 8), body = buf.subarray(pos + 8, pos + 8 + len);
    if (pos + 12 + len > buf.length) throw new Error(`truncated ${name} chunk`);
    if (crc32(buf.subarray(pos + 4, pos + 8 + len)) !== buf.readUInt32BE(pos + 8 + len)) throw new Error(`bad CRC in ${name}`);
    pos += 12 + len;
    if (name === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12];
    } else if (name === 'IDAT') idat.push(body);
    else if (name === 'IEND') break;
  }
  if (depth !== 8 || !(type in CHANNELS)) throw new Error(`unsupported PNG: bit depth ${depth}, colour type ${type}`);
  if (interlace !== 0) throw new Error('interlaced PNG not supported');
  const channels = CHANNELS[type], stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * height) throw new Error('image data too short');
  const data = new Uint8Array(stride * height);
  const bpp = channels;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, up = row - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x];
      const a = x >= bpp ? data[row + x - bpp] : 0, b = y > 0 ? data[up + x] : 0, c = x >= bpp && y > 0 ? data[up + x - bpp] : 0;
      let out;
      switch (filter) {
        case 0: out = v; break;
        case 1: out = v + a; break;
        case 2: out = v + b; break;
        case 3: out = v + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`bad filter type ${filter} on row ${y}`);
      }
      data[row + x] = out & 0xff;
    }
  }
  return { width, height, channels, data };
}

export const readPng = file => decodePng(readFileSync(file));

/**
 * Encode 8-bit RGB (channels 3) or RGBA (4). Filter 0 on every row, unless `filters` (a function of the row) picks
 * another (the self-test uses it to exercise every filter type through the decoder).
 */
export function encodePng({ width, height, channels = 3, data }, { level = 6, filters = null } = {}) {
  const type = { 1: 0, 2: 4, 3: 2, 4: 6 }[channels];
  if (type === undefined) throw new Error(`bad channel count ${channels}`);
  const stride = width * channels, raw = Buffer.alloc((stride + 1) * height), bpp = channels;
  for (let y = 0; y < height; y++) {
    const f = filters ? filters(y) : 0, dst = y * (stride + 1), row = y * stride, up = row - stride;
    raw[dst] = f;
    for (let x = 0; x < stride; x++) {
      const v = data[row + x];
      const a = x >= bpp ? data[row + x - bpp] : 0, b = y > 0 ? data[up + x] : 0, c = x >= bpp && y > 0 ? data[up + x - bpp] : 0;
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 2) pred = b;
      else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      raw[dst + 1 + x] = (v - pred) & 0xff;
    }
  }
  const chunk = (name, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0); head.write(name, 4, 'latin1');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = type; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level })), chunk('IEND', Buffer.alloc(0))]);
}

export const writePng = (file, image, opts) => writeFileSync(file, encodePng(image, opts));

/** RGB(A) or grey to RGB bytes. */
export function toRgb(img) {
  if (img.channels === 3) return img.data;
  const n = img.width * img.height, out = new Uint8Array(n * 3), c = img.channels;
  for (let i = 0; i < n; i++) {
    if (c >= 3) { out[i * 3] = img.data[i * c]; out[i * 3 + 1] = img.data[i * c + 1]; out[i * 3 + 2] = img.data[i * c + 2]; }
    else out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = img.data[i * c];
  }
  return out;
}

/** BT.601 luma (0.299 R + 0.587 G + 0.114 B), 0-255, as floats. Alpha is ignored (screenshots are opaque). */
export function luma(img) {
  const n = img.width * img.height, out = new Float32Array(n), c = img.channels, d = img.data;
  if (c < 3) { for (let i = 0; i < n; i++) out[i] = d[i * c]; return out; }
  for (let i = 0; i < n; i++) out[i] = 0.299 * d[i * c] + 0.587 * d[i * c + 1] + 0.114 * d[i * c + 2];
  return out;
}

const WINDOW = 11, SIGMA = 1.5;
const KERNEL = (() => {
  const k = new Float64Array(WINDOW), r = (WINDOW - 1) / 2;
  let s = 0;
  for (let i = 0; i < WINDOW; i++) { k[i] = Math.exp(-((i - r) ** 2) / (2 * SIGMA * SIGMA)); s += k[i]; }
  for (let i = 0; i < WINDOW; i++) k[i] /= s;
  return k;
})();

/**
 * SSIM of two luma planes (Float32Array, w x h). Returns { mean, map (Float32Array, mw x mh), mw, mh, tiles, minTile,
 * minTileAt: [col, row] }.
 */
export function ssim(x, y, w, h, { tiles = 8 } = {}) {
  const L = 255, C1 = (0.01 * L) ** 2, C2 = (0.03 * L) ** 2;
  const mw = w - WINDOW + 1, mh = h - WINDOW + 1;
  if (mw <= 0 || mh <= 0) throw new Error(`image ${w}x${h} smaller than the ${WINDOW}x${WINDOW} window`);
  // Horizontal pass of the five moments: mw x h each.
  const hx = new Float32Array(mw * h), hy = new Float32Array(mw * h), hxx = new Float32Array(mw * h), hyy = new Float32Array(mw * h), hxy = new Float32Array(mw * h);
  const K = KERNEL;
  for (let r = 0; r < h; r++) {
    const row = r * w, out = r * mw;
    for (let c = 0; c < mw; c++) {
      let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      for (let k = 0; k < WINDOW; k++) {
        const a = x[row + c + k], b = y[row + c + k], g = K[k];
        sx += g * a; sy += g * b; sxx += g * a * a; syy += g * b * b; sxy += g * a * b;
      }
      hx[out + c] = sx; hy[out + c] = sy; hxx[out + c] = sxx; hyy[out + c] = syy; hxy[out + c] = sxy;
    }
  }
  // Vertical pass and the SSIM map.
  const map = new Float32Array(mw * mh);
  let total = 0;
  for (let r = 0; r < mh; r++) {
    for (let c = 0; c < mw; c++) {
      let mx = 0, my = 0, sxx = 0, syy = 0, sxy = 0;
      for (let k = 0; k < WINDOW; k++) {
        const i = (r + k) * mw + c, g = K[k];
        mx += g * hx[i]; my += g * hy[i]; sxx += g * hxx[i]; syy += g * hyy[i]; sxy += g * hxy[i];
      }
      const vx = sxx - mx * mx, vy = syy - my * my, cov = sxy - mx * my;
      const s = ((2 * mx * my + C1) * (2 * cov + C2)) / ((mx * mx + my * my + C1) * (vx + vy + C2));
      map[r * mw + c] = s;
      total += s;
    }
  }
  // Tile means over the map.
  const grid = [];
  let minTile = Infinity, minTileAt = [0, 0];
  for (let ty = 0; ty < tiles; ty++) {
    const r0 = Math.floor((ty * mh) / tiles), r1 = Math.floor(((ty + 1) * mh) / tiles), line = [];
    for (let tx = 0; tx < tiles; tx++) {
      const c0 = Math.floor((tx * mw) / tiles), c1 = Math.floor(((tx + 1) * mw) / tiles);
      let s = 0;
      for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) s += map[r * mw + c];
      const m = s / Math.max(1, (r1 - r0) * (c1 - c0));
      line.push(m);
      if (m < minTile) { minTile = m; minTileAt = [tx, ty]; }
    }
    grid.push(line);
  }
  return { mean: total / (mw * mh), map, mw, mh, tiles: grid, minTile, minTileAt };
}

/** Per-pixel abs difference (the largest of R, G, B): { diff (Uint8Array w*h), max, changed (pixels > 0), over8, over32 }. */
export function pixelDiff(a, b) {
  const n = a.width * a.height, ca = a.channels, cb = b.channels, diff = new Uint8Array(n);
  let max = 0, changed = 0, over8 = 0, over32 = 0;
  for (let i = 0; i < n; i++) {
    let d = 0;
    for (let k = 0; k < 3; k++) {
      const v = Math.abs(a.data[i * ca + Math.min(k, ca - 1)] - b.data[i * cb + Math.min(k, cb - 1)]);
      if (v > d) d = v;
    }
    diff[i] = d;
    if (d > max) max = d;
    if (d > 0) changed++;
    if (d > 8) over8++;
    if (d > 32) over32++;
  }
  return { diff, max, changed, over8, over32, pixels: n };
}

/**
 * A heat map of the diff over the new image's luma dimmed to 30 %: unchanged pixels grey, any change at least dark
 * red, ramping red, yellow, white by 64 levels (so a one-level change still shows).
 */
export function heatmap(img, diff) {
  const n = img.width * img.height, out = new Uint8Array(n * 3), y = luma(img);
  for (let i = 0; i < n; i++) {
    const d = diff[i];
    if (d === 0) { out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = Math.round(y[i] * 0.3); continue; }
    const t = 0.25 + 0.75 * Math.min(1, d / 64);
    out[i * 3] = Math.round(255 * Math.min(1, t * 2));
    out[i * 3 + 1] = Math.round(255 * Math.min(1, Math.max(0, t * 2 - 0.8)));
    out[i * 3 + 2] = Math.round(255 * Math.max(0, t * 4 - 3));
  }
  return { width: img.width, height: img.height, channels: 3, data: out };
}

/** Images side by side (same height), RGB. */
export function sideBySide(images) {
  const h = images[0].height, w = images.reduce((s, im) => s + im.width, 0), out = new Uint8Array(w * h * 3);
  let x0 = 0;
  for (const im of images) {
    const rgb = toRgb(im);
    for (let y = 0; y < h; y++) out.set(rgb.subarray(y * im.width * 3, (y + 1) * im.width * 3), (y * w + x0) * 3);
    x0 += im.width;
  }
  return { width: w, height: h, channels: 3, data: out };
}

/** Everything compare needs for one pair of PNG files. */
export function compareImages(a, b, { tiles = 8 } = {}) {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`size differs: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  const s = ssim(luma(a), luma(b), a.width, a.height, { tiles });
  const d = pixelDiff(a, b);
  return { ssim: s.mean, minTile: s.minTile, minTileAt: s.minTileAt, tiles: s.tiles, maxDiff: d.max,
    pctChanged: (100 * d.changed) / d.pixels, pctOver8: (100 * d.over8) / d.pixels, pctOver32: (100 * d.over32) / d.pixels, diff: d.diff };
}

// ------------------------------------------------------------------ self-test

function selftest() {
  const assert = (ok, msg) => { if (!ok) throw new Error(`selftest: ${msg}`); console.log(`ok  ${msg}`); };
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  const W = 160, H = 96;
  const make = (fn, channels = 3) => {
    const data = new Uint8Array(W * H * channels);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let k = 0; k < channels; k++) data[(y * W + x) * channels + k] = k === 3 ? 255 : fn(x, y, k);
    return { width: W, height: H, channels, data };
  };
  const scene = (x, y, k) => Math.max(0, Math.min(255, Math.round(
    128 + 60 * Math.sin(x / 7 + k) + 40 * Math.cos(y / 5) + ((x >> 4) + (y >> 4)) % 2 * 30 - 15)));
  const a = make(scene);
  // Round trip, every filter type (rows cycle 0-4) and plain filter 0, RGB and RGBA.
  for (const [name, filters] of [['filter 0', null], ['filters 0-4', y => y % 5]]) {
    for (const channels of [3, 4]) {
      const img = channels === 3 ? a : make(scene, 4);
      const back = decodePng(encodePng(img, { filters }));
      assert(back.width === W && back.height === H && back.channels === channels && Buffer.from(back.data).equals(Buffer.from(img.data)),
        `encode -> decode round trip, ${name}, ${channels} channels`);
    }
  }
  // Random bytes through every filter (worst case for the Paeth predictor's ties and wrap-around).
  const noise = make(() => Math.floor(rnd() * 256));
  assert(Buffer.from(decodePng(encodePng(noise, { filters: y => (y * 3) % 5 })).data).equals(Buffer.from(noise.data)), 'round trip of random bytes, all filters');
  const same = compareImages(a, decodePng(encodePng(a)));
  assert(same.ssim === 1 && same.minTile === 1 && same.maxDiff === 0 && same.pctChanged === 0, `identical images: SSIM ${same.ssim}, min tile ${same.minTile}`);
  const shifted = make((x, y, k) => scene(x + 1, y, k));
  const s1 = compareImages(a, shifted);
  assert(s1.ssim < 1 && s1.ssim > 0.5, `one-pixel shift: SSIM ${s1.ssim.toFixed(4)} < 1`);
  const noised = make((x, y, k) => Math.max(0, Math.min(255, scene(x, y, k) + Math.round((rnd() - 0.5) * 20))));
  const s2 = compareImages(a, noised);
  assert(s2.ssim < 0.99 && s2.maxDiff > 0, `noise +-10: SSIM ${s2.ssim.toFixed(4)} < 0.99, max diff ${s2.maxDiff}`);
  // A small local change: the full-frame mean stays high, the tile minimum shows it.
  const patch = make((x, y, k) => (x >= 20 && x < 30 && y >= 20 && y < 30 ? 255 - scene(x, y, k) : scene(x, y, k)));
  const s3 = compareImages(a, patch);
  assert(s3.minTile < s3.ssim - 0.2 && s3.minTileAt[0] === 1 && s3.minTileAt[1] >= 1 && s3.minTileAt[1] <= 2, `local patch: mean ${s3.ssim.toFixed(4)}, min tile ${s3.minTile.toFixed(4)} at ${s3.minTileAt}`);
  // The separable passes against the textbook form: a direct 11x11 window per value.
  const brute = (x, y) => {
    const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
    let total = 0, n = 0;
    for (let r = 0; r + WINDOW <= H; r++) for (let c = 0; c + WINDOW <= W; c++) {
      let mx = 0, my = 0, sxx = 0, syy = 0, sxy = 0;
      for (let i = 0; i < WINDOW; i++) for (let j = 0; j < WINDOW; j++) {
        const g = KERNEL[i] * KERNEL[j], a = x[(r + i) * W + c + j], b = y[(r + i) * W + c + j];
        mx += g * a; my += g * b; sxx += g * a * a; syy += g * b * b; sxy += g * a * b;
      }
      total += ((2 * mx * my + C1) * (2 * (sxy - mx * my) + C2)) / ((mx * mx + my * my + C1) * (sxx - mx * mx + syy - my * my + C2));
      n++;
    }
    return total / n;
  };
  for (const [name, other, s] of [['noise', noised, s2], ['shift', shifted, s1]]) {
    const ref = brute(luma(a), luma(other));
    assert(Math.abs(ref - s.ssim) < 1e-5, `separable SSIM matches the direct window (${name}: ${s.ssim.toFixed(6)} vs ${ref.toFixed(6)})`);
  }
  // Uniform images (zero variance): exactly 1 for equal, < 1 for different.
  const flat = make(() => 90), flat2 = make(() => 100);
  assert(compareImages(flat, flat).ssim === 1 && compareImages(flat, flat2).ssim < 1, 'flat images');
  const hm = heatmap(a, s2.diff);
  assert(decodePng(encodePng(sideBySide([a, noised, hm]))).width === 3 * W, 'side-by-side encodes');
  console.log('selftest passed');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--selftest')) selftest();
  else if (process.argv.length === 4) {
    const t = Date.now(), r = compareImages(readPng(process.argv[2]), readPng(process.argv[3]));
    console.log(JSON.stringify({ ssim: r.ssim, minTile: r.minTile, minTileAt: r.minTileAt, maxDiff: r.maxDiff, pctChanged: r.pctChanged, ms: Date.now() - t }));
  } else console.error('usage: node perf/image.mjs --selftest | A.png B.png');
}
