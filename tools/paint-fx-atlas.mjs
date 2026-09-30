// Paints the battle FX atlas (assets/fx/atlas.png) procedurally: 8 × 8 cells of 128 px, white art on
// alpha (tinted at runtime), stored premultiplied (rgb = luminance × alpha). Cell names and indices
// come from ATLAS in src/data/choreo.js (docs/battle-presentation.md §9.4).
//
// Two looks, one family: light cells (glow, ring, streak, smoke, speedline, shield) are smooth
// gradients painted at full resolution; object cells and the 30 creature motifs are pixel art on a
// 32- or 64-texel grid (upscaled with nearest neighbour), lit from the top left with a bevel and a
// dark outline, plus an optional soft halo so additive sprites bloom without a post pass.
//
//   node tools/paint-fx-atlas.mjs [--preview <file.png>]
//
// Needs Playwright's Chromium (a dev dependency). Every cell keeps a ≥ 4 px empty border.
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATLAS } from '../src/data/choreo.js';
import { AFFINITIES, AFFINITY_ORDER } from '../src/data/affinities.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, ATLAS.url);
const previewIndex = process.argv.indexOf('--preview');
const previewPath = previewIndex > 0 ? path.resolve(process.argv[previewIndex + 1]) : null;

// Runs in the page: returns the premultiplied RGBA atlas as a base64 string.
function paintAtlas({ cells, size, grid }) {
  const CELL = size / grid;
  const atlas = new Float32Array(size * size * 4);

  const canvas = (w, h = w) => Object.assign(document.createElement('canvas'), { width: w, height: h });
  const gray = (level, alpha = 1) =>
    `rgba(${Math.round(level * 255)},${Math.round(level * 255)},${Math.round(level * 255)},${alpha})`;
  const TAU = Math.PI * 2;

  // Shape helpers shared by the pixel painters (coordinates in grid texels).
  function helpers(g) {
    return {
      g,
      poly(points) {
        g.beginPath();
        points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.closePath();
        g.fill();
      },
      circle(x, y, r) {
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
      },
      ellipse(x, y, rx, ry, rotation = 0) {
        g.beginPath();
        g.ellipse(x, y, rx, ry, rotation, 0, TAU);
        g.fill();
      },
      rect(x, y, w, h, r = 0) {
        g.beginPath();
        g.roundRect(x, y, w, h, r);
        g.fill();
      },
      line(points, width, cap = 'round') {
        g.lineWidth = width;
        g.lineCap = cap;
        g.lineJoin = 'round';
        g.beginPath();
        points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.stroke();
      },
      path(d, { fill = true, width = 0 } = {}) {
        const shape = new Path2D(d);
        if (fill) g.fill(shape);
        if (width) {
          g.lineWidth = width;
          g.lineCap = 'round';
          g.lineJoin = 'round';
          g.stroke(shape);
        }
      },
      ring(x, y, r, width, from = 0, to = TAU) {
        g.lineWidth = width;
        g.lineCap = 'butt';
        g.beginPath();
        g.arc(x, y, r, from, to);
        g.stroke();
      },
      star(x, y, points, outer, inner, rotation = -Math.PI / 2) {
        const pts = [];
        for (let i = 0; i < points * 2; i++) {
          const r = i % 2 ? inner : outer,
            a = rotation + (i * Math.PI) / points;
          pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
        }
        this.poly(pts);
      },
      spiral(x, y, turns, r0, r1, width, start = 0) {
        const pts = [];
        for (let i = 0; i <= 120; i++) {
          const t = i / 120,
            a = start + t * turns * TAU,
            r = r0 + (r1 - r0) * t;
          pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
        }
        this.line(pts, width);
      },
      cut(fn) {
        g.save();
        g.globalCompositeOperation = 'destination-out';
        g.fillStyle = g.strokeStyle = '#000';
        fn();
        g.restore();
      },
      level(value) {
        g.fillStyle = g.strokeStyle = gray(value);
      },
    };
  }

  // Pixel cell: `mask(h)` draws the silhouette in white; `details(h)` repaints texels at chosen
  // levels (h.level). Bevel lights the top-left edges and shades the bottom-right ones.
  function pixelCell({
    n = 32,
    mask,
    details,
    bevel = true,
    outline = 0.34,
    halo = 0,
    body = 0.8,
    lit = 1,
    shade = 0.58,
  }) {
    const layer = canvas(n),
      g = layer.getContext('2d');
    g.fillStyle = g.strokeStyle = '#fff';
    mask(helpers(g));
    const maskData = g.getImageData(0, 0, n, n).data,
      solid = new Uint8Array(n * n),
      level = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) solid[i] = maskData[i * 4 + 3] >= 128 ? 1 : 0;
    const at = (x, y) => (x < 0 || y < 0 || x >= n || y >= n ? 0 : solid[y * n + x]);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (!at(x, y)) continue;
        let value = body;
        if (bevel) {
          if (!at(x - 1, y - 1) || !at(x, y - 1)) value = lit;
          else if (!at(x + 1, y + 1) || !at(x, y + 1)) value = shade;
        }
        level[y * n + x] = value;
      }
    if (details) {
      const detail = canvas(n),
        d = detail.getContext('2d');
      details(helpers(d));
      const data = d.getImageData(0, 0, n, n).data;
      for (let i = 0; i < n * n; i++)
        if (data[i * 4 + 3] >= 128) {
          solid[i] = 1;
          level[i] = data[i * 4] / 255;
        }
    }
    const alpha = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) alpha[i] = solid[i];
    if (outline !== null)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          if (solid[i]) continue;
          if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) {
            alpha[i] = 1;
            level[i] = outline;
          }
        }
    // Upscale ×(CELL / n) with nearest neighbour into a premultiplied cell buffer.
    const scale = CELL / n,
      out = new Float32Array(CELL * CELL * 2); // [luminance·alpha, alpha]
    for (let y = 0; y < CELL; y++)
      for (let x = 0; x < CELL; x++) {
        const i = Math.floor(y / scale) * n + Math.floor(x / scale),
          o = (y * CELL + x) * 2;
        out[o] = level[i] * alpha[i];
        out[o + 1] = alpha[i];
      }
    if (halo) addHalo(out, halo);
    return out;
  }

  // A soft bloom under the art: blurred coverage, luminance 1, composited behind.
  function addHalo(cell, strength) {
    const source = canvas(CELL),
      g = source.getContext('2d'),
      image = g.createImageData(CELL, CELL);
    for (let i = 0; i < CELL * CELL; i++) image.data[i * 4 + 3] = Math.round(cell[i * 2 + 1] * 255);
    g.putImageData(image, 0, 0);
    const blurred = canvas(CELL),
      b = blurred.getContext('2d');
    b.filter = 'blur(7px)';
    b.drawImage(source, 0, 0);
    const blur = b.getImageData(0, 0, CELL, CELL).data;
    for (let i = 0; i < CELL * CELL; i++) {
      const glow = Math.min(1, (blur[i * 4 + 3] / 255) * 1.6) * strength,
        a = cell[i * 2 + 1];
      cell[i * 2] += glow * (1 - a);
      cell[i * 2 + 1] = a + glow * (1 - a);
    }
  }

  // Smooth cell painted at full resolution with canvas (white, alpha carries coverage).
  function smoothCell(paint) {
    const layer = canvas(CELL),
      g = layer.getContext('2d');
    paint(g, helpers(g));
    const data = g.getImageData(0, 0, CELL, CELL).data,
      out = new Float32Array(CELL * CELL * 2);
    for (let i = 0; i < CELL * CELL; i++) {
      const a = data[i * 4 + 3] / 255;
      out[i * 2] = (data[i * 4] / 255) * a;
      out[i * 2 + 1] = a;
    }
    return out;
  }

  // Per-texel field cell: f(x, y) → [luminance, alpha] with x, y in [-1, 1].
  function fieldCell(f) {
    const out = new Float32Array(CELL * CELL * 2);
    for (let y = 0; y < CELL; y++)
      for (let x = 0; x < CELL; x++) {
        const [l, a] = f(((x + 0.5) / CELL) * 2 - 1, ((y + 0.5) / CELL) * 2 - 1),
          alpha = Math.max(0, Math.min(1, a)),
          o = (y * CELL + x) * 2;
        out[o] = Math.max(0, Math.min(1, l)) * alpha;
        out[o + 1] = alpha;
      }
    return out;
  }

  const smooth = (t) => t * t * (3 - 2 * t);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  // --- Generic cells ------------------------------------------------------------------------------
  const PAINTERS = {
    glow: () =>
      fieldCell((x, y) => {
        const d = Math.hypot(x, y) / 0.94;
        if (d >= 1) return [1, 0];
        const falloff = Math.exp(-4.2 * d * d) - Math.exp(-4.2);
        return [1, falloff / (1 - Math.exp(-4.2))];
      }),
    spark: () =>
      pixelCell({
        halo: 0.55,
        outline: null,
        bevel: false,
        body: 1,
        mask: (h) => {
          h.poly([
            [16, 3],
            [17.4, 14.6],
            [16, 29],
            [14.6, 17.4],
          ]);
          h.poly([
            [3, 16],
            [14.6, 14.6],
            [29, 16],
            [17.4, 17.4],
          ]);
          h.circle(16, 16, 3.2);
        },
        details: (h) => {
          h.level(0.72);
          h.poly([
            [7, 7],
            [15, 14.6],
            [25, 25],
            [17, 17.4],
          ]);
          h.poly([
            [25, 7],
            [17.4, 15],
            [7, 25],
            [14.6, 17],
          ]);
          h.level(1);
          h.circle(16, 16, 3.2);
          h.poly([
            [16, 3],
            [17.4, 14.6],
            [16, 29],
            [14.6, 17.4],
          ]);
          h.poly([
            [3, 16],
            [14.6, 14.6],
            [29, 16],
            [17.4, 17.4],
          ]);
        },
      }),
    streak: () =>
      fieldCell((x, y) => {
        const t = (x + 0.92) / 1.84; // 0 tail → 1 head (right)
        if (t <= 0 || t >= 1) return [1, 0];
        const head = t > 0.88 ? Math.sqrt(1 - ((t - 0.88) / 0.12) ** 2) : 1,
          half = 0.06 + 0.2 * t ** 1.2,
          v = Math.abs(y) / (half * head + 1e-6);
        if (v >= 1) return [1, 0];
        const along = smooth(Math.min(1, t * 1.25)),
          core = Math.exp(-4 * v * v);
        return [0.8 + 0.2 * core, along * (0.45 + 0.55 * core) * (1 - v * v * v)];
      }),
    ring: () =>
      fieldCell((x, y) => {
        const d = Math.hypot(x, y),
          core = Math.exp(-(((d - 0.82) / 0.035) ** 2)),
          soft = 0.32 * Math.exp(-(((d - 0.8) / 0.09) ** 2)),
          fade = d > 0.94 ? clamp01((0.97 - d) / 0.03) : 1;
        return [0.8 + 0.2 * core, (core + soft * (1 - core)) * fade];
      }),
    shard: () =>
      pixelCell({
        halo: 0.2,
        mask: (h) =>
          h.poly([
            [27, 4],
            [26, 14],
            [11, 28],
            [5, 25],
            [15, 10],
          ]),
        details: (h) => {
          h.level(1);
          h.line(
            [
              [26, 5],
              [8, 26],
            ],
            1.2
          );
          h.level(0.62);
          h.poly([
            [25.5, 14],
            [11, 27.5],
            [9.5, 26.5],
            [25, 7],
          ]);
          h.level(1);
          h.line(
            [
              [26, 5],
              [8.2, 25.8],
            ],
            1.1
          );
        },
      }),
    leaf: () =>
      pixelCell({
        mask: (h) => {
          h.path('M6 26 Q5 9 27 5 Q25 25 6 26 Z');
          h.line(
            [
              [3.5, 28.5],
              [7, 25],
            ],
            1.8
          );
        },
        details: (h) => {
          h.level(0.56);
          h.line(
            [
              [7, 25],
              [24, 8],
            ],
            1.1
          );
          h.line(
            [
              [12, 20],
              [11, 13],
            ],
            1
          );
          h.line(
            [
              [17, 15],
              [21, 20],
            ],
            1
          );
        },
      }),
    drop: () =>
      pixelCell({
        halo: 0.15,
        mask: (h) => h.path('M16 3 C17 7 25 14 25 20 A9 9 0 0 1 7 20 C7 14 15 7 16 3 Z'),
        details: (h) => {
          h.level(1);
          h.ellipse(12, 19, 1.6, 3, 0.3);
        },
      }),
    bolt: () =>
      pixelCell({
        halo: 0.5,
        outline: 0.4,
        body: 0.92,
        mask: (h) =>
          h.poly([
            [2, 18],
            [12, 10],
            [12.5, 14.5],
            [21, 8.5],
            [21, 12.5],
            [30, 13],
            [20, 20.5],
            [19.5, 16.5],
            [11, 22],
            [10.5, 17.5],
          ]),
      }),
    rune: () =>
      pixelCell({
        n: 64,
        halo: 0.35,
        outline: null,
        bevel: false,
        body: 1,
        mask: (h) => {
          h.ring(32, 32, 26, 2.6);
          h.ring(32, 32, 20.5, 1.6);
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * TAU,
              r0 = i % 3 ? 22 : 16,
              r1 = 24.5;
            h.line(
              [
                [32 + Math.cos(a) * r0, 32 + Math.sin(a) * r0],
                [32 + Math.cos(a) * r1, 32 + Math.sin(a) * r1],
              ],
              1.6
            );
          }
          const tri = [0, 1, 2].map((i) => {
            const a = -Math.PI / 2 + (i * TAU) / 3;
            return [32 + Math.cos(a) * 16, 32 + Math.sin(a) * 16];
          });
          h.line([...tri, tri[0]], 2);
          h.circle(32, 32, 3.4);
          tri.forEach(([x, y]) => h.circle(x, y, 2.4));
        },
        details: (h) => {
          h.level(0.62);
          h.ring(32, 32, 20.5, 1.6);
        },
      }),
    star: () => pixelCell({ halo: 0.35, mask: (h) => h.star(16, 17, 5, 13, 5.6) }),
    smoke: () => {
      const blobs = Array.from({ length: 13 }, (_, i) => {
        const a = (i / 13) * TAU + random() * 0.5,
          r = 0.2 + random() * 0.34;
        return [Math.cos(a) * r, Math.sin(a) * r * 0.75 + 0.04, 0.17 + random() * 0.12];
      });
      blobs.push([0, 0.02, 0.36], [-0.12, -0.12, 0.26], [0.16, -0.08, 0.24]);
      return fieldCell((x, y) => {
        let sum = 0;
        for (const [bx, by, br] of blobs)
          sum += Math.exp(-(((x - bx) ** 2 + (y - by) ** 2) / (br * br)) * 2.4);
        const edge = clamp01((0.95 - Math.hypot(x, y)) / 0.18),
          density = clamp01((sum - 0.25) * 1.1);
        return [0.62 + 0.38 * clamp01(0.55 - y * 0.9), density ** 0.9 * edge];
      });
    },
    crescent: () =>
      pixelCell({
        n: 64,
        halo: 0.45,
        outline: null,
        body: 0.9,
        mask: (h) => {
          h.circle(29, 35, 25);
          h.cut(() => h.circle(35, 29, 24.5));
        },
        details: (h) => {
          h.level(1);
          h.ring(29, 35, 24, 1.8, Math.PI * 0.62, Math.PI * 1.88);
        },
      }),
    ember: () =>
      pixelCell({
        halo: 0.5,
        body: 0.72,
        outline: 0.4,
        mask: (h) => h.path('M16 3 C20 9 25 13 24 20 A8 8 0 0 1 8 20 C7 14 13 11 16 3 Z'),
        details: (h) => {
          h.level(0.9);
          h.path('M16 11 C19 15 21 17 20.5 21 A4.6 4.6 0 0 1 11.5 21 C11 18 14.5 16 16 11 Z');
          h.level(1);
          h.path('M16 16 C17.5 18 18.3 19.5 18 21.5 A2.2 2.2 0 0 1 14 21.5 C13.8 19.5 15.4 18.4 16 16 Z');
        },
      }),
    bubble: () =>
      pixelCell({
        halo: 0.2,
        outline: null,
        bevel: false,
        body: 0.24,
        mask: (h) => h.circle(16, 16, 12),
        details: (h) => {
          h.level(0.86);
          h.ring(16, 16, 11.2, 1.8);
          h.level(1);
          h.ring(16, 16, 7.5, 1.6, Math.PI * 1.05, Math.PI * 1.45);
          h.circle(11, 10.5, 1.4);
        },
      }),
    petal: () =>
      pixelCell({
        mask: (h) => h.path('M16 28 C6 22 5 12 10 5 L16 9.5 L22 5 C27 12 26 22 16 28 Z'),
        details: (h) => {
          h.level(0.62);
          h.line(
            [
              [16, 26],
              [16, 14],
            ],
            1.1
          );
          h.level(1);
          h.circle(12.5, 12, 1.2);
        },
      }),
    feather: () =>
      pixelCell({
        mask: (h) => {
          h.path('M6 27 Q7 12 26 4 Q27 17 9 26 Z');
          h.line(
            [
              [4, 29],
              [9, 24],
            ],
            1.6
          );
        },
        details: (h) => {
          h.level(1);
          h.line(
            [
              [7, 26],
              [24, 6],
            ],
            1.2
          );
          h.level(0.6);
          h.line(
            [
              [12, 16],
              [16, 16],
            ],
            1
          );
          h.line(
            [
              [16, 11.5],
              [21, 12],
            ],
            1
          );
          h.line(
            [
              [14, 22],
              [18, 19],
            ],
            1
          );
          h.cut(() => {
            h.poly([
              [6.5, 18.5],
              [10.5, 17],
              [7, 21],
            ]);
            h.poly([
              [21, 21],
              [17, 21.5],
              [20, 18],
            ]);
          });
        },
      }),
    dust: () =>
      pixelCell({
        outline: 0.42,
        body: 0.78,
        shade: 0.55,
        mask: (h) => {
          h.circle(11, 20, 6.5);
          h.circle(17.5, 15, 7.5);
          h.circle(23, 20, 5.8);
          h.circle(16, 22, 6);
          h.rect(8, 21, 17, 5, 2.5);
        },
      }),
    reticle: () =>
      pixelCell({
        n: 64,
        halo: 0.25,
        outline: 0.3,
        bevel: false,
        body: 1,
        mask: (h) => {
          h.ring(32, 32, 22, 3.4);
          h.cut(() => {
            for (let i = 0; i < 4; i++) {
              const a = (i * TAU) / 4;
              h.g.save();
              h.g.translate(32, 32);
              h.g.rotate(a);
              h.g.fillRect(-4.5, -30, 9, 12);
              h.g.restore();
            }
          });
          for (let i = 0; i < 4; i++) {
            const a = (i * TAU) / 4,
              c = Math.cos(a),
              s = Math.sin(a);
            h.line(
              [
                [32 + c * 14, 32 + s * 14],
                [32 + c * 28, 32 + s * 28],
              ],
              3.2,
              'butt'
            );
          }
          h.circle(32, 32, 3);
        },
      }),
    vine: () =>
      pixelCell({
        outline: 0.36,
        mask: (h) => {
          h.path('M7 29 C3 21 18 21 16 13 C15 8 17 4 23 4.5 C27 5 27.5 10 24 10.5', {
            fill: false,
            width: 3.4,
          });
          h.path('M11.5 20.5 C9 16 5 16 3.5 18.5 C6 21.5 9 22 11.5 20.5 Z');
          h.path('M17 17 C20 14 25 15 26.5 17.5 C23 19.5 19.5 19.5 17 17 Z');
          h.path('M15.5 9 C13 6.5 9.5 7 8.5 9.5 C11 11 13.5 11 15.5 9 Z');
          h.poly([
            [13.5, 24.5],
            [16.5, 26],
            [13.2, 27],
          ]);
        },
        details: (h) => {
          h.level(0.58);
          h.line(
            [
              [5.5, 18.8],
              [10.5, 20.2],
            ],
            1
          );
          h.line(
            [
              [18.5, 17.2],
              [24.5, 17.4],
            ],
            1
          );
          h.line(
            [
              [10, 9.4],
              [14.5, 9.1],
            ],
            1
          );
        },
      }),
    eye: () =>
      pixelCell({
        halo: 0.3,
        body: 0.9,
        mask: (h) => h.path('M3 16 Q16 4 29 16 Q16 28 3 16 Z'),
        details: (h) => {
          h.level(0.46);
          h.circle(16, 16, 6.2);
          h.level(0.24);
          h.circle(16, 16, 3.2);
          h.level(1);
          h.circle(13.6, 13.6, 1.8);
        },
      }),
    // A jagged spire filling the cell's height (QUAKE pillars erupting, Riposte spikes): lit
    // facet on the left, shaded facet on the right, a glowing vein up the middle.
    spike: () =>
      pixelCell({
        halo: 0.12,
        outline: 0.24,
        mask: (h) =>
          h.poly([
            [16, 1],
            [18.5, 7],
            [18, 9],
            [21.5, 15],
            [21, 17.5],
            [25, 24],
            [27, 31],
            [5, 31],
            [7, 25],
            [10, 19],
            [9.5, 16.5],
            [12.5, 10],
            [12.5, 7.5],
          ]),
        details: (h) => {
          h.level(0.6);
          h.poly([
            [16.5, 3],
            [21, 16],
            [24.5, 24],
            [26, 30.5],
            [17.5, 30.5],
            [18, 20],
          ]);
          h.level(1);
          h.line(
            [
              [15.8, 4],
              [16.4, 10],
              [15.2, 16],
              [16.6, 23],
              [15.6, 30],
            ],
            1.4
          );
        },
      }),
    speedline: () =>
      fieldCell((x, y) => {
        const lines = [
          [-0.34, 0.9, 0.05],
          [0, 0.62, 0.075],
          [0.33, 0.76, 0.045],
        ];
        let best = [1, 0];
        for (const [cy, length, half] of lines) {
          const t = (x - (0.92 - length * 2)) / (length * 2);
          if (t <= 0 || t >= 1) continue;
          const taper = t > 0.92 ? Math.sqrt(1 - ((t - 0.92) / 0.08) ** 2) : 1,
            v = Math.abs(y - cy) / (half * taper + 1e-6);
          if (v >= 1) continue;
          const a = smooth(clamp01(t * 1.4)) * (1 - v * v);
          if (a > best[1]) best = [0.85 + 0.15 * (1 - v), a];
        }
        return best;
      }),
    shield: () =>
      smoothCell((g) => {
        const hex = (r) => {
          g.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = -Math.PI / 2 + (i * TAU) / 6;
            g[i ? 'lineTo' : 'moveTo'](64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
          }
          g.closePath();
        };
        g.save();
        hex(56);
        g.clip();
        g.fillStyle = gray(1, 0.1);
        g.fillRect(0, 0, 128, 128);
        const shine = g.createLinearGradient(20, 10, 90, 110);
        shine.addColorStop(0, gray(1, 0.28));
        shine.addColorStop(0.45, gray(1, 0));
        g.fillStyle = shine;
        g.fillRect(0, 0, 128, 128);
        g.strokeStyle = gray(1, 0.24);
        g.lineWidth = 1.6;
        for (let row = -3; row <= 3; row++)
          for (let col = -3; col <= 3; col++) {
            const cx = 64 + col * 22 + (row % 2 ? 11 : 0),
              cy = 64 + row * 19;
            g.beginPath();
            for (let i = 0; i < 6; i++) {
              const a = -Math.PI / 2 + (i * TAU) / 6;
              g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * 12.5, cy + Math.sin(a) * 12.5);
            }
            g.closePath();
            g.stroke();
          }
        g.restore();
        g.strokeStyle = gray(1, 0.45);
        g.lineWidth = 7;
        hex(52);
        g.stroke();
        g.strokeStyle = gray(1, 1);
        g.lineWidth = 3.2;
        hex(55);
        g.stroke();
      }),
    cross: () =>
      pixelCell({
        halo: 0.3,
        mask: (h) => {
          h.rect(12.5, 5, 7, 22, 1.5);
          h.rect(5, 12.5, 22, 7, 1.5);
        },
      }),

    // --- Effect cells (54–63): archetype identity art ------------------------------------------
    // Ground crack (a flat court decal): thick fissures racing out of a crater, a glowing white-hot
    // seam inside each, a dark lip around it so the break reads on bright and dark courts alike.
    crack: () => {
      const seams = [];
      return pixelCell({
        n: 64,
        halo: 0.35,
        outline: 0.12,
        bevel: false,
        body: 0.72,
        mask: (h) => {
          // Each fissure tapers from the crater outwards and forks once.
          const fissure = (angle, length, width, bend) => {
            let x = 32,
              y = 32,
              a = angle;
            const pts = [[x, y]];
            for (let i = 0; i < 5; i++) {
              a += (random() - 0.5) * bend;
              const nx = x + (Math.cos(a) * length) / 5,
                ny = y + (Math.sin(a) * length) / 5;
              h.line(
                [
                  [x, y],
                  [nx, ny],
                ],
                Math.max(2, width * (1 - i / 6)),
                'round'
              );
              x = nx;
              y = ny;
              pts.push([x, y]);
            }
            return pts;
          };
          for (let i = 0; i < 7; i++) {
            const a = (i / 7) * TAU + (random() - 0.5) * 0.5,
              pts = fissure(a, 23 + random() * 5, i % 2 ? 5.5 : 7, 0.7),
              [bx, by] = pts[2 + (i % 2)],
              branch = a + (i % 2 ? 0.8 : -0.8),
              fork = [
                [bx, by],
                [bx + Math.cos(branch) * 5, by + Math.sin(branch) * 5],
                [bx + Math.cos(branch + 0.3) * 10, by + Math.sin(branch + 0.3) * 10],
              ];
            h.line(fork, 3, 'round');
            seams.push(pts, fork);
          }
          h.circle(32, 32, 8.5);
        },
        details: (h) => {
          // The white-hot seam: a thin line down the middle of every fissure and a hot crater.
          h.level(1);
          for (const pts of seams) h.line(pts.slice(0, 4), 1.6, 'round');
          h.circle(32, 32, 5);
        },
      });
    },
    // A rock chunk torn out of the court (alpha-over, tinted by the type's earth).
    chunk: () =>
      pixelCell({
        body: 0.78,
        shade: 0.5,
        outline: 0.26,
        mask: (h) =>
          h.poly([
            [9, 8],
            [19, 5],
            [27, 11],
            [28, 21],
            [21, 27],
            [10, 26],
            [5, 17],
          ]),
        details: (h) => {
          h.level(1);
          h.poly([
            [10, 9],
            [18, 6.5],
            [20, 10],
            [12, 13],
          ]);
          h.level(0.62);
          h.poly([
            [21, 14],
            [27, 13],
            [27.5, 20.5],
            [21, 26],
            [19, 20],
          ]);
          h.level(0.42);
          h.line(
            [
              [12, 17],
              [16, 20],
              [15, 24],
            ],
            1
          );
        },
      }),
    // A curling wave crest facing +u: water body, a foaming lip and flying spray.
    crest: () =>
      pixelCell({
        n: 64,
        halo: 0.25,
        body: 0.72,
        shade: 0.55,
        outline: 0.3,
        mask: (h) => {
          h.path(
            'M4 60 C12 52 20 42 26 30 C31 19 38 9 48 7 C56 6 61 12 60 19 C59 25 52 27 48 23 C44 20 44 28 47 34 C51 44 56 52 61 60 Z'
          );
          h.circle(56, 31, 1.8);
          h.circle(59, 36, 1.3);
          h.circle(38, 5, 1.4);
          h.circle(31, 10, 1.1);
        },
        details: (h) => {
          h.level(1);
          h.path(
            'M27 29 C32 18 39 10 48 8.5 C55 8 59.5 12.5 59 18.5 C57 23 52.5 24 50 21 C53 18 52 14 48 14 C41 15 36 22 31 31 Z'
          );
          h.circle(56, 31, 1.8);
          h.circle(59, 36, 1.3);
          h.circle(38, 5, 1.4);
          h.circle(31, 10, 1.1);
          h.level(0.86);
          h.line(
            [
              [12, 54],
              [20, 46],
              [26, 38],
            ],
            1.4
          );
          h.line(
            [
              [30, 56],
              [34, 46],
              [38, 38],
            ],
            1.2
          );
          h.level(0.6);
          h.line(
            [
              [46, 30],
              [50, 42],
              [55, 52],
            ],
            1.6
          );
        },
      }),
    // A horizontal run of forged links, alternately face-on and edge-on (HEX chains binding the
    // target): thin enough that the seal and the creature read through the crossing.
    chain: () =>
      pixelCell({
        n: 64,
        halo: 0.2,
        body: 0.8,
        shade: 0.52,
        outline: 0.2,
        mask: (h) => {
          for (let i = 0; i < 5; i++) {
            const x = 12 + i * 10;
            if (i % 2 === 0) {
              h.g.lineWidth = 3.2;
              h.g.beginPath();
              h.g.ellipse(x, 32, 6, 5.5, 0, 0, TAU);
              h.g.stroke();
            } else h.rect(x - 6, 30.3, 12, 3.4, 1.7);
          }
        },
        details: (h) => {
          h.level(1);
          for (let i = 0; i < 5; i += 2) {
            const x = 12 + i * 10;
            h.g.lineWidth = 1.2;
            h.g.beginPath();
            h.g.ellipse(x, 32, 6, 5.5, 0, Math.PI * 1.05, Math.PI * 1.6);
            h.g.stroke();
          }
        },
      }),
    // A curse seal: a thick double circle, a pentagram and five seal studs, white-hot star lines
    // outlined in dark so the glyph stays legible over a bright court (HEX, stamped on the target).
    sigil: () => {
      const star = [0, 2, 4, 1, 3, 0].map((k) => {
        const a = -Math.PI / 2 + (k * TAU) / 5;
        return [32 + Math.cos(a) * 19, 32 + Math.sin(a) * 19];
      });
      return pixelCell({
        n: 64,
        halo: 0.3,
        outline: 0.14,
        bevel: false,
        body: 0.84,
        mask: (h) => {
          h.ring(32, 32, 25.5, 4);
          h.ring(32, 32, 19.5, 2.4);
          h.line(star, 3.2);
          for (let k = 0; k < 5; k++) {
            const a = -Math.PI / 2 + ((k + 0.5) * TAU) / 5;
            h.circle(32 + Math.cos(a) * 25.5, 32 + Math.sin(a) * 25.5, 2.8);
          }
          h.circle(32, 32, 3.5);
        },
        details: (h) => {
          h.level(1);
          h.line(star, 1.4);
          h.circle(32, 32, 2);
          h.level(0.66);
          h.ring(32, 32, 19.5, 1.2);
        },
      });
    },
    // Impact / muzzle flare: a hot core, four long rays, four short diagonals and a soft bloom.
    flare: () =>
      fieldCell((x, y) => {
        const d = Math.hypot(x, y),
          a = Math.atan2(y, x);
        if (d >= 0.95) return [1, 0];
        const fade = clamp01((0.95 - d) / 0.25),
          core = Math.exp(-(d * d) / 0.02),
          bloom = 0.6 * Math.exp(-(d * d) / 0.12),
          long = Math.abs(Math.cos(2 * a)) ** 40 * Math.exp(-d / 0.55),
          short = 0.7 * Math.abs(Math.sin(2 * a)) ** 40 * Math.exp(-d / 0.3);
        return [0.85 + 0.15 * core, clamp01(core + bloom + long + short) * fade];
      }),
    // Beam body, tiling along u over texels 4.5–123.5 (one period): a white-hot core inside a
    // bright tube outlined by dark rims, a soft outer halo and two braided filaments. The layer
    // scrolls it from the caster to the target.
    beam: () =>
      fieldCell((x, y) => {
        const px = ((x + 1) / 2) * CELL - 0.5,
          t = (px - 4.5) / 119;
        if (t < 0 || t > 1) return [1, 0];
        const w = TAU * t,
          core = Math.exp(-((y / 0.14) ** 2)),
          tube = (0.86 + 0.08 * Math.sin(w * 2)) * Math.exp(-((y / 0.4) ** 6)),
          rim = Math.exp(-(((Math.abs(y) - 0.43) / 0.05) ** 2)),
          halo = 0.35 * Math.exp(-((y / 0.62) ** 2)),
          braidA = 0.9 * Math.exp(-(((y - 0.3 * Math.sin(w)) / 0.045) ** 2)),
          braidB = 0.7 * Math.exp(-(((y + 0.24 * Math.sin(w * 2 + 0.8)) / 0.04) ** 2)),
          edge = clamp01((0.94 - Math.abs(y)) / 0.2);
        // Luminance: white-hot core and braids, a bright tube, a dark rim that outlines the ray
        // against a court of the same hue, then the soft halo.
        const lum = rim > 0.5 && Math.abs(y) > 0.38 ? 0.4 : 0.9 + 0.1 * clamp01(core + braidA);
        return [lum, clamp01(Math.max(core, tube, rim * 0.95, halo, braidA, braidB)) * edge];
      }),
    // A blade swoosh cutting diagonally through the cell centre (top left → bottom right, bowing
    // toward the top right), thickest mid-swing with both tips pointed: a white-hot leading edge, a
    // solid body, a dark rim that outlines it on bright courts and a short fading motion smear on
    // the trailing side.
    slash: () =>
      fieldCell((x, y) => {
        const cx = -0.86,
          cy = -0.86,
          X = x - cx,
          Y = -y - cy,
          r = Math.hypot(X, Y),
          theta = Math.atan2(Y, X),
          from = Math.PI * 0.53,
          to = -Math.PI * 0.03,
          s = (from - theta) / (from - to);
        if (s <= 0 || s >= 1 || Math.max(Math.abs(x), Math.abs(y)) > 0.97) return [1, 0];
        const outer = 1.36,
          taper = Math.sin(Math.PI * s) ** 1.1,
          width = 0.3 * taper,
          v = (outer - r) / Math.max(1e-3, width),
          rimOut = r > outer && r < outer + 0.045 * taper ? 0.95 : 0,
          smear = v > 1 && v < 2.3 ? 0.4 * ((2.3 - v) / 1.3) ** 1.5 * taper : 0;
        if (v >= 0 && v <= 1) return [v < 0.38 ? 1 : 0.86 - 0.16 * v, 1];
        if (rimOut) return [0.14, rimOut];
        return [0.72, smear];
      }),
    // Three spiral arms around a bright eye (VORTEX; spun by the layer).
    swirl: () =>
      fieldCell((x, y) => {
        const r = Math.hypot(x, y),
          theta = Math.atan2(y, x);
        if (r >= 0.94) return [1, 0];
        const arms = (0.5 + 0.5 * Math.cos(3 * (theta + 5.2 * r))) ** 5,
          envelope = smooth(clamp01((0.92 - r) / 0.34)) * smooth(clamp01((r - 0.04) / 0.14)),
          eye = 0.7 * Math.exp(-(r * r) / 0.012);
        return [0.78 + 0.22 * arms, clamp01(arms * envelope * (1.1 - r * 0.5) + eye)];
      }),
    // Shockwave: a bright leading rim with the air behind it glowing and fading inward.
    shock: () =>
      fieldCell((x, y) => {
        const d = Math.hypot(x, y),
          rim = Math.exp(-(((d - 0.82) / 0.04) ** 2)),
          v = (0.82 - d) / 0.4,
          wake = v > 0 && v < 1 ? 0.55 * (1 - v) ** 2 : 0,
          fade = d > 0.9 ? clamp01((0.96 - d) / 0.06) : 1;
        return [0.82 + 0.18 * rim, clamp01(rim + wake) * fade];
      }),
  };

  // --- Creature motifs: each Signature's identity glyph ----------------------------------------------
  const MOTIFS = {
    orakyn: {
      halo: 0.3,
      mask: (h) => {
        h.path('M3 19 Q16 8 29 19 Q16 30 3 19 Z');
        h.poly([
          [16, 2.5],
          [20.5, 7.5],
          [16, 12.5],
          [11.5, 7.5],
        ]);
      },
      details: (h) => {
        h.level(0.42);
        h.circle(16, 19, 5);
        h.level(1);
        h.circle(14.2, 17.2, 1.5);
        h.line(
          [
            [16, 4],
            [16, 11],
          ],
          1
        );
      },
    },
    lumivox: {
      halo: 0.3,
      mask: (h) => {
        h.ellipse(10.5, 23, 5.2, 4, -0.45);
        h.line(
          [
            [15, 22],
            [15, 5],
          ],
          2.6,
          'butt'
        );
        h.path('M15 4 Q24 7 22.5 16', { fill: false, width: 2.6 });
        h.ring(22, 22, 4.5, 1.6, -1, 0.9);
        h.ring(22, 22, 8, 1.6, -0.9, 0.8);
      },
    },
    mnemora: {
      halo: 0.3,
      mask: (h) => {
        h.spiral(16, 16, 2.3, 1, 12.5, 2.6, 0.4);
        h.circle(16, 16, 2.4);
      },
    },
    prismage: {
      halo: 0.35,
      mask: (h) => {
        h.poly([
          [14, 4],
          [25, 26],
          [3, 26],
        ]);
        h.line(
          [
            [21, 16],
            [29, 11],
          ],
          1.6
        );
        h.line(
          [
            [22, 19],
            [29.5, 18.5],
          ],
          1.6
        );
        h.line(
          [
            [23, 22],
            [29, 25.5],
          ],
          1.6
        );
      },
      details: (h) => {
        h.level(1);
        h.line(
          [
            [14, 6],
            [9, 24],
          ],
          1.2
        );
        h.level(0.6);
        h.poly([
          [15, 8],
          [23.5, 25],
          [15.5, 25],
        ]);
      },
    },
    kordane: {
      halo: 0.25,
      mask: (h) => {
        h.poly([
          [16, 2.5],
          [20.5, 9],
          [19.5, 28],
          [12.5, 28],
          [11.5, 9],
        ]);
        h.poly([
          [7, 11],
          [11, 15],
          [11.5, 28],
          [5.5, 28],
          [3.5, 15],
        ]);
        h.poly([
          [25, 9],
          [28.5, 14],
          [26.5, 28],
          [20.5, 28],
          [21, 13],
        ]);
      },
      details: (h) => {
        h.level(1);
        h.line(
          [
            [16, 4],
            [16, 27],
          ],
          1.1
        );
        h.line(
          [
            [7, 12.5],
            [8.5, 27],
          ],
          1
        );
        h.line(
          [
            [25, 10.5],
            [24, 27],
          ],
          1
        );
      },
    },
    brontusk: {
      mask: (h) => {
        h.path('M5 21 Q2 8 10 3 Q7.5 12 11 20 Z');
        h.path('M27 21 Q30 8 22 3 Q24.5 12 21 20 Z');
        h.ellipse(16, 22, 8, 6);
      },
      details: (h) => {
        h.level(0.42);
        h.circle(12.5, 21, 1.5);
        h.circle(19.5, 21, 1.5);
        h.level(0.62);
        h.ellipse(16, 25.5, 3.5, 1.5);
      },
    },
    ferrax: {
      halo: 0.2,
      mask: (h) => {
        h.path('M4 28 Q9 12 28 4 Q14 12 7 29 Z');
        h.path('M28 28 Q23 12 4 4 Q18 12 25 29 Z');
      },
    },
    monolith: {
      mask: (h) => {
        h.path('M10 27 L10 9 Q10 4 16 4 Q22 4 22 9 L22 27 Z');
        h.rect(6, 25, 20, 4, 1);
      },
      details: (h) => {
        h.level(1);
        h.line(
          [
            [16, 8.5],
            [16, 21],
          ],
          1.8
        );
        h.line(
          [
            [13, 12],
            [19, 12],
          ],
          1.4
        );
        h.line(
          [
            [13.5, 17],
            [18.5, 17],
          ],
          1.4
        );
      },
    },
    abyssar: {
      halo: 0.2,
      mask: (h) => {
        h.line(
          [
            [16, 11],
            [16, 29],
          ],
          2.8,
          'butt'
        );
        h.poly([
          [16, 2.5],
          [19, 9],
          [16, 12],
          [13, 9],
        ]);
        h.path('M7 5 L9.5 10 Q10 14 16 14.5 Q22 14 22.5 10 L25 5', { fill: false, width: 2.4 });
        h.poly([
          [7, 2.5],
          [9, 7],
          [5, 7],
        ]);
        h.poly([
          [25, 2.5],
          [27, 7],
          [23, 7],
        ]);
      },
    },
    riptalon: {
      halo: 0.2,
      mask: (h) => {
        h.path(
          'M29 28 L3 28 C3 17 8 6 18 4 C25 2.8 29.5 7.5 28 12.5 C27 16 22.5 17 21 14.5 C20 12.5 21.5 10.5 23.5 11.2 C23 8.6 19.5 8.3 16.5 10.5 C12 14 12 22 20 28 Z'
        );
      },
      details: (h) => {
        h.level(1);
        h.path('M5 26 C5 16 10 7 18 5.6', { fill: false, width: 1.3 });
        h.circle(27, 21, 1.4);
        h.circle(24.5, 24.5, 1.1);
        h.level(0.55);
        h.path('M13 27 C10.5 21 12 15 15 12', { fill: false, width: 1.1 });
      },
    },
    nymbloom: {
      halo: 0.25,
      mask: (h) => {
        h.ellipse(16, 13, 4.2, 9.5);
        h.ellipse(9.5, 17.5, 3.6, 8, -0.75);
        h.ellipse(22.5, 17.5, 3.6, 8, 0.75);
        h.ellipse(6, 22, 3, 6.5, -1.3);
        h.ellipse(26, 22, 3, 6.5, 1.3);
        h.ellipse(16, 25, 10, 3);
      },
      details: (h) => {
        h.level(0.6);
        h.line(
          [
            [16, 7],
            [16, 22],
          ],
          1
        );
      },
    },
    voltide: {
      halo: 0.4,
      mask: (h) => {
        h.circle(10, 11, 5);
        h.circle(16.5, 8.5, 6);
        h.circle(22.5, 11.5, 5);
        h.rect(6, 11, 21, 5, 2.5);
        h.poly([
          [18.5, 15],
          [12, 22.5],
          [16, 22.5],
          [12.5, 29],
          [22, 19.5],
          [18, 19.5],
          [21.5, 15],
        ]);
      },
    },
    calderoc: {
      halo: 0.3,
      mask: (h) => {
        h.poly([
          [3, 28],
          [11, 13],
          [21, 13],
          [29, 28],
        ]);
        h.circle(16, 8, 4.2);
        h.circle(12, 10, 2.6);
        h.circle(20.5, 9.5, 2.8);
      },
      details: (h) => {
        h.level(1);
        h.circle(16, 8, 3.2);
        h.path('M14 13 L13 19 L15 18 L14 24', { fill: false, width: 1.2 });
        h.path('M18.5 13 L20 18', { fill: false, width: 1.1 });
      },
    },
    pyrolynx: {
      halo: 0.35,
      mask: (h) => {
        h.path('M9 25 Q9 17 16 16.5 Q23 17 23 25 Q23 28.5 16 27 Q9 28.5 9 25 Z');
        h.ellipse(7.5, 14, 2.6, 3.4, -0.4);
        h.ellipse(12.5, 9, 2.6, 3.6, -0.15);
        h.ellipse(19.5, 9, 2.6, 3.6, 0.15);
        h.ellipse(24.5, 14, 2.6, 3.4, 0.4);
        h.poly([
          [12.5, 3.5],
          [14, 6.5],
          [11, 6.5],
        ]);
        h.poly([
          [19.5, 3.5],
          [21, 6.5],
          [18, 6.5],
        ]);
      },
    },
    magmoth: {
      halo: 0.25,
      mask: (h) => {
        h.path('M15 13 C12 7 6 3 3 5 C2 10 4 15 9 17 C11.5 17.5 14 16 15 13 Z');
        h.path('M17 13 C20 7 26 3 29 5 C30 10 28 15 23 17 C20.5 17.5 18 16 17 13 Z');
        h.path('M15 17 C12 17 7 19 6.5 23 C7 26.5 12 26 15 20 Z');
        h.path('M17 17 C20 17 25 19 25.5 23 C25 26.5 20 26 17 20 Z');
        h.ellipse(16, 17, 2.2, 8);
        h.line(
          [
            [15, 9.5],
            [11.5, 3.5],
          ],
          1.2
        );
        h.line(
          [
            [17, 9.5],
            [20.5, 3.5],
          ],
          1.2
        );
      },
      details: (h) => {
        h.level(0.4);
        h.circle(8, 10, 2.8);
        h.circle(24, 10, 2.8);
        h.level(1);
        h.circle(8, 10, 1.3);
        h.circle(24, 10, 1.3);
        h.circle(11.5, 3.5, 1);
        h.circle(20.5, 3.5, 1);
      },
    },
    solflare: {
      halo: 0.45,
      mask: (h) => {
        h.circle(16, 16, 7.5);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU - Math.PI / 2,
            b = Math.PI / 12;
          h.poly([
            [16 + Math.cos(a) * 14, 16 + Math.sin(a) * 14],
            [16 + Math.cos(a + b) * 9, 16 + Math.sin(a + b) * 9],
            [16 + Math.cos(a - b) * 9, 16 + Math.sin(a - b) * 9],
          ]);
        }
      },
      details: (h) => {
        h.level(1);
        h.circle(16, 16, 4.6);
      },
    },
    virelia: {
      mask: (h) => {
        h.path('M16 28 Q15 17 9 7 Q6 12 8 17 Q10 22 16 28 Z');
        h.path('M16 28 Q17 17 23 7 Q26 12 24 17 Q22 22 16 28 Z');
        h.path('M16 27 Q13 14 16 3 Q19 14 16 27 Z');
      },
      details: (h) => {
        h.level(0.58);
        h.line(
          [
            [15.5, 25],
            [10, 11],
          ],
          1
        );
        h.line(
          [
            [16.5, 25],
            [22, 11],
          ],
          1
        );
      },
    },
    mossaur: {
      mask: (h) => {
        h.path('M4 28 Q16 18 28 28 Z');
        h.rect(14.6, 13, 3, 11);
        h.circle(11.5, 12, 5);
        h.circle(16.5, 8.5, 6);
        h.circle(21, 12.5, 5);
      },
      details: (h) => {
        h.level(1);
        h.circle(14, 7, 1.3);
        h.circle(19.5, 10, 1.1);
      },
    },
    florafae: {
      halo: 0.3,
      mask: (h) => {
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * TAU - Math.PI / 2;
          h.circle(16 + Math.cos(a) * 7.2, 17 + Math.sin(a) * 7.2, 5.2);
        }
        h.star(26, 5.5, 4, 3.6, 1);
      },
      details: (h) => {
        h.level(1);
        h.circle(16, 17, 3.4);
        h.star(26, 5.5, 4, 3.6, 1);
      },
    },
    thornox: {
      mask: (h) => {
        h.path('M16 3 Q19.5 16 20.5 28 L11.5 28 Q12.5 16 16 3 Z');
        h.path('M5 12 Q9 20 12 28 L5.5 28 Q4 20 5 12 Z');
        h.path('M27 12 Q23 20 20 28 L26.5 28 Q28 20 27 12 Z');
      },
      details: (h) => {
        h.level(1);
        h.line(
          [
            [16, 5],
            [15, 26],
          ],
          1.1
        );
      },
    },
    farfombre: {
      halo: 0.35,
      mask: (h) => {
        h.ring(16, 6, 3, 1.5, Math.PI, TAU);
        h.rect(11.5, 7, 9, 3, 1);
        h.rect(9.5, 10, 13, 15, 3.5);
        h.rect(12, 25, 8, 3.5, 1);
      },
      details: (h) => {
        h.level(0.36);
        h.rect(11.8, 12.3, 8.4, 10.4, 2);
        h.level(1);
        h.path('M16 13.5 C18 16.5 19 18 18.6 20 A2.6 2.6 0 0 1 13.4 20 C13 18 15 16.5 16 13.5 Z');
      },
    },
    nocturnyx: {
      mask: (h) => {
        const wing = (s) =>
          h.poly(
            [
              [14, 12.5],
              [8, 7.5],
              [2.5, 10],
              [3, 16.5],
              [5.5, 14.8],
              [7, 19],
              [9.5, 16.5],
              [11.5, 21],
              [13.5, 17.5],
              [15, 19.5],
            ].map(([x, y]) => [16 + (x - 16) * s, 15 + (y - 14) * 1.55])
          );
        wing(1);
        wing(-1);
        h.ellipse(16, 16, 3.4, 6.5);
        h.poly([
          [13, 12],
          [13.4, 6.5],
          [15.6, 10.5],
        ]);
        h.poly([
          [19, 12],
          [18.6, 6.5],
          [16.4, 10.5],
        ]);
      },
      details: (h) => {
        h.level(1);
        h.circle(14.8, 13.2, 0.8);
        h.circle(17.2, 13.2, 0.8);
      },
    },
    umbrawl: {
      halo: 0.2,
      mask: (h) => {
        h.poly([
          [22, 3],
          [24.5, 4],
          [9, 28],
          [7.5, 27],
        ]);
        h.poly([
          [27, 6],
          [29, 7.5],
          [14.5, 29],
          [13, 28],
        ]);
        h.poly([
          [16, 3],
          [18, 3.5],
          [4.5, 24],
          [3.5, 22.5],
        ]);
      },
    },
    hexalune: {
      halo: 0.3,
      mask: (h) => {
        h.circle(15, 16, 13);
        h.cut(() => h.circle(20.5, 13, 11));
        h.star(20.5, 14, 6, 5.6, 3);
      },
      details: (h) => {
        h.level(1);
        h.star(20.5, 14, 6, 5.6, 3);
        h.level(0.36);
        h.circle(20.5, 14, 1.6);
      },
    },
    deuilastre: {
      mask: (h) => {
        h.path('M5 27 Q7 13 22 7 Q23 18 8 26 Z');
        h.line(
          [
            [3.5, 29],
            [8.5, 24],
          ],
          1.6
        );
        h.star(25, 6, 4, 4.4, 1.2);
      },
      details: (h) => {
        h.level(1);
        h.line(
          [
            [6.5, 25.5],
            [21, 8.5],
          ],
          1.1
        );
        h.star(25, 6, 4, 4.4, 1.2);
        h.level(0.5);
        h.line(
          [
            [11.5, 16],
            [15, 17.5],
          ],
          1
        );
      },
    },
    aubeastre: {
      halo: 0.45,
      mask: (h) => {
        h.star(16, 16, 8, 13, 5, -Math.PI / 2);
        h.ring(16, 16, 10.5, 1.4);
      },
      details: (h) => {
        h.level(1);
        h.star(16, 16, 4, 13, 3.4);
        h.circle(16, 16, 3);
      },
    },
    flambelier: {
      halo: 0.2,
      mask: (h) => {
        const pts = [];
        for (let i = 0; i <= 90; i++) {
          const t = i / 90,
            a = 0.6 + t * 1.75 * TAU,
            r = 12.5 - 10 * t;
          pts.push([15.5 + Math.cos(a) * r, 16.5 + Math.sin(a) * r, 3.8 - 2.4 * t]);
        }
        for (let i = 1; i < pts.length; i++) h.line([pts[i - 1], pts[i]], pts[i][2]);
      },
    },
    mareclat: {
      halo: 0.15,
      mask: (h) => {
        h.path('M5 23 C3.5 12 13 3.5 27.5 6.5 C21 9 16 13 14 20.5 Z');
        h.path('M9.5 25 C14 21 20.5 19 27.5 21.5 C21.5 24.5 15.5 27.5 9 27.5 Z');
        h.rect(3, 21.5, 8, 7, 2.5);
      },
      details: (h) => {
        h.level(1);
        h.circle(10.5, 11, 1.2);
        h.level(0.56);
        h.poly([
          [18, 11.5],
          [16.5, 14],
          [19.5, 13],
        ]);
        h.poly([
          [19.5, 22],
          [18, 24],
          [21, 23.2],
        ]);
      },
    },
    xylocorne: {
      mask: (h) => {
        h.circle(16, 16, 13);
      },
      details: (h) => {
        h.level(0.52);
        h.ring(16, 16, 9.5, 1.3);
        h.ring(16, 16, 5.8, 1.3);
        h.ring(16, 16, 2.2, 1.3);
        h.level(1);
        h.circle(16, 16, 1);
      },
    },
    pactigon: {
      halo: 0.2,
      mask: (h) => {
        const pts = [];
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU;
          pts.push([16 + Math.cos(a) * 13.5, 16 + Math.sin(a) * 13.5]);
        }
        h.poly(pts);
      },
      details: (h) => {
        h.level(0.55);
        const inner = [];
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU;
          inner.push([16 + Math.cos(a) * 8, 16 + Math.sin(a) * 8]);
        }
        h.line([...inner, inner[0]], 1.3);
        h.level(1);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + Math.PI / 6;
          h.circle(16 + Math.cos(a) * 11, 16 + Math.sin(a) * 11, 1.1);
        }
        h.circle(16, 16, 2.4);
      },
    },
  };

  for (const [name, index] of Object.entries(cells)) {
    const cell = name.startsWith('motif-') ? pixelCell(MOTIFS[name.slice(6)]) : PAINTERS[name](),
      x0 = (index % grid) * CELL,
      y0 = Math.floor(index / grid) * CELL;
    for (let y = 0; y < CELL; y++)
      for (let x = 0; x < CELL; x++) {
        const edge = x < 4 || y < 4 || x >= CELL - 4 || y >= CELL - 4,
          i = (y * CELL + x) * 2,
          o = ((y0 + y) * size + x0 + x) * 4,
          alpha = edge ? 0 : cell[i + 1],
          luminance = edge ? 0 : Math.min(cell[i], alpha);
        atlas[o] = atlas[o + 1] = atlas[o + 2] = luminance;
        atlas[o + 3] = alpha;
      }
  }
  const bytes = new Uint8Array(size * size * 4);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(atlas[i] * 255);
  // Rounding must keep rgb ≤ alpha (a valid premultiplied texel).
  for (let i = 0; i < bytes.length; i += 4) {
    const a = bytes[i + 3];
    for (let c = 0; c < 3; c++) if (bytes[i + c] > a) bytes[i + c] = a;
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

// 8-bit RGBA PNG, "up" filter per row. The bytes are stored exactly as painted (premultiplied).
function encodePng(rgba, width, height) {
  const stride = width * 4,
    raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 2;
    for (let x = 0; x < stride; x++) {
      const above = y ? rgba[(y - 1) * stride + x] : 0;
      raw[y * (stride + 1) + 1 + x] = (rgba[y * stride + x] - above) & 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Preview: every cell tinted with the type palette over the stage navy, additive and alpha.
function renderPreview({ pixels, size, grid, cells, colors }) {
  const CELL = size / grid,
    bytes = Uint8Array.from(atob(pixels), (c) => c.charCodeAt(0)),
    names = Object.fromEntries(Object.entries(cells).map(([name, index]) => [index, name])),
    tile = 150,
    width = grid * tile * 2 + 48,
    height = grid * (tile + 22) + 70,
    view = Object.assign(document.createElement('canvas'), { width, height }),
    g = view.getContext('2d');
  document.body.style.margin = 0;
  document.body.append(view);
  g.fillStyle = '#0b0d24';
  g.fillRect(0, 0, width, height);
  g.fillStyle = '#f8f6ff';
  g.font = '800 22px system-ui';
  g.fillText('FX atlas — additive, tinted by the type palette (left) · alpha over the court (right)', 16, 36);
  const cell = g.createImageData(CELL, CELL),
    scratch = Object.assign(document.createElement('canvas'), { width: CELL, height: CELL }),
    s = scratch.getContext('2d');
  for (let index = 0; index < grid * grid; index++) {
    const name = names[index];
    const col = index % grid,
      row = Math.floor(index / grid),
      color = colors[index % colors.length].match(/\w\w/g).map((h) => parseInt(h, 16) / 255);
    for (const [panel, additive] of [
      [0, true],
      [1, false],
    ]) {
      const x = 16 + panel * (grid * tile + 16) + col * tile,
        y = 56 + row * (tile + 22);
      g.fillStyle = additive ? '#141838' : '#3a3552';
      g.fillRect(x, y, tile - 6, tile - 6);
      if (!name) continue;
      for (let py = 0; py < CELL; py++)
        for (let px = 0; px < CELL; px++) {
          const src = ((row * CELL + py) * size + col * CELL + px) * 4,
            dst = (py * CELL + px) * 4,
            a = bytes[src + 3] / 255,
            l = bytes[src] / 255;
          // Straight alpha for canvas compositing: additive glow ≈ luminance as coverage.
          const lum = a ? l / a : 0;
          cell.data[dst] = color[0] * 255 * (additive ? 1 : lum) + (additive ? 0 : 0);
          cell.data[dst + 1] = color[1] * 255 * (additive ? 1 : lum);
          cell.data[dst + 2] = color[2] * 255 * (additive ? 1 : lum);
          cell.data[dst + 3] = (additive ? l : a) * 255;
        }
      s.putImageData(cell, 0, 0);
      g.globalCompositeOperation = additive ? 'lighter' : 'source-over';
      g.drawImage(scratch, x + (tile - 6 - CELL) / 2, y + (tile - 6 - CELL) / 2);
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = '#c8c9e6';
      g.font = '700 13px system-ui';
      g.fillText(name, x, y + tile + 8);
    }
  }
  return { width, height };
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><body></body>');
const pixels = await page.evaluate(paintAtlas, { cells: ATLAS.cells, size: ATLAS.size, grid: ATLAS.grid });
const rgba = Buffer.from(pixels, 'base64');
await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, encodePng(rgba, ATLAS.size, ATLAS.size));
console.log(`wrote ${path.relative(ROOT, OUTPUT)}`);
if (previewPath) {
  const colors = AFFINITY_ORDER.map((id) => AFFINITIES[id].color.slice(1));
  const { width, height } = await page.evaluate(renderPreview, {
    pixels,
    size: ATLAS.size,
    grid: ATLAS.grid,
    cells: ATLAS.cells,
    colors,
  });
  await page.setViewportSize({ width, height });
  await page.locator('canvas').screenshot({ path: previewPath });
  console.log(`wrote ${previewPath}`);
}
await browser.close();
