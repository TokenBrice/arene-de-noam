import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CREATURES } from '../src/data/creatures.js';
import { SPRITE_CANVAS, SPRITE_METRICS } from '../src/data/sprite-metrics.js';
import { decodePng } from '../tools/normalize-sprites.mjs';

const ids = Object.keys(CREATURES).sort();

test('every creature has sprite metrics and no metrics exist for unknown creatures', () => {
  assert.deepEqual(Object.keys(SPRITE_METRICS).sort(), ids);
});

for (const id of ids) {
  test(`${id} battle sprite: binary alpha, ≤ 100 colours, feet on row 125, metrics match`, async () => {
    const { width, height, rgba } = decodePng(await readFile(`assets/monsters/${id}/battle.png`));
    assert.equal(width, SPRITE_CANVAS);
    assert.equal(height, SPRITE_CANVAS);
    const colours = new Set();
    let [x0, y0, x1, y1] = [width, height, -1, -1];
    for (let i = 0; i < width * height; i += 1) {
      const alpha = rgba[i * 4 + 3];
      assert.ok(alpha === 0 || alpha === 255, `pixel ${i} has alpha ${alpha}`);
      if (alpha === 0) continue;
      colours.add((rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2]);
      const x = i % width;
      const y = Math.floor(i / width);
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }
    assert.ok(colours.size <= 100, `${colours.size} colours`);
    assert.ok(Math.abs(y1 - 125) <= 1, `lowest opaque row ${y1}`);
    assert.deepEqual(SPRITE_METRICS[id].bbox, [x0, y0, x1, y1]);
    assert.equal(SPRITE_METRICS[id].footRow, y1);
  });
}

// Chromatiques (GAME-11) are palette swaps: the same silhouette texel for texel (so SPRITE_METRICS
// serve both files), within the colour budget, and visibly recoloured.
for (const id of ids) {
  test(`${id} Chromatique: same mask as the battle sprite, ≤ 100 colours, recoloured`, async () => {
    const base = decodePng(await readFile(`assets/monsters/${id}/battle.png`));
    const shiny = decodePng(await readFile(`assets/monsters/${id}/battle-shiny.png`));
    assert.equal(shiny.width, base.width);
    assert.equal(shiny.height, base.height);
    const colours = new Set();
    let opaque = 0;
    let changed = 0;
    for (let i = 0; i < base.width * base.height; i += 1) {
      const o = i * 4;
      assert.equal(shiny.rgba[o + 3], base.rgba[o + 3], `pixel ${i} alpha differs`);
      if (base.rgba[o + 3] === 0) continue;
      opaque += 1;
      colours.add((shiny.rgba[o] << 16) | (shiny.rgba[o + 1] << 8) | shiny.rgba[o + 2]);
      if ([0, 1, 2].some((c) => Math.abs(shiny.rgba[o + c] - base.rgba[o + c]) > 12)) changed += 1;
    }
    assert.ok(colours.size <= 100, `${colours.size} colours`);
    assert.ok(changed / opaque >= 0.2, `only ${Math.round((100 * changed) / opaque)} % of texels recoloured`);
  });
}
