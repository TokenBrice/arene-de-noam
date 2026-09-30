import test from 'node:test';
import assert from 'node:assert/strict';
import { AFFINITY_TRIANGLES } from '../src/data/affinities.js';
import { CREATURES, CREATURE_IDS } from '../src/data/creatures.js';
import { MOVES } from '../src/data/moves.js';
import { loadDictionary } from '../src/i18n.js';
import { createBattle, previewMove } from '../src/battle/engine.js';

const DICTIONARIES = { fr: await loadDictionary('fr'), en: await loadDictionary('en') };

const triangleOf = (affinity) => AFFINITY_TRIANGLES.findIndex((triangle) => triangle.includes(affinity));

// Full-HP damage against a clean target whose type is neutral to the move.
function neutralDamage(ownerId, moveId) {
  const fillers = CREATURE_IDS.filter((id) => id !== ownerId && id !== 'thornox').slice(0, 2),
    state = createBattle({ playerTeam: [ownerId, ...fillers], enemyTeam: ['thornox', ...fillers] });
  for (const side of ['player', 'enemy'])
    for (const creature of state.sides[side].team) {
      creature.statuses = {};
      creature.barrier = 0;
    }
  state.sides.enemy.team[0].affinity = triangleOf(MOVES[moveId].affinity) === 0 ? 'force' : 'flame';
  return previewMove(state, 'player', moveId).damage;
}

test('every creature knows exactly one coverage move from the other type triangle', () => {
  for (const id of CREATURE_IDS) {
    const creature = CREATURES[id],
      offType = creature.moves
        .map((moveId) => MOVES[moveId])
        .filter((move) => move.kind === 'damage' && move.affinity !== creature.affinity);
    assert.equal(offType.length, 1, `${id} needs exactly one off-type attack`);
    assert.equal(offType[0].signature, undefined, `${id}: a Signature stays on-type`);
    assert.notEqual(triangleOf(offType[0].affinity), triangleOf(creature.affinity), `${offType[0].id}`);
  }
});

test('damaging Signatures hit at least 1.6× the best regular attack', () => {
  for (const id of CREATURE_IDS) {
    const moves = CREATURES[id].moves.map((moveId) => MOVES[moveId]),
      signature = moves.find((move) => move.signature);
    if (signature.kind !== 'damage') continue;
    const best = Math.max(
      ...moves
        .filter((move) => move.kind === 'damage' && !move.signature)
        .map((move) => neutralDamage(id, move.id))
    );
    assert.ok(
      neutralDamage(id, signature.id) >= 1.6 * best,
      `${signature.id}: ${neutralDamage(id, signature.id)} vs best regular ${best}`
    );
  }
});

test('support Signatures carry a payload for the whole team', () => {
  const supportSignatures = Object.values(MOVES).filter((move) => move.signature && move.kind !== 'damage');
  assert.ok(supportSignatures.length > 0);
  for (const move of supportSignatures)
    assert.ok(
      move.teamBarrier || move.teamHealRatio || move.teamStatuses?.length,
      `${move.id} must reach every ally`
    );
});

test('every number in move effect copy (simple and tactical detail) comes from the move data', () => {
  const known = (move) => {
    const values = new Set();
    const collect = (value) => {
      if (typeof value === 'number') {
        values.add(value);
        values.add(Math.round(value * 1000) / 10);
        values.add(Math.round((value - 1) * 1000) / 10);
      } else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(move);
    return values;
  };
  for (const lang of Object.keys(DICTIONARIES))
    for (const move of Object.values(MOVES))
      for (const key of [`move.effect.${move.id}`, `move.effectDetail.${move.id}`]) {
        const text = DICTIONARIES[lang][key],
          values = known(move);
        assert.ok(text, `${lang} ${key}`);
        for (const [, raw] of text.matchAll(/(\d+(?:[.,]\d+)?)/g))
          assert.ok(values.has(Number(raw.replace(',', '.'))), `${lang} ${key}: "${raw}" in "${text}"`);
      }
});
