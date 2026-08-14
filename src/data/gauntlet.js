export const GAUNTLET_STAGES = Object.freeze([
  {
    id: 'opening',
    nameKey: 'gauntlet.stage.opening',
    trainerIndex: 1,
    enemyTeam: ['ferrax', 'pyrolynx', 'riptalon'],
    arena: 'crystal',
    difficulty: 'standard',
    modifiers: [],
  },
  {
    id: 'tempest',
    nameKey: 'gauntlet.stage.tempest',
    trainerIndex: 8,
    enemyTeam: ['voltide', 'riptalon', 'solflare'],
    arena: 'tidal',
    difficulty: 'standard',
    modifiers: ['rapid_arena'],
  },
  {
    id: 'crown',
    nameKey: 'gauntlet.stage.crown',
    trainerIndex: 11,
    enemyTeam: ['prismage', 'monolith', 'calderoc'],
    arena: 'eclipse',
    difficulty: 'standard',
    modifiers: ['ascendant'],
  },
]);

export const GAUNTLET_BOONS = Object.freeze([
  { id: 'surge', icon: '✦', modifier: 'player_surge' },
  { id: 'aegis', icon: '⬡', modifier: 'player_aegis' },
  { id: 'vitality', icon: '♥', modifier: 'player_vitality' },
  { id: 'focus', icon: '◎', modifier: 'player_focus' },
]);
