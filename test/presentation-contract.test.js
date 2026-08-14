import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MOVES } from '../src/data/moves.js';
import { AFFINITIES, AFFINITY_ORDER } from '../src/data/affinities.js';
import { STATUS_DEFINITIONS } from '../src/battle/statuses.js';

test('all six types have unique original SVG geometry and the settled accessible palette', () => {
  const expectedColors = {
    flame: '#FF6B4A',
    tide: '#4DA6FF',
    grove: '#55C878',
    force: '#F2B84B',
    mind: '#E879C6',
    shadow: '#9B8CFF',
  };
  const paths = AFFINITY_ORDER.map((id) => AFFINITIES[id].iconPath);
  const statusColors = new Set(
    Object.values(STATUS_DEFINITIONS).map(({ color }) => color.toUpperCase())
  );
  assert.equal(new Set(paths).size, 6);
  for (const id of AFFINITY_ORDER) {
    assert.ok(AFFINITIES[id].iconPath.length > 30, `${id} needs authored SVG geometry`);
    assert.equal(AFFINITIES[id].color, expectedColors[id]);
    assert.equal(statusColors.has(AFFINITIES[id].color.toUpperCase()), false);
    assert.equal('icon' in AFFINITIES[id], false, `${id} must not fall back to a text glyph`);
  }
});

test('all seventy-two moves have authored, move-specific animation choreography', async () => {
  const root = new URL('../', import.meta.url);
  const index = await readFile(new URL('index.html', root), 'utf8');
  const stylesheets = [...index.matchAll(/href="(\.\/styles\/[^"?]+\.css)(?:\?[^"\s]*)?"/g)].map(
    (match) => match[1]
  );
  const css = (
    await Promise.all(stylesheets.map((stylesheet) => readFile(new URL(stylesheet, root), 'utf8')))
  ).join('\n');
  for (const moveId of Object.keys(MOVES))
    assert.match(
      css,
      new RegExp(`\\.move-${moveId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
      `${moveId} needs its own animation selector`
    );
});
