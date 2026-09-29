import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MUSIC_THEMES,
  SCREEN_THEME_MAP,
  SCHEDULER_HORIZON_SECONDS,
  SCHEDULER_STALE_SECONDS,
  SoundSystem,
  calculateTension,
  computeMixerLevels,
  resolveThemeId,
} from '../src/sound.js';
import { MOVES } from '../src/data/moves.js';
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

test('the explicit migration chain advances every historical version to v17', () => {
  assert.equal(SAVE_VERSION, 17);
  assert.equal(SAVE_MIGRATIONS.length, 16);
  let save = { version: 1 };
  for (let index = 0; index < SAVE_MIGRATIONS.length; index++) {
    save = SAVE_MIGRATIONS[index](save);
    assert.equal(save.version, index + 2);
  }
  assert.equal(save.musicVolume, 0.45);
  assert.equal(save.sfxVolume, 0.8);
  assert.equal(save.expertMode, false);
  assert.deepEqual(migrateSave({ version: 12, musicVolume: 0.2 }).version, 17);
  assert.equal(validateSave({ ...DEFAULT_SAVE, version: 13 }).version, 17);
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

// Minimal Web Audio stand-in: records the connection graph, source start/stop times and
// automation targets so routing and lifecycle behaviour can be checked without a browser.
function makeParam() {
  return {
    value: 1,
    targets: [],
    setValueAtTime(value) {
      this.value = value;
    },
    setTargetAtTime(value) {
      this.targets.push(value);
    },
    exponentialRampToValueAtTime() {},
    linearRampToValueAtTime() {},
    cancelScheduledValues() {},
  };
}

class FakeNode {
  constructor(kind) {
    this.kind = kind;
    for (const name of ['gain', 'frequency', 'Q', 'threshold', 'knee', 'ratio', 'attack', 'release'])
      this[name] = makeParam();
    this.outputs = new Set();
    this.listeners = {};
    this.started = [];
    this.stopped = [];
    this.disconnects = 0;
  }
  connect(node) {
    this.outputs.add(node);
    return node;
  }
  disconnect() {
    this.outputs.clear();
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
    this.suspended = 0;
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
  createConvolver() {
    return this.node('convolver');
  }
  createDynamicsCompressor() {
    return this.node('compressor');
  }
  createBuffer(channels, length) {
    return { numberOfChannels: channels, getChannelData: () => new Float32Array(length) };
  }
  suspend() {
    this.suspended += 1;
    return Promise.resolve();
  }
}

// Music volume 0 keeps the real setInterval scheduler from starting inside unit tests.
function soundWithGraph(settings = { ...DEFAULT_SAVE, musicVolume: 0 }) {
  const sound = new SoundSystem(settings);
  sound.ctx = new FakeAudioContext();
  sound.buildGraph();
  return sound;
}

function pathsToOutput(node, destination, trail = []) {
  if (node === destination) return [trail];
  return [...node.outputs].flatMap((next) => pathsToOutput(next, destination, [...trail, next]));
}

const sourcesCreatedBy = (sound, action) => {
  const before = sound.ctx.nodes.length;
  action();
  return sound.ctx.nodes
    .slice(before)
    .filter((node) => node.kind === 'oscillator' || node.kind === 'buffer-source');
};

test('patch starts every SFX source before stopping and cleans each chain on ended', () => {
  const sound = soundWithGraph();
  const before = sound.ctx.nodes.length;
  sound.patch({ duration: 0.16, noiseGain: 0.02 });
  const session = [sound.sfxSession.dry, sound.sfxSession.wet];
  const patchNodes = sound.ctx.nodes.slice(before).filter((node) => !session.includes(node));

  assert.equal(sound.sfxSources.size, 3);
  for (const source of sound.sfxSources) {
    assert.equal(source.started.length, 1);
    assert.equal(source.stopped.length, 1);
    source.emitEnded();
  }
  assert.equal(sound.sfxSources.size, 0);
  assert.ok(patchNodes.every((node) => node.disconnects === 1));
  assert.ok(
    session.every((node) => node.disconnects === 0),
    'the session outlives one cue'
  );
});

test('every dry and wet path of each category passes through that category controls only', () => {
  const sound = soundWithGraph({ ...DEFAULT_SAVE });
  const { graph, ctx } = sound;
  const [note] = sourcesCreatedBy(sound, () =>
    sound.musicNote(440, 1, 0.5, { gain: 0.02, wave: 'sine', filter: 1500, attack: 0.01, reverb: 0.4 })
  );
  const [noise] = sourcesCreatedBy(sound, () => sound.musicNoise(1, 1, 600));
  const [tension] = sourcesCreatedBy(sound, () =>
    sound.musicNote(880, 1, 0.2, {
      gain: 0.02,
      wave: 'triangle',
      filter: 1150,
      attack: 0.01,
      reverb: 0.12,
      tension: true,
    })
  );
  const sfx = sourcesCreatedBy(sound, () => sound.patch({ duration: 0.2, reverb: 0.4 }));
  const viaConvolver = (paths) => paths.some((path) => path.some((node) => node.kind === 'convolver'));

  for (const source of [note, noise]) {
    const paths = pathsToOutput(source, ctx.destination);
    assert.ok(viaConvolver(paths) && paths.some((path) => !path.some((node) => node.kind === 'convolver')));
    for (const path of paths) {
      assert.ok(path.includes(sound.themeBus) || path.includes(sound.themeWetBus), 'theme fade');
      for (const control of [graph.musicLevel, graph.musicDuck, graph.master])
        assert.ok(path.includes(control));
      assert.ok(!path.includes(graph.sfxLevel));
    }
  }
  const tensionPaths = pathsToOutput(tension, ctx.destination);
  assert.ok(viaConvolver(tensionPaths));
  for (const path of tensionPaths)
    for (const control of [sound.tensionThemeBus, graph.tensionLevel, graph.musicLevel, graph.musicDuck])
      assert.ok(path.includes(control));
  for (const source of sfx) {
    const paths = pathsToOutput(source, ctx.destination);
    assert.ok(viaConvolver(paths));
    for (const path of paths) {
      assert.ok(path.includes(graph.sfxLevel) && path.includes(graph.master));
      assert.ok(path.includes(sound.sfxSession.dry) || path.includes(sound.sfxSession.wet));
      assert.ok(!path.includes(graph.musicLevel) && !path.includes(graph.musicDuck));
    }
  }

  sound.update({ ...DEFAULT_SAVE, musicVolume: 0, sfxVolume: 0 });
  assert.equal(graph.musicLevel.gain.targets.at(-1), 0);
  assert.equal(graph.sfxLevel.gain.targets.at(-1), 0);
  assert.equal(graph.tensionLevel.gain.targets.at(-1), 0, 'no tension, no tension layer');
});

test('leaving a screen stops its queued cues while the results sting plays once per arrival', () => {
  const sound = soundWithGraph();
  const { ctx } = sound;
  const signature = Object.values(MOVES).find((move) => move.signature);
  const lastStop = (source) => source.stopped.at(-1);
  sound.setScreen('selection');
  sound.setScreen('battle:crystal');
  const battleCues = sourcesCreatedBy(sound, () => sound.move(signature));
  assert.ok(
    battleCues.some((source) => source.started[0] > ctx.currentTime),
    'layers are queued ahead'
  );
  assert.deepEqual(
    sourcesCreatedBy(sound, () => sound.victory()),
    [],
    'no sting on the battle screen'
  );

  ctx.currentTime = 1.05;
  sound.setScreen('victory');
  for (const source of battleCues) assert.ok(lastStop(source) <= ctx.currentTime + 0.05);

  const sting = sourcesCreatedBy(sound, () => sound.victory());
  assert.ok(sting.length >= 4);
  const naturalStops = sting.map(lastStop);
  assert.equal(sound.setScreen('victory'), false, 're-rendered results keep the sting');
  assert.deepEqual(sting.map(lastStop), naturalStops);
  assert.ok(
    sting.every((source) => lastStop(source) > source.started[0] + 0.05),
    'sting plays out'
  );

  sound.setScreen('settings');
  assert.ok(
    sting.every((source) => lastStop(source) <= ctx.currentTime + 0.05),
    'leaving stops the sting'
  );
  sound.setScreen('victory');
  assert.deepEqual(
    sourcesCreatedBy(sound, () => sound.victory()),
    [],
    'settings return does not replay'
  );

  sound.setScreen('title');
  sound.setScreen('battle:volcano');
  sound.setScreen('defeat');
  assert.ok(sourcesCreatedBy(sound, () => sound.defeat()).length >= 4, 'the next battle re-arms');

  const muted = soundWithGraph({ ...DEFAULT_SAVE, musicVolume: 0, muted: true });
  muted.setScreen('battle:crystal');
  muted.setScreen('victory');
  muted.victory();
  muted.update({ ...DEFAULT_SAVE, musicVolume: 0 });
  assert.deepEqual(
    sourcesCreatedBy(muted, () => muted.victory()),
    [],
    'unmuting later does not celebrate'
  );
});

test('hiding the page stops SFX and music so nothing resumes mid-attack', () => {
  const sound = soundWithGraph();
  const cues = sourcesCreatedBy(sound, () => {
    sound.patch({ duration: 0.4, delay: 0.2 });
    sound.musicNote(440, 1, 1, { gain: 0.02, wave: 'sine', filter: 1500, attack: 0.01, reverb: 0.4 });
  });
  sound.handleVisibility(true);
  assert.equal(sound.sfxSources.size, 0);
  assert.equal(sound.musicSources.size, 0);
  assert.ok(cues.every((source) => source.stopped.at(-1) <= sound.ctx.currentTime));
  assert.equal(sound.ctx.suspended, 1);
  assert.deepEqual(
    sourcesCreatedBy(sound, () => sound.hit('flame')),
    [],
    'hidden pages stay silent'
  );
});

test('the music scheduler skips steps a stall made stale and never schedules in the past', () => {
  const sound = new SoundSystem(DEFAULT_SAVE);
  sound.ctx = new FakeAudioContext();
  sound.ctx.currentTime = 10;
  sound.themeId = 'crystal';
  const stepDuration = 60 / MUSIC_THEMES.crystal.tempo / 4;
  const scheduled = [];
  sound.scheduleMusicStep = (config, step, time) =>
    scheduled.push({ step, time, now: sound.ctx.currentTime });
  const origin = 10.05;
  sound.nextStepTime = origin;
  sound.stepIndex = 0;

  sound.scheduleAhead();
  assert.ok(scheduled.length > 0);
  assert.ok(scheduled.every(({ time }) => time >= 10 && time < 10 + SCHEDULER_HORIZON_SECONDS));

  const beforeStall = scheduled.length;
  sound.ctx.currentTime += 0.6;
  sound.scheduleAhead();
  const afterStall = scheduled.slice(beforeStall);
  assert.ok(afterStall.length > 0 && afterStall.length < 0.6 / stepDuration, 'no catch-up burst');
  assert.ok(afterStall[0].step > scheduled[beforeStall - 1].step + 1, 'stale steps were skipped');
  for (const { step, time, now } of afterStall) {
    assert.ok(time >= now);
    assert.ok(Math.abs(time - (origin + step * stepDuration)) < 1e-9, 'the rhythmic grid is kept');
  }

  const slightlyLate = sound.nextStepTime + SCHEDULER_STALE_SECONDS / 2;
  const nextStep = sound.stepIndex;
  sound.ctx.currentTime = slightlyLate;
  const beforeLate = scheduled.length;
  sound.scheduleAhead();
  assert.equal(scheduled[beforeLate].step, nextStep, 'a barely late step still plays');
  assert.equal(scheduled[beforeLate].time, slightlyLate, 'starting now with its full envelope');
});
