export const STATUS_DEFINITIONS = Object.freeze({
  focused: { positive: true, icon: '◎', color: '#ffd66b' },
  guarded: { positive: true, icon: '⬡', color: '#71e8ff' },
  haste: { positive: true, icon: '»', color: '#fff38a', stackable: true, maxStacks: 3 },
  regenerating: { positive: true, icon: '✚', color: '#7dff9e' },
  evasive: { positive: true, icon: '◇', color: '#d7c1ff' },
  countering: { positive: true, icon: '↶', color: '#ffcf70' },
  thorns: { positive: true, icon: '✣', color: '#75e477' },
  anchored: { positive: true, icon: '▣', color: '#d8b477' },
  exposed: { positive: false, icon: '!', color: '#ff8d78' },
  slowed: { positive: false, icon: '⌛', color: '#78cfff' },
  weakened: { positive: false, icon: '↘', color: '#bfa3db' },
  marked: { positive: false, icon: '⌖', color: '#ff7fb7' },
  rooted: { positive: false, icon: '♧', color: '#7bd178' },
  silenced: { positive: false, icon: '∅', color: '#bd9aff' },
  stunned: { positive: false, icon: '★', color: '#ffe36e' },
  burning: { positive: false, icon: '♨', color: '#ff684d', stackable: true, maxStacks: 3 },
  poisoned: { positive: false, icon: '☠', color: '#a5e85d', stackable: true, maxStacks: 3 },
  soaked: { positive: false, icon: '◉', color: '#59d9ff' },
  charged: { positive: false, icon: 'ϟ', color: '#9af7ff' },
  drowsy: { positive: false, icon: '☽', color: '#aa8de8' },
  cursed: { positive: false, icon: '☿', color: '#dd63ff', stackable: true, maxStacks: 3 },
});

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
  const nextStacks = definition.stackable ? Math.min(definition.maxStacks, (prior?.stacks || 0) + stacks) : 1;
  combatant.statuses[id] = {
    appliedTurn: turn,
    stacks: nextStacks,
    ...(duration ? { remaining: duration } : {}),
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
  if (hasStatus(combatant, 'slowed') && !hasStatus(combatant, 'anchored')) multiplier *= 0.7;
  if (hasStatus(combatant, 'drowsy')) multiplier *= 0.85;
  if (hasStatus(combatant, 'stunned')) multiplier *= 0.55;
  if (hasStatus(combatant, 'soaked')) multiplier *= 0.92;
  if (hasStatus(combatant, 'haste')) multiplier *= 1.18 + 0.07 * (statusStacks(combatant, 'haste') - 1);
  return Math.max(1, Math.round(combatant.speed * multiplier));
}

export function tickTimed(record, turn) {
  for (const [id, status] of Object.entries(record)) {
    if (typeof status.remaining !== 'number' || status.appliedTurn >= turn) continue;
    status.remaining -= 1;
    if (status.remaining <= 0) delete record[id];
  }
}
