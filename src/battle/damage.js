import { affinityMultiplier } from '../data/affinities.js';

export const DAMAGE_SCALE = 0.89;
// Seeded critical hits: one roll per landed damaging action, never in previews.
export const CRITICAL_CHANCE = 1 / 16;
export const CRITICAL_MULTIPLIER = 1.5;

export function calculateDamage(
  move,
  attacker,
  defender,
  { focused = false, stunned = false, bonus = 1, weather = 1, critical = false } = {}
) {
  const affinity = affinityMultiplier(move.affinity, defender.affinity);
  const status = (focused ? 1.3 : 1) * (stunned ? 0.75 : 1) * bonus;
  const damage = Math.max(
    1,
    Math.round(
      ((move.power * attacker.attack) / defender.guard) *
        DAMAGE_SCALE *
        affinity *
        weather *
        status *
        (critical ? CRITICAL_MULTIPLIER : 1)
    )
  );
  return { damage, affinity, status };
}
