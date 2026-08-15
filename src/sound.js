const clamp01 = (value, fallback = 0) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;

export const SCHEDULER_INTERVAL_MS = 25;
export const SCHEDULER_HORIZON_SECONDS = 0.12;

export const SCREEN_THEME_MAP = Object.freeze({
  title: 'title',
  settings: 'title',
  selection: 'selection',
  league: 'selection',
  trials: 'selection',
  draft: 'selection',
  'gauntlet-boon': 'selection',
  bestiary: 'library',
  academy: 'library',
  victory: 'victory',
  defeat: 'defeat',
  results: 'victory',
});

const theme = (config) =>
  Object.freeze({
    ...config,
    scale: Object.freeze(config.scale),
    chords: Object.freeze(config.chords.map((chord) => Object.freeze(chord))),
    melody: Object.freeze(config.melody),
  });

// Chords are semitone offsets from each theme root. The repeating four-chord
// phrases deliberately favor suspended/add9 colors over arcade-style loops.
export const MUSIC_THEMES = Object.freeze({
  title: theme({
    root: 50,
    tempo: 68,
    scale: [0, 2, 4, 7, 9, 11],
    chords: [
      [0, 4, 7, 14],
      [-3, 2, 7, 11],
      [5, 9, 12, 16],
      [2, 7, 11, 16],
    ],
    melody: [4, null, 2, null, 3, 5, null, 2, 1, null, 3, null, 2, 0, null, null],
    bass: [0, -3, 5, 2],
    wave: 'sine',
    colorWave: 'triangle',
    filter: 1450,
  }),
  selection: theme({
    root: 55,
    tempo: 76,
    scale: [0, 2, 3, 5, 7, 9, 10],
    chords: [
      [0, 3, 7, 10],
      [5, 9, 12, 15],
      [-2, 3, 7, 12],
      [3, 7, 10, 14],
    ],
    melody: [2, null, 4, 3, null, 1, null, 0, 3, null, 5, null, 4, 2, null, 1],
    bass: [0, 5, -2, 3],
    wave: 'triangle',
    colorWave: 'sine',
    filter: 1750,
  }),
  library: theme({
    root: 48,
    tempo: 62,
    scale: [0, 2, 4, 6, 7, 9, 11],
    chords: [
      [0, 4, 7, 11],
      [2, 6, 9, 14],
      [7, 11, 14, 18],
      [4, 7, 11, 16],
    ],
    melody: [0, null, 3, null, 5, null, 4, 2, null, 1, null, 4, 3, null, 2, null],
    bass: [0, 2, 7, 4],
    wave: 'sine',
    colorWave: 'triangle',
    filter: 1200,
  }),
  crystal: theme({
    root: 50,
    tempo: 82,
    scale: [0, 2, 4, 7, 9, 11],
    chords: [
      [0, 4, 7, 14],
      [9, 12, 16, 19],
      [5, 9, 12, 16],
      [7, 11, 14, 18],
    ],
    melody: [4, null, 5, 3, null, 2, 4, null, 1, null, 3, 5, null, 4, 2, null],
    bass: [0, 9, 5, 7],
    wave: 'sine',
    colorWave: 'triangle',
    filter: 2300,
  }),
  grove: theme({
    root: 45,
    tempo: 74,
    scale: [0, 2, 3, 5, 7, 9, 10],
    chords: [
      [0, 3, 7, 10],
      [5, 9, 12, 15],
      [3, 7, 10, 14],
      [-2, 3, 7, 10],
    ],
    melody: [0, 2, null, 3, 4, null, 2, null, 1, 3, null, 5, null, 4, 2, null],
    bass: [0, 5, 3, -2],
    wave: 'triangle',
    colorWave: 'sine',
    filter: 980,
  }),
  tidal: theme({
    root: 47,
    tempo: 70,
    scale: [0, 2, 3, 5, 7, 9, 10],
    chords: [
      [0, 3, 7, 14],
      [-2, 3, 7, 10],
      [5, 9, 12, 17],
      [3, 7, 10, 15],
    ],
    melody: [3, null, 4, null, 2, 1, null, 3, 5, null, 4, 2, null, 0, null, 1],
    bass: [0, -2, 5, 3],
    wave: 'sine',
    colorWave: 'triangle',
    filter: 1350,
  }),
  volcano: theme({
    root: 43,
    tempo: 92,
    scale: [0, 1, 3, 5, 7, 8, 10],
    chords: [
      [0, 3, 7, 13],
      [1, 5, 8, 12],
      [-2, 3, 7, 10],
      [5, 8, 12, 15],
    ],
    melody: [0, null, 3, 2, null, 4, 3, null, 5, null, 4, 2, 1, null, 3, null],
    bass: [0, 1, -2, 5],
    wave: 'sawtooth',
    colorWave: 'triangle',
    filter: 820,
  }),
  astral: theme({
    root: 52,
    tempo: 78,
    scale: [0, 2, 4, 6, 7, 9, 11],
    chords: [
      [0, 4, 7, 11],
      [6, 9, 13, 16],
      [2, 6, 9, 14],
      [7, 11, 14, 18],
    ],
    melody: [5, null, 3, null, 4, 2, null, 1, 3, null, 6, null, 5, 4, null, 2],
    bass: [0, 6, 2, 7],
    wave: 'sine',
    colorWave: 'square',
    filter: 2650,
  }),
  eclipse: theme({
    root: 42,
    tempo: 86,
    scale: [0, 1, 3, 5, 6, 8, 10],
    chords: [
      [0, 3, 6, 10],
      [5, 8, 12, 15],
      [1, 6, 10, 13],
      [-2, 3, 6, 10],
    ],
    melody: [0, null, 4, 3, null, 1, 2, null, 5, null, 4, null, 2, 1, null, 3],
    bass: [0, 5, 1, -2],
    wave: 'triangle',
    colorWave: 'sawtooth',
    filter: 720,
  }),
  victory: theme({
    root: 55,
    tempo: 72,
    scale: [0, 2, 4, 7, 9, 11],
    chords: [
      [0, 4, 7, 11],
      [5, 9, 12, 16],
      [2, 7, 11, 14],
      [0, 4, 7, 14],
    ],
    melody: [0, 2, 4, null, 5, null, 4, 3, 2, null, 4, 5, null, 3, 2, 0],
    bass: [0, 5, 2, 0],
    wave: 'triangle',
    colorWave: 'sine',
    filter: 1900,
  }),
  defeat: theme({
    root: 45,
    tempo: 58,
    scale: [0, 2, 3, 5, 7, 8, 10],
    chords: [
      [0, 3, 7, 10],
      [-2, 3, 7, 10],
      [-4, 0, 3, 7],
      [-5, 0, 3, 7],
    ],
    melody: [5, null, 4, null, 3, null, 2, 1, null, 3, null, 2, 0, null, null, null],
    bass: [0, -2, -4, -5],
    wave: 'sine',
    colorWave: 'triangle',
    filter: 760,
  }),
});

export function resolveThemeId(screenId) {
  const id = String(screenId || 'title');
  if (id.startsWith('battle:')) {
    const arena = id.slice(7);
    return MUSIC_THEMES[arena] ? arena : 'crystal';
  }
  return SCREEN_THEME_MAP[id] || 'title';
}

export function computeMixerLevels(settings = {}) {
  const master = settings.muted ? 0 : 1;
  return Object.freeze({
    master,
    music: clamp01(settings.musicVolume, 0.45),
    sfx: clamp01(settings.sfxVolume, 0.8),
  });
}

export function calculateTension(state = {}) {
  const player = clamp01(state.playerHpRatio, 1);
  const enemy = clamp01(state.enemyHpRatio, 1);
  const turn = Number.isFinite(state.turn) ? Math.max(0, state.turn) : 0;
  const lowHealth = 1 - Math.min(player, enemy);
  const closeFight = 1 - Math.min(1, Math.abs(player - enemy) * 1.6);
  return clamp01(
    lowHealth * 0.48 + closeFight * 0.12 + Math.min(0.22, turn * 0.012) + (state.signatureReady ? 0.12 : 0)
  );
}

const midiToFrequency = (midi) => 440 * 2 ** ((midi - 69) / 12);

export class SoundSystem {
  constructor(settings, onFailure = () => {}) {
    this.settings = settings || {};
    this.onFailure = onFailure;
    this.ctx = null;
    this.graph = null;
    this.themeId = null;
    this.screenId = null;
    this.themeBus = null;
    this.tensionThemeBus = null;
    this.scheduler = 0;
    this.nextStepTime = 0;
    this.stepIndex = 0;
    this.tension = 0;
    this.hidden = Boolean(globalThis.document?.hidden);
    this.musicSources = new Set();
    this.sfxSources = new Set();
    this.noiseBuffers = new Map();
    this.failureNotified = false;
    this.suppressSfxUntil = 0;
    this.audioDebug = new URLSearchParams(globalThis.location?.search || '').get('audiodebug') === '1';
    this._nodeCount = this.audioDebug ? 0 : undefined;
    this._createdNodeCount = this.audioDebug ? 0 : undefined;
    this._disconnectedNodeCount = this.audioDebug ? 0 : undefined;
    this._trackedNodes = new Set();
    this._nodeUsers = new Map();
    if (this.audioDebug) globalThis.__NOAM_SOUND__ = this;
  }

  createNode(method, ...args) {
    const node = this.ctx[method](...args);
    if (this.audioDebug) {
      this._trackedNodes.add(node);
      this._nodeCount += 1;
      this._createdNodeCount += 1;
    }
    return node;
  }

  disconnectNode(node) {
    if (!node) return;
    try {
      node.disconnect?.();
    } catch {
      // A node may already be disconnected by the browser.
    }
    if (this.audioDebug && this._trackedNodes.delete(node)) {
      this._nodeCount -= 1;
      this._disconnectedNodeCount += 1;
    }
  }

  update(settings) {
    this.settings = settings || {};
    this.applyMixerLevels();
    if (!this.ctx) return;
    const levels = computeMixerLevels(this.settings);
    if (levels.master === 0 || levels.music === 0) {
      this.stopScheduler();
      this.cancelSources(this.musicSources);
    } else if (this.ctx.state === 'running' && !this.hidden) {
      this.startScheduler();
    }
  }

  async unlock() {
    if (this.hidden) return false;
    try {
      if (!this.ctx || this.ctx.state === 'closed') {
        const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Audio) throw new Error('Web Audio is unavailable');
        this.ctx = new Audio();
        this.buildGraph();
      }
      if (this.ctx.state !== 'running') await this.ctx.resume();
      if (this.ctx.state !== 'running') throw new Error('AudioContext did not resume');
      this.failureNotified = false;
      this.applyMixerLevels(true);
      this.startScheduler();
      return true;
    } catch {
      if (this.ctx && !this.graph) {
        this.ctx.close?.().catch?.(() => {});
        this.ctx = null;
      }
      if (!this.failureNotified) this.onFailure();
      this.failureNotified = true;
      return false;
    }
  }

  handleVisibility(hidden = globalThis.document?.hidden) {
    this.hidden = Boolean(hidden);
    if (!this.ctx) return;
    if (this.hidden) {
      this.stopScheduler();
      this.cancelSources(this.musicSources);
      this.ctx.suspend?.().catch?.(() => {});
    } else {
      void this.unlock();
    }
  }

  enabled() {
    const levels = computeMixerLevels(this.settings);
    return Boolean(
      this.ctx && this.ctx.state === 'running' && !this.hidden && levels.master > 0 && levels.sfx > 0
    );
  }

  buildGraph() {
    const ctx = this.ctx;
    const master = this.createNode('createGain');
    const compressor = this.createNode('createDynamicsCompressor');
    const musicLevel = this.createNode('createGain');
    const tensionLevel = this.createNode('createGain');
    const musicDuck = this.createNode('createGain');
    const sfxBus = this.createNode('createGain');
    const reverbIn = this.createNode('createGain');
    const convolver = this.createNode('createConvolver');
    const reverbReturn = this.createNode('createGain');

    compressor.threshold.setValueAtTime(-18, ctx.currentTime);
    compressor.knee.setValueAtTime(18, ctx.currentTime);
    compressor.ratio.setValueAtTime(4, ctx.currentTime);
    compressor.attack.setValueAtTime(0.008, ctx.currentTime);
    compressor.release.setValueAtTime(0.18, ctx.currentTime);
    convolver.buffer = this.createImpulse(1.7, 2.8);
    reverbIn.gain.setValueAtTime(1, ctx.currentTime);
    reverbReturn.gain.setValueAtTime(0.22, ctx.currentTime);

    musicLevel.connect(musicDuck);
    tensionLevel.connect(musicDuck);
    musicDuck.connect(master);
    sfxBus.connect(master);
    reverbIn.connect(convolver);
    convolver.connect(reverbReturn);
    reverbReturn.connect(master);
    master.connect(compressor);
    compressor.connect(ctx.destination);

    this.graph = {
      master,
      compressor,
      musicLevel,
      tensionLevel,
      musicDuck,
      sfxBus,
      reverbIn,
      convolver,
      reverbReturn,
    };
    musicDuck.gain.setValueAtTime(1, ctx.currentTime);
    this.createThemeBuses(false);
    this.applyMixerLevels(true);
  }

  createImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate || 44100;
    const buffer = this.ctx.createBuffer(2, Math.max(1, Math.floor(rate * seconds)), rate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      let seed = 0x91e10da5 ^ channel;
      for (let i = 0; i < data.length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        data[i] = (seed / 2147483647 - 1) * (1 - i / data.length) ** decay;
      }
    }
    return buffer;
  }

  applyMixerLevels(immediate = false) {
    if (!this.ctx || !this.graph) return;
    const now = this.ctx.currentTime;
    const levels = computeMixerLevels(this.settings);
    const set = (param, value) => {
      if (immediate) param.setValueAtTime(value, now);
      else param.setTargetAtTime(value, now, 0.035);
    };
    set(this.graph.master.gain, levels.master);
    set(this.graph.musicLevel.gain, levels.music);
    set(this.graph.sfxBus.gain, levels.sfx);
    set(this.graph.tensionLevel.gain, levels.music * this.tension * 0.34);
  }

  setScreen(screenId) {
    const nextTheme = resolveThemeId(screenId);
    const previousScreen = this.screenId;
    this.screenId = String(screenId || 'title');
    if (nextTheme === this.themeId) return false;
    const leavingBattle = previousScreen?.startsWith('battle:') && !this.screenId.startsWith('battle:');
    if (!this.screenId.startsWith('battle:')) this.tension = 0;
    this.themeId = nextTheme;
    this.stopScheduler();
    this.fadeThemeBuses();
    this.cancelSources(this.sfxSources);
    if (leavingBattle) this.suppressSfxUntil = Date.now() + 500;
    if (this.ctx && this.graph) this.createThemeBuses(true);
    this.applyMixerLevels();
    this.stepIndex = 0;
    this.nextStepTime = this.ctx ? this.ctx.currentTime + 0.05 : 0;
    this.startScheduler();
    return true;
  }

  setBattleState(state) {
    this.tension = calculateTension(state);
    this.applyMixerLevels();
  }

  duck(floor = 0.35, duration = 0.45) {
    if (!this.ctx || !this.graph) return;
    const now = this.ctx.currentTime;
    const gain = this.graph.musicDuck.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(Math.max(0.0001, gain.value), now);
    gain.setTargetAtTime(Math.max(0.02, clamp01(floor, 0.35)), now, 0.025);
    gain.setTargetAtTime(1, now + Math.max(0.04, duration), 0.12);
  }

  stopMusic() {
    this.stopScheduler();
    this.fadeThemeBuses();
    this.cancelSources(this.musicSources, 0.22);
    this.themeId = null;
    this.screenId = null;
  }

  createThemeBuses(fadeIn) {
    if (!this.ctx || !this.graph) return;
    const now = this.ctx.currentTime;
    this.themeBus = this.createNode('createGain');
    this.tensionThemeBus = this.createNode('createGain');
    this.themeBus.gain.setValueAtTime(fadeIn ? 0.0001 : 1, now);
    this.tensionThemeBus.gain.setValueAtTime(fadeIn ? 0.0001 : 1, now);
    if (fadeIn) {
      this.themeBus.gain.exponentialRampToValueAtTime(1, now + 0.42);
      this.tensionThemeBus.gain.exponentialRampToValueAtTime(1, now + 0.42);
    }
    this.themeBus.connect(this.graph.musicLevel);
    this.tensionThemeBus.connect(this.graph.tensionLevel);
  }

  fadeThemeBuses() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const fadingBuses = [this.themeBus, this.tensionThemeBus].filter(Boolean);
    for (const bus of fadingBuses) {
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), now);
      bus.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    }
    if (fadingBuses.length) {
      globalThis.setTimeout(() => {
        for (const bus of fadingBuses) this.disconnectNode(bus);
      }, 260);
    }
    this.cancelSources(this.musicSources, 0.24);
  }

  startScheduler() {
    const levels = computeMixerLevels(this.settings);
    if (
      this.scheduler ||
      !this.ctx ||
      this.ctx.state !== 'running' ||
      this.hidden ||
      levels.master === 0 ||
      levels.music === 0 ||
      !this.themeId
    )
      return;
    if (!this.nextStepTime || this.nextStepTime < this.ctx.currentTime)
      this.nextStepTime = this.ctx.currentTime + 0.05;
    this.scheduleAhead();
    this.scheduler = globalThis.setInterval(() => this.scheduleAhead(), SCHEDULER_INTERVAL_MS);
  }

  stopScheduler() {
    if (this.scheduler) globalThis.clearInterval(this.scheduler);
    this.scheduler = 0;
  }

  scheduleAhead() {
    if (!this.ctx || this.ctx.state !== 'running' || !this.themeId || this.hidden) return;
    const config = MUSIC_THEMES[this.themeId];
    const stepDuration = 60 / config.tempo / 4;
    while (this.nextStepTime < this.ctx.currentTime + SCHEDULER_HORIZON_SECONDS) {
      this.scheduleMusicStep(config, this.stepIndex, this.nextStepTime, stepDuration);
      this.nextStepTime += stepDuration;
      this.stepIndex += 1;
    }
  }

  scheduleMusicStep(config, step, time, stepDuration) {
    const position = step % 16;
    const bar = Math.floor(step / 16);
    const chordIndex = bar % config.chords.length;
    if (position === 0) {
      for (const semitone of config.chords[chordIndex])
        this.musicNote(midiToFrequency(config.root + semitone + 12), time, stepDuration * 14.5, {
          gain: 0.012,
          wave: config.wave,
          filter: config.filter,
          attack: Math.min(0.7, stepDuration * 2),
          reverb: 0.4,
        });
      this.musicNoise(time, stepDuration * 15.5, config.filter * 0.42);
    }
    if (position % 4 === 0) {
      const bassOffset = config.bass[chordIndex];
      const fifth = position === 12 ? 7 : 0;
      this.musicNote(midiToFrequency(config.root + bassOffset - 12 + fifth), time, stepDuration * 3.25, {
        gain: 0.033,
        wave: 'triangle',
        filter: 420,
        attack: 0.025,
        reverb: 0.08,
      });
    }
    if (position % 2 === 0) {
      const melodyIndex = config.melody[(bar * 8 + position / 2) % config.melody.length];
      if (melodyIndex !== null) {
        const octave = melodyIndex >= 5 ? 12 : 0;
        const semitone = config.scale[melodyIndex % config.scale.length];
        this.musicNote(midiToFrequency(config.root + semitone + 12 + octave), time, stepDuration * 1.55, {
          gain: 0.021,
          wave: config.colorWave,
          filter: config.filter * 1.25,
          attack: 0.035,
          reverb: 0.32,
        });
      }
    }
    if (position % 4 === 2 || (this.tension > 0.62 && position % 2 === 1)) {
      const accent = position % 4 === 2 ? 1 : 1.5;
      this.musicNote(midiToFrequency(config.root + 24) * accent, time, stepDuration * 0.42, {
        gain: 0.026,
        wave: 'triangle',
        filter: 1150,
        attack: 0.006,
        reverb: 0.12,
        tension: true,
      });
    }
  }

  musicNote(freq, time, duration, options) {
    if (!this.ctx || !this.themeBus) return;
    const oscillator = this.createNode('createOscillator');
    const filter = this.createNode('createBiquadFilter');
    const gain = this.createNode('createGain');
    const attack = Math.max(0.005, Math.min(duration * 0.45, options.attack));
    const end = time + duration;
    oscillator.type = options.wave;
    oscillator.frequency.setValueAtTime(Math.max(28, freq), time);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.max(180, options.filter), time);
    filter.Q.setValueAtTime(0.7, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(options.gain, time + attack);
    gain.gain.setValueAtTime(options.gain, Math.max(time + attack, end - Math.min(0.7, duration * 0.45)));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(filter).connect(gain);
    gain.connect(options.tension ? this.tensionThemeBus : this.themeBus);
    const send = this.createNode('createGain');
    send.gain.setValueAtTime(options.reverb, time);
    gain.connect(send).connect(this.graph.reverbIn);
    this.trackSource(oscillator, this.musicSources, [oscillator, filter, gain, send]);
    oscillator.start(time);
    oscillator.stop(end + 0.02);
  }

  musicNoise(time, duration, cutoff) {
    if (!this.ctx || !this.themeBus) return;
    const source = this.createNode('createBufferSource');
    const filter = this.createNode('createBiquadFilter');
    const gain = this.createNode('createGain');
    source.buffer = this.getNoiseBuffer('ambience', 2);
    source.loop = true;
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(Math.max(160, cutoff), time);
    filter.Q.setValueAtTime(0.55, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.008, time + Math.min(0.8, duration * 0.25));
    gain.gain.setValueAtTime(0.008, time + duration * 0.66);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter).connect(gain);
    gain.connect(this.themeBus);
    const send = this.createNode('createGain');
    send.gain.setValueAtTime(0.48, time);
    gain.connect(send).connect(this.graph.reverbIn);
    this.trackSource(source, this.musicSources, [source, filter, gain, send]);
    source.start(time);
    source.stop(time + duration + 0.02);
  }

  canPlaySfx() {
    return this.enabled() && Date.now() >= this.suppressSfxUntil;
  }

  patch(options = {}) {
    if (!this.canPlaySfx()) return;
    const ctx = this.ctx;
    const start = ctx.currentTime + Math.max(0, options.delay || 0);
    const duration = Math.max(0.025, options.duration || 0.16);
    const end = start + duration;
    const output = this.createNode('createGain');
    output.gain.setValueAtTime(1, start);
    output.connect(this.graph.sfxBus);
    const send = this.createNode('createGain');
    send.gain.setValueAtTime(clamp01(options.reverb, 0.18), start);
    output.connect(send).connect(this.graph.reverbIn);

    const body = this.createNode('createOscillator');
    const bodyFilter = this.createNode('createBiquadFilter');
    const bodyGain = this.createNode('createGain');
    const frequency = Math.max(30, options.freq || 260);
    body.type = options.wave || 'triangle';
    body.frequency.setValueAtTime(frequency, start);
    if (options.endFreq) body.frequency.exponentialRampToValueAtTime(Math.max(30, options.endFreq), end);
    bodyFilter.type = options.filterType || 'lowpass';
    bodyFilter.frequency.setValueAtTime(Math.max(100, options.filterStart || frequency * 4), start);
    bodyFilter.frequency.exponentialRampToValueAtTime(
      Math.max(100, options.filterEnd || frequency * 1.5),
      end
    );
    bodyFilter.Q.setValueAtTime(options.q || 1.1, start);
    this.envelope(bodyGain.gain, start, end, options.gain || 0.05, options.attack || 0.008);
    body.connect(bodyFilter).connect(bodyGain).connect(output);
    this.trackSource(body, this.sfxSources, [body, bodyFilter, bodyGain, output, send]);
    body.start(start);
    body.stop(end + 0.02);

    const transient = this.createNode('createOscillator');
    const transientGain = this.createNode('createGain');
    const transientEnd = start + Math.min(duration * 0.32, 0.055);
    transient.type = options.transientWave || 'sine';
    transient.frequency.setValueAtTime(Math.max(40, options.transientFreq || frequency * 2.4), start);
    transient.frequency.exponentialRampToValueAtTime(Math.max(35, frequency * 0.8), transientEnd);
    this.envelope(transientGain.gain, start, transientEnd, options.transientGain || 0.018, 0.002);
    transient.connect(transientGain).connect(output);
    this.trackSource(transient, this.sfxSources, [transient, transientGain, output, send]);
    transient.start(start);
    transient.stop(transientEnd + 0.01);

    if ((options.noiseGain ?? 0.018) > 0) {
      const noise = this.createNode('createBufferSource');
      const noiseFilter = this.createNode('createBiquadFilter');
      const noiseGain = this.createNode('createGain');
      const noiseDuration = Math.min(duration, options.noiseDuration || 0.11);
      noise.buffer = this.getNoiseBuffer(options.seed || 'patch', noiseDuration);
      noiseFilter.type = options.noiseType || 'bandpass';
      noiseFilter.frequency.setValueAtTime(options.noiseFreq || 1200, start);
      noiseFilter.Q.setValueAtTime(options.noiseQ || 0.8, start);
      this.envelope(noiseGain.gain, start, start + noiseDuration, options.noiseGain ?? 0.018, 0.002);
      noise.connect(noiseFilter).connect(noiseGain).connect(output);
      this.trackSource(noise, this.sfxSources, [noise, noiseFilter, noiseGain, output, send]);
      noise.start(start);
      noise.stop(start + noiseDuration + 0.01);
    }
  }

  envelope(param, start, end, peak, attack) {
    param.setValueAtTime(0.0001, start);
    param.exponentialRampToValueAtTime(Math.max(0.0001, peak), start + Math.min(attack, (end - start) / 2));
    param.exponentialRampToValueAtTime(0.0001, end);
  }

  getNoiseBuffer(seedValue, duration) {
    const length = Math.max(1, Math.floor((this.ctx.sampleRate || 44100) * duration));
    const key = `${seedValue}:${length}`;
    if (this.noiseBuffers.has(key)) return this.noiseBuffers.get(key);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate || 44100);
    const data = buffer.getChannelData(0);
    let value = this.hash(seedValue) || 1;
    for (let i = 0; i < length; i++) {
      value = (value * 1664525 + 1013904223) >>> 0;
      data[i] = value / 2147483647 - 1;
    }
    this.noiseBuffers.set(key, buffer);
    return buffer;
  }

  trackSource(source, collection, chain = [source]) {
    const nodes = [...new Set(chain)];
    for (const node of nodes) this._nodeUsers.set(node, (this._nodeUsers.get(node) || 0) + 1);
    collection.add(source);
    let released = false;
    source.addEventListener?.(
      'ended',
      () => {
        if (released) return;
        released = true;
        collection.delete(source);
        for (const node of nodes) {
          const users = this._nodeUsers.get(node) || 0;
          if (users > 1) this._nodeUsers.set(node, users - 1);
          else {
            this._nodeUsers.delete(node);
            this.disconnectNode(node);
          }
        }
      },
      { once: true }
    );
  }

  cancelSources(collection, delay = 0) {
    const stopAt = this.ctx ? this.ctx.currentTime + delay : 0;
    for (const source of collection) {
      try {
        source.stop(stopAt);
      } catch {
        // A source that naturally ended between ticks is already harmless.
      }
    }
    collection.clear();
  }

  tone(freq = 320, duration = 0.12, wave = 'sine', gain = 0.05, delay = 0, endFreq = 0) {
    this.patch({ freq, duration, wave, gain, delay, endFreq, noiseGain: 0.006, reverb: 0.12 });
  }

  noise(seed = 'impact', duration = 0.1, gain = 0.025, delay = 0, frequency = 1200) {
    this.patch({
      seed,
      freq: Math.max(45, frequency * 0.12),
      duration,
      gain: gain * 0.35,
      delay,
      noiseGain: gain,
      noiseFreq: frequency,
      reverb: 0.16,
    });
  }

  ui() {
    this.patch({
      freq: 520,
      endFreq: 690,
      duration: 0.075,
      wave: 'sine',
      gain: 0.026,
      noiseGain: 0.004,
      filterStart: 2100,
      reverb: 0.08,
    });
  }

  hit(affinity = 'neutral') {
    const freq =
      { mind: 560, force: 145, tide: 330, flame: 210, grove: 420, shadow: 105, neutral: 270 }[affinity] ||
      270;
    this.patch({
      seed: `hit:${affinity}`,
      freq,
      endFreq: Math.max(38, freq * 0.58),
      duration: 0.17,
      wave: affinity === 'mind' ? 'sine' : 'sawtooth',
      gain: 0.055,
      noiseGain: 0.026,
      noiseFreq: affinity === 'force' ? 620 : 1450,
      reverb: 0.18,
    });
  }

  guard() {
    this.patch({
      seed: 'guard',
      freq: 245,
      endFreq: 390,
      duration: 0.25,
      wave: 'sine',
      gain: 0.05,
      noiseGain: 0.014,
      noiseFreq: 2400,
      filterStart: 900,
      filterEnd: 2800,
      reverb: 0.34,
    });
    this.patch({
      seed: 'guard-ring',
      freq: 490,
      endFreq: 330,
      duration: 0.2,
      wave: 'triangle',
      gain: 0.025,
      delay: 0.035,
      noiseGain: 0,
      reverb: 0.4,
    });
  }

  shatter() {
    this.patch({
      seed: 'shatter',
      freq: 1180,
      endFreq: 390,
      duration: 0.24,
      wave: 'square',
      gain: 0.036,
      noiseGain: 0.052,
      noiseFreq: 3600,
      noiseDuration: 0.18,
      filterStart: 4600,
      filterEnd: 750,
      reverb: 0.3,
    });
    this.patch({
      seed: 'shatter-tinkle',
      freq: 2350,
      endFreq: 1560,
      duration: 0.16,
      wave: 'sine',
      gain: 0.02,
      delay: 0.05,
      noiseGain: 0.02,
      noiseFreq: 5200,
      reverb: 0.42,
    });
  }

  heal() {
    [330, 440, 550].forEach((freq, index) =>
      this.patch({
        seed: `heal:${index}`,
        freq,
        endFreq: freq * 1.16,
        duration: 0.28,
        wave: 'sine',
        gain: 0.028,
        delay: index * 0.065,
        noiseGain: 0.005,
        noiseFreq: 2800,
        reverb: 0.48,
      })
    );
  }

  ko() {
    this.duck(0.22, 0.65);
    this.patch({
      seed: 'ko',
      freq: 175,
      endFreq: 48,
      duration: 0.52,
      wave: 'sawtooth',
      gain: 0.068,
      noiseGain: 0.042,
      noiseFreq: 460,
      noiseDuration: 0.28,
      filterStart: 900,
      filterEnd: 180,
      reverb: 0.3,
    });
    this.patch({
      seed: 'ko-sub',
      freq: 92,
      endFreq: 42,
      duration: 0.58,
      wave: 'sine',
      gain: 0.048,
      delay: 0.08,
      noiseGain: 0,
      reverb: 0.22,
    });
  }

  victory() {
    this.duck(0.25, 0.75);
    [392, 494, 587, 784].forEach((freq, index) =>
      this.patch({
        seed: `victory:${index}`,
        freq,
        endFreq: freq * 1.04,
        duration: 0.38,
        wave: 'triangle',
        gain: 0.038,
        delay: index * 0.105,
        noiseGain: index === 3 ? 0.01 : 0.003,
        noiseFreq: 2600,
        reverb: 0.42,
      })
    );
  }

  defeat() {
    this.duck(0.18, 0.9);
    [392, 330, 262, 196].forEach((freq, index) =>
      this.patch({
        seed: `defeat:${index}`,
        freq,
        endFreq: freq * 0.91,
        duration: 0.46,
        wave: 'sine',
        gain: 0.034,
        delay: index * 0.13,
        noiseGain: index === 3 ? 0.012 : 0.002,
        noiseFreq: 520,
        reverb: 0.5,
      })
    );
  }

  hash(value) {
    return [...String(value)].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 7);
  }

  call(id, { fall = false } = {}) {
    const families = { orakyn: 610, kordane: 180, farfombre: 420, abyssar: 118, calderoc: 150, virelia: 510 };
    const seed = this.hash(id);
    const freq = families[id] || 180 + (seed % 470);
    const waves = ['triangle', 'sine', 'square', 'sawtooth'];
    this.patch({
      seed: `call:${id}${fall ? ':fall' : ''}`,
      freq,
      endFreq: fall ? freq * 0.52 : freq * (1.08 + (seed % 4) * 0.025),
      duration: fall ? 0.48 : 0.22,
      wave: waves[seed % 4],
      gain: fall ? 0.038 : 0.043,
      noiseGain: 0.009 + (seed % 4) * 0.003,
      noiseFreq: 700 + (seed % 7) * 240,
      reverb: 0.38,
    });
    this.patch({
      seed: `call:${id}:answer${fall ? ':fall' : ''}`,
      freq: fall ? freq * 0.72 : freq * (1.25 + (seed % 5) * 0.04),
      endFreq: fall ? freq * 0.38 : freq * 0.92,
      duration: fall ? 0.55 : 0.25,
      wave: waves[(seed + 1) % 4],
      gain: fall ? 0.022 : 0.026,
      delay: fall ? 0.1 : 0.065,
      noiseGain: 0.004,
      reverb: 0.44,
    });
  }

  move(move) {
    if (!move) return;
    const affinityBase = {
      mind: 520,
      force: 165,
      tide: 285,
      flame: 155,
      grove: 425,
      shadow: 190,
      neutral: 335,
    };
    const seed = this.hash(move.visual || move.id);
    const freq = (affinityBase[move.affinity] || 335) + (seed % 110);
    const waves = ['sine', 'triangle', 'square', 'sawtooth'];
    if (move.signature) {
      this.duck(0.28, 0.6);
      [0.5, 0.75, 1, 1.5, 2].forEach((ratio, index) =>
        this.patch({
          seed: `${seed}:signature:${index}`,
          freq: freq * ratio,
          endFreq: freq * ratio * 1.18,
          duration: 0.4 - index * 0.025,
          wave: waves[(seed + index) % 4],
          gain: 0.029 + (index === 2 ? 0.018 : 0),
          delay: index * 0.052,
          noiseGain: index === 0 ? 0.018 : 0.004,
          noiseFreq: 800 + index * 430,
          reverb: 0.4,
        })
      );
      return;
    }
    if ((move.hits || 1) > 1) {
      for (let index = 0; index < move.hits; index++)
        this.patch({
          seed: `${seed}:multi:${index}`,
          freq: freq * (1 + index * 0.12),
          endFreq: freq * (1.3 + index * 0.12),
          duration: 0.105,
          wave: waves[seed % 4],
          gain: 0.034,
          delay: index * 0.052,
          noiseGain: 0.012,
          noiseFreq: 1100 + index * 220,
          reverb: 0.16,
        });
      return;
    }
    if (move.kind === 'heal') {
      this.heal();
      return;
    }
    const support = move.kind !== 'damage';
    this.patch({
      seed: `${seed}:move`,
      freq,
      endFreq: freq * (support ? 1.35 : move.priority > 0 ? 1.6 : 0.68),
      duration: support ? 0.28 : 0.18,
      wave: waves[seed % 4],
      gain: support ? 0.034 : 0.047,
      noiseGain: support ? 0.007 : 0.018,
      noiseFreq: support ? 2300 : 1050,
      filterStart: freq * 5,
      filterEnd: support ? freq * 7 : freq * 1.3,
      reverb: support ? 0.42 : 0.2,
    });
  }

  impact(move, event = {}) {
    if (!move) {
      this.hit(event.moveAffinity);
      return;
    }
    const seed = this.hash(`${move.visual || move.id}:${event.hit || 1}`);
    if (event.hp <= 0) {
      this.finisher(move.affinity, seed);
      return;
    }
    const base =
      { mind: 235, force: 92, tide: 160, flame: 112, grove: 145, shadow: 72, neutral: 126 }[move.affinity] ||
      126;
    const heavy = (move.power || 0) >= 42 || move.signature;
    const multiIndex = Math.max(0, (event.hit || 1) - 1);
    const multiplier = event.affinity > 1 ? 1.3 : event.affinity < 1 ? 0.72 : 1;
    this.patch({
      seed: `${seed}:impact`,
      freq: (base + multiIndex * 38) * multiplier,
      endFreq: Math.max(38, base * (heavy ? 0.34 : 0.62)),
      duration: heavy ? 0.29 : 0.14,
      wave: heavy ? 'sawtooth' : 'triangle',
      gain: heavy ? 0.068 : 0.044,
      noiseGain: heavy ? 0.046 : 0.028,
      noiseFreq: heavy ? 650 : 1380 + multiIndex * 180,
      noiseDuration: heavy ? 0.2 : 0.085,
      filterStart: heavy ? 1300 : 2100,
      filterEnd: 280,
      reverb: heavy ? 0.3 : 0.14,
    });
    if (event.combo)
      this.patch({
        seed: `${seed}:spark`,
        freq: base * 3.4,
        endFreq: base * 0.82,
        duration: 0.22,
        wave: 'square',
        gain: 0.028,
        delay: 0.025,
        noiseGain: 0.02,
        noiseFreq: 2300,
        reverb: 0.34,
      });
  }

  comboCredit(affinity = 'neutral') {
    const freq =
      { mind: 590, force: 255, tide: 405, flame: 325, grove: 515, shadow: 215, neutral: 435 }[affinity] ||
      435;
    [1, 1.26, 1.68].forEach((ratio, index) =>
      this.patch({
        seed: `combo-credit:${affinity}:${index}`,
        freq: freq * ratio,
        endFreq: freq * ratio * 1.1,
        duration: 0.2,
        wave: 'triangle',
        gain: 0.026,
        delay: index * 0.045,
        noiseGain: 0.004,
        noiseFreq: 1850,
        reverb: 0.4,
      })
    );
  }

  clash() {
    this.duck(0.2, 0.5);
    this.patch({
      seed: 'signature-clash',
      freq: 88,
      endFreq: 280,
      duration: 0.56,
      wave: 'sawtooth',
      gain: 0.072,
      noiseGain: 0.052,
      noiseFreq: 980,
      noiseDuration: 0.32,
      filterStart: 500,
      filterEnd: 1800,
      reverb: 0.28,
    });
    this.patch({
      seed: 'signature-clash-high',
      freq: 940,
      endFreq: 118,
      duration: 0.42,
      wave: 'square',
      gain: 0.032,
      delay: 0.1,
      noiseGain: 0.014,
      noiseFreq: 3400,
      reverb: 0.38,
    });
  }

  finisher(affinity = 'neutral', seed = 7) {
    this.duck(0.12, 0.78);
    const base =
      { mind: 150, force: 82, tide: 120, flame: 95, grove: 110, shadow: 62, neutral: 100 }[affinity] || 100;
    this.patch({
      seed: `${seed}:finisher`,
      freq: base * 3.4,
      endFreq: base * 0.44,
      duration: 0.5,
      wave: 'sawtooth',
      gain: 0.078,
      noiseGain: 0.058,
      noiseFreq: 610,
      noiseDuration: 0.4,
      filterStart: 1800,
      filterEnd: 180,
      reverb: 0.34,
    });
    this.patch({
      seed: `${seed}:finisher-sub`,
      freq: base,
      endFreq: 38,
      duration: 0.56,
      wave: 'sine',
      gain: 0.058,
      delay: 0.04,
      noiseGain: 0,
      reverb: 0.24,
    });
  }
}
