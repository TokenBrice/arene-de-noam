import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, previewMove, resolveTurn } from '../src/battle/engine.js';
import { CREATURES, CREATURE_IDS } from '../src/data/creatures.js';
import { MOVES } from '../src/data/moves.js';

function teamWithLead(id) {
  return [id, ...CREATURE_IDS.filter((candidate) => candidate !== id).slice(0, 2)];
}

const HP_SCENARIOS = [
  { id: 'full', ratio: 1, barrier: 0 },
  { id: 'threshold', ratio: 0.5, barrier: 0 },
  { id: 'critical', ratio: 0.12, barrier: 0 },
  { id: 'barrier', ratio: 0.25, barrier: 17 },
  { id: 'marked', ratio: 0.51, barrier: 9, status: 'marked' },
  { id: 'evasive', ratio: 0.25, barrier: 7, status: 'evasive' },
];

test('seeded roster sweep keeps preview damage and lethality identical to live per-hit resolution', () => {
  let checked = 0,
    seed = 0x5eedc0de;
  for (const attackerId of CREATURE_IDS) {
    const damageMoves = CREATURES[attackerId].moves.filter((moveId) => MOVES[moveId].kind === 'damage');
    for (const defenderId of CREATURE_IDS)
      for (const moveId of damageMoves)
        for (const scenario of HP_SCENARIOS) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          const state = createBattle({
            playerTeam: teamWithLead(attackerId),
            enemyTeam: teamWithLead(defenderId),
            seed,
          });
          const attacker = state.sides.player.team[0],
            defender = state.sides.enemy.team[0];
          attacker.speed = 999;
          defender.speed = 1;
          defender.hp = Math.max(1, Math.round(defender.maxHp * scenario.ratio));
          defender.barrier = scenario.barrier;
          defender.statuses = scenario.status
            ? { [scenario.status]: { appliedTurn: state.turn, stacks: 1 } }
            : {};
          defender.moves = ['continental_divide'];
          state.sides.player.surge = 100;
          state.sides.enemy.surge = 100;
          const before = structuredClone(state),
            preview = previewMove(state, 'player', moveId),
            result = resolveTurn(
              state,
              { type: 'move', moveId },
              { type: 'move', moveId: 'continental_divide' }
            ),
            damageEvents = result.events.filter(
              (event) =>
                event.type === 'damage' &&
                event.sourceSide === 'player' &&
                event.sourceCreatureId === attackerId
            ),
            liveDamage = damageEvents.reduce((sum, event) => sum + event.amount, 0),
            liveLethal = damageEvents.at(-1)?.hp === 0;
          assert.equal(
            preview.damage,
            liveDamage,
            `${attackerId}/${moveId} -> ${defenderId} (${scenario.id}) damage`
          );
          assert.equal(
            preview.lethal,
            liveLethal,
            `${attackerId}/${moveId} -> ${defenderId} (${scenario.id}) lethality`
          );
          assert.deepEqual(state, before, `${attackerId}/${moveId} preview mutated state`);
          checked++;
        }
  }
  assert.ok(checked >= 7_000, `expected a broad roster sweep, checked ${checked}`);
});
