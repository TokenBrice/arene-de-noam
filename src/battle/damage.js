import { affinityMultiplier } from '../data/affinities.js';

export function calculateDamage(
  move,
  attacker,
  defender,
  { focused = false, marked = false, stunned = false, bonus = 1 } = {}
) {
  const affinity = affinityMultiplier(move.affinity, defender.affinity);
  const status = (focused ? 1.3 : 1) * (marked ? 1.35 : 1) * (stunned ? 0.75 : 1) * bonus;
  const damage = Math.max(
    1,
    Math.round(((move.power * attacker.attack) / defender.guard) * 0.9 * affinity * status)
  );
  return { damage, affinity, status };
}
