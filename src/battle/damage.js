import { affinityMultiplier } from '../data/affinities.js';

export function calculateDamage(
  move,
  attacker,
  defender,
  {
    focused = false,
    weakened = false,
    guarded = false,
    exposed = false,
    marked = false,
    drowsy = false,
    stunned = false,
    bonus = 1,
  } = {}
) {
  const affinity = affinityMultiplier(move.affinity, defender.affinity);
  const status =
    (focused ? 1.3 : 1) *
    (weakened ? 0.75 : 1) *
    (drowsy ? 0.86 : 1) *
    (stunned ? 0.7 : 1) *
    (guarded ? 0.6 : 1) *
    (exposed ? 1.25 : 1) *
    (marked ? 1.12 : 1) *
    bonus;
  const damage = Math.max(
    1,
    Math.round(((move.power * attacker.attack) / defender.guard) * 0.9 * affinity * status)
  );
  return { damage, affinity, status };
}
