import { CREATURES, CREATURE_IDS } from './creatures.js';
import { MOVES } from './moves.js';
import { affinityMultiplier } from './affinities.js';
import { teamComboRoutes } from './combos.js';
import { normalizeSeed, randomFromState } from '../battle/rng.js';

export const PROFILE_AXES = Object.freeze(['pressure', 'control', 'sustain', 'tempo']);
export const REMIX_DITHER_MAX = 5;

export function teamProfile(ids = []) {
  const creatures = ids.map((id) => CREATURES[id]).filter(Boolean),
    moves = creatures.flatMap((creature) => creature.moves.map((id) => MOVES[id]).filter(Boolean));
  const raw = { pressure: 0, control: 0, sustain: 0, tempo: 0 };
  for (const creature of creatures) raw.tempo += creature.speed * 0.13;
  for (const move of moves) {
    if (move.kind === 'damage')
      raw.pressure +=
        (move.power || 0) * (move.hits || 1) * 0.42 +
        (move.executeMultiplier ? 15 : 0) +
        (move.signature ? 8 : 0);
    const targetStatuses = [...new Set((move.targetStatuses || []).map((status) => status.id))];
    raw.control +=
      targetStatuses.filter((id) => id === 'stunned' || id === 'rooted').length * 15 +
      (targetStatuses.includes('marked') ? 8 : 0) +
      (move.combo ? 5 : 0) +
      (move.purge ? 9 : 0) +
      (move.purgeTeam ? 18 : 0) +
      (move.purgeBarrier ? 12 : 0) +
      (move.owner === 'xylocorne' ? 4 : 0);
    raw.pressure +=
      (targetStatuses.includes('burning') ? 12 : 0) +
      (targetStatuses.includes('marked') ? 6 : 0) +
      (move.id === 'venom_harvest' ? 19 : 0);
    raw.sustain +=
      (move.barrier || 0) * 0.8 +
      (move.teamBarrier || 0) * 2.2 +
      (move.healRatio || 0) * 130 +
      (move.teamHealRatio || 0) * 330 +
      (move.cleanse ? 10 : 0) +
      (move.teamCleanse === 'all' ? 28 : move.teamCleanse ? 18 : 0) +
      (move.allySwitch ? 18 : 0) +
      (move.drain || 0) * 24;
    raw.tempo +=
      Math.max(0, move.priority || 0) * 7 +
      (move.selfStatuses?.some((status) => status.id === 'haste') ? 10 : 0) +
      (move.selfStatuses?.some((status) => status.id === 'evasive') ? 7 : 0) +
      (move.hits > 1 ? 4 : 0) +
      (move.allySwitch ? 22 : 0);
  }
  const scales = { pressure: 255, control: 135, sustain: 190, tempo: 145 },
    scores = Object.fromEntries(
      PROFILE_AXES.map((axis) => [axis, Math.min(100, Math.round((raw[axis] / scales[axis]) * 100))])
    ),
    dominant = PROFILE_AXES.reduce(
      (best, axis) => (scores[axis] > scores[best] ? axis : best),
      PROFILE_AXES[0]
    );
  return { ...scores, dominant };
}

export function bestLeadIndex(ids = [], enemyIds = []) {
  const score = (id) =>
    enemyIds.reduce(
      (total, enemyId) =>
        total +
        (affinityMultiplier(CREATURES[id]?.affinity, CREATURES[enemyId]?.affinity) === 2 ? 3 : 0) -
        (affinityMultiplier(CREATURES[enemyId]?.affinity, CREATURES[id]?.affinity) === 2 ? 2 : 0),
      0
    ) +
    (CREATURES[id]?.speed || 0) / 1000;
  return ids.reduce((best, id, index) => (score(id) > score(ids[best]) ? index : best), 0);
}

export function remixTeam(enemyIds = [], seed = 1) {
  const ids = CREATURE_IDS;
  let rngState = normalizeSeed(seed),
    best = null;
  for (let a = 0; a < ids.length - 2; a++)
    for (let b = a + 1; b < ids.length - 1; b++)
      for (let c = b + 1; c < ids.length; c++) {
        const team = [ids[a], ids[b], ids[c]],
          affinities = new Set(team.map((id) => CREATURES[id].affinity)),
          classes = new Set(team.map((id) => CREATURES[id].classId)),
          matchup = team.reduce(
            (total, id) =>
              total +
              enemyIds.reduce(
                (sum, enemyId) =>
                  sum +
                  (affinityMultiplier(CREATURES[id].affinity, CREATURES[enemyId]?.affinity) === 2 ? 3 : 0) -
                  (affinityMultiplier(CREATURES[enemyId]?.affinity, CREATURES[id].affinity) === 2 ? 2 : 0),
                0
              ),
            0
          ),
          roll = randomFromState(rngState);
        rngState = roll.state;
        const score =
          affinities.size * 9 +
          classes.size * 2 +
          Math.min(4, teamComboRoutes(team).length) * 5 +
          matchup * 2 +
          roll.value * REMIX_DITHER_MAX;
        if (!best || score > best.score) best = { team, score };
      }
  const team = best?.team || ids.slice(0, 3);
  return { team, lead: bestLeadIndex(team, enemyIds) };
}
