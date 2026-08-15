import test from 'node:test';
import assert from 'node:assert/strict';
import { DICTIONARIES, createI18n, validateDictionaries } from '../src/i18n.js';
import { DEFAULT_SAVE, SAVE_KEY, loadSave, persistSave, validateSave } from '../src/save.js';
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
test('live dictionary values are not shadowed by duplicate definitions', () => {
  for (const [key, fr, en] of [
    ['status.effect.marked', 'Combo : Marqué consommé, dégâts ×1,4.', 'Combo consumes Marked: +40% damage.'],
    ['move.effect.petal_ray', 'Inflige des dégâts et rend 3 % des PV à l’équipe.', "Deals damage and restores 3% of the team's HP."],
    ['advice.title', 'Conseils de l’entraîneur', 'Coach Tips'],
    ['battle.switchIncoming', 'Dégâts prévus : {damage}', 'Predicted damage: {damage}'],
  ]) {
    assert.equal(DICTIONARIES.fr[key], fr, `fr ${key}`);
    assert.equal(DICTIONARIES.en[key], en, `en ${key}`);
  }
});
test('battle playback and Chronicle copy is available in both locales', () => {
  const expected = {
    fr: {
      'battle.action.consumed': '{actor} utilise son bonus {status} !',
      'battle.action.skip': '{name} ne peut pas agir : K.O. !',
      'battle.logEnd.win': 'Victoire !',
      'battle.logEnd.loss': 'Défaite — belle bataille.',
      'battle.logEnd.cap': 'Fin du combat : limite de tours.',
      'battle.logSide.player': 'Ton {name}',
      'battle.logSide.enemy': '{name} rival',
    },
    en: {
      'battle.action.consumed': '{actor} uses up its {status} boost!',
      'battle.action.skip': '{name} cannot act — K.O.!',
      'battle.logEnd.win': 'Victory!',
      'battle.logEnd.loss': 'Defeat — good battle.',
      'battle.logEnd.cap': 'Battle over: turn limit.',
      'battle.logSide.player': 'Your {name}',
      'battle.logSide.enemy': 'Rival {name}',
    },
  };
  for (const [language, entries] of Object.entries(expected))
    for (const [key, value] of Object.entries(entries)) assert.equal(DICTIONARIES[language][key], value, `${language} ${key}`);
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
  for (const key of [
    'academy.triangle.elemental',
    'academy.triangle.tactical',
    'academy.elementalRule',
    'academy.tacticalRule',
    'academy.crossNeutral',
    'academy.arrowRule',
  ]) {
    assert.ok(DICTIONARIES.fr[key], key);
    assert.ok(DICTIONARIES.en[key], key);
  }
  assert.match(DICTIONARIES.fr['settings.affinities'], /×2.*×0,5.*×1/);
  assert.match(DICTIONARIES.en['settings.affinities'], /×2.*×0\.5.*×1/);
  assert.match(DICTIONARIES.fr['academy.affinityHint'], /Entre les triangles, c’est ×1/);
  assert.match(DICTIONARIES.en['academy.affinityHint'], /Between the triangles, it is ×1/);
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
test('all ninety move effects are short, localized, and free of removed systems', () => {
  const removed = /\b(doctrine|flow|resonance|contract|bond|detonat|assist)\b/i;
  for (const dictionary of Object.values(DICTIONARIES))
    for (const id of Object.keys(MOVES)) {
      const name = dictionary[`move.${id}`],
        effect = dictionary[`move.effect.${id}`];
      assert.ok(name, `${id} name`);
      assert.ok(effect, `${id} effect`);
      assert.ok(effect.trim().split(/\s+/).length <= 12, `${id}: ${effect}`);
      assert.equal(removed.test(effect), false, `${id}: ${effect}`);
    }
});
test('thirty creatures and six classes are complete with no legacy role keys', () => {
  assert.equal(CREATURE_IDS.length, 30);
  for (const dictionary of Object.values(DICTIONARIES)) {
    assert.equal(Object.keys(dictionary).some((key) => key.startsWith('role.')), false);
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
  };
  assert.equal(persistSave(changed, memory), true);
  assert.deepEqual(loadSave(memory).save, validateSave(changed));
  assert.equal(loadSave(memory).save.version, 16);
  assert.equal('volume' in loadSave(memory).save, false);
  assert.equal('affinity' in loadSave(memory).save, false);
});
test('v15 saves migrate to v16 without dead fields and with consistent counters', () => {
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
  assert.equal(migrated.version, 16);
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
  assert.equal(historical.version, 16);
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
  assert.equal(migrated.version, 16);
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
  assert.equal(createI18n('fr').t('feat.total', { count: 0, total: count }), `0/${count} exploits`);
  assert.equal(createI18n('en').t('feat.total', { count: 0, total: count }), `0/${count} feats`);
  for (const [id, feat] of Object.entries(FEATS)) {
    assert.equal(feat.id, id);
    assert.notEqual(DICTIONARIES.fr[`feat.${id}`], undefined);
    assert.notEqual(DICTIONARIES.en[`feat.effect.${id}`], undefined);
  }
});
test('signature support tooltips stay synchronized with their authored battle values', () => {
  for (const lang of ['fr', 'en']) {
    const t = createI18n(lang).t;
    assert.match(t('move.effect.oracle_veil'), new RegExp(String(MOVES.oracle_veil.barrier)));
    assert.match(t('move.effect.deja_vu'), new RegExp(String(MOVES.deja_vu.barrier)));
    assert.match(t('move.effect.shell_bastion'), new RegExp(String(MOVES.shell_bastion.barrier)));
    assert.match(t('move.effect.leaf_mantle'), new RegExp(String(MOVES.leaf_mantle.barrier)));
    assert.match(t('move.effect.leaf_mantle'), new RegExp(String(MOVES.leaf_mantle.teamBarrier)));
    assert.match(
      t('move.effect.leaf_mantle'),
      new RegExp(String(Math.round(MOVES.leaf_mantle.teamHealRatio * 100)))
    );
  }
});
