import { CREATURES } from './creatures.js';
import { MOVES } from './moves.js';

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
            triggers = [
              ...(finish.kind === 'damage' ? ['marked'] : []),
              ...(finish.bonusAgainst || []),
              ...(finish.detonate || []),
            ],
            links = statuses.filter((status) => triggers.includes(status));
          if (!links.length) continue;
          for (const status of links) {
            const route = {
                setterId,
                setupMoveId,
                finisherId,
                finishMoveId,
                statuses: [status],
                detonation: Boolean(finish.detonate?.includes(status)),
                signature: Boolean(finish.signature),
              },
              key = `${setterId}:${setupMoveId}:${finisherId}:${status}`,
              prior = routes.get(key),
              strength =
                Number(route.signature) * 1_000_000 +
                Number(route.detonation) * 100_000 +
                (finish.power || 0) * (finish.hits || 1),
              priorMove = prior ? MOVES[prior.finishMoveId] : null,
              priorStrength = priorMove
                ? Number(prior.signature) * 1_000_000 +
                  Number(prior.detonation) * 100_000 +
                  (priorMove.power || 0) * (priorMove.hits || 1)
                : -1;
            if (strength > priorStrength) routes.set(key, route);
          }
        }
      }
    }
  }
  return [...routes.values()].sort(
    (a, b) =>
      Number(b.signature) - Number(a.signature) ||
      Number(b.detonation) - Number(a.detonation) ||
      a.setupMoveId.localeCompare(b.setupMoveId)
  );
}
