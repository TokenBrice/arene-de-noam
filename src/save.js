import { CREATURE_IDS } from './data/creatures.js';
import { FEAT_IDS } from './data/progression.js';
import { TRIAL_IDS } from './data/trials.js';

export const SAVE_KEY = 'arene-de-noam-save';
export const SAVE_VERSION = 16;
export const DEFAULT_SAVE = Object.freeze({
  version: SAVE_VERSION,
  tutorialComplete: false,
  ladderVictories: 0,
  mastery: {},
  records: {},
  customSquads: [null, null, null],
  feats: [],
  trials: [],
  gauntletWins: 0,
  draftWins: 0,
  circuitWins: 0,
  bestGrade: null,
  battlesPlayed: 0,
  wins: 0,
  winStreak: 0,
  bestStreak: 0,
  lastTeam: ['orakyn', 'abyssar', 'virelia'],
  difficulty: 'apprentice',
  language: 'fr',
  muted: false,
  musicVolume: 0.45,
  sfxVolume: 0.8,
  reducedMotion: false,
  highContrast: false,
  expertMode: false,
  battleSpeed: 1,
});

// v1 -> v2: arena cosmetics became a persisted collection.
export const migrateV1 = (save) => ({
  ...save,
  version: 2,
  cosmetics: Array.isArray(save.cosmetics) ? save.cosmetics : ['crystal'],
});
// v2 -> v3: no recoverable schema difference is known; preserve every field.
export const migrateV2 = (save) => ({ ...save, version: 3 });
// v3 -> v4: no recoverable schema difference is known; preserve every field.
export const migrateV3 = (save) => ({ ...save, version: 4 });
// v4 -> v5: no recoverable schema difference is known; preserve every field.
export const migrateV4 = (save) => ({ ...save, version: 5 });
// v5 -> v6: no recoverable schema difference is known; preserve every field.
export const migrateV5 = (save) => ({ ...save, version: 6 });
// v6 -> v7: no recoverable schema difference is known; preserve every field.
export const migrateV6 = (save) => ({ ...save, version: 7 });
// v7 -> v8: no recoverable schema difference is known; preserve every field.
export const migrateV7 = (save) => ({ ...save, version: 8 });
// v8 -> v9: no recoverable schema difference is known; preserve every field.
export const migrateV8 = (save) => ({ ...save, version: 9 });
// v9 -> v10: no recoverable schema difference is known; preserve every field.
export const migrateV9 = (save) => ({ ...save, version: 10 });
// v10 -> v11: no recoverable schema difference is known; preserve every field.
export const migrateV10 = (save) => ({ ...save, version: 11 });
// v11 -> v12: no recoverable schema difference is known; preserve every field.
export const migrateV11 = (save) => ({ ...save, version: 12 });
// v12 -> v13: split music and sound-effect levels beneath the legacy master level.
export const migrateV12 = (save) => ({
  ...save,
  version: 13,
  musicVolume: Number.isFinite(save.musicVolume) ? save.musicVolume : 0.45,
  sfxVolume: Number.isFinite(save.sfxVolume) ? save.sfxVolume : 0.8,
});
// v13 -> v14: battle explanations became opt-in through expert mode.
export const migrateV13 = (save) => ({
  ...save,
  version: 14,
  expertMode: typeof save.expertMode === 'boolean' ? save.expertMode : false,
});
// v14 -> v15: doctrines no longer belong to saved squads.
export const migrateV14 = (save) => ({
  ...save,
  version: 15,
  customSquads: Array.isArray(save.customSquads)
    ? save.customSquads.map((squad) =>
        squad && typeof squad === 'object' ? { team: squad.team, lead: squad.lead } : squad
      )
    : save.customSquads,
});
// v15 -> v16: dead reward/master-volume fields were removed and progression counters are consistent.
export const migrateV16 = (save) => {
  const { emblems: _emblems, cosmetics: _cosmetics, volume: _volume, ...rest } = save;
  const bounded = (value, max) =>
    Number.isInteger(value) ? Math.min(max, Math.max(0, value)) : 0;
  const battlesPlayed = bounded(save.battlesPlayed, 9999);
  const wins = Math.min(battlesPlayed, bounded(save.wins, 9999));
  const records =
    save.records && typeof save.records === 'object'
      ? Object.fromEntries(
          Object.entries(save.records).map(([id, source]) => {
            if (!source || typeof source !== 'object') return [id, source];
            const battles = bounded(source.battles, 99999);
            return [
              id,
              { ...source, battles, wins: Math.min(battles, bounded(source.wins, 99999)) },
            ];
          })
        )
      : save.records;
  return {
    ...rest,
    version: 16,
    battlesPlayed,
    wins,
    winStreak: Math.min(wins, bounded(save.winStreak, 9999)),
    bestStreak: Math.min(wins, bounded(save.bestStreak, 9999)),
    records,
  };
};

export const SAVE_MIGRATIONS = Object.freeze([
  migrateV1,
  migrateV2,
  migrateV3,
  migrateV4,
  migrateV5,
  migrateV6,
  migrateV7,
  migrateV8,
  migrateV9,
  migrateV10,
  migrateV11,
  migrateV12,
  migrateV13,
  migrateV14,
  migrateV16,
]);

export function migrateSave(value) {
  if (!value || typeof value !== 'object') return null;
  if (!Number.isInteger(value.version) || value.version < 1 || value.version > SAVE_VERSION) return null;
  let migrated = { ...value };
  while (migrated.version < SAVE_VERSION) {
    const migration = SAVE_MIGRATIONS[migrated.version - 1];
    if (!migration) return null;
    migrated = migration(migrated);
  }
  return migrated;
}

function validTeam(team) {
  return (
    Array.isArray(team) &&
    team.length === 3 &&
    new Set(team).size === 3 &&
    team.every((id) => CREATURE_IDS.includes(id))
  );
}
export function validateSave(value) {
  const migrated = migrateSave(value);
  if (!migrated) return null;
  const mastery = {};
  if (migrated.mastery && typeof migrated.mastery === 'object')
    for (const id of CREATURE_IDS) {
      const xp = migrated.mastery[id];
      if (Number.isInteger(xp) && xp > 0) mastery[id] = Math.min(999, xp);
    }
  const records = {};
  if (migrated.records && typeof migrated.records === 'object')
    for (const id of CREATURE_IDS) {
      const source = migrated.records[id];
      if (!source || typeof source !== 'object') continue;
      const bounded = (key, max) =>
        Number.isInteger(source[key]) ? Math.min(max, Math.max(0, source[key])) : 0;
      const record = {
        battles: bounded('battles', 99999),
        wins: Math.min(bounded('battles', 99999), bounded('wins', 99999)),
        damage: bounded('damage', 9999999),
        kos: bounded('kos', 99999),
        signatures: bounded('signatures', 99999),
        assists: bounded('assists', 99999),
        combos: bounded('combos', 99999),
      };
      if (Object.values(record).some(Boolean)) records[id] = record;
    }
  const customSquads = Array.from({ length: 3 }, (_, index) => {
    const squad = Array.isArray(migrated.customSquads) ? migrated.customSquads[index] : null;
    if (!squad || !validTeam(squad.team)) return null;
    return {
      team: [...squad.team],
      lead: Number.isInteger(squad.lead) && squad.lead >= 0 && squad.lead < 3 ? squad.lead : 0,
    };
  });
  const battlesPlayed = Number.isInteger(migrated.battlesPlayed)
      ? Math.min(9999, Math.max(0, migrated.battlesPlayed))
      : 0,
    wins = Number.isInteger(migrated.wins)
      ? Math.min(battlesPlayed, Math.min(9999, Math.max(0, migrated.wins)))
      : 0,
    winStreak = Number.isInteger(migrated.winStreak)
      ? Math.min(wins, Math.min(9999, Math.max(0, migrated.winStreak)))
      : 0,
    bestStreak = Math.min(
      wins,
      Math.max(
        winStreak,
        Number.isInteger(migrated.bestStreak) ? Math.min(9999, Math.max(0, migrated.bestStreak)) : 0
      )
    );
  return {
    ...DEFAULT_SAVE,
    version: SAVE_VERSION,
    tutorialComplete: Boolean(migrated.tutorialComplete),
    ladderVictories: Number.isInteger(migrated.ladderVictories)
      ? Math.min(12, Math.max(0, migrated.ladderVictories))
      : 0,
    mastery,
    records,
    customSquads,
    feats: Array.isArray(migrated.feats)
      ? [...new Set(migrated.feats.filter((x) => FEAT_IDS.includes(x)))]
      : [],
    trials: Array.isArray(migrated.trials)
      ? [...new Set(migrated.trials.filter((x) => TRIAL_IDS.includes(x)))]
      : [],
    gauntletWins: Number.isInteger(migrated.gauntletWins)
      ? Math.min(999, Math.max(0, migrated.gauntletWins))
      : 0,
    draftWins: Number.isInteger(migrated.draftWins) ? Math.min(9999, Math.max(0, migrated.draftWins)) : 0,
    circuitWins: Number.isInteger(migrated.circuitWins)
      ? Math.min(9999, Math.max(0, migrated.circuitWins))
      : 0,
    bestGrade: ['D', 'C', 'B', 'A', 'S'].includes(migrated.bestGrade) ? migrated.bestGrade : null,
    battlesPlayed,
    wins,
    winStreak,
    bestStreak,
    lastTeam: validTeam(migrated.lastTeam) ? [...migrated.lastTeam] : [...DEFAULT_SAVE.lastTeam],
    difficulty:
      migrated.difficulty === 'challenger'
        ? 'standard'
        : ['apprentice', 'standard', 'champion'].includes(migrated.difficulty)
          ? migrated.difficulty
          : 'apprentice',
    language: migrated.language === 'en' ? 'en' : 'fr',
    muted: Boolean(migrated.muted),
    musicVolume: Number.isFinite(migrated.musicVolume)
      ? Math.min(1, Math.max(0, migrated.musicVolume))
      : 0.45,
    sfxVolume: Number.isFinite(migrated.sfxVolume) ? Math.min(1, Math.max(0, migrated.sfxVolume)) : 0.8,
    reducedMotion: Boolean(migrated.reducedMotion),
    highContrast: Boolean(migrated.highContrast),
    expertMode: Boolean(migrated.expertMode),
    battleSpeed: migrated.battleSpeed === 2 ? 2 : 1,
  };
}

function freshDefaultSave() {
  return {
    ...DEFAULT_SAVE,
    lastTeam: [...DEFAULT_SAVE.lastTeam],
    mastery: {},
    records: {},
    customSquads: [null, null, null],
    feats: [],
    trials: [],
  };
}

export function loadSave(storage) {
  try {
    const source = storage === undefined ? globalThis.localStorage : storage;
    const raw = source?.getItem?.(SAVE_KEY);
    if (!raw)
      return {
        save: freshDefaultSave(),
        notice: null,
      };
    const parsed = JSON.parse(raw);
    const save = validateSave(parsed);
    if (!save)
      return {
        save: freshDefaultSave(),
        notice: Number.isInteger(parsed?.version) && parsed.version > SAVE_VERSION ? 'future' : 'corrupt',
      };
    return { save, notice: null };
  } catch {
    return {
      save: freshDefaultSave(),
      notice: 'corrupt',
    };
  }
}

export function persistSave(save, storage) {
  const safe = validateSave(save);
  if (!safe) return false;
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    if (!target || typeof target.setItem !== 'function') return false;
    target.setItem(SAVE_KEY, JSON.stringify(safe));
    return true;
  } catch {
    return false;
  }
}
