// Dev-only: builds fonts/sparkle.woff, a one-glyph font for U+2726 (✦) drawn
// from the chrome `sparkle` icon (src/app/icons.js), so the ✦ in body copy
// matches the icon instead of falling back to a system font (Baloo 2 and Nunito
// ship Latin subsets). styles/tokens.css registers it with unicode-range
// U+2726 inside both font stacks. Never imported by the game at runtime.
//
//   npm install --prefix agents/font-tools opentype.js@1
//   node tools/build-sparkle-font.mjs
//
// OPENTYPE_JS overrides the path to opentype.js's ES module build.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import { iconSpriteMarkup } from '../src/app/icons.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'fonts/sparkle.woff');
const OPENTYPE =
  process.env.OPENTYPE_JS ??
  path.join(ROOT, 'agents/font-tools/node_modules/opentype.js/dist/opentype.module.js');

// Icon grid → font units. The icon's 15-unit star becomes a 720-unit glyph (a
// Nunito capital is 705) centred on y = 350, half a capital above the baseline.
const UNITS_PER_EM = 1000;
const SCALE = 48;
const CENTER_Y = 350;
const SIDE_BEARING = 60;
// Open strokes keep the icon's 2.2 stroke (`.ico` in styles/base.css) with round caps.
const STROKE = 2.2;
const KAPPA = 0.5523;

// --- SVG path → contours ----------------------------------------------------
// Supports the commands the icon uses (M L H V C, absolute and relative, Z).
// A contour is { closed, segments: [{ type: 'L' | 'C', points: [[x, y]…] }] }.
function parsePath(d) {
  const tokens = d.match(/[MLHVCZmlhvcz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g);
  const contours = [];
  let command = null,
    index = 0,
    x = 0,
    y = 0,
    contour = null;
  const number = () => Number(tokens[index++]);
  while (index < tokens.length) {
    if (/[a-z]/i.test(tokens[index])) command = tokens[index++];
    const relative = command === command.toLowerCase();
    const ox = relative ? x : 0,
      oy = relative ? y : 0;
    switch (command.toUpperCase()) {
      case 'M':
        x = ox + number();
        y = oy + number();
        contour = { closed: false, start: [x, y], segments: [] };
        contours.push(contour);
        command = relative ? 'l' : 'L';
        break;
      case 'L':
        x = ox + number();
        y = oy + number();
        contour.segments.push({ type: 'L', points: [[x, y]] });
        break;
      case 'H':
        x = ox + number();
        contour.segments.push({ type: 'L', points: [[x, y]] });
        break;
      case 'V':
        y = oy + number();
        contour.segments.push({ type: 'L', points: [[x, y]] });
        break;
      case 'C': {
        const points = [0, 1, 2].map(() => [ox + number(), oy + number()]);
        contour.segments.push({ type: 'C', points });
        [x, y] = points[2];
        break;
      }
      case 'Z':
        contour.closed = true;
        [x, y] = contour.start;
        break;
      default:
        throw new Error(`sparkle font: unsupported path command ${command}`);
    }
  }
  return contours;
}

// A straight open stroke becomes a capsule: two sides and two round caps.
function capsule([ax, ay], [bx, by], radius) {
  const length = Math.hypot(bx - ax, by - ay),
    ux = (bx - ax) / length,
    uy = (by - ay) / length,
    nx = -uy * radius,
    ny = ux * radius,
    k = KAPPA * radius;
  const cap = (cx, cy, dx, dy, fromX, fromY, toX, toY) => {
    const tipX = cx + dx * radius,
      tipY = cy + dy * radius;
    return [
      {
        type: 'C',
        points: [
          [fromX + dx * k, fromY + dy * k],
          [tipX + (fromX - cx) * KAPPA, tipY + (fromY - cy) * KAPPA],
          [tipX, tipY],
        ],
      },
      {
        type: 'C',
        points: [
          [tipX + (toX - cx) * KAPPA, tipY + (toY - cy) * KAPPA],
          [toX + dx * k, toY + dy * k],
          [toX, toY],
        ],
      },
    ];
  };
  return {
    closed: true,
    start: [ax + nx, ay + ny],
    segments: [
      { type: 'L', points: [[bx + nx, by + ny]] },
      ...cap(bx, by, ux, uy, bx + nx, by + ny, bx - nx, by - ny),
      { type: 'L', points: [[ax - nx, ay - ny]] },
      ...cap(ax, ay, -ux, -uy, ax - nx, ay - ny, ax + nx, ay + ny),
    ],
  };
}

function outlines(contours) {
  return contours.flatMap((contour) => {
    if (contour.closed) return [contour];
    const points = [contour.start, ...contour.segments.map((segment) => segment.points.at(-1))];
    if (contour.segments.some((segment) => segment.type !== 'L'))
      throw new Error('sparkle font: only straight open strokes are supported');
    return points.slice(1).map((point, i) => capsule(points[i], point, STROKE / 2));
  });
}

// Signed area in font space (y up) from the on-curve points; nonzero filling
// needs every contour to wind the same way.
function area(contour) {
  const points = [contour.start, ...contour.segments.map((segment) => segment.points.at(-1))].map(toFont);
  return points.reduce((sum, [x1, y1], i) => {
    const [x2, y2] = points[(i + 1) % points.length];
    return sum + (x1 * y2 - x2 * y1);
  }, 0);
}

let minX = 0;
const toFont = ([x, y]) => [
  Math.round(SIDE_BEARING + (x - minX) * SCALE),
  Math.round(CENTER_Y + (12 - y) * SCALE),
];

function reverse(contour) {
  const nodes = [contour.start, ...contour.segments.map((segment) => segment.points.at(-1))];
  const segments = [];
  for (let i = contour.segments.length - 1; i >= 0; i--) {
    const segment = contour.segments[i],
      to = nodes[i];
    segments.push(
      segment.type === 'C'
        ? { type: 'C', points: [segment.points[1], segment.points[0], to] }
        : { type: 'L', points: [to] }
    );
  }
  return { closed: true, start: nodes.at(-1), segments };
}

// opentype.js stamps head.modified with the current time; pin it to
// head.created so the committed font rebuilds byte for byte, then refresh the
// head checksum and the whole-font checkSumAdjustment.
function pinModified(otf) {
  const view = new DataView(otf.buffer, otf.byteOffset, otf.byteLength);
  const sum = (offset, length) => {
    let total = 0;
    for (let i = 0; i < length; i += 4) total = (total + view.getUint32(offset + i)) >>> 0;
    return total;
  };
  const numTables = view.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    if (String.fromCharCode(...otf.subarray(record, record + 4)) !== 'head') continue;
    const head = view.getUint32(record + 8);
    otf.copyWithin(head + 28, head + 20, head + 28);
    view.setUint32(head + 8, 0);
    view.setUint32(record + 4, sum(head, (view.getUint32(record + 12) + 3) & ~3));
    view.setUint32(head + 8, (0xb1b0afba - sum(0, otf.byteLength)) >>> 0);
    return otf;
  }
  throw new Error('sparkle font: no head table');
}

// --- WOFF 1.0 wrapper (zlib per table) ---------------------------------------
function toWoff(otf) {
  const view = new DataView(otf.buffer, otf.byteOffset, otf.byteLength);
  const numTables = view.getUint16(4);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    const offset = view.getUint32(record + 8),
      length = view.getUint32(record + 12),
      data = otf.subarray(offset, offset + length),
      compressed = zlib.deflateSync(data, { level: 9 });
    tables.push({
      tag: otf.subarray(record, record + 4),
      checksum: view.getUint32(record + 4),
      length,
      data: compressed.length < length ? compressed : data,
    });
  }
  const pad = (n) => (n + 3) & ~3;
  const headerSize = 44 + 20 * numTables;
  const total = headerSize + tables.reduce((sum, table) => sum + pad(table.data.length), 0);
  const out = Buffer.alloc(total);
  out.write('wOFF', 0, 'latin1');
  out.writeUInt32BE(view.getUint32(0), 4);
  out.writeUInt32BE(total, 8);
  out.writeUInt16BE(numTables, 12);
  out.writeUInt32BE(12 + 16 * numTables + tables.reduce((sum, table) => sum + pad(table.length), 0), 16);
  out.writeUInt16BE(1, 20);
  let offset = headerSize;
  tables.forEach((table, i) => {
    const entry = 44 + i * 20;
    out.set(table.tag, entry);
    out.writeUInt32BE(offset, entry + 4);
    out.writeUInt32BE(table.data.length, entry + 8);
    out.writeUInt32BE(table.length, entry + 12);
    out.writeUInt32BE(table.checksum, entry + 16);
    out.set(table.data, offset);
    offset += pad(table.data.length);
  });
  return out;
}

// --- Build ------------------------------------------------------------------
const symbol = iconSpriteMarkup().match(/<symbol id="i-sparkle"[^>]*>(.*?)<\/symbol>/)?.[1];
if (!symbol) throw new Error('sparkle font: no sparkle icon in src/app/icons.js');
const contours = outlines([...symbol.matchAll(/ d="([^"]+)"/g)].flatMap((match) => parsePath(match[1])));
const xs = contours
  .flatMap((contour) => [contour.start, ...contour.segments.flatMap((s) => s.points)])
  .map(([x]) => x);
minX = Math.min(...xs);
const advanceWidth = Math.round(SIDE_BEARING * 2 + (Math.max(...xs) - minX) * SCALE);

const { default: opentype } = await import(pathToFileURL(OPENTYPE).href).catch(() => {
  throw new Error(`sparkle font: opentype.js not found at ${OPENTYPE} (see the header of this script)`);
});
const glyphPath = new opentype.Path();
for (const contour of contours.map((c) => (area(c) < 0 ? reverse(c) : c))) {
  glyphPath.moveTo(...toFont(contour.start));
  for (const segment of contour.segments) {
    const points = segment.points.map(toFont);
    if (segment.type === 'L') glyphPath.lineTo(...points[0]);
    else glyphPath.curveTo(...points[0], ...points[1], ...points[2]);
  }
  glyphPath.close();
}
const font = new opentype.Font({
  familyName: 'Arene Sparkle',
  styleName: 'Regular',
  unitsPerEm: UNITS_PER_EM,
  ascender: 1011,
  descender: -353,
  createdTimestamp: Date.UTC(2026, 0, 1) / 1000,
  glyphs: [
    new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 500, path: new opentype.Path() }),
    new opentype.Glyph({ name: 'uni2726', unicode: 0x2726, advanceWidth, path: glyphPath }),
  ],
});
const woff = toWoff(pinModified(new Uint8Array(font.toArrayBuffer())));
await writeFile(OUT, woff);
console.log(`${path.relative(ROOT, OUT)}: ${woff.length} bytes, advance ${advanceWidth}/${UNITS_PER_EM}`);
