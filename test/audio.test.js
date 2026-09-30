import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MUSIC_LOOP_MARGIN_SECONDS,
  MUSIC_TRACKS,
  SCREEN_THEME_MAP,
  SoundSystem,
  calculateTension,
  computeMixerLevels,
  musicUrl,
  resolveThemeId,
} from '../src/sound.js';
import { ARENAS } from '../src/data/trainers.js';
import { readOggOpus } from '../tools/music/ogg.js';
import { MOVES } from '../src/data/moves.js';
import { CREATURES } from '../src/data/creatures.js';
import { CUE_NAMES } from '../src/battle-ui/cues.js';
import { CRY_LEVELS, CRY_PROFILES, CRY_VARIANTS, cryPlan } from '../src/sound-cries.js';
import {
  DEFAULT_SAVE,
  SAVE_MIGRATIONS,
  SAVE_VERSION,
  loadSave,
  migrateSave,
  persistSave,
  validateSave,
} from '../src/save.js';

test('every screen family and arena resolves to baked music, and arenas add a tension stem', () => {
  assert.deepEqual(
    Object.keys(MUSIC_TRACKS).sort(),
    [...ARENAS, 'defeat', 'library', 'selection', 'title', 'victory'].sort()
  );
  for (const arena of ARENAS) {
    assert.equal(resolveThemeId(`battle:${arena}`), arena);
    assert.deepEqual(MUSIC_TRACKS[arena], ['base', 'tension']);
  }
  for (const theme of new Set(Object.values(SCREEN_THEME_MAP)))
    assert.deepEqual(MUSIC_TRACKS[theme], ['base']);
  assert.equal(SCREEN_THEME_MAP.academy, 'library');
  assert.equal(resolveThemeId('battle:not-an-arena'), 'crystal');
  assert.equal(resolveThemeId('gauntlet-boon'), 'selection');
  const sound = new SoundSystem(DEFAULT_SAVE);
  assert.equal(sound.setScreen('title'), true);
  assert.equal(sound.setScreen('settings'), false);
  assert.equal(sound.setScreen('selection'), true);
});

// The runtime loops [margin, duration − margin] of each decoded file (MUSIC_LOOP_MARGIN_SECONDS),
// so the shipped files must hold exactly margin + loop + margin samples, with every stem of a
// theme on one loop; the decoded PCM of one screen (all its stems, 48 kHz float) stays ≤ 24 MiB.
test('the shipped music files loop exactly and fit the decoded-memory budget', async () => {
  const margin = MUSIC_LOOP_MARGIN_SECONDS * 48000;
  for (const [theme, stems] of Object.entries(MUSIC_TRACKS)) {
    let decoded = 0,
      loop = null;
    for (const stem of stems) {
      const url = musicUrl(theme, stem);
      const file = readOggOpus(await readFile(new URL(`../${url.slice(2)}`, import.meta.url)));
      assert.ok(file.crcOk && file.eos, `${url} pages`);
      assert.equal(file.inputRate, 48000);
      assert.equal(file.channels, stem === 'base' ? 2 : 1, `${url} channels`);
      assert.equal(Number(file.tags.LOOPSTART), margin, `${url} loop start`);
      assert.equal(
        file.samples,
        margin + Number(file.tags.LOOPLENGTH) + margin,
        `${url} ends one margin after the loop`
      );
      loop ??= file.tags.LOOPLENGTH;
      assert.equal(file.tags.LOOPLENGTH, loop, `${url} shares the theme's loop`);
      decoded += file.samples * file.channels * Float32Array.BYTES_PER_ELEMENT;
    }
    assert.ok(decoded <= 24 * 2 ** 20, `${theme} decodes to ${decoded} bytes`);
  }
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

test('the explicit migration chain advances every historical version to v18', () => {
  assert.equal(SAVE_VERSION, 18);
  assert.equal(SAVE_MIGRATIONS.length, 17);
  let save = { version: 1 };
  for (let index = 0; index < SAVE_MIGRATIONS.length; index++) {
    save = SAVE_MIGRATIONS[index](save);
    assert.equal(save.version, index + 2);
  }
  assert.equal(save.musicVolume, 0.45);
  assert.equal(save.sfxVolume, 0.8);
  assert.equal(save.expertMode, false);
  assert.deepEqual(migrateSave({ version: 12, musicVolume: 0.2 }).version, 18);
  assert.equal(validateSave({ ...DEFAULT_SAVE, version: 13 }).version, 18);
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
    this.offsets = [];
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
  start(time, offset) {
    this.started.push(time);
    this.offsets.push(offset);
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
  decodeAudioData() {
    return Promise.reject(new DOMException('Unable to decode audio data', 'EncodingError'));
  }
}

// Serves the music files to a sound system: a fetch stub (restored after the test) and a decoder
// giving 30.2 s buffers, stereo for base stems and mono for tension stems. Returns the fetched
// and decoded URLs.
function serveMusic(t, sound) {
  const log = { fetched: [], decoded: [] };
  t.mock.method(globalThis, 'fetch', async (url) => {
    log.fetched.push(url);
    return { ok: true, status: 200, arrayBuffer: async () => ({ url }) };
  });
  sound.ctx.decodeAudioData = async ({ url }) => {
    log.decoded.push(url);
    const channels = url.includes('-tension') ? 1 : 2;
    return { url, duration: 30.2, length: 30.2 * 48000, numberOfChannels: channels, sampleRate: 48000 };
  };
  return log;
}

// Lets the stubbed fetch / decode promises of a music load settle.
const settle = () => new Promise((resolve) => setImmediate(resolve));
const pcmBytes = (buffer) => buffer.length * buffer.numberOfChannels * 4;

// Music volume 0 keeps the music player from fetching inside unit tests that do not need it.
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

const nodesCreatedBy = (sound, action) => {
  const before = sound.ctx.nodes.length;
  const result = action();
  return { result, nodes: sound.ctx.nodes.slice(before) };
};
const isSource = (node) => node.kind === 'oscillator' || node.kind === 'buffer-source';

// Cue payloads shaped like docs/battle-presentation.md §5 (the director's emits).
const MOVE = {
  side: 'player',
  creatureId: 'pyrolynx',
  moveId: 'flash_pounce',
  affinity: 'flame',
  archetype: 'DASH',
  tier: 1,
  signature: false,
  speed: 1,
  reducedMotion: false,
};
const HIT = {
  side: 'enemy',
  sourceSide: 'player',
  creatureId: 'kordane',
  moveId: 'flash_pounce',
  affinity: 'flame',
  hit: 1,
  hits: 1,
  amount: 12,
  absorbed: 0,
  critical: false,
  effectiveness: 1,
  blocked: false,
  lethal: false,
  tier: 1,
  speed: 1,
  reducedMotion: false,
};

test('cue voices start before they stop and every chain disconnects once its last source ends', () => {
  const sound = soundWithGraph();
  const before = sound.ctx.nodes.length;
  sound.cue('contact', { ...HIT, beat: 1, affinity: 'tide' });
  sound.cue('status-', { beat: 2, side: 'enemy', creatureId: 'kordane', statuses: ['marked'] });
  // Cries add modulators (vibrato, FM, flutter) wired into params; they must be released too.
  sound.cue('switch-in', { beat: 3, side: 'player', creatureId: 'orakyn', source: 'switch' });
  sound.cue('faint-cry', { beat: 4, side: 'enemy', creatureId: 'brontusk' });
  const session = [sound.sfxSession.dry, sound.sfxSession.wet];
  const cueNodes = sound.ctx.nodes.slice(before).filter((node) => !session.includes(node));

  assert.ok(sound.sfxSources.size > 4);
  for (const source of [...sound.sfxSources]) {
    assert.equal(source.started.length, 1);
    assert.equal(source.stopped.length, 1);
    source.emitEnded();
  }
  assert.equal(sound.sfxSources.size, 0);
  assert.ok(cueNodes.every((node) => node.disconnects === 1));
  assert.ok(
    session.every((node) => node.disconnects === 0),
    'the session outlives one cue'
  );
});

test('every path of each category passes through that category controls only', async (t) => {
  const sound = soundWithGraph({ ...DEFAULT_SAVE });
  serveMusic(t, sound);
  const { graph, ctx } = sound;
  sound.setScreen('battle:crystal');
  await settle();
  const [base, tension] = [...sound.musicSources];
  const sfx = sourcesCreatedBy(sound, () => sound.cue('contact', { ...HIT, beat: 1, affinity: 'flame' }));
  const viaConvolver = (paths) => paths.some((path) => path.some((node) => node.kind === 'convolver'));

  // The music carries its reverb: one path per stem, through the music controls only.
  for (const [source, controls] of [
    [base, [graph.musicLevel, graph.musicDuck, graph.master]],
    [tension, [graph.tensionLevel, graph.musicLevel, graph.musicDuck, graph.master]],
  ]) {
    const paths = pathsToOutput(source, ctx.destination);
    assert.equal(paths.length, 1);
    for (const control of controls) assert.ok(paths[0].includes(control));
    assert.ok(!paths[0].includes(graph.sfxLevel) && !viaConvolver(paths));
  }
  assert.ok(
    !pathsToOutput(base, ctx.destination)[0].includes(graph.tensionLevel),
    'the base ignores tension'
  );
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
  assert.equal(graph.tensionLevel.gain.targets.at(-1), 0, 'no tension, no tension stem');
});

test('a theme plays its stems sample-locked, and only the current theme stays decoded', async (t) => {
  const sound = soundWithGraph({ ...DEFAULT_SAVE });
  const log = serveMusic(t, sound);
  const { ctx } = sound;
  sound.setScreen('battle:volcano');
  await settle();
  assert.deepEqual(log.fetched, [musicUrl('volcano', 'base'), musicUrl('volcano', 'tension')]);
  const [base, tension] = [...sound.musicSources];
  for (const source of [base, tension]) {
    assert.equal(source.loop, true);
    assert.equal(source.loopStart, MUSIC_LOOP_MARGIN_SECONDS);
    assert.equal(source.loopEnd, source.buffer.duration - MUSIC_LOOP_MARGIN_SECONDS);
  }
  assert.deepEqual(base.offsets, [MUSIC_LOOP_MARGIN_SECONDS], 'the loop starts after its margin');
  assert.deepEqual([tension.started, tension.offsets], [base.started, base.offsets], 'one start, one offset');
  assert.equal(sound.musicBytes(), pcmBytes(base.buffer) + pcmBytes(tension.buffer));

  ctx.currentTime = 2;
  sound.setScreen('victory');
  for (const source of [base, tension])
    assert.ok(source.stopped[0] <= ctx.currentTime + 0.3, 'the arena fades out');
  assert.equal(sound.musicBytes(), 0, 'the arena is released before the next theme decodes');
  await settle();
  assert.deepEqual(log.decoded.slice(2), [musicUrl('victory', 'base')]);
  assert.equal(sound.musicBytes(), 30.2 * 48000 * 2 * 4);

  // A theme left before its decode never starts.
  const before = ctx.nodes.length;
  sound.setScreen('title');
  sound.setScreen('selection');
  await settle();
  assert.deepEqual(log.decoded.slice(3), [musicUrl('selection', 'base')]);
  const started = ctx.nodes
    .slice(before)
    .filter((node) => node.kind === 'buffer-source' && node.started.length);
  assert.deepEqual(
    started.map((node) => node.buffer.url),
    [musicUrl('selection', 'base')]
  );
});

test('the tension stem follows the presented battle state past a deadband', () => {
  const sound = soundWithGraph();
  const level = sound.graph.tensionLevel.gain;
  const view = (hp, enemyHp, turn) => ({
    turn,
    sides: {
      player: { active: 0, surge: 0, team: [{ id: 'orakyn', hp, maxHp: 100 }] },
      enemy: { active: 0, surge: 0, team: [{ id: 'kordane', hp: enemyHp, maxHp: 100 }] },
    },
  });
  sound.setScreen('battle:crystal');
  sound.setBattleState(view(100, 100, 1));
  assert.equal(level.targets.at(-1), 0, 'a fresh, even fight keeps the stem silent');
  sound.setBattleState(view(30, 25, 9));
  assert.ok(level.targets.at(-1) > 0.5, 'a close, late, low-HP fight brings it in');
  const changes = level.targets.length;
  sound.setBattleState(view(29, 25, 9));
  assert.equal(level.targets.length, changes, 'one small hit does not move the score');
  sound.setScreen('victory');
  assert.equal(level.targets.at(-1), 0, 'leaving the battle drops it');
});

test('music stays silent without a notice when a file is missing or cannot be decoded', async (t) => {
  for (const failure of ['offline', 'missing', 'undecodable']) {
    let notices = 0;
    const sound = new SoundSystem({ ...DEFAULT_SAVE }, () => (notices += 1));
    sound.ctx = new FakeAudioContext();
    sound.buildGraph();
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
      if (failure === 'offline') throw new TypeError('Failed to fetch');
      return { ok: failure !== 'missing', status: 404, arrayBuffer: async () => new ArrayBuffer(8) };
    });
    sound.setScreen('title');
    await settle();
    assert.equal(fetchMock.mock.callCount(), 1, failure);
    assert.equal(sound.musicSources.size, 0, failure);
    assert.equal(sound.musicBytes(), 0, failure);
    assert.equal(notices, 0, failure);
    fetchMock.mock.restore();
  }
});

test('a silenced music slider fetches and holds nothing; raising it loads the current theme', async (t) => {
  const sound = soundWithGraph();
  const log = serveMusic(t, sound);
  sound.setScreen('title');
  sound.update({ ...DEFAULT_SAVE, muted: true });
  await settle();
  assert.deepEqual(log.fetched, []);
  sound.update({ ...DEFAULT_SAVE });
  await settle();
  assert.deepEqual(log.fetched, [musicUrl('title', 'base')]);
  assert.ok(sound.musicBytes() > 0);
  sound.update({ ...DEFAULT_SAVE, musicVolume: 0 });
  assert.equal(sound.musicBytes(), 0, 'silencing releases the decoded theme');
});

test('leaving a screen stops its queued cues while the results sting plays once per arrival', () => {
  const sound = soundWithGraph();
  const { ctx } = sound;
  const signature = Object.values(MOVES).find((move) => move.signature);
  const lastStop = (source) => source.stopped.at(-1);
  sound.setScreen('selection');
  sound.setScreen('battle:crystal');
  const battleCues = sourcesCreatedBy(sound, () =>
    sound.cue('signature-cutin', {
      beat: 1,
      speed: 1,
      side: 'player',
      creatureId: signature.owner,
      moveId: signature.id,
      clash: false,
    })
  );
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

test('hiding the page stops SFX while the music pauses with the context and resumes in place', async (t) => {
  const sound = soundWithGraph({ ...DEFAULT_SAVE });
  const log = serveMusic(t, sound);
  sound.setScreen('title');
  await settle();
  const music = [...sound.musicSources];
  const cues = sourcesCreatedBy(sound, () =>
    sound.cue('heal', { beat: 1, speed: 1, side: 'player', creatureId: 'virelia', amount: 12, team: false })
  );
  sound.handleVisibility(true);
  assert.equal(sound.sfxSources.size, 0);
  assert.ok(cues.every((source) => source.stopped.at(-1) <= sound.ctx.currentTime));
  assert.equal(sound.ctx.suspended, 1);
  assert.deepEqual(
    sourcesCreatedBy(sound, () => sound.hit('flame')),
    [],
    'hidden pages stay silent'
  );
  assert.ok(
    music.length && music.every((source) => source.stopped.length === 0),
    'the loop is paused, not stopped'
  );
  sound.handleVisibility(false);
  await settle();
  assert.deepEqual(log.fetched, [musicUrl('title', 'base')], 'no reload on return');
  assert.deepEqual([...sound.musicSources], music);
});

test('one dominant cue per beat: impact outranks gestures, stamps ride on the contact, nothing waits', () => {
  const sound = soundWithGraph();
  const { ctx } = sound;
  const earliestStart = (nodes) => Math.min(...nodes.filter(isSource).map((node) => node.started[0]));

  const windup = nodesCreatedBy(sound, () => sound.cue('windup', { ...MOVE, beat: 1 }));
  const release = nodesCreatedBy(sound, () => sound.cue('release', { ...MOVE, beat: 1, hit: 1 }));
  const contact = nodesCreatedBy(sound, () =>
    sound.cue('contact', { ...HIT, beat: 1, critical: true, effectiveness: 2 })
  );
  assert.equal(contact.result.level, 'dominant');
  for (const cue of [windup, release, contact])
    assert.equal(earliestStart(cue.nodes), ctx.currentTime, 'never delayed');
  const releaseBus = release.nodes.find((node) => node.kind === 'gain');
  assert.ok(
    releaseBus.gain.targets.some((value) => value < 1),
    'the release is ducked under the contact'
  );
  assert.equal(releaseBus.gain.targets.at(-1), 1, 'and restored when the contact ends');

  const outcome = (name, payload = {}) => sound.cue(name, { beat: 1, speed: 1, ...payload })?.level;
  assert.equal(outcome('critical', { side: 'enemy' }), 'dropped', 'the contact carried the crit accent');
  assert.equal(outcome('effective', { side: 'enemy' }), 'dropped');
  assert.equal(outcome('readout', { side: 'enemy', kind: 'damage', amount: 12 }), 'dropped');
  assert.equal(outcome('switch-out', { side: 'player' }), 'dropped', 'UI never plays over the dominant cue');
  assert.equal(outcome('heal', { side: 'player', amount: 5, team: true }), 'ducked', 'utility under impact');
  assert.equal(
    outcome('heal', { side: 'player', amount: 5, team: true }),
    'dropped',
    'one heal gesture per beat'
  );
  assert.equal(outcome('readout', { side: 'player', kind: 'heal', amount: 5 }), 'dropped');
  ctx.currentTime += 2;
  assert.equal(
    outcome('status+', { side: 'player', statuses: ['focused'] }),
    'full',
    'no ducking once it ended'
  );

  assert.equal(
    outcome('status+', { beat: 2, side: 'player', statuses: ['focused'] }),
    'dominant',
    'a new beat'
  );
  assert.equal(outcome('faint-cry', { beat: 3, side: 'enemy', creatureId: 'kordane' }), 'dominant');
  assert.equal(
    outcome('ko', { beat: 3, side: 'enemy', creatureId: 'kordane' }),
    'dominant',
    'K.O. outranks the cry'
  );
});

test('each type plays its own material family, voiced in the phone band', () => {
  const families = new Set();
  const recipes = new Set();
  for (const affinity of ['tide', 'flame', 'grove', 'mind', 'force', 'shadow']) {
    const sound = soundWithGraph();
    const { result, nodes } = nodesCreatedBy(sound, () =>
      sound.cue('contact', { ...HIT, beat: 1, affinity })
    );
    families.add(result.family);
    const voiced = nodes.filter((node) => isSource(node) || node.kind === 'filter');
    recipes.add(voiced.map((node) => `${node.kind}:${node.type}:${Math.round(node.frequency.value)}`).join());
    assert.ok(
      voiced.some(
        (node) =>
          (node.kind === 'oscillator' || node.type === 'bandpass') &&
          node.frequency.value >= 700 &&
          node.frequency.value <= 3000
      ),
      `${affinity} has a 0.7–3 kHz component`
    );
  }
  assert.deepEqual([...families].sort(), ['combat', 'eau', 'feu', 'plante', 'psy', 'tenebres']);
  assert.equal(recipes.size, 6, 'six distinct recipes');

  const layers = (payload) => {
    const sound = soundWithGraph();
    return nodesCreatedBy(sound, () => sound.cue('contact', { ...HIT, beat: 1, ...payload })).nodes;
  };
  const neutral = layers({});
  const sources = (nodes) => nodes.filter(isSource).length;
  const lowpasses = (nodes) =>
    nodes.filter((node) => node.kind === 'filter' && node.type === 'lowpass').length;
  const recipe = (nodes) =>
    nodes
      .filter(isSource)
      .map((node) => `${node.kind}:${node.frequency.value}`)
      .join();
  assert.ok(
    sources(layers({ effectiveness: 2 })) > sources(neutral),
    'bright accent on a super-effective hit'
  );
  assert.ok(sources(layers({ critical: true })) > sources(neutral), 'crit accent');
  assert.ok(lowpasses(layers({ effectiveness: 0.5 })) > lowpasses(neutral), 'a resisted hit is damped');
  assert.notEqual(
    recipe(layers({ blocked: true, amount: 0, absorbed: 12 })),
    recipe(neutral),
    'blocked is the thunk'
  );
});

test('cries play on entrances, Signatures, faints and picks only, trimmed at ×2 without a pitch change', () => {
  const sound = soundWithGraph();
  const cries = [];
  const cryVoices = sound.cryVoices.bind(sound);
  sound.cryVoices = (cue, id, variant, options) => {
    cries.push({ id, variant, trim: cue.trim });
    return cryVoices(cue, id, variant, options);
  };
  // Every cue the director can emit, each on its own beat, with a payload carrying every field.
  const heard = {};
  CUE_NAMES.forEach((name, index) => {
    sound.ctx.currentTime += 3;
    cries.length = 0;
    sound.cue(name, {
      ...HIT,
      ...MOVE,
      beat: index + 1,
      side: 'enemy',
      creatureId: 'kordane',
      speed: name === 'switch-in' ? 2 : 1,
      statuses: ['focused'],
      kind: 'heal',
      source: 'replacement',
      clash: false,
      first: true,
    });
    if (cries.length) heard[name] = [...cries];
  });
  assert.deepEqual(heard, {
    'signature-cutin': [{ id: 'kordane', variant: 'effort', trim: 1 }],
    'faint-cry': [{ id: 'kordane', variant: 'faint', trim: 1 }],
    'switch-in': [{ id: 'kordane', variant: 'entry', trim: 0.65 }],
  });

  cries.length = 0;
  sound.call('abyssar');
  assert.deepEqual(cries, [{ id: 'abyssar', variant: 'entry', trim: 1 }], 'a team-select pick calls');
  const firstPick = sound.pickCue;
  sound.ctx.currentTime += 0.3;
  sound.call('nymbloom');
  assert.ok(firstPick.bus.gain.targets.includes(0), 'the next pick fades the previous cry');
  sound.ctx.currentTime += 5;
  sound.call('orakyn');
  assert.ok(!sound.pickCue.bus.gain.targets.includes(0), 'a finished cry is left alone');

  const cry = (speed) => {
    const other = soundWithGraph();
    return nodesCreatedBy(other, () =>
      other.cue('switch-in', { beat: 1, speed, side: 'player', creatureId: 'orakyn', source: 'switch' })
    ).nodes.filter((node) => node.kind === 'oscillator');
  };
  const normal = cry(1),
    fast = cry(2);
  assert.deepEqual(
    fast.map((node) => node.frequency.value),
    normal.map((node) => node.frequency.value),
    'same pitch at ×2'
  );
  const length = (node) => node.stopped[0] - node.started[0];
  assert.ok(
    fast.every((node, index) => length(node) < length(normal[index])),
    'shorter at ×2'
  );
});

const planEnd = (plan) => Math.max(...plan.map((layer) => layer.at + layer.dur));
const tones = (plan) => plan.filter((layer) => layer.wave);
const meanLog2 = (values) => values.reduce((sum, value) => sum + Math.log2(value), 0) / values.length;

test('every creature has its own authored voice with an effort and a faint variant', () => {
  const roster = Object.keys(CREATURES).sort();
  assert.deepEqual(Object.keys(CRY_PROFILES).sort(), roster);
  assert.deepEqual(Object.keys(CRY_LEVELS).sort(), roster, 'every voice is loudness-calibrated');
  assert.deepEqual(CRY_VARIANTS, ['entry', 'effort', 'faint']);

  const shapes = new Set();
  for (const id of roster) {
    const plans = Object.fromEntries(CRY_VARIANTS.map((variant) => [variant, cryPlan(id, variant)]));
    for (const [variant, plan] of Object.entries(plans)) {
      assert.ok(tones(plan).length, `${id} ${variant} is voiced`);
      for (const layer of plan) {
        assert.ok(layer.gain > 0 && layer.dur > 0 && layer.at >= 0, `${id} ${variant} layer is audible`);
        for (const [, hz] of layer.pitch ?? [])
          assert.ok(hz > 40 && hz < 16000, `${id} ${variant} pitch ${hz}`);
        for (const [, from, to] of layer.filters)
          assert.ok(from < 16000 && to < 16000, `${id} ${variant} filter under Nyquist`);
      }
    }
    const peak = (plan) => meanLog2(tones(plan).map((layer) => Math.max(...layer.pitch.map(([, hz]) => hz))));
    const settle = (plan) => meanLog2(tones(plan).map((layer) => layer.pitch.at(-1)[1]));
    assert.ok(peak(plans.effort) > peak(plans.entry), `${id}: the Signature effort is pitched up`);
    assert.ok(planEnd(plans.effort) < planEnd(plans.entry), `${id}: the effort is tighter`);
    assert.ok(settle(plans.faint) < settle(plans.entry), `${id}: the faint settles lower`);
    assert.ok(planEnd(plans.faint) > planEnd(plans.entry), `${id}: the faint is slower`);
    // A voice is its base pitch plus its layer recipe (waves/noises in order): no two creatures
    // may share both, whatever their other parameters.
    const recipe = CRY_PROFILES[id].layers.map((layer) => layer.wave ?? layer.noise).join('+');
    shapes.add(`${recipe}@${Math.round(12 * Math.log2(CRY_PROFILES[id].f0))}`);
  }
  assert.equal(shapes.size, roster.length, 'thirty distinct voices');
  assert.equal(cryPlan('not-a-creature'), null);
});

test('multi-hit audio follows the real contact cues instead of a pre-scheduled rhythm', () => {
  const sound = soundWithGraph();
  const { ctx } = sound;
  const release = (hits) =>
    sourcesCreatedBy(sound, () =>
      sound.cue('release', { ...MOVE, archetype: 'PROJ', beat: hits, hits, hit: 1 })
    );
  assert.equal(release(3).length, release(1).length, 'the release does not play the hits');

  const hits = [1, 2, 3].map((hit) => {
    ctx.currentTime += 0.22;
    const { result, nodes } = nodesCreatedBy(sound, () =>
      sound.cue('contact', { ...HIT, beat: 9, hit, hits: 3 })
    );
    return { result, now: ctx.currentTime, sources: nodes.filter(isSource) };
  });
  for (const { result, now, sources } of hits) {
    assert.notEqual(result.level, 'ducked', 'every hit plays at full level');
    assert.equal(
      Math.min(...sources.map((node) => node.started[0])),
      now,
      'each hit starts on its own contact'
    );
  }
  const topPitch = ({ sources }) =>
    Math.max(...sources.filter((node) => node.kind === 'oscillator').map((node) => node.frequency.value));
  assert.ok(
    topPitch(hits[2]) > topPitch(hits[1]) && topPitch(hits[1]) > topPitch(hits[0]),
    'later hits step up'
  );
});

test('the low-HP cue sounds once on the way down and re-arms above 35 % or on a switch', () => {
  const view = (id, hp, enemyHp = 80) => ({
    turn: 3,
    sides: {
      player: { active: 0, surge: 30, team: [{ id, hp, maxHp: 100 }] },
      enemy: { active: 0, surge: 30, team: [{ id: 'kordane', hp: enemyHp, maxHp: 100 }] },
    },
  });
  const cues = (sound, steps) =>
    steps.map(([id, hp]) => sourcesCreatedBy(sound, () => sound.setBattleState(view(id, hp))).length > 0);
  const sound = soundWithGraph();
  assert.deepEqual(
    cues(sound, [
      ['orakyn', 100],
      ['orakyn', 30],
      ['orakyn', 20],
      ['orakyn', 15],
      ['orakyn', 30],
      ['orakyn', 20],
      ['orakyn', 40],
      ['orakyn', 20],
      ['abyssar', 20],
      ['abyssar', 10],
      ['abyssar', 0],
    ]),
    [false, false, true, false, false, false, false, true, false, true, false]
  );

  const muted = soundWithGraph({ ...DEFAULT_SAVE, musicVolume: 0, muted: true });
  cues(muted, [
    ['orakyn', 100],
    ['orakyn', 20],
  ]);
  muted.update({ ...DEFAULT_SAVE, musicVolume: 0 });
  assert.deepEqual(cues(muted, [['orakyn', 15]]), [false], 'a threshold crossed while muted is spent');

  const music = soundWithGraph();
  music.setBattleState(view('orakyn', 100, 100));
  const calm = music.tension;
  music.setBattleState(view('orakyn', 96, 97));
  assert.equal(music.tension, calm, 'a small change stays inside the deadband');
  music.setBattleState(view('orakyn', 30, 60));
  assert.ok(music.tension > calm + 0.08, 'a real swing moves the score');
});

test('cue never throws and stays silent when it cannot play', () => {
  assert.equal(new SoundSystem(DEFAULT_SAVE).cue('contact', HIT), null, 'no audio context yet');
  const sound = soundWithGraph();
  assert.equal(sound.cue('not-a-cue', {}), null);
  assert.equal(sound.cue('constructor', {}), null);
  assert.equal(
    sound.cue('contact', {
      get beat() {
        throw new Error('broken payload');
      },
    }),
    null
  );
  assert.equal(sound.cue('contact', null)?.level, 'dominant', 'a missing payload still plays the hit');
  assert.equal(sound.cue('windup', { ...MOVE, beat: 5, reducedMotion: true }).level, 'dropped', 'cosmetic');
  assert.equal(
    sound.cue('windup', { ...MOVE, beat: 6, speed: 3 }).level,
    'dropped',
    'hurry skips the windup'
  );
  assert.equal(
    sound.cue('contact', { ...HIT, beat: 7, reducedMotion: true }).level,
    'dominant',
    'informative'
  );
  sound.handleVisibility(true);
  assert.deepEqual(
    sourcesCreatedBy(sound, () => sound.cue('contact', { ...HIT, beat: 8 })),
    [],
    'hidden pages stay silent'
  );
});
