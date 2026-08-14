import test from 'node:test';
import assert from 'node:assert/strict';
import { DICTIONARIES, createI18n, validateDictionaries } from '../src/i18n.js';
import { DEFAULT_SAVE, SAVE_KEY, loadSave, persistSave, validateSave } from '../src/save.js';
import { FEATS, masteryProgress, masteryRank, performanceGrade } from '../src/data/progression.js';

function storage(initial = null) {
  let value = initial;
  return {
    getItem: (key) => (key === SAVE_KEY ? value : null),
    setItem: (key, next) => {
      if (key === SAVE_KEY) value = next;
    },
    value: () => value,
  };
}
test('French and English localization keys are complete and interpolation works', () => {
  assert.equal(validateDictionaries(), true);
  assert.deepEqual(Object.keys(DICTIONARIES.fr).sort(), Object.keys(DICTIONARIES.en).sort());
  assert.equal(createI18n('en').t('battle.turn', { turn: 7 }), 'Turn 7');
});
test('save round-trips with validated ranges', () => {
  const memory = storage();
  const changed = {
    ...DEFAULT_SAVE,
    ladderVictories: 4,
    lastTeam: ['kordane', 'farfombre', 'calderoc'],
    volume: 0.4,
  };
  assert.equal(persistSave(changed, memory), true);
  assert.deepEqual(loadSave(memory).save, validateSave(changed));
});
test('personal squad slots preserve only legal teams, leads, and doctrines', () => {
  const save = validateSave({
    ...DEFAULT_SAVE,
    customSquads: [
      { team: ['orakyn', 'kordane', 'virelia'], lead: 2, doctrine: 'ambush' },
      { team: ['orakyn', 'orakyn', 'bad'], lead: 9, doctrine: 'broken' },
      { team: ['abyssar', 'mossaur', 'monolith'], lead: 9, doctrine: 'broken' },
    ],
  });
  assert.deepEqual(save.customSquads[0], {
    team: ['orakyn', 'kordane', 'virelia'],
    lead: 2,
    doctrine: 'ambush',
  });
  assert.equal(save.customSquads[1], null);
  assert.deepEqual(save.customSquads[2], {
    team: ['abyssar', 'mossaur', 'monolith'],
    lead: 0,
    doctrine: 'balanced',
  });
});
test('corrupt and future saves fall back safely', () => {
  assert.equal(loadSave(storage('{oops')).notice, 'corrupt');
  assert.equal(loadSave(storage(JSON.stringify({ version: 99 }))).notice, 'future');
});
test('older saves migrate and progression fields are bounded', () => {
  const migrated = validateSave({
    version: 1,
    tutorialComplete: true,
    ladderVictories: 80,
    lastTeam: ['bad'],
    language: 'xx',
    difficulty: 'impossible',
    mastery: { orakyn: 5000, bad: 12 },
    records: {
      orakyn: { battles: 200000, wins: -2, damage: 20000000, kos: 4, signatures: 3, assists: 2 },
      bad: { battles: 5 },
    },
    feats: ['blitz', 'bad'],
    gauntletWins: 4000,
    draftWins: 30000,
    circuitWins: 20000,
    contractsCompleted: 20000,
    bestGrade: 'S',
    winStreak: 7,
    bestStreak: 3,
  });
  assert.equal(migrated.version, 12);
  assert.equal(migrated.ladderVictories, 12);
  assert.deepEqual(migrated.lastTeam, DEFAULT_SAVE.lastTeam);
  assert.equal(migrated.language, 'fr');
  assert.deepEqual(migrated.mastery, { orakyn: 999 });
  assert.deepEqual(migrated.records.orakyn, {
    battles: 99999,
    wins: 0,
    damage: 9999999,
    kos: 4,
    signatures: 3,
    assists: 2,
  });
  assert.equal(migrated.records.bad, undefined);
  assert.deepEqual(migrated.feats, ['blitz']);
  assert.equal(migrated.gauntletWins, 999);
  assert.equal(migrated.draftWins, 9999);
  assert.equal(migrated.circuitWins, 9999);
  assert.equal(migrated.contractsCompleted, 9999);
  assert.equal(migrated.bestGrade, 'S');
  assert.equal(migrated.winStreak, 7);
  assert.equal(migrated.bestStreak, 7);
  assert.equal(migrated.highContrast, false);
});
test('mastery ranks and progress bars follow authored thresholds', () => {
  assert.equal(masteryRank(0), 0);
  assert.equal(masteryRank(20), 3);
  assert.equal(masteryRank(999), 5);
  assert.deepEqual(masteryProgress(4), { rank: 1, current: 0, needed: 6, ratio: 0 });
});
test('performance grades reward fast, stylish, complete victories', () => {
  const plain = performanceGrade({ win: true, turns: 24, survivors: 2 }),
    rotating = performanceGrade({ win: true, turns: 24, survivors: 2, crescendos: 2 });
  const epic = performanceGrade({
    win: true,
    turns: 9,
    survivors: 3,
    contractComplete: true,
    combos: 2,
    signatures: 1,
    contributors: 3,
    crescendos: 1,
  });
  assert.equal(plain.letter, 'B');
  assert.equal(plain.bonusXp, 1);
  assert.equal(rotating.score, plain.score + 6);
  assert.equal(epic.letter, 'S');
  assert.equal(epic.score, 100);
  assert.equal(epic.bonusXp, 3);
  assert.equal(performanceGrade({ win: false, turns: 30, survivors: 0 }).letter, 'D');
});
test('all twelve feats have stable ids, collection totals, and localized reveal copy', () => {
  const count = Object.keys(FEATS).length;
  assert.equal(count, 12);
  assert.equal(createI18n('fr').t('feat.total', { count: 0 }), `0/${count} exploits`);
  assert.equal(createI18n('en').t('feat.total', { count: 0 }), `0/${count} feats`);
  for (const [id, feat] of Object.entries(FEATS)) {
    assert.equal(feat.id, id);
    assert.notEqual(DICTIONARIES.fr[`feat.${id}`], undefined);
    assert.notEqual(DICTIONARIES.en[`feat.effect.${id}`], undefined);
  }
});
test('signature support tooltips stay synchronized with their authored battle values', () => {
  for (const lang of ['fr', 'en']) {
    const t = createI18n(lang).t;
    assert.match(t('move.effect.oracle_veil'), /20/);
    assert.match(t('move.effect.deja_vu'), /16/);
    assert.match(t('move.effect.shell_bastion'), /40/);
    assert.match(t('move.effect.leaf_mantle'), /14/);
    assert.match(t('move.effect.leaf_mantle'), /8/);
  }
});
