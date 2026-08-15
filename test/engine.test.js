import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeOf,
  applyReplacement,
  applyTrainerCommand,
  canUseTrainerCommand,
  createBattle,
  getLegalActions,
  previewIncomingAfterSwitch,
  previewMove,
  previewMoveOrder,
  resolveTurn,
  signatureCostFor,
  TURN_CAP,
} from '../src/battle/engine.js';
import { CREATURES } from '../src/data/creatures.js';
import { MOVES } from '../src/data/moves.js';
import { COMBO_DAMAGE_MULTIPLIER } from '../src/data/combos.js';
import { calculateDamage } from '../src/battle/damage.js';
import { effectiveSpeed } from '../src/battle/statuses.js';

const make = () =>
  createBattle({
    playerTeam: ['orakyn', 'abyssar', 'virelia'],
    enemyTeam: ['kordane', 'calderoc', 'farfombre'],
    seed: 17,
  });

test('rejects illegal moves and validates from the shared start state', () => {
  const state = make();
  assert.throws(
    () =>
      resolveTurn(
        state,
        { type: 'move', moveId: 'caldera_roar' },
        { type: 'move', moveId: 'crystal_strike' }
      ),
    /Illegal/
  );
  const next = resolveTurn(state, { type: 'switch', index: 1 }, { type: 'move', moveId: 'crystal_strike' });
  assert.equal(next.state.sides.player.active, 1);
  assert.ok(
    next.state.sides.player.team[1].hp < next.state.sides.player.team[1].maxHp,
    'incoming switch receives the aimed attack'
  );
  assert.equal(next.state.sides.player.team[0].hp, next.state.sides.player.team[0].maxHp);
});

test('priority beats speed, speed beats ordinary moves, and seeded ties are reproducible', () => {
  let state = make();
  state.sides.player.surge = 100;
  let result = resolveTurn(
    state,
    { type: 'move', moveId: 'oracle_veil' },
    { type: 'move', moveId: 'crystal_strike' }
  );
  assert.equal(result.events[0].moveId, 'oracle_veil');
  const a = createBattle({
    playerTeam: ['orakyn', 'virelia', 'abyssar'],
    enemyTeam: ['virelia', 'calderoc', 'kordane'],
    seed: 55,
  });
  const b = structuredClone(a);
  assert.deepEqual(
    resolveTurn(a, { type: 'move', moveId: 'lucid_arc' }, { type: 'move', moveId: 'petal_ray' }).events,
    resolveTurn(b, { type: 'move', moveId: 'lucid_arc' }, { type: 'move', moveId: 'petal_ray' }).events
  );
});

test('semantic battle events retain the exact turn that produced them', () => {
  let state = createBattle({
    playerTeam: ['orakyn', 'abyssar', 'virelia'],
    enemyTeam: ['kordane', 'calderoc', 'farfombre'],
    seed: 73,
  });
  let result = resolveTurn(
    state,
    { type: 'move', moveId: 'lucid_arc' },
    { type: 'move', moveId: 'crystal_strike' }
  );
  assert.ok(result.events.length > 0);
  assert.ok(result.events.every((event) => event.turn === 1));
  state = result.state;
  result = resolveTurn(
    state,
    { type: 'move', moveId: 'slowing_riddle' },
    { type: 'move', moveId: 'crystal_strike' }
  );
  assert.ok(result.events.every((event) => event.turn === 2));
  assert.ok(result.state.history.slice(-result.events.length).every((event) => event.turn === 2));
});

test('move-order forecasts use priority before effective speed', () => {
  const state = make();
  assert.equal(previewMoveOrder(state, 'player', 'oracle_veil', 'crystal_strike'), 'first');
  assert.equal(previewMoveOrder(state, 'player', 'lucid_arc', 'crystal_strike'), 'second');
  state.sides.player.team[0].speed = state.sides.enemy.team[0].speed;
  assert.equal(previewMoveOrder(state, 'player', 'lucid_arc', 'crystal_strike'), 'tie');
});

test('switch forecasts include entry talents and exactly match the incoming hit', () => {
  const state = createBattle({
      playerTeam: ['orakyn', 'monolith', 'virelia'],
      enemyTeam: ['kordane', 'calderoc', 'farfombre'],
      seed: 33,
    }),
    before = structuredClone(state),
    forecast = previewIncomingAfterSwitch(state, 'player', 1, 'crystal_strike');
  assert.deepEqual(state, before);
  const result = resolveTurn(state, { type: 'switch', index: 1 }, { type: 'move', moveId: 'crystal_strike' }),
    hit = result.events.find((event) => event.type === 'damage' && event.side === 'player');
  assert.equal(forecast.damage, hit.amount);
  assert.equal(forecast.absorbed, hit.absorbed);
  assert.ok(result.events.some((event) => event.type === 'passive' && event.passive === 'foundation'));
});

test('a resisted predicted attack rewards a symmetric Perfect Relay', () => {
  const state = createBattle({
      playerTeam: ['abyssar', 'orakyn', 'virelia'],
      enemyTeam: ['kordane', 'calderoc', 'farfombre'],
      seed: 34,
    }),
    before = state.sides.player.surge,
    forecast = previewIncomingAfterSwitch(state, 'player', 1, 'crystal_strike');
  assert.equal(forecast.affinity, 0.5);
  assert.equal(forecast.perfectRelay, true);
  const result = resolveTurn(state, { type: 'switch', index: 1 }, { type: 'move', moveId: 'crystal_strike' });
  assert.ok(result.events.some((event) => event.type === 'perfect-relay' && event.side === 'player'));
  assert.ok(
    result.events.some(
      (event) =>
        event.type === 'surge' &&
        event.side === 'player' &&
        event.source === 'perfect-relay' &&
        event.amount === 6
    )
  );
  assert.ok(result.state.sides.player.surge >= before + 16);
});

test('forecasts and live damage follow the rewired Combat triangle and cross-triangle neutrality', () => {
  const state = createBattle({
      playerTeam: ['orakyn', 'nocturnyx', 'abyssar'],
      enemyTeam: ['kordane', 'calderoc', 'virelia'],
      seed: 35,
    }),
    strongForecast = previewIncomingAfterSwitch(state, 'player', 1, 'crystal_strike'),
    neutralForecast = previewIncomingAfterSwitch(state, 'player', 2, 'crystal_strike');
  assert.equal(strongForecast.affinity, 2);
  assert.equal(strongForecast.perfectRelay, false);
  assert.equal(neutralForecast.affinity, 1);
  assert.equal(neutralForecast.perfectRelay, false);

  const strongResult = resolveTurn(
      state,
      { type: 'switch', index: 1 },
      { type: 'move', moveId: 'crystal_strike' }
    ),
    neutralResult = resolveTurn(
      state,
      { type: 'switch', index: 2 },
      { type: 'move', moveId: 'crystal_strike' }
    ),
    strongHit = strongResult.events.find((event) => event.type === 'damage' && event.side === 'player'),
    neutralHit = neutralResult.events.find((event) => event.type === 'damage' && event.side === 'player');
  assert.equal(strongHit.amount, strongForecast.damage);
  assert.equal(neutralHit.amount, neutralForecast.damage);
  assert.ok(strongHit.amount > neutralHit.amount);
});

test('cooldowns last exact future selection phases and statuses refresh/consume', () => {
  let state = createBattle({
    playerTeam: ['kordane', 'orakyn', 'virelia'],
    enemyTeam: ['abyssar', 'calderoc', 'farfombre'],
    seed: 2,
  });
  state.sides.player.surge = 100;
  state.sides.enemy.surge = 100;
  let result = resolveTurn(
    state,
    { type: 'move', moveId: 'fault_charge' },
    { type: 'move', moveId: 'shell_bastion' }
  );
  state = result.state;
  assert.ok(!getLegalActions(state, 'player').some((a) => a.moveId === 'fault_charge'));
  assert.ok(state.sides.player.team[0].statuses.marked);
  result = resolveTurn(
    state,
    { type: 'move', moveId: 'crystal_strike' },
    { type: 'move', moveId: 'abyssal_surge' }
  );
  state = result.state;
  assert.equal(state.sides.player.team[0].cooldowns.fault_charge, undefined);
  state.sides.player.surge = 100;
  assert.ok(getLegalActions(state, 'player').some((a) => a.moveId === 'fault_charge'));
  assert.ok(state.sides.player.team[0].statuses.marked, 'an untagged attack preserves Marked');
  state.sides.player.team[0].statuses.stunned = { remaining: 2, appliedTurn: state.turn };
  state.sides.player.team[0].attack = 1;
  result = resolveTurn(
    state,
    { type: 'move', moveId: 'crystal_strike' },
    { type: 'move', moveId: 'undertow' }
  );
  state = result.state;
  assert.equal(
    state.sides.player.team[0].statuses.stunned.remaining,
    3,
    'same status is refreshed and not immediately ticked'
  );
});

test('team Surge locks signatures until earned, then spends on a cinematic move', () => {
  let state = createBattle({
    playerTeam: ['lumivox', 'orakyn', 'virelia'],
    enemyTeam: ['monolith', 'abyssar', 'mossaur'],
    seed: 18,
  });
  assert.ok(!getLegalActions(state, 'player').some((a) => a.moveId === 'finale_nova'));
  state.sides.player.surge = 99;
  let result = resolveTurn(
    state,
    { type: 'move', moveId: 'echo_chorus' },
    { type: 'move', moveId: 'gravity_fist' }
  );
  state = result.state;
  assert.equal(state.sides.player.surge, 100);
  assert.ok(result.events.some((e) => e.type === 'surge' && e.side === 'player' && e.ready));
  assert.ok(getLegalActions(state, 'player').some((a) => a.moveId === 'finale_nova'));
  result = resolveTurn(
    state,
    { type: 'move', moveId: 'finale_nova' },
    { type: 'move', moveId: 'gravity_fist' }
  );
  assert.ok(result.events.some((e) => e.type === 'surge' && e.side === 'player' && e.amount === -100));
  assert.ok(result.state.sides.player.surge < 20, 'the enemy reply may rebuild only a sliver of Surge');
});

test('flat Surge gains cover damage, support, misses, HP loss, and barrier absorption', () => {
  const supportState = createBattle({
    playerTeam: ['kordane', 'abyssar', 'virelia'],
    enemyTeam: ['orakyn', 'calderoc', 'farfombre'],
    seed: 83,
  });
  supportState.sides.player.surge = 0;
  let result = resolveTurn(
    supportState,
    { type: 'move', moveId: 'resonant_focus' },
    { type: 'move', moveId: 'lucid_arc' }
  );
  assert.ok(
    result.events.some((event) => event.type === 'surge' && event.side === 'player' && event.amount === 25)
  );

  const missState = make();
  missState.sides.player.surge = 0;
  activeOf(missState, 'enemy').statuses.evasive = { appliedTurn: 0, stacks: 1 };
  result = resolveTurn(
    missState,
    { type: 'move', moveId: 'lucid_arc' },
    { type: 'move', moveId: 'crystal_strike' }
  );
  assert.ok(result.events.some((event) => event.type === 'miss' && event.sourceSide === 'player'));
  assert.ok(
    result.events.some((event) => event.type === 'surge' && event.side === 'player' && event.amount === 20)
  );

  const damageState = make();
  damageState.sides.player.surge = 0;
  damageState.sides.enemy.surge = 0;
  activeOf(damageState, 'enemy').barrier = 12;
  result = resolveTurn(
    damageState,
    { type: 'move', moveId: 'lucid_arc' },
    { type: 'move', moveId: 'crystal_strike' }
  );
  const playerHit = result.events.find((event) => event.type === 'damage' && event.sourceSide === 'player');
  assert.ok(
    result.events.some((event) => event.type === 'surge' && event.side === 'player' && event.amount === 20)
  );
  assert.ok(
    result.events.some(
      (event) =>
        event.type === 'surge' &&
        event.side === 'enemy' &&
        event.source === 'resolve' &&
        event.amount === Math.round(playerHit.amount * 0.25)
    )
  );
  assert.ok(playerHit.absorbed > 0);
  assert.equal(
    result.events.some((event) => event.type === 'flow'),
    false
  );
});

test('mastery ranks never change combat stats, openings, or Signature cost', () => {
  const state = createBattle({
    playerTeam: ['orakyn', 'solflare', 'virelia'],
    enemyTeam: ['kordane', 'calderoc', 'farfombre'],
    seed: 19,
    masteryRanks: { orakyn: 5, solflare: 5, virelia: 2 },
  });
  assert.equal(state.sides.player.team[0].barrier, 0);
  assert.equal(state.sides.player.team[2].barrier, 0);
  assert.equal(state.sides.player.team[0].maxHp, CREATURES.orakyn.maxHp);
  assert.equal('masteryRank' in state.sides.player.team[0], false);
  assert.equal(state.sides.player.surge, 30);
  assert.equal(signatureCostFor(state.sides.player.team[0]), 100);
  assert.equal(signatureCostFor(state.sides.player.team[1]), 80);
});

test('arena powers awaken every fourth turn and remain deterministic', () => {
  for (const arena of ['crystal', 'grove', 'tidal', 'volcano', 'astral', 'eclipse']) {
    const state = createBattle({
      playerTeam: ['orakyn', 'virelia', 'abyssar'],
      enemyTeam: ['kordane', 'calderoc', 'farfombre'],
      seed: 23,
      arena,
    });
    state.turn = 4;
    state.sides.player.surge = 100;
    state.sides.player.team[0].hp -= 20;
    state.sides.enemy.team[0].hp -= 20;
    const result = resolveTurn(
      state,
      { type: 'move', moveId: 'oracle_veil' },
      { type: 'move', moveId: 'resonant_focus' }
    );
    assert.ok(
      result.events.some((e) => e.type === 'arena-pulse' && e.arena === arena),
      `${arena} pulse is emitted`
    );
    assert.equal(
      result.events.some((event) => event.type === 'resonance'),
      false
    );
  }
});

test('matching arena affinity grants no hidden Surge at a pulse', () => {
  const state = createBattle({
    playerTeam: ['kordane', 'orakyn', 'virelia'],
    enemyTeam: ['monolith', 'calderoc', 'farfombre'],
    seed: 24,
    arena: 'crystal',
  });
  state.turn = 4;
  state.sides.player.surge = 40;
  state.sides.enemy.surge = 40;
  const result = resolveTurn(
    state,
    { type: 'move', moveId: 'crystal_strike' },
    { type: 'move', moveId: 'gravity_fist' }
  );
  assert.equal(
    result.events.some((event) => event.type === 'resonance'),
    false
  );
  assert.equal(
    result.events.some((event) => event.type === 'surge' && event.source === 'resonance'),
    false
  );
});

test('innate talents create creature-specific opening, survival, and signature rules', () => {
  let state = createBattle({
    playerTeam: ['orakyn', 'solflare', 'prismage'],
    enemyTeam: ['monolith', 'pyrolynx', 'mossaur'],
    seed: 29,
  });
  assert.ok(state.sides.player.team[0].statuses.focused, 'Orakyn foresees its opening');
  assert.equal(state.sides.enemy.team[0].barrier, 14, 'Monolith receives only its innate Foundation barrier');
  state.sides.player.active = 1;
  state.sides.player.surge = 80;
  assert.ok(
    getLegalActions(state, 'player').some((a) => a.moveId === 'supernova'),
    'Sunborn discounts Solflare’s signature'
  );
  state = createBattle({
    playerTeam: ['kordane', 'orakyn', 'virelia'],
    enemyTeam: ['pyrolynx', 'abyssar', 'mossaur'],
    seed: 31,
  });
  state.sides.enemy.team[0].hp = 1;
  const result = resolveTurn(
    state,
    { type: 'move', moveId: 'crystal_strike' },
    { type: 'move', moveId: 'flash_pounce' }
  );
  assert.equal(result.state.sides.enemy.team[0].hp, 1);
  assert.ok(result.events.some((e) => e.type === 'passive' && e.passive === 'nine_lives'));
  assert.ok(!result.events.some((e) => e.type === 'ko' && e.side === 'enemy'));

  const roots = createBattle({
    playerTeam: ['mossaur', 'orakyn'],
    enemyTeam: ['mossaur', 'kordane'],
    seed: 32,
  });
  roots.sides.player.surge = 100;
  const rooted = resolveTurn(
    roots,
    { type: 'move', moveId: 'forest_quake' },
    { type: 'move', moveId: 'mossy_crush' }
  );
  assert.equal(rooted.state.sides.enemy.team[0].statuses.rooted, undefined);
  assert.equal(
    rooted.events.some(
      (event) => event.type === 'status' && event.side === 'enemy' && event.status === 'rooted'
    ),
    false
  );
  assert.ok(getLegalActions(rooted.state, 'enemy').some((action) => action.type === 'switch'));
});

test('team composition never alters neutral openings', () => {
  const hunters = createBattle({
    playerTeam: ['ferrax', 'pyrolynx', 'riptalon'],
    enemyTeam: ['orakyn', 'kordane', 'virelia'],
    seed: 44,
  });
  assert.equal(hunters.sides.player.surge, 30);
  assert.equal(hunters.sides.player.team[0].statuses.haste, undefined);
  assert.equal('bonds' in hunters.sides.player, false);
  const grove = createBattle({
    playerTeam: ['thornox', 'mossaur', 'florafae'],
    enemyTeam: ['orakyn', 'kordane', 'virelia'],
    seed: 44,
  });
  assert.equal(grove.sides.player.surge, 30);
  assert.equal(grove.sides.player.team[0].statuses.focused, undefined);
  assert.equal(grove.sides.enemy.team[0].statuses.marked, undefined);
  const bulwark = createBattle({
    playerTeam: ['abyssar', 'nymbloom', 'virelia'],
    enemyTeam: ['orakyn', 'kordane', 'farfombre'],
    seed: 44,
  });
  assert.ok(bulwark.sides.player.team.every((c) => c.barrier === 0));
});

test('trial modifiers produce explicit high-stakes battle variants', () => {
  let state = createBattle({
    playerTeam: ['orakyn', 'abyssar', 'virelia'],
    enemyTeam: ['solflare', 'lumivox', 'voltide'],
    seed: 51,
    modifiers: ['overdrive'],
  });
  assert.equal(state.sides.player.surge, 100);
  assert.equal(state.sides.enemy.surge, 100);
  state = createBattle({
    playerTeam: ['orakyn', 'abyssar', 'virelia'],
    enemyTeam: ['prismage', 'monolith', 'calderoc'],
    seed: 51,
    modifiers: ['ascendant', 'player_wounded'],
  });
  assert.ok(state.sides.enemy.team[0].maxHp > 84);
  assert.ok(state.sides.player.team.every((c) => c.hp < c.maxHp));
  state = createBattle({
    playerTeam: ['orakyn', 'abyssar', 'virelia'],
    enemyTeam: ['abyssar', 'monolith', 'mossaur'],
    seed: 51,
    modifiers: ['enemy_aegis'],
  });
  assert.ok(state.sides.enemy.team.every((c) => c.barrier >= 18));
});

test('obsolete doctrine input is ignored and openings remain neutral', () => {
  const base = {
    playerTeam: ['orakyn', 'abyssar', 'virelia'],
    enemyTeam: ['kordane', 'calderoc', 'farfombre'],
    seed: 58,
  };
  const state = createBattle({ ...base, doctrine: 'assault' });
  assert.equal(state.sides.player.surge, 30);
  assert.equal(state.sides.enemy.surge, 30);
  assert.equal('doctrine' in state, false);
  assert.ok(state.sides.player.team.every((creature) => creature.hp === creature.maxHp));
});

test('Coach is conditional, immutable, complete, free, and once per battle', () => {
  const base = {
    playerTeam: ['orakyn', 'abyssar', 'virelia'],
    enemyTeam: ['kordane', 'calderoc', 'farfombre'],
    seed: 58,
  };
  const state = createBattle(base);
  assert.equal(canUseTrainerCommand(state), false);
  assert.throws(() => applyTrainerCommand(state), /not available/);
  const penalized = structuredClone(state);
  activeOf(penalized, 'player').statuses.stunned = { appliedTurn: 1, remaining: 2, stacks: 1 };
  activeOf(penalized, 'player').statuses.burning = { appliedTurn: 1, remaining: 2, stacks: 2 };
  activeOf(penalized, 'player').statuses.focused = { appliedTurn: 1, stacks: 1 };
  const before = structuredClone(penalized),
    result = applyTrainerCommand(penalized);
  assert.deepEqual(penalized, before);
  assert.equal(result.state.turn, before.turn);
  assert.equal(result.state.phase, 'choice');
  assert.equal(result.state.sides.player.commandUsed, true);
  assert.equal(result.state.sides.player.surge, before.sides.player.surge + 15);
  assert.deepEqual(Object.keys(activeOf(result.state, 'player').statuses), ['focused']);
  assert.ok(result.events.some((event) => event.type === 'trainer-command' && event.command === 'coach'));
  assert.equal(result.events.filter((event) => event.type === 'status' && !event.applied).length, 2);
  assert.throws(() => applyTrainerCommand(result.state), /not available/);
});

test('gauntlet boons accumulate explicit player-only advantages', () => {
  const state = createBattle({
    playerTeam: ['orakyn', 'abyssar', 'virelia'],
    enemyTeam: ['kordane', 'calderoc', 'farfombre'],
    seed: 59,
    modifiers: ['player_surge', 'player_aegis', 'player_vitality', 'player_focus'],
  });
  assert.equal(state.sides.player.surge, 55);
  assert.ok(state.sides.player.team.every((c) => c.barrier >= 12));
  assert.ok(state.sides.player.team.every((c) => c.maxHp > CREATURES[c.id].maxHp));
  assert.ok(state.sides.player.team[0].statuses.focused);
  assert.ok(state.sides.enemy.team[0].statuses.marked);
  assert.equal(state.sides.enemy.surge, 30);
});

test('multi-hit, barriers, drains, recoil, and damage-over-time emit semantic events', () => {
  let state = createBattle({
    playerTeam: ['lumivox', 'mnemora', 'magmoth'],
    enemyTeam: ['monolith', 'thornox', 'virelia'],
    seed: 8,
  });
  let result = resolveTurn(
    state,
    { type: 'move', moveId: 'echo_chorus' },
    { type: 'move', moveId: 'fortress_protocol' }
  );
  state = result.state;
  assert.equal(result.events.filter((e) => e.type === 'damage').length, 3);
  assert.ok(state.sides.enemy.team[0].barrier < 26, 'the multi-hit attack chips through the new barrier');
  assert.ok(result.events.some((e) => e.type === 'barrier-hit'));
  result = resolveTurn(
    state,
    { type: 'move', moveId: 'crescendo_lock' },
    { type: 'move', moveId: 'gravity_fist' }
  );
  state = result.state;
  state.sides.player.team[0].statuses.burning = { remaining: 2, appliedTurn: 0, stacks: 2 };
  const hpBeforeBurn = state.sides.player.team[0].hp;
  result = resolveTurn(
    state,
    { type: 'move', moveId: 'echo_chorus' },
    { type: 'move', moveId: 'gravity_fist' }
  );
  const burnTick = result.events.find(
    (event) => event.type === 'status-tick' && event.side === 'player' && event.status === 'burning'
  );
  assert.equal(burnTick.amount, Math.round(state.sides.player.team[0].maxHp * 0.1));
  assert.equal(burnTick.remaining, 1, 'status ticks expose the resulting remaining turns');
  assert.ok(result.state.sides.player.team[0].hp <= hpBeforeBurn - burnTick.amount);

  const capped = createBattle({
    playerTeam: ['calderoc', 'orakyn'],
    enemyTeam: ['monolith', 'kordane'],
    seed: 81,
  });
  capped.sides.enemy.team[0].statuses.burning = { remaining: 2, appliedTurn: 0, stacks: 2 };
  const cappedResult = resolveTurn(
    capped,
    { type: 'move', moveId: 'cinder_burst' },
    { type: 'move', moveId: 'gravity_fist' }
  );
  assert.equal(cappedResult.state.sides.enemy.team[0].statuses.burning.stacks, 2);
});

test('binary Haste, immediate former-Regeneration healing, and former Thorns grants are explicit', () => {
  let state = createBattle({
    playerTeam: ['ferrax', 'calderoc'],
    enemyTeam: ['kordane', 'orakyn'],
    seed: 82,
  });
  let result = resolveTurn(
    state,
    { type: 'move', moveId: 'momentum_claw' },
    { type: 'move', moveId: 'resonant_focus' }
  );
  state = result.state;
  result = resolveTurn(
    state,
    { type: 'move', moveId: 'momentum_claw' },
    { type: 'move', moveId: 'resonant_focus' }
  );
  assert.equal(result.state.sides.player.team[0].statuses.haste.stacks, 1);
  assert.equal(result.state.sides.player.team[0].statuses.haste.remaining, 3);

  state = createBattle({
    playerTeam: ['calderoc', 'ferrax'],
    enemyTeam: ['kordane', 'orakyn'],
    seed: 83,
  });
  const calderoc = activeOf(state, 'player');
  calderoc.hp -= 30;
  const expectedHeal = Math.round(calderoc.maxHp * 0.08);
  result = resolveTurn(
    state,
    { type: 'move', moveId: 'furnace_heart' },
    { type: 'move', moveId: 'resonant_focus' }
  );
  assert.ok(
    result.events.some(
      (event) => event.type === 'heal' && event.creatureId === 'calderoc' && event.amount === expectedHeal
    )
  );

  state = createBattle({
    playerTeam: ['magmoth', 'ferrax'],
    enemyTeam: ['kordane', 'orakyn'],
    seed: 84,
  });
  result = resolveTurn(
    state,
    { type: 'move', moveId: 'ember_armor' },
    { type: 'move', moveId: 'resonant_focus' }
  );
  assert.equal(activeOf(result.state, 'player').barrier, 8);
  assert.ok(activeOf(result.state, 'player').statuses.countering);
});

test('Evasive preserves an unspent Focused attack', () => {
  const state = createBattle({
    playerTeam: ['orakyn', 'kordane'],
    enemyTeam: ['farfombre', 'pyrolynx'],
    seed: 85,
  });
  assert.ok(activeOf(state, 'player').statuses.focused);
  assert.ok(activeOf(state, 'enemy').statuses.evasive);
  const result = resolveTurn(
    state,
    { type: 'move', moveId: 'lucid_arc' },
    { type: 'move', moveId: 'shade_spark' }
  );
  assert.ok(result.events.some((event) => event.type === 'miss' && event.sourceSide === 'player'));
  assert.ok(activeOf(result.state, 'player').statuses.focused);
});

test('preview resolves Last Bastion barriers between Echo Chorus hits', () => {
  const state = createBattle({
    playerTeam: ['lumivox', 'orakyn', 'virelia'],
    enemyTeam: ['brontusk', 'kordane', 'calderoc'],
    seed: 801,
  });
  state.sides.enemy.team[0].hp = 60;
  state.sides.enemy.team[0].barrier = 0;
  state.sides.enemy.team[0].statuses = {};
  const before = structuredClone(state),
    preview = previewMove(state, 'player', 'echo_chorus'),
    result = resolveTurn(
      state,
      { type: 'move', moveId: 'echo_chorus' },
      { type: 'move', moveId: 'seismic_reversal' }
    ),
    damage = result.events
      .filter((event) => event.type === 'damage' && event.sourceSide === 'player')
      .reduce((sum, event) => sum + event.amount, 0);
  assert.equal(preview.damage, damage);
  assert.equal(preview.lethal, false);
  assert.ok(result.state.sides.enemy.team[0].hp > 0);
  assert.deepEqual(state, before, 'preview must not mutate the battle');
});

test('preview resolves Nine Lives once and lets later Echo Chorus hits finish the target', () => {
  const state = createBattle({
    playerTeam: ['lumivox', 'orakyn', 'virelia'],
    enemyTeam: ['pyrolynx', 'kordane', 'calderoc'],
    seed: 802,
  });
  state.sides.enemy.team[0].hp = 8;
  state.sides.enemy.team[0].barrier = 0;
  state.sides.player.team[0].speed = 999;
  const preview = previewMove(state, 'player', 'echo_chorus'),
    result = resolveTurn(
      state,
      { type: 'move', moveId: 'echo_chorus' },
      { type: 'move', moveId: 'scorch_mark' }
    ),
    damage = result.events
      .filter((event) => event.type === 'damage' && event.sourceSide === 'player')
      .reduce((sum, event) => sum + event.amount, 0);
  assert.equal(preview.damage, damage);
  assert.equal(preview.lethal, true);
  assert.equal(result.state.sides.enemy.team[0].hp, 0);
});

test('a drain move cannot resurrect its user after reflected damage knocks it out', () => {
  const state = createBattle({
    playerTeam: ['mnemora', 'orakyn', 'virelia'],
    enemyTeam: ['thornox', 'kordane', 'calderoc'],
    seed: 803,
  });
  const attacker = state.sides.player.team[0],
    defender = state.sides.enemy.team[0];
  attacker.hp = 1;
  attacker.speed = 999;
  defender.speed = 1;
  defender.statuses.countering = { appliedTurn: state.turn, remaining: 2, stacks: 1 };
  defender.moves = ['continental_divide'];
  state.sides.enemy.surge = 100;
  const result = resolveTurn(
    state,
    { type: 'move', moveId: 'memory_leech' },
    { type: 'move', moveId: 'continental_divide' }
  );
  assert.equal(result.state.sides.player.team[0].hp, 0);
  assert.ok(
    result.events.some(
      (event) => event.type === 'ko' && event.side === 'player' && event.creatureId === 'mnemora'
    )
  );
  assert.equal(
    result.events.some(
      (event) => event.type === 'heal' && event.creatureId === 'mnemora' && event.source === 'drain'
    ),
    false
  );
  assert.ok(result.events.some((event) => event.type === 'recoil' && event.source === 'countering'));
  assert.equal(result.state.sides.enemy.team[0].statuses.countering, undefined);

  const passiveState = createBattle({
    playerTeam: ['kordane', 'orakyn'],
    enemyTeam: ['thornox', 'calderoc'],
    seed: 804,
  });
  passiveState.sides.player.team[0].speed = 999;
  passiveState.sides.enemy.team[0].speed = 1;
  const passiveResult = resolveTurn(
    passiveState,
    { type: 'move', moveId: 'crystal_strike' },
    { type: 'move', moveId: 'toxic_spines' }
  );
  assert.ok(passiveResult.events.some((event) => event.type === 'recoil' && event.source === 'bramblehide'));
});

test('Burning powers Venom Harvest through the single Combo rule', () => {
  const state = createBattle({
    playerTeam: ['thornox', 'mossaur', 'florafae'],
    enemyTeam: ['monolith', 'kordane', 'brontusk'],
    seed: 67,
  });
  state.sides.player.surge = 100;
  state.sides.enemy.team[0].statuses.burning = { remaining: 3, appliedTurn: 0, stacks: 2 };
  const preview = previewMove(state, 'player', 'venom_harvest');
  assert.deepEqual(preview.combo, {
    status: 'burning',
    multiplier: COMBO_DAMAGE_MULTIPLIER,
    helperId: null,
  });
  const result = resolveTurn(
    state,
    { type: 'move', moveId: 'venom_harvest' },
    { type: 'move', moveId: 'gravity_fist' }
  );
  assert.ok(
    result.events.some(
      (event) =>
        event.type === 'status' &&
        event.status === 'burning' &&
        event.consumed &&
        event.source === 'combo'
    )
  );
  assert.equal(result.events.filter((event) => event.type === 'damage' && event.combo).length, 1);
  assert.equal(result.state.sides.enemy.team[0].statuses.burning, undefined);
});

test('a teammate Combo credits its helper once and grants no assist Surge', () => {
  const state = createBattle({
    playerTeam: ['pyrolynx', 'orakyn', 'virelia'],
    enemyTeam: ['monolith', 'kordane', 'brontusk'],
    seed: 68,
  });
  state.sides.player.surge = 80;
  state.sides.enemy.team[0].maxHp = 999;
  state.sides.enemy.team[0].hp = 999;
  const plain = previewMove(state, 'player', 'ninefold_inferno');
  state.sides.enemy.team[0].statuses.marked = {
    remaining: 2,
    appliedTurn: 0,
    stacks: 1,
    sourceCreatureId: 'orakyn',
  };
  const preview = previewMove(state, 'player', 'ninefold_inferno');
  assert.deepEqual(preview.combo, {
    status: 'marked',
    multiplier: COMBO_DAMAGE_MULTIPLIER,
    helperId: 'orakyn',
  });
  assert.equal(preview.helperId, 'orakyn');
  assert.ok(preview.raw > plain.raw);
  state.sides.player.surge = 100;
  const result = resolveTurn(
    state,
    { type: 'move', moveId: 'ninefold_inferno' },
    { type: 'move', moveId: 'gravity_fist' }
  );
  assert.ok(
    result.events.some(
      (event) => event.type === 'assist' && event.creatureId === 'orakyn' && event.attackerId === 'pyrolynx'
    )
  );
  const hits = result.events.filter(
    (event) => event.type === 'damage' && event.sourceCreatureId === 'pyrolynx'
  );
  assert.ok(hits.every((hit) => hit.rawAmount === hits[0].rawAmount));
  assert.deepEqual(hits[0].combo, preview.combo);
  assert.ok(hits.slice(1).every((hit) => hit.combo === null));
  assert.equal(result.state.sides.enemy.team[0].statuses.marked, undefined);
  assert.equal(result.events.filter((event) => event.type === 'assist').length, 1);
  assert.equal(result.events.filter((event) => event.type === 'surge' && event.source === 'assist').length, 0);
});

test('Combo uses exactly ×1.4, misses preserve setup, and barriers still consume it', () => {
  const state = createBattle({
    playerTeam: ['orakyn', 'abyssar'],
    enemyTeam: ['kordane', 'farfombre'],
    seed: 69,
  });
  delete state.sides.player.team[0].statuses.focused;
  state.sides.enemy.team[0].statuses.marked = {
    appliedTurn: 0,
    remaining: 2,
    sourceCreatureId: 'orakyn',
  };
  const attacker = activeOf(state, 'player'),
    defender = activeOf(state, 'enemy'),
    expected = calculateDamage(
      { ...MOVES.slowing_riddle, power: MOVES.slowing_riddle.power * COMBO_DAMAGE_MULTIPLIER },
      attacker,
      defender
    ).damage,
    preview = previewMove(state, 'player', 'slowing_riddle');
  assert.equal(preview.raw, expected);
  assert.equal(preview.combo.multiplier, 1.4);
  const barrierState = structuredClone(state);
  barrierState.sides.enemy.team[0].barrier = 999;
  const barrierPreview = previewMove(barrierState, 'player', 'slowing_riddle');
  assert.equal(barrierPreview.damage, 0);
  assert.ok(barrierPreview.combo);
  const barrierResult = resolveTurn(
    barrierState,
    { type: 'move', moveId: 'slowing_riddle' },
    { type: 'move', moveId: 'crystal_strike' }
  );
  assert.equal(barrierResult.state.sides.enemy.team[0].statuses.marked, undefined);

  const missState = createBattle({
    playerTeam: ['orakyn', 'abyssar'],
    enemyTeam: ['farfombre', 'kordane'],
    seed: 70,
  });
  missState.sides.enemy.team[0].statuses.marked = { appliedTurn: 0, remaining: 2 };
  assert.equal(previewMove(missState, 'player', 'slowing_riddle').miss, true);
  const missResult = resolveTurn(
    missState,
    { type: 'move', moveId: 'slowing_riddle' },
    { type: 'move', moveId: 'shade_spark' }
  );
  assert.ok(missResult.state.sides.enemy.team[0].statuses.marked);
  assert.equal(missResult.events.some((event) => event.type === 'damage' && event.combo), false);
});

test('damage previews are exact, barrier-aware, immutable, and honest about guaranteed survival', () => {
  const state = createBattle({
    playerTeam: ['kordane', 'orakyn', 'virelia'],
    enemyTeam: ['monolith', 'pyrolynx', 'farfombre'],
    seed: 71,
  });
  state.sides.enemy.team[0].barrier = 11;
  const before = structuredClone(state),
    preview = previewMove(state, 'player', 'crystal_strike');
  assert.ok(preview.damage > 0);
  assert.equal(preview.absorbed, 11);
  assert.deepEqual(state, before, 'preview never mutates the battle');
  const result = resolveTurn(
    state,
    { type: 'move', moveId: 'crystal_strike' },
    { type: 'move', moveId: 'gravity_fist' }
  );
  const actual = result.events.find((e) => e.type === 'damage' && e.sourceSide === 'player');
  assert.equal(actual.amount, preview.damage);
  const evasive = createBattle({
    playerTeam: ['kordane', 'orakyn'],
    enemyTeam: ['farfombre', 'pyrolynx'],
    seed: 72,
  });
  assert.equal(previewMove(evasive, 'player', 'crystal_strike').miss, true);
  const survivor = createBattle({
    playerTeam: ['kordane', 'orakyn'],
    enemyTeam: ['pyrolynx', 'farfombre'],
    seed: 73,
  });
  survivor.sides.enemy.team[0].hp = 1;
  assert.equal(
    previewMove(survivor, 'player', 'crystal_strike').lethal,
    false,
    'Nine Lives is included in the forecast'
  );
});

test('support control, evasion, counters, roots, and team healing alter legal play', () => {
  let state = createBattle({
    playerTeam: ['mnemora', 'nymbloom', 'orakyn'],
    enemyTeam: ['nocturnyx', 'ferrax', 'calderoc'],
    seed: 12,
  });
  state.sides.player.surge = 100;
  let result = resolveTurn(
    state,
    { type: 'move', moveId: 'deja_vu' },
    { type: 'move', moveId: 'sonic_gloom' }
  );
  state = result.state;
  assert.ok(
    result.events.some((e) => e.type === 'miss'),
    'Deja Vu guarantees a dodge'
  );
  result = resolveTurn(
    state,
    { type: 'move', moveId: 'memory_leech' },
    { type: 'move', moveId: 'midnight_lullaby' }
  );
  state = result.state;
  assert.ok(
    result.events.some((e) => e.type === 'status' && e.status === 'stunned' && e.applied),
    'support move applies target control'
  );
  assert.ok(
    !result.events.some((e) => e.type === 'move-skip' && e.reason === 'stunned'),
    'daze never removes the player’s turn'
  );
  delete state.sides.player.team[0].cooldowns.deja_vu;
  state.sides.player.surge = 100;
  assert.ok(getLegalActions(state, 'player').some((action) => action.moveId === 'deja_vu'));
  const dazedSpeed = effectiveSpeed(state.sides.player.team[0]);
  delete state.sides.player.team[0].statuses.stunned;
  assert.ok(dazedSpeed < effectiveSpeed(state.sides.player.team[0]));
  state.sides.player.team[0].statuses.stunned = { remaining: 2, appliedTurn: state.turn, stacks: 1 };
  state.sides.player.team[0].statuses.rooted = { remaining: 2, appliedTurn: state.turn, stacks: 1 };
  assert.ok(
    !getLegalActions(state, 'player').some((a) => a.type === 'switch'),
    'root prevents voluntary switching'
  );
  state.sides.player.team[2].hp -= 20;
  state.sides.player.active = 1;
  state.sides.player.team[1].hp -= 20;
  delete state.sides.player.team[1].statuses.rooted;
  result = resolveTurn(
    state,
    { type: 'move', moveId: 'healing_rain' },
    { type: 'move', moveId: 'sonic_gloom' }
  );
  assert.ok(
    result.events.filter((e) => e.type === 'heal').length >= 2,
    'team healing reaches conscious allies'
  );
});
test('Night Terror extends Midnight Lullaby stun in the support path', () => {
  const state = createBattle({
    playerTeam: ['nocturnyx', 'orakyn'],
    enemyTeam: ['kordane', 'calderoc'],
    seed: 74,
  });
  const result = resolveTurn(
    state,
    { type: 'move', moveId: 'midnight_lullaby' },
    { type: 'move', moveId: 'crystal_strike' }
  );
  assert.equal(result.state.sides.enemy.team[0].statuses.stunned?.remaining, 3);
});
test('Shell Bastion cleanses one caster penalty and one per living teammate', () => {
  const state = createBattle({
    playerTeam: ['abyssar', 'orakyn', 'virelia'],
    enemyTeam: ['kordane', 'calderoc'],
    seed: 75,
  });
  state.sides.player.surge = 100;
  const [caster, firstAlly, secondAlly] = state.sides.player.team;
  caster.statuses.marked = { appliedTurn: state.turn };
  caster.statuses.rooted = { appliedTurn: state.turn };
  caster.statuses.burning = { appliedTurn: state.turn, stacks: 1 };
  firstAlly.statuses.marked = { appliedTurn: state.turn };
  firstAlly.statuses.rooted = { appliedTurn: state.turn };
  secondAlly.statuses.marked = { appliedTurn: state.turn };
  secondAlly.statuses.rooted = { appliedTurn: state.turn };
  const result = resolveTurn(
    state,
    { type: 'move', moveId: 'shell_bastion' },
    { type: 'move', moveId: 'crystal_strike' }
  );
  const penaltyCount = (creature) =>
    ['marked', 'stunned', 'rooted', 'burning'].filter((id) => creature.statuses[id]).length;
  assert.equal(penaltyCount(result.state.sides.player.team[0]), 2);
  assert.equal(penaltyCount(result.state.sides.player.team[1]), 1);
  assert.equal(penaltyCount(result.state.sides.player.team[2]), 1);
});


test('defensive Signatures spend Surge on distinct team-saving effects', () => {
  const state = createBattle({
    playerTeam: ['virelia', 'orakyn', 'abyssar'],
    enemyTeam: ['kordane', 'calderoc', 'farfombre'],
    seed: 15,
  });
  state.sides.player.surge = 100;
  state.sides.player.team.forEach((creature) => (creature.hp -= 20));
  state.sides.player.team[1].statuses.stunned = { remaining: 2, appliedTurn: state.turn, stacks: 1 };
  state.sides.player.team[0].statuses.marked = { appliedTurn: state.turn };
  const result = resolveTurn(
    state,
    { type: 'move', moveId: 'leaf_mantle' },
    { type: 'move', moveId: 'crystal_strike' }
  );
  assert.equal(
    result.events.filter((event) => event.type === 'barrier' && event.side === 'player').length,
    4
  );
  assert.ok(result.events.filter((event) => event.type === 'heal' && event.side === 'player').length >= 3);
  assert.equal(result.state.sides.player.team[0].statuses.marked, undefined);
  assert.equal(result.state.sides.player.team[1].statuses.stunned, undefined);
  assert.ok(result.events.some((event) => event.type === 'surge' && event.amount === -100));
});

test('knockout skips the second move and requires a free replacement', () => {
  const state = createBattle({
    playerTeam: ['farfombre', 'abyssar', 'virelia'],
    enemyTeam: ['kordane', 'calderoc', 'orakyn'],
    seed: 17,
  });
  state.sides.enemy.team[0].hp = 1;
  const result = resolveTurn(
    state,
    { type: 'move', moveId: 'shade_spark' },
    { type: 'move', moveId: 'crystal_strike' }
  );
  const knockout = result.events.find((e) => e.type === 'ko');
  assert.equal(knockout.hp, 0, 'knockout events expose the resulting HP');
  assert.ok(result.events.some((e) => e.type === 'move-skip'));
  assert.equal(result.state.sides.enemy.pendingReplacement, true);
  const replacement = getLegalActions(result.state, 'enemy')[0];
  assert.equal(replacement.type, 'replace');
  const beforeSurge = result.state.sides.enemy.surge,
    replaced = applyReplacement(result.state, 'enemy', replacement);
  assert.equal(replaced.state.phase, 'choice');
  assert.equal(replaced.state.sides.enemy.surge, beforeSurge);
  assert.equal(activeOf(replaced.state, 'enemy').statuses.focused, undefined);
  assert.equal(replaced.events.some((e) => e.type === 'rally'), false);
});

test('trainer ace powers trigger exactly once when the final enemy enters', () => {
  const state = createBattle({
    playerTeam: ['orakyn', 'abyssar', 'virelia'],
    enemyTeam: ['kordane', 'calderoc', 'farfombre'],
    enemyAce: 'royal_ascension',
    seed: 19,
  });
  state.sides.enemy.team[0].hp = 0;
  state.sides.enemy.team[1].hp = 0;
  state.sides.enemy.active = 0;
  state.sides.enemy.pendingReplacement = true;
  state.phase = 'replacement';
  const result = applyReplacement(state, 'enemy', { type: 'replace', index: 2 }),
    aceEvents = result.events.filter((event) => event.type === 'ace');
  assert.equal(aceEvents.length, 1);
  assert.equal(aceEvents[0].ace, 'royal_ascension');
  assert.equal(result.state.aceTriggered, true);
  assert.equal(result.state.sides.enemy.surge, 100);
  assert.ok(activeOf(result.state, 'enemy').barrier >= 16);
});
test('entry and ace events expose resulting projection values', () => {
  const state = createBattle({
    playerTeam: ['kordane', 'voltide', 'hexalune'],
    enemyTeam: ['kordane', 'calderoc', 'hexalune'],
    enemyAce: 'titanheart',
    seed: 19,
  });
  state.sides.enemy.team[0].hp = 0;
  state.sides.enemy.team[1].hp = 0;
  state.sides.enemy.active = 0;
  state.sides.enemy.pendingReplacement = true;
  state.phase = 'replacement';
  const result = applyReplacement(state, 'enemy', { type: 'replace', index: 2 }),
    replacement = result.events.find((event) => event.type === 'replace'),
    passive = result.events.find((event) => event.type === 'passive' && event.side === 'enemy'),
    ace = result.events.find((event) => event.type === 'ace');
  assert.equal(replacement.activeIndex, 2);
  assert.equal(passive.status, 'marked');
  assert.equal(passive.remaining, 2);
  assert.equal(passive.targetSide, 'player');
  assert.equal(passive.targetCreatureId, activeOf(result.state, 'player').id);
  assert.equal(ace.hp, activeOf(result.state, 'enemy').hp);
  assert.equal(ace.maxHp, activeOf(result.state, 'enemy').maxHp);
  const conductorState = createBattle({
      playerTeam: ['kordane', 'voltide', 'hexalune'],
      enemyTeam: ['kordane', 'calderoc', 'farfombre'],
      seed: 22,
    }),
    conductor = (() => {
      conductorState.sides.player.team[0].hp = 0;
      conductorState.sides.player.active = 0;
      conductorState.sides.player.pendingReplacement = true;
      conductorState.phase = 'replacement';
      return applyReplacement(conductorState, 'player', { type: 'replace', index: 1 }).events.find(
        (event) => event.type === 'passive' && event.side === 'player'
      );
    })();
  assert.equal(conductor.status, 'haste');
  assert.equal(conductor.remaining, 2);
  assert.equal(conductor.stacks, 1);
});


test('the last fighters add no synthetic duel event or reward', () => {
  const state = make();
  state.sides.player.surge = 100;
  state.sides.player.team[1].hp = 0;
  state.sides.player.team[2].hp = 0;
  state.sides.enemy.team[1].hp = 0;
  state.sides.enemy.team[2].hp = 0;
  const result = resolveTurn(
    state,
    { type: 'move', moveId: 'oracle_veil' },
    { type: 'move', moveId: 'resonant_focus' }
  );
  assert.equal(result.events.filter((event) => event.type === 'final-duel').length, 0);
  assert.equal('finalDuelTriggered' in result.state, false);
  assert.equal(
    result.events.some((event) => event.type === 'surge' && event.source === 'final-duel'),
    false
  );
});

test('battle end and turn-cap conscious-count/HP/tie rules', () => {
  let state = make();
  state.sides.enemy.team.forEach((c) => (c.hp = 0));
  state.sides.enemy.team[0].hp = 1;
  let result = resolveTurn(
    state,
    { type: 'move', moveId: 'lucid_arc' },
    { type: 'move', moveId: 'crystal_strike' }
  );
  assert.equal(result.state.winner, 'player');
  assert.equal(result.state.reason, 'knockout');
  state = make();
  state.turn = TURN_CAP;
  state.sides.player.surge = 100;
  state.sides.enemy.team[2].hp = 0;
  result = resolveTurn(
    state,
    { type: 'move', moveId: 'oracle_veil' },
    { type: 'move', moveId: 'resonant_focus' }
  );
  assert.equal(result.state.winner, 'player');
  assert.equal(result.state.reason, 'turn-cap');
  const tieA = make();
  tieA.turn = TURN_CAP;
  tieA.sides.player.surge = 100;
  const tieB = structuredClone(tieA);
  assert.equal(
    resolveTurn(tieA, { type: 'move', moveId: 'oracle_veil' }, { type: 'move', moveId: 'resonant_focus' })
      .state.winner,
    resolveTurn(tieB, { type: 'move', moveId: 'oracle_veil' }, { type: 'move', moveId: 'resonant_focus' })
      .state.winner
  );
});

test('turns 29 through 40 add no synthetic pressure events', () => {
  for (const turn of [29, 35, TURN_CAP]) {
    const state = make();
    state.turn = turn;
    state.sides.player.surge = 100;
    const result = resolveTurn(
      state,
      { type: 'move', moveId: 'oracle_veil' },
      { type: 'move', moveId: 'resonant_focus' }
    );
    assert.equal(
      result.events.some((event) => event.type === 'status-tick'),
      false
    );
    assert.equal(
      result.events.some((event) => event.type === 'damage'),
      false
    );
    assert.equal('lateTurnPressure' in result.state, false);
  }
});

test('Eclipse of Grace purges every enemy boost and barrier after counterplay', () => {
  const state = createBattle({
    playerTeam: ['deuilastre', 'orakyn', 'kordane'],
    enemyTeam: ['aubeastre', 'virelia', 'pactigon'],
    seed: 4,
  });
  state.sides.player.surge = 100;
  for (const creature of state.sides.enemy.team) {
    creature.barrier = 11;
    creature.statuses = {
      focused: { appliedTurn: 0 },
      haste: { appliedTurn: 0, remaining: 3 },
      evasive: { appliedTurn: 0 },
      countering: { appliedTurn: 0 },
      burning: { appliedTurn: 0, remaining: 3, stacks: 1 },
    };
  }
  const result = resolveTurn(
    state,
    { type: 'move', moveId: 'eclipse_of_grace' },
    { type: 'move', moveId: 'kindred_halo' }
  );
  assert.ok(result.events.some((event) => event.type === 'miss'), 'Evasive answers the hit first');
  for (const creature of result.state.sides.enemy.team) {
    assert.equal(creature.barrier, 0);
    assert.deepEqual(Object.keys(creature.statuses), ['burning']);
  }
  assert.equal(
    result.events.filter((event) => event.type === 'barrier-break' && event.source === 'purge').length,
    3
  );
});

test('Immaculate Relay protects its chosen ally until after actions and grants no switch rewards', () => {
  const state = createBattle({
    playerTeam: ['aubeastre', 'deuilastre', 'pactigon'],
    enemyTeam: ['orakyn', 'kordane', 'virelia'],
    seed: 9,
  });
  state.sides.player.surge = 100;
  state.sides.player.team[1].statuses = {
    marked: { appliedTurn: 0, remaining: 2 },
    burning: { appliedTurn: 0, remaining: 2, stacks: 1 },
  };
  const variants = getLegalActions(state, 'player').filter(
    (action) => action.moveId === 'immaculate_relay'
  );
  assert.deepEqual(
    variants.map(({ allyIndex }) => allyIndex),
    [1, 2]
  );
  assert.throws(
    () =>
      resolveTurn(
        state,
        { type: 'move', moveId: 'immaculate_relay', allyIndex: 0 },
        { type: 'move', moveId: 'lucid_arc' }
      ),
    /Illegal/
  );
  const result = resolveTurn(
    state,
    variants[0],
    { type: 'move', moveId: 'lucid_arc' }
  );
  const outgoing = result.state.sides.player.team[0],
    incoming = result.state.sides.player.team[1];
  assert.ok(outgoing.hp < outgoing.maxHp);
  assert.equal(incoming.hp, incoming.maxHp);
  assert.equal(result.state.sides.player.active, 1);
  assert.deepEqual(Object.keys(incoming.statuses), ['focused']);
  assert.equal(incoming.barrier, 0);
  assert.equal(result.state.sides.player.pendingReplacement, false);
  assert.ok(
    result.events.find((event) => event.type === 'switch' && event.source === 'signature')
  );
  assert.equal(
    result.events.some(
      (event) =>
        event.type === 'surge' && ['switch', 'perfect-relay'].includes(event.source)
    ),
    false
  );
  assert.equal(result.state.sides.player.surge, 19, '11 resolve Surge plus Benevolent Omen');
});

test('Immaculate Relay still completes after Aubéastre is knocked out', () => {
  const state = createBattle({
    playerTeam: ['aubeastre', 'deuilastre', 'pactigon'],
    enemyTeam: ['solflare', 'kordane', 'virelia'],
    seed: 2,
  });
  state.sides.player.surge = 100;
  state.sides.player.team[0].hp = 1;
  const relay = getLegalActions(state, 'player').find(
    (action) => action.moveId === 'immaculate_relay' && action.allyIndex === 1
  );
  const result = resolveTurn(state, relay, { type: 'move', moveId: 'sun_spear' });
  assert.equal(result.state.sides.player.team[0].hp, 0);
  assert.equal(result.state.sides.player.active, 1);
  assert.equal(result.state.sides.player.pendingReplacement, false);
});

test('the four new roster talents trigger at their deterministic engine hooks', () => {
  let state = createBattle({
    playerTeam: ['flambelier', 'mareclat', 'pactigon'],
    enemyTeam: ['kordane', 'orakyn', 'virelia'],
    seed: 6,
  });
  let result = resolveTurn(
    state,
    { type: 'move', moveId: 'ember_feint' },
    { type: 'move', moveId: 'crystal_strike' }
  );
  assert.ok(result.state.sides.enemy.team[0].statuses.burning);
  assert.ok(result.events.some((event) => event.type === 'passive' && event.passive === 'burning_code'));

  state = createBattle({
    playerTeam: ['mareclat', 'flambelier', 'pactigon'],
    enemyTeam: ['kordane', 'orakyn', 'virelia'],
    seed: 6,
  });
  result = resolveTurn(
    state,
    { type: 'move', moveId: 'foam_foil' },
    { type: 'move', moveId: 'crystal_strike' }
  );
  assert.ok(result.events.some((event) => event.type === 'miss'));
  assert.ok(result.state.sides.player.team[0].statuses.haste);

  state = createBattle({
    playerTeam: ['xylocorne', 'flambelier', 'pactigon'],
    enemyTeam: ['kordane', 'orakyn', 'virelia'],
    seed: 6,
  });
  state.sides.enemy.team[0].barrier = 10;
  result = resolveTurn(
    state,
    { type: 'move', moveId: 'heartwood_breach' },
    { type: 'move', moveId: 'resonant_focus' }
  );
  assert.equal(result.state.sides.enemy.team[0].barrier, 4);
  assert.ok(result.state.sides.enemy.team[0].hp < result.state.sides.enemy.team[0].maxHp);
  assert.ok(
    result.events.some(
      (event) => event.type === 'barrier-break' && event.source === 'passive' && event.amount === 6
    )
  );

  state = createBattle({
    playerTeam: ['pactigon', 'flambelier', 'mareclat'],
    enemyTeam: ['kordane', 'orakyn', 'virelia'],
    seed: 6,
  });
  state.sides.player.team[0].hp -= 20;
  state.sides.player.team[1].hp -= 40;
  result = resolveTurn(
    state,
    { type: 'move', moveId: 'pulse_punch' },
    { type: 'move', moveId: 'resonant_focus' }
  );
  assert.equal(result.state.sides.player.team[1].barrier, 4);
  assert.ok(result.events.some((event) => event.type === 'passive' && event.passive === 'shared_breath'));
});
