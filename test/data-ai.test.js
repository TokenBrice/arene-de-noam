import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATURES, CREATURE_IDS } from '../src/data/creatures.js';
import { MOVES } from '../src/data/moves.js';
import { PASSIVES, PASSIVE_IDS } from '../src/data/passives.js';
import { CLASSES, CLASS_IDS, CLASS_ORDER } from '../src/data/classes.js';
import { AFFINITY_ORDER } from '../src/data/affinities.js';
import { TRIALS } from '../src/data/trials.js';
import { GAUNTLET_BOONS, GAUNTLET_STAGES } from '../src/data/gauntlet.js';
import { SQUAD_PRESETS } from '../src/data/squads.js';
import { QUICK_RULES, quickRule } from '../src/data/battle-rules.js';
import { battleAchievementSignals } from '../src/data/progression.js';
import { comboSetupStatus, moveCanCombo, teamComboRoutes } from '../src/data/combos.js';
import { TRAINERS } from '../src/data/trainers.js';
import { CIRCUIT_CONDITIONS, circuitMatch } from '../src/data/circuit.js';
import { createDraft } from '../src/data/draft.js';
import {
  PROFILE_AXES,
  REMIX_DITHER_MAX,
  bestLeadIndex,
  remixTeam,
  teamProfile,
} from '../src/data/team-profile.js';
import { chooseAiAction } from '../src/battle/ai.js';
import { createBattle, getLegalActions, resolveTurn } from '../src/battle/engine.js';
import {
  NEGATIVE_STATUSES,
  POSITIVE_STATUSES,
  STATUS_DEFINITIONS,
  STATUS_DISPLAY_ORDER,
  statusIcon,
} from '../src/battle/statuses.js';

const SURVIVING_STATUSES = new Set([
  'focused',
  'haste',
  'evasive',
  'countering',
  'marked',
  'stunned',
  'rooted',
  'burning',
]);

test('thirty creatures each reference exactly three authored owner moves', () => {
  assert.equal(CREATURE_IDS.length, 30);
  assert.equal(Object.keys(MOVES).length, 90);
  for (const id of CREATURE_IDS) {
    assert.equal(CREATURES[id].moves.length, 3);
    assert.equal(new Set(CREATURES[id].moves).size, 3);
    for (const move of CREATURES[id].moves) {
      assert.ok(MOVES[move]);
      assert.equal(MOVES[move].owner, id);
    }
  }
});

test('every creature owns one named innate talent', () => {
  assert.equal(PASSIVE_IDS.length, 30);
  assert.equal(new Set(PASSIVE_IDS).size, 30);
  assert.equal(new Set(CREATURE_IDS.map((id) => CREATURES[id].passive)).size, 30);
  for (const id of CREATURE_IDS) assert.ok(PASSIVES[CREATURES[id].passive]);
});

test('six classes classify the full roster without legacy roles or singletons', () => {
  assert.equal(CLASS_ORDER.length, 6);
  assert.deepEqual(new Set(CLASS_ORDER), new Set(CLASS_IDS));
  const classCounts = CLASS_ORDER.map(
    (classId) => CREATURE_IDS.filter((id) => CREATURES[id].classId === classId).length
  );
  assert.deepEqual(
    [...classCounts].sort((a, b) => a - b),
    [3, 5, 5, 5, 6, 6]
  );
  assert.ok(classCounts.every((count) => count >= 2));
  assert.deepEqual(
    AFFINITY_ORDER.map((affinity) => CREATURE_IDS.filter((id) => CREATURES[id].affinity === affinity).length),
    [5, 5, 5, 5, 5, 5]
  );
  for (const creature of Object.values(CREATURES)) {
    assert.ok(CLASSES[creature.classId]);
    assert.equal('role' in creature, false);
  }
});

test('composition has no mechanical bond data or battle opening effects', () => {
  const state = createBattle({
    playerTeam: ['ferrax', 'pyrolynx', 'riptalon'],
    enemyTeam: ['thornox', 'mossaur', 'florafae'],
  });
  assert.equal(state.sides.player.surge, 30);
  assert.equal(state.sides.enemy.surge, 30);
  assert.equal('bonds' in state.sides.player, false);
});

test('all moves have unique mechanical and visual identities', () => {
  const mechanics = Object.values(MOVES).map(({ id, owner, visual, signature, ...rest }) =>
    JSON.stringify(rest)
  );
  assert.equal(new Set(mechanics).size, mechanics.length, 'no move may be a renamed mechanical clone');
  assert.equal(
    new Set(Object.values(MOVES).map((move) => move.visual)).size,
    90,
    'every move owns a visual choreography id'
  );
});

test('move sustain stays inside the decisive-fight budget', () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.values(MOVES)
        .filter((move) => move.barrier)
        .map((move) => [move.id, move.barrier])
    ),
    {
      oracle_veil: 18,
      deja_vu: 9,
      mirror_maze: 9,
      iron_resolve: 17,
      fortress_protocol: 14,
      abyssal_surge: 4,
      shell_bastion: 30,
      bubble_burst: 3,
      ember_armor: 8,
      leaf_mantle: 8,
      ancient_bark: 17,
      shadow_shed: 12,
      moonless_omen: 8,
    }
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.values(MOVES)
        .filter((move) => move.healRatio)
        .map((move) => [move.id, move.healRatio])
    ),
    { furnace_heart: 0.08, ash_rebirth: 0.18, seed_bloom: 0.23 }
  );
  assert.ok(Object.values(MOVES).every((move) => !move.drain || move.drain <= 0.25));
  assert.ok(
    Object.values(MOVES).every(
      (move) => !move.selfStatuses?.some((status) => status.id === 'evasive') || (move.barrier || 0) <= 18
    )
  );
  assert.equal(MOVES.leaf_mantle.teamBarrier, 7);
  assert.deepEqual(
    [MOVES.petal_ray, MOVES.healing_rain, MOVES.leaf_mantle, MOVES.nectar_circle].map(
      (move) => move.teamHealRatio
    ),
    [0.03, 0.065, 0.04, 0.08]
  );
});

test('every creature owns exactly one mechanically meaningful Signature', () => {
  for (const id of CREATURE_IDS) {
    const signatures = CREATURES[id].moves.map((moveId) => MOVES[moveId]).filter((move) => move.signature);
    assert.equal(signatures.length, 1, `${id} needs one Signature`);
    const move = signatures[0];
    assert.ok(
      move.power > 0 ||
        move.barrier ||
        move.teamBarrier ||
        move.teamHealRatio ||
        move.selfStatuses?.length ||
        move.allySwitch,
      `${move.id} needs a decisive effect`
    );
  }
  assert.equal(
    Object.values(MOVES).filter((move) => move.signature && move.kind !== 'damage').length,
    9,
    'ultimates should include defensive and healing fantasies'
  );
});

test('twelve trainer teams and their badges are authored and legal', () => {
  assert.equal(TRAINERS.length, 12);
  assert.equal(new Set(TRAINERS.map((x) => x.id)).size, 12);
  assert.equal(
    new Set(TRAINERS.map((trainer) => trainer.ace)).size,
    12,
    'every rival needs a distinct ace phase'
  );
  for (const trainer of TRAINERS) {
    assert.equal(trainer.team.length, 3);
    assert.equal(new Set(trainer.team).size, 3);
    trainer.team.forEach((id) => assert.ok(CREATURES[id]));
    assert.equal(trainer.colors.length, 2);
    assert.ok(trainer.badge);
    assert.ok(trainer.ace);
    if (trainer.circuitTeam) {
      assert.equal(trainer.circuitTeam.length, 3);
      assert.equal(new Set(trainer.circuitTeam).size, 3);
      trainer.circuitTeam.forEach((id) => assert.ok(CREATURES[id]));
      assert.ok(trainer.circuitTeam[trainer.circuitLead ?? 0]);
    }
  }
  assert.deepEqual(
    TRAINERS.map((trainer) => trainer.difficulty),
    [...Array(4).fill('apprentice'), ...Array(4).fill('standard'), ...Array(4).fill('champion')]
  );
});

test('six mythic trials have legal teams and distinct rule sets', () => {
  assert.equal(TRIALS.length, 6);
  assert.equal(new Set(TRIALS.map((x) => x.id)).size, 6);
  for (const trial of TRIALS) {
    assert.equal(trial.enemyTeam.length, 3);
    trial.enemyTeam.forEach((id) => assert.ok(CREATURES[id]));
    assert.ok(trial.modifiers.length);
    assert.equal(trial.difficulty, 'champion');
  }
});

test('Champion Circuit rotates six conditions across all twelve rivals', () => {
  assert.equal(CIRCUIT_CONDITIONS.length, 6);
  assert.equal(new Set(CIRCUIT_CONDITIONS.map((item) => item.modifiers.join(','))).size, 6);
  const firstCycle = Array.from({ length: 12 }, (_, wins) => circuitMatch(wins, TRAINERS.length));
  assert.equal(new Set(firstCycle.map((match) => match.trainerIndex)).size, 12);
  assert.equal(firstCycle[0].round, 1);
  assert.equal(firstCycle[11].round, 12);
  for (const match of firstCycle) {
    assert.ok(TRAINERS[match.trainerIndex]);
    assert.ok(match.condition.modifiers.length);
    assert.equal(match.difficulty, 'champion');
  }
});

test('the gauntlet escalates through three legal teams and four distinct boons', () => {
  assert.equal(GAUNTLET_STAGES.length, 3);
  assert.equal(GAUNTLET_BOONS.length, 4);
  assert.equal(new Set(GAUNTLET_BOONS.map((x) => x.modifier)).size, 4);
  GAUNTLET_STAGES.forEach((stage, index) => {
    assert.equal(stage.enemyTeam.length, 3);
    stage.enemyTeam.forEach((id) => assert.ok(CREATURES[id]));
    if (index) assert.ok(stage.modifiers.length);
    assert.equal(stage.difficulty, 'standard');
  });
});

test('the daily Draft publishes Standard as its default AI tier', () => {
  assert.equal(createDraft(20260814).difficulty, 'standard');
});

test('eight signature squads are legal, distinct, and contain only team and lead setup', () => {
  assert.equal(SQUAD_PRESETS.length, 8);
  assert.equal(new Set(SQUAD_PRESETS.map((x) => x.team.join(','))).size, 8);
  SQUAD_PRESETS.forEach((preset) => {
    assert.equal(preset.team.length, 3);
    assert.equal(new Set(preset.team).size, 3);
    preset.team.forEach((id) => assert.ok(CREATURES[id]));
    assert.ok(preset.team[preset.lead]);
    assert.equal('doctrine' in preset, false);
  });
});

test('the Team Compass exposes bounded and distinct squad identities', () => {
  for (const preset of SQUAD_PRESETS) {
    const profile = teamProfile(preset.team);
    assert.ok(PROFILE_AXES.includes(profile.dominant));
    for (const axis of PROFILE_AXES)
      assert.ok(profile[axis] >= 0 && profile[axis] <= 100, `${preset.id} ${axis} must fit the compass`);
  }
  assert.equal(teamProfile(['ferrax', 'pyrolynx', 'riptalon']).dominant, 'tempo');
  assert.equal(teamProfile(['florafae', 'thornox', 'mnemora']).dominant, 'tempo');
  assert.equal(teamProfile(['orakyn', 'abyssar', 'virelia']).dominant, 'sustain');
  assert.deepEqual(teamProfile([]), { pressure: 0, control: 0, sustain: 0, tempo: 0, dominant: 'pressure' });
});

test('smart remix builds deterministic tactical trios and scouts their lead', () => {
  const enemy = ['kordane', 'calderoc', 'farfombre'],
    first = remixTeam(enemy, 101),
    repeat = remixTeam(enemy, 101),
    alternatives = new Set(
      Array.from({ length: 8 }, (_, seed) => remixTeam(enemy, seed + 200).team.join(','))
    );
  assert.deepEqual(first, repeat);
  assert.equal(first.team.length, 3);
  assert.equal(new Set(first.team).size, 3);
  first.team.forEach((id) => assert.ok(CREATURES[id]));
  assert.equal(first.lead, bestLeadIndex(first.team, enemy));
  assert.deepEqual(Object.keys(first).sort(), ['lead', 'team']);
  assert.ok(alternatives.size >= 3, 'different remix seeds should explore the roster');
  assert.ok(REMIX_DITHER_MAX <= 5, 'random dither must not outweigh tactical scoring');
});

test('six quick battle rules are symmetric, distinct, and engine-backed', () => {
  assert.equal(QUICK_RULES.length, 6);
  assert.equal(new Set(QUICK_RULES.map((rule) => rule.modifiers.join(','))).size, 6);
  assert.equal(quickRule('missing').id, 'standard');
  const fortress = createBattle({
    playerTeam: ['orakyn', 'abyssar', 'virelia'],
    enemyTeam: ['kordane', 'calderoc', 'farfombre'],
    modifiers: quickRule('fortress_duel').modifiers,
  });
  assert.ok(fortress.sides.player.team.every((creature) => creature.barrier >= 18));
  assert.ok(fortress.sides.enemy.team.every((creature) => creature.barrier >= 18));
  const storm = createBattle({
    playerTeam: ['orakyn', 'abyssar', 'virelia'],
    enemyTeam: ['kordane', 'calderoc', 'farfombre'],
    modifiers: quickRule('starstorm').modifiers,
  });
  assert.equal(storm.sides.player.surge, 100);
  assert.equal(storm.sides.enemy.surge, 100);
  const relay = createBattle({
      playerTeam: ['orakyn', 'abyssar', 'virelia'],
      enemyTeam: ['kordane', 'calderoc', 'farfombre'],
      modifiers: quickRule('relay_rush').modifiers,
    }),
    before = relay.sides.player.surge,
    switched = resolveTurn(relay, { type: 'switch', index: 1 }, { type: 'move', moveId: 'crystal_strike' });
  assert.ok(switched.state.sides.player.surge >= before + 24);
  assert.ok(switched.state.sides.player.team[1].statuses.haste);
});

test('five silent battle achievement signals track only their intended semantic events', () => {
  const history = [
    { type: 'damage', sourceSide: 'player', amount: 150 },
    { type: 'damage', sourceSide: 'enemy', amount: 90 },
    ...Array.from({ length: 5 }, () => ({ type: 'status', side: 'enemy', applied: true })),
    { type: 'surge', side: 'player', source: 'signature' },
    { type: 'heal', side: 'player', amount: 30 },
    { type: 'barrier', side: 'player', amount: 25 },
    { type: 'switch', side: 'player' },
    { type: 'switch', side: 'player' },
  ];
  assert.deepEqual(battleAchievementSignals(history), {
    onslaught: true,
    tactician: true,
    signature: true,
    guardian: true,
    relay: true,
  });
  assert.deepEqual(battleAchievementSignals([]), {
    onslaught: false,
    tactician: false,
    signature: false,
    guardian: false,
    relay: false,
  });
});

test('team combo routes expose cross-creature setups and never self-credit', () => {
  const routes = teamComboRoutes(['orakyn', 'pyrolynx', 'virelia']);
  assert.ok(
    routes.some(
      (route) =>
        route.setterId === 'orakyn' &&
        route.setupMoveId === 'lucid_arc' &&
        route.finisherId === 'pyrolynx' &&
        route.finishMoveId === 'ninefold_inferno'
    )
  );
  assert.ok(routes.every((route) => route.setterId !== route.finisherId));
  assert.ok(routes.every((route) => !('statuses' in route) && !('detonation' in route)));
  assert.ok(
    teamComboRoutes(['calderoc', 'thornox']).some(
      (route) => route.setupMoveId === 'cinder_burst' && route.finishMoveId === 'venom_harvest'
    )
  );
  assert.deepEqual(teamComboRoutes(['kordane', 'monolith', 'virelia']), []);
});

test('move status data uses exactly the eight-status contract', () => {
  assert.deepEqual(Object.keys(STATUS_DEFINITIONS), [...SURVIVING_STATUSES]);
  assert.deepEqual(STATUS_DISPLAY_ORDER, [
    'focused',
    'haste',
    'evasive',
    'countering',
    'marked',
    'rooted',
    'stunned',
    'burning',
  ]);
  const expectedMetadata = {
    focused: { positive: true, color: '#1DA1F2', iconKey: 'eye' },
    haste: { positive: true, color: '#C6FF00', iconKey: 'wing' },
    evasive: { positive: true, color: '#304FFE', iconKey: 'ghost' },
    countering: { positive: true, color: '#00E0A4', iconKey: 'shield-arrow' },
    marked: { positive: false, color: '#AD1457', iconKey: 'target-lock' },
    stunned: { positive: false, color: '#FFEA70', iconKey: 'dizzy-stars' },
    rooted: { positive: false, color: '#9C5B32', iconKey: 'roots' },
    burning: { positive: false, color: '#F4511E', iconKey: 'flame' },
  };
  const metadata = Object.fromEntries(
    Object.entries(STATUS_DEFINITIONS).map(([id, { positive, color, iconKey }]) => [
      id,
      { positive, color, iconKey },
    ])
  );
  assert.deepEqual(metadata, expectedMetadata);
  const colors = Object.values(STATUS_DEFINITIONS).map(({ color }) => color),
    iconKeys = Object.values(STATUS_DEFINITIONS).map(({ iconKey }) => iconKey);
  assert.equal(new Set(colors).size, 8);
  assert.equal(new Set(iconKeys).size, 8);
  assert.ok(colors.every((color) => /^#[0-9A-F]{6}$/.test(color)));
  for (const [id, definition] of Object.entries(STATUS_DEFINITIONS)) {
    const icon = statusIcon(id);
    assert.equal((icon.match(/<svg\b/g) || []).length, 1);
    assert.match(icon, new RegExp(`status-icon-${definition.iconKey}`));
    assert.match(icon, /aria-hidden="true"/);
    assert.doesNotMatch(icon, /[\uD800-\uDFFF]/);
  }
  assert.equal(POSITIVE_STATUSES.length, 4);
  assert.equal(NEGATIVE_STATUSES.length, 4);
  for (const move of Object.values(MOVES))
    for (const field of ['targetStatuses', 'selfStatuses', 'teamStatuses', 'consume'])
      for (const entry of move[field] || []) {
        const id = typeof entry === 'string' ? entry : entry.id;
        assert.ok(SURVIVING_STATUSES.has(id), `${move.id}.${field} contains ${id}`);
        if (typeof entry !== 'string' && entry.stacks != null) assert.equal(id, 'burning');
      }
  for (const move of Object.values(MOVES))
    for (const entry of move.allySwitch?.statuses || [])
      assert.ok(SURVIVING_STATUSES.has(entry.id), `${move.id}.allySwitch contains ${entry.id}`);
  assert.equal(STATUS_DEFINITIONS.burning.maxStacks, 2);
  assert.ok(
    Object.entries(STATUS_DEFINITIONS).every(([id, definition]) => id === 'burning' || !definition.stackable)
  );
  const comboMoves = Object.values(MOVES).filter(moveCanCombo);
  assert.equal(comboMoves.length, 9);
  for (const move of Object.values(MOVES)) {
    for (const legacy of ['bonusAgainst', 'bonusMultiplier', 'detonate', 'detonatePower'])
      assert.equal(legacy in move, false, `${move.id} still has ${legacy}`);
    if (!moveCanCombo(move)) continue;
    assert.ok(move.power > 0);
    assert.ok(SURVIVING_STATUSES.has(comboSetupStatus(move)));
    assert.equal(move.targetStatuses?.some(({ id }) => id === comboSetupStatus(move)) || false, false);
  }
});

test('every AI difficulty chooses legal actions while mutating only the deterministic RNG cursor', () => {
  const state = createBattle({
    playerTeam: ['orakyn', 'abyssar', 'virelia'],
    enemyTeam: ['kordane', 'calderoc', 'farfombre'],
    seed: 91,
  });
  const before = structuredClone(state);
  for (const difficulty of ['apprentice', 'standard', 'challenger', 'champion'])
    for (const style of ['direct', 'speed', 'endurance', 'control', 'pressure', 'deception', 'champion']) {
      const action = chooseAiAction(state, 'enemy', difficulty, style);
      assert.ok(getLegalActions(state, 'enemy').some((x) => JSON.stringify(x) === JSON.stringify(action)));
    }
  const rngState = state.rngState;
  delete state.rngState;
  delete before.rngState;
  assert.deepEqual(state, before);
  assert.notEqual(rngState, 91);
  assert.equal('playerAction' in state, false);
});

test('Champion AI selects the useful protected-relay target as one complete legal action', () => {
  const state = createBattle({
    playerTeam: ['kordane', 'orakyn', 'virelia'],
    enemyTeam: ['aubeastre', 'deuilastre', 'pactigon'],
    seed: 12,
  });
  state.sides.enemy.surge = 100;
  state.sides.enemy.team[0].hp = 20;
  state.sides.enemy.team[1].statuses = {
    marked: { appliedTurn: 0, remaining: 2 },
    burning: { appliedTurn: 0, remaining: 2, stacks: 1 },
  };
  const before = structuredClone(state),
    action = chooseAiAction(state, 'enemy', 'champion', 'endurance');
  assert.deepEqual(action, { type: 'move', moveId: 'immaculate_relay', allyIndex: 1 });
  assert.ok(
    getLegalActions(before, 'enemy').some((candidate) => JSON.stringify(candidate) === JSON.stringify(action))
  );
  assert.deepEqual({ ...state, rngState: before.rngState }, before);
});

test('successive tied AI decisions advance RNG and replay identically from the same seed', () => {
  const makeTiedState = () => {
    const state = createBattle({
      playerTeam: ['orakyn', 'kordane', 'calderoc'],
      enemyTeam: ['voltide', 'abyssar', 'virelia'],
      seed: 1,
    });
    state.phase = 'replacement';
    state.sides.player.pendingReplacement = true;
    state.sides.player.team[0].hp = 0;
    state.sides.player.team[2] = structuredClone(state.sides.player.team[1]);
    return state;
  };
  const first = makeTiedState(),
    replay = makeTiedState(),
    decideThree = (state) =>
      Array.from({ length: 3 }, () => chooseAiAction(state, 'player', 'champion', 'direct').index);
  assert.deepEqual(decideThree(first), [1, 1, 2]);
  assert.deepEqual(decideThree(replay), [1, 1, 2]);
  assert.equal(first.rngState, replay.rngState);
  assert.notEqual(first.rngState, 1);
});

test('Champion AI saves defensive Signatures for genuine team pressure', () => {
  const state = createBattle({
    playerTeam: ['virelia', 'abyssar', 'orakyn'],
    enemyTeam: ['kordane', 'calderoc', 'farfombre'],
    seed: 92,
  });
  state.sides.player.surge = 100;
  state.rngState = 123456789;
  state.sides.player.team.forEach((creature) => (creature.hp = Math.round(creature.maxHp * 0.5)));
  state.sides.player.team[1].statuses.stunned = { remaining: 2, appliedTurn: state.turn, stacks: 1 };
  const before = structuredClone(state),
    action = chooseAiAction(state, 'player', 'champion', 'endurance');
  assert.deepEqual(action, { type: 'move', moveId: 'leaf_mantle' });
  before.rngState = state.rngState;
  assert.deepEqual(state, before);
});

test('Champion AI can pivot into a resistant bench answer to a ready Signature', () => {
  const state = createBattle({
    playerTeam: ['lumivox', 'abyssar', 'virelia'],
    enemyTeam: ['orakyn', 'prismage', 'farfombre'],
    seed: 13,
  });
  state.sides.player.surge = 100;
  state.rngState = 123456789;
  const before = structuredClone(state),
    champion = chooseAiAction(state, 'enemy', 'champion', 'direct');
  assert.deepEqual(champion, { type: 'switch', index: 2 });
  assert.equal(state.sides.enemy.team[champion.index].id, 'farfombre');
  before.rngState = state.rngState;
  assert.deepEqual(state, before);
});

test('Champion replacement scoring prefers an available Combo finisher', () => {
  const makeState = (marked, cooldown = false) => {
    const state = createBattle({
      playerTeam: ['calderoc', 'pyrolynx', 'magmoth'],
      enemyTeam: ['monolith', 'kordane', 'brontusk'],
      seed: 3,
    });
    state.phase = 'replacement';
    state.sides.player.pendingReplacement = true;
    state.sides.player.team[0].hp = 0;
    state.sides.player.team[1].hp = Math.round(state.sides.player.team[1].maxHp * 0.6);
    state.sides.player.surge = 100;
    if (marked) state.sides.enemy.team[0].statuses.marked = { appliedTurn: 1, remaining: 2, stacks: 1 };
    if (cooldown) state.sides.player.team[1].cooldowns.ninefold_inferno = { appliedTurn: 1, remaining: 2 };
    return state;
  };
  assert.deepEqual(chooseAiAction(makeState(false), 'player', 'champion', 'direct'), {
    type: 'replace',
    index: 2,
  });
  assert.deepEqual(chooseAiAction(makeState(true), 'player', 'champion', 'direct'), {
    type: 'replace',
    index: 1,
  });
  assert.deepEqual(chooseAiAction(makeState(true, true), 'player', 'champion', 'direct'), {
    type: 'replace',
    index: 2,
  });
});

test('Standard AI cannot inspect a player action committed outside its safe snapshot', () => {
  const hiddenMove = createBattle({
      playerTeam: ['orakyn', 'abyssar', 'virelia'],
      enemyTeam: ['kordane', 'calderoc', 'farfombre'],
      seed: 77,
    }),
    hiddenSwitch = structuredClone(hiddenMove);
  hiddenMove.playerAction = { type: 'move', moveId: 'lucid_arc' };
  hiddenSwitch.playerAction = { type: 'switch', index: 2 };
  assert.deepEqual(
    chooseAiAction(hiddenMove, 'enemy', 'standard', 'direct'),
    chooseAiAction(hiddenSwitch, 'enemy', 'standard', 'direct')
  );
  assert.equal(hiddenMove.rngState, hiddenSwitch.rngState);
});

test('Champion reply forecasts account for an active barrier through authoritative previews', () => {
  const clear = createBattle({
      playerTeam: ['nocturnyx', 'orakyn', 'lumivox'],
      enemyTeam: ['ferrax', 'umbrawl', 'hexalune'],
      seed: 1,
    }),
    barrier = structuredClone(clear);
  clear.sides.player.surge = 30;
  clear.rngState = 123456789;
  clear.sides.player.team[0].barrier = 0;
  barrier.sides.player.surge = 30;
  barrier.rngState = 123456789;
  barrier.sides.player.team[0].barrier = 35;
  assert.deepEqual(chooseAiAction(clear, 'player', 'champion', 'champion'), {
    type: 'switch',
    index: 1,
  });
  assert.deepEqual(chooseAiAction(barrier, 'player', 'champion', 'champion'), {
    type: 'move',
    moveId: 'sonic_gloom',
  });
  clear.rngState = 123456789;
  barrier.rngState = 123456789;
  assert.deepEqual(chooseAiAction(clear, 'player', 'standard', 'champion'), {
    type: 'switch',
    index: 2,
  });
  assert.deepEqual(chooseAiAction(barrier, 'player', 'standard', 'champion'), {
    type: 'switch',
    index: 2,
  });
});

test('Standard and Champion select their second-ranked action at their seeded imperfection rates', () => {
  const outcomes = (difficulty) => {
    const counts = new Map();
    for (let sample = 1; sample <= 1000; sample++) {
      const state = createBattle({
        playerTeam: ['orakyn', 'abyssar', 'virelia'],
        enemyTeam: ['kordane', 'calderoc', 'farfombre'],
        seed: 1,
      });
      state.rngState = Math.imul(sample, 0x9e3779b9) >>> 0 || 1;
      const action = JSON.stringify(chooseAiAction(state, 'enemy', difficulty, 'direct'));
      counts.set(action, (counts.get(action) || 0) + 1);
    }
    return [...counts.values()].sort((a, b) => a - b);
  };
  assert.deepEqual(outcomes('standard'), [187, 813]);
  assert.deepEqual(outcomes('champion'), [1000]);
});

test('Champion AI has no hidden late-turn urgency branch', () => {
  const early = createBattle({
      playerTeam: ['kordane', 'lumivox', 'mnemora'],
      enemyTeam: ['orakyn', 'prismage', 'brontusk'],
      seed: 6,
    }),
    late = structuredClone(early);
  early.rngState = 123456789;
  late.rngState = 123456789;
  early.turn = 28;
  late.turn = 29;
  assert.deepEqual(
    chooseAiAction(late, 'player', 'champion', 'champion'),
    chooseAiAction(early, 'player', 'champion', 'champion')
  );
});
