export const STATUS_DEFINITIONS = Object.freeze({
  focused: { positive: true, icon: '◎', color: '#ffd66b' },
  haste: { positive: true, icon: '»', color: '#fff38a' },
  evasive: { positive: true, icon: '◇', color: '#d7c1ff' },
  countering: { positive: true, icon: '↶', color: '#ffcf70' },
  marked: { positive: false, icon: '⌖', color: '#ff7fb7' },
  stunned: { positive: false, icon: '★', color: '#ffe36e' },
  rooted: { positive: false, icon: '♧', color: '#7bd178' },
  burning: { positive: false, icon: '♨', color: '#ff684d', stackable: true, maxStacks: 2 },
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
