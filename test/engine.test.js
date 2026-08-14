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
  assert.equal(state.sides.player.team[0].statuses.marked, undefined, 'Marked is consumed by a damaging hit');
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

test('prepared finishers expose combo and detonation semantics', () => {
  const state = createBattle({
    playerTeam: ['thornox', 'mossaur', 'florafae'],
    enemyTeam: ['monolith', 'kordane', 'brontusk'],
    seed: 67,
  });
  state.sides.player.surge = 100;
  state.sides.enemy.team[0].statuses.burning = { remaining: 3, appliedTurn: 0, stacks: 2 };
  assert.ok(previewMove(state, 'player', 'venom_harvest').combo.includes('burning'));
  const result = resolveTurn(
    state,
    { type: 'move', moveId: 'venom_harvest' },
    { type: 'move', moveId: 'gravity_fist' }
  );
  assert.ok(result.events.some((e) => e.type === 'status' && e.status === 'burning' && e.detonated));
  assert.ok(result.events.some((e) => e.type === 'damage' && e.combo.includes('burning')));
  assert.equal(result.state.sides.enemy.team[0].statuses.burning, undefined);
});

test('a teammate converting an authored setup triggers an assist and Surge', () => {
  const state = createBattle({
    playerTeam: ['pyrolynx', 'orakyn', 'virelia'],
    enemyTeam: ['monolith', 'kordane', 'brontusk'],
    seed: 68,
  });
  state.sides.player.surge = 80;
  const plain = previewMove(state, 'player', 'ninefold_inferno');
  state.sides.enemy.team[0].statuses.marked = {
    remaining: 2,
    appliedTurn: 0,
    stacks: 1,
    sourceCreatureId: 'orakyn',
  };
  const preview = previewMove(state, 'player', 'ninefold_inferno');
  assert.deepEqual(preview.assists, ['orakyn']);
  assert.ok(preview.combo.includes('marked'));
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
  assert.ok(hits[0].rawAmount > hits[1].rawAmount);
  assert.ok(hits.slice(1).every((hit) => hit.rawAmount === hits[1].rawAmount));
  assert.equal(result.state.sides.enemy.team[0].statuses.marked, undefined);
  assert.equal(result.events.filter((event) => event.type === 'assist').length, 1);
  assert.equal(
    result.events.filter((event) => event.type === 'surge' && event.source === 'assist').length,
    1
  );
  assert.ok(
    result.events.some((event) => event.type === 'surge' && event.source === 'assist' && event.amount === 8)
  );
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
  state.sides.player.team[1].hp -= 30;
  state.sides.player.team[2].hp -= 20;
  state.sides.player.active = 1;
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

test('defensive Signatures spend Surge on distinct team-saving effects', () => {
  const state = createBattle({
    playerTeam: ['virelia', 'orakyn', 'abyssar'],
    enemyTeam: ['kordane', 'calderoc', 'farfombre'],
    seed: 15,
  });
  state.sides.player.surge = 100;
  state.sides.player.team.forEach((creature) => (creature.hp -= 20));
  state.sides.player.team[1].statuses.stunned = { remaining: 2, appliedTurn: state.turn, stacks: 1 };
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
  assert.ok(result.events.some((e) => e.type === 'ko'));
  assert.ok(result.events.some((e) => e.type === 'move-skip'));
  assert.equal(result.state.sides.enemy.pendingReplacement, true);
  const replacement = getLegalActions(result.state, 'enemy')[0];
  assert.equal(replacement.type, 'replace');
  const beforeSurge = result.state.sides.enemy.surge,
    replaced = applyReplacement(result.state, 'enemy', replacement);
  assert.equal(replaced.state.phase, 'choice');
  assert.equal(replaced.state.sides.enemy.surge, beforeSurge);
  assert.equal(activeOf(replaced.state, 'enemy').statuses.focused, undefined);
  assert.ok(replaced.events.some((e) => e.type === 'rally'));
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

test('the last fighters enter one symmetric Final Duel exactly once', () => {
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
  assert.equal(result.events.filter((event) => event.type === 'final-duel').length, 1);
  assert.equal(result.state.finalDuelTriggered, true);
  assert.equal(
    result.events.some((event) => event.type === 'surge' && event.source === 'final-duel'),
    false
  );
  const again = resolveTurn(
    result.state,
    { type: 'move', moveId: 'lucid_arc' },
    { type: 'move', moveId: 'crystal_strike' }
  );
  assert.equal(
    again.events.some((event) => event.type === 'final-duel'),
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
