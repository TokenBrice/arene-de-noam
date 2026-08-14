export const MASTERY_THRESHOLDS = Object.freeze([0, 4, 10, 20, 34, 52]);
export const MAX_MASTERY_RANK = MASTERY_THRESHOLDS.length - 1;

export function masteryRank(xp = 0) {
  let rank = 0;
  for (let i = 1; i < MASTERY_THRESHOLDS.length; i++) if (xp >= MASTERY_THRESHOLDS[i]) rank = i;
  return rank;
}
export function masteryProgress(xp = 0) {
  const rank = masteryRank(xp),
    start = MASTERY_THRESHOLDS[rank],
    end = MASTERY_THRESHOLDS[Math.min(MAX_MASTERY_RANK, rank + 1)];
  return {
    rank,
    current: xp - start,
    needed: rank === MAX_MASTERY_RANK ? 0 : end - start,
    ratio: rank === MAX_MASTERY_RANK ? 1 : (xp - start) / (end - start),
  };
}

export const PERFORMANCE_GRADES = Object.freeze(['D', 'C', 'B', 'A', 'S']);
export function performanceGrade({
  win = false,
  turns = 40,
  survivors = 0,
  contractComplete = false,
  combos = 0,
  signatures = 0,
  contributors = 1,
  crescendos = 0,
} = {}) {
  const tempo = win ? (turns <= 10 ? 18 : turns <= 16 ? 12 : turns <= 24 ? 6 : 0) : 0;
  const survival = Math.min(18, Math.max(0, survivors) * (win ? 6 : 2));
  const style = Math.min(
    18,
    Math.max(0, combos) * 4 +
      Math.max(0, signatures) * 5 +
      Math.max(0, contributors - 1) * 2 +
      Math.max(0, crescendos) * 3
  );
  const contract = contractComplete ? 10 : 0;
  const score = Math.min(100, (win ? 45 : 18) + tempo + survival + style + contract);
  const letter = score >= 88 ? 'S' : score >= 74 ? 'A' : score >= 58 ? 'B' : score >= 40 ? 'C' : 'D';
  const bonusXp = letter === 'S' ? 3 : letter === 'A' ? 2 : letter === 'B' ? 1 : 0;
  return { letter, score, bonusXp, breakdown: { tempo, survival, style, contract } };
}

export const FEATS = Object.freeze({
  first_signature: { id: 'first_signature', icon: '✦' },
  flawless: { id: 'flawless', icon: '♢' },
  blitz: { id: 'blitz', icon: 'ϟ' },
  survivor: { id: 'survivor', icon: '♥' },
  tactician: { id: 'tactician', icon: '☿' },
  harmony: { id: 'harmony', icon: '⬡' },
  arena_master: { id: 'arena_master', icon: '◎' },
  comeback: { id: 'comeback', icon: '↟' },
  perfect_relay: { id: 'perfect_relay', icon: '↺' },
  team_assist: { id: 'team_assist', icon: '↗' },
  contract_hero: { id: 'contract_hero', icon: '☑' },
  final_duelist: { id: 'final_duelist', icon: '⚔' },
});
export const FEAT_IDS = Object.freeze(Object.keys(FEATS));
