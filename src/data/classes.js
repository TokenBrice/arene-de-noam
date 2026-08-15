// Classes describe how a creature plays. They never alter battle calculations.
export const CLASS_ORDER = Object.freeze([
  'tank',
  'assassin',
  'healer',
  'controller',
  'breaker',
  'duelist',
]);

export const CLASSES = Object.freeze({
  tank: {
    color: '#687686',
    iconPath: 'M12 2.5 4.5 5.4v6.2c0 4.7 2.8 8.1 7.5 10 4.7-1.9 7.5-5.3 7.5-10V5.4L12 2.5Zm0 4 4.2 1.6v3.4c0 2.7-1.4 4.8-4.2 6.3-2.8-1.5-4.2-3.6-4.2-6.3V8.1L12 6.5Z',
  },
  assassin: {
    color: '#7D6C82',
    iconPath: 'M4 18.8 14.7 8.1l1.2 1.2L5.2 20H4v-1.2ZM14.2 5.8l2.1-2.1 4 4-2.1 2.1-4-4ZM3 7h7v2H3V7Zm2-4h8v2H5V3Z',
  },
  healer: {
    color: '#647F73',
    iconPath: 'M12 21C5.7 17.2 3 13.8 3 9.8A4.8 4.8 0 0 1 12 7a4.8 4.8 0 0 1 9 2.8c0 4-2.7 7.4-9 11.2Zm-1.2-11.5v2.2H8.5v2.6h2.3v2.2h2.4v-2.2h2.3v-2.6h-2.3V9.5h-2.4Z',
  },
  controller: {
    color: '#6B748D',
    iconPath: 'M6.2 5.2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm11.6 5.6a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM12 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM8.8 9.2l5.7 4.1-1.2 1.7-5.7-4.1 1.2-1.7Z',
  },
  breaker: {
    color: '#8A6F65',
    iconPath: 'M3 4h9v7H3V4Zm2.3 2.2v2.6h4.4V6.2H5.3Zm10.2-3.7 5.9 5.9-2.2 2.2-1.1-1.1-4.5 4.5-2.1-2.1L16 7.4l-1.1-1.1 2.2-2.2-1.6-1.6ZM4 15h5l1.5 2L12 15h3l1.5 2 1.5-2h3v6H4v-6Z',
  },
  duelist: {
    color: '#817A63',
    iconPath: 'M5.2 3 13 10.8l-2.2 2.2L3 5.2 5.2 3Zm13.6 0L21 5.2 13.2 13l-2.2-2.2L18.8 3ZM8.7 13.1l2.2 2.2-4.1 4.1H3.5v-3.3l5.2-3Zm6.6 0 5.2 3v3.3h-3.3l-4.1-4.1 2.2-2.2ZM12 1.8a10.2 10.2 0 1 1-7.2 3l1.4 1.4A8.2 8.2 0 1 0 12 3.8v-2Z',
  },
});

export const CLASS_IDS = Object.freeze(Object.keys(CLASSES));

function escapeMarkup(value) {
  return String(value).replace(
    /[&<>'"]/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]
  );
}

export function classIcon(id, { title = '', className = '' } = {}) {
  const meta = CLASSES[id];
  if (!meta) throw new Error(`Unknown class icon: ${id}`);
  const accessible = Boolean(title);
  return `<svg class="class-icon${className ? ` ${escapeMarkup(className)}` : ''}" viewBox="0 0 24 24" focusable="false" ${accessible ? `role="img" aria-label="${escapeMarkup(title)}"` : 'aria-hidden="true"'}>${accessible ? `<title>${escapeMarkup(title)}</title>` : ''}<path d="${meta.iconPath}" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"/></svg>`;
}
