// Optional, symmetric Quick Battle rules. They reuse the same modifier
// pipeline as Trials so sandbox battles remain fully deterministic.
export const QUICK_RULES = Object.freeze([
  { id: 'standard', icon: '◇', modifiers: [] },
  { id: 'starstorm', icon: '✦', modifiers: ['overdrive'] },
  { id: 'high_voltage', icon: 'ϟ', modifiers: ['high_voltage'] },
  { id: 'type_clash', icon: '△', modifiers: ['type_clash'] },
  { id: 'fortress_duel', icon: '⬡', modifiers: ['dual_aegis'] },
  { id: 'relay_rush', icon: '↺', modifiers: ['relay_fever'] },
]);

export function quickRule(id) {
  return QUICK_RULES.find((rule) => rule.id === id) || QUICK_RULES[0];
}

// The Apprentice tier plays a visibly lower-level rival: every Apprentice
// battle (League rivals, Quick Battle, tutorial) adds the `rookie` modifier.
export function difficultyModifiers(difficulty) {
  return difficulty === 'apprentice' ? ['rookie'] : [];
}
