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
  assert.deepEqual(computeMixerLevels({ volume: 0, musicVolume: -1, sfxVolume: 0.35 }), {
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
  assert.equal(calculateTension({ playerHpRatio: 0, enemyHpRatio: 0, turn: 99 }), 0.82);
});

test('the explicit migration chain advances every historical version to v16', () => {
  assert.equal(SAVE_VERSION, 16);
  assert.equal(SAVE_MIGRATIONS.length, 15);
  let save = { version: 1 };
  for (let index = 0; index < SAVE_MIGRATIONS.length; index++) {
    save = SAVE_MIGRATIONS[index](save);
    assert.equal(save.version, index + 2);
  }
  assert.equal(save.musicVolume, 0.45);
  assert.equal(save.sfxVolume, 0.8);
  assert.equal(save.expertMode, false);
  assert.deepEqual(migrateSave({ version: 12, musicVolume: 0.2 }).version, 16);
  assert.equal(validateSave({ ...DEFAULT_SAVE, version: 13 }).version, 16);
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
test('scheduled audio chains disconnect every node when their source ends', () => {
  const sound = new SoundSystem(DEFAULT_SAVE);
  const disconnected = [];
  const makeNode = (name) => ({
    disconnect() {
      disconnected.push(name);
    },
  });
  const source = {
    listeners: {},
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    },
    emit(type) {
      this.listeners[type]?.();
    },
  };
  const chain = [source, makeNode('filter'), makeNode('gain'), makeNode('send')];
  const collection = new Set();

  sound.trackSource(source, collection, chain);
  assert.equal(collection.has(source), true);
  source.emit('ended');
  assert.deepEqual(disconnected, ['filter', 'gain', 'send']);
  assert.equal(collection.has(source), false);
});

test('shared SFX nodes disconnect only after the final source ends', () => {
  const sound = new SoundSystem(DEFAULT_SAVE);
  const disconnected = [];
  const shared = {
    disconnect() {
      disconnected.push('shared');
    },
  };
  const makeSource = () => {
    const source = {
      listeners: {},
      addEventListener(type, listener) {
        this.listeners[type] = listener;
      },
      emit(type) {
        this.listeners[type]?.();
      },
    };
    return source;
  };
  const first = makeSource();
  const second = makeSource();
  const collection = new Set();

  sound.trackSource(first, collection, [first, shared]);
  sound.trackSource(second, collection, [second, shared]);
  first.emit('ended');
  assert.deepEqual(disconnected, []);
  second.emit('ended');
  assert.deepEqual(disconnected, ['shared']);
});

test('patch starts every SFX source before stopping and cleans each chain on ended', () => {
  const makeParam = () => ({
    value: 1,
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime() {},
    cancelScheduledValues() {},
  });
  class FakeNode {
    constructor(kind) {
      this.kind = kind;
      this.gain = makeParam();
      this.frequency = makeParam();
      this.Q = makeParam();
      this.listeners = {};
      this.started = [];
      this.stopped = [];
      this.disconnects = 0;
    }
    connect(node) {
      return node;
    }
    disconnect() {
      this.disconnects += 1;
    }
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    }
    start(time) {
      this.started.push(time);
    }
    stop(time) {
      assert.ok(this.started.length, `${this.kind} stopped before start`);
      this.stopped.push(time);
    }
    emitEnded() {
      this.listeners.ended?.();
    }
  }
  class FakeAudioContext {
    constructor() {
      this.currentTime = 1;
      this.sampleRate = 100;
      this.state = 'running';
      this.destination = new FakeNode('destination');
      this.nodes = [];
    }
    node(kind) {
      const node = new FakeNode(kind);
      this.nodes.push(node);
      return node;
    }
    createGain() {
      return this.node('gain');
    }
    createOscillator() {
      return this.node('oscillator');
    }
    createBufferSource() {
      return this.node('buffer-source');
    }
    createBiquadFilter() {
      return this.node('filter');
    }
    createBuffer(channels, length) {
      return { numberOfChannels: channels, getChannelData: () => new Float32Array(length) };
    }
  }

  const sound = new SoundSystem(DEFAULT_SAVE);
  const ctx = new FakeAudioContext();
  sound.ctx = ctx;
  sound.graph = { sfxBus: ctx.createGain(), reverbIn: ctx.createGain() };
  sound.patch({ duration: 0.16, noiseGain: 0.02 });

  assert.equal(sound.sfxSources.size, 3);
  for (const source of sound.sfxSources) {
    assert.equal(source.started.length, 1);
    assert.equal(source.stopped.length, 1);
    source.emitEnded();
  }
  assert.equal(sound.sfxSources.size, 0);
  assert.ok(ctx.nodes.slice(2).every((node) => node.disconnects === 1));
});
