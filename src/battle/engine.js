import { CREATURES } from '../data/creatures.js';
import { MOVES } from '../data/moves.js';
import { teamBonds } from '../data/synergies.js';
import { calculateDamage } from './damage.js';
import { randomFromState } from './rng.js';
import {
  applyStatus,
  cleanse,
  effectiveSpeed,
  hasStatus,
  purge,
  statusStacks,
  tickTimed,
} from './statuses.js';

export const TURN_CAP = 40;
export const SIGNATURE_COST = 100;
export const BARRIER_CAP = 35;
export const ARENA_RESONANCE = Object.freeze({
  crystal: 'force',
  grove: 'grove',
  tidal: 'tide',
  volcano: 'flame',
  astral: 'mind',
  eclipse: 'shadow',
});
export const BATTLE_MODIFIERS = Object.freeze([
  'overdrive',
  'high_voltage',
  'enemy_aegis',
  'dual_aegis',
  'rapid_arena',
  'relay_fever',
  'player_wounded',
  'ascendant',
  'player_surge',
  'player_aegis',
  'player_vitality',
  'player_focus',
]);
export const BATTLE_DOCTRINES = Object.freeze(['balanced', 'assault', 'bastion', 'ambush']);
export function signatureCostFor(creature) {
  const base = creature?.passive === 'sunborn' ? 80 : SIGNATURE_COST;
  return Math.max(60, base - (creature?.masteryRank >= 5 ? 10 : 0));
}

function makeCombatant(id, rank = 0) {
  const base = CREATURES[id];
  if (!base) throw new Error(`Unknown creature: ${id}`);
  const masteryRank = Math.max(0, Math.min(5, Math.floor(Number(rank) || 0))),
    maxHp = masteryRank >= 3 ? Math.round(base.maxHp * 1.04) : base.maxHp;
  return {
    ...base,
    maxHp,
    hp: maxHp,
    barrier: masteryRank >= 2 ? 6 : 0,
    masteryRank,
    statuses: {},
    cooldowns: {},
    talent: {},
  };
}
function assertTeam(team) {
  if (!Array.isArray(team) || team.length < 2 || team.length > 3 || new Set(team).size !== team.length)
    throw new Error('A team needs two or three distinct creatures');
  team.forEach((id) => {
    if (!CREATURES[id]) throw new Error(`Unknown creature: ${id}`);
  });
}
export function createBattle({
  playerTeam,
  enemyTeam,
  playerLead = 0,
  enemyLead = 0,
  seed = 1,
  mode = 'quick',
  arena = null,
  modifiers = [],
  doctrine = 'balanced',
  masteryRanks = {},
  enemyAce = null,
}) {
  assertTeam(playerTeam);
  assertTeam(enemyTeam);
  if (!playerTeam[playerLead] || !enemyTeam[enemyLead]) throw new Error('Invalid lead');
  const playerBonds = teamBonds(playerTeam),
    enemyBonds = teamBonds(enemyTeam);
  const activeModifiers = [...new Set(modifiers.filter((id) => BATTLE_MODIFIERS.includes(id)))];
  const activeDoctrine = BATTLE_DOCTRINES.includes(doctrine) ? doctrine : 'balanced';
  const state = {
    version: 7,
    mode,
    arena,
    modifiers: activeModifiers,
    doctrine: activeDoctrine,
    enemyAce,
    aceTriggered: false,
    finalDuelTriggered: false,
    turn: 1,
    phase: 'choice',
    winner: null,
    reason: null,
    rngState: Number(seed) >>> 0 || 1,
    sides: {
      player: {
        team: playerTeam.map((id) => makeCombatant(id, masteryRanks[id])),
        active: playerLead,
        pendingReplacement: false,
        surge:
          30 + (playerBonds.includes('harmony') ? 15 : 0) + (playerBonds.includes('convergence') ? 10 : 0),
        bonds: playerBonds,
        lastMoveId: null,
        flow: 0,
        commandUsed: false,
      },
      enemy: {
        team: enemyTeam.map((id) => makeCombatant(id)),
        active: enemyLead,
        pendingReplacement: false,
        surge: 30 + (enemyBonds.includes('harmony') ? 15 : 0) + (enemyBonds.includes('convergence') ? 10 : 0),
        bonds: enemyBonds,
        lastMoveId: null,
        flow: 0,
        commandUsed: false,
      },
    },
    history: [],
  };
  if (activeModifiers.includes('overdrive'))
    for (const side of ['player', 'enemy']) state.sides[side].surge = 100;
  if (activeModifiers.includes('enemy_aegis')) state.sides.enemy.team.forEach((c) => (c.barrier = 18));
  if (activeModifiers.includes('dual_aegis'))
    for (const side of ['player', 'enemy'])
      state.sides[side].team.forEach((c) => (c.barrier = Math.min(BARRIER_CAP, c.barrier + 18)));
  if (activeModifiers.includes('player_wounded'))
    state.sides.player.team.forEach((c) => (c.hp = Math.max(1, Math.round(c.maxHp * 0.72))));
  if (activeModifiers.includes('ascendant'))
    state.sides.enemy.team.forEach((c) => {
      c.maxHp = Math.round(c.maxHp * 1.15);
      c.hp = c.maxHp;
      c.attack = Math.round(c.attack * 1.08);
      c.guard = Math.round(c.guard * 1.08);
    });
  if (activeModifiers.includes('player_vitality'))
    state.sides.player.team.forEach((c) => {
      c.maxHp = Math.round(c.maxHp * 1.12);
      c.hp = c.maxHp;
    });
  if (activeModifiers.includes('player_surge'))
    state.sides.player.surge = Math.min(100, state.sides.player.surge + 25);
  if (activeModifiers.includes('player_aegis'))
    state.sides.player.team.forEach((c) => (c.barrier = Math.min(BARRIER_CAP, c.barrier + 12)));
  for (const side of ['player', 'enemy']) {
    const owner = state.sides[side],
      active = activeOf(state, side);
    if (owner.bonds.includes('bulwark'))
      owner.team.forEach((c) => (c.barrier = Math.min(BARRIER_CAP, c.barrier + 6)));
    if (owner.bonds.includes('huntpack')) applyStatus(active, 'haste', state.turn, 2);
    if (owner.bonds.includes('convergence')) applyStatus(active, 'focused', state.turn, null);
  }
  if (playerBonds.includes('spellweave'))
    applyStatus(activeOf(state, 'enemy'), 'marked', state.turn, 2, 1, activeOf(state, 'player').id);
  if (enemyBonds.includes('spellweave'))
    applyStatus(activeOf(state, 'player'), 'marked', state.turn, 2, 1, activeOf(state, 'enemy').id);
  if (activeModifiers.includes('player_focus')) {
    applyStatus(activeOf(state, 'player'), 'focused', state.turn, null);
    applyStatus(activeOf(state, 'enemy'), 'marked', state.turn, 2, 1, activeOf(state, 'player').id);
  }
  if (activeDoctrine === 'assault') {
    state.sides.player.surge = Math.min(100, state.sides.player.surge + 20);
    applyStatus(activeOf(state, 'player'), 'marked', state.turn, null);
  }
  if (activeDoctrine === 'bastion') {
    state.sides.player.surge = Math.max(0, state.sides.player.surge - 10);
    state.sides.player.team.forEach((c) => (c.barrier = Math.min(BARRIER_CAP, c.barrier + 10)));
  }
  if (activeDoctrine === 'ambush') {
    applyStatus(activeOf(state, 'player'), 'focused', state.turn, null);
    applyStatus(activeOf(state, 'player'), 'haste', state.turn, 2);
    state.sides.player.team.forEach((c, i) => {
      if (i !== playerLead) c.hp = Math.max(1, Math.round(c.maxHp * 0.88));
    });
  }
  enterTalent(state, 'player');
  enterTalent(state, 'enemy');
  return state;
}
export function activeOf(state, side) {
  return state.sides[side].team[state.sides[side].active];
}
export function otherSide(side) {
  return side === 'player' ? 'enemy' : 'player';
}
export function consciousIndices(state, side) {
  return state.sides[side].team.map((c, i) => (c.hp > 0 ? i : -1)).filter((i) => i >= 0);
}

export function getLegalActions(state, side) {
  if (state.phase === 'ended') return [];
  const owner = state.sides[side];
  if (owner.pendingReplacement)
    return consciousIndices(state, side)
      .filter((i) => i !== owner.active)
      .map((index) => ({ type: 'replace', index }));
  if (state.phase !== 'choice') return [];
  const active = activeOf(state, side);
  const moves = active.moves
    .filter(
      (id) =>
        !active.cooldowns[id]?.remaining && !(MOVES[id].signature && owner.surge < signatureCostFor(active))
    )
    .map((moveId) => ({ type: 'move', moveId }));
  const canSwitch = !hasStatus(active, 'rooted') || active.passive === 'ancient_roots';
  const switches = canSwitch
    ? consciousIndices(state, side)
        .filter((i) => i !== owner.active)
        .map((index) => ({ type: 'switch', index }))
    : [];
  return [...moves, ...switches];
}
function actionKey(action) {
  return `${action?.type}:${action?.moveId ?? action?.index}`;
}
export function isLegalAction(state, side, action) {
  return getLegalActions(state, side).some((candidate) => actionKey(candidate) === actionKey(action));
}
function clone(state) {
  return structuredClone(state);
}
function push(events, type, data = {}) {
  events.push({ type, ...data });
}
function passiveEvent(events, side, creature) {
  if (events) push(events, 'passive', { side, creatureId: creature.id, passive: creature.passive });
}
function enterTalent(state, side, events = null) {
  const creature = activeOf(state, side),
    foe = activeOf(state, otherSide(side));
  if (side === 'player' && creature.masteryRank >= 4 && !creature.talent.masteryEntry) {
    creature.talent.masteryEntry = true;
    adjustSurge(state, side, 5, events || [], 'mastery');
  }
  if (creature.passive === 'foresight' && !creature.talent.entry) {
    applyStatus(creature, 'focused', state.turn, null);
    creature.talent.entry = true;
    passiveEvent(events, side, creature);
  }
  if (creature.passive === 'foundation' && !creature.talent.entry) {
    const before = creature.barrier;
    creature.barrier = Math.min(BARRIER_CAP, creature.barrier + 14);
    creature.talent.entry = true;
    passiveEvent(events, side, creature);
    if (events)
      push(events, 'barrier', {
        side,
        creatureId: creature.id,
        amount: creature.barrier - before,
        total: creature.barrier,
        source: 'passive',
      });
  }
  if (creature.passive === 'living_shadow' && !creature.talent.entry) {
    applyStatus(creature, 'evasive', state.turn, null);
    creature.talent.entry = true;
    passiveEvent(events, side, creature);
  }
  if (creature.passive === 'apex_stalker' && !creature.talent.entry) {
    applyStatus(creature, 'focused', state.turn, null);
    creature.talent.entry = true;
    passiveEvent(events, side, creature);
  }
  if (creature.passive === 'ill_omen' && foe.hp > 0) {
    applyStatus(foe, 'marked', state.turn, 2, 1, creature.id);
    passiveEvent(events, side, creature);
    if (events)
      emitStatus(events, otherSide(side), foe, 'marked', true, {
        remaining: 2,
        source: 'passive',
        sourceCreatureId: creature.id,
      });
  }
}
function adjustSurge(state, side, amount, events, source) {
  const owner = state.sides[side],
    before = owner.surge;
  owner.surge = Math.max(0, Math.min(SIGNATURE_COST, owner.surge + Math.round(amount)));
  const change = owner.surge - before;
  if (change)
    push(events, 'surge', {
      side,
      amount: change,
      total: owner.surge,
      source,
      ready: owner.surge === SIGNATURE_COST,
    });
  return change;
}
function triggerFinalDuel(state, events) {
  if (state.finalDuelTriggered) return;
  const player = consciousIndices(state, 'player'),
    enemy = consciousIndices(state, 'enemy');
  if (player.length !== 1 || enemy.length !== 1) return;
  state.finalDuelTriggered = true;
  push(events, 'final-duel', {
    playerCreatureId: state.sides.player.team[player[0]].id,
    enemyCreatureId: state.sides.enemy.team[enemy[0]].id,
  });
  adjustSurge(state, 'player', 12, events, 'final-duel');
  adjustSurge(state, 'enemy', 12, events, 'final-duel');
}
function triggerAce(state, events) {
  if (!state.enemyAce || state.aceTriggered || consciousIndices(state, 'enemy').length !== 1) return;
  state.aceTriggered = true;
  const ace = state.enemyAce,
    creature = activeOf(state, 'enemy'),
    foe = activeOf(state, 'player'),
    addSelf = (statuses) => applyStatuses(creature, statuses, state, 'enemy', events, creature.id),
    addFoe = (statuses) => applyStatuses(foe, statuses, state, 'player', events, creature.id);
  push(events, 'ace', { side: 'enemy', creatureId: creature.id, ace });
  if (ace === 'second_wind') {
    healCreature(creature, creature.maxHp * 0.18, 'enemy', events, 'ace');
    removeAndEmit(creature, 'negative', 1, 'enemy', events);
    addBarrier(creature, 12, 'enemy', events);
  }
  if (ace === 'redline') {
    addSelf([{ id: 'haste', duration: 4 }]);
    adjustSurge(state, 'enemy', 20, events, 'ace');
  }
  if (ace === 'overgrowth') {
    healCreature(creature, creature.maxHp * 0.08, 'enemy', events, 'ace');
    addSelf([{ id: 'countering', duration: 3 }]);
    addBarrier(creature, 10, 'enemy', events);
  }
  if (ace === 'mindlock')
    addFoe([
      { id: 'stunned', duration: 2 },
      { id: 'marked', duration: 3 },
    ]);
  if (ace === 'high_tide') {
    removeAndEmit(creature, 'negative', 1, 'enemy', events);
    healCreature(creature, creature.maxHp * 0.14, 'enemy', events, 'ace');
    addBarrier(creature, 14, 'enemy', events);
  }
  if (ace === 'citadel') {
    addBarrier(creature, 38, 'enemy', events);
  }
  if (ace === 'wildfire') {
    addSelf([{ id: 'focused' }]);
    addFoe([{ id: 'burning', duration: 3, stacks: 2 }]);
  }
  if (ace === 'vanishing_act') addSelf([{ id: 'evasive' }, { id: 'countering' }]);
  if (ace === 'stormfront') {
    addSelf([{ id: 'haste', duration: 4 }, { id: 'focused' }]);
    addFoe([{ id: 'marked', duration: 3 }]);
  }
  if (ace === 'titanheart') {
    const before = creature.maxHp;
    creature.maxHp = Math.round(creature.maxHp * 1.2);
    creature.hp += creature.maxHp - before;
    addBarrier(creature, 18, 'enemy', events);
  }
  if (ace === 'dark_fate')
    addFoe([
      { id: 'marked', duration: 4 },
      { id: 'stunned', duration: 2 },
      { id: 'burning', duration: 3 },
    ]);
  if (ace === 'royal_ascension') {
    creature.attack = Math.round(creature.attack * 1.12);
    creature.guard = Math.round(creature.guard * 1.12);
    addBarrier(creature, 16, 'enemy', events);
    adjustSurge(state, 'enemy', 100, events, 'ace');
  }
}
function resolveSwitch(state, side, action, events, replacement = false) {
  const owner = state.sides[side],
    from = owner.active;
  owner.active = action.index;
  owner.pendingReplacement = false;
  push(events, replacement ? 'replace' : 'switch', {
    side,
    from,
    to: action.index,
    creatureId: activeOf(state, side).id,
  });
  enterTalent(state, side, events);
  if (!replacement) {
    const fever = state.modifiers?.includes('relay_fever');
    adjustSurge(state, side, fever ? 24 : 10, events, 'switch');
    if (fever)
      applyStatuses(
        activeOf(state, side),
        [{ id: 'haste', duration: 2 }],
        state,
        side,
        events,
        activeOf(state, side).id
      );
  } else {
    adjustSurge(state, side, 18, events, 'rally');
    applyStatus(activeOf(state, side), 'focused', state.turn, null);
    push(events, 'rally', { side, creatureId: activeOf(state, side).id, surge: 18 });
    if (side === 'enemy') triggerAce(state, events);
  }
}
function consume(record, id) {
  const found = Boolean(record[id]);
  if (found) delete record[id];
  return found;
}
function emitStatus(events, side, creature, status, applied, extra = {}) {
  push(events, 'status', { side, creatureId: creature.id, status, applied, ...extra });
}
function addBarrier(creature, amount, side, events) {
  if (!amount) return;
  if (creature.passive === 'prism_skin') amount += 6;
  const before = creature.barrier;
  creature.barrier = Math.min(BARRIER_CAP, creature.barrier + amount);
  push(events, 'barrier', {
    side,
    creatureId: creature.id,
    amount: creature.barrier - before,
    total: creature.barrier,
  });
}
function healCreature(creature, amount, side, events, source = 'move') {
  if (creature.hp <= 0) return 0;
  const gained = Math.max(0, Math.min(creature.maxHp - creature.hp, Math.round(amount)));
  if (!gained) return 0;
  creature.hp += gained;
  push(events, 'heal', {
    side,
    creatureId: creature.id,
    amount: gained,
    hp: creature.hp,
    maxHp: creature.maxHp,
    source,
  });
  return gained;
}
function recordKnockout(state, side, creature, events) {
  if (
    creature.hp > 0 ||
    events.some((event) => event.type === 'ko' && event.side === side && event.creatureId === creature.id)
  )
    return false;
  push(events, 'ko', { side, creatureId: creature.id });
  const remaining = consciousIndices(state, side).filter((index) => index !== state.sides[side].active);
  if (remaining.length) state.sides[side].pendingReplacement = true;
  return true;
}
function applyStatuses(creature, descriptors, state, side, events, sourceCreatureId = null) {
  for (const spec of descriptors || []) {
    if (spec.id === 'rooted' && creature.passive === 'ancient_roots') continue;
    const applied = applyStatus(
      creature,
      spec.id,
      state.turn,
      spec.duration ?? null,
      spec.stacks ?? 1,
      sourceCreatureId
    );
    emitStatus(events, side, creature, spec.id, true, {
      remaining: applied.remaining ?? null,
      stacks: statusStacks(creature, spec.id),
      sourceCreatureId,
    });
  }
}
function removeAndEmit(creature, ids, count, side, events) {
  const removed = ids === 'negative' ? cleanse(creature, count) : purge(creature, count);
  removed.forEach((status) => emitStatus(events, side, creature, status, false));
  return removed;
}

export function applyTrainerCommand(inputState, side = 'player') {
  if (
    inputState.phase !== 'choice' ||
    !inputState.sides[side] ||
    inputState.sides[side].commandUsed ||
    inputState.sides[side].pendingReplacement
  )
    throw new Error('Trainer command is not available');
  const state = clone(inputState),
    events = [],
    owner = state.sides[side],
    creature = activeOf(state, side),
    command = side === 'player' ? state.doctrine : 'balanced';
  owner.commandUsed = true;
  push(events, 'trainer-command', { side, creatureId: creature.id, command });
  if (command === 'balanced') {
    removeAndEmit(creature, 'negative', 1, side, events);
    if (!healCreature(creature, creature.maxHp * 0.12, side, events, 'command'))
      addBarrier(creature, 8, side, events);
  }
  if (command === 'assault') {
    adjustSurge(state, side, 25, events, 'command');
    applyStatuses(creature, [{ id: 'marked' }], state, side, events, creature.id);
  }
  if (command === 'bastion') {
    addBarrier(creature, 28, side, events);
  }
  if (command === 'ambush')
    applyStatuses(
      creature,
      [{ id: 'focused' }, { id: 'haste', duration: 3 }],
      state,
      side,
      events,
      creature.id
    );
  events.forEach((event) => (event.turn ??= state.turn));
  state.history.push(...events);
  return { state, events };
}

function scaledPower(move, attacker, defender) {
  let power = move.power;
  if (move.scaling === 'speed')
    power *= 1 + (move.scaleAmount * Math.max(0, effectiveSpeed(attacker) - effectiveSpeed(defender))) / 100;
  if (move.scaling === 'missingHp') power *= 1 + move.scaleAmount * (1 - attacker.hp / attacker.maxHp);
  if (move.scaling === 'healthy') power *= 1 + move.scaleAmount * (attacker.hp / attacker.maxHp);
  if (move.scaling === 'targetStatuses')
    power *= 1 + move.scaleAmount * Object.keys(defender.statuses).length;
  if (move.executeThreshold && defender.hp / defender.maxHp <= move.executeThreshold)
    power *= move.executeMultiplier;
  const matches = (move.bonusAgainst || []).filter((id) => hasStatus(defender, id));
  if (matches.length) power *= move.bonusMultiplier;
  if (
    attacker.passive === 'duel_oath' &&
    attacker.hp / attacker.maxHp > 0.5 &&
    defender.hp / defender.maxHp > 0.5
  )
    power *= 1.12;
  if (attacker.passive === 'blood_in_water' && defender.hp / defender.maxHp < 0.5) power *= 1.18;
  const detonated = (move.detonate || []).filter((id) => hasStatus(defender, id));
  power += detonated.length * (move.detonatePower || 0);
  const assistIds = [
    ...new Set(
      [...matches, ...detonated]
        .map((id) => defender.statuses[id]?.sourceCreatureId)
        .filter((id) => id && id !== attacker.id)
    ),
  ];
  return { power, detonated, matches, assistIds };
}

function resolveDamageTransaction(state, side, move, events) {
  const targetSide = otherSide(side),
    attacker = activeOf(state, side),
    defender = activeOf(state, targetSide),
    hits = move.hits || 1;
  if (consume(defender.statuses, 'evasive')) {
    push(events, 'miss', { side: targetSide, sourceSide: side, creatureId: defender.id, moveId: move.id });
    emitStatus(events, targetSide, defender, 'evasive', false);
    return {
      damage: 0,
      absorbed: 0,
      raw: 0,
      affinity: 1,
      combo: [],
      assists: [],
      lethal: false,
      miss: true,
    };
  }
  const focused = consume(attacker.statuses, 'focused'),
    stunned = hasStatus(attacker, 'stunned'),
    markedRecord = defender.statuses.marked || null,
    scaled = scaledPower(move, attacker, defender);
  if (focused) emitStatus(events, side, attacker, 'focused', false, { consumed: true });
  if (markedRecord) {
    delete defender.statuses.marked;
    emitStatus(events, targetSide, defender, 'marked', false, { consumed: true });
  }
  const combo = [...new Set([...scaled.matches, ...scaled.detonated, ...(markedRecord ? ['marked'] : [])])],
    markedHelperId =
      markedRecord?.sourceCreatureId && markedRecord.sourceCreatureId !== attacker.id
        ? markedRecord.sourceCreatureId
        : null,
    assistIds = [...new Set([...scaled.assistIds, ...(markedHelperId ? [markedHelperId] : [])])],
    power = scaled.power * (state.modifiers?.includes('high_voltage') ? 1.18 : 1);
  for (const helperId of assistIds) {
    push(events, 'assist', {
      side,
      creatureId: helperId,
      attackerId: attacker.id,
      statuses: combo.filter(
        (id) =>
          (id === 'marked' ? markedRecord?.sourceCreatureId : defender.statuses[id]?.sourceCreatureId) ===
          helperId
      ),
    });
    adjustSurge(state, side, 8, events, 'assist');
  }
  if (attacker.passive === 'conductor' && markedRecord) {
    passiveEvent(events, side, attacker);
    adjustSurge(state, side, 8, events, 'passive');
  }
  scaled.detonated.forEach((status) => {
    delete defender.statuses[status];
    emitStatus(events, targetSide, defender, status, false, { detonated: true });
  });
  let damage = 0,
    absorbedTotal = 0,
    raw = 0,
    affinity = 1;
  for (let hit = 1; hit <= hits && defender.hp > 0; hit++) {
    const result = calculateDamage({ ...move, power }, attacker, defender, {
      focused,
      marked: Boolean(markedRecord) && hit === 1,
      stunned,
    });
    let incoming = result.damage,
      absorbed = 0;
    raw += result.damage;
    affinity = result.affinity;
    if (!move.ignoreBarrier && defender.barrier > 0) {
      absorbed = Math.min(defender.barrier, incoming);
      defender.barrier -= absorbed;
      incoming -= absorbed;
      absorbedTotal += absorbed;
      push(events, 'barrier-hit', {
        side: targetSide,
        creatureId: defender.id,
        amount: absorbed,
        total: defender.barrier,
      });
    }
    const beforeHp = defender.hp;
    defender.hp = Math.max(0, defender.hp - incoming);
    if (defender.hp === 0 && defender.passive === 'nine_lives' && !defender.talent.nineLives) {
      defender.hp = 1;
      defender.talent.nineLives = true;
      passiveEvent(events, targetSide, defender);
    }
    const hpDamage = beforeHp - defender.hp;
    damage += hpDamage;
    push(events, 'damage', {
      side: targetSide,
      sourceSide: side,
      sourceCreatureId: attacker.id,
      creatureId: defender.id,
      amount: hpDamage,
      rawAmount: result.damage,
      absorbed,
      hit,
      hits,
      hp: defender.hp,
      maxHp: defender.maxHp,
      affinity: result.affinity,
      moveAffinity: move.affinity,
      combo,
      assists: assistIds,
    });
    if (
      defender.passive === 'last_bastion' &&
      defender.hp > 0 &&
      defender.hp / defender.maxHp <= 0.5 &&
      !defender.talent.lastBastion
    ) {
      defender.talent.lastBastion = true;
      passiveEvent(events, targetSide, defender);
      addBarrier(defender, 16, targetSide, events);
    }
    if (
      defender.passive === 'ember_cocoon' &&
      defender.hp > 0 &&
      defender.hp / defender.maxHp <= 0.5 &&
      !defender.talent.emberCocoon
    ) {
      defender.talent.emberCocoon = true;
      passiveEvent(events, targetSide, defender);
      addBarrier(defender, 10, targetSide, events);
    }
  }
  if (defender.hp > 0) {
    const statuses = (move.targetStatuses || []).map((spec) => {
      let duration = spec.duration,
        stacks = spec.stacks;
      if (attacker.passive === 'dream_dust' && duration) duration += 1;
      if (attacker.passive === 'night_terror' && spec.id === 'stunned' && duration) duration += 1;
      if (attacker.passive === 'living_furnace' && spec.id === 'burning') stacks = (stacks || 1) + 1;
      return { ...spec, duration, stacks };
    });
    applyStatuses(defender, statuses, state, targetSide, events, attacker.id);
    if (statuses.length && attacker.passive === 'memory_silk') {
      passiveEvent(events, side, attacker);
      healCreature(attacker, 5, side, events, 'passive');
    }
  }
  return {
    damage,
    absorbed: absorbedTotal,
    raw,
    affinity,
    combo,
    assists: assistIds,
    lethal: defender.hp <= 0,
    miss: false,
  };
}

export function previewMove(state, side, moveId) {
  const move = MOVES[moveId];
  if (!move || move.kind !== 'damage') return null;
  return resolveDamageTransaction(clone(state), side, move, []);
}

export function previewIncomingAfterSwitch(state, defenderSide, index, attackerMoveId) {
  const attackerSide = otherSide(defenderSide),
    snapshot = clone(state),
    events = [];
  if (!snapshot.sides[defenderSide]?.team[index] || index === snapshot.sides[defenderSide].active)
    return null;
  resolveSwitch(snapshot, defenderSide, { type: 'switch', index }, events, false);
  const forecast = previewMove(snapshot, attackerSide, attackerMoveId);
  return forecast ? { ...forecast, perfectRelay: forecast.affinity === 0.5 } : null;
}

export function previewMoveOrder(state, side, moveId, otherMoveId) {
  const move = MOVES[moveId],
    other = MOVES[otherMoveId];
  if (!move || !other) return null;
  if (move.priority !== other.priority) return move.priority > other.priority ? 'first' : 'second';
  const speed = effectiveSpeed(activeOf(state, side)),
    otherSpeed = effectiveSpeed(activeOf(state, otherSide(side)));
  return speed === otherSpeed ? 'tie' : speed > otherSpeed ? 'first' : 'second';
}

function executeMove(state, side, moveId, events) {
  const targetSide = otherSide(side),
    attacker = activeOf(state, side),
    defender = activeOf(state, targetSide),
    move = MOVES[moveId];
  if (attacker.hp <= 0) {
    push(events, 'move-skip', { side, reason: 'ko' });
    return;
  }
  push(events, 'move-start', { side, creatureId: attacker.id, moveId });
  if (move.signature) adjustSurge(state, side, -signatureCostFor(attacker), events, 'signature');
  const owner = state.sides[side];
  if (owner.lastMoveId && owner.lastMoveId !== moveId) {
    owner.flow = Math.min(3, owner.flow + 1);
    const gained = adjustSurge(state, side, owner.flow * 2, events, 'flow'),
      refreshed = [];
    if (owner.flow === 3) {
      for (const [id, cooldown] of Object.entries(attacker.cooldowns)) {
        if ((cooldown?.remaining || 0) <= 0) continue;
        cooldown.remaining -= 1;
        refreshed.push(id);
        if (cooldown.remaining <= 0) delete attacker.cooldowns[id];
      }
    }
    if (gained || owner.flow === 3)
      push(events, 'flow', { side, creatureId: attacker.id, count: owner.flow, surge: gained, refreshed });
  } else if (owner.lastMoveId === moveId) owner.flow = 0;
  owner.lastMoveId = moveId;
  let totalHpDamage = 0;
  if (move.kind === 'damage') {
    const transaction = resolveDamageTransaction(state, side, move, events);
    totalHpDamage = transaction.damage;
    if (!transaction.miss) {
      if (totalHpDamage && consume(defender.statuses, 'countering')) {
        if (attacker.hp > 0) {
          const reflected = Math.max(1, Math.round(totalHpDamage * 0.25));
          attacker.hp = Math.max(0, attacker.hp - reflected);
          push(events, 'recoil', {
            side,
            creatureId: attacker.id,
            amount: reflected,
            hp: attacker.hp,
            maxHp: attacker.maxHp,
            source: 'countering',
          });
        }
        emitStatus(events, targetSide, defender, 'countering', false);
      }
      if (totalHpDamage && defender.passive === 'bramblehide' && attacker.hp > 0) {
        const reflected = Math.max(1, Math.round(totalHpDamage * 0.06));
        passiveEvent(events, targetSide, defender);
        attacker.hp = Math.max(0, attacker.hp - reflected);
        push(events, 'recoil', {
          side,
          creatureId: attacker.id,
          amount: reflected,
          hp: attacker.hp,
          maxHp: attacker.maxHp,
          source: 'bramblehide',
        });
      }
      if (
        totalHpDamage &&
        defender.passive === 'deep_pressure' &&
        attacker.hp > 0 &&
        defender.talent.deepPressureTurn !== state.turn
      ) {
        defender.talent.deepPressureTurn = state.turn;
        passiveEvent(events, targetSide, defender);
        applyStatuses(attacker, [{ id: 'marked', duration: 2 }], state, side, events, defender.id);
      }
    }
  }
  if (move.kind !== 'damage' && move.healRatio)
    healCreature(attacker, attacker.maxHp * move.healRatio, side, events);
  if (move.kind !== 'damage' && defender.hp > 0)
    applyStatuses(defender, move.targetStatuses, state, targetSide, events, attacker.id);
  if (move.teamHealRatio) {
    const boost = attacker.passive === 'spring_tide' ? 1.25 : attacker.passive === 'photosynthesis' ? 1.3 : 1;
    for (const ally of state.sides[side].team)
      if (ally.hp > 0) healCreature(ally, ally.maxHp * move.teamHealRatio * boost, side, events, 'team');
  }
  if (move.teamBarrier)
    for (const ally of state.sides[side].team)
      if (ally.hp > 0) addBarrier(ally, move.teamBarrier, side, events);
  recordKnockout(state, side, attacker, events);
  if (move.drain && totalHpDamage) healCreature(attacker, totalHpDamage * move.drain, side, events, 'drain');
  if (move.recoil && totalHpDamage && attacker.hp > 0) {
    const amount = Math.max(1, Math.round(totalHpDamage * move.recoil));
    attacker.hp = Math.max(0, attacker.hp - amount);
    push(events, 'recoil', {
      side,
      creatureId: attacker.id,
      amount,
      hp: attacker.hp,
      maxHp: attacker.maxHp,
      source: 'recoil',
    });
  }
  if (move.cleanse) removeAndEmit(attacker, 'negative', move.cleanse, side, events);
  if (move.teamCleanse)
    for (const ally of state.sides[side].team)
      if (ally.hp > 0) removeAndEmit(ally, 'negative', move.teamCleanse, side, events);
  if (move.purge) removeAndEmit(defender, 'positive', move.purge, targetSide, events);
  for (const id of move.consume || [])
    if (consume(attacker.statuses, id)) emitStatus(events, side, attacker, id, false, { consumed: true });
  applyStatuses(attacker, move.selfStatuses, state, side, events);
  addBarrier(attacker, move.barrier, side, events);
  if (move.kind === 'damage' && attacker.passive === 'razor_engine') {
    applyStatuses(attacker, [{ id: 'haste', duration: 2 }], state, side, events);
  }
  if (!move.signature) adjustSurge(state, side, move.kind === 'damage' ? 14 : 22, events, move.kind);
  if ((move.hits || 1) > 1 && attacker.passive === 'encore') adjustSurge(state, side, 8, events, 'passive');
  if (totalHpDamage) {
    if (!move.signature) adjustSurge(state, side, totalHpDamage * 0.12, events, 'pressure');
    adjustSurge(state, targetSide, totalHpDamage * 0.3, events, 'resolve');
  }
  if (move.cooldown > 0) {
    const crescendo = owner.flow === 3,
      remaining = Math.max(0, move.cooldown - (crescendo ? 1 : 0));
    if (crescendo) {
      const flowEvent = [...events]
        .reverse()
        .find((event) => event.type === 'flow' && event.side === side && event.count === 3);
      if (flowEvent && !flowEvent.refreshed.includes(move.id)) flowEvent.refreshed.push(move.id);
    }
    if (remaining > 0) attacker.cooldowns[move.id] = { remaining, appliedTurn: state.turn };
  }
  for (const [checkSide, creature] of [
    [targetSide, defender],
    [side, attacker],
  ])
    recordKnockout(state, checkSide, creature, events);
}

function endBattleIfNeeded(state, events) {
  const p = consciousIndices(state, 'player').length,
    e = consciousIndices(state, 'enemy').length;
  if (p && e) return false;
  if (!p && !e) {
    const next = randomFromState(state.rngState);
    state.rngState = next.state;
    state.winner = next.value < 0.5 ? 'player' : 'enemy';
  } else state.winner = p ? 'player' : 'enemy';
  state.phase = 'ended';
  state.reason = 'knockout';
  push(events, 'battle-end', { winner: state.winner, reason: state.reason });
  return true;
}
function capWinner(state) {
  const scores = ['player', 'enemy'].map((side) => {
    const team = state.sides[side].team;
    return {
      side,
      conscious: team.filter((c) => c.hp > 0).length,
      ratio: team.reduce((n, c) => n + c.hp / c.maxHp, 0),
    };
  });
  if (scores[0].conscious !== scores[1].conscious)
    return scores[0].conscious > scores[1].conscious ? 'player' : 'enemy';
  if (Math.abs(scores[0].ratio - scores[1].ratio) > 1e-9)
    return scores[0].ratio > scores[1].ratio ? 'player' : 'enemy';
  const next = randomFromState(state.rngState);
  state.rngState = next.state;
  return next.value < 0.5 ? 'player' : 'enemy';
}
function arenaPulse(state, events) {
  const cadence = state.modifiers?.includes('rapid_arena') ? 2 : 4;
  if (!state.arena || state.turn % cadence !== 0) return;
  push(events, 'arena-pulse', { arena: state.arena, turn: state.turn });
  for (const side of ['player', 'enemy']) {
    const creature = activeOf(state, side);
    if (creature.hp <= 0) continue;
    if (state.arena === 'crystal') addBarrier(creature, 5, side, events);
    if (state.arena === 'grove') healCreature(creature, creature.maxHp * 0.05, side, events, 'arena');
    if (state.arena === 'tidal') {
      removeAndEmit(creature, 'negative', 1, side, events);
      addBarrier(creature, 3, side, events);
    }
    if (state.arena === 'volcano') {
      const amount = Math.max(1, Math.round(creature.maxHp * 0.05));
      creature.hp = Math.max(1, creature.hp - amount);
      push(events, 'status-tick', {
        side,
        creatureId: creature.id,
        status: 'burning',
        amount,
        hp: creature.hp,
        maxHp: creature.maxHp,
        source: 'arena',
      });
    }
    if (state.arena === 'astral') {
      if (hasStatus(creature, 'focused')) adjustSurge(state, side, 15, events, 'arena');
      else {
        applyStatus(creature, 'focused', state.turn);
        emitStatus(events, side, creature, 'focused', true, { source: 'arena' });
      }
    }
    if (state.arena === 'eclipse' && !hasStatus(creature, 'marked')) {
      applyStatus(creature, 'marked', state.turn, 3);
      emitStatus(events, side, creature, 'marked', true, { remaining: 3, source: 'arena' });
    }
    if (creature.affinity === ARENA_RESONANCE[state.arena]) {
      push(events, 'resonance', {
        side,
        creatureId: creature.id,
        arena: state.arena,
        affinity: creature.affinity,
      });
      adjustSurge(state, side, 10, events, 'resonance');
    }
  }
}
function tickEnd(state, events) {
  for (const side of ['player', 'enemy'])
    for (const [index, creature] of state.sides[side].team.entries()) {
      const isActive = index === state.sides[side].active;
      if (creature.hp > 0 && isActive) {
        const dot = [['burning', 0.05]];
        for (const [status, ratio] of dot)
          if (hasStatus(creature, status)) {
            const amount = Math.max(1, Math.round(creature.maxHp * ratio * statusStacks(creature, status)));
            creature.hp = Math.max(0, creature.hp - amount);
            push(events, 'status-tick', {
              side,
              creatureId: creature.id,
              status,
              amount,
              hp: creature.hp,
              maxHp: creature.maxHp,
            });
          }
        if (creature.hp <= 0) {
          push(events, 'ko', { side, creatureId: creature.id });
          const remaining = consciousIndices(state, side).filter((i) => i !== state.sides[side].active);
          if (remaining.length) state.sides[side].pendingReplacement = true;
        }
      }
      tickTimed(creature.statuses, state.turn);
      tickTimed(creature.cooldowns, state.turn);
    }
  arenaPulse(state, events);
}

export function resolveTurn(inputState, playerAction, enemyAction) {
  if (inputState.phase !== 'choice') throw new Error('Battle is not accepting actions');
  if (!isLegalAction(inputState, 'player', playerAction) || !isLegalAction(inputState, 'enemy', enemyAction))
    throw new Error('Illegal action');
  const state = clone(inputState),
    events = [],
    resolvedTurn = state.turn,
    actions = { player: playerAction, enemy: enemyAction };
  for (const side of ['player', 'enemy'])
    if (actions[side].type === 'switch') resolveSwitch(state, side, actions[side], events);
  const moveSides = ['player', 'enemy'].filter((side) => actions[side].type === 'move');
  moveSides.sort((a, b) => {
    const ma = MOVES[actions[a].moveId],
      mb = MOVES[actions[b].moveId];
    if (ma.priority !== mb.priority) return mb.priority - ma.priority;
    const speedDelta = effectiveSpeed(activeOf(state, b)) - effectiveSpeed(activeOf(state, a));
    if (speedDelta) return speedDelta;
    const next = randomFromState(state.rngState);
    state.rngState = next.state;
    return next.value < 0.5 ? -1 : 1;
  });
  for (const side of moveSides) {
    const targetSide = otherSide(side),
      move = MOVES[actions[side].moveId],
      forecast =
        actions[targetSide].type === 'switch' && move.kind === 'damage'
          ? previewMove(state, side, move.id)
          : null;
    if (forecast?.affinity === 0.5) {
      const defender = activeOf(state, targetSide);
      push(events, 'perfect-relay', {
        side: targetSide,
        sourceSide: side,
        creatureId: defender.id,
        moveId: move.id,
      });
      adjustSurge(state, targetSide, 6, events, 'perfect-relay');
    }
  }
  for (const side of moveSides) {
    executeMove(state, side, actions[side].moveId, events);
    if (endBattleIfNeeded(state, events)) break;
  }
  if (state.phase !== 'ended') {
    triggerFinalDuel(state, events);
    tickEnd(state, events);
    triggerFinalDuel(state, events);
    if (!endBattleIfNeeded(state, events)) {
      if (state.turn >= TURN_CAP) {
        state.winner = capWinner(state);
        state.phase = 'ended';
        state.reason = 'turn-cap';
        push(events, 'battle-end', { winner: state.winner, reason: state.reason });
      } else {
        state.turn += 1;
        state.phase =
          state.sides.player.pendingReplacement || state.sides.enemy.pendingReplacement
            ? 'replacement'
            : 'choice';
      }
    }
  }
  events.forEach((event) => (event.turn ??= resolvedTurn));
  state.history.push(...events);
  return { state, events };
}
export function applyReplacement(inputState, side, action) {
  if (!isLegalAction(inputState, side, action)) throw new Error('Illegal replacement');
  const state = clone(inputState),
    events = [];
  resolveSwitch(state, side, action, events, true);
  if (!state.sides.player.pendingReplacement && !state.sides.enemy.pendingReplacement) state.phase = 'choice';
  events.forEach((event) => (event.turn ??= state.turn));
  state.history.push(...events);
  return { state, events };
}
export function safeBattleSnapshot(state) {
  return clone(state);
}
