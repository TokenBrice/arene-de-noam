import { affinityMultiplier } from '../data/affinities.js';

export const DAMAGE_SCALE = 0.89;

export function calculateDamage(
  move,
  attacker,
  defender,
  { focused = false, stunned = false, bonus = 1 } = {}
) {
  const affinity = affinityMultiplier(move.affinity, defender.affinity);
  const status = (focused ? 1.3 : 1) * (stunned ? 0.75 : 1) * bonus;
  const damage = Math.max(
    1,
    Math.round(((move.power * attacker.attack) / defender.guard) * DAMAGE_SCALE * affinity * status)
  );
  return { damage, affinity, status };
}
