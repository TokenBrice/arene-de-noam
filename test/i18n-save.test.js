import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createI18n, loadDictionary } from '../src/i18n.js';
import {
  DEFAULT_SAVE,
  SAVE_KEY,
  freshDefaultSave,
  loadSave,
  persistSave,
  validateSave,
} from '../src/save.js';
import {
  CURRENT_FEAT_IDS,
  FEATS,
  FEAT_IDS,
  masteryProgress,
  masteryRank,
  performanceGrade,
} from '../src/data/progression.js';
import { MOVES } from '../src/data/moves.js';
import { CREATURE_IDS, CREATURES } from '../src/data/creatures.js';
import { CLASS_ORDER } from '../src/data/classes.js';
import { STATUS_DEFINITIONS } from '../src/battle/statuses.js';

// One module per language (src/i18n/<lang>.js), loaded like the app does.
const DICTIONARIES = { fr: await loadDictionary('fr'), en: await loadDictionary('en') };
const I18N = { fr: await createI18n('fr'), en: await createI18n('en') };

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
  assert.deepEqual(Object.keys(DICTIONARIES.fr).sort(), Object.keys(DICTIONARIES.en).sort());
  assert.equal(I18N.en.t('battle.turn', { turn: 7 }), 'Turn 7');
  assert.equal(I18N.en.t('no.such.key'), '⟦no.such.key⟧');
});
test('every key is defined exactly once per dictionary, so no definition is shadowed', () => {
  for (const name of ['fr', 'en']) {
    const source = readFileSync(new URL(`../src/i18n/${name}.js`, import.meta.url), 'utf8'),
      keys = [...source.matchAll(/^ {2}'([^']+)':/gm)].map((match) => match[1]),
      duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    assert.deepEqual(duplicates, [], `${name} duplicates`);
    assert.equal(keys.length, Object.keys(DICTIONARIES[name]).length, `${name} key count`);
  }
});
test('switching language loads the other dictionary first, and the last switch wins', async () => {
  globalThis.document = { documentElement: { lang: 'fr' } };
  try {
    const i18n = await createI18n('fr');
    assert.equal(await i18n.setLang('en'), true);
    assert.equal(i18n.lang, 'en');
    assert.equal(i18n.t('battle.turn', { turn: 2 }), 'Turn 2');
    assert.equal(document.documentElement.lang, 'en');
    // A switch overtaken by a later one before its dictionary arrives changes nothing.
    const [first, second] = await Promise.all([i18n.setLang('fr'), i18n.setLang('en')]);
    assert.deepEqual([first, second], [false, true]);
    assert.equal(i18n.lang, 'en');
  } finally {
    delete globalThis.document;
  }
});
test('French punctuation stays attached with a narrow no-break space and never wraps alone', () => {
  const { t } = I18N.fr;
  assert.equal(t('battle.ko', { name: 'Orakyn' }), 'Orakyn est K.O.\u202f!');
  for (const [key, value] of Object.entries(DICTIONARIES.fr)) {
    assert.doesNotMatch(value, /[ \u00a0][!?:;»]|«[ \u00a0]/, `${key}: plain space before punctuation`);
    assert.doesNotMatch(value, /[\p{L}\p{N})}.…][!?;»]|[\p{L}}]:/u, `${key}: punctuation glued to a word`);
    assert.doesNotMatch(value, /[\p{N}}][ \u202f]?%/u, `${key}: breakable space before %`);
  }
  assert.doesNotMatch(Object.values(DICTIONARIES.en).join('\n'), /\u202f/, 'English keeps plain spacing');
});
test('player-facing copy uses the settled glossary and none of the retired terms', () => {
  const retired =
    /Éclat|ÉCLAT|Surge|SURGE|Insaisissable|\bGRD\b|mblème|mblem|Draft|DRAFT|Traversée|Gauntlet|Déchaîn|DÉCHAÎN|Unleash|Rempart|Assassin|Soigneur|Contrôleur|Briseur|Duelliste|Elusive|Evasive|Bulwark|Healer|Controller|Breaker|Duelist|\bTank\b|lance \{move\}|Séisme|Riposte|\bCounter\b|Second souffle|Mur de Fer|Shadow Shed|Last Bastion/;
  for (const [language, dictionary] of Object.entries(DICTIONARIES))
    for (const [key, value] of Object.entries(dictionary))
      assert.doesNotMatch(value, retired, `${language} ${key}`);
  const fr = I18N.fr.t,
    en = I18N.en.t;
  assert.equal(
    fr('battle.action.move', { actor: 'Orakyn', move: 'Arc lucide' }),
    'Orakyn utilise Arc lucide\u202f!'
  );
  assert.equal(en('battle.action.move', { actor: 'Orakyn', move: 'Lucid Arc' }), 'Orakyn uses Lucid Arc!');
  // French elides "de" before a vowel-initial name, and only there.
  assert.equal(fr('select.info', { name: 'Orakyn' }), 'Fiche d’Orakyn');
  assert.equal(fr('bestiary.preview', { move: 'Énigme des marées' }), 'Voir l’animation d’Énigme des marées');
  assert.equal(fr('select.info', { name: 'Kordane' }), 'Fiche de Kordane');
  assert.equal(en('select.info', { name: 'Orakyn' }), 'About Orakyn');
  assert.deepEqual(
    CLASS_ORDER.map((id) => fr(`class.${id}`)),
    ['Défenseur', 'Rapide', 'Soutien', 'Stratège', 'Attaquant', 'Polyvalent']
  );
  assert.deepEqual(
    CLASS_ORDER.map((id) => en(`class.${id}`)),
    ['Defender', 'Speedster', 'Support', 'Tactician', 'Attacker', 'All-Rounder']
  );
});
test('save failure copy is available in both locales', () => {
  assert.equal(typeof DICTIONARIES.fr['app.saveFailed'], 'string');
  assert.equal(typeof DICTIONARIES.en['app.saveFailed'], 'string');
});
test('legacy affinity ids expose the canonical type labels and parallel triangle copy', () => {
  assert.deepEqual(
    ['mind', 'force', 'tide', 'flame', 'grove', 'shadow'].map((id) => DICTIONARIES.fr[`affinity.${id}`]),
    ['Psy', 'Combat', 'Eau', 'Feu', 'Plante', 'Ténèbres']
  );
  assert.deepEqual(
    ['mind', 'force', 'tide', 'flame', 'grove', 'shadow'].map((id) => DICTIONARIES.en[`affinity.${id}`]),
    ['Psychic', 'Fighting', 'Water', 'Fire', 'Grass', 'Dark']
  );
  for (const key of ['academy.triangle.elemental', 'academy.triangle.tactical']) {
    assert.ok(DICTIONARIES.fr[key], key);
    assert.ok(DICTIONARIES.en[key], key);
  }
  // École and Aide word the type rule the same way.
  for (const dictionary of Object.values(DICTIONARIES))
    assert.ok(dictionary['settings.affinities'].endsWith(dictionary['academy.core.3.desc']));
  assert.match(DICTIONARIES.fr['settings.affinities'], /×2.*×0,5.*×1/);
  assert.match(DICTIONARIES.en['settings.affinities'], /×2.*×0\.5.*×1/);
});
test('the eight kid-clear status labels are complete and dead ids are absent', () => {
  const dead = [
    'guarded',
    'regenerating',
    'thorns',
    'anchored',
    'exposed',
    'slowed',
    'weakened',
    'silenced',
    'poisoned',
    'soaked',
    'charged',
    'drowsy',
    'cursed',
  ];
  assert.equal(Object.keys(STATUS_DEFINITIONS).length, 8);
  for (const dictionary of Object.values(DICTIONARIES)) {
    assert.ok(dictionary['status.polarity.positive']);
    assert.ok(dictionary['status.polarity.negative']);
    for (const id of Object.keys(STATUS_DEFINITIONS)) {
      assert.ok(dictionary[`status.${id}`]);
      const effect = dictionary[`status.effect.${id}`];
      assert.ok(effect);
      assert.ok(effect.trim().split(/\s+/).length <= 6, `${id}: ${effect}`);
    }
    for (const id of dead) {
      assert.equal(dictionary[`status.${id}`], undefined);
      assert.equal(dictionary[`status.effect.${id}`], undefined);
    }
  }
});
test('all ninety move effects read simply, and exact numbers live only in the tactical detail', () => {
  const removed = /\b(doctrine|flow|resonance|contract|bond|detonat|assist)\b/i,
    words = (text) => text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
  for (const dictionary of Object.values(DICTIONARIES))
    for (const id of Object.keys(MOVES)) {
      const name = dictionary[`move.${id}`],
        effect = dictionary[`move.effect.${id}`],
        detail = dictionary[`move.effectDetail.${id}`];
      assert.ok(name, `${id} name`);
      assert.ok(effect, `${id} effect`);
      assert.ok(detail, `${id} detail`);
      assert.ok(words(effect) <= 10, `${id}: ${effect}`);
      assert.doesNotMatch(effect, /\d/, `${id}: numbers belong in move.effectDetail`);
      assert.equal(removed.test(effect) || removed.test(detail), false, `${id}: ${effect}`);
    }
});
test('thirty creatures and six classes are complete with no legacy role keys', () => {
  assert.equal(CREATURE_IDS.length, 30);
  for (const dictionary of Object.values(DICTIONARIES)) {
    assert.equal(
      Object.keys(dictionary).some((key) => key.startsWith('role.')),
      false
    );
    for (const classId of CLASS_ORDER) {
      assert.ok(dictionary[`class.${classId}`]);
      assert.ok(dictionary[`class.effect.${classId}`]);
    }
    for (const id of CREATURE_IDS) {
      assert.ok(dictionary[`creature.${id}`]);
      assert.ok(dictionary[`passive.${CREATURES[id].passive}`]);
      assert.ok(dictionary[`passive.effect.${CREATURES[id].passive}`]);
      assert.ok(dictionary[`lore.${id}`]);
    }
  }
});
test('save round-trips with validated ranges', () => {
  const memory = storage();
  const changed = {
    ...DEFAULT_SAVE,
    ladderVictories: 4,
    lastTeam: ['kordane', 'farfombre', 'calderoc'],
    volume: 0.4,
    expertMode: true,
    quality: 'low',
    haptics: true,
    chromatiques: { orakyn: true, kordane: true },
  };
  assert.equal(persistSave(changed, memory), true);
  const loaded = loadSave(memory).save;
  assert.deepEqual(loaded, validateSave(changed));
  assert.equal(loaded.version, 18);
  assert.equal(loaded.quality, 'low');
  assert.equal(loaded.haptics, true);
  assert.deepEqual(loaded.chromatiques, { orakyn: true, kordane: true });
  assert.equal('volume' in loaded, false);
  assert.equal('affinity' in loaded, false);
});
test('haptics stay off unless explicitly true and Chromatique preferences keep known creatures only', () => {
  for (const haptics of ['true', 1, {}, null, undefined, false])
    assert.equal(validateSave({ ...DEFAULT_SAVE, haptics }).haptics, false);
  for (const chromatiques of [null, 'orakyn', ['orakyn'], 7, undefined])
    assert.deepEqual(validateSave({ ...DEFAULT_SAVE, chromatiques }).chromatiques, {});
  assert.deepEqual(
    validateSave({
      ...DEFAULT_SAVE,
      chromatiques: {
        orakyn: true,
        abyssar: false,
        virelia: 'yes',
        unknown: true,
        __proto__: { kordane: true },
      },
    }).chromatiques,
    { orakyn: true }
  );
  assert.equal(freshDefaultSave().haptics, false);
  assert.deepEqual(freshDefaultSave().chromatiques, {});
});
test('every graphics choice round-trips and unknown choices fall back to automatic', () => {
  for (const quality of ['auto', 'low', 'mid', 'high']) {
    const memory = storage();
    assert.equal(persistSave({ ...DEFAULT_SAVE, quality }, memory), true);
    assert.equal(loadSave(memory).save.quality, quality);
  }
  for (const quality of ['ultra', 'LOW', '', null, 2, { tier: 'low' }])
    assert.equal(validateSave({ ...DEFAULT_SAVE, quality }).quality, 'auto');
  assert.equal(validateSave({ ...DEFAULT_SAVE, quality: undefined }).quality, 'auto');
  assert.equal(freshDefaultSave().quality, 'auto');
});
const V17_SAVE = Object.freeze({
  version: 17,
  tutorialComplete: true,
  ladderVictories: 3,
  mastery: { orakyn: 40 },
  records: { orakyn: { battles: 4, wins: 3, damage: 900, kos: 2, signatures: 1, assists: 0, combos: 1 } },
  customSquads: [{ team: ['orakyn', 'abyssar', 'virelia'], lead: 1 }, null, null],
  feats: ['blitz'],
  trials: [],
  gauntletWins: 1,
  draftWins: 2,
  circuitWins: 0,
  bestGrade: 'A',
  battlesPlayed: 6,
  wins: 4,
  winStreak: 2,
  bestStreak: 3,
  lastTeam: ['kordane', 'farfombre', 'calderoc'],
  difficulty: 'standard',
  language: 'en',
  muted: true,
  musicVolume: 0.3,
  sfxVolume: 0.6,
  reducedMotion: true,
  highContrast: false,
  expertMode: true,
  battleSpeed: 2,
  quality: 'low',
});
test('v17 saves load as v18 with haptics off, no Chromatique shown and every other field intact', () => {
  const { save, notice } = loadSave(storage(JSON.stringify(V17_SAVE)));
  assert.equal(notice, null);
  assert.deepEqual(save, { ...V17_SAVE, version: 18, haptics: false, chromatiques: {} });
  // Stray values written by a pre-v18 build never survive the migration.
  const stray = validateSave({ ...V17_SAVE, haptics: true, chromatiques: { orakyn: true } });
  assert.equal(stray.haptics, false);
  assert.deepEqual(stray.chromatiques, {});
});
test('v16 saves chain through v17 with automatic graphics to v18', () => {
  const { quality: _stray, ...v16 } = { ...V17_SAVE, version: 16 };
  // A stray quality written by a pre-v17 build does not survive either migration.
  const { save, notice } = loadSave(storage(JSON.stringify({ ...v16, quality: 'high' })));
  assert.equal(notice, null);
  assert.deepEqual(save, { ...v16, version: 18, quality: 'auto', haptics: false, chromatiques: {} });
});
test('fresh save resets rebuild every nested collection', () => {
  const firstReset = freshDefaultSave();
  firstReset.mastery.orakyn = 99;
  firstReset.feats.push('blitz');
  firstReset.trials.push('trial-one');
  firstReset.lastTeam[0] = 'kordane';
  firstReset.records.orakyn = { battles: 1, wins: 1 };
  firstReset.customSquads[0] = { team: ['orakyn', 'abyssar', 'virelia'], lead: 0 };
  firstReset.chromatiques.orakyn = true;
  const secondReset = freshDefaultSave();
  for (const key of ['mastery', 'feats', 'trials', 'lastTeam', 'records', 'customSquads', 'chromatiques'])
    assert.notEqual(secondReset[key], firstReset[key], `${key} should be a fresh collection`);
  assert.deepEqual(secondReset.mastery, {});
  assert.deepEqual(secondReset.feats, []);
  assert.deepEqual(secondReset.trials, []);
  assert.deepEqual(secondReset.lastTeam, ['orakyn', 'abyssar', 'virelia']);
  assert.deepEqual(secondReset.records, {});
  assert.deepEqual(secondReset.customSquads, [null, null, null]);
  assert.deepEqual(secondReset.chromatiques, {});
  assert.deepEqual(DEFAULT_SAVE.chromatiques, {});
});
test('v15 saves migrate forward without dead fields and with consistent counters', () => {
  const migrated = validateSave({
    ...DEFAULT_SAVE,
    version: 15,
    emblems: ['trainer-a'],
    cosmetics: ['crystal', 'grove'],
    volume: 0.2,
    battlesPlayed: 5,
    wins: 12,
    winStreak: 30,
    bestStreak: 40,
    records: { orakyn: { battles: 2, wins: 8 } },
  });
  assert.equal(migrated.version, 18);
  assert.equal('emblems' in migrated, false);
  assert.equal('cosmetics' in migrated, false);
  assert.equal('volume' in migrated, false);
  assert.equal(migrated.wins, 5);
  assert.equal(migrated.records.orakyn.wins, 2);
  assert.equal(migrated.winStreak, 5);
  assert.equal(migrated.bestStreak, 5);
});

test('historical v15 saves stay valid and accept all six new creature ids', () => {
  const historical = validateSave({
    ...DEFAULT_SAVE,
    version: 15,
    lastTeam: ['orakyn', 'abyssar', 'virelia'],
    mastery: { orakyn: 12, unknown: 90 },
    records: { orakyn: { battles: 4, wins: 3 }, unknown: { battles: 99 } },
  });
  assert.equal(historical.version, 18);
  assert.equal(historical.mastery.orakyn, 12);
  assert.equal(historical.mastery.unknown, undefined);
  assert.equal(historical.records.unknown, undefined);
  const expanded = validateSave({
    ...historical,
    lastTeam: ['deuilastre', 'aubeastre', 'pactigon'],
    mastery: { ...historical.mastery, flambelier: 7, mareclat: 4 },
    records: {
      ...historical.records,
      xylocorne: { battles: 2, wins: 1 },
      pactigon: { battles: 1, wins: 1 },
    },
  });
  assert.deepEqual(expanded.lastTeam, ['deuilastre', 'aubeastre', 'pactigon']);
  assert.equal(expanded.mastery.flambelier, 7);
  assert.equal(expanded.mastery.mareclat, 4);
  assert.equal(expanded.records.xylocorne.battles, 2);
  assert.equal(expanded.records.pactigon.wins, 1);
});
test('v14 personal squad slots migrate to legal teams and leads only', () => {
  const save = validateSave({
    ...DEFAULT_SAVE,
    version: 14,
    customSquads: [
      { team: ['orakyn', 'kordane', 'virelia'], lead: 2, doctrine: 'ambush' },
      { team: ['orakyn', 'orakyn', 'bad'], lead: 9, doctrine: 'broken' },
      { team: ['abyssar', 'mossaur', 'monolith'], lead: 9, doctrine: 'broken' },
    ],
  });
  assert.deepEqual(save.customSquads[0], {
    team: ['orakyn', 'kordane', 'virelia'],
    lead: 2,
  });
  assert.equal(save.customSquads[1], null);
  assert.deepEqual(save.customSquads[2], {
    team: ['abyssar', 'mossaur', 'monolith'],
    lead: 0,
  });
});
test('corrupt and future saves fall back safely', () => {
  assert.equal(loadSave(storage('{oops')).notice, 'corrupt');
  assert.equal(loadSave(storage(JSON.stringify({ version: 99 }))).notice, 'future');
  const future = loadSave(
    storage(
      JSON.stringify({
        ...DEFAULT_SAVE,
        version: 19,
        quality: 'low',
        haptics: true,
        chromatiques: { orakyn: true },
      })
    )
  );
  assert.equal(future.notice, 'future');
  assert.equal(future.save.quality, 'auto');
  assert.equal(future.save.haptics, false);
  assert.deepEqual(future.save.chromatiques, {});
  const corrupt = loadSave(storage(JSON.stringify({ version: 'eighteen', quality: 'low', haptics: true })));
  assert.equal(corrupt.notice, 'corrupt');
  assert.equal(corrupt.save.quality, 'auto');
  assert.equal(corrupt.save.haptics, false);
  const truncated = loadSave(storage(JSON.stringify({ ...V17_SAVE, version: 18 }).slice(0, 80)));
  assert.equal(truncated.notice, 'corrupt');
  assert.equal(truncated.save.haptics, false);
});
test('older saves migrate and progression fields are bounded', () => {
  const migrated = validateSave({
    version: 1,
    tutorialComplete: true,
    ladderVictories: 80,
    battlesPlayed: 10,
    wins: 7,
    lastTeam: ['bad'],
    language: 'xx',
    difficulty: 'impossible',
    mastery: { orakyn: 5000, bad: 12 },
    records: {
      orakyn: { battles: 200000, wins: -2, damage: 20000000, kos: 4, signatures: 3, assists: 2 },
      bad: { battles: 5 },
    },
    feats: ['blitz', 'contract_hero', 'bad'],
    gauntletWins: 4000,
    draftWins: 30000,
    circuitWins: 20000,
    contractsCompleted: 20000,
    bestGrade: 'S',
    winStreak: 7,
    bestStreak: 3,
  });
  assert.equal(migrated.version, 18);
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
    combos: 0,
  });
  assert.equal(migrated.records.bad, undefined);
  assert.deepEqual(migrated.feats, ['blitz', 'contract_hero']);
  assert.equal(migrated.gauntletWins, 999);
  assert.equal(migrated.draftWins, 9999);
  assert.equal(migrated.circuitWins, 9999);
  assert.equal('contractsCompleted' in migrated, false);
  assert.equal(migrated.bestGrade, 'S');
  assert.equal(migrated.winStreak, 7);
  assert.equal(migrated.bestStreak, 7);
  assert.equal(migrated.highContrast, false);
  assert.equal(migrated.expertMode, false);
});
test('mastery ranks and progress bars follow authored thresholds', () => {
  assert.equal(masteryRank(0), 0);
  assert.equal(masteryRank(20), 3);
  assert.equal(masteryRank(999), 5);
  assert.deepEqual(masteryProgress(4), { rank: 1, current: 0, needed: 6, ratio: 0 });
});
test('performance grades use only victory, turns, and survivors', () => {
  const plain = performanceGrade({ win: true, turns: 24, survivors: 2 });
  const epic = performanceGrade({ win: true, turns: 9, survivors: 3 });
  assert.equal(plain.letter, 'A');
  assert.equal(plain.score, 80);
  assert.deepEqual(plain.breakdown, { victory: 50, tempo: 10, survival: 20 });
  assert.equal(plain.bonusXp, 2);
  assert.equal(epic.letter, 'S');
  assert.equal(epic.score, 100);
  assert.equal(epic.bonusXp, 3);
  assert.equal(performanceGrade({ win: false, turns: 30, survivors: 0 }).letter, 'D');
  assert.equal(performanceGrade({ win: true, turns: 40, survivors: 1 }).letter, 'B');
});
test('current feats and the owned-only legacy assist feat have stable localized reveal copy', () => {
  const count = Object.keys(FEATS).length;
  assert.equal(CURRENT_FEAT_IDS.length, 9);
  assert.equal(count, 10);
  assert.deepEqual(FEAT_IDS.slice(-2), ['contract_hero', 'final_duelist']);
  assert.equal(CURRENT_FEAT_IDS.includes('team_assist'), false);
  assert.equal(I18N.fr.t('feat.total', { count: 0, total: count }), `0/${count} exploits`);
  assert.equal(I18N.en.t('feat.total', { count: 0, total: count }), `0/${count} feats`);
  for (const [id, feat] of Object.entries(FEATS)) {
    assert.equal(feat.id, id);
    assert.notEqual(DICTIONARIES.fr[`feat.${id}`], undefined);
    assert.notEqual(DICTIONARIES.en[`feat.effect.${id}`], undefined);
  }
  // Every feat still to earn shows its own teaser in the feat hall.
  for (const dictionary of Object.values(DICTIONARIES)) {
    const hints = CURRENT_FEAT_IDS.map((id) => dictionary[`feat.hint.${id}`]);
    assert.ok(hints.every((hint) => typeof hint === 'string'));
    assert.equal(new Set(hints).size, hints.length);
  }
});
