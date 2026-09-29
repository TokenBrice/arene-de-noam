import { CREATURES } from './creatures.js';
import { MOVES } from './moves.js';

// Marqué is the single Combo setup: the next damaging action that lands on a
// Marqué target consumes it and multiplies every hit of that action.
export const COMBO_SETUP_STATUS = 'marked';
export const COMBO_DAMAGE_MULTIPLIER = 1.3;

export function moveCanCombo(move) {
  return move?.kind === 'damage';
}

// Cross-creature routes scored by the team remix: a teammate applies Marqué,
// another teammate's damaging move cashes it in. Self-routes are excluded
// because they grant no assist credit.
export function teamComboRoutes(team = []) {
  const routes = new Map();
  for (const setterId of team) {
    for (const setupMoveId of CREATURES[setterId]?.moves || []) {
      if (!MOVES[setupMoveId].targetStatuses?.some((status) => status.id === COMBO_SETUP_STATUS)) continue;
      for (const finisherId of team) {
        if (finisherId === setterId) continue;
        for (const finishMoveId of CREATURES[finisherId]?.moves || []) {
          const finish = MOVES[finishMoveId];
          if (!moveCanCombo(finish)) continue;
          routes.set(`${setterId}:${setupMoveId}:${finisherId}:${finishMoveId}`, {
            setterId,
            setupMoveId,
            finisherId,
            finishMoveId,
            signature: Boolean(finish.signature),
          });
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
