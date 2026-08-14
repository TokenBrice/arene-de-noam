export const STATUS_DEFINITIONS = Object.freeze({
  focused: { positive: true, iconKey: 'eye', color: '#1DA1F2' },
  haste: { positive: true, iconKey: 'wing', color: '#C6FF00' },
  evasive: { positive: true, iconKey: 'ghost', color: '#304FFE', lightInk: true },
  countering: { positive: true, iconKey: 'shield-arrow', color: '#00E0A4' },
  marked: { positive: false, iconKey: 'target-lock', color: '#AD1457', lightInk: true },
  stunned: { positive: false, iconKey: 'dizzy-stars', color: '#FFEA70' },
  rooted: { positive: false, iconKey: 'roots', color: '#9C5B32', lightInk: true },
  burning: {
    positive: false,
    iconKey: 'flame',
    color: '#F4511E',
    stackable: true,
    maxStacks: 2,
  },
});

export const STATUS_DISPLAY_ORDER = Object.freeze([
  'focused',
  'haste',
  'evasive',
  'countering',
  'marked',
  'rooted',
  'stunned',
  'burning',
]);

const STATUS_ICON_CONTENT = Object.freeze({
  eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>',
  wing: '<path d="M3 15.5C8 15 12.5 11 17 4.5c1.2 5.8-1 11.2-6 14.5-2.6 1.7-5.7 1.1-8-1.5 4.2-.4 7.2-2 10-4.8"/><path d="M2 9.5h7M2 13h5.5"/>',
  ghost:
    '<path d="M5 20V10a7 7 0 0 1 14 0v10l-3-2-2 2-2-2-2 2-2-2-3 2Z"/><circle cx="9.5" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="11" r="1" fill="currentColor" stroke="none"/>',
  'shield-arrow':
    '<path d="M11 3 4.5 5.5v5.7c0 4.2 2.5 7.5 6.5 9.8 2.1-1.2 3.8-2.7 4.9-4.5"/><path d="M12 11.5h7m0 0-2.8-2.8m2.8 2.8-2.8 2.8"/>',
  'target-lock': '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5M8.5 8.5l7 7m0-7-7 7"/>',
  roots:
    '<path d="M12 3v9m0 0c-1.5 1.5-3.3 2.2-5.5 2.2M12 12c1.5 1.5 3.3 2.2 5.5 2.2M12 12v7M6.5 14.2 3 18m3.5-3.8.5 5.3m10.5-5.3L21 18m-3.5-3.8-.5 5.3M12 19l-3 2m3-2 3 2"/>',
  'dizzy-stars':
    '<path d="m12 4 1.5 4.5L18 10l-4.5 1.5L12 16l-1.5-4.5L6 10l4.5-1.5L12 4Z" fill="currentColor"/><path d="m19 3 .7 2.3L22 6l-2.3.7L19 9l-.7-2.3L16 6l2.3-.7L19 3ZM5 15l.8 2.2L8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8L5 15Z" fill="currentColor" stroke="none"/>',
  flame:
    '<path d="M13.2 2.5c.6 4-2.2 5.4-3.8 7.5-1.3 1.7-1.7 3.2-1 5.2.7-1.5 1.9-2.5 3.4-3.7-.2 2.2 1.5 3.1 1.5 5 0 1.1-.4 2.1-1.2 2.9 3.6-.3 6.4-3.2 6.4-6.9 0-4-2.5-7.2-5.3-10Z"/><path d="M11.8 19.4c-2.1-.2-3.8-1.9-3.8-4.1"/>',
});

export function statusIcon(id, className = '') {
  const definition = STATUS_DEFINITIONS[id];
  if (!definition) throw new Error(`Unknown status icon: ${id}`);
  return `<svg class="status-icon status-icon-${definition.iconKey}${className ? ` ${className}` : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${STATUS_ICON_CONTENT[definition.iconKey]}</svg>`;
}

export function statusBadgeHtml(id, { label = '', compact = false, className = '', title = '' } = {}) {
  const definition = STATUS_DEFINITIONS[id];
  if (!definition) throw new Error(`Unknown status badge: ${id}`);
  const polarity = definition.positive ? 'positive' : 'negative';
  return `<span class="status-badge status-${id} ${polarity}${compact ? ' compact' : ''}${definition.lightInk ? ' light-ink' : ''}${className ? ` ${className}` : ''}" data-status="${id}" data-icon="${definition.iconKey}" data-polarity="${polarity}" style="--status-color:${definition.color}"${title ? ` title="${title}"` : ''}>${statusIcon(id)}${label ? `<span class="status-badge-label">${label}</span>` : ''}</span>`;
}

export function sortStatusIds(ids) {
  const positions = new Map(STATUS_DISPLAY_ORDER.map((id, index) => [id, index]));
  return [...ids].filter((id) => STATUS_DEFINITIONS[id]).sort((a, b) => positions.get(a) - positions.get(b));
}

export const NEGATIVE_STATUSES = Object.freeze(
  Object.keys(STATUS_DEFINITIONS).filter((id) => !STATUS_DEFINITIONS[id].positive)
);
export const POSITIVE_STATUSES = Object.freeze(
  Object.keys(STATUS_DEFINITIONS).filter((id) => STATUS_DEFINITIONS[id].positive)
);

export function hasStatus(combatant, id) {
  return Boolean(combatant.statuses[id]);
}
export function statusStacks(combatant, id) {
  return combatant.statuses[id]?.stacks || 1;
}

export function applyStatus(combatant, id, turn, duration = null, stacks = 1, sourceCreatureId = null) {
  const definition = STATUS_DEFINITIONS[id];
  if (!definition) throw new Error(`Unknown status: ${id}`);
  const prior = combatant.statuses[id];
  const nextStacks = definition.stackable ? Math.min(definition.maxStacks, (prior?.stacks || 0) + stacks) : 1,
    nextDuration = duration && prior?.remaining ? Math.max(duration, prior.remaining) : duration;
  combatant.statuses[id] = {
    appliedTurn: turn,
    stacks: nextStacks,
    ...(nextDuration ? { remaining: nextDuration } : {}),
    ...(sourceCreatureId ? { sourceCreatureId } : {}),
  };
  return combatant.statuses[id];
}

export function removeStatuses(combatant, ids, count = 'all') {
  const removed = [];
  for (const id of ids) {
    if (combatant.statuses[id]) {
      delete combatant.statuses[id];
      removed.push(id);
      if (count !== 'all' && removed.length >= count) break;
    }
  }
  return removed;
}
export function cleanse(combatant, count = 1) {
  return removeStatuses(combatant, NEGATIVE_STATUSES, count);
}
export function purge(combatant, count = 1) {
  return removeStatuses(combatant, POSITIVE_STATUSES, count);
}
export function cleanseOne(combatant) {
  return cleanse(combatant, 1)[0] || null;
}

export function effectiveSpeed(combatant) {
  let multiplier = 1;
  if (hasStatus(combatant, 'stunned')) multiplier *= 0.7;
  if (hasStatus(combatant, 'haste')) multiplier *= 1.2;
  return Math.max(1, Math.round(combatant.speed * multiplier));
}

export function tickTimed(record, turn) {
  for (const [id, status] of Object.entries(record)) {
    if (typeof status.remaining !== 'number' || status.appliedTurn >= turn) continue;
    status.remaining -= 1;
    if (status.remaining <= 0) delete record[id];
  }
}
