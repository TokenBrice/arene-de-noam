import test from 'node:test';
import assert from 'node:assert/strict';
import { AFFINITY_ORDER, affinityMultiplier } from '../src/data/affinities.js';
import { calculateDamage } from '../src/battle/damage.js';
import { MOVES } from '../src/data/moves.js';
import { CREATURES } from '../src/data/creatures.js';

test('all affinity pairings follow the single six-affinity cycle', () => {
  for (let a = 0; a < AFFINITY_ORDER.length; a++)
    for (let d = 0; d < AFFINITY_ORDER.length; d++) {
      const expected = d === (a + 1) % 6 ? 2 : d === (a + 5) % 6 ? 0.5 : 1;
      assert.equal(affinityMultiplier(AFFINITY_ORDER[a], AFFINITY_ORDER[d]), expected);
    }
  for (const affinity of AFFINITY_ORDER) assert.equal(affinityMultiplier('neutral', affinity), 1);
});

test('damage is deterministic and applies focus, guard, exposure, weakness, and minimum', () => {
  const move = MOVES.lucid_arc,
    attacker = CREATURES.orakyn,
    defender = CREATURES.kordane;
  const a = calculateDamage(move, attacker, defender),
    b = calculateDamage(move, attacker, defender);
  assert.deepEqual(a, b);
  assert.deepEqual(a, { damage: 53, affinity: 2, status: 1 });
  assert.ok(calculateDamage(move, attacker, defender, { focused: true }).damage > a.damage);
  assert.ok(calculateDamage(move, attacker, defender, { guarded: true }).damage < a.damage);
  assert.ok(calculateDamage(move, attacker, defender, { exposed: true }).damage > a.damage);
  assert.ok(calculateDamage(move, attacker, defender, { weakened: true }).damage < a.damage);
  assert.equal(calculateDamage({ ...move, power: 0 }, attacker, defender).damage, 1);
});
