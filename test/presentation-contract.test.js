import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MOVES } from '../src/data/moves.js';

test('all seventy-two moves have authored, move-specific animation choreography', async () => {
  const css = await readFile(new URL('../styles/game.css', import.meta.url), 'utf8');
  for (const moveId of Object.keys(MOVES))
    assert.match(
      css,
      new RegExp(`\\.move-${moveId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
      `${moveId} needs its own animation selector`
    );
});
