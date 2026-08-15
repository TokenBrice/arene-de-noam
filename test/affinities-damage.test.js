import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AFFINITY_ADVANTAGE,
  AFFINITY_ORDER,
  AFFINITY_TRIANGLES,
  affinityMultiplier,
} from '../src/data/affinities.js';
import { calculateDamage } from '../src/battle/damage.js';
import { MOVES } from '../src/data/moves.js';
import { CREATURES } from '../src/data/creatures.js';

test('all 36 typed pairings follow the two explicit triangles', () => {
  const expected = {
    flame: { flame: 1, tide: 0.5, grove: 2, force: 1, mind: 1, shadow: 1 },
    tide: { flame: 2, tide: 1, grove: 0.5, force: 1, mind: 1, shadow: 1 },
    grove: { flame: 0.5, tide: 2, grove: 1, force: 1, mind: 1, shadow: 1 },
    force: { flame: 1, tide: 1, grove: 1, force: 1, mind: 0.5, shadow: 2 },
    mind: { flame: 1, tide: 1, grove: 1, force: 2, mind: 1, shadow: 0.5 },
    shadow: { flame: 1, tide: 1, grove: 1, force: 0.5, mind: 2, shadow: 1 },
  };
  for (const attack of AFFINITY_ORDER)
    for (const defense of AFFINITY_ORDER)
      assert.equal(
        affinityMultiplier(attack, defense),
        expected[attack][defense],
        `${attack} attacking ${defense}`
      );

  assert.deepEqual(AFFINITY_TRIANGLES, [
    ['tide', 'flame', 'grove'],
    ['mind', 'force', 'shadow'],
  ]);
  assert.deepEqual(AFFINITY_ADVANTAGE, {
    tide: 'flame',
    flame: 'grove',
    grove: 'tide',
    mind: 'force',
    force: 'shadow',
    shadow: 'mind',
  });
  for (const affinity of AFFINITY_ORDER) {
    assert.equal(affinityMultiplier('neutral', affinity), 1);
    const row = AFFINITY_ORDER.map((defense) => affinityMultiplier(affinity, defense));
    assert.equal(row.filter((value) => value === 2).length, 1);
    assert.equal(row.filter((value) => value === 0.5).length, 1);
    assert.equal(row.filter((value) => value === 1).length, 4);
  }
  assert.throws(() => affinityMultiplier('unknown', 'flame'), /Unknown affinity/);
  assert.throws(() => affinityMultiplier('flame', 'unknown'), /Unknown affinity/);
});

test('damage is deterministic and applies Focused, Dazed, and minimum damage', () => {
  const move = MOVES.lucid_arc,
    attacker = CREATURES.orakyn,
    defender = CREATURES.kordane;
  const a = calculateDamage(move, attacker, defender),
    b = calculateDamage(move, attacker, defender);
  assert.deepEqual(a, b);
  assert.deepEqual(a, { damage: 52, affinity: 2, status: 1 });
  assert.equal(calculateDamage(move, attacker, defender, { focused: true }).status, 1.3);
  assert.equal(calculateDamage(move, attacker, defender, { stunned: true }).status, 0.75);
  assert.equal(calculateDamage({ ...move, power: 0 }, attacker, defender).damage, 1);
});

test('single-type legendary matchup keeps priority Dire Pinion below a full-health knockout', () => {
  assert.equal(CREATURES.deuilastre.affinity, 'shadow');
  assert.equal(CREATURES.aubeastre.affinity, 'mind');
  assert.equal(MOVES.dire_pinion.power, 22);
  assert.deepEqual(calculateDamage(MOVES.dire_pinion, CREATURES.deuilastre, CREATURES.aubeastre), {
    damage: 76,
    affinity: 2,
    status: 1,
  });
  assert.ok(76 < CREATURES.aubeastre.maxHp);
});
