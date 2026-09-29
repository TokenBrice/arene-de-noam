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
