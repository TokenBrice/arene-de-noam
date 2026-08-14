import { CREATURES } from './creatures.js';
import { MOVES } from './moves.js';

export const COMBO_DAMAGE_MULTIPLIER = 1.4;

export function moveCanCombo(move) {
  return move?.kind === 'damage' && move.combo === true;
}

export function comboSetupStatus(move) {
  if (!moveCanCombo(move)) return null;
  return move.id === 'venom_harvest' ? 'burning' : 'marked';
}

export function teamComboRoutes(team = []) {
  const routes = new Map();
  for (const setterId of team) {
    for (const setupMoveId of CREATURES[setterId]?.moves || []) {
      const setup = MOVES[setupMoveId],
        statuses = [...new Set((setup.targetStatuses || []).map((status) => status.id))];
      if (!statuses.length) continue;
      for (const finisherId of team) {
        if (finisherId === setterId) continue;
        for (const finishMoveId of CREATURES[finisherId]?.moves || []) {
          const finish = MOVES[finishMoveId],
            requiredStatus = comboSetupStatus(finish);
          if (!requiredStatus || !statuses.includes(requiredStatus)) continue;
          const route = {
              setterId,
              setupMoveId,
              finisherId,
              finishMoveId,
              signature: Boolean(finish.signature),
            },
            key = `${setterId}:${setupMoveId}:${finisherId}:${finishMoveId}`;
          routes.set(key, route);
        }
      }
    }
  }
  return [...routes.values()].sort(
    (a, b) =>
      Number(b.signature) - Number(a.signature) ||
      a.setupMoveId.localeCompare(b.setupMoveId) ||
      a.finishMoveId.localeCompare(b.finishMoveId)
  );
}
