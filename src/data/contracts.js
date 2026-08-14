export const CONTRACTS = Object.freeze([
  { id: 'onslaught', icon: '⚔', target: 150 },
  { id: 'tactician', icon: '☿', target: 5 },
  { id: 'signature', icon: '✦', target: 1 },
  { id: 'guardian', icon: '⬡', target: 55 },
  { id: 'relay', icon: '↺', target: 2 },
]);

export function contractProgress(id, history = []) {
  if (id === 'onslaught')
    return history
      .filter((e) => e.type === 'damage' && e.sourceSide === 'player')
      .reduce((n, e) => n + e.amount, 0);
  if (id === 'tactician')
    return history.filter(
      (e) => e.type === 'status' && e.side === 'enemy' && e.applied && e.source !== 'arena'
    ).length;
  if (id === 'signature')
    return history.some((e) => e.type === 'surge' && e.side === 'player' && e.source === 'signature') ? 1 : 0;
  if (id === 'guardian')
    return history
      .filter((e) => (e.type === 'barrier-hit' || e.type === 'heal') && e.side === 'player')
      .reduce((n, e) => n + e.amount, 0);
  if (id === 'relay') return history.filter((e) => e.type === 'switch' && e.side === 'player').length;
  return 0;
}
