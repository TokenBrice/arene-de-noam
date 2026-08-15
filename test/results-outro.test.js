import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/screens/results.js', import.meta.url), 'utf8');

test('tutorial completion waits for the battle outro while retaining the fast path', () => {
  assert.match(source, /async function finishBattle\(\)/);
  const tutorialBranch = source.match(/if \(ctx\.battleSession\.mode === 'tutorial'\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.match(tutorialBranch, /if \(ctx\.save\.reducedMotion \|\| testAnimationScale === 0\)/);
  assert.match(tutorialBranch, /await battleOutroFx\(state\)/);
  assert.match(tutorialBranch, /await battleOutroFx\(state\)[\s\S]*setTimeout\(completeTutorial/);
});
