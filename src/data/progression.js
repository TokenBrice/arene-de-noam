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

// Chromatiques (GAME-11): the top mastery rank unlocks a creature's colour variant. The unlock
// is derived from mastery; only the display preference is stored (`save.chromatiques`, v18).
export const CHROMATIQUE_RANK = MAX_MASTERY_RANK;
export function chromatiqueUnlocked(creatureId, save) {
  return masteryRank(save?.mastery?.[creatureId] ?? 0) >= CHROMATIQUE_RANK;
}
export function isChromatiqueShown(creatureId, save) {
  return save?.chromatiques?.[creatureId] === true && chromatiqueUnlocked(creatureId, save);
}

// League badges open the side modes (GAME-11). Derived from `ladderVictories`, so no migration:
// a mode the save has already played (a Gauntlet or Draft win, a cleared Trial) stays open.
export const MODE_BADGES = Object.freeze({ gauntlet: 2, trials: 4, draft: 6 });
export function unlockedModes(save) {
  const badges = Number.isInteger(save?.ladderVictories) ? save.ladderVictories : 0,
    played = {
      gauntlet: save?.gauntletWins > 0,
      trials: Array.isArray(save?.trials) && save.trials.length > 0,
      draft: save?.draftWins > 0,
    };
  return Object.fromEntries(
    Object.entries(MODE_BADGES).map(([mode, badgesNeeded]) => [
      mode,
      { unlocked: badges >= badgesNeeded || played[mode], badgesNeeded },
    ])
  );
}

export const PERFORMANCE_GRADES = Object.freeze(['D', 'C', 'B', 'A', 'S']);
export function performanceGrade({ win = false, turns = 40, survivors = 0 } = {}) {
  const victory = win ? 50 : 0;
  const tempo = !win ? 0 : turns <= 10 ? 20 : turns <= 16 ? 15 : turns <= 24 ? 10 : turns <= 32 ? 5 : 0;
  const survival = Math.min(30, Math.max(0, survivors) * 10);
  const score = Math.min(100, victory + tempo + survival);
  const letter = score >= 88 ? 'S' : score >= 74 ? 'A' : score >= 58 ? 'B' : score >= 40 ? 'C' : 'D';
  const bonusXp = letter === 'S' ? 3 : letter === 'A' ? 2 : letter === 'B' ? 1 : 0;
  return { letter, score, bonusXp, breakdown: { victory, tempo, survival } };
}

export function battleAchievementSignals(history = []) {
  const playerDamage = history
      .filter((event) => event.type === 'damage' && event.sourceSide === 'player')
      .reduce((total, event) => total + event.amount, 0),
    enemyStatuses = history.filter(
      (event) => event.type === 'status' && event.side === 'enemy' && event.applied
    ).length,
    guardianValue = history
      .filter((event) => ['barrier', 'heal'].includes(event.type) && event.side === 'player')
      .reduce((total, event) => total + event.amount, 0);
  return {
    onslaught: playerDamage >= 150,
    tactician: enemyStatuses >= 5,
    signature: history.some(
      (event) => event.type === 'surge' && event.side === 'player' && event.source === 'signature'
    ),
    guardian: guardianValue >= 55,
    relay: history.filter((event) => event.type === 'switch' && event.side === 'player').length >= 2,
  };
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
});
export const CURRENT_FEAT_IDS = Object.freeze(Object.keys(FEATS).filter((id) => id !== 'team_assist'));
// Save-only identifiers: old owners keep the history, but it is never shown or awarded.
export const FEAT_IDS = Object.freeze([...Object.keys(FEATS), 'contract_hero', 'final_duelist']);
