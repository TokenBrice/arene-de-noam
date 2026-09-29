// Chrome icon family: one inline SVG <symbol> sprite on a 24-unit grid, drawn
// with a 2.2 round stroke in currentColor (styled by `.ico` in base.css).
// Geometry is authored for this game and kept visually distinct from the type,
// class and status glyphs in src/data/affinities.js, src/data/classes.js and
// src/battle/statuses.js (presentation contract): chrome icons are open
// outlines, never those silhouettes.
const ICON_PATHS = Object.freeze({
  back: '<path d="M19 12H5.5M11.5 5.5 5 12l6.5 6.5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>',
  play: '<path d="M8 5.3v13.4a.8.8 0 0 0 1.2.7l10.3-6.7a.8.8 0 0 0 0-1.4L9.2 4.6a.8.8 0 0 0-1.2.7z"/>',
  speed: '<path d="M4 6.5v11l7-5.5zM12.5 6.5v11l7-5.5z"/>',
  'sound-on':
    '<path d="M4 9h3.5L12 5v14l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6a8.3 8.3 0 0 1 0 12"/>',
  'sound-off': '<path d="M4 9h3.5L12 5v14l-4.5-4H4z"/><path d="m16 9.5 5 5m0-5-5 5"/>',
  settings:
    '<path d="M19.1 10.2 21.4 10.5 21.4 13.5 19.1 13.8A7.3 7.3 0 0 1 18.3 15.8L19.7 17.6 17.6 19.7 15.8 18.3A7.3 7.3 0 0 1 13.8 19.1L13.5 21.4 10.5 21.4 10.2 19.1A7.3 7.3 0 0 1 8.2 18.3L6.4 19.7 4.3 17.6 5.7 15.8A7.3 7.3 0 0 1 4.9 13.8L2.6 13.5 2.6 10.5 4.9 10.2A7.3 7.3 0 0 1 5.7 8.2L4.3 6.4 6.4 4.3 8.2 5.7A7.3 7.3 0 0 1 10.2 4.9L10.5 2.6 13.5 2.6 13.8 4.9A7.3 7.3 0 0 1 15.8 5.7L17.6 4.3 19.7 6.4 18.3 8.2A7.3 7.3 0 0 1 19.1 10.2z"/><circle cx="12" cy="12" r="3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.01"/>',
  swap: '<path d="M4 8h14.5M15 4.5 18.5 8 15 11.5M20 16H5.5M9 12.5 5.5 16 9 19.5"/>',
  sword: '<path d="M12 2.8 14.2 5.6V15H9.8V5.6z"/><path d="M7.5 15h9M12 15v4M10.2 20.6h3.6"/>',
  shield: '<path d="M5 4.5h14v6.3c0 4.9-3.1 8.1-7 9.7-3.9-1.6-7-4.8-7-9.7z"/><path d="M12 4.5v16"/>',
  heart:
    '<path d="M12 19.6s-7.6-4.5-7.6-10.1A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.6 2.5c0 5.6-7.6 10.1-7.6 10.1z"/>',
  clock: '<circle cx="12" cy="12" r="8.8"/><path d="M12 7.2V12l3.2 2.2"/>',
  star: '<path d="m12 3.3 2.7 5.6 6.1.8-4.4 4.3 1.1 6.1-5.5-2.9-5.5 2.9 1.1-6.1-4.4-4.3 6.1-.8z"/>',
  crown: '<path d="m3.5 8.5 4.8 3.7L12 5.5l3.7 6.7 4.8-3.7-1.8 9H5.3z"/><path d="M5.5 20.5h13"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.3v2.4"/>',
  trophy:
    '<path d="M7.5 3.8h9v5.7a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6H4.5v1a3.5 3.5 0 0 0 3.4 3.5M16.5 6h3v1a3.5 3.5 0 0 1-3.4 3.5M12 14v3.5M8.5 20.5h7M9.8 17.5h4.4"/>',
  badge: '<circle cx="12" cy="9" r="5.5"/><path d="m9.2 13.8-1.7 6.9 4.5-2.4 4.5 2.4-1.7-6.9"/>',
  'chevron-left': '<path d="M15 5.5 8.5 12l6.5 6.5"/>',
  'chevron-right': '<path d="m9 5.5 6.5 6.5L9 18.5"/>',
  'chevron-down': '<path d="m5.5 9 6.5 6.5L18.5 9"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  flag: '<path d="M5.5 21V3.8M5.5 4.5h12.5l-2.8 4.2 2.8 4.3H5.5"/>',
  book: '<path d="M12 6.6C10 5 7.3 4.6 4 5v13.2c3.3-.4 6 0 8 1.6 2-1.6 4.7-2 8-1.6V5c-3.3-.4-6 0-8 1.6zM12 6.6v13.2"/>',
  scroll:
    '<path d="M16.5 3.5H7A2.5 2.5 0 0 0 4.5 6v1.5h4"/><path d="M8.5 6a2.5 2.5 0 0 1 2.5-2.5h5.5A2.5 2.5 0 0 1 19 6v10.5"/><path d="M8.5 6v12a2.5 2.5 0 0 0 2.5 2.5h8.5a2 2 0 0 0 2-2v-2H13v2a2 2 0 0 1-2 2"/><path d="M11.5 9h4.5M11.5 12.5h4.5"/>',
  team: '<circle cx="9" cy="8" r="3.3"/><path d="M3 19.5a6 6 0 0 1 12 0M15.5 4.9a3.3 3.3 0 0 1 0 6.2M17.8 13.6a6 6 0 0 1 3.2 5.9"/>',
  calendar:
    '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14.5h.01M12 14.5h.01M16 14.5h.01"/>',
  map: '<path d="M3.5 6.5 9 4l6 2.5L20.5 4v13.5L15 20l-6-2.5L3.5 20z"/><path d="M9 4v13.5M15 6.5V20"/>',
  mountain: '<path d="M2.5 19.5 9 8.5l3.5 6 2.5-3.5 6.5 8.5z"/><circle cx="17.5" cy="5.5" r="2"/>',
  school:
    '<path d="m2.5 9.5 9.5-5 9.5 5-9.5 5z"/><path d="M6.5 11.6V16c1.5 1.6 3.4 2.5 5.5 2.5s4-.9 5.5-2.5v-4.4M21.5 9.5V15"/>',
  sparkle:
    '<path d="M11 4.5c.8 4.2 2.4 6.3 6 7.5-3.6 1.2-5.2 3.3-6 7.5-.8-4.2-2.4-6.3-6-7.5 3.6-1.2 5.2-3.3 6-7.5z"/><path d="M19 2.8v4.4M16.8 5h4.4"/>',
  'arrow-up': '<path d="M12 19.5V5M6 10.5 12 4.5l6 6"/>',
  'arrow-down': '<path d="M12 4.5V19M6 13.5l6 6 6-6"/>',
  warning:
    '<path d="M10.3 4.5a2 2 0 0 1 3.4 0l7.6 13.2a2 2 0 0 1-1.7 3H4.4a2 2 0 0 1-1.7-3z"/><path d="M12 9.5V14M12 17.2v.01"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7L20 8.5"/><path d="M20 4v4.5h-4.5"/>',
  home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h4.5v-5h3v5H18V9.5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
  filter: '<path d="M4 5h16l-6.2 7.3v5.2L10.2 20v-7.7z"/>',
});

export const ICON_NAMES = Object.freeze(Object.keys(ICON_PATHS));

const SPRITE_ID = 'icon-sprite';

function escapeText(value) {
  return String(value).replace(
    /[&<>'"]/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]
  );
}

export function iconSpriteMarkup() {
  return `<svg id="${SPRITE_ID}" class="icon-sprite" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${ICON_NAMES.map((name) => `<symbol id="i-${name}" viewBox="0 0 24 24">${ICON_PATHS[name]}</symbol>`).join('')}</svg>`;
}

// Injects the sprite once, as the first child of <body> (outside #screen, so
// screen re-renders never remove it).
export function installIconSprite(doc = document) {
  if (!doc.getElementById(SPRITE_ID)) doc.body.insertAdjacentHTML('afterbegin', iconSpriteMarkup());
}

// Decorative by default. `label` adds visually hidden text for icon-only
// controls that have no aria-label of their own.
export function icon(name, { label = '' } = {}) {
  if (!ICON_PATHS[name]) throw new Error(`Unknown icon: ${name}`);
  const svg = `<svg class="ico ico-${name}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
  return label ? `${svg}<span class="visually-hidden">${escapeText(label)}</span>` : svg;
}
