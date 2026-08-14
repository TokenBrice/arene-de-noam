export const AFFINITY_ORDER = ['mind', 'force', 'tide', 'flame', 'grove', 'shadow'];

export const AFFINITIES = {
  mind: { icon: '◈', color: '#8b7dff', nameKey: 'affinity.mind' },
  force: { icon: '◆', color: '#ffb347', nameKey: 'affinity.force' },
  tide: { icon: '≋', color: '#45c7f2', nameKey: 'affinity.tide' },
  flame: { icon: '▲', color: '#ff624d', nameKey: 'affinity.flame' },
  grove: { icon: '❧', color: '#64d77a', nameKey: 'affinity.grove' },
  shadow: { icon: '☾', color: '#c36be8', nameKey: 'affinity.shadow' },
  neutral: { icon: '●', color: '#b9c2d5', nameKey: 'affinity.neutral' },
};

export function affinityMultiplier(attack, defense) {
  if (attack === 'neutral') return 1;
  const a = AFFINITY_ORDER.indexOf(attack);
  const d = AFFINITY_ORDER.indexOf(defense);
  if (a < 0 || d < 0) throw new Error(`Unknown affinity: ${attack}/${defense}`);
  if ((a + 1) % AFFINITY_ORDER.length === d) return 1.5;
  if ((a - 1 + AFFINITY_ORDER.length) % AFFINITY_ORDER.length === d) return 0.75;
  return 1;
}
