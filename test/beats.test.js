import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyReplacement,
  applyTrainerCommand,
  createBattle,
  getLegalActions,
  resolveTurn,
} from '../src/battle/engine.js';
import { chooseAiAction } from '../src/battle/ai.js';
import { CREATURES } from '../src/data/creatures.js';
import { BEAT_BUDGET_MS, beatBudgetMs, fxRandom, groupBeats, turnBudgetMs } from '../src/battle-ui/beats.js';

const move = (moveId, extra = {}) => ({ type: 'move', moveId, ...extra });
const battle = (playerTeam, enemyTeam, options = {}) =>
  createBattle({ playerTeam, enemyTeam, seed: 7, ...options });
const kinds = (beats) => beats.map((beat) => (beat.kind === 'action' ? beat.moveId : beat.kind));
const actionOf = (beats, moveId) => beats.find((beat) => beat.kind === 'action' && beat.moveId === moveId);

// Invariants every grouping must satisfy, whatever the turn.
function assertWellFormed(events, beats) {
  const seen = new Map();
  for (const beat of beats) {
    let lastIndex = -1;
    for (const event of beat.events) {
      assert.ok(!seen.has(event), `${event.type} appears in two beats`);
      seen.set(event, beat);
      const index = events.indexOf(event);
      assert.ok(index > lastIndex, `${beat.kind} beat reorders engine events`);
      lastIndex = index;
    }
    if (beat.kind === 'action') {
      assert.equal(beat.events[0].type, 'move-start');
      assert.equal(beat.events.filter((event) => event.type === 'move-start').length, 1);
      assert.deepEqual(
        beat.hits.map((hit) => hit.damage),
        beat.events.filter((event) => event.type === 'damage')
      );
      for (const hit of beat.hits)
        if (hit.barrierHit) {
          const barrierAt = events.indexOf(hit.barrierHit),
            damageAt = events.indexOf(hit.damage);
          assert.ok(barrierAt < damageAt, 'absorption precedes its damage');
          assert.ok(!events.slice(barrierAt, damageAt).some((event) => event.type === 'damage'));
          assert.equal(hit.barrierHit.amount, hit.damage.absorbed);
        }
    }
    if (beat.surges) assert.ok(beat.surges.every((event) => event.type === 'surge'));
    if (beat.kind === 'ko') assert.ok(beat.events.every((event) => ['ko', 'move-skip'].includes(event.type)));
  }
  assert.equal(seen.size, events.length, 'every engine event belongs to a beat');
  for (const event of events) {
    const beat = seen.get(event);
    if (event.type === 'ko' || event.type === 'move-skip') assert.equal(beat.kind, 'ko');
    if (event.type === 'switch' || event.type === 'replace') assert.equal(beat.start, event);
    if (event.type === 'battle-end') assert.equal(beat, beats.at(-1));
  }
}

function* seededTurns(count, playerLevel, enemyLevel) {
  const ids = Object.keys(CREATURES),
    arenas = ['crystal', 'grove', 'tidal', 'volcano', 'astral', 'eclipse'];
  for (let index = 0; index < count; index++) {
    const pick = (offset) => {
      const team = new Set();
      for (let step = 0; team.size < 3; step++) team.add(ids[(index * 13 + offset + step * 7) % ids.length]);
      return [...team];
    };
    let state = createBattle({
      playerTeam: pick(0),
      enemyTeam: pick(5),
      seed: 1000 + index,
      arena: arenas[index % arenas.length],
      enemyAce: index % 4 === 0 ? 'second_wind' : null,
    });
    for (let turn = 0; turn < 60 && state.phase !== 'ended'; turn++) {
      if (state.phase === 'replacement') {
        for (const side of ['player', 'enemy'])
          if (state.sides[side].pendingReplacement) {
            const result = applyReplacement(state, side, getLegalActions(state, side)[0]);
            state = result.state;
            yield { events: result.events, window: null };
          }
        continue;
      }
      const result = resolveTurn(
        state,
        chooseAiAction(state, 'player', playerLevel),
        chooseAiAction(state, 'enemy', enemyLevel)
      );
      state = result.state;
      // One "turn" as the player waits it: the turn, then the enemy's free replacement when
      // it plays before control returns.
      const window = [...groupBeats(result.events)];
      if (state.phase === 'replacement' && !state.sides.player.pendingReplacement) {
        const replacement = applyReplacement(state, 'enemy', chooseAiAction(state, 'enemy', enemyLevel));
        state = replacement.state;
        yield { events: replacement.events, window: null };
        window.push(...groupBeats(replacement.events));
      }
      yield { events: result.events, window };
    }
  }
}

test('every engine event of seeded battles lands in exactly one well-formed beat', () => {
  let turns = 0;
  for (const { events } of seededTurns(40, 'standard', 'champion')) {
    assertWellFormed(events, groupBeats(events));
    turns += 1;
  }
  assert.ok(turns > 400, `sampled ${turns} engine results`);
});

test('a multi-hit move is one action beat with one sub-readout per hit and one merged chip row', () => {
  const { events } = resolveTurn(
    battle(['voltide', 'orakyn', 'abyssar'], ['kordane', 'calderoc', 'farfombre']),
    move('storm_chain'),
    move('crystal_strike')
  );
  const beats = groupBeats(events),
    storm = actionOf(beats, 'storm_chain');
  assertWellFormed(events, beats);
  assert.deepEqual(kinds(beats), ['storm_chain', 'crystal_strike']);
  assert.deepEqual(
    storm.hits.map((hit) => [hit.hit, hit.hits]),
    [
      [1, 3],
      [2, 3],
      [3, 3],
    ]
  );
  assert.deepEqual(
    storm.chips.map((chip) => [chip.side, chip.status, chip.applied]),
    [['enemy', 'stunned', true]]
  );
  assert.equal(new Set(storm.hits.map((hit) => hit.seed)).size, 3, 'each hit has its own FX seed');
  const single = actionOf(beats, 'crystal_strike');
  assert.ok(beatBudgetMs(storm) > beatBudgetMs(single), 'extra hits and the chip row take time');
  assert.ok(beatBudgetMs(storm) <= BEAT_BUDGET_MS.actionCap[storm.tier]);
});

test('barrier absorption rides on its hit; a fully absorbed attack stamps only "blocked"', () => {
  const state = battle(['ferrax', 'orakyn', 'abyssar'], ['kordane', 'calderoc', 'farfombre']);
  state.sides.enemy.team[0].barrier = 35;
  const { events } = resolveTurn(state, move('razor_rush'), move('crystal_strike'));
  const beats = groupBeats(events),
    rush = actionOf(beats, 'razor_rush');
  assertWellFormed(events, beats);
  assert.equal(rush.hits.length, 3);
  assert.ok(rush.hits.every((hit) => hit.barrierHit && hit.blocked && hit.amount === 0));
  assert.deepEqual(rush.stamps, ['blocked']);
  assert.ok(
    !beats.some((beat) => beat.events.some((event) => event.type === 'barrier-hit') && beat !== rush)
  );
});

test('a critical hit stamps first and bumps its action tier', () => {
  let found = null;
  for (let seed = 1; seed <= 400 && !found; seed++) {
    const { events } = resolveTurn(
      createBattle({
        playerTeam: ['kordane', 'orakyn', 'abyssar'],
        enemyTeam: ['calderoc', 'virelia', 'farfombre'],
        seed,
      }),
      move('crystal_strike'),
      move('cinder_burst')
    );
    if (events.some((event) => event.type === 'damage' && event.side === 'enemy' && event.critical))
      found = events;
  }
  assert.ok(found, 'a seeded critical hit exists');
  const beats = groupBeats(found),
    strike = actionOf(beats, 'crystal_strike');
  assertWellFormed(found, beats);
  assert.equal(strike.critical, true);
  assert.equal(strike.stamps[0], 'critical');
  assert.equal(strike.tier, Math.min(3, strike.baseTier + 1));
  assert.ok(beatBudgetMs(strike) > beatBudgetMs({ ...strike, tier: strike.baseTier }));
});

test('a K.O. beat follows the lethal action, absorbs the move-skip, then the replacement enters', () => {
  const state = battle(['pyrolynx', 'orakyn', 'abyssar'], ['kordane', 'calderoc'], {
    enemyAce: 'second_wind',
  });
  state.sides.enemy.team[0].hp = 1;
  const turn = resolveTurn(state, move('flash_pounce'), move('crystal_strike'));
  const beats = groupBeats(turn.events);
  assertWellFormed(turn.events, beats);
  assert.deepEqual(kinds(beats), ['flash_pounce', 'ko']);
  assert.equal(beats[0].lethal, true);
  assert.deepEqual(beats[1].kos, [{ side: 'enemy', creatureId: 'kordane' }]);
  assert.deepEqual(
    beats[1].skips.map((event) => event.side),
    ['enemy']
  );
  const replacement = applyReplacement(turn.state, 'enemy', getLegalActions(turn.state, 'enemy')[0]);
  const entry = groupBeats(replacement.events);
  assertWellFormed(replacement.events, entry);
  assert.deepEqual(
    entry.map((beat) => beat.kind),
    ['switch', 'cutin']
  );
  assert.equal(entry[0].replacement, true);
  assert.equal(entry[1].cutIn, 'ace');
  const voluntary = { ...entry[0], replacement: false };
  assert.ok(beatBudgetMs(entry[0]) < beatBudgetMs(voluntary), 'a replacement skips the recall');
});

test('a voluntary switch plays first with its rewards, then the Perfect Relay cut-in, then the attack', () => {
  const { events } = resolveTurn(
    battle(['virelia', 'abyssar', 'orakyn'], ['calderoc', 'kordane', 'farfombre'], { seed: 4 }),
    { type: 'switch', index: 1 },
    move('cinder_burst')
  );
  const beats = groupBeats(events);
  assertWellFormed(events, beats);
  assert.deepEqual(kinds(beats), ['switch', 'cutin', 'cinder_burst', 'chip']);
  assert.equal(beats[0].creatureId, 'abyssar');
  assert.equal(beats[0].surges[0].source, 'switch');
  assert.equal(beats[1].cutIn, 'perfect-relay');
  assert.deepEqual(beats[2].stamps, ['resisted']);
  assert.equal(beats[3].chip, 'tick');
  const entryTalent = groupBeats(
    resolveTurn(
      battle(['virelia', 'orakyn', 'abyssar'], ['calderoc', 'kordane', 'farfombre'], { seed: 4 }),
      { type: 'switch', index: 1 },
      move('cinder_burst')
    ).events
  )[0];
  assert.deepEqual(
    entryTalent.talents.map((event) => event.passive),
    ['foresight']
  );
});

test('two Signatures in one turn mark the clash, and a double K.O. shares one beat', () => {
  const state = battle(['solflare', 'orakyn', 'abyssar'], ['kordane', 'calderoc', 'farfombre'], { seed: 8 });
  state.sides.player.surge = 100;
  state.sides.enemy.surge = 100;
  const { events } = resolveTurn(state, move('supernova'), move('fault_charge'));
  const beats = groupBeats(events);
  assertWellFormed(events, beats);
  assert.deepEqual(kinds(beats), ['fault_charge', 'supernova', 'ko']);
  assert.deepEqual(
    beats.slice(0, 2).map((beat) => [beat.signature, beat.tier, beat.clash]),
    [
      [true, 3, true],
      [true, 3, false],
    ]
  );
  assert.equal(beats[0].surges[0].amount, -100, 'the Signature spend rides on its beat');
  assert.equal(beats[1].combo?.multiplier, 1.3);
  assert.deepEqual(beats[2].kos.map((ko) => ko.side).sort(), ['enemy', 'player']);
  assert.ok(beatBudgetMs(beats[0]) <= BEAT_BUDGET_MS.actionCap[3]);
});

test('heals are number readouts, not chip rows', () => {
  const state = battle(['nymbloom', 'orakyn', 'abyssar'], ['kordane', 'calderoc', 'farfombre'], { seed: 8 });
  state.sides.player.team[0].hp = 40;
  state.sides.player.team[1].hp = 30;
  const { events } = resolveTurn(state, move('healing_rain'), move('crystal_strike'));
  const beats = groupBeats(events),
    rain = actionOf(beats, 'healing_rain');
  assertWellFormed(events, beats);
  assert.deepEqual(rain.hits, []);
  assert.deepEqual(rain.stamps, []);
  assert.deepEqual(
    rain.readouts.map((event) => [event.type, event.creatureId]),
    [
      ['heal', 'nymbloom'],
      ['heal', 'orakyn'],
    ]
  );
  assert.deepEqual(rain.chips, []);
  assert.equal(beatBudgetMs(rain), BEAT_BUDGET_MS.action[rain.tier], 'readouts overlap the beat');
});

test('status application merges into one chip row while consumed statuses stay off it', () => {
  const opening = resolveTurn(
    battle(['orakyn', 'kordane', 'abyssar'], ['calderoc', 'virelia', 'farfombre'], { seed: 14 }),
    move('lucid_arc'),
    move('cinder_burst')
  );
  const arc = actionOf(groupBeats(opening.events), 'lucid_arc');
  assert.deepEqual(
    arc.chips.map((chip) => [chip.side, chip.status, chip.applied]),
    [['enemy', 'marked', true]]
  );
  const focus = resolveTurn(
    battle(['orakyn', 'abyssar', 'virelia'], ['kordane', 'calderoc', 'farfombre'], { seed: 14 }),
    move('lucid_arc'),
    move('resonant_focus')
  );
  const focusBeats = groupBeats(focus.events);
  assertWellFormed(focus.events, focusBeats);
  assert.deepEqual(
    actionOf(focusBeats, 'resonant_focus').chips.map((chip) => chip.status),
    ['focused', 'haste']
  );
  assert.deepEqual(
    actionOf(focusBeats, 'lucid_arc').consumed.map((event) => event.status),
    ['focused']
  );
  assert.ok(!actionOf(focusBeats, 'lucid_arc').chips.some((chip) => chip.status === 'focused'));
  // An ally finishes the Combo the lead set up: consumption, credit and multiplier on one beat.
  const swapped = resolveTurn(opening.state, { type: 'switch', index: 1 }, move('cinder_burst'));
  const finish = resolveTurn(swapped.state, move('crystal_strike'), move('cinder_burst'));
  const finishBeats = groupBeats(finish.events),
    strike = actionOf(finishBeats, 'crystal_strike');
  assertWellFormed(finish.events, finishBeats);
  assert.deepEqual(
    strike.consumed.map((event) => event.status),
    ['marked']
  );
  assert.equal(strike.assist?.creatureId, 'orakyn');
  assert.deepEqual(strike.combo, { multiplier: 1.3, helperId: 'orakyn' });
});

test('a dodged attack consumes Evasive silently and stamps "miss"', () => {
  const { events } = resolveTurn(
    battle(['farfombre', 'abyssar', 'virelia'], ['kordane', 'orakyn', 'calderoc'], { seed: 14 }),
    move('shade_spark'),
    move('crystal_strike')
  );
  const strike = actionOf(groupBeats(events), 'crystal_strike');
  assert.equal(strike.miss?.creatureId, 'farfombre');
  assert.deepEqual(strike.stamps, ['miss']);
  assert.deepEqual(
    strike.consumed.map((event) => event.status),
    ['evasive']
  );
  assert.deepEqual(strike.chips, []);
});

test('end-of-turn burns form one tick chip beat; a burn K.O. and the battle end follow it', () => {
  const state = battle(['calderoc', 'abyssar', 'virelia'], ['kordane', 'orakyn'], { seed: 14 });
  const enemy = state.sides.enemy;
  enemy.team[1].hp = 0;
  enemy.team[0].hp = 3;
  enemy.team[0].statuses.burning = { appliedTurn: 0, stacks: 2, remaining: 3 };
  const { events } = resolveTurn(state, move('furnace_heart'), move('resonant_focus'));
  const beats = groupBeats(events);
  assertWellFormed(events, beats);
  assert.deepEqual(kinds(beats).slice(-3), ['chip', 'ko', 'end']);
  assert.equal(beats.at(-3).ticks[0].status, 'burning');
  assert.equal(beats.at(-1).winner, 'player');
  assert.equal(beatBudgetMs(beats.at(-1)), 0, 'the finale belongs to the outro, not the turn');
});

test('the Coach command is a cut-in beat carrying its cleanse row', () => {
  const opening = resolveTurn(
    battle(['orakyn', 'abyssar', 'virelia'], ['voltide', 'calderoc', 'farfombre'], { seed: 14 }),
    move('lucid_arc'),
    move('storm_chain')
  );
  const { events } = applyTrainerCommand(opening.state, 'player');
  const beats = groupBeats(events);
  assertWellFormed(events, beats);
  assert.deepEqual(
    beats.map((beat) => [beat.kind, beat.cutIn]),
    [['cutin', 'trainer-command']]
  );
  assert.ok(beats[0].chips.every((chip) => chip.applied === false));
  assert.equal(beats[0].surges[0].source, 'command');
});

test('grouping and FX random streams are deterministic per hit', () => {
  const run = () =>
    groupBeats(
      resolveTurn(
        battle(['voltide', 'orakyn', 'abyssar'], ['kordane', 'calderoc', 'farfombre']),
        move('storm_chain'),
        move('crystal_strike')
      ).events
    ).map((beat) => [beat.kind, beat.seed, beat.hits?.map((hit) => hit.seed)]);
  const first = run(),
    [, , hitSeeds] = first[0],
    stream = (seed) => Array.from({ length: 8 }, fxRandom(seed));
  assert.deepEqual(first, run());
  assert.deepEqual(stream(hitSeeds[0]), stream(hitSeeds[0]));
  assert.notDeepEqual(stream(hitSeeds[0]), stream(hitSeeds[1]));
  assert.ok(stream(hitSeeds[2]).every((value) => value >= 0 && value < 1));
});

test('beat budgets meet the turn pacing targets at ×1 (median ≤ 2.4 s, p90 ≤ 3.5 s)', () => {
  const totals = [];
  for (const [player, enemy, count] of [
    ['standard', 'standard', 60],
    ['apprentice', 'champion', 40],
  ])
    for (const { window } of seededTurns(count, player, enemy))
      if (window) totals.push(turnBudgetMs(window.filter((beat) => beat.kind !== 'end')));
  totals.sort((a, b) => a - b);
  const quantile = (q) => totals[Math.min(totals.length - 1, Math.floor(totals.length * q))];
  assert.ok(totals.length > 600, `sampled ${totals.length} turns`);
  assert.ok(quantile(0.5) <= 2400, `median ${quantile(0.5)} ms`);
  assert.ok(quantile(0.9) <= 3500, `p90 ${quantile(0.9)} ms`);
});
