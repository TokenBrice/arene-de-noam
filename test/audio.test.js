import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MUSIC_THEMES,
  SCREEN_THEME_MAP,
  SCHEDULER_HORIZON_SECONDS,
  SCHEDULER_INTERVAL_MS,
  SoundSystem,
  calculateTension,
  computeMixerLevels,
  resolveThemeId,
} from '../src/sound.js';
import {
  DEFAULT_SAVE,
  SAVE_MIGRATIONS,
  SAVE_VERSION,
  loadSave,
  migrateSave,
  persistSave,
  validateSave,
} from '../src/save.js';

test('music themes cover every screen family and authored arena', () => {
  assert.deepEqual(
    Object.keys(MUSIC_THEMES).sort(),
    [
      'astral',
      'crystal',
      'defeat',
      'eclipse',
      'grove',
      'library',
      'selection',
      'tidal',
      'title',
      'victory',
      'volcano',
    ].sort()
  );
  for (const [id, config] of Object.entries(MUSIC_THEMES)) {
    assert.ok(config.tempo >= 58 && config.tempo <= 92, `${id} tempo`);
    assert.ok(config.scale.length >= 6, `${id} scale`);
    assert.equal(config.chords.length, 4, `${id} progression`);
    assert.ok(
      config.chords.every((chord) => chord.length === 4),
      `${id} chord voicing`
    );
    assert.ok(config.melody.includes(null), `${id} melody has rests`);
  }
  assert.equal(SCREEN_THEME_MAP.academy, 'library');
  assert.equal(resolveThemeId('battle:eclipse'), 'eclipse');
  assert.equal(resolveThemeId('battle:not-an-arena'), 'crystal');
  assert.equal(resolveThemeId('gauntlet-boon'), 'selection');
  assert.equal(SCHEDULER_INTERVAL_MS, 25);
  assert.equal(SCHEDULER_HORIZON_SECONDS, 0.12);
  const sound = new SoundSystem(DEFAULT_SAVE);
  assert.equal(sound.setScreen('title'), true);
  assert.equal(sound.setScreen('settings'), false);
  assert.equal(sound.setScreen('selection'), true);
});

test('mixer settings clamp independently and mute only the master', () => {
  assert.deepEqual(computeMixerLevels({ volume: 2, musicVolume: -1, sfxVolume: 0.35 }), {
    master: 1,
    music: 0,
    sfx: 0.35,
  });
  assert.deepEqual(computeMixerLevels({ muted: true, volume: 0.7 }), {
    master: 0,
    music: 0.45,
    sfx: 0.8,
  });
  assert.ok(
    calculateTension({ playerHpRatio: 0.08, enemyHpRatio: 0.1, turn: 24, signatureReady: true }) >
      calculateTension({ playerHpRatio: 1, enemyHpRatio: 1, turn: 1 })
  );
  assert.equal(calculateTension({ playerHpRatio: 0, enemyHpRatio: 0, turn: 99, finalDuel: true }), 1);
});

test('the explicit migration chain advances every historical version to v15', () => {
  assert.equal(SAVE_VERSION, 15);
  assert.equal(SAVE_MIGRATIONS.length, 14);
  let save = { version: 1 };
  for (let index = 0; index < SAVE_MIGRATIONS.length; index++) {
    save = SAVE_MIGRATIONS[index](save);
    assert.equal(save.version, index + 2);
  }
  assert.equal(save.musicVolume, 0.45);
  assert.equal(save.sfxVolume, 0.8);
  assert.equal(save.expertMode, false);
  assert.deepEqual(migrateSave({ version: 12, musicVolume: 0.2 }).version, 15);
  assert.equal(validateSave({ ...DEFAULT_SAVE, version: 13 }).version, 15);
  assert.deepEqual(
    migrateSave({
      version: 14,
      customSquads: [{ team: ['orakyn', 'abyssar', 'virelia'], lead: 1, doctrine: 'ambush' }],
    }).customSquads[0],
    { team: ['orakyn', 'abyssar', 'virelia'], lead: 1 }
  );
});

test('v13 saves migrate to simple mode while an explicit expert preference survives', () => {
  assert.equal(migrateSave({ version: 13 }).expertMode, false);
  assert.equal(migrateSave({ version: 13, expertMode: true }).expertMode, true);
  assert.equal(validateSave({ ...DEFAULT_SAVE, expertMode: true }).expertMode, true);
  assert.equal(DEFAULT_SAVE.expertMode, false);
});

test('save versions are strict and persistence reports unavailable storage truthfully', () => {
  for (const version of [undefined, null, -1, 0, '12', 1.5]) {
    assert.equal(validateSave({ version }), null);
    const memory = { getItem: () => JSON.stringify({ version }) };
    assert.equal(loadSave(memory).notice, 'corrupt');
  }
  assert.equal(persistSave(DEFAULT_SAVE, null), false);
  assert.equal(
    persistSave(DEFAULT_SAVE, {
      setItem() {
        throw new Error('quota');
      },
    }),
    false
  );
});
