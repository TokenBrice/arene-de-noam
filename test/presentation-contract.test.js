import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MOVES } from '../src/data/moves.js';

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
