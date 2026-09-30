import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MASTERY_THRESHOLDS,
  chromatiqueUnlocked,
  isChromatiqueShown,
  unlockedModes,
} from '../src/data/progression.js';
import { freshDefaultSave, validateSave } from '../src/save.js';
import { TRIAL_IDS } from '../src/data/trials.js';

const withBadges = (ladderVictories, extra = {}) => ({ ...freshDefaultSave(), ladderVictories, ...extra });
const openModes = (save) =>
  Object.entries(unlockedModes(save))
    .filter(([, mode]) => mode.unlocked)
    .map(([id]) => id);

test('a fresh save sees every side mode locked with its badge requirement', () => {
  assert.deepEqual(unlockedModes(freshDefaultSave()), {
    gauntlet: { unlocked: false, badgesNeeded: 2 },
    trials: { unlocked: false, badgesNeeded: 4 },
    draft: { unlocked: false, badgesNeeded: 6 },
  });
});

test('League badges open Expédition at 2, Épreuves at 4 and Pioche du jour at 6', () => {
  assert.deepEqual(openModes(withBadges(1)), []);
  assert.deepEqual(openModes(withBadges(2)), ['gauntlet']);
  assert.deepEqual(openModes(withBadges(3)), ['gauntlet']);
  assert.deepEqual(openModes(withBadges(4)), ['gauntlet', 'trials']);
  assert.deepEqual(openModes(withBadges(5)), ['gauntlet', 'trials']);
  assert.deepEqual(openModes(withBadges(6)), ['gauntlet', 'trials', 'draft']);
  assert.deepEqual(openModes(withBadges(12)), ['gauntlet', 'trials', 'draft']);
});

test('a mode the save has already played stays open without the badges', () => {
  assert.deepEqual(openModes(withBadges(0, { gauntletWins: 1 })), ['gauntlet']);
  assert.deepEqual(openModes(withBadges(0, { trials: [TRIAL_IDS[0]] })), ['trials']);
  assert.deepEqual(openModes(withBadges(1, { draftWins: 1 })), ['draft']);
});

test('an existing save migrated from an older version keeps every mode it played', () => {
  const legacy = validateSave({
    version: 16,
    tutorialComplete: true,
    ladderVictories: 1,
    gauntletWins: 2,
    trials: [TRIAL_IDS[1]],
    draftWins: 3,
    mastery: { orakyn: 60 },
  });
  assert.deepEqual(openModes(legacy), ['gauntlet', 'trials', 'draft']);
  assert.equal(unlockedModes(legacy).draft.badgesNeeded, 6);
});

test('a Chromatique unlocks at the top mastery rank, never below', () => {
  const top = MASTERY_THRESHOLDS.at(-1);
  assert.equal(chromatiqueUnlocked('orakyn', freshDefaultSave()), false);
  assert.equal(chromatiqueUnlocked('orakyn', { mastery: { orakyn: top - 1 } }), false);
  assert.equal(chromatiqueUnlocked('orakyn', { mastery: { orakyn: top } }), true);
  assert.equal(chromatiqueUnlocked('abyssar', { mastery: { orakyn: top } }), false);
});

test('a Chromatique shows only when it is both unlocked and chosen', () => {
  const top = MASTERY_THRESHOLDS.at(-1);
  const save = {
    mastery: { orakyn: top, abyssar: top, kordane: 3 },
    chromatiques: { orakyn: true, kordane: true },
  };
  assert.equal(isChromatiqueShown('orakyn', save), true);
  // Unlocked but not chosen.
  assert.equal(isChromatiqueShown('abyssar', save), false);
  // A stored preference never shows a locked variant.
  assert.equal(isChromatiqueShown('kordane', save), false);
  assert.equal(isChromatiqueShown('orakyn', { mastery: save.mastery }), false);
});
