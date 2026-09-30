#!/usr/bin/env node
// Dev-only sprite normaliser (STAGE-03). Never imported by the game at runtime.
//
// For every creature it reads the preserved original `art/monsters/originals/<id>.png` and writes:
//   - `assets/monsters/<id>/battle.png`: binary alpha, OKLab median-cut palette (no dithering),
//     1 px selective dark outline, lowest opaque row on BASELINE_ROW, stored as an indexed PNG;
//   - `src/data/sprite-metrics.js`: bbox, foot row, size class and mass for the renderers;
//   - `assets/asset-manifest.json`: a `normalized` provenance block next to the generation record;
//   - `assets/monsters/<id>/battle-shiny.png`: its Chromatique, a palette swap of `battle.png` (see
//     CHROMATIQUES), recorded as a `chromatique` block in the manifest.
// Family-A sprites (PixelLab pixel art that already matches the Orakyn anchor) only get the baseline,
// plus the palette pass alone when their source has more than MAX_COLORS colours.
//
// Deterministic: the same originals and SPRITES/CHROMATIQUES tables always give byte-identical outputs.
// Usage: node tools/normalize-sprites.mjs [--chromatiques]   (the flag re-bakes only the Chromatiques)

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 128;
const BASELINE_ROW = 125;
const ALPHA_CUTOFF = 128;
const MAX_COLORS = 100;

// Full-pass defaults for image-gen sprites (families B and C).
//   colors        body palette budget (outline colours come on top, see outlineColors)
//   accents       part of `colors` reserved for small distinct colour groups (eyes, mouths, gems)
//   chromaWeight  weight of OKLab a/b against L when splitting boxes and assigning colours;
//                 higher keeps distinct hues apart instead of averaging them to grey
//   keepChroma    0..1: restores a cluster's mean chroma after averaging (1 = full restoration),
//                 so mixed warm/cool clusters do not fade
//   refine        k-means passes after the median cut
//   cleanup       OKLab ΔE under which isolated texture pixels merge into their neighbours (0 = off)
//   outline       sRGB multiplier of the neighbour colour for the 1 px selective outline
//   outlineColors palette budget for the outline ring
//   outlineMinArea loose particles (8-connected) smaller than this stay unoutlined
const FULL_PASS = {
  colors: 56,
  accents: 8,
  chromaWeight: 1.6,
  keepChroma: 0.8,
  refine: 8,
  cleanup: 0.09,
  outline: 0.28,
  outlineColors: 12,
  outlineMinArea: 12,
};

// Per-creature table. `family`: A = on-style PixelLab art (baseline only; a `colors` key also
// quantises a source palette above MAX_COLORS, with no cleanup or outline); B = downscaled image-gen
// with a soft fringe; C = image-gen that fills the canvas. `sizeClass` is the authored design size
// used by `spriteMassScale` in src/data/sprite-metrics.js. Other keys override FULL_PASS.
// Brontusk, magmoth, hexalune, monolith, umbrawl and nymbloom are PixelLab redraws (STAGE-10) of
// family-C sprites. `art/monsters/originals/pre-redraw/` keeps each one's former source (`<id>.png`)
// and its normalised sprite (`<id>-battle.png`, the redraw input); copying the latter to
// `originals/<id>.png` with a plain `{ family: 'A' }` entry restores the pre-redraw sprite exactly.
const SPRITES = {
  orakyn: { family: 'A', sizeClass: 'M' },
  lumivox: { family: 'B', sizeClass: 'M' },
  mnemora: { family: 'B', sizeClass: 'M' },
  prismage: { family: 'B', sizeClass: 'M' },
  // Amber fur against slate is its identity: keep hues apart and restore full chroma.
  kordane: { family: 'B', sizeClass: 'M', chromaWeight: 2.4, keepChroma: 1 },
  brontusk: { family: 'A', sizeClass: 'L', colors: 96 },
  ferrax: { family: 'C', sizeClass: 'M' },
  monolith: { family: 'A', sizeClass: 'L', colors: 96 },
  abyssar: { family: 'C', sizeClass: 'L' },
  riptalon: { family: 'C', sizeClass: 'M' },
  nymbloom: { family: 'A', sizeClass: 'M', colors: 96 },
  voltide: { family: 'C', sizeClass: 'M' },
  calderoc: { family: 'B', sizeClass: 'L' },
  pyrolynx: { family: 'B', sizeClass: 'M' },
  magmoth: { family: 'A', sizeClass: 'L', colors: 96 },
  solflare: { family: 'B', sizeClass: 'M', colors: 64, cleanup: 0.08 },
  virelia: { family: 'B', sizeClass: 'M' },
  mossaur: { family: 'B', sizeClass: 'L' },
  florafae: { family: 'C', sizeClass: 'S', colors: 64, cleanup: 0.08 },
  thornox: { family: 'C', sizeClass: 'L' },
  farfombre: { family: 'A', sizeClass: 'S' },
  nocturnyx: { family: 'C', sizeClass: 'M' },
  umbrawl: { family: 'A', sizeClass: 'M', colors: 96 },
  hexalune: { family: 'A', sizeClass: 'M', colors: 96 },
  deuilastre: { family: 'A', sizeClass: 'M' },
  aubeastre: { family: 'A', sizeClass: 'M' },
  flambelier: { family: 'A', sizeClass: 'M' },
  mareclat: { family: 'A', sizeClass: 'S' },
  xylocorne: { family: 'A', sizeClass: 'S' },
  pactigon: { family: 'A', sizeClass: 'M' },
};

// Chromatiques (GAME-11): one baked colour variant per creature, `assets/monsters/<id>/battle-shiny.png`,
// a palette swap of the normalised battle sprite (same alpha mask, so the metrics serve both files).
// In OKLCh the body's colours rotate so its dominant hue lands on `to`; neutrals (whites, greys,
// blacks) and accents (small colour groups far from the body hue: eyes, gems, glows) are kept unless
// the entry says otherwise. The targets spread over the hue wheel (no hue family holds more than
// five variants) and dark creatures also change value, so every variant reads at a 64 px thumbnail.
//   to      target OKLCh hue in degrees (≈ 29 red, 70 orange, 100 gold, 145 green, 195 cyan,
//           265 blue, 305 violet, 345 pink)
//   from    source hue that lands on `to`, when the chroma-weighted dominant hue is the wrong group
//   chroma  multiplier on the rotated chroma (gamut-mapped by chroma reduction)
//   ramp    degrees of extra hue per unit of lightness around L 0.62, so shadows warm and lights
//           cool (gold needs amber shadows to not read olive)
//   keep    extra OKLCh hue ranges [from, to] that never rotate
//   light   exponent on the OKLab lightness of the recoloured colours (< 1 lightens: a dark creature
//           needs a value change, not only a hue change, to read at thumbnail size); outline colours
//           keep their lightness
//   neutral when set, neutrals are recoloured too: lightness through `light`, this OKLCh chroma at
//           hue `to` (0 = silver); by default they are kept
const CHROMATIQUES = {
  abyssar: { to: 85, chroma: 1.2, ramp: 40 },
  aubeastre: { to: 340, chroma: 1.7, keep: [[200, 290]], neutral: 0.045 },
  brontusk: { to: 250 },
  calderoc: { to: 235 },
  deuilastre: { to: 275, chroma: 0.7, light: 0.45, neutral: 0.015 },
  farfombre: { to: 180, light: 0.5 },
  ferrax: { to: 85, ramp: 50, chroma: 1.2, light: 0.6, neutral: 0 },
  flambelier: { to: 250, chroma: 1.1, light: 0.32, neutral: 0.03 },
  florafae: { to: 70, ramp: 40, chroma: 1.3 },
  hexalune: { to: 20, chroma: 1.1, light: 0.85 },
  kordane: { from: 70, to: 250, chroma: 0.3, light: 0.6, keep: [[230, 300]] },
  lumivox: { to: 150 },
  // The redrawn basalt is a faintly plum charcoal: keep it, or the rotation turns it olive.
  magmoth: { to: 200, keep: [[300, 360]] },
  mareclat: { to: 30, chroma: 1.3 },
  mnemora: { to: 55, ramp: 20 },
  monolith: { to: 60, chroma: 1.3 },
  mossaur: { to: 35, chroma: 1.7 },
  nocturnyx: { to: 55, ramp: 30 },
  nymbloom: { to: 160 },
  orakyn: { to: 100, ramp: 55, chroma: 1.5 },
  pactigon: { to: 270, chroma: 1.4 },
  prismage: { to: 150 },
  pyrolynx: { to: 215 },
  riptalon: { to: 150 },
  solflare: { to: 250 },
  thornox: { to: 75 },
  umbrawl: { to: 195, chroma: 1.2, light: 0.8 },
  virelia: { to: 355 },
  voltide: { to: 350 },
  xylocorne: { to: 300, chroma: 1.4 },
};

// ---------------------------------------------------------------------------------------------
// PNG codec (8-bit, non-interlaced; enough for the originals and for our own indexed output).

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Decodes a PNG buffer into `{ width, height, rgba }` (straight alpha, 4 bytes per pixel). */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');
  let offset = 8;
  let header = null;
  let palette = null;
  let paletteAlpha = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') paletteAlpha = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  const { width, height, depth, colorType, interlace } = header;
  if (depth !== 8 || interlace !== 0 || !(colorType in CHANNELS)) {
    throw new Error(
      `unsupported PNG layout (depth ${depth}, colour type ${colorType}, interlace ${interlace})`
    );
  }
  const bpp = CHANNELS[colorType];
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? pixels[row + x - bpp] : 0;
      const b = y > 0 ? pixels[row - stride + x] : 0;
      const c = x >= bpp && y > 0 ? pixels[row - stride + x - bpp] : 0;
      const value = raw[src + x];
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) predicted = paeth(a, b, c);
      pixels[row + x] = (value + predicted) & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const p = i * bpp;
    const o = i * 4;
    if (colorType === 6) rgba.set(pixels.subarray(p, p + 4), o);
    else if (colorType === 2) rgba.set([pixels[p], pixels[p + 1], pixels[p + 2], 255], o);
    else if (colorType === 0) rgba.set([pixels[p], pixels[p], pixels[p], 255], o);
    else if (colorType === 4) rgba.set([pixels[p], pixels[p], pixels[p], pixels[p + 1]], o);
    else {
      const index = pixels[p];
      const alpha = paletteAlpha && index < paletteAlpha.length ? paletteAlpha[index] : 255;
      rgba.set([palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2], alpha], o);
    }
  }
  return { width, height, rgba };
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function filterRows(indices, width, height, adaptive) {
  const out = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y += 1) {
    const row = indices.subarray(y * width, (y + 1) * width);
    const above = y > 0 ? indices.subarray((y - 1) * width, y * width) : null;
    let best = 0;
    if (adaptive && above) {
      // Minimum sum of absolute signed residuals between None and Up.
      let none = 0;
      let up = 0;
      for (let x = 0; x < width; x += 1) {
        none += row[x] < 128 ? row[x] : 256 - row[x];
        const d = (row[x] - above[x]) & 0xff;
        up += d < 128 ? d : 256 - d;
      }
      best = up < none ? 2 : 0;
    }
    const o = y * (width + 1);
    out[o] = best;
    for (let x = 0; x < width; x += 1) out[o + 1 + x] = best === 2 ? (row[x] - above[x]) & 0xff : row[x];
  }
  return out;
}

/**
 * Encodes binary-alpha RGBA as an indexed PNG: index 0 is transparent, the others are the opaque
 * colours ordered by frequency then value. The smallest of a few deterministic encodings wins.
 */
function encodeIndexedPng({ width, height, rgba }) {
  const counts = new Map();
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    if (rgba[o + 3] === 0) continue;
    if (rgba[o + 3] !== 255) throw new Error('encodeIndexedPng expects binary alpha');
    const key = (rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const colours = [...counts.entries()].sort((p, q) => q[1] - p[1] || p[0] - q[0]).map(([key]) => key);
  if (colours.length > 255) throw new Error(`${colours.length} colours do not fit an indexed PNG`);
  const indexOf = new Map(colours.map((key, i) => [key, i + 1]));
  const plte = Buffer.alloc((colours.length + 1) * 3);
  colours.forEach((key, i) => {
    plte[(i + 1) * 3] = key >> 16;
    plte[(i + 1) * 3 + 1] = (key >> 8) & 0xff;
    plte[(i + 1) * 3 + 2] = key & 0xff;
  });
  const indices = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    if (rgba[o + 3] === 0) continue;
    indices[i] = indexOf.get((rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  let idat = null;
  for (const adaptive of [false, true]) {
    for (const strategy of [zlib.constants.Z_DEFAULT_STRATEGY, zlib.constants.Z_FILTERED]) {
      const candidate = zlib.deflateSync(filterRows(indices, width, height, adaptive), {
        level: 9,
        memLevel: 9,
        strategy,
      });
      if (!idat || candidate.length < idat.length) idat = candidate;
    }
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('tRNS', Buffer.from([0])),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------------------------
// Colour science: sRGB <-> OKLab (Björn Ottosson's reference matrices).

const toLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const LINEAR = Float64Array.from({ length: 256 }, (_, c) => toLinear(c));
const toSrgb8 = (v) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(c * 255)));
};

function rgbToOklab(r, g, b) {
  const lr = LINEAR[r];
  const lg = LINEAR[g];
  const lb = LINEAR[b];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function oklabToRgb(L, a, b) {
  return oklabToLinear(L, a, b).map(toSrgb8);
}

// ---------------------------------------------------------------------------------------------
// Quantiser: median cut in weighted OKLab, k-means refinement, chroma-preserving representatives.

const ACCENT_MIN_DISTANCE = 0.06;
const ACCENT_RADIUS = 0.05;

/**
 * @param {{ lab: number[], count: number }[]} items unique colours
 * @returns {{ palette: number[][], assignment: Int32Array }} sRGB palette and item -> palette index
 */
function quantize(items, { colors, accents, chromaWeight, keepChroma, refine }) {
  const weights = [1, chromaWeight, chromaWeight];
  const coord = (item, axis) => item.lab[axis] * weights[axis];
  const distance = (lab, centre) => {
    let d = 0;
    for (let axis = 0; axis < 3; axis += 1) {
      const delta = (lab[axis] - centre[axis]) * weights[axis];
      d += delta * delta;
    }
    return d;
  };
  const boxStats = (members) => {
    let n = 0;
    const sum = [0, 0, 0];
    const sq = [0, 0, 0];
    for (const i of members) {
      const item = items[i];
      n += item.count;
      for (let axis = 0; axis < 3; axis += 1) {
        const v = coord(item, axis);
        sum[axis] += item.count * v;
        sq[axis] += item.count * v * v;
      }
    }
    const variance = sq.map((s, axis) => s - (sum[axis] * sum[axis]) / n);
    return { members, variance, sse: variance[0] + variance[1] + variance[2] };
  };

  const boxes = [boxStats(items.map((_, i) => i))];
  while (boxes.length < colors - accents) {
    let pick = -1;
    for (let b = 0; b < boxes.length; b += 1) {
      if (boxes[b].members.length > 1 && (pick < 0 || boxes[b].sse > boxes[pick].sse)) pick = b;
    }
    if (pick < 0) break;
    const { members, variance } = boxes[pick];
    const axis = variance.indexOf(Math.max(...variance));
    const sorted = [...members].sort((p, q) => coord(items[p], axis) - coord(items[q], axis) || p - q);
    const total = sorted.reduce((n, i) => n + items[i].count, 0);
    let cut = 0;
    let acc = items[sorted[0]].count;
    while (cut < sorted.length - 2 && acc * 2 < total) {
      cut += 1;
      acc += items[sorted[cut]].count;
    }
    boxes.splice(pick, 1, boxStats(sorted.slice(0, cut + 1)), boxStats(sorted.slice(cut + 1)));
  }

  const assignment = new Int32Array(items.length);
  const nearest = new Float64Array(items.length);
  boxes.forEach((box, b) => box.members.forEach((i) => (assignment[i] = b)));
  const centroid = (b, restore) => {
    let n = 0;
    let chroma = 0;
    const sum = [0, 0, 0];
    items.forEach((item, i) => {
      if (assignment[i] !== b) return;
      n += item.count;
      chroma += item.count * Math.hypot(item.lab[1], item.lab[2]);
      for (let axis = 0; axis < 3; axis += 1) sum[axis] += item.count * item.lab[axis];
    });
    if (n === 0) return null;
    const mean = sum.map((s) => s / n);
    const vector = Math.hypot(mean[1], mean[2]);
    if (restore > 0 && vector > 1e-6) {
      const target = vector + restore * (chroma / n - vector);
      mean[1] *= target / vector;
      mean[2] *= target / vector;
    }
    return mean;
  };
  const assign = () =>
    items.forEach((item, i) => {
      nearest[i] = Infinity;
      centres.forEach((centre, c) => {
        const d = distance(item.lab, centre);
        if (d < nearest[i]) {
          nearest[i] = d;
          assignment[i] = c;
        }
      });
    });
  const lloyd = () => {
    for (let pass = 0; pass < refine; pass += 1) {
      assign();
      centres = centres.map((centre, c) => centroid(c, 0) ?? centre);
    }
  };
  let centres = boxes.map((_, b) => centroid(b, 0));
  lloyd();
  // Accent reserve: small groups of distinct colour (eyes, mouths, gems) that the median cut averaged
  // into a big neighbour get their own entry. Score = distance to the palette × local support (≤ 4 px).
  for (let k = 0; k < accents; k += 1) {
    assign();
    let pick = -1;
    let pickScore = 0;
    items.forEach((item, i) => {
      if (nearest[i] < ACCENT_MIN_DISTANCE ** 2) return;
      let support = 0;
      for (const other of items) {
        if (distance(item.lab, other.lab) <= ACCENT_RADIUS ** 2) support += other.count;
      }
      const score = nearest[i] * Math.min(support, 4);
      if (score > pickScore) {
        pick = i;
        pickScore = score;
      }
    });
    if (pick < 0) break;
    centres.push([...items[pick].lab]);
  }
  lloyd();
  assign();
  const palette = centres.map((centre, c) => {
    const lab = centroid(c, keepChroma) ?? centre;
    return oklabToRgb(lab[0], lab[1], lab[2]);
  });
  return { palette, assignment };
}

function uniqueColours(rgba, include) {
  const byKey = new Map();
  const keys = new Int32Array(SIZE * SIZE).fill(-1);
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    if (!include(i)) continue;
    const o = i * 4;
    const key = (rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2];
    keys[i] = key;
    const entry = byKey.get(key);
    if (entry) entry.count += 1;
    else byKey.set(key, { key, count: 1, lab: rgbToOklab(rgba[o], rgba[o + 1], rgba[o + 2]) });
  }
  const items = [...byKey.values()].sort((p, q) => p.key - q.key);
  const itemOf = new Map(items.map((item, i) => [item.key, i]));
  return { items, keys, itemOf };
}

function recolour(rgba, include, options) {
  const { items, keys, itemOf } = uniqueColours(rgba, include);
  const { palette, assignment } = quantize(items, options);
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    if (keys[i] < 0) continue;
    const colour = palette[assignment[itemOf.get(keys[i])]];
    rgba.set(colour, i * 4);
  }
}

// ---------------------------------------------------------------------------------------------
// Sprite steps.

const NEIGHBOURS = [
  [0, 1],
  [0, -1],
  [-1, 0],
  [1, 0],
];

function binaryAlpha(rgba) {
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    const o = i * 4;
    if (rgba[o + 3] >= ALPHA_CUTOFF) rgba[o + 3] = 255;
    else rgba.fill(0, o, o + 4);
  }
}

const RING = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

const CLEANUP_MAX_CHROMA_LOSS = 0.03;

/**
 * Cluster cleanup: a body pixel whose colour no 4-neighbour shares takes the most common colour of
 * its 8 neighbours when that colour is within `threshold` (OKLab ΔE) and not clearly duller. Painterly
 * texture merges into flat clusters; high-contrast or saturated details (eye glints, sparks, lava
 * seams) stay. Two order-free passes.
 */
function cleanClusters(rgba, threshold) {
  const labs = new Map();
  const labOf = (key) => {
    if (!labs.has(key)) labs.set(key, rgbToOklab(key >> 16, (key >> 8) & 0xff, key & 0xff));
    return labs.get(key);
  };
  const keyAt = (src, x, y) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return -1;
    const o = (y * SIZE + x) * 4;
    return src[o + 3] === 0 ? -1 : (src[o] << 16) | (src[o + 1] << 8) | src[o + 2];
  };
  for (let pass = 0; pass < 2; pass += 1) {
    const src = Uint8Array.from(rgba);
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const key = keyAt(src, x, y);
        if (key < 0) continue;
        if (NEIGHBOURS.some(([dx, dy]) => keyAt(src, x + dx, y + dy) === key)) continue;
        const votes = new Map();
        for (const [dx, dy] of RING) {
          const neighbour = keyAt(src, x + dx, y + dy);
          if (neighbour >= 0) votes.set(neighbour, (votes.get(neighbour) ?? 0) + 1);
        }
        const lab = labOf(key);
        let best = -1;
        let bestVotes = 0;
        let bestDistance = Infinity;
        for (const [candidate, count] of votes) {
          const other = labOf(candidate);
          const distance = Math.hypot(lab[0] - other[0], lab[1] - other[1], lab[2] - other[2]);
          const chromaLoss = Math.hypot(lab[1], lab[2]) - Math.hypot(other[1], other[2]);
          if (distance > threshold || chromaLoss > CLEANUP_MAX_CHROMA_LOSS) continue;
          const closer = distance < bestDistance || (distance === bestDistance && candidate < best);
          if (count > bestVotes || (count === bestVotes && closer)) {
            best = candidate;
            bestVotes = count;
            bestDistance = distance;
          }
        }
        if (best >= 0 && bestVotes >= 2) {
          rgba.set([best >> 16, (best >> 8) & 0xff, best & 0xff], (y * SIZE + x) * 4);
        }
      }
    }
  }
}

/** Marks opaque pixels that belong to 8-connected components smaller than `minArea` (sparks, bubbles). */
function smallComponents(rgba, minArea) {
  const small = new Uint8Array(SIZE * SIZE);
  const seen = new Uint8Array(SIZE * SIZE);
  for (let start = 0; start < SIZE * SIZE; start += 1) {
    if (seen[start] || rgba[start * 4 + 3] === 0) continue;
    const component = [start];
    seen[start] = 1;
    for (let k = 0; k < component.length; k += 1) {
      const x = component[k] % SIZE;
      const y = Math.floor(component[k] / SIZE);
      for (const [dx, dy] of RING) {
        const nx = x + dx;
        const ny = y + dy;
        const j = ny * SIZE + nx;
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE || seen[j] || rgba[j * 4 + 3] === 0) continue;
        seen[j] = 1;
        component.push(j);
      }
    }
    if (component.length < minArea) for (const i of component) small[i] = 1;
  }
  return small;
}

/**
 * 1 px selective outline: each transparent pixel touching the body takes a darkened neighbour colour.
 * Loose particles smaller than `outlineMinArea` keep their glow unoutlined.
 */
function addOutline(rgba, { outline, outlineColors, outlineMinArea, chromaWeight }) {
  const small = smallComponents(rgba, outlineMinArea);
  const ring = new Uint8Array(SIZE * SIZE);
  const out = Uint8Array.from(rgba);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const i = y * SIZE + x;
      if (rgba[i * 4 + 3] !== 0) continue;
      let n = 0;
      const sum = [0, 0, 0];
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
        const j = ny * SIZE + nx;
        if (rgba[j * 4 + 3] === 0 || small[j]) continue;
        n += 1;
        for (let c = 0; c < 3; c += 1) sum[c] += rgba[j * 4 + c];
      }
      if (n === 0) continue;
      ring[i] = 1;
      out.set([...sum.map((s) => Math.round((s / n) * outline)), 255], i * 4);
    }
  }
  recolour(out, (i) => ring[i] === 1, {
    colors: outlineColors,
    accents: 0,
    chromaWeight,
    keepChroma: 0,
    refine: 4,
  });
  rgba.set(out);
}

function opaqueRows(rgba) {
  let top = SIZE;
  let bottom = -1;
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    if (rgba[i * 4 + 3] === 0) continue;
    const y = Math.floor(i / SIZE);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  return { top, bottom };
}

function moveToBaseline(id, rgba) {
  const { top, bottom } = opaqueRows(rgba);
  const shift = BASELINE_ROW - bottom;
  if (top + shift < 0) throw new Error(`${id}: baseline shift ${shift} would crop ${-(top + shift)} rows`);
  const out = new Uint8Array(SIZE * SIZE * 4);
  for (let y = top; y <= bottom; y += 1) {
    out.set(rgba.subarray(y * SIZE * 4, (y + 1) * SIZE * 4), (y + shift) * SIZE * 4);
  }
  rgba.set(out);
}

function measure(id, rgba) {
  let x0 = SIZE;
  let y0 = SIZE;
  let x1 = -1;
  let y1 = -1;
  let mass = 0;
  const colours = new Set();
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    const o = i * 4;
    const alpha = rgba[o + 3];
    if (alpha !== 0 && alpha !== 255) throw new Error(`${id}: alpha is not binary`);
    if (alpha === 0) continue;
    const x = i % SIZE;
    const y = Math.floor(i / SIZE);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
    mass += 1;
    colours.add((rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2]);
  }
  return { bbox: [x0, y0, x1, y1], footRow: y1, mass, colors: colours.size };
}

async function normalizeSprite(id) {
  const config = SPRITES[id];
  const sourcePath = `art/monsters/originals/${id}.png`;
  const image = decodePng(await readFile(path.join(ROOT, sourcePath)));
  if (image.width !== SIZE || image.height !== SIZE) throw new Error(`${id}: expected ${SIZE}×${SIZE}`);
  const { rgba } = image;
  const fullPass = config.family !== 'A';
  const options = { ...FULL_PASS, ...config };
  if (fullPass) {
    binaryAlpha(rgba);
    recolour(rgba, (i) => rgba[i * 4 + 3] === 255, options);
    if (options.cleanup > 0) cleanClusters(rgba, options.cleanup);
    addOutline(rgba, options);
  } else if (config.colors) {
    recolour(rgba, (i) => rgba[i * 4 + 3] === 255, options);
  }
  moveToBaseline(id, rgba);
  const metrics = measure(id, rgba);
  if (metrics.colors > MAX_COLORS) throw new Error(`${id}: ${metrics.colors} colours exceed ${MAX_COLORS}`);
  const png = encodeIndexedPng({ width: SIZE, height: SIZE, rgba });
  await writeFile(path.join(ROOT, `assets/monsters/${id}/battle.png`), png);
  return {
    id,
    bytes: png.length,
    metrics,
    normalized: { colors: metrics.colors, outline: fullPass, baseline: BASELINE_ROW, sourcePath },
  };
}

// ---------------------------------------------------------------------------------------------
// Chromatique variants (see CHROMATIQUES).

const CHROMATIQUE_NEUTRAL_C = 0.03; // below this OKLCh chroma a colour is a neutral and is kept
const CHROMATIQUE_ACCENT_GAP = 50; // degrees from the body hue beyond which a small group is an accent
const CHROMATIQUE_ACCENT_SHARE = 0.12; // share of the chromatic texels under which a hue group is small
const CHROMATIQUE_FAMILY = 25; // half-width in degrees of a hue group
const CHROMATIQUE_OUTLINE_SHARE = 0.5; // share of silhouette-edge texels above which a colour is outline

const hueGap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const inGamut = (rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

// The chroma-weighted dominant hue: the peak of a smoothed 10° histogram, refined by the circular
// mean of the colours within one group of that peak.
function dominantHue(colours) {
  const bins = new Float64Array(36);
  for (const { count, C, h } of colours) bins[Math.floor(h / 10) % 36] += count * C;
  let peak = 0;
  let best = -1;
  for (let i = 0; i < 36; i += 1) {
    const value = bins[(i + 35) % 36] + 2 * bins[i] + bins[(i + 1) % 36];
    if (value > best) [best, peak] = [value, i];
  }
  let x = 0;
  let y = 0;
  for (const { count, C, h } of colours) {
    if (hueGap(h, peak * 10 + 5) > CHROMATIQUE_FAMILY) continue;
    x += count * C * Math.cos((h * Math.PI) / 180);
    y += count * C * Math.sin((h * Math.PI) / 180);
  }
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// OKLCh colour -> sRGB bytes, lowering chroma until the colour fits the sRGB gamut.
function lchToRgb(L, C, h) {
  const rad = (h * Math.PI) / 180;
  const lab = (c) => [L, c * Math.cos(rad), c * Math.sin(rad)];
  if (!inGamut(oklabToLinear(...lab(C)))) {
    let lo = 0;
    let hi = C;
    for (let step = 0; step < 24; step += 1) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToLinear(...lab(mid)))) lo = mid;
      else hi = mid;
    }
    C = lo;
  }
  return oklabToRgb(...lab(C));
}

/** Maps every opaque colour of a normalised sprite to its Chromatique colour: `{ palette, body }`,
 * `palette` a `Map<key, rgb>` and `body` the source hue that rotates onto `to`. */
function chromatiquePalette(
  rgba,
  { to, from = null, chroma = 1, ramp = 0, keep = [], light = 1, neutral = null }
) {
  const counts = new Map();
  const edges = new Map();
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    const o = i * 4;
    if (rgba[o + 3] === 0) continue;
    const key = (rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const x = i % SIZE;
    const y = (i - x) / SIZE;
    const edge = NEIGHBOURS.some(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      return nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE || rgba[(ny * SIZE + nx) * 4 + 3] === 0;
    });
    if (edge) edges.set(key, (edges.get(key) ?? 0) + 1);
  }
  const colours = [...counts.entries()]
    .sort((p, q) => p[0] - q[0])
    .map(([key, count]) => {
      const [L, a, b] = rgbToOklab(key >> 16, (key >> 8) & 0xff, key & 0xff);
      return { key, count, L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
    });
  const chromatic = colours.filter(({ C }) => C >= CHROMATIQUE_NEUTRAL_C);
  const chromaticTexels = chromatic.reduce((sum, { count }) => sum + count, 0);
  const body = from ?? dominantHue(chromatic);
  const shift = to - body;
  const groupShare = (hue) =>
    chromatic.reduce((sum, { count, h }) => sum + (hueGap(h, hue) <= CHROMATIQUE_FAMILY ? count : 0), 0) /
    chromaticTexels;
  const kept = (h) =>
    keep.some(([from, until]) => (from <= until ? h >= from && h <= until : h >= from || h <= until)) ||
    (hueGap(h, body) > CHROMATIQUE_ACCENT_GAP && groupShare(h) < CHROMATIQUE_ACCENT_SHARE);
  // Outline colours (mostly on the silhouette edge) keep their lightness so the contour still reads.
  const lightness = (key, L) =>
    (edges.get(key) ?? 0) / counts.get(key) > CHROMATIQUE_OUTLINE_SHARE ? L : L ** light;
  const palette = new Map();
  for (const { key, L, C, h } of colours) {
    let rgb = [key >> 16, (key >> 8) & 0xff, key & 0xff];
    if (C < CHROMATIQUE_NEUTRAL_C) {
      if (neutral !== null) {
        const lit = lightness(key, L);
        rgb = lchToRgb(lit, neutral, (to + ramp * (lit - 0.62) + 720) % 360);
      }
    } else if (!kept(h)) {
      rgb = lchToRgb(lightness(key, L), C * chroma, (h + shift + ramp * (L - 0.62) + 720) % 360);
    }
    palette.set(key, rgb);
  }
  return { palette, body };
}

async function bakeChromatique(id) {
  const from = `assets/monsters/${id}/battle.png`;
  const final = `assets/monsters/${id}/battle-shiny.png`;
  const { rgba } = decodePng(await readFile(path.join(ROOT, from)));
  const { palette, body } = chromatiquePalette(rgba, CHROMATIQUES[id]);
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    const o = i * 4;
    if (rgba[o + 3] === 0) continue;
    rgba.set(palette.get((rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2]), o);
  }
  const metrics = measure(id, rgba);
  const png = encodeIndexedPng({ width: SIZE, height: SIZE, rgba });
  await writeFile(path.join(ROOT, final), png);
  return {
    id,
    bytes: png.length,
    metrics,
    chromatique: { final, from, bodyHue: Math.round(body), hue: CHROMATIQUES[id].to, colors: metrics.colors },
  };
}

// ---------------------------------------------------------------------------------------------
// Outputs: metrics module and manifest provenance.

function metricsModule(results) {
  const rows = results
    .map(({ id, metrics }) => {
      const { bbox, footRow, mass } = metrics;
      return `  ${id}: { bbox: [${bbox.join(', ')}], footRow: ${footRow}, sizeClass: '${SPRITES[id].sizeClass}', mass: ${mass} },`;
    })
    .join('\n');
  return `// Generated by tools/normalize-sprites.mjs from the normalised battle sprites. Do not edit by hand:
// change the tool's SPRITES table and re-run \`node tools/normalize-sprites.mjs\`.

/** Every battle sprite is a ${SIZE}×${SIZE} canvas; metrics below are in texels of that canvas. */
export const SPRITE_CANVAS = ${SIZE};

/**
 * Per-creature sprite metrics.
 * - \`bbox\`: inclusive opaque bounds \`[x0, y0, x1, y1]\`.
 * - \`footRow\`: lowest opaque row; the normaliser puts every creature's feet on row ${BASELINE_ROW}.
 * - \`sizeClass\`: authored design size, \`'S' | 'M' | 'L'\`.
 * - \`mass\`: number of opaque texels.
 */
export const SPRITE_METRICS = {
${rows}
};

/**
 * Size-class bands for \`spriteMassScale\`, relative to the caller's target.
 * - \`mass\`: rendered geometric-mean bbox size, \`sqrt(bw·bh)·scale\`, as a multiple of the target.
 * - \`maxWidth\` / \`maxHeight\`: caps on the rendered bbox so flat or tall silhouettes stay in their pad.
 */
export const SIZE_CLASSES = {
  S: { mass: 0.86, maxWidth: 1.3, maxHeight: 1.2 },
  M: { mass: 1, maxWidth: 1.5, maxHeight: 1.35 },
  L: { mass: 1.14, maxWidth: 1.7, maxHeight: 1.45 },
};

/**
 * Visual-mass normalisation. Returns the texel scale (world units or CSS px per texel, the same unit
 * as \`target\`) that gives creature \`id\` the rendered mass of its size class:
 * \`scale = target·mass / sqrt(bw·bh)\`, clamped so the bbox stays within the class caps.
 * Anchor the sprite at \`footRow\` so its feet sit on the pad.
 * @param {string} id creature id
 * @param {number} target rendered \`sqrt(bw·bh)\` of a medium creature
 */
export function spriteMassScale(id, target) {
  const { bbox, sizeClass } = SPRITE_METRICS[id];
  const width = bbox[2] - bbox[0] + 1;
  const height = bbox[3] - bbox[1] + 1;
  const band = SIZE_CLASSES[sizeClass];
  return Math.min(
    (target * band.mass) / Math.sqrt(width * height),
    (target * band.maxWidth) / width,
    (target * band.maxHeight) / height
  );
}
`;
}

// Writes each result's `field` block (`normalized` or `chromatique`) into its manifest entry.
async function updateManifest(results, field) {
  const file = path.join(ROOT, 'assets/asset-manifest.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  const byId = new Map(results.map((result) => [result.id, result[field]]));
  for (const asset of manifest.assets) {
    if (!byId.has(asset.creature)) throw new Error(`manifest entry ${asset.creature} has no sprite config`);
    asset[field] = byId.get(asset.creature);
    byId.delete(asset.creature);
  }
  if (byId.size) throw new Error(`manifest has no entry for ${[...byId.keys()].join(', ')}`);
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

function report(label, results) {
  for (const { id, bytes, metrics } of results)
    console.log(
      `${id.padEnd(11)} ${String(metrics.colors).padStart(3)} colours ${String(bytes).padStart(6)} B`
    );
  console.log(`${label} total ${results.reduce((sum, { bytes }) => sum + bytes, 0)} B`);
}

// `--chromatiques` only re-bakes the Chromatique variants from the current battle sprites.
async function main() {
  const { CREATURES } = await import(pathToFileURL(path.join(ROOT, 'src/data/creatures.js')).href);
  const ids = Object.keys(CREATURES).sort();
  const missing = ids.filter((id) => !SPRITES[id] || !CHROMATIQUES[id]);
  if (missing.length) throw new Error(`no SPRITES/CHROMATIQUES entry for ${missing.join(', ')}`);
  if (!process.argv.includes('--chromatiques')) {
    const results = [];
    for (const id of ids) results.push(await normalizeSprite(id));
    await writeFile(path.join(ROOT, 'src/data/sprite-metrics.js'), metricsModule(results));
    await updateManifest(results, 'normalized');
    report('battle', results);
  }
  const variants = [];
  for (const id of ids) variants.push(await bakeChromatique(id));
  await updateManifest(variants, 'chromatique');
  report('chromatique', variants);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
