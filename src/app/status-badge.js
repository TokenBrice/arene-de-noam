import { STATUS_DEFINITIONS, statusIcon } from '../battle/statuses.js';
import { icon } from './icons.js';

// A status as a badge: its glyph, an optional label and a corner mark, the chrome up or down
// arrow (Bonus ▲ / Malus ▼ in the glossary). Pill for a bonus, clipped tab for a malus.
export function statusBadgeHtml(id, { label = '', compact = false, className = '', title = '' } = {}) {
  const definition = STATUS_DEFINITIONS[id];
  if (!definition) throw new Error(`Unknown status badge: ${id}`);
  const polarity = definition.positive ? 'positive' : 'negative';
  return `<span class="status-badge status-${id} ${polarity}${compact ? ' compact' : ''}${definition.lightInk ? ' light-ink' : ''}${className ? ` ${className}` : ''}" data-status="${id}" data-icon="${definition.iconKey}" data-polarity="${polarity}" style="--status-color:${definition.color}"${title ? ` title="${title}"` : ''}>${statusIcon(id)}${label ? `<span class="status-badge-label">${label}</span>` : ''}<i class="status-badge-mark">${icon(definition.positive ? 'arrow-up' : 'arrow-down')}</i></span>`;
}
