// Pure presentation grouping: engine event list -> ordered beats (docs/battle-presentation.md §3).
// No DOM, no ctx, no Math.random: the director (director.js) turns each beat into a timed
// choreography on the session fx-clock. Every input event lands in exactly one beat.
import { MOVES } from '../data/moves.js';

// Wall-clock budget of each beat at ×1, hit-stops included (§3.4). The director time-scales
// its timelines to these numbers; ×2 and hurry divide them through the clock rate.
export const BEAT_BUDGET_MS = Object.freeze({
  action: Object.freeze({ 1: 700, 2: 1000, 3: 1150 }),
  signatureCutIn: 450,
  // The clash band announces both Signatures at once: the answering one plays no band of its own.
  clashCutIn: 600,
  extraHit: Object.freeze({ 1: 220, 2: 220, 3: 120 }),
  addOn: 250,
  actionCap: Object.freeze({ 1: 1500, 2: 1500, 3: 1800 }),
  // The K.O. flash, stamp and dissolve (BEAT_TIMELINES.ko): short, so a lethal blow → K.O. →
  // next creature chain stays short (K.O. turns are the pacing tail).
  ko: 500,
  extraKo: 300,
  // A lethal action hands its readout tail to the K.O. beat that follows it (the K.O. stamp
  // replaces the number; non-lethal numbers keep their full ≥ 450 ms). The director also ends it
  // just after its last contact when that comes first.
  lethalHandOff: 400,
  switch: 700,
  // A replacement enters an empty pad (the fainted creature already dissolved): no recall.
  replacement: 400,
  cutin: Object.freeze({ 'perfect-relay': 600, 'trainer-command': 700, ace: 900 }),
  tick: 500,
  // A lethal tick hands its number to the K.O. beat like a lethal action: the number lands at 80
  // and the K.O. beat takes over 40 ms later.
  lethalTick: 120,
  effects: 300,
  skip: 0,
  end: 0,
  reducedReadout: 450,
  reducedExtraHit: 150,
});

const TIER_TWO_POWER = 34;
const READOUT_TYPES = new Set(['heal', 'barrier', 'barrier-break', 'recoil']);

// Visual intensity tier of a move: Signature -> 3, power × hits ≥ 34 -> 2, else 1.
export function moveTier(move) {
  if (!move) return 1;
  if (move.signature) return 3;
  return (move.power || 0) * (move.hits || 1) >= TIER_TWO_POWER ? 2 : 1;
}

// FNV-1a over the parts: the only seed source for FX randomness (never the engine RNG).
export function fxSeed(...parts) {
  const text = parts.join('|');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// mulberry32: deterministic [0, 1) stream for one emitter/cue.
export function fxRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function withRows(beat) {
  return Object.assign(beat, {
    effects: [],
    chips: [],
    talents: [],
    readouts: [],
    surges: [],
    readySides: [],
  });
}

function actionBeat(event) {
  const move = MOVES[event.moveId],
    baseTier = moveTier(move);
  return withRows({
    kind: 'action',
    side: event.side,
    targetSide: event.side === 'player' ? 'enemy' : 'player',
    creatureId: event.creatureId,
    moveId: event.moveId,
    signature: Boolean(move?.signature),
    baseTier,
    tier: baseTier,
    critical: false,
    lethal: false,
    clash: false,
    seed: fxSeed(event.moveId, event.turn ?? 0, 0),
    start: event,
    hits: [],
    miss: null,
    assist: null,
    combo: null,
    consumed: [],
    stamps: [],
    events: [event],
    pendingBarrierHit: null,
  });
}

function switchBeat(event) {
  return withRows({
    kind: 'switch',
    side: event.side,
    creatureId: event.creatureId,
    from: event.from,
    to: event.to,
    source: event.source,
    replacement: event.type === 'replace',
    start: event,
    events: [event],
  });
}

function cutInBeat(event) {
  return withRows({
    kind: 'cutin',
    cutIn: event.type,
    side: event.side,
    creatureId: event.creatureId,
    start: event,
    events: [event],
  });
}

function chipBeat(chip, event) {
  return withRows({
    kind: 'chip',
    chip,
    ticks: chip === 'tick' ? [event] : [],
    skips: chip === 'skip' ? [event] : [],
    events: event ? [event] : [],
  });
}

// A removal the engine emits because the status was just used up: Evasive right after its
// miss, Riposte right after its reflected recoil.
function isUsedUp(beat, event) {
  if (event.type !== 'status' || event.applied !== false) return false;
  const previous = beat.events.at(-1);
  if (event.status === 'evasive')
    return previous?.type === 'miss' && previous.creatureId === event.creatureId;
  if (event.status === 'countering') return previous?.type === 'recoil' && previous.source === 'countering';
  return false;
}

function addToAction(beat, event) {
  if (event.type === 'surge') {
    beat.surges.push(event);
    if (event.ready && !beat.readySides.includes(event.side)) beat.readySides.push(event.side);
  } else if (event.type === 'status' && (event.consumed || isUsedUp(beat, event))) beat.consumed.push(event);
  else if (event.type === 'assist') beat.assist = event;
  else if (event.type === 'barrier-hit') beat.pendingBarrierHit = event;
  else if (event.type === 'damage') {
    const barrierHit = beat.pendingBarrierHit,
      blocked = event.amount === 0 && event.absorbed > 0;
    beat.pendingBarrierHit = null;
    if (event.combo) beat.combo = event.combo;
    beat.hits.push({
      hit: event.hit,
      hits: event.hits,
      damage: event,
      barrierHit,
      between: [],
      amount: event.amount,
      absorbed: event.absorbed,
      affinity: event.affinity,
      critical: Boolean(event.critical),
      blocked,
      lethal: event.hp <= 0,
      seed: fxSeed(beat.moveId, event.turn ?? 0, event.hit),
    });
  } else if (event.type === 'miss') beat.miss = event;
  else if (beat.hits.length) beat.hits.at(-1).between.push(event);
  else beat.effects.push(event);
  beat.events.push(event);
}

function addToRows(beat, event) {
  if (event.type === 'surge') {
    beat.surges.push(event);
    if (event.ready && !beat.readySides.includes(event.side)) beat.readySides.push(event.side);
  } else if (event.type === 'status-tick' && beat.kind === 'chip') beat.ticks.push(event);
  else beat.effects.push(event);
  beat.events.push(event);
}

function deriveRows(beat) {
  const chips = new Map();
  for (const event of beat.effects) {
    if (event.type === 'status') {
      const key = `${event.side}:${event.creatureId}:${event.status}`,
        chip = {
          side: event.side,
          creatureId: event.creatureId,
          status: event.status,
          applied: event.applied,
          stacks: event.stacks ?? null,
          remaining: event.remaining ?? null,
          event,
        };
      if (chips.has(key)) chips.delete(key);
      chips.set(key, chip);
    } else if (event.type === 'passive') beat.talents.push(event);
    else if (READOUT_TYPES.has(event.type)) beat.readouts.push(event);
  }
  beat.chips = [...chips.values()];
}

function finishAction(beat) {
  const last = beat.hits.at(-1);
  if (last) {
    beat.effects.push(...last.between);
    last.between = [];
  }
  if (beat.pendingBarrierHit) beat.effects.push(beat.pendingBarrierHit);
  delete beat.pendingBarrierHit;
  beat.critical = beat.hits.some((hit) => hit.critical);
  beat.lethal = beat.hits.some((hit) => hit.lethal);
  if (beat.critical) beat.tier = Math.min(3, beat.baseTier + 1);
  if (beat.miss) beat.stamps.push('miss');
  else if (beat.hits.length) {
    const landed = beat.hits.filter((hit) => !hit.blocked);
    if (!landed.length) beat.stamps.push('blocked');
    else {
      if (landed.some((hit) => hit.critical)) beat.stamps.push('critical');
      if (landed[0].affinity > 1) beat.stamps.push('effective');
      else if (landed[0].affinity < 1) beat.stamps.push('resisted');
    }
  }
}

// Ordered beats for one engine result (resolveTurn, applyReplacement or applyTrainerCommand).
export function groupBeats(events) {
  const beats = [];
  let segment = null,
    koBeat = null;
  const open = (beat) => {
    beats.push(beat);
    segment = beat;
    koBeat = null;
  };
  for (const event of events) {
    switch (event.type) {
      case 'move-start':
        open(actionBeat(event));
        break;
      case 'switch':
      case 'replace':
        open(switchBeat(event));
        break;
      case 'perfect-relay':
      case 'trainer-command':
      case 'ace':
        open(cutInBeat(event));
        break;
      case 'status-tick':
        if (segment?.kind === 'chip' && segment.chip === 'tick') addToRows(segment, event);
        else open(chipBeat('tick', event));
        break;
      case 'battle-end':
        open({ kind: 'end', winner: event.winner, reason: event.reason, events: [event] });
        break;
      case 'move-skip': {
        const previous = beats.at(-1);
        if (previous?.kind === 'ko') {
          previous.skips.push(event);
          previous.events.push(event);
        } else open(chipBeat('skip', event));
        break;
      }
      case 'ko':
        if (!koBeat) {
          koBeat = { kind: 'ko', kos: [], skips: [], events: [] };
          beats.push(koBeat);
        }
        koBeat.kos.push({ side: event.side, creatureId: event.creatureId });
        koBeat.events.push(event);
        break;
      default:
        if (!segment || segment.kind === 'end' || (segment.kind === 'chip' && segment.chip === 'skip'))
          open(chipBeat('effects', null));
        if (segment.kind === 'action') addToAction(segment, event);
        else addToRows(segment, event);
    }
  }
  for (const beat of beats) {
    if (beat.kind === 'action') finishAction(beat);
    if (beat.effects) deriveRows(beat);
  }
  const signatures = beats.filter((beat) => beat.kind === 'action' && beat.signature);
  const answer = signatures.find((beat) => beat.side !== signatures[0].side);
  if (answer) {
    signatures[0].clash = true;
    answer.clashAnswer = true;
  }
  for (const beat of beats)
    if (beat.kind === 'chip' && beat.chip === 'tick') beat.lethal = beat.ticks.some((tick) => tick.hp <= 0);
  return beats;
}

function landedHits(beat) {
  return Math.max(1, beat.hits.length);
}

// The merged chip row (status changes, talents) extends a beat; number readouts (heal, barrier,
// recoil) overlap the contact readout window instead.
function hasAddOn(beat) {
  return beat.chips.length + beat.talents.length > 0;
}

// Nominal wall-clock length of one beat at ×1 (hit-stops included, rate not applied).
export function beatBudgetMs(beat, { reducedMotion = false } = {}) {
  const budget = BEAT_BUDGET_MS;
  if (beat.kind === 'end') return budget.end;
  if (beat.kind === 'chip' && beat.chip === 'skip') return budget.skip;
  if (reducedMotion) {
    if (beat.kind === 'action')
      return budget.reducedReadout + budget.reducedExtraHit * (landedHits(beat) - 1);
    return budget.reducedReadout;
  }
  if (beat.kind === 'action') {
    const cutIn =
        beat.signature && !beat.clashAnswer ? (beat.clash ? budget.clashCutIn : budget.signatureCutIn) : 0,
      total =
        cutIn +
        budget.action[beat.tier] +
        budget.extraHit[beat.tier] * (landedHits(beat) - 1) +
        (hasAddOn(beat) ? budget.addOn : 0);
    return Math.min(total, budget.actionCap[beat.tier]) - (beat.lethal ? budget.lethalHandOff : 0);
  }
  if (beat.kind === 'ko') return budget.ko + budget.extraKo * (beat.kos.length - 1);
  if (beat.kind === 'switch')
    return (beat.replacement ? budget.replacement : budget.switch) + (hasAddOn(beat) ? budget.addOn : 0);
  if (beat.kind === 'cutin') return budget.cutin[beat.cutIn] + (hasAddOn(beat) ? budget.addOn : 0);
  if (beat.kind === 'chip')
    return beat.chip === 'tick' ? (beat.lethal ? budget.lethalTick : budget.tick) : budget.effects;
  return 0;
}

export function turnBudgetMs(beats, options) {
  return beats.reduce((total, beat) => total + beatBudgetMs(beat, options), 0);
}
