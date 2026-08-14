import { MOVES } from '../data/moves.js';
import { affinityMultiplier } from '../data/affinities.js';
import {
  activeOf,
  BARRIER_CAP,
  getLegalActions,
  previewIncomingAfterSwitch,
  previewMove,
  safeBattleSnapshot,
  signatureCostFor,
} from './engine.js';
import { STATUS_DEFINITIONS } from './statuses.js';
import { randomIndex, randomFromState } from './rng.js';

function scoreMove(state, side, action, difficulty, style) {
  const attacker = activeOf(state, side);
  const defender = activeOf(state, side === 'player' ? 'enemy' : 'player');
  const move = MOVES[action.moveId];
  if (move.kind === 'damage') {
    const forecast = previewMove(state, side, move.id),
      estimated = forecast.damage,
      affinity = forecast.affinity;
    let score =
      estimated +
      (forecast.lethal ? 90 : 0) +
      (affinity === 2 ? 12 : affinity === 0.5 ? -8 : 0) -
      (forecast.miss ? 45 : 0);
    if (move.targetStatuses?.length)
      score += move.targetStatuses.length * (difficulty === 'apprentice' ? 2 : 8);
    if (move.selfStatuses?.some((x) => x.id === 'marked'))
      score -= ['standard', 'champion'].includes(difficulty) ? 9 : 3;
    if (move.drain) score += Math.min(attacker.maxHp - attacker.hp, estimated * move.drain) * 0.6;
    if (move.recoil) score -= estimated * move.recoil * 0.7;
    if (move.executeThreshold && defender.hp / defender.maxHp <= move.executeThreshold) score += 28;
    if (forecast.combo.length) score += 20 + forecast.combo.length * 5;
    if (move.barrier) score += Math.min(move.barrier, Math.max(0, BARRIER_CAP - attacker.barrier)) * 0.35;
    if (move.signature) score += 14;
    if (style === 'speed') score += (move.priority || 0) * 7 + (move.scaling === 'speed' ? 12 : 0);
    if (style === 'endurance')
      score += (move.drain ? 14 : 0) + (move.barrier || 0) * 0.35 + (move.teamHealRatio ? 18 : 0);
    if (style === 'control')
      score +=
        (move.targetStatuses?.length || 0) * 9 +
        (difficulty !== 'standard' && move.detonate?.some((id) => defender.statuses[id]) ? 15 : 0);
    if (style === 'pressure')
      score += estimated * 0.16 + (move.targetStatuses?.some((x) => x.id === 'burning') ? 12 : 0);
    if (style === 'deception')
      score +=
        (move.selfStatuses?.some((x) => ['evasive', 'countering'].includes(x.id)) ? 18 : 0) +
        (move.purge ? 8 : 0);
    score -= move.cooldown * (difficulty === 'apprentice' ? 1 : 3);
    return score;
  }
  if (move.kind === 'heal') {
    const team = state.sides[side].team,
      teamMissing = team.reduce((n, c) => n + (c.hp > 0 ? c.maxHp - c.hp : 0), 0),
      selfMissing = attacker.maxHp - attacker.hp,
      relevantMissing = move.teamHealRatio ? teamMissing : selfMissing,
      capacity = move.teamHealRatio
        ? team.reduce((n, c) => n + (c.hp > 0 ? c.maxHp : 0), 0) * move.teamHealRatio
        : attacker.maxHp * (move.healRatio || 0),
      effective = Math.min(relevantMissing, capacity);
    let score = effective > 0 ? 18 + effective * 0.72 : -25;
    if (style === 'endurance') score += 16;
    if (move.signature) score += attacker.hp / attacker.maxHp < 0.42 ? 24 : -8;
    return score;
  }
  if (move.kind === 'support') {
    const team = state.sides[side].team,
      negativeCount = (creature) =>
        Object.keys(creature.statuses).filter(
          (id) => STATUS_DEFINITIONS[id] && !STATUS_DEFINITIONS[id].positive
        ).length,
      ownNegatives = negativeCount(attacker),
      teamNegatives = team.filter((c) => c.hp > 0).reduce((sum, c) => sum + negativeCount(c), 0),
      teamMissing = team.filter((c) => c.hp > 0).reduce((sum, c) => sum + c.maxHp - c.hp, 0),
      barrierValue = Math.min(move.barrier || 0, Math.max(0, BARRIER_CAP - attacker.barrier)),
      teamBarrierValue = move.teamBarrier
        ? team
            .filter((c) => c.hp > 0)
            .reduce((sum, c) => sum + Math.min(move.teamBarrier, Math.max(0, BARRIER_CAP - c.barrier)), 0)
        : 0,
      teamHealValue = move.teamHealRatio
        ? team
            .filter((c) => c.hp > 0)
            .reduce((sum, c) => sum + Math.min(c.maxHp - c.hp, c.maxHp * move.teamHealRatio), 0)
        : 0,
      selfHealValue = move.healRatio
        ? Math.min(attacker.maxHp - attacker.hp, attacker.maxHp * move.healRatio)
        : 0;
    let score =
      barrierValue * 0.7 +
      teamBarrierValue * 0.48 +
      teamHealValue * 0.62 +
      selfHealValue * 0.72 +
      (move.cleanse ? ownNegatives * 9 : 0) +
      (move.teamCleanse ? teamNegatives * 8 : 0);
    for (const status of move.selfStatuses || [])
      score += attacker.statuses[status.id] ? -4 : status.id === 'focused' ? 17 : 10;
    for (const status of move.targetStatuses || []) score += defender.statuses[status.id] ? -4 : 12;
    if (style === 'endurance') score += (barrierValue + teamBarrierValue) * 0.28 + 12;
    if (style === 'control') score += (move.targetStatuses?.length || 0) * 10;
    if (style === 'deception' && move.selfStatuses?.some((x) => ['evasive', 'countering'].includes(x.id)))
      score += 18;
    if (move.signature) {
      const pressure =
        1 -
        attacker.hp / attacker.maxHp +
        teamMissing / team.filter((c) => c.hp > 0).reduce((sum, c) => sum + c.maxHp, 1) +
        teamNegatives * 0.15;
      score += pressure > 0.55 ? 25 : -15;
    }
    return score + (1 - attacker.hp / attacker.maxHp) * 10 - move.cooldown * 2;
  }
  return 0;
}

function scoreSwitch(state, side, action, difficulty, style) {
  if (difficulty === 'apprentice') return -10;
  const owner = state.sides[side];
  const candidate = owner.team[action.index];
  const defender = activeOf(state, side === 'player' ? 'enemy' : 'player');
  const lastOwnDecision = [...state.history]
    .reverse()
    .find((event) => event.side === side && ['move-start', 'switch'].includes(event.type));
  const outgoing = affinityMultiplier(candidate.affinity, defender.affinity);
  const incoming = affinityMultiplier(defender.affinity, candidate.affinity);
  const relayFever = state.modifiers?.includes('relay_fever'),
    hasAffordableSignature = candidate.moves.some(
      (id) => MOVES[id].signature && state.sides[side].surge >= signatureCostFor(candidate)
    ),
    relayReadiesSignature =
      relayFever &&
      !hasAffordableSignature &&
      candidate.moves.some(
        (id) => MOVES[id].signature && state.sides[side].surge + 24 >= signatureCostFor(candidate)
      );
  const opponentSide = side === 'player' ? 'enemy' : 'player',
    signatureThreat =
      state.sides[opponentSide].surge >= signatureCostFor(defender)
        ? defender.moves.map((id) => MOVES[id]).find((move) => move.signature && move.kind === 'damage')
        : null,
    signatureRead = signatureThreat
      ? affinityMultiplier(signatureThreat.affinity, candidate.affinity) === 0.5
        ? 44
        : affinityMultiplier(signatureThreat.affinity, candidate.affinity) === 2
          ? -20
          : 0
      : 0,
    primed = defender.moves
      .flatMap((id) => MOVES[id].detonate || [])
      .some((status) => candidate.statuses[status]);
  return (
    (outgoing - 1) * 28 -
    (incoming - 1) * 22 +
    (candidate.hp / candidate.maxHp) * 7 -
    6 +
    (hasAffordableSignature ? 20 : 0) +
    (relayFever ? 26 : 0) +
    (relayReadiesSignature ? 25 : 0) +
    (style === 'deception' ? 8 : 0) +
    (lastOwnDecision?.type === 'switch' ? -30 : 0) +
    (difficulty === 'champion' ? signatureRead + (primed ? 18 : 0) : 0) +
    // Without a response forecast, Standard overvalues a visibly favorable
    // matchup and pivots a little too eagerly—a readable, human mistake.
    (difficulty === 'standard' ? 17 : 0)
  );
}

export function chooseAiAction(sourceState, side = 'enemy', difficulty = 'apprentice', style = 'direct') {
  const state = safeBattleSnapshot(sourceState);
  // Keep old saves and callers source-compatible while the former middle tier is renamed.
  difficulty = difficulty === 'challenger' ? 'standard' : difficulty;
  const finish = (action) => {
    sourceState.rngState = state.rngState;
    return action;
  };
  const legal = getLegalActions(state, side);
  if (!legal.length) throw new Error('AI has no legal action');
  if (legal[0].type === 'replace') {
    const scored = legal.map((action) => ({
      action,
      score: scoreSwitch(state, side, { ...action, type: 'switch' }, difficulty, style),
    }));
    return finish(pickBest(state, scored).action);
  }
  const scored = legal.map((action) => ({
    action,
    score:
      action.type === 'move'
        ? scoreMove(state, side, action, difficulty, style)
        : scoreSwitch(state, side, action, difficulty, style),
  }));
  if (difficulty === 'apprentice') {
    const roll = randomFromState(state.rngState);
    state.rngState = roll.state;
    if (roll.value < 0.6) {
      const choice = randomIndex(state.rngState, legal.length);
      state.rngState = choice.state;
      return finish(legal[choice.index]);
    }
  }
  if (difficulty === 'standard' || difficulty === 'champion') {
    for (const item of scored) {
      if (item.action.type === 'move' && MOVES[item.action.moveId].kind === 'damage')
        item.score += difficulty === 'champion' ? 40 : 3;
      if (item.action.type === 'switch' && activeOf(state, side).hp < activeOf(state, side).maxHp * 0.3)
        item.score += 13;
      const opponentSide = side === 'player' ? 'enemy' : 'player',
        opponent = activeOf(state, opponentSide);
      // Standard never runs the opponent-response forecast. It uses the same
      // tactical scoring vocabulary as Champion, but reacts only to visible
      // board fundamentals and therefore cannot optimize a hypothetical pivot.
      const replyDamage =
        difficulty === 'champion'
          ? opponent.moves
              .map((id) => MOVES[id])
              .filter((move) => move.kind === 'damage' && !opponent.cooldowns[move.id]?.remaining)
              .reduce((best, move) => {
                const forecast =
                  item.action.type === 'switch'
                    ? previewIncomingAfterSwitch(state, side, item.action.index, move.id)
                    : previewMove(state, opponentSide, move.id);
                return Math.max(best, forecast?.damage || 0);
              }, 0)
          : 0;
      item.score -= replyDamage * 0.35;
      const lastOwnMove = [...state.history]
        .reverse()
        .find((event) => event.type === 'move-start' && event.side === side)?.moveId;
      if (item.action.type === 'move' && item.action.moveId === lastOwnMove) item.score -= 4;
      const opponentSignatureReady =
        state.sides[side === 'player' ? 'enemy' : 'player'].surge >= signatureCostFor(opponent) &&
        opponent.moves.some((id) => MOVES[id].signature);
      if (difficulty === 'champion' && opponentSignatureReady && item.action.type === 'move') {
        const move = MOVES[item.action.moveId];
        if (move.selfStatuses?.some((status) => ['evasive', 'countering'].includes(status.id)))
          item.score += 24;
        if (move.targetStatuses?.some((status) => status.id === 'stunned')) item.score += 12;
      }
    }
  }
  const imperfection = difficulty === 'standard' ? 0.28 : 0;
  return finish(pickRanked(state, scored, imperfection).action);
}

function pickRanked(state, scored, secondBestChance) {
  if (!secondBestChance || scored.length < 2) return pickBest(state, scored);
  const roll = randomFromState(state.rngState);
  state.rngState = roll.state;
  if (roll.value >= secondBestChance) return pickBest(state, scored);
  const scores = [...new Set(scored.map((item) => item.score))].sort((a, b) => b - a),
    secondScore = scores[1] ?? scores[0],
    choices = scored.filter((item) => Math.abs(item.score - secondScore) < 1e-9);
  if (choices.length === 1) return choices[0];
  const choice = randomIndex(state.rngState, choices.length);
  state.rngState = choice.state;
  return choices[choice.index];
}

function pickBest(state, scored) {
  const best = Math.max(...scored.map((x) => x.score));
  const ties = scored.filter((x) => Math.abs(x.score - best) < 1e-9);
  if (ties.length === 1) return ties[0];
  const choice = randomIndex(state.rngState, ties.length);
  state.rngState = choice.state;
  return ties[choice.index];
}
