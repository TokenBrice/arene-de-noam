import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// Performance contract for stylesheets (plan §1: compositor-only animation, no
// blur/backdrop/filters on or over the WebGL canvas). Pure static analysis.

const STYLES = new URL('../styles/', import.meta.url).pathname;

// Keyframes allowed to animate a non-compositor property. Name -> one-line rationale.
const KEYFRAME_ALLOWLIST = {};

const LAYOUT_PAINT_PROPERTY =
  /^(top|left|right|bottom|width|height|margin(-.+)?|padding(-.+)?|inset(-.+)?|box-shadow|border(-.+)?|clip-path|background(-.+)?)$/;
const HEAVY_FILTER_VALUE = /blur|drop-shadow/;
const CANVAS_SUBJECT = /(^|[^\w-])(\.arena-canvas|#arena)(?![\w-])/;

function cssFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return cssFiles(full);
    return name.endsWith('.css') ? [full] : [];
  });
}

function stripNoise(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
}

// Split `text` into top-level `prelude { body }` blocks (and body-less statements).
function blocks(text) {
  const out = [];
  let depth = 0,
    start = 0,
    bodyStart = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') {
      if (depth++ === 0) bodyStart = i + 1;
    } else if (c === '}') {
      if (--depth === 0) {
        out.push({ prelude: text.slice(start, bodyStart - 1).trim(), body: text.slice(bodyStart, i) });
        start = i + 1;
      }
    } else if (c === ';' && depth === 0) start = i + 1;
  }
  return out;
}

function declarations(body) {
  return body
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const colon = d.indexOf(':');
      return colon < 0
        ? null
        : { prop: d.slice(0, colon).trim().toLowerCase(), value: d.slice(colon + 1).trim() };
    })
    .filter(Boolean);
}

function analyze(file, css) {
  const violations = [];
  const walk = (text) => {
    for (const { prelude, body } of blocks(text)) {
      if (/^@keyframes\b|^@-webkit-keyframes\b/.test(prelude)) {
        const name = prelude.replace(/^@\S+\s+/, '').trim();
        if (name in KEYFRAME_ALLOWLIST) continue;
        for (const frame of blocks(body))
          for (const { prop, value } of declarations(frame.body)) {
            if (LAYOUT_PAINT_PROPERTY.test(prop))
              violations.push(`${file}: @keyframes ${name} animates "${prop}" (${frame.prelude})`);
            else if ((prop === 'filter' || prop === 'backdrop-filter') && HEAVY_FILTER_VALUE.test(value))
              violations.push(`${file}: @keyframes ${name} animates ${prop}: ${value} (${frame.prelude})`);
          }
      } else if (prelude.startsWith('@')) {
        if (/^@(media|supports|layer|container|scope|document)\b/.test(prelude)) walk(body);
      } else {
        const canvasRule = prelude.split(',').some((sel) =>
          CANVAS_SUBJECT.test(
            ` ${sel
              .trim()
              .split(/\s*[>+~]\s*|\s+/)
              .pop()}`
          )
        );
        if (!canvasRule) continue;
        for (const { prop, value } of declarations(body))
          if ((prop === 'filter' || prop === 'backdrop-filter') && !/^(none|unset|initial)$/i.test(value))
            violations.push(`${file}: "${prelude}" applies ${prop}: ${value} to the arena canvas`);
      }
    }
  };
  walk(stripNoise(css));
  return violations;
}

test('stylesheets animate only compositor-friendly properties and never filter the arena canvas', () => {
  const files = cssFiles(STYLES);
  assert.ok(files.length > 0, 'no stylesheets found');
  const violations = files.flatMap((f) => analyze(path.relative(STYLES, f), readFileSync(f, 'utf8')));
  assert.deepEqual(violations, []);
});

test('the analyzer flags each forbidden pattern', () => {
  const bad = `
    @media (min-width: 1px) { @keyframes a { 0% { left: 0 } 100% { left: 5px; transform: none } } }
    @keyframes b { from { box-shadow: 0 0 1px red } to { filter: drop-shadow(0 0 2px red) } }
    @keyframes c { 50% { opacity: 1; transform: scale(1.1); filter: brightness(1.2) } }
    .x #arena, .y { backdrop-filter: blur(4px) }
    .arena-canvas { filter: none; }
    .wrap .arena-canvas:hover { filter: saturate(2) }
  `;
  const found = analyze('t.css', bad);
  assert.equal(found.length, 6);
  assert.ok(found.some((v) => /@keyframes a animates "left"/.test(v)));
  assert.ok(found.some((v) => /@keyframes b animates "box-shadow"/.test(v)));
  assert.ok(found.some((v) => /@keyframes b animates filter/.test(v)));
  assert.ok(found.some((v) => /backdrop-filter: blur\(4px\)/.test(v)));
  assert.ok(found.some((v) => /saturate\(2\)/.test(v)));
});
