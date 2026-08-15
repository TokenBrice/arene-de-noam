// Legacy IDs intentionally remain stable for save-v15 and authored asset compatibility.
// Player-facing mapping: mind=Psy, force=Combat, tide=Eau, flame=Feu,
// grove=Plante, shadow=Ténèbres.
export const AFFINITY_ORDER = ['flame', 'tide', 'grove', 'force', 'mind', 'shadow'];

export const AFFINITY_TRIANGLES = Object.freeze([
  Object.freeze(['tide', 'flame', 'grove']),
  Object.freeze(['mind', 'force', 'shadow']),
]);

export const AFFINITY_ADVANTAGE = Object.freeze({
  tide: 'flame',
  flame: 'grove',
  grove: 'tide',
  mind: 'force',
  force: 'shadow',
  shadow: 'mind',
});

// Original Arène de Noam code-native SVG geometry; no third-party icon artwork.
export const AFFINITIES = {
  mind: {
    color: '#E879C6',
    nameKey: 'affinity.mind',
    iconPath:
      'M2.2 12C5.1 7.2 8.4 4.8 12 4.8S18.9 7.2 21.8 12c-2.9 4.8-6.2 7.2-9.8 7.2S5.1 16.8 2.2 12Zm3.1 0c2.1 3 4.3 4.5 6.7 4.5s4.6-1.5 6.7-4.5C16.6 9 14.4 7.5 12 7.5S7.4 9 5.3 12Z',
    iconStrokePath:
      'M14.8 11.2c-.3-1.7-2.1-2.7-3.6-1.9-1.6.8-1.8 3-.4 4 1.5 1.1 3.7.3 4.2-1.4.7-2.5-1.5-4.9-4-4.5',
  },
  force: {
    color: '#F2B84B',
    nameKey: 'affinity.force',
    iconPath:
      'M5.3 10.2V6.8c0-1 .8-1.8 1.8-1.8.5 0 1 .2 1.3.6V4.4c0-1 .8-1.8 1.8-1.8.8 0 1.5.5 1.7 1.2.3-.4.8-.7 1.4-.7 1 0 1.8.8 1.8 1.8v.3c.3-.2.7-.3 1.1-.3 1 0 1.8.8 1.8 1.8v4.1l1.1-.8c.9-.7 2.2-.5 2.9.4.6.8.5 1.9-.2 2.6l-4.9 5.3c-1 1.1-2.4 1.7-3.9 1.7H9.8c-2.7 0-4.9-2.2-4.9-4.9v-3.7c0-.5.1-.9.4-1.2Z',
  },
  tide: {
    color: '#4DA6FF',
    nameKey: 'affinity.tide',
    iconPath:
      'M12 1.8C9.8 5.2 5.2 9.7 5.2 14.5a6.8 6.8 0 0 0 13.6 0C18.8 9.7 14.2 5.2 12 1.8Zm3.8 13.8c-.5 1.8-2 3-3.9 3.1-1.1 0-2.1-.4-2.8-1.1 2.6.1 4.2-1.3 4.9-3.8.7.3 1.3.9 1.8 1.8Z',
  },
  flame: {
    color: '#FF6B4A',
    nameKey: 'affinity.flame',
    iconPath:
      'M13.1 1.7c.7 3.1-.8 4.7-2.1 6.1-1.1-1.1-1.2-2.4-.8-3.8-3.7 2.7-6 6.3-5.2 10.4.8 4.1 4.1 7.1 8.1 7.1 4.6 0 7.9-3.5 7.9-8.2 0-3.5-2.1-7.6-7.9-11.6Zm.1 17.1c-2 0-3.6-1.5-3.6-3.5 0-1.8 1.1-3.2 3.2-4.9-.1 1.5.5 2.3 1.1 3 .8-.8 1.2-1.7 1-2.8 1.3 1.3 2 2.8 1.8 4.4-.2 2.2-1.6 3.8-3.5 3.8Z',
  },
  grove: {
    color: '#55C878',
    nameKey: 'affinity.grove',
    iconPath:
      'M20.9 3.2C13.6 3.1 7.4 5.4 5 9.7c-1.5 2.6-.9 5.4.8 7.2l-2.1 2.7 1.8 1.3 2.2-2.8c2.4 1.1 5.4.4 7.4-1.7 3.3-3.5 4.9-8 5.8-13.2ZM7.4 15.7c2.3-3.5 5.4-6 9.5-7.7-3.2 2.3-5.6 5.1-7.5 8.4-.7-.1-1.4-.3-2-.7Z',
  },
  shadow: {
    color: '#9B8CFF',
    nameKey: 'affinity.shadow',
    iconPath:
      'M15.2 2.2A9.9 9.9 0 1 0 21.7 16a8.2 8.2 0 0 1-9.4 1.6A8.1 8.1 0 0 1 9.1 6.5a8.2 8.2 0 0 1 6.1-4.3Zm2.5 4.2 1.1 1.2 1.5-.6-.8 1.4 1 1.3-1.6-.3-.9 1.3-.2-1.6-1.6-.5 1.5-.7V6.4Z',
  },
  neutral: {
    color: '#B9C2D5',
    nameKey: 'affinity.neutral',
    iconPath: 'M12 7.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z',
  },
};

export function affinityMultiplier(attack, defense) {
  if (attack === 'neutral') return 1;
  if (!(attack in AFFINITY_ADVANTAGE) || !(defense in AFFINITY_ADVANTAGE))
    throw new Error(`Unknown affinity: ${attack}/${defense}`);
  if (AFFINITY_ADVANTAGE[attack] === defense) return 2;
  if (AFFINITY_ADVANTAGE[defense] === attack) return 0.5;
  return 1;
}
