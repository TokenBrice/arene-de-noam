import test from 'node:test';
import assert from 'node:assert/strict';
import { battleAdviceKeys } from '../src/data/advice.js';

test('post-defeat coaching prioritizes observed tactical leaks', () => {
  const state = {
    turn: 9,
    aceTriggered: true,
    history: [
      { type: 'move-start', side: 'player', moveId: 'lucid_arc' },
      ...Array.from({ length: 4 }, () => ({
        type: 'damage',
        sourceSide: 'player',
        affinity: 0.5,
        combo: [],
      })),
      { type: 'status', side: 'player', applied: true },
      { type: 'status', side: 'player', applied: true },
    ],
  };
  assert.deepEqual(battleAdviceKeys(state, false), ['ace', 'affinity']);
  assert.deepEqual(battleAdviceKeys(state, true), []);
});

test('post-defeat coaching always has a deterministic fallback', () => {
  assert.deepEqual(battleAdviceKeys({ turn: 2, aceTriggered: false, history: [] }, false), ['tempo']);
});
