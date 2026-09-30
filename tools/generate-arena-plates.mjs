#!/usr/bin/env node
// Bakes the painted "Stade Lumière" arena art (Phase 5A, STAGE-08): per arena a backdrop plate
// (assets/arenas/<id>/plate.webp, the camera-centred panorama band) and a court texture
// (assets/arenas/<id>/court.webp, the disc inscribed in the square), plus the provenance
// manifest assets/arenas/manifest.json. Dev-only; the app never imports this file.
//
// Method: an offline painter run in Playwright's Chromium (Canvas 2D). Unlike the runtime
// fallback painter (src/presentation/stage/painter.js), it can spend seconds per arena: gradient
// noise skies and rock, layered silhouettes with haze and rim light, a crowd painted as a soft
// colour mass, per-arena stand architecture, baked bloom and 2× supersampling. It paints on the
// fallback's exact angular layout (azimuth ±PLATE_AZ, elevation PLATE_EL_MIN…PLATE_EL_MAX, floor
// line FLOOR_EL, crowd band CROWD_BAND) and court mapping, so the shader's live crowd,
// flash-bulbs, floor seam and reflections line up with either source.
//
// Art rules (docs/battle-presentation.md §7.6, art/arena-briefs/<id>.json): soft world under
// crisp pixel creatures; the stands and the landmark's base (the band behind the fighters) stay
// calm and a step or two darker than the creatures; the brightest accents live in the upper sky,
// the landmark's hero element sits in the upper centre, slightly right, where portrait phones
// still see it beside the rival's plate. Original content only: no text, logos or real venues.
//
// Deterministic per brief seed (art/arena-briefs/<id>.json → `seed`).
//
//   node tools/generate-arena-plates.mjs [--arenas crystal,grove]
//
// Needs Playwright's Chromium (a dev dependency). WebP encoding is Chromium's (lossy, opaque).
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES, THEME_IDS } from '../src/presentation/stage/themes.js';
import {
  COURT_SIZE,
  CROWD_BAND,
  FLOOR_EL,
  PLATE_AZ,
  PLATE_EL_MAX,
  PLATE_EL_MIN,
  PLATE_H,
  PLATE_W,
} from '../src/presentation/stage/painter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'arenas');
const BRIEFS = path.join(ROOT, 'art', 'arena-briefs');
const WEBP_QUALITY = 0.84;
const LAYOUT = {
  plate: {
    width: PLATE_W,
    height: PLATE_H,
    az: PLATE_AZ,
    elMin: PLATE_EL_MIN,
    elMax: PLATE_EL_MAX,
    floorEl: FLOOR_EL,
    crowd: CROWD_BAND,
  },
  court: { size: COURT_SIZE },
};

const argIndex = process.argv.indexOf('--arenas');
const ids = argIndex > 0 ? process.argv[argIndex + 1].split(',') : [...THEME_IDS];
for (const id of ids) if (!THEME_IDS.includes(id)) throw new Error(`Unknown arena: ${id}`);

// ---------------------------------------------------------------------------------------------
// Runs in the page: paints one arena at 2× and returns both images as WebP data URLs.
// ---------------------------------------------------------------------------------------------
function paintArena({ id, theme: t, layout, seed, quality }) {
  const SS = 2;
  const L = layout.plate;
  const W = L.width * SS,
    H = L.height * SS;
  const SX = W / (2 * L.az),
    SY = H / (L.elMax - L.elMin);
  const X = (az) => (az + L.az) * SX;
  const Y = (el) => (L.elMax - el) * SY;
  const FLOOR = L.floorEl,
    [LED_TOP, ROOF] = L.crowd,
    TOP = L.elMax;
  const TAU = Math.PI * 2;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const smooth = (e0, e1, x) => {
    const k = clamp01((x - e0) / (e1 - e0));
    return k * k * (3 - 2 * k);
  };

  // --- seeded randomness and gradient noise ---------------------------------------------------
  const hash = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
  const stream = (key) => {
    let a = hash(`${seed}|${key}`);
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let v = Math.imul(a ^ (a >>> 15), 1 | a);
      v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v;
      return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
    };
  };
  const perm = new Uint8Array(512);
  {
    const rnd = stream('noise'),
      p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  }
  const GX = [1, -1, 1, -1, 1, -1, 0, 0],
    GY = [1, 1, -1, -1, 0, 0, 1, -1];
  const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
  // 2D gradient noise, about −1…1.
  function noise(x, y) {
    const xi = Math.floor(x),
      yi = Math.floor(y),
      xf = x - xi,
      yf = y - yi,
      a = xi & 255,
      b = yi & 255;
    const h00 = perm[perm[a] + b] & 7,
      h10 = perm[perm[a + 1] + b] & 7,
      h01 = perm[perm[a] + b + 1] & 7,
      h11 = perm[perm[a + 1] + b + 1] & 7;
    const n00 = GX[h00] * xf + GY[h00] * yf,
      n10 = GX[h10] * (xf - 1) + GY[h10] * yf,
      n01 = GX[h01] * xf + GY[h01] * (yf - 1),
      n11 = GX[h11] * (xf - 1) + GY[h11] * (yf - 1);
    const u = fade(xf),
      v = fade(yf);
    return (n00 + u * (n10 - n00) + v * (n01 + u * (n11 - n01) - n00 - u * (n10 - n00))) * 1.4;
  }
  function fbm(x, y, octaves = 5, gain = 0.5) {
    let sum = 0,
      amp = 0.5,
      f = 1;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise(x * f + i * 17.31, y * f - i * 9.17);
      f *= 2.03;
      amp *= gain;
    }
    return sum;
  }
  // Ridged fbm (sharp creases, for rock and bark), 0…1.
  function ridged(x, y, octaves = 5) {
    let sum = 0,
      amp = 0.55,
      f = 1;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(noise(x * f + i * 7.7, y * f + i * 3.3));
      sum += amp * n * n;
      f *= 2.1;
      amp *= 0.5;
    }
    return sum;
  }

  // --- colour and canvas helpers ----------------------------------------------------------------
  const rgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const css = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
  const rgba = (hex, a = 1) => css(rgb(hex), a);
  const mixc = (A, B, k) => [A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k];
  const mix = (a, b, k, alpha = 1) => css(mixc(rgb(a), rgb(b), k), alpha);
  const shade = (hex, k, a = 1) =>
    css(
      rgb(hex).map((v) => Math.min(255, v * k)),
      a
    );
  const canvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return [c, c.getContext('2d')];
  };
  // Rasterises fn(x, y, px) into a w × h canvas; px = [r, g, b, a] in 0–255 (a starts at 255).
  function raster(w, h, fn) {
    const [c, g] = canvas(w, h),
      img = g.createImageData(w, h),
      d = img.data,
      px = [0, 0, 0, 255];
    let i = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++, i += 4) {
        px[0] = px[1] = px[2] = 0;
        px[3] = 255;
        fn(x, y, px);
        d[i] = px[0];
        d[i + 1] = px[1];
        d[i + 2] = px[2];
        d[i + 3] = px[3];
      }
    g.putImageData(img, 0, 0);
    return c;
  }
  // A plate-space layer rasterised at 1/scale and drawn over [az0, az1] × [el0, el1]:
  // fn(az, el, px).
  function plateLayer(
    g,
    scale,
    fn,
    { op = 'source-over', alpha = 1, region = [-L.az, L.az, L.elMin, TOP] } = {}
  ) {
    const [az0, az1, el0, el1] = region,
      x0 = X(az0),
      x1 = X(az1),
      y0 = Y(el1),
      y1 = Y(el0),
      w = Math.max(1, Math.ceil((x1 - x0) / scale)),
      h = Math.max(1, Math.ceil((y1 - y0) / scale));
    const layer = raster(w, h, (x, y, px) =>
      fn(az0 + ((x + 0.5) / w) * (az1 - az0), el1 - ((y + 0.5) / h) * (el1 - el0), px)
    );
    g.save();
    g.globalCompositeOperation = op;
    g.globalAlpha = alpha;
    g.imageSmoothingQuality = 'high';
    g.drawImage(layer, x0, y0, x1 - x0, y1 - y0);
    g.restore();
  }
  function glow(g, x, y, rx, ry, color, alpha = 1) {
    if (rx <= 0 || ry <= 0) return;
    g.save();
    g.translate(x, y);
    g.scale(1, ry / rx);
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    grd.addColorStop(0, rgba(color, alpha));
    grd.addColorStop(0.3, rgba(color, alpha * 0.5));
    grd.addColorStop(0.65, rgba(color, alpha * 0.14));
    grd.addColorStop(1, rgba(color, 0));
    g.fillStyle = grd;
    g.fillRect(-rx, -rx, rx * 2, rx * 2);
    g.restore();
  }
  const glowDeg = (g, az, el, r, color, alpha = 1) => glow(g, X(az), Y(el), r * SX, r * SY, color, alpha);
  function additive(g, fn) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    fn();
    g.restore();
  }
  function poly(g, points) {
    g.beginPath();
    points.forEach(([az, el], i) => (i ? g.lineTo(X(az), Y(el)) : g.moveTo(X(az), Y(el))));
    g.closePath();
  }
  function vGrad(g, elTop, elBottom, stops) {
    const grd = g.createLinearGradient(0, Y(elTop), 0, Y(elBottom));
    for (const [k, c] of stops) grd.addColorStop(k, c);
    return grd;
  }
  // Sky: colour stops [el, hex] from the top down, filled to the floor line.
  function sky(g, stops) {
    const grd = g.createLinearGradient(0, 0, 0, Y(FLOOR));
    for (const [el, hex] of stops) grd.addColorStop(clamp01(Y(el) / Y(FLOOR)), hex);
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
  }
  // Painterly mottling: a low-frequency overlay that breaks flat gradients like brushwork.
  function mottle(g, amount, region) {
    plateLayer(
      g,
      8,
      (az, el, px) => {
        const v = 128 + 255 * amount * fbm(az * 0.09, el * 0.16, 4);
        px[0] = px[1] = px[2] = v;
      },
      { op: 'overlay', region }
    );
  }
  function stars(g, rnd, count, elFrom, { tint = '#ffffff', bright = 0.08 } = {}) {
    for (let i = 0; i < count; i++) {
      const az = (rnd() * 2 - 1) * L.az,
        el = elFrom + rnd() * (TOP - elFrom),
        fadeIn = clamp01((el - elFrom) / 3),
        a = (0.18 + rnd() * 0.5) * fadeIn,
        big = rnd() < bright;
      g.fillStyle = rgba(rnd() < 0.7 ? '#ffffff' : tint, a);
      const s = big ? 3 : 1.6 + rnd();
      g.fillRect(X(az) - s / 2, Y(el) - s / 2, s, s);
      if (big && rnd() < 0.5)
        additive(g, () => {
          glow(g, X(az), Y(el), 9, 9, tint, a * 0.5);
          g.fillStyle = rgba('#ffffff', a * 0.35);
          g.fillRect(X(az) - 9, Y(el) - 0.6, 18, 1.2);
          g.fillRect(X(az) - 0.6, Y(el) - 9, 1.2, 18);
        });
    }
  }
  const blurCopy = (src, px) => {
    const [c, g] = canvas(src.width, src.height);
    g.filter = `blur(${px}px)`;
    g.drawImage(src, 0, 0);
    return c;
  };

  // ============================================================================================
  // Stadium: per-arena architecture on the shared bands (pitch wall, three tiers, roof lip).
  // ============================================================================================
  const TIERS = [
    { bottom: LED_TOP, top: LED_TOP + 2.3, far: 0 },
    { bottom: LED_TOP + 2.3, top: LED_TOP + 4.4, far: 0.5 },
    { bottom: LED_TOP + 4.4, top: ROOF, far: 1 },
  ];
  // Light masts sit outside the fighters' band (portrait sees ±14°, the rival stands at 5–12°).
  const MASTS = [-62, -46, -31, -17, 17, 31, 46, 62];

  // Crowd: a soft colour mass. Sections between aisles favour one colour of the arena palette,
  // so the stands read as calm blocks instead of per-person noise; the live twinkles, flash-bulbs
  // and the cheering wave come from the shader.
  function crowd(g, tier, s, rnd) {
    const y0 = Y(tier.top),
      y1 = Y(tier.bottom),
      h = y1 - y0,
      rows = 4,
      palette = t.crowd.map(rgb),
      back = rgb(s.back);
    for (let r = 0; r < rows; r++) {
      const ry = y0 + (r + 0.62) * (h / rows),
        rowScale = 0.9 + (r / rows) * 0.2,
        lit = s.lit[0] + (s.lit[1] - s.lit[0]) * (r / (rows - 1));
      for (let x = rnd() * 6; x < W; x += (6.2 + rnd() * 2.4) * rowScale) {
        const az = x / SX - L.az,
          section = Math.floor((az + L.az) / 8.5),
          density = fbm(az * 0.07, tier.bottom * 0.5, 2);
        if (rnd() < 0.08 + Math.max(0, -density) * 0.5) continue;
        const pick =
            rnd() < 0.55 ? (section * 7 + tier.far * 4) % palette.length : (rnd() * palette.length) | 0,
          base = mixc(palette[pick | 0], back, s.crowdMix + rnd() * 0.12),
          k = lit * (1 - tier.far * 0.16) * (0.9 + rnd() * 0.2);
        g.fillStyle = css(base.map((v) => v * k * 0.78));
        g.beginPath();
        g.ellipse(x, ry + 1.5, 3.8 * rowScale, 3.2 * rowScale, 0, 0, TAU);
        g.fill();
        g.fillStyle = css(base.map((v) => Math.min(255, v * k * 1.05)));
        g.beginPath();
        g.arc(x + (rnd() - 0.5), ry - 3.4 * rowScale, 2.3 * rowScale, 0, TAU);
        g.fill();
      }
    }
  }

  function paintStands(g, s) {
    const rnd = stream('stands');
    for (const tier of TIERS) {
      const y0 = Y(tier.top),
        y1 = Y(tier.bottom),
        h = y1 - y0;
      // The rake behind the crowd: darker toward the back, hazier for the upper tiers.
      g.fillStyle = vGrad(g, tier.top, tier.bottom, [
        [0, shade(s.back, 0.6 - tier.far * 0.05)],
        [1, shade(s.back, 0.95 - tier.far * 0.1)],
      ]);
      g.fillRect(0, y0, W, h);
      const [layer, lg] = canvas(W, Math.ceil(h) + 8);
      lg.translate(0, -y0 + 4);
      crowd(lg, tier, s, rnd);
      g.drawImage(blurCopy(layer, 1.3), 0, y0 - 4);
      // Aisle stairs: faint lit strips between sections.
      for (let az = -L.az + 4.25; az < L.az; az += 8.5) {
        g.fillStyle = rgba(s.aisle, 0.16 - tier.far * 0.04);
        g.fillRect(X(az) - 2.5, y0, 5, h);
      }
      // Distance haze and the light falling from the masts (stronger at the front).
      g.fillStyle = vGrad(g, tier.top, tier.bottom, [
        [0, rgba(t.haze, 0.1 + tier.far * 0.08)],
        [1, rgba(t.haze, 0.02 + tier.far * 0.05)],
      ]);
      g.fillRect(0, y0, W, h);
      // Shadow under the balcony front above this tier.
      const shadow = g.createLinearGradient(0, y0, 0, y0 + h * 0.45);
      shadow.addColorStop(0, 'rgba(0,0,0,0.5)');
      shadow.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = shadow;
      g.fillRect(0, y0, W, h * 0.45);
    }
    // Balcony fronts between tiers and the lower tier's front rail.
    for (const tier of TIERS) {
      const yb = Y(tier.bottom),
        fh = (tier.far ? 0.3 : 0.2) * SY;
      s.fascia(g, yb - fh, fh, tier);
    }
    // Structural pillars under the light masts: the arena's architecture, kept low-contrast.
    for (const az of MASTS) s.pillar(g, X(az), Y(ROOF), Y(LED_TOP), az);
    // Roof lip above the upper tier.
    s.roof(g);
    // Pitch wall between the floor line and the lower tier.
    s.wall(g, Y(LED_TOP), Y(FLOOR));
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, Y(FLOOR) - 3, W, 6);
  }

  // Generic balcony front: a band with a lit top edge and a soft glow line.
  const fasciaBand =
    ({ color, trim, glowColor, glowAlpha = 0.25, texture }) =>
    (g, y, h, tier) => {
      const grd = g.createLinearGradient(0, y, 0, y + h);
      grd.addColorStop(0, shade(color, 1.25));
      grd.addColorStop(1, shade(color, 0.7));
      g.fillStyle = grd;
      g.fillRect(0, y, W, h);
      texture?.(g, y, h, tier);
      g.fillStyle = rgba(trim, 0.55 - tier.far * 0.15);
      g.fillRect(0, y, W, 2.2);
      additive(g, () => {
        const line = g.createLinearGradient(0, y - 6, 0, y + 8);
        line.addColorStop(0, rgba(glowColor, 0));
        line.addColorStop(0.45, rgba(glowColor, glowAlpha * (1 - tier.far * 0.35)));
        line.addColorStop(1, rgba(glowColor, 0));
        g.fillStyle = line;
        g.fillRect(0, y - 6, W, 14);
      });
    };
  // Generic roof lip: underside, edge highlight, a row of small downlights.
  const roofLip =
    ({ color, edge, lamp, depth = 1.0, lampEvery = 2.6 }) =>
    (g) => {
      const y0 = Y(ROOF + depth),
        y1 = Y(ROOF);
      g.fillStyle = vGrad(g, ROOF + depth, ROOF, [
        [0, shade(color, 1.35)],
        [0.35, shade(color, 1)],
        [1, shade(color, 0.55)],
      ]);
      g.fillRect(0, y0, W, y1 - y0);
      g.fillStyle = rgba(edge, 0.5);
      g.fillRect(0, y0, W, 2.5);
      additive(g, () => {
        for (let az = -L.az + 1; az < L.az; az += lampEvery) glow(g, X(az), y1 - 3, 7, 4, lamp, 0.5);
      });
    };
  // Pitch wall of soft light panels (no text): per-arena colours and motif.
  const panelWall =
    ({ base, colors, motif, alpha = 0.55, every = 5.2 }) =>
    (g, y0, y1) => {
      const h = y1 - y0;
      g.fillStyle = vGrad(g, LED_TOP, FLOOR, [
        [0, shade(base, 1.2)],
        [1, shade(base, 0.7)],
      ]);
      g.fillRect(0, y0, W, h);
      let i = 0;
      for (let az = -L.az; az < L.az; az += every, i++) {
        const x0 = X(az) + 4,
          x1 = X(az + every) - 4,
          col = colors[i % colors.length];
        const grd = g.createLinearGradient(x0, 0, x1, 0);
        grd.addColorStop(0, rgba(col, alpha * 0.55));
        grd.addColorStop(0.5, rgba(col, alpha * 0.3));
        grd.addColorStop(1, rgba(col, alpha * 0.55));
        g.fillStyle = grd;
        g.fillRect(x0, y0 + 3, x1 - x0, h - 7);
        motif(g, x0, y0 + 3, x1 - x0, h - 7, col, i);
      }
      additive(g, () => {
        g.fillStyle = vGrad(g, LED_TOP + 0.8, LED_TOP, [
          [0, rgba(t.glow, 0)],
          [1, rgba(t.glow, 0.16)],
        ]);
        g.fillRect(0, Y(LED_TOP + 0.8), W, 0.8 * SY);
      });
    };
  const motifs = {
    chevron(g, x, y, w, h, col, i) {
      g.fillStyle = rgba('#ffffff', 0.16);
      for (let k = 0; k < 4; k++) {
        const cx = x + w * (0.2 + k * 0.2);
        g.beginPath();
        g.moveTo(cx, y + h * 0.25);
        g.lineTo(cx + h * 0.28, y + h * 0.5);
        g.lineTo(cx, y + h * 0.75);
        g.lineTo(cx + h * 0.1, y + h * 0.5);
        g.fill();
      }
    },
    dots(g, x, y, w, h) {
      additive(g, () => {
        for (let k = 0; k < 5; k++)
          glow(g, x + w * (0.1 + k * 0.2), y + h * 0.5, h * 0.3, h * 0.3, '#ffe9a8', 0.35);
      });
    },
    wave(g, x, y, w, h) {
      g.strokeStyle = rgba('#ffffff', 0.18);
      g.lineWidth = 2;
      g.beginPath();
      for (let k = 0; k <= 24; k++)
        g.lineTo(x + (w * k) / 24, y + h * 0.5 + Math.sin((k / 24) * TAU * 2) * h * 0.18);
      g.stroke();
    },
    grate(g, x, y, w, h) {
      g.fillStyle = 'rgba(0,0,0,0.45)';
      for (let k = x + 6; k < x + w; k += 10) g.fillRect(k, y, 3, h);
    },
    stars(g, x, y, w, h) {
      g.fillStyle = rgba('#fff4d8', 0.35);
      for (let k = 0; k < 4; k++) {
        const cx = x + w * (0.15 + k * 0.23),
          cy = y + h * 0.5,
          r = h * 0.22;
        g.beginPath();
        for (let p = 0; p < 8; p++) {
          const a = (p / 8) * TAU,
            rr = p % 2 ? r * 0.35 : r;
          g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        }
        g.fill();
      }
    },
    diamond(g, x, y, w, h) {
      g.fillStyle = rgba('#ffe2c0', 0.2);
      for (let k = 0; k < 4; k++) {
        const cx = x + w * (0.14 + k * 0.24),
          cy = y + h * 0.5,
          r = h * 0.3;
        g.beginPath();
        g.moveTo(cx, cy - r);
        g.lineTo(cx + r * 0.6, cy);
        g.lineTo(cx, cy + r);
        g.lineTo(cx - r * 0.6, cy);
        g.fill();
      }
    },
  };

  // Light masts with baked god rays toward the pitch; `head` draws the arena's lamp shape.
  function masts(g, { mast, head, lamp, rays = 0.1, height = 4.2 }) {
    for (const az of MASTS) {
      const x = X(az),
        top = ROOF + height * (1 - Math.abs(az) / 240);
      g.fillStyle = vGrad(g, top, ROOF - 0.3, [
        [0, shade(mast, 1.3)],
        [1, shade(mast, 0.7)],
      ]);
      g.fillRect(x - 3, Y(top), 6, Y(ROOF - 0.3) - Y(top));
      additive(g, () => {
        const target = X(az * 0.3),
          ray = g.createLinearGradient(0, Y(top), 0, Y(FLOOR));
        ray.addColorStop(0, rgba(lamp, rays));
        ray.addColorStop(0.6, rgba(lamp, rays * 0.25));
        ray.addColorStop(1, rgba(lamp, 0));
        g.fillStyle = ray;
        g.filter = 'blur(10px)';
        g.beginPath();
        g.moveTo(x - 16, Y(top));
        g.lineTo(x + 16, Y(top));
        g.lineTo(target + 7 * SX, Y(FLOOR));
        g.lineTo(target - 7 * SX, Y(FLOOR));
        g.closePath();
        g.fill();
        g.filter = 'none';
      });
      head(g, x, Y(top), az);
      additive(g, () => glowDeg(g, az, top, 4.5, lamp, 0.2));
    }
  }
  // A structural pillar through the stands: lit left edge, shaded right, capital and foot.
  const column =
    ({ color, edge, width = 12, glowColor = null, bands = 0 }) =>
    (g, x, y0, y1) => {
      const grd = g.createLinearGradient(x - width / 2, 0, x + width / 2, 0);
      grd.addColorStop(0, shade(color, 1.45));
      grd.addColorStop(0.35, shade(color, 1.05));
      grd.addColorStop(1, shade(color, 0.6));
      g.fillStyle = grd;
      g.fillRect(x - width / 2, y0, width, y1 - y0);
      g.fillStyle = rgba(edge, 0.45);
      g.fillRect(x - width / 2, y0, 1.6, y1 - y0);
      g.fillStyle = shade(color, 1.3);
      g.fillRect(x - width * 0.85, y0, width * 1.7, 5);
      g.fillRect(x - width * 0.75, y1 - 5, width * 1.5, 5);
      for (let k = 1; k <= bands; k++) {
        g.fillStyle = rgba(edge, 0.3);
        g.fillRect(x - width / 2, y0 + ((y1 - y0) * k) / (bands + 1), width, 2);
      }
      if (glowColor)
        additive(g, () => {
          const line = g.createLinearGradient(x - width * 1.5, 0, x + width * 1.5, 0);
          line.addColorStop(0, rgba(glowColor, 0));
          line.addColorStop(0.5, rgba(glowColor, 0.18));
          line.addColorStop(1, rgba(glowColor, 0));
          g.fillStyle = line;
          g.fillRect(x - width * 1.5, y0, width * 3, y1 - y0);
        });
    };

  // ============================================================================================
  // Arenas: sky + landmark + stand style.
  // ============================================================================================
  // A faceted crystal: lit face (left) and shaded face, bright at the tip and deepening toward a
  // base lost in the mist, with a lit edge and a faint ridge line.
  function crystalSpire(g, az, baseEl, h, w, lean, { lit, shaded, alpha = 1 }) {
    const tipAz = az + lean * h,
      tip = [tipAz, baseEl + h],
      sl = [az - w * 0.78 + lean * h * 0.8, baseEl + h * 0.8],
      sr = [az + w * 0.78 + lean * h * 0.8, baseEl + h * 0.8],
      ridge = [az + w * 0.18 + lean * h * 0.5, baseEl + h * 0.5],
      bl = [az - w, baseEl],
      br = [az + w, baseEl],
      bc = [az + w * 0.25, baseEl];
    const stops = (colors) => colors.map((c, i) => [i / (colors.length - 1), c]);
    g.globalAlpha = alpha;
    g.fillStyle = vGrad(g, baseEl + h, baseEl, stops(lit));
    poly(g, [bl, sl, tip, ridge, bc]);
    g.fill();
    g.fillStyle = vGrad(g, baseEl + h, baseEl, stops(shaded));
    poly(g, [bc, ridge, tip, sr, br]);
    g.fill();
    g.strokeStyle = 'rgba(230,248,255,0.45)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(X(sl[0]), Y(sl[1]));
    g.lineTo(X(tip[0]), Y(tip[1]));
    g.stroke();
    g.strokeStyle = 'rgba(230,248,255,0.2)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(X(tip[0]), Y(tip[1]));
    g.lineTo(X(ridge[0]), Y(ridge[1]));
    g.lineTo(X(bc[0]), Y(bc[1]));
    g.stroke();
    g.globalAlpha = 1;
  }

  const ARENAS = {
    crystal: {
      sky(g) {
        const rnd = stream('sky');
        sky(g, [
          [TOP, '#02041a'],
          [15, '#060d30'],
          [9, '#0f1c52'],
          [ROOF + 1.5, '#223c86'],
          [FLOOR, '#3d64b4'],
        ]);
        mottle(g, 0.08);
        stars(g, rnd, 700, ROOF + 4, { tint: '#bfe8ff' });
        // Aurora: two curtains, teal at the lower hem fading to violet, with vertical rays.
        plateLayer(
          g,
          2,
          (az, el, px) => {
            let r = 0,
              gg = 0,
              b = 0;
            for (const [base, amp, k, strength] of [
              [12.5, 2.6, 0, 1],
              [16, 2, 5.7, 0.7],
            ]) {
              const c = base + amp * fbm(az * 0.022 + k, k, 3),
                d = el - c,
                hem = d < 0 ? Math.exp(-(d * d) / 0.35) : Math.exp(-d / 3.2),
                rays = 0.45 + 0.55 * Math.max(0, noise(az * 0.9 + k * 3, el * 0.04 + k)),
                span = 0.35 + 0.65 * clamp01(0.5 + fbm(az * 0.035 - k, 2 + k, 2) * 1.6),
                I = hem * rays * span * strength,
                m = clamp01(d / 4.5);
              r += I * (70 + 110 * m);
              gg += I * (230 - 150 * m);
              b += I * (200 + 40 * m);
            }
            px[0] = Math.min(255, r);
            px[1] = Math.min(255, gg);
            px[2] = Math.min(255, b);
          },
          { op: 'lighter', alpha: 0.42, region: [-L.az, L.az, ROOF + 2, TOP] }
        );
        // Glass dome: faint ribs converging overhead and a diagonal sheen.
        g.strokeStyle = rgba('#9fdcff', 0.1);
        g.lineWidth = 2;
        for (let i = -8; i <= 8; i++) {
          g.beginPath();
          g.moveTo(X(i * 9.5), Y(ROOF + 0.5));
          g.quadraticCurveTo(X(i * 6), Y(TOP - 1), X(i * 3.2), Y(TOP + 6));
          g.stroke();
        }
        for (const el of [ROOF + 6.5, ROOF + 12.5]) {
          g.beginPath();
          g.moveTo(0, Y(el));
          g.lineTo(W, Y(el + 0.6));
          g.stroke();
        }
        additive(g, () => glowDeg(g, 2, ROOF + 3, 24, '#5fa6ff', 0.18));
      },
      landmark(g) {
        const rnd = stream('landmark'),
          style = {
            lit: ['#e2f6ff', '#86d2ff', '#4a74cc', '#2a3a88', '#243273'],
            shaded: ['#b4a8ff', '#6a5ccc', '#2c2878', '#1c1d5a', '#1a1c52'],
          };
        // Distant crystal ridge along the horizon, hazy.
        for (let az = -L.az; az < L.az; az += 1.6 + rnd() * 2.6) {
          if (Math.abs(az) < 18) continue;
          crystalSpire(g, az, ROOF - 0.5, 1 + rnd() * 2.8, 0.6 + rnd() * 0.6, (rnd() - 0.5) * 0.3, {
            ...style,
            alpha: 0.4,
          });
        }
        g.fillStyle = vGrad(g, ROOF + 4, ROOF, [
          [0, rgba(t.haze, 0)],
          [1, rgba(t.haze, 0.35)],
        ]);
        g.fillRect(0, Y(ROOF + 4), W, 4 * SY);
        // The spire fan: the hero spire just right of centre, the fan reaching the portrait
        // corner above the rival.
        const fan = [
          [3.5, 12.4, 2.3, 0.02],
          [-1.8, 10.2, 1.8, -0.08],
          [8.2, 10.6, 1.9, 0.12],
          [-6.2, 8.2, 1.6, -0.18],
          [12.4, 8.4, 1.5, 0.22],
          [1, 7, 1.2, -0.04],
          [6, 7.4, 1.2, 0.08],
          [-10.4, 5.8, 1.3, -0.28],
          [16.2, 6.2, 1.3, 0.3],
          [-14.5, 3.8, 1.1, -0.36],
          [20, 4.2, 1.0, 0.36],
        ];
        for (const [az, h, w, lean] of fan.slice().reverse())
          crystalSpire(g, az, ROOF - 1, h, w, lean, style);
        // Inner light high in the fan, mid-blue frost mist at the feet (keeps the fighters' band
        // calm), sparkles up high.
        additive(g, () => {
          glowDeg(g, 3.5, ROOF + 8, 8, t.glow, 0.14);
          glowDeg(g, 3.5, ROOF + 11.5, 2.2, '#ffffff', 0.3);
          for (let i = 0; i < 26; i++)
            glowDeg(g, -12 + rnd() * 30, ROOF + 7 + rnd() * 7, 0.3, '#ffffff', 0.5);
        });
        g.fillStyle = vGrad(g, ROOF + 6, ROOF - 1, [
          [0, rgba('#3d5ca8', 0)],
          [1, rgba('#34508f', 0.6)],
        ]);
        g.fillRect(0, Y(ROOF + 6), W, 7 * SY);
      },
      stands: {
        back: '#172055',
        aisle: '#9fdcff',
        crowdMix: 0.42,
        lit: [0.8, 1.05],
        fascia: fasciaBand({ color: '#2a3f86', trim: '#e4f6ff', glowColor: '#8fe8ff', glowAlpha: 0.3 }),
        roof: roofLip({ color: '#101a44', edge: '#cfefff', lamp: '#dff6ff' }),
        wall: panelWall({ base: '#0b1238', colors: t.led, motif: motifs.chevron, alpha: 0.5 }),
        pillar: column({ color: '#2c3f8a', edge: '#dff6ff', width: 8, glowColor: '#8fe8ff' }),
      },
      masts: {
        mast: '#26336e',
        lamp: '#dff6ff',
        head(g, x, y) {
          g.fillStyle = '#bfe9ff';
          g.beginPath();
          g.moveTo(x, y - 22);
          g.lineTo(x + 9, y);
          g.lineTo(x, y + 10);
          g.lineTo(x - 9, y);
          g.closePath();
          g.fill();
          additive(g, () => glow(g, x, y - 4, 20, 20, '#ffffff', 0.7));
        },
      },
    },

    grove: {
      // Already the brightest sky: a lighter bloom keeps the band behind the fighters mid-value.
      bloom: 0.12,
      sky(g) {
        sky(g, [
          [TOP, '#142510'],
          [15, '#35521f'],
          [10, '#5e6832'],
          [ROOF + 3, '#8f7f44'],
          [FLOOR, '#817240'],
        ]);
        mottle(g, 0.1);
        // Distant tree line in the golden haze.
        plateLayer(
          g,
          2,
          (az, el, px) => {
            const edge = ROOF + 1.2 + 2.4 * (0.5 + fbm(az * 0.18, 1.3, 4)) + (1.2 * Math.abs(az)) / L.az;
            const a = smooth(0.25, -0.25, el - edge);
            const c = mixc(rgb('#4f5c2e'), rgb('#a89a5c'), clamp01((el - ROOF) / 5) * 0.55);
            px[0] = c[0];
            px[1] = c[1];
            px[2] = c[2];
            px[3] = 255 * a * 0.85;
          },
          { region: [-L.az, L.az, ROOF - 1, ROOF + 7] }
        );
        additive(g, () => {
          glowDeg(g, 4, ROOF + 11, 20, '#ffe7a0', 0.15);
          glowDeg(g, 4, ROOF + 11, 4.5, '#fff4d0', 0.3);
        });
      },
      landmark(g) {
        const rnd = stream('landmark'),
          bark = rgb('#2c2414'),
          rim = rgb('#ffe39a');
        // Sun shafts through the canopy, fanning from behind the tree.
        additive(g, () => {
          for (let i = 0; i < 11; i++) {
            const az = -26 + i * 5.6 + rnd() * 2;
            g.fillStyle = vGrad(g, TOP, ROOF, [
              [0, 'rgba(255,244,190,0.08)'],
              [1, 'rgba(255,244,190,0)'],
            ]);
            poly(g, [
              [az, TOP],
              [az + 1.6, TOP],
              [az * 0.55 + 4.5, ROOF],
              [az * 0.55 + 1.5, ROOF],
            ]);
            g.fill();
          }
        });
        // The ancient tree: flared roots, a massive creased trunk, branches into the canopy, gold
        // rim light from the sun behind.
        const half = (el) => {
          const k = (el - (ROOF - 1)) / (TOP - ROOF + 1);
          return 7.5 - 4.9 * smooth(0, 0.25, k) - 0.5 * smooth(0.25, 0.8, k);
        };
        const trunkAxis = (el) => 1.4 * fbm(el * 0.12, 9.2, 2);
        plateLayer(
          g,
          1,
          (az, el, px) => {
            const hw = half(el) + 0.6 * fbm(el * 0.35, 4.1, 3),
              c = trunkAxis(el),
              d = Math.abs(az - c) - hw;
            if (d > 0.4) {
              px[3] = 0;
              return;
            }
            const a = smooth(0.4, -0.1, d),
              crease = ridged((az - c) * 1.6, el * 0.16, 4),
              edge = smooth(-1.1, 0, d) * (az > c ? 1 : 0.55),
              v = 0.5 + 0.55 * crease;
            const col = mixc(
              bark.map((x) => x * v),
              rim,
              edge * 0.65 * (0.5 + 0.5 * smooth(ROOF, ROOF + 8, el))
            );
            px[0] = col[0];
            px[1] = col[1];
            px[2] = col[2];
            px[3] = 255 * a;
          },
          { region: [-24, 24, ROOF - 1.2, TOP] }
        );
        // Branches: tapered limbs from the trunk into the canopy, lit along their upper edge.
        const branch = (points, w0, w1) => {
          const n = 24,
            left = [],
            right = [];
          const at = (k) => {
            const [a, b, c] = points,
              u = 1 - k;
            return [
              u * u * a[0] + 2 * u * k * b[0] + k * k * c[0],
              u * u * a[1] + 2 * u * k * b[1] + k * k * c[1],
            ];
          };
          for (let i = 0; i <= n; i++) {
            const k = i / n,
              [x0, y0] = at(Math.max(0, k - 0.01)),
              [x1, y1] = at(Math.min(1, k + 0.01)),
              [x, y] = at(k),
              dx = x1 - x0,
              dy = y1 - y0,
              len = Math.hypot(dx, dy) || 1,
              w = w0 + (w1 - w0) * k;
            left.push([x - (dy / len) * w, y + (dx / len) * w]);
            right.push([x + (dy / len) * w, y - (dx / len) * w]);
          }
          g.fillStyle = css(bark.map((x) => x * 0.9));
          poly(g, [...left, ...right.reverse()]);
          g.fill();
          g.strokeStyle = rgba('#ffe39a', 0.35);
          g.lineWidth = 2;
          g.beginPath();
          left.forEach(([a, b], i) => (i ? g.lineTo(X(a), Y(b)) : g.moveTo(X(a), Y(b))));
          g.stroke();
        };
        const fork = ROOF + 8;
        branch(
          [
            [trunkAxis(fork) - 1.2, fork],
            [-6.5, fork + 2.2],
            [-13, TOP - 1],
          ],
          1.4,
          0.35
        );
        branch(
          [
            [trunkAxis(fork + 0.8) + 1.2, fork + 0.8],
            [7.5, fork + 2.6],
            [14.5, TOP - 1.5],
          ],
          1.3,
          0.35
        );
        branch(
          [
            [trunkAxis(fork + 2) - 0.6, fork + 2],
            [-3.5, fork + 5.5],
            [-5.5, TOP + 1],
          ],
          1.1,
          0.4
        );
        branch(
          [
            [trunkAxis(fork + 2.5) + 0.7, fork + 2.5],
            [3.8, fork + 5.5],
            [6.5, TOP + 1],
          ],
          1,
          0.4
        );
        branch(
          [
            [trunkAxis(fork + 1) - 1.5, fork + 1],
            [-11, fork + 2],
            [-21, fork + 5.5],
          ],
          0.8,
          0.25
        );
        branch(
          [
            [trunkAxis(fork + 1.6) + 1.4, fork + 1.6],
            [11, fork + 2.4],
            [22, fork + 6],
          ],
          0.75,
          0.25
        );
        // Canopy: leaf clumps arching over the top, shaded away from the sun, sunlit rims.
        plateLayer(
          g,
          2,
          (az, el, px) => {
            const edgeEl = TOP - 3.2 - 7.5 * (Math.abs(az) / L.az) ** 0.7,
              n = fbm(az * 0.16, el * 0.3, 5),
              m = el - edgeEl + n * 3.4;
            if (m < -0.6) {
              px[3] = 0;
              return;
            }
            const dx = az - 4,
              dy = el - (ROOF + 8.5),
              dl = Math.hypot(dx, dy) || 1,
              toward = fbm((az - (dx / dl) * 0.8) * 0.16, (el - (dy / dl) * 0.8) * 0.3, 5),
              facing = clamp01((n - toward) * 5 + 0.3),
              a = smooth(-0.6, 0.3, m),
              inner = smooth(0.3, 3.5, m),
              leaf = 0.78 + 0.3 * noise(az * 1.6, el * 2.4),
              sun = smooth(28, 0, Math.abs(az - 4)) * (1 - inner);
            let col = mixc(rgb('#2e5a27'), rgb('#132a12'), inner * (1 - facing * 0.5));
            col = mixc(col, rgb('#8fb04c'), facing * 0.35 * (1 - inner * 0.6));
            col = mixc(col, rgb('#d9c874'), sun * 0.5);
            px[0] = col[0] * leaf;
            px[1] = col[1] * leaf;
            px[2] = col[2] * leaf;
            px[3] = 255 * a;
          },
          { region: [-L.az, L.az, ROOF + 3, TOP] }
        );
        // Hanging vines and glowing seed lanterns (kept above the fighters' heads).
        for (let i = 0; i < 16; i++) {
          const az = -34 + i * 4.6 + rnd() * 2,
            from = TOP - 2 - rnd() * 3,
            to = ROOF + 8.5 + rnd() * 3;
          g.strokeStyle = 'rgba(22,40,20,0.75)';
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(X(az), Y(from));
          g.quadraticCurveTo(X(az + 0.6), Y((from + to) / 2), X(az + 0.2), Y(to));
          g.stroke();
          if (i % 2)
            additive(g, () => {
              glowDeg(g, az + 0.2, to, 1.1, '#ffd66b', 0.7);
              glowDeg(g, az + 0.2, to, 0.3, '#ffffff', 0.9);
            });
        }
        additive(g, () => {
          for (let i = 0; i < 70; i++)
            glowDeg(g, (rnd() - 0.5) * 90, ROOF + 6 + rnd() * 8, 0.18, '#f6ffb0', 0.7);
        });
        // Warm haze at the tree's feet softens the band behind the fighters.
        g.fillStyle = vGrad(g, ROOF + 5, ROOF - 0.5, [
          [0, rgba('#9a8648', 0)],
          [1, rgba('#86733f', 0.4)],
        ]);
        g.fillRect(0, Y(ROOF + 5), W, 5.5 * SY);
      },
      stands: {
        back: '#233d24',
        aisle: '#e8d48a',
        crowdMix: 0.4,
        lit: [0.85, 1.1],
        fascia: fasciaBand({
          color: '#5a3f22',
          trim: '#f2d9a0',
          glowColor: '#ffd66b',
          glowAlpha: 0.22,
          texture(g, y, h) {
            // Plank seams and leaf garlands.
            g.fillStyle = 'rgba(0,0,0,0.3)';
            for (let x = 0; x < W; x += 34) g.fillRect(x, y, 2, h);
            g.fillStyle = 'rgba(70,120,50,0.8)';
            for (let x = 0; x < W; x += 9) {
              const sag = Math.sin((x / W) * TAU * 30) * 3;
              g.beginPath();
              g.ellipse(x, y + h + 2 + Math.abs(sag), 4, 2.6, 0.4, 0, TAU);
              g.fill();
            }
          },
        }),
        roof: roofLip({ color: '#2b2214', edge: '#e2c486', lamp: '#ffe08a', depth: 0.9, lampEvery: 3.4 }),
        wall: panelWall({
          base: '#2a2012',
          colors: ['#6b4a26', '#5a3d20'],
          motif: motifs.dots,
          alpha: 0.7,
          every: 4,
        }),
        pillar: column({ color: '#4a3418', edge: '#f2d9a0', width: 16, bands: 2 }),
      },
      masts: {
        mast: '#3a2a16',
        lamp: '#ffe39a',
        rays: 0.1,
        head(g, x, y) {
          g.fillStyle = '#4a3418';
          g.fillRect(x - 12, y - 3, 24, 4);
          additive(g, () => {
            for (const dx of [-10, 0, 10]) {
              glow(g, x + dx, y + 8, 9, 11, '#ffd66b', 0.85);
              glow(g, x + dx, y + 8, 3, 4, '#ffffff', 0.9);
            }
          });
        },
      },
    },

    tidal: {
      sky(g) {
        const rnd = stream('sky');
        // Through the cave mouth: the moonlit sea sky and the horizon (the vault covers the rest).
        sky(g, [
          [TOP, '#021222'],
          [14, '#052238'],
          [8, '#0a3a52'],
          [ROOF + 2, '#16707e'],
          [FLOOR, '#1e8a96'],
        ]);
        mottle(g, 0.08);
        stars(g, rnd, 240, ROOF + 6, { tint: '#bff8ff', bright: 0.04 });
        // The open sea beyond the cave mouth: a dark band, a pale horizon line, the moon path.
        g.fillStyle = vGrad(g, ROOF + 1.5, ROOF - 0.5, [
          [0, '#1c7e8a'],
          [0.08, '#0d4658'],
          [1, '#082c3c'],
        ]);
        g.fillRect(0, Y(ROOF + 1.5), W, 2 * SY);
        additive(g, () => {
          glowDeg(g, 10, ROOF + 10.5, 7, '#bff8ff', 0.26);
          glowDeg(g, 10, ROOF + 10.5, 1.3, '#f2feff', 0.9);
          for (let i = 0; i < 46; i++) {
            const el = ROOF - 0.3 + rnd() * 1.7,
              w = 0.3 + rnd() * 1.4 * (el - ROOF + 0.5);
            g.fillStyle = `rgba(210,250,255,${0.08 + rnd() * 0.16})`;
            g.fillRect(X(10 + (rnd() - 0.5) * 5 - w / 2), Y(el), w * SX, 2);
          }
        });
      },
      landmark(g) {
        const rnd = stream('landmark'),
          archW = 25,
          archH = 13.6,
          archTop = (az) =>
            Math.abs(az) < archW ? ROOF + archH * Math.sqrt(1 - (az / archW) ** 2) : ROOF - 2;
        // The rock vault: ridged strata, wet teal highlights, bioluminescent spots.
        plateLayer(
          g,
          1.5,
          (az, el, px) => {
            const edge = archTop(az) + 0.5 * fbm(az * 0.4, 2.2, 3);
            if (el < edge - 0.4) {
              px[3] = 0;
              return;
            }
            const a = smooth(edge - 0.4, edge + 0.2, el),
              strata = ridged(az * 0.22, el * 0.55 + fbm(az * 0.08, el * 0.1, 3) * 2, 5),
              wet = smooth(0.45, 0.85, noise(az * 0.35, el * 1.1)) * 0.6,
              lip = smooth(edge + 2.5, edge, el);
            const base = mixc(rgb('#020b14'), rgb('#0d3042'), strata * 0.7 + lip * 0.35);
            const col = mixc(base, rgb('#58c6d6'), wet * 0.3 + lip * 0.1);
            px[0] = col[0];
            px[1] = col[1];
            px[2] = col[2];
            px[3] = 255 * a;
          },
          { region: [-L.az, L.az, ROOF - 1, TOP] }
        );
        // Stalactites along the arch and the ceiling.
        for (let i = 0; i < 60; i++) {
          const az = (rnd() * 2 - 1) * L.az,
            inArch = Math.abs(az) < archW,
            base = inArch ? archTop(az) + 0.3 : TOP - rnd() * 5,
            len = (inArch ? 0.8 : 1) * (0.8 + rnd() * 2.8);
          if (inArch && rnd() < 0.35) continue;
          g.fillStyle = vGrad(g, base, base - len, [
            [0, '#0b2a3a'],
            [1, '#1e5a6c'],
          ]);
          poly(g, [
            [az - 0.45, base + 0.4],
            [az + 0.45, base + 0.4],
            [az + 0.06, base - len],
          ]);
          g.fill();
        }
        // Bioluminescent colonies: a few clusters of small lights on the rock.
        additive(g, () => {
          for (let c = 0; c < 16; c++) {
            const caz = (rnd() * 2 - 1) * L.az;
            if (Math.abs(caz) < 8) continue;
            const cel = archTop(caz) + 1 + rnd() * 6,
              color = rnd() < 0.7 ? t.glow : t.accent;
            for (let i = 0; i < 8; i++) {
              const el = cel + (rnd() - 0.5) * 2.4;
              if (el > TOP || el < archTop(caz) + 0.3) continue;
              glowDeg(g, caz + (rnd() - 0.5) * 3, el, 0.18 + rnd() * 0.3, color, 0.45);
            }
          }
        });
        // The waterfall: bright where it leaves the vault, turning to spray lower down, so the
        // band behind the fighters stays soft.
        const fallAz = 4,
          fallTop = archTop(fallAz) + 0.3;
        plateLayer(
          g,
          1,
          (az, el, px) => {
            const dx = (az - fallAz) / (2.4 + 0.35 * smooth(fallTop, ROOF, el)),
              body = smooth(1, 0.55, Math.abs(dx)),
              streak = 0.55 + 0.45 * fbm(az * 2.6, el * 0.18, 4),
              spray = smooth(ROOF + 7, ROOF, el),
              I = body * (streak * (1 - spray * 0.55) + spray * 0.35);
            px[0] = 170 + 80 * I;
            px[1] = 235 + 20 * I;
            px[2] = 245 + 10 * I;
            px[3] = 255 * clamp01(I * (0.95 - spray * 0.4));
          },
          { region: [fallAz - 5, fallAz + 5, ROOF - 0.5, fallTop] }
        );
        additive(g, () => {
          glowDeg(g, fallAz, ROOF + 1, 7, '#9ff4ff', 0.3);
          glowDeg(g, fallAz, fallTop - 0.5, 2.6, '#e8ffff', 0.35);
        });
        g.fillStyle = vGrad(g, ROOF + 4, ROOF - 0.5, [
          [0, rgba('#8fe6f0', 0)],
          [1, rgba('#5fbfcf', 0.4)],
        ]);
        g.fillRect(0, Y(ROOF + 4), W, 4.5 * SY);
      },
      stands: {
        back: '#0f2f44',
        aisle: '#6ff6ff',
        crowdMix: 0.45,
        lit: [0.8, 1.05],
        fascia: fasciaBand({
          color: '#123a4a',
          trim: '#bff8ff',
          glowColor: '#6ff6ff',
          glowAlpha: 0.32,
          texture(g, y, h) {
            g.fillStyle = 'rgba(111,246,255,0.18)';
            for (let x = 0; x < W; x += 5)
              if (Math.sin(x * 0.07) + Math.sin(x * 0.013) > 0.6) g.fillRect(x, y + h - 3, 3, 3);
          },
        }),
        roof: roofLip({ color: '#06151f', edge: '#6fe0f0', lamp: '#9ff4ff', depth: 1.2, lampEvery: 3.1 }),
        wall: panelWall({ base: '#06202c', colors: t.led, motif: motifs.wave, alpha: 0.45 }),
        pillar: column({ color: '#0d2c3c', edge: '#6fe0f0', width: 22, glowColor: '#6ff6ff' }),
      },
      masts: {
        mast: '#0b2a3a',
        lamp: '#bff8ff',
        head(g, x, y) {
          additive(g, () => {
            glow(g, x, y, 18, 18, '#6ff6ff', 0.8);
            glow(g, x, y, 6, 6, '#ffffff', 0.9);
          });
        },
      },
    },

    volcano: {
      sky(g) {
        sky(g, [
          [TOP, '#160405'],
          [15, '#3a0e09'],
          [9, '#8a2c10'],
          [ROOF + 2, '#e9742c'],
          [FLOOR, '#ff9a45'],
        ]);
        mottle(g, 0.1);
        // Smoke banks lit from below by the lava light.
        plateLayer(
          g,
          2,
          (az, el, px) => {
            const n = fbm(az * 0.05 + fbm(az * 0.02, el * 0.05, 2), el * 0.22, 5),
              a = smooth(-0.05, 0.35, n) * smooth(ROOF + 2, ROOF + 6, el),
              under = smooth(0.35, 0, n) * smooth(TOP, ROOF + 3, el);
            const col = mixc(rgb('#321210'), rgb('#f07032'), under * 0.65);
            px[0] = col[0];
            px[1] = col[1];
            px[2] = col[2];
            px[3] = 255 * a * 0.62;
          },
          { region: [-L.az, L.az, ROOF + 1, TOP] }
        );
        // Far ridges in the haze.
        for (const [k, color, lift] of [
          [0, '#b3481f', 2.6],
          [1, '#6a2412', 1.5],
        ])
          plateLayer(
            g,
            2,
            (az, el, px) => {
              const edge = ROOF + lift + 1.6 * fbm(az * 0.07 + k * 9, k, 4);
              const a = smooth(0.2, -0.2, el - edge);
              const c = rgb(color);
              px[0] = c[0];
              px[1] = c[1];
              px[2] = c[2];
              px[3] = 255 * a;
            },
            { region: [-L.az, L.az, ROOF - 1, ROOF + 6] }
          );
      },
      landmark(g) {
        const rnd = stream('landmark'),
          craterEl = ROOF + 10.4,
          cone = (az) => {
            const d = Math.abs(az - 2);
            return d < 3.4 ? craterEl : craterEl - (d - 3.4) * (0.34 - 0.13 * smooth(3.4, 40, d));
          };
        // The eruption lights the sky around the crater, so the cone's flanks read as a silhouette.
        additive(g, () => {
          glowDeg(g, 2, craterEl - 1, 22, '#ff5a1e', 0.34);
          glowDeg(g, 2, craterEl, 9, '#ff9a4a', 0.3);
        });
        // Eruption plume above the crater: glowing at its root, ash-brown as it rises and drifts.
        plateLayer(
          g,
          2,
          (az, el, px) => {
            const k = clamp01((el - craterEl) / (TOP - craterEl)),
              cx = 2 + k * 7 + 2.5 * fbm(el * 0.1, 3.3, 2),
              wdt = 2.6 + k * 15,
              n = fbm(az * 0.12, el * 0.25 - 4, 5),
              a =
                smooth(1, 0.3, Math.abs(az - cx) / wdt + n * 0.55) * smooth(craterEl - 0.5, craterEl + 1, el);
            let col = mixc(rgb('#ff8038'), rgb('#6a2a1a'), smooth(0, 0.35, k));
            col = mixc(col, rgb('#2c1512'), smooth(0.3, 1, k) * 0.8);
            col = mixc(col, rgb('#a4502a'), clamp01(-n * 1.4) * (1 - k) * 0.6);
            px[0] = col[0];
            px[1] = col[1];
            px[2] = col[2];
            px[3] = 255 * a * 0.94;
          },
          { region: [-20, 42, craterEl - 1, TOP] }
        );
        // The cone: near-black ridged rock against the blazing sky, rim-lit along its crest.
        plateLayer(
          g,
          1,
          (az, el, px) => {
            const edge = cone(az) + 0.25 * fbm(az * 0.5, 7, 3);
            if (el > edge + 0.2) {
              px[3] = 0;
              return;
            }
            const a = smooth(edge + 0.2, edge - 0.2, el),
              ridge = ridged(az * 0.35 + el * 0.1 * Math.sign(az - 2), el * 0.9, 5),
              rim = smooth(edge - 0.9, edge, el),
              flank = smooth(4, -12, az - 2) * 0.35 * smooth(ROOF, craterEl, el);
            let col = mixc(rgb('#0b0303'), rgb('#2e120c'), ridge * 0.85);
            col = mixc(col, rgb('#7a2c14'), flank * ridge);
            col = mixc(col, rgb('#ff8a3a'), rim * 0.5);
            px[0] = col[0];
            px[1] = col[1];
            px[2] = col[2];
            px[3] = 255 * a;
          },
          { region: [-54, 58, ROOF - 1.2, craterEl + 0.6] }
        );
        // Lava rivers: meandering ribbons from the crater, thinning and cooling down the flanks,
        // with a blurred glow; they fade out above the fighters' band.
        {
          const [layer, lg] = canvas(W, H);
          for (const [start, drift, seedK] of [
            [0.6, -0.55, 1],
            [1.8, -0.18, 2],
            [3, 0.2, 3],
            [3.6, 0.62, 4],
          ]) {
            const left = [],
              right = [];
            for (let el = craterEl - 0.1; el > ROOF + 1.5; el -= 0.12) {
              const run = craterEl - el,
                az = start + drift * run + 0.7 * fbm(el * 0.35, seedK * 3.1, 3) * Math.min(1, run / 2),
                w = 0.32 - 0.2 * clamp01(run / 8);
              left.push([az - w, el]);
              right.push([az + w, el]);
            }
            const grd = lg.createLinearGradient(0, Y(craterEl), 0, Y(ROOF + 1.5));
            grd.addColorStop(0, 'rgba(255,236,170,1)');
            grd.addColorStop(0.25, 'rgba(255,150,60,0.95)');
            grd.addColorStop(0.7, 'rgba(220,70,30,0.6)');
            grd.addColorStop(1, 'rgba(160,40,20,0)');
            lg.fillStyle = grd;
            poly(lg, [...left, ...right.reverse()]);
            lg.fill();
          }
          additive(g, () => {
            g.globalAlpha = 0.85;
            g.drawImage(blurCopy(layer, 14), 0, 0);
            g.globalAlpha = 0.9;
            g.drawImage(layer, 0, 0);
          });
        }
        additive(g, () => {
          glowDeg(g, 2, craterEl + 0.3, 5.5, '#ff7a2a', 0.55);
          glowDeg(g, 2, craterEl + 0.1, 1.8, '#ffe0a0', 0.65);
          for (let i = 0; i < 70; i++)
            glowDeg(
              g,
              2 + (rnd() - 0.5) * 26,
              craterEl + 0.5 + rnd() * 7.5,
              0.14 + rnd() * 0.16,
              '#ffb060',
              0.75
            );
        });
        // Forge chimneys either side, outside the portrait fighters' band.
        for (const az of [-22, 24]) {
          g.fillStyle = vGrad(g, ROOF + 8, ROOF, [
            [0, '#2a110b'],
            [1, '#120605'],
          ]);
          poly(g, [
            [az - 1.2, ROOF - 0.5],
            [az - 0.9, ROOF + 8],
            [az + 0.9, ROOF + 8],
            [az + 1.2, ROOF - 0.5],
          ]);
          g.fill();
          g.fillStyle = '#3a180e';
          g.fillRect(X(az - 1.3), Y(ROOF + 8.4), 2.6 * SX, 0.5 * SY);
          additive(g, () => {
            glowDeg(g, az, ROOF + 8.5, 2.6, '#ff7a2a', 0.65);
            glowDeg(g, az, ROOF + 8.4, 0.8, '#ffe0a0', 0.8);
          });
        }
        g.fillStyle = vGrad(g, ROOF + 4, ROOF - 0.5, [
          [0, rgba('#ff8a3d', 0)],
          [1, rgba('#c9552a', 0.35)],
        ]);
        g.fillRect(0, Y(ROOF + 4), W, 4.5 * SY);
      },
      stands: {
        back: '#3a150e',
        aisle: '#ffae4d',
        crowdMix: 0.42,
        lit: [0.8, 1.05],
        fascia: fasciaBand({
          color: '#2a120c',
          trim: '#ffb35a',
          glowColor: '#ff7a2a',
          glowAlpha: 0.34,
          texture(g, y, h) {
            additive(g, () => {
              for (let x = 12; x < W; x += 48) glow(g, x, y + h * 0.5, 4, 3, '#ffb060', 0.6);
            });
          },
        }),
        roof: roofLip({ color: '#1a0806', edge: '#ff9a45', lamp: '#ffc27a', depth: 1.0, lampEvery: 3 }),
        wall: panelWall({ base: '#1e0906', colors: t.led, motif: motifs.grate, alpha: 0.5 }),
        pillar: column({ color: '#241009', edge: '#ffb35a', width: 12, bands: 3, glowColor: '#ff7a2a' }),
      },
      masts: {
        mast: '#2a120c',
        lamp: '#ffc27a',
        rays: 0.1,
        head(g, x, y) {
          g.fillStyle = '#3a180e';
          g.beginPath();
          g.moveTo(x - 14, y - 4);
          g.lineTo(x + 14, y - 4);
          g.lineTo(x + 8, y + 8);
          g.lineTo(x - 8, y + 8);
          g.closePath();
          g.fill();
          additive(g, () => {
            glow(g, x, y - 10, 16, 22, '#ff7a2a', 0.8);
            glow(g, x, y - 6, 6, 8, '#ffe0a0', 0.9);
          });
        },
      },
    },

    astral: {
      sky(g) {
        const rnd = stream('sky');
        sky(g, [
          [TOP, '#02020f'],
          [14, '#0a0730'],
          [8, '#1b1350'],
          [ROOF + 1.5, '#3e3088'],
          [FLOOR, '#7a60c8'],
        ]);
        // Nebulae: domain-warped clouds, violet and cyan, strongest along a diagonal band.
        plateLayer(
          g,
          2,
          (az, el, px) => {
            const wx = az * 0.05 + 1.3 * fbm(az * 0.03, el * 0.08, 3),
              wy = el * 0.12 + 1.3 * fbm(az * 0.03 + 5, el * 0.08 + 5, 3),
              n = fbm(wx, wy, 5),
              band = Math.exp(-(((el - 12 - az * 0.08) / 5) ** 2)),
              I = smooth(-0.1, 0.55, n) * (0.35 + 0.65 * band),
              hue = clamp01(0.5 + fbm(wx + 3, wy - 2, 2) * 1.5);
            const col = mixc(rgb('#8a4bff'), rgb('#3fb8ff'), hue);
            px[0] = col[0] * I;
            px[1] = col[1] * I;
            px[2] = col[2] * I;
          },
          { op: 'lighter', alpha: 0.5, region: [-L.az, L.az, ROOF + 1, TOP] }
        );
        mottle(g, 0.06);
        stars(g, rnd, 1600, ROOF + 2, { tint: '#ffe6b0', bright: 0.06 });
      },
      landmark(g) {
        const rnd = stream('landmark'),
          pAz = 4.5,
          pEl = ROOF + 9.8,
          pr = 3.4,
          tilt = -0.26;
        const ring = (from, to, alpha) => {
          g.save();
          g.translate(X(pAz), Y(pEl));
          g.rotate(tilt);
          for (const [scale, width, a] of [
            [1.95, 9, 0.42],
            [1.7, 3, 0.28],
            [2.2, 2, 0.2],
          ]) {
            g.strokeStyle = `rgba(255,228,190,${a * alpha})`;
            g.lineWidth = width;
            g.beginPath();
            g.ellipse(0, 0, pr * scale * SX, pr * 0.4 * SY * scale * 0.55, 0, from, to);
            g.stroke();
          }
          g.restore();
        };
        additive(g, () => glowDeg(g, pAz, pEl, pr * 3, '#b08cff', 0.2));
        ring(Math.PI, TAU, 1);
        // The planet: banded, lit from the upper left, with a soft terminator.
        plateLayer(
          g,
          1,
          (az, el, px) => {
            const dx = (az - pAz) / pr,
              dy = (el - pEl) / pr,
              r = Math.hypot(dx, dy);
            if (r > 1.02) {
              px[3] = 0;
              return;
            }
            const z = Math.sqrt(Math.max(0, 1 - r * r)),
              light = clamp01(-dx * 0.55 + dy * 0.45 + z * 0.75),
              bandN = 0.5 + 0.5 * Math.sin(dy * 9 + fbm(dx * 2, dy * 6, 3) * 2.2);
            const col = mixc(
              mixc(rgb('#6a3a5c'), rgb('#f2c89a'), bandN * 0.7 + 0.15),
              rgb('#ffe9c4'),
              light * 0.35
            );
            const k = 0.22 + 0.95 * light;
            px[0] = Math.min(255, col[0] * k);
            px[1] = Math.min(255, col[1] * k);
            px[2] = Math.min(255, col[2] * k);
            px[3] = 255 * smooth(1.02, 0.98, r);
          },
          { region: [pAz - pr * 1.1, pAz + pr * 1.1, pEl - pr * 1.1, pEl + pr * 1.1] }
        );
        ring(0, Math.PI, 1.6);
        // A small moon and a shooting star.
        plateLayer(
          g,
          1,
          (az, el, px) => {
            const dx = (az + 7.5) / 1.1,
              dy = (el - ROOF - 12.4) / 1.1,
              r = Math.hypot(dx, dy);
            const light = clamp01(0.3 + dx * 0.5 + dy * 0.4 + Math.sqrt(Math.max(0, 1 - r * r)) * 0.5);
            px[0] = 60 + 170 * light;
            px[1] = 56 + 164 * light;
            px[2] = 110 + 140 * light;
            px[3] = 255 * smooth(1.03, 0.97, r);
          },
          { region: [-9, -6, ROOF + 11, ROOF + 14] }
        );
        additive(g, () => {
          const s = g.createLinearGradient(X(18), Y(ROOF + 15.5), X(29), Y(ROOF + 12.5));
          s.addColorStop(0, 'rgba(255,255,255,0)');
          s.addColorStop(1, 'rgba(255,245,220,0.75)');
          g.strokeStyle = s;
          g.lineWidth = 2.5;
          g.beginPath();
          g.moveTo(X(18), Y(ROOF + 15.5));
          g.lineTo(X(29), Y(ROOF + 12.5));
          g.stroke();
        });
        // Observatory dome on the left with a glowing slit and its telescope.
        const dAz = -13,
          dr = 4.4,
          base = ROOF + 1.6;
        g.fillStyle = vGrad(g, base, ROOF - 0.5, [
          [0, '#2a2466'],
          [1, '#14113a'],
        ]);
        g.fillRect(X(dAz - dr), Y(base), 2 * dr * SX, Y(ROOF - 0.5) - Y(base));
        plateLayer(
          g,
          1,
          (az, el, px) => {
            const dx = (az - dAz) / dr,
              dy = (el - base) / dr,
              r = Math.hypot(dx, dy);
            if (r > 1.01 || dy < 0) {
              px[3] = 0;
              return;
            }
            const z = Math.sqrt(Math.max(0, 1 - r * r)),
              light = clamp01(0.25 + dx * 0.35 + dy * 0.3 + z * 0.5),
              seam = Math.abs(Math.sin(Math.atan2(dx, z) * 8)) < 0.06 ? 0.75 : 1;
            const col = mixc(rgb('#1c1848'), rgb('#9c8ae0'), light);
            px[0] = col[0] * seam;
            px[1] = col[1] * seam;
            px[2] = col[2] * seam;
            px[3] = 255 * smooth(1.01, 0.98, r);
          },
          { region: [dAz - dr - 0.2, dAz + dr + 0.2, base, base + dr + 0.2] }
        );
        g.fillStyle = rgba(t.accent, 0.85);
        g.fillRect(X(dAz - 0.4), Y(base + dr * 0.97), 0.8 * SX, dr * 0.9 * SY);
        additive(g, () => glowDeg(g, dAz, base + dr * 0.6, 3.2, t.accent, 0.32));
        g.save();
        g.translate(X(dAz + 0.2), Y(base + dr * 0.8));
        g.rotate(-0.75);
        g.fillStyle = '#b8a8ff';
        g.fillRect(-7, -2.8 * SY, 14, 3.4 * SY);
        g.restore();
        g.fillStyle = vGrad(g, ROOF + 4, ROOF - 0.5, [
          [0, rgba('#9a7ae0', 0)],
          [1, rgba('#6a54b8', 0.35)],
        ]);
        g.fillRect(0, Y(ROOF + 4), W, 4.5 * SY);
        additive(g, () => {
          for (let i = 0; i < 12; i++)
            glowDeg(g, (rnd() - 0.5) * 60, ROOF + 7 + rnd() * 9, 0.25, '#ffffff', 0.7);
        });
      },
      stands: {
        back: '#211a52',
        aisle: '#e0b6ff',
        crowdMix: 0.42,
        lit: [0.8, 1.05],
        fascia: fasciaBand({
          color: '#3a2f7a',
          trim: '#ffe6b0',
          glowColor: '#e0b6ff',
          glowAlpha: 0.26,
          texture(g, y, h) {
            g.fillStyle = 'rgba(255,230,176,0.35)';
            for (let x = 20; x < W; x += 64) g.fillRect(x, y, 3, h);
          },
        }),
        roof: roofLip({ color: '#0d0a2a', edge: '#ffe6b0', lamp: '#fff0c8', depth: 1.0, lampEvery: 2.8 }),
        wall: panelWall({ base: '#0e0b2c', colors: t.led, motif: motifs.stars, alpha: 0.45 }),
        pillar: column({ color: '#4a4290', edge: '#ffe6b0', width: 16, bands: 1 }),
      },
      masts: {
        mast: '#2a2466',
        lamp: '#fff0c8',
        head(g, x, y) {
          g.strokeStyle = 'rgba(255,230,176,0.8)';
          g.lineWidth = 2;
          g.beginPath();
          g.ellipse(x, y, 14, 5, -0.3, 0, TAU);
          g.stroke();
          additive(g, () => {
            glow(g, x, y, 14, 14, '#fff0c8', 0.75);
            glow(g, x, y, 4, 4, '#ffffff', 0.9);
          });
        },
      },
    },

    eclipse: {
      sky(g) {
        sky(g, [
          [TOP, '#07020d'],
          [15, '#1c0822'],
          [9, '#3e1040'],
          [ROOF + 2, '#a23e76'],
          [FLOOR, '#d8689a'],
        ]);
        mottle(g, 0.08);
        stars(g, stream('sky'), 320, ROOF + 7, { tint: '#ffd0e4', bright: 0.04 });
        // Dusk cloud streaks glowing along the horizon.
        plateLayer(
          g,
          2,
          (az, el, px) => {
            const n = fbm(az * 0.03, el * 0.9, 4),
              a = smooth(0.05, 0.45, n) * Math.exp(-(((el - ROOF - 4) / 3.2) ** 2));
            px[0] = 255;
            px[1] = 150;
            px[2] = 190;
            px[3] = 255 * a * 0.35;
          },
          { region: [-L.az, L.az, ROOF, ROOF + 10] }
        );
      },
      landmark(g) {
        const rnd = stream('landmark'),
          eAz = 3.5,
          eEl = ROOF + 10.2,
          er = 2.7;
        // The corona: radial streamers from gradient noise around the black sun.
        plateLayer(
          g,
          1,
          (az, el, px) => {
            const dx = (az - eAz) / er,
              dy = (el - eEl) / er,
              r = Math.hypot(dx, dy);
            if (r < 0.98) {
              px[3] = 0;
              return;
            }
            const a = Math.atan2(dy, dx),
              streak =
                0.5 + 0.5 * fbm(Math.cos(a) * 2.2 + 9, Math.sin(a) * 2.2, 4) + 0.35 * noise(a * 7, 1.3),
              reach = 1.4 + 2.4 * clamp01(streak),
              I = Math.exp(-(r - 1) / (reach * 0.42)) * (0.45 + 0.55 * clamp01(streak));
            const col = mixc(rgb('#ffe2b8'), rgb('#ff5f9e'), clamp01((r - 1) / 2.4));
            px[0] = col[0] * I;
            px[1] = col[1] * I;
            px[2] = col[2] * I;
          },
          {
            op: 'lighter',
            alpha: 0.95,
            region: [eAz - er * 5, eAz + er * 5, eEl - er * 5, Math.min(TOP, eEl + er * 5)],
          }
        );
        additive(g, () => glowDeg(g, eAz, eEl, er * 6, t.glow, 0.15));
        g.fillStyle = '#060209';
        g.beginPath();
        g.ellipse(X(eAz), Y(eEl), er * SX, er * SY, 0, 0, TAU);
        g.fill();
        g.strokeStyle = 'rgba(255,240,215,0.95)';
        g.lineWidth = 3.5;
        g.stroke();
        additive(g, () => {
          glowDeg(g, eAz + er * 0.62, eEl + er * 0.78, 1, '#ffffff', 0.95);
          glowDeg(g, eAz + er * 0.62, eEl + er * 0.78, 3, '#ffd6a0', 0.35);
        });
        // The crown: spires encircling the stadium, a hazy far ring behind a near ring whose faces
        // catch the corona (lit face toward the sun, rim line, a small gem light at the tip).
        const spire = (az, h, { far = false } = {}) => {
          const w = (far ? 1 : 1.5) + h * 0.12,
            facing = az < eAz ? 1 : -1,
            base = ROOF - 0.5,
            tip = [az, base + h],
            shoulderL = [az - w * 0.35, base + h * 0.62],
            shoulderR = [az + w * 0.35, base + h * 0.62],
            ridge = [az + facing * w * 0.1, base];
          const litFace = far ? ['#6a2a5c', '#3a1636'] : ['#7a2e62', '#2a0f28'],
            darkFace = far ? ['#401a3c', '#2a0f28'] : ['#1e0a1e', '#10050e'];
          const faces = [
            [[az - w, base], shoulderL, tip, ridge],
            [ridge, tip, shoulderR, [az + w, base]],
          ];
          faces.forEach((face, i) => {
            const lit = (i === 0) === (facing === 1);
            g.fillStyle = vGrad(g, base + h, base, [
              [0, (lit ? litFace : darkFace)[0]],
              [1, (lit ? litFace : darkFace)[1]],
            ]);
            poly(g, face);
            g.fill();
          });
          g.strokeStyle = rgba('#ffb0d4', far ? 0.3 : 0.6);
          g.lineWidth = far ? 1.6 : 2.2;
          g.beginPath();
          g.moveTo(X(az), Y(base + h));
          g.lineTo(X(az + facing * w * 0.35), Y(base + h * 0.62));
          g.lineTo(X(az + facing * w), Y(base));
          g.stroke();
          additive(g, () => glowDeg(g, az, base + h, far ? 0.35 : 0.55, '#ffd6a0', far ? 0.45 : 0.7));
        };
        for (let az = -70; az <= 70; az += 7.5)
          if (Math.abs(az - eAz) > 6) spire(az + (rnd() - 0.5) * 2, 2.2 + rnd() * 2.2, { far: true });
        g.fillStyle = vGrad(g, ROOF + 4.5, ROOF - 0.5, [
          [0, rgba('#ff86bb', 0)],
          [1, rgba('#9a4474', 0.38)],
        ]);
        g.fillRect(0, Y(ROOF + 4.5), W, 5 * SY);
        const spires = [
          [-28, 7.2],
          [-19.5, 10],
          [-12.5, 6.4],
          [16.5, 6.6],
          [22.5, 10.2],
          [30, 7.4],
          [-41, 5.4],
          [43, 5.8],
          [-56, 4.2],
          [57, 4.4],
          [-68, 3],
          [69, 3.2],
        ];
        for (const [az, h] of spires) spire(az, h);
        g.fillStyle = vGrad(g, ROOF + 5, ROOF - 0.5, [
          [0, rgba('#ff86bb', 0)],
          [1, rgba('#b84a86', 0.42)],
        ]);
        g.fillRect(0, Y(ROOF + 5), W, 5.5 * SY);
        additive(g, () => {
          for (let i = 0; i < 40; i++)
            glowDeg(g, (rnd() - 0.5) * 70, ROOF + 5 + rnd() * 10, 0.16, '#ffd0e8', 0.6);
        });
      },
      stands: {
        back: '#2e1029',
        aisle: '#ffb0d4',
        crowdMix: 0.42,
        lit: [0.8, 1.05],
        fascia: fasciaBand({ color: '#3e1a3a', trim: '#ffc987', glowColor: '#ffb0d4', glowAlpha: 0.28 }),
        roof: roofLip({ color: '#12050f', edge: '#ffc987', lamp: '#ffd6a0', depth: 1.0, lampEvery: 3 }),
        wall: panelWall({ base: '#14060f', colors: t.led, motif: motifs.diamond, alpha: 0.45 }),
        pillar: column({ color: '#361432', edge: '#ffc987', width: 12, glowColor: '#ffb0d4' }),
      },
      masts: {
        mast: '#2a0e28',
        lamp: '#ffd6a0',
        head(g, x, y) {
          g.fillStyle = '#3e1a3a';
          g.beginPath();
          g.moveTo(x, y - 18);
          g.lineTo(x + 7, y + 2);
          g.lineTo(x - 7, y + 2);
          g.closePath();
          g.fill();
          additive(g, () => {
            glow(g, x, y - 2, 16, 16, '#ffb0d4', 0.7);
            glow(g, x, y - 2, 5, 5, '#ffffff', 0.85);
          });
        },
      },
    },
  };

  // ============================================================================================
  // Plate
  // ============================================================================================
  const arena = ARENAS[id];
  const [plate, g] = canvas(W, H);
  arena.sky(g);
  arena.landmark(g);
  masts(g, arena.masts);
  paintStands(g, arena.stands);
  // Below the floor line: the apron colour (hidden by the floor, safe at grazing angles).
  g.fillStyle = t.apron;
  g.fillRect(0, Y(FLOOR) + 3, W, H - Y(FLOOR));
  // Baked bloom: the bright pass, blurred, added back (no post-processing at runtime).
  {
    const [bright, bg] = canvas(W / 4, H / 4);
    bg.filter = 'brightness(1.6) contrast(2.2) brightness(0.55)';
    bg.drawImage(plate, 0, 0, W / 4, H / 4);
    const soft = blurCopy(bright, 5);
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = arena.bloom ?? 0.28;
    g.imageSmoothingQuality = 'high';
    g.drawImage(soft, 0, 0, W, H);
    g.restore();
  }

  // ============================================================================================
  // Court (2× supersampled disc in a square; texture x runs from the player's pad to the rival's)
  // ============================================================================================
  const CS = layout.court.size * SS,
    c0 = CS / 2,
    R = c0 * 0.985,
    PAD_D = R * 0.45;
  const [court, cg] = canvas(CS, CS);
  const courtRnd = stream('court'),
    cc = t.court;
  // Calm under the pads and the sigil: 0 there, 1 in the open court.
  const calm = (x, y) =>
    Math.min(
      smooth(PAD_D * 0.45, PAD_D * 0.8, Math.hypot(x - c0 + PAD_D, y - c0)),
      smooth(PAD_D * 0.45, PAD_D * 0.8, Math.hypot(x - c0 - PAD_D, y - c0)),
      smooth(R * 0.16, R * 0.3, Math.hypot(x - c0, y - c0))
    );
  // Base: radial falloff with a warm/cool key-light pool, then the arena material.
  {
    const base = cg.createRadialGradient(c0 * 0.92, c0 * 0.94, 0, c0, c0, R);
    base.addColorStop(0, mix(cc.a, '#ffffff', 0.06));
    base.addColorStop(0.7, mix(cc.a, cc.b, 0.55));
    base.addColorStop(1, cc.b);
    cg.fillStyle = base;
    cg.fillRect(0, 0, CS, CS);
  }
  const courtLayer = (scale, fn, op = 'source-over', alpha = 1) => {
    const n = Math.ceil(CS / scale),
      layer = raster(n, n, (x, y, px) => fn((x + 0.5) * scale, (y + 0.5) * scale, px));
    cg.save();
    cg.globalCompositeOperation = op;
    cg.globalAlpha = alpha;
    cg.imageSmoothingQuality = 'high';
    cg.drawImage(layer, 0, 0, CS, CS);
    cg.restore();
  };
  const tile = (x, y, px, value) => {
    px[0] = px[1] = px[2] = 128 + value * 127;
  };
  // Pointy-top hex grid of radius r: the cell index, the offset from its centre in radii and the
  // hexagonal edge distance (0 at the centre, 1 on the border).
  const hexCell = (x, y, r) => {
    const q = ((x * Math.sqrt(3)) / 3 - y / 3) / r,
      s = (2 * y) / 3 / r;
    let rx = Math.round(q),
      rz = Math.round(s),
      ry = Math.round(-q - s);
    const dx = Math.abs(rx - q),
      dz = Math.abs(rz - s),
      dy = Math.abs(ry + q + s);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dz > dy) rz = -rx - ry;
    const ex = (x - r * Math.sqrt(3) * (rx + rz / 2)) / r,
      ey = (y - r * 1.5 * rz) / r;
    return {
      rx,
      rz,
      ex,
      ey,
      // Distance to the nearest flat side (the cell's apothem is 0.866 r): 1 on the sides.
      edge: Math.max(Math.abs(ex), Math.abs(ex * 0.5 + ey * 0.866), Math.abs(ex * 0.5 - ey * 0.866)) / 0.866,
    };
  };
  const COURTS = {
    // Frosted ice hex tiles with bevelled facets, cyan veins and glints.
    crystal() {
      const r = 92;
      courtLayer(
        2,
        (x, y, px) => {
          const { rx, rz, ex, ey, edge } = hexCell(x, y, r),
            cellV = (hash(`${rx},${rz}`) % 1000) / 1000 - 0.5,
            frost = fbm(x * 0.006, y * 0.006, 5),
            k = calm(x, y);
          let v = cellV * 0.14 + frost * 0.16 * k;
          v -= smooth(0.84, 0.92, edge) * 0.24;
          v += smooth(0.66, 0.84, edge) * (ey + ex * 0.4 < 0 ? 0.14 : -0.1);
          tile(x, y, px, v);
        },
        'overlay'
      );
      courtLayer(
        2,
        (x, y, px) => {
          const vein = Math.max(0, 1 - Math.abs(fbm(x * 0.0028 + 3, y * 0.0028, 4)) * 40),
            I = vein * calm(x, y) * 0.8;
          px[0] = 90 * I;
          px[1] = 200 * I;
          px[2] = 255 * I;
        },
        'lighter',
        0.24
      );
      additive(cg, () => {
        for (let i = 0; i < 80; i++) {
          const x = courtRnd() * CS,
            y = courtRnd() * CS;
          if (calm(x, y) < 0.8) continue;
          glow(cg, x, y, 10, 10, '#e8f8ff', 0.35);
          cg.fillStyle = 'rgba(255,255,255,0.35)';
          cg.fillRect(x - 8, y - 0.8, 16, 1.6);
          cg.fillRect(x - 0.8, y - 8, 1.6, 16);
        }
      });
    },
    // Mossy flagstones: stones from jittered cells, moss and grass in the joints, sun dapples.
    grove() {
      const cell = 118,
        pts = new Map(),
        at = (i, j) => {
          const key = `${i},${j}`;
          if (!pts.has(key)) {
            const h = hash(key);
            pts.set(key, [
              (i + 0.2 + ((h % 997) / 997) * 0.6) * cell,
              (j + 0.2 + (((h >>> 10) % 991) / 991) * 0.6) * cell,
              h,
            ]);
          }
          return pts.get(key);
        };
      courtLayer(
        2,
        (x, y, px) => {
          const i = Math.floor(x / cell),
            j = Math.floor(y / cell);
          let d1 = 1e9,
            d2 = 1e9,
            id = 0;
          for (let a = -1; a <= 1; a++)
            for (let b = -1; b <= 1; b++) {
              const [px0, py0, h] = at(i + a, j + b),
                d = Math.hypot(x - px0, y - py0);
              if (d < d1) {
                d2 = d1;
                d1 = d;
                id = h;
              } else if (d < d2) d2 = d;
            }
          const joint = smooth(10, 3, d2 - d1),
            stoneV = ((id % 1000) / 1000 - 0.5) * 0.18,
            grain = fbm(x * 0.012, y * 0.012, 5) * 0.16,
            moss = joint + smooth(0.1, 0.45, fbm(x * 0.004 + 7, y * 0.004, 4)) * 0.6,
            k = calm(x, y);
          const stone = mixc(rgb('#8a8a62'), rgb('#6d7a4a'), 0.5 + stoneV * 2),
            mossC = mixc(rgb('#3f6a2a'), rgb('#7fa048'), clamp01(0.5 + grain * 3));
          const col = mixc(stone, mossC, clamp01(moss * (0.55 + 0.45 * k)));
          const light = 0.62 + stoneV + grain * k - joint * 0.2;
          px[0] = col[0] * light;
          px[1] = col[1] * light;
          px[2] = col[2] * light;
        },
        'soft-light',
        0.9
      );
      additive(cg, () => {
        for (let i = 0; i < 40; i++)
          glow(
            cg,
            courtRnd() * CS,
            courtRnd() * CS,
            60 + courtRnd() * 80,
            40 + courtRnd() * 50,
            '#fff0b0',
            0.07
          );
      });
      for (let i = 0; i < 140; i++) {
        const x = courtRnd() * CS,
          y = courtRnd() * CS;
        if (calm(x, y) < 0.7) continue;
        cg.fillStyle = courtRnd() < 0.5 ? 'rgba(200,150,60,0.5)' : 'rgba(120,150,60,0.5)';
        cg.beginPath();
        cg.ellipse(x, y, 7, 3.5, courtRnd() * 3, 0, TAU);
        cg.fill();
      }
    },
    // Wet stone tiles with shallow puddles: darker, glossy, a thin teal rim catching the light.
    tidal() {
      const size = 136,
        wetness = (x, y) => fbm(x * 0.0035 + 11, y * 0.0035, 4);
      courtLayer(
        2,
        (x, y, px) => {
          const row = Math.floor(y / size),
            ox = x + (row % 2) * size * 0.5,
            fx = (ox % size) / size,
            fy = (y % size) / size,
            joint = Math.max(
              smooth(0.06, 0.02, Math.min(fx, 1 - fx)),
              smooth(0.06, 0.02, Math.min(fy, 1 - fy))
            ),
            cellV = ((hash(`${Math.floor(ox / size)},${row}`) % 1000) / 1000 - 0.5) * 0.14,
            grain = fbm(x * 0.01, y * 0.01, 5) * 0.12,
            puddle = smooth(0.2, 0.3, wetness(x, y)) * calm(x, y);
          tile(
            x,
            y,
            px,
            cellV * (1 - puddle) + grain * (1 - puddle * 0.7) - joint * 0.3 * (1 - puddle) - puddle * 0.22
          );
        },
        'overlay'
      );
      courtLayer(
        2,
        (x, y, px) => {
          const n = wetness(x, y),
            rim = smooth(0.17, 0.2, n) * smooth(0.25, 0.2, n),
            sheen = smooth(0.2, 0.34, n) * (0.5 + 0.5 * noise(x * 0.006, y * 0.02)),
            I = (rim * 0.3 + sheen * 0.3) * calm(x, y);
          px[0] = 70 * I;
          px[1] = 190 * I;
          px[2] = 200 * I;
        },
        'lighter',
        0.55
      );
      for (let i = 0; i < 70; i++) {
        const x = courtRnd() * CS,
          y = courtRnd() * CS;
        if (calm(x, y) < 0.8) continue;
        cg.fillStyle = 'rgba(212,253,255,0.24)';
        cg.beginPath();
        cg.arc(x, y, 3 + courtRnd() * 4, Math.PI, TAU);
        cg.fill();
      }
    },
    // Basalt columns; a few joints glow with lava in the outer ring, away from the pads and
    // the sigil; ash dusting.
    volcano() {
      const r = 78,
        warp = (x, y) => [x + 10 * noise(x * 0.01, y * 0.01), y + 10 * noise(x * 0.01 + 5, y * 0.01)];
      courtLayer(
        2,
        (x, y, px) => {
          const [jx, jy] = warp(x, y),
            { rx, rz, ey, edge } = hexCell(jx, jy, r),
            cellV = ((hash(`${rx}|${rz}`) % 1000) / 1000 - 0.5) * 0.16,
            grain = ridged(x * 0.01, y * 0.01, 4) * 0.12;
          const v =
            cellV +
            grain -
            0.2 -
            smooth(0.78, 0.9, edge) * 0.3 +
            (ey < -0.5 ? 0.05 : 0) * smooth(0.6, 0.8, edge);
          tile(x, y, px, v);
        },
        'overlay'
      );
      courtLayer(
        2,
        (x, y, px) => {
          const [jx, jy] = warp(x, y),
            { edge } = hexCell(jx, jy, r),
            ring =
              smooth(R * 0.5, R * 0.62, Math.hypot(x - c0, y - c0)) *
              smooth(R * 0.92, R * 0.84, Math.hypot(x - c0, y - c0)),
            hot = smooth(0.08, 0.28, fbm(x * 0.0022 + 4, y * 0.0022, 3)) * ring * calm(x, y),
            I = smooth(0.9, 0.98, edge) * hot;
          px[0] = 255 * I;
          px[1] = 110 * I;
          px[2] = 40 * I;
        },
        'lighter',
        0.9
      );
      courtLayer(4, (x, y, px) => {
        const a = smooth(0.15, 0.5, fbm(x * 0.005 + 2, y * 0.005, 4));
        px[0] = 190;
        px[1] = 170;
        px[2] = 160;
        px[3] = 255 * a * 0.12;
      });
    },
    // Midnight lapis with gold flecks, orbit rings and constellation inlays.
    astral() {
      courtLayer(
        2,
        (x, y, px) => {
          const n = fbm(x * 0.004, y * 0.004, 5),
            fleck = Math.max(0, noise(x * 0.09, y * 0.09)) ** 6;
          tile(x, y, px, n * 0.16 + fleck * 0.5);
        },
        'overlay'
      );
      cg.lineWidth = 3;
      for (let i = 0; i < 9; i++) {
        cg.strokeStyle = rgba(cc.line, 0.12 + (i % 3 === 0 ? 0.08 : 0));
        cg.beginPath();
        const rr = R * (0.36 + i * 0.07),
          a0 = courtRnd() * TAU;
        cg.arc(c0, c0, rr, a0, a0 + 1.8 + courtRnd() * 2.6);
        cg.stroke();
        const a = a0 + 0.9;
        cg.fillStyle = rgba(cc.line, 0.5);
        cg.beginPath();
        cg.arc(c0 + Math.cos(a) * rr, c0 + Math.sin(a) * rr, 5, 0, TAU);
        cg.fill();
      }
      for (let k = 0; k < 9; k++) {
        let x = courtRnd() * CS,
          y = courtRnd() * CS;
        const pts = [[x, y]];
        for (let s = 0; s < 4; s++)
          pts.push([(x += (courtRnd() - 0.5) * 260), (y += (courtRnd() - 0.5) * 260)]);
        if (pts.some(([a, b]) => calm(a, b) < 0.9)) continue;
        cg.strokeStyle = rgba(cc.line, 0.24);
        cg.lineWidth = 2.5;
        cg.beginPath();
        pts.forEach(([a, b], i) => (i ? cg.lineTo(a, b) : cg.moveTo(a, b)));
        cg.stroke();
        additive(cg, () => {
          for (const [a, b] of pts) {
            glow(cg, a, b, 14, 14, cc.line, 0.45);
            glow(cg, a, b, 4, 4, '#ffffff', 0.7);
          }
        });
      }
      for (let i = 0; i < 900; i++) {
        cg.fillStyle = `rgba(255,255,255,${0.05 + courtRnd() * 0.15})`;
        cg.fillRect(courtRnd() * CS, courtRnd() * CS, 2.5, 2.5);
      }
    },
    // Dark rose marble with gold veins in large polished slabs.
    eclipse() {
      const slab = 256,
        veinAt = (x, y) => {
          const wx = x * 0.0024 + 1.6 * fbm(x * 0.002, y * 0.002, 4),
            wy = y * 0.0024 + 1.6 * fbm(x * 0.002 + 4, y * 0.002 + 4, 4);
          return smooth(0.07, 0, Math.abs(Math.sin((wx + wy) * 7 + fbm(wx * 2, wy * 2, 3) * 4)));
        };
      courtLayer(
        2,
        (x, y, px) => {
          const cloud = fbm(x * 0.003 + 9, y * 0.003, 4),
            fx = (x % slab) / slab,
            fy = (y % slab) / slab,
            joint = Math.max(
              smooth(0.012, 0.003, Math.min(fx, 1 - fx)),
              smooth(0.012, 0.003, Math.min(fy, 1 - fy))
            );
          tile(x, y, px, cloud * 0.2 + veinAt(x, y) * 0.12 - joint * 0.25);
        },
        'overlay'
      );
      courtLayer(2, (x, y, px) => {
        const I = veinAt(x, y) * calm(x, y) * 0.8;
        px[0] = 255;
        px[1] = 200;
        px[2] = 135;
        px[3] = 255 * I * 0.22;
      });
      // Sun-ring inlay around the sigil.
      cg.strokeStyle = rgba(cc.line, 0.3);
      for (const [rr, w] of [
        [R * 0.36, 5],
        [R * 0.4, 2],
      ]) {
        cg.lineWidth = w;
        cg.beginPath();
        cg.arc(c0, c0, rr, 0, TAU);
        cg.stroke();
      }
      cg.fillStyle = rgba(cc.line, 0.2);
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU;
        cg.save();
        cg.translate(c0 + Math.cos(a) * R * 0.43, c0 + Math.sin(a) * R * 0.43);
        cg.rotate(a);
        cg.fillRect(0, -3, i % 2 ? 26 : 44, 6);
        cg.restore();
      }
    },
  };
  cg.save();
  cg.beginPath();
  cg.arc(c0, c0, R, 0, TAU);
  cg.clip();
  COURTS[id]();
  cg.restore();

  // Markings: engraved grooves (a dark offset under a lit inlay), then the arena sigil.
  const inlay = (drawPath, width, alpha, glowAlpha = 0.25) => {
    cg.save();
    cg.translate(1.5, 2.5);
    cg.strokeStyle = 'rgba(0,0,0,0.45)';
    cg.lineWidth = width + 3;
    drawPath();
    cg.stroke();
    cg.restore();
    cg.strokeStyle = rgba(cc.line, alpha);
    cg.lineWidth = width;
    drawPath();
    cg.stroke();
    additive(cg, () => {
      cg.strokeStyle = rgba(t.glow, glowAlpha);
      cg.lineWidth = width * 3;
      cg.filter = 'blur(6px)';
      drawPath();
      cg.stroke();
      cg.filter = 'none';
    });
  };
  const ring = (rr) => () => {
    cg.beginPath();
    cg.arc(c0, c0, rr, 0, TAU);
  };
  inlay(ring(R * 0.93), 16, 0.78);
  inlay(ring(R * 0.87), 5, 0.34, 0.1);
  inlay(
    () => {
      cg.beginPath();
      cg.moveTo(c0, c0 - R * 0.93);
      cg.lineTo(c0, c0 - 300);
      cg.moveTo(c0, c0 + 300);
      cg.lineTo(c0, c0 + R * 0.93);
    },
    11,
    0.5,
    0.15
  );
  for (const side of [-1, 1])
    inlay(
      () => {
        cg.beginPath();
        cg.arc(c0 + side * R * 0.5, c0, R * 0.2, 0, TAU);
      },
      5,
      0.28,
      0.08
    );
  // The arena's own emblem: six rhombi pointing outward around a hexagon ring (original design).
  {
    const r = 276;
    cg.save();
    cg.translate(c0, c0);
    additive(cg, () => glow(cg, 0, 0, r * 1.25, r * 1.25, t.glow, 0.16));
    const circle = (rr) => () => {
      cg.beginPath();
      cg.arc(0, 0, rr, 0, TAU);
    };
    const stroke = (fn, width, color) => {
      cg.save();
      cg.translate(1.5, 2.5);
      cg.strokeStyle = 'rgba(0,0,0,0.45)';
      cg.lineWidth = width + 3;
      fn();
      cg.stroke();
      cg.restore();
      cg.strokeStyle = color;
      cg.lineWidth = width;
      fn();
      cg.stroke();
    };
    stroke(circle(r), 11, rgba(cc.line, 0.65));
    stroke(circle(r * 1.12), 4, rgba(cc.line, 0.3));
    stroke(
      () => {
        cg.beginPath();
        for (let k = 0; k <= 6; k++) {
          const a = (k / 6) * TAU;
          k ? cg.lineTo(Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36) : cg.moveTo(r * 0.36, 0);
        }
      },
      6,
      rgba(t.glow, 0.6)
    );
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + Math.PI / 6,
        ca = Math.cos(a),
        sa = Math.sin(a),
        inner = r * 0.44,
        outer = r * 0.9,
        half = r * 0.1,
        mid = (inner + outer) / 2;
      const rhomb = () => {
        cg.beginPath();
        cg.moveTo(ca * outer, sa * outer);
        cg.lineTo(ca * mid - sa * half, sa * mid + ca * half);
        cg.lineTo(ca * inner, sa * inner);
        cg.lineTo(ca * mid + sa * half, sa * mid - ca * half);
        cg.closePath();
      };
      cg.save();
      cg.translate(2, 3);
      cg.fillStyle = 'rgba(0,0,0,0.4)';
      rhomb();
      cg.fill();
      cg.restore();
      const grd = cg.createLinearGradient(ca * inner, sa * inner, ca * outer, sa * outer);
      grd.addColorStop(0, rgba(i % 2 ? cc.line : t.glow, 0.45));
      grd.addColorStop(1, rgba(i % 2 ? cc.line : t.glow, 0.7));
      cg.fillStyle = grd;
      rhomb();
      cg.fill();
      const b = a + Math.PI / 6;
      cg.fillStyle = rgba(cc.line, 0.55);
      cg.beginPath();
      cg.arc(Math.cos(b) * r * 0.78, Math.sin(b) * r * 0.78, 9, 0, TAU);
      cg.fill();
    }
    cg.fillStyle = rgba(cc.line, 0.9);
    cg.beginPath();
    cg.arc(0, 0, r * 0.12, 0, TAU);
    cg.fill();
    additive(cg, () => glow(cg, 0, 0, r * 0.3, r * 0.3, t.glow, 0.35));
    cg.restore();
  }
  // Edge occlusion toward the apron.
  {
    const ao = cg.createRadialGradient(c0, c0, R * 0.74, c0, c0, R);
    ao.addColorStop(0, 'rgba(0,0,0,0)');
    ao.addColorStop(1, 'rgba(0,0,0,0.5)');
    cg.fillStyle = ao;
    cg.fillRect(0, 0, CS, CS);
  }

  // Downsample (supersampling) and encode.
  const encode = (src, w, h) => {
    const [c, g2] = canvas(w, h);
    g2.imageSmoothingEnabled = true;
    g2.imageSmoothingQuality = 'high';
    g2.drawImage(src, 0, 0, w, h);
    return c.toDataURL('image/webp', quality);
  };
  return {
    plate: encode(plate, L.width, L.height),
    court: encode(court, layout.court.size, layout.court.size),
  };
}

// ---------------------------------------------------------------------------------------------
// Node: bake, write, record provenance.
// ---------------------------------------------------------------------------------------------
const manifestPath = path.join(OUT, 'manifest.json');
let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch {
  manifest = { arenas: {} };
}
const browser = await chromium.launch();
const page = await browser.newPage();
const date = new Date().toISOString().slice(0, 10);
try {
  for (const id of ids) {
    const brief = JSON.parse(await readFile(path.join(BRIEFS, `${id}.json`), 'utf8'));
    const started = performance.now();
    const images = await page.evaluate(paintArena, {
      id,
      theme: THEMES[id],
      layout: LAYOUT,
      seed: brief.seed,
      quality: WEBP_QUALITY,
    });
    await mkdir(path.join(OUT, id), { recursive: true });
    const entry = {
      title: brief.title,
      brief: path.posix.join('art/arena-briefs', `${id}.json`),
      seed: brief.seed,
      prompt: { style: brief.style, plate: brief.plate, court: brief.court },
      date,
      units: 0,
    };
    for (const name of ['plate', 'court']) {
      const bytes = Buffer.from(images[name].slice(images[name].indexOf(',') + 1), 'base64');
      if (bytes.toString('latin1', 8, 12) !== 'WEBP')
        throw new Error(`${id}/${name}: Chromium did not encode WebP`);
      await writeFile(path.join(OUT, id, `${name}.webp`), bytes);
      const size = name === 'plate' ? [PLATE_W, PLATE_H] : [COURT_SIZE, COURT_SIZE];
      entry[name] = {
        file: `${id}/${name}.webp`,
        width: size[0],
        height: size[1],
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }
    manifest.arenas[id] = entry;
    console.log(
      `${id}: plate ${(entry.plate.bytes / 1024).toFixed(1)} KB, court ${(entry.court.bytes / 1024).toFixed(1)} KB (${((performance.now() - started) / 1000).toFixed(1)} s)`
    );
  }
} finally {
  await browser.close();
}
manifest = {
  generator: {
    method: 'offline-bake',
    tool: 'tools/generate-arena-plates.mjs',
    renderer: `Chromium ${browser.version()} (Playwright), Canvas 2D, 2× supersampled`,
    encoder: `Chromium WebP, quality ${WEBP_QUALITY}`,
    units: 0,
  },
  layout: LAYOUT,
  arenas: Object.fromEntries(
    THEME_IDS.filter((id) => manifest.arenas[id]).map((id) => [id, manifest.arenas[id]])
  ),
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
