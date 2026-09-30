// "Stade Lumière" arena themes. Each arena is a place: its own landmark, sky, crowd, court and
// weather motes, with a distinct value structure so the six read apart in greyscale thumbnails.
// Colours are display-space sRGB hex; `rim`/`tint` are display-space 0–1 triples for the
// fighter shader (3B). Value hierarchy: creature > pad > court > stands > sky.

export const THEME_IDS = Object.freeze(['crystal', 'grove', 'tidal', 'volcano', 'astral', 'eclipse']);

export const THEMES = Object.freeze({
  // Dôme de cristal: an icy night under a glass dome; a fan of pale crystal spires.
  crystal: {
    sky: ['#070b22', '#16225a', '#5d8fe0'],
    haze: '#6d9fe8',
    landmark: 'crystal',
    stands: '#1a2658',
    roof: '#0b1030',
    crowd: ['#5a70c4', '#8c7cdf', '#c9d6ff', '#42529a', '#7fe3ff'],
    led: ['#8fe8ff', '#b69cff', '#e6f4ff'],
    court: { a: '#3a5694', b: '#18224e', line: '#d8f1ff', pattern: 'hex', gloss: 0.3 },
    apron: '#0a1030',
    pad: { top: '#4b64a4', side: '#141c44' },
    glow: '#8fe8ff',
    accent: '#b69cff',
    rim: [0.62, 0.9, 1.0],
    rimAmount: 0.5,
    tint: [0.97, 0.99, 1.05],
    motes: { color: '#c8f4ff', kind: 'sparkle', speed: 0.35, size: 1 },
  },
  // Sanctuaire sylvestre: golden hour in a forest clearing; a colossal ancient tree.
  grove: {
    sky: ['#0c1d12', '#35602e', '#efe39a'],
    haze: '#d9e59a',
    landmark: 'grove',
    stands: '#23422a',
    roof: '#0e1c11',
    crowd: ['#5f8f4a', '#a8c46a', '#e6d89c', '#3e6a38', '#ffd66b'],
    led: ['#ffe07a', '#c8ff7a', '#fff6d0'],
    court: { a: '#55803f', b: '#1f3a22', line: '#f4ffd8', pattern: 'flag', gloss: 0 },
    apron: '#0f2215',
    pad: { top: '#6b8c4c', side: '#1d3320' },
    glow: '#ffe89a',
    accent: '#ffd66b',
    rim: [1.0, 0.94, 0.62],
    rimAmount: 0.4,
    tint: [1.03, 1.01, 0.94],
    motes: { color: '#f4ffb0', kind: 'drift', speed: 0.3, size: 1.1 },
  },
  // Crypte des marées: a bioluminescent sea cave; a waterfall column under the vault arch.
  tidal: {
    sky: ['#020a14', '#062a40', '#36c3cf'],
    haze: '#3fb9c8',
    landmark: 'tidal',
    stands: '#10344a',
    roof: '#03101c',
    crowd: ['#3f7fa0', '#6fb7c9', '#d4f6ff', '#2a5878', '#5b8cff'],
    led: ['#6ff6ff', '#5b8cff', '#d4fdff'],
    court: { a: '#24657a', b: '#0b2636', line: '#d4fdff', pattern: 'wet', gloss: 0.38 },
    apron: '#051826',
    pad: { top: '#2f7a8e', side: '#0a2534' },
    glow: '#6ff6ff',
    accent: '#5b8cff',
    rim: [0.55, 1.0, 1.0],
    rimAmount: 0.55,
    tint: [0.95, 1.0, 1.04],
    motes: { color: '#bff8ff', kind: 'rain', speed: 1, size: 1 },
  },
  // Forge du volcan: a dark cone against a blazing sky; lava rivers and forge chimneys.
  volcano: {
    sky: ['#140405', '#5a170c', '#ff9a45'],
    haze: '#ff8a3d',
    landmark: 'volcano',
    stands: '#43180f',
    roof: '#160706',
    crowd: ['#8a3a2a', '#c4622e', '#f3c28a', '#5a241c', '#ffae4d'],
    led: ['#ffae4d', '#ff5b31', '#ffe0a8'],
    court: { a: '#5c3526', b: '#200e0a', line: '#ffd79a', pattern: 'basalt', gloss: 0 },
    apron: '#150707',
    pad: { top: '#6e4230', side: '#1e0c08' },
    glow: '#ffb35a',
    accent: '#ff5b31',
    rim: [1.0, 0.64, 0.32],
    rimAmount: 0.5,
    tint: [1.06, 0.98, 0.92],
    motes: { color: '#ffc27a', kind: 'ember', speed: 0.55, size: 1.1 },
  },
  // Observatoire astral: a ringed planet over an observatory dome; nebulae and stars.
  astral: {
    sky: ['#04031a', '#1f1554', '#8f72dc'],
    haze: '#9a7ae0',
    landmark: 'astral',
    stands: '#241d56',
    roof: '#0a0822',
    crowd: ['#5a4fa8', '#8f7ad6', '#e8dcff', '#3d3478', '#ffd98a'],
    led: ['#68dfff', '#e0b6ff', '#ffeab8'],
    court: { a: '#443b88', b: '#161238', line: '#ffe6b0', pattern: 'stars', gloss: 0.22 },
    apron: '#0c0a24',
    pad: { top: '#5a4f9e', side: '#161238' },
    glow: '#e0b6ff',
    accent: '#68dfff',
    rim: [0.92, 0.78, 1.0],
    rimAmount: 0.55,
    tint: [0.98, 0.96, 1.06],
    motes: { color: '#fff0c8', kind: 'sparkle', speed: 0.18, size: 0.9 },
  },
  // Couronne d'éclipse: a black sun inside a blazing corona; a ring of crown spires.
  eclipse: {
    sky: ['#08030f', '#2a0c30', '#ff78a8'],
    haze: '#ff86bb',
    landmark: 'eclipse',
    stands: '#33122e',
    roof: '#10040f',
    crowd: ['#6a2f66', '#a0508f', '#ffd0e4', '#44203f', '#ffbd68'],
    led: ['#ff9ccc', '#8f5bff', '#ffd6a0'],
    court: { a: '#4c2248', b: '#170817', line: '#ffc987', pattern: 'marble', gloss: 0.26 },
    apron: '#10050f',
    pad: { top: '#62305c', side: '#1a0a1a' },
    glow: '#ffb0d4',
    accent: '#8f5bff',
    rim: [1.0, 0.66, 0.84],
    rimAmount: 0.6,
    tint: [1.0, 0.95, 1.02],
    motes: { color: '#ffd0e8', kind: 'ash', speed: 0.22, size: 1 },
  },
});

export function themeFor(id) {
  return THEMES[id] ? id : 'crystal';
}
