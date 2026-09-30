import { STATUS_DEFINITIONS } from './battle/statuses.js';
import { fxRandom, fxSeed } from './battle-ui/beats.js';

const clamp01 = (value, fallback = 0) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;

export const SCHEDULER_INTERVAL_MS = 25;
// Music lookahead (not SFX latency): long enough to ride out a ~250 ms main-thread stall.
// This is the default; the low quality tier stretches it with setQuality().
export const SCHEDULER_HORIZON_SECONDS = 0.25;
// A step later than this is dropped (the grid jumps to the next boundary) instead of firing a
// burst of past notes; a step late by less starts at `currentTime` with its full envelope.
export const SCHEDULER_STALE_SECONDS = 0.03;

// Gain staging for phone speakers at factory sliders (music 0.45, SFX 0.8): the music bed sits
// around −22 LUFS and important cues 6–10 dB above it. Trims multiply the slider value, so the
// sliders keep their full range and zero is still silence. Reverb returns sit inside each
// category chain, after the category level/duck, so every control owns its wet signal too.
const MUSIC_TRIM = 4.2;
const SFX_TRIM = 9.75;
const MUSIC_REVERB_SECONDS = 1.7;
const MUSIC_REVERB_RETURN = 0.5;
const SFX_ROOM_SECONDS = 0.55;
// Low quality tier: shorter mono impulses. A mono voice then costs one convolution instead of
// two, and the shorter tail shrinks the convolver's FFT work.
const MUSIC_REVERB_LITE_SECONDS = 0.8;
const SFX_ROOM_LITE_SECONDS = 0.35;
const SFX_ROOM_RETURN = 0.45;
// Safety limiter. A DynamicsCompressorNode adds makeup gain (fullRangeGain^-0.6, Web Audio
// spec), so the trim in front of it cancels that: unity below the threshold. The threshold
// leaves room for the attack overshoot of sharp transients, so measured cue pile-ups stay
// under −1 dBFS true peak (agents/impl/3E renders).
const LIMITER_THRESHOLD_DB = -6;
const LIMITER_RATIO = 20;
const LIMITER_TRIM = 10 ** ((0.6 * LIMITER_THRESHOLD_DB * (1 - 1 / LIMITER_RATIO)) / 20);
const TENSION_LEVEL = 0.34;
const TENSION_REVERB_SEND = 0.12;
// Adaptive music hysteresis: the presented state must move the tension by this much before the
// layer follows, and it then glides over seconds, so one hit never pumps the score.
const TENSION_DEADBAND = 0.08;
const TENSION_GLIDE_SECONDS = 1.2;
// One soft threshold cue when the player's creature drops under 25 % HP; it re-arms above 35 %
// or when another creature comes in. No alarm loop.
const LOW_HP_ENTER = 0.25;
const LOW_HP_RESET = 0.35;
const SFX_SESSION_FADE_SECONDS = 0.03;
const RESULT_SCREENS = new Set(['victory', 'defeat', 'results']);

// Battle cue hierarchy (docs/battle-presentation.md §12): one dominant cue per `payload.beat`.
// Impact / Signature / K.O. > identity (cries) > utility (move gestures, status, heal, break) >
// UI. A lower cue that lands while the beat's dominant cue still sounds is ducked for the
// overlap (UI is dropped); a higher cue ducks the lower voices already sounding. Nothing is
// ever delayed.
const CUE_RANK = Object.freeze({ ui: 0, utility: 1, identity: 2, impact: 3 });
const CUE_CLASS = Object.freeze({
  windup: 'utility',
  release: 'utility',
  contact: 'impact',
  readout: 'utility',
  critical: 'impact',
  effective: 'impact',
  resisted: 'impact',
  miss: 'impact',
  blocked: 'impact',
  'status+': 'utility',
  'status-': 'utility',
  heal: 'utility',
  break: 'utility',
  ko: 'impact',
  'faint-cry': 'identity',
  'switch-out': 'ui',
  'switch-in': 'identity',
  'signature-ready': 'utility',
  'signature-cutin': 'impact',
  victory: 'impact',
  defeat: 'impact',
});
const DUCK_GAIN = 0.4;
const STAMP_CUES = new Set(['critical', 'effective', 'resisted', 'blocked']);
// Shared seeded noise/grain buffers; voices start at deterministic offsets inside them.
const NOISE_SECONDS = 0.6;

// Six authored material families replace hash-derived chirps (AUD-03). Each keeps a little low
// body for headphones, but its identity lives in the 0.7–3 kHz band a phone speaker plays.
const MATERIAL_FAMILIES = Object.freeze({
  tide: 'eau',
  flame: 'feu',
  grove: 'plante',
  mind: 'psy',
  force: 'combat',
  shadow: 'tenebres',
});
const PHYSICAL_ARCHETYPES = new Set(['DASH', 'SLASH', 'QUAKE']);
const SUPPORT_ARCHETYPES = new Set(['GUARD', 'BOOST', 'HEAL', 'RELAY']);
// Centre of each family's "charge" colour (windup and energy release).
const FAMILY_COLOUR_HZ = Object.freeze({
  eau: 1400,
  feu: 900,
  plante: 2200,
  psy: 1800,
  combat: 1100,
  tenebres: 1600,
  neutre: 1500,
});
// Original 3-note Signature motif (rising fifth, then a whole step): A5 E6 F♯6.
const SIGNATURE_MOTIF_HZ = Object.freeze([880, 1318.5, 1480]);

// ×2 and hold-to-hurry play trimmed variants: shorter tails and tighter layer spacing at the
// same pitch (never a faster playback rate, so cries are never chipmunked).
function cueTrim(speed) {
  if (!(speed >= 2)) return 1;
  return speed >= 3 ? 0.5 : 0.65;
}

function materialFamily(affinity) {
  return Object.hasOwn(MATERIAL_FAMILIES, affinity) ? MATERIAL_FAMILIES[affinity] : 'neutre';
}

// `status+` / `status-` group statuses by benefit for the creature (director contract): a
// `status+` of malus ids is a cleanse, a `status-` of boon ids a boon stripped away.
const statusPolarity = (ids) => {
  const known = (Array.isArray(ids) ? ids : []).filter((id) => STATUS_DEFINITIONS[id]);
  return known.length && known.every((id) => STATUS_DEFINITIONS[id].positive) ? 'positive' : 'negative';
};

// A burn tick is the main event of its chip beat; other readouts are utility. Unknown → null.
const cueTier = (name, payload) => {
  if (!Object.hasOwn(CUE_CLASS, name)) return null;
  return name === 'readout' && payload.kind === 'tick' ? 'impact' : CUE_CLASS[name];
};

// Cues that sound once per beat: a stamp rides on the contact that already carried its accent,
// one heal gesture covers every ally it reaches, one chip row per polarity and creature.
function cueKey(name, payload) {
  if (name === 'blocked') return 'blocked';
  if (STAMP_CUES.has(name)) return 'accent';
  if (name === 'heal' || (name === 'readout' && payload.kind === 'heal')) return 'heal';
  if (name === 'readout') return `readout:${payload.kind}`;
  if (name === 'status+' || name === 'status-') return `${name}:${payload.side}:${payload.creatureId}`;
  if (name === 'signature-ready') return `ready:${payload.side}`;
  if (name === 'break') return `break:${payload.side}:${payload.creatureId}`;
  return null;
}

// Room send per cue: dry, close impacts; airy rewards; the motif and cries a little wider.
const CUE_REVERB = Object.freeze({
  windup: 0.12,
  release: 0.16,
  contact: 0.16,
  readout: 0.2,
  critical: 0.2,
  effective: 0.2,
  resisted: 0.12,
  miss: 0.18,
  blocked: 0.16,
  'status+': 0.32,
  'status-': 0.24,
  heal: 0.45,
  break: 0.3,
  ko: 0.3,
  'faint-cry': 0.4,
  'switch-out': 0.18,
  'switch-in': 0.36,
  'signature-ready': 0.4,
  'signature-cutin': 0.32,
  victory: 0.4,
  defeat: 0.45,
});
const MATERIAL_CUES = new Set(['windup', 'release', 'contact']);
// A resisted hit plays its material through this low-pass: same family, audibly damped.
const RESISTED_LOWPASS_HZ = 1600;
const CRY_FLOOR_HZ = 300;
const CRY_PITCH_HZ = Object.freeze({
  orakyn: 610,
  kordane: 180,
  farfombre: 420,
  abyssar: 118,
  calderoc: 150,
  virelia: 510,
});
const CRY_WAVES = Object.freeze(['triangle', 'square', 'sawtooth', 'triangle']);

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

// `level` is an optional per-theme loudness trim (mastering): the darker, low-pass-heavy arenas
// measure several LU quieter than the rest at the same voice gains.
const theme = (config) =>
  Object.freeze({
    level: 1,
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
    level: 1.1,
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
    level: 1.35,
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
    level: 1.26,
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

// Reads the presented battle view (`session.displayState ?? session.state`) into the inputs of
// calculateTension plus the player's active creature, for the low-HP threshold cue.
function battleMetrics(view) {
  const player = view?.sides?.player,
    enemy = view?.sides?.enemy,
    playerActive = player?.team?.[player.active],
    enemyActive = enemy?.team?.[enemy.active];
  if (!playerActive || !enemyActive) return null;
  const ratio = (creature) => (creature.maxHp > 0 ? creature.hp / creature.maxHp : 0);
  return {
    playerHpRatio: ratio(playerActive),
    enemyHpRatio: ratio(enemyActive),
    turn: view.turn,
    signatureReady: player.surge >= 100,
    playerActiveId: playerActive.id,
  };
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
    this.themeWetBus = null;
    this.tensionThemeBus = null;
    this.scheduler = 0;
    this.nextStepTime = 0;
    this.stepIndex = 0;
    this.tension = 0;
    this.hidden = Boolean(globalThis.document?.hidden);
    this.musicSources = new Set();
    // SFX belong to the screen session that requested them (see openSfxSession); leaving the
    // screen fades that session's buses and stops its sources, including audio-clock-scheduled
    // future layers, while cues the new screen requests afterwards start a fresh session.
    this.sfxSession = null;
    this.sfxSources = new Set();
    // Arriving at results from gameplay arms exactly one sting; a settings detour does not.
    this.stingArmed = false;
    this.noiseBuffers = new Map();
    // Per-beat cue arbitration (see cue()) and the presented-state trackers of setBattleState.
    this.cueBeat = null;
    this.lowHp = null;
    this.failureNotified = false;
    // Quality-tier budget (see src/app/quality.js); the defaults are the mid/high costs.
    this.horizon = SCHEDULER_HORIZON_SECONDS;
    this.reverb = 'full';
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

  // Tier hook: `horizon` is the music lookahead in seconds, `reverb` is 'full' or 'lite'.
  // Swapping an impulse on the live convolvers keeps every routing connection in place.
  setQuality({ horizon, reverb }) {
    this.horizon = horizon;
    if (reverb === this.reverb) return;
    this.reverb = reverb;
    if (!this.graph) return;
    this.graph.musicReverb.buffer = this.musicImpulse();
    this.graph.sfxRoom.buffer = this.roomImpulse();
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
      // Stale hits/cries must not resume mid-attack: drop the SFX session and the room's tail.
      this.closeSfxSession(0);
      this.resetSfxRoom();
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

  // Music: voices → theme bus (per-theme fade) → musicLevel → musicDuck → master, and voice
  // sends → theme wet bus (same fade) → hall → return → musicLevel. The tension layer runs
  // tension theme bus → tensionLevel → musicLevel, with one fixed send into the hall.
  // SFX: cue voices → cue bus → session dry bus → sfxLevel → master, and cue sends → session
  // wet bus → high-passed short room → return → sfxLevel. Sliders, theme fades, tension and ducking
  // therefore scale the wet signal exactly like the dry one. The master ends in the bus
  // compressor then a safety limiter, so pile-ups of cues stay under −1 dBFS true peak.
  buildGraph() {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const master = this.createNode('createGain');
    const compressor = this.createNode('createDynamicsCompressor');
    const limiterTrim = this.createNode('createGain');
    const limiter = this.createNode('createDynamicsCompressor');
    const musicLevel = this.createNode('createGain');
    const tensionLevel = this.createNode('createGain');
    const tensionSend = this.createNode('createGain');
    const musicDuck = this.createNode('createGain');
    const musicReverb = this.createNode('createConvolver');
    const musicReturn = this.createNode('createGain');
    const sfxLevel = this.createNode('createGain');
    const sfxRoomFilter = this.createNode('createBiquadFilter');
    const sfxRoom = this.createNode('createConvolver');
    const sfxReturn = this.createNode('createGain');

    compressor.threshold.setValueAtTime(-14, now);
    compressor.knee.setValueAtTime(10, now);
    compressor.ratio.setValueAtTime(3.5, now);
    compressor.attack.setValueAtTime(0.004, now);
    compressor.release.setValueAtTime(0.2, now);
    limiterTrim.gain.setValueAtTime(LIMITER_TRIM, now);
    limiter.threshold.setValueAtTime(LIMITER_THRESHOLD_DB, now);
    limiter.knee.setValueAtTime(0, now);
    limiter.ratio.setValueAtTime(LIMITER_RATIO, now);
    limiter.attack.setValueAtTime(0.001, now);
    limiter.release.setValueAtTime(0.08, now);
    musicReverb.buffer = this.musicImpulse();
    musicReturn.gain.setValueAtTime(MUSIC_REVERB_RETURN, now);
    tensionSend.gain.setValueAtTime(TENSION_REVERB_SEND, now);
    sfxRoomFilter.type = 'highpass';
    sfxRoomFilter.frequency.setValueAtTime(220, now);
    sfxRoomFilter.Q.setValueAtTime(0.6, now);
    sfxRoom.buffer = this.roomImpulse();
    sfxReturn.gain.setValueAtTime(SFX_ROOM_RETURN, now);
    musicDuck.gain.setValueAtTime(1, now);

    tensionLevel.connect(musicLevel);
    tensionLevel.connect(tensionSend).connect(musicReverb);
    musicReverb.connect(musicReturn).connect(musicLevel);
    musicLevel.connect(musicDuck).connect(master);
    sfxRoomFilter.connect(sfxRoom).connect(sfxReturn).connect(sfxLevel);
    sfxLevel.connect(master);
    master.connect(compressor).connect(limiterTrim).connect(limiter).connect(ctx.destination);

    this.graph = {
      master,
      compressor,
      musicLevel,
      tensionLevel,
      musicDuck,
      musicReverb,
      musicReturn,
      sfxLevel,
      sfxRoomFilter,
      sfxRoom,
      sfxReturn,
    };
    this.createThemeBuses(false);
    this.applyMixerLevels(true);
  }

  // Swaps in a fresh room so a suspended context cannot resume the previous hits' reverb tail.
  resetSfxRoom() {
    if (!this.graph) return;
    const { sfxRoomFilter, sfxRoom, sfxReturn } = this.graph;
    const room = this.createNode('createConvolver');
    room.buffer = sfxRoom.buffer;
    sfxRoomFilter.disconnect();
    this.disconnectNode(sfxRoom);
    sfxRoomFilter.connect(room).connect(sfxReturn);
    this.graph.sfxRoom = room;
  }

  musicImpulse() {
    const lite = this.reverb === 'lite';
    return this.createImpulse(lite ? MUSIC_REVERB_LITE_SECONDS : MUSIC_REVERB_SECONDS, 2.8, lite ? 1 : 2);
  }

  roomImpulse() {
    const lite = this.reverb === 'lite';
    return this.createImpulse(lite ? SFX_ROOM_LITE_SECONDS : SFX_ROOM_SECONDS, 3.4, lite ? 1 : 2);
  }

  createImpulse(seconds, decay, channels) {
    const rate = this.ctx.sampleRate || 44100;
    const buffer = this.ctx.createBuffer(channels, Math.max(1, Math.floor(rate * seconds)), rate);
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
    set(this.graph.musicLevel.gain, levels.music * MUSIC_TRIM);
    set(this.graph.sfxLevel.gain, levels.sfx * SFX_TRIM);
    // The tension layer feeds musicLevel, so the sliders still silence it at once; its own
    // level glides so the presented state reshapes the score over seconds, not per hit.
    const tension = this.tension * TENSION_LEVEL;
    if (immediate) this.graph.tensionLevel.gain.setValueAtTime(tension, now);
    else this.graph.tensionLevel.gain.setTargetAtTime(tension, now, TENSION_GLIDE_SECONDS);
  }

  setScreen(screenId) {
    const nextTheme = resolveThemeId(screenId);
    this.screenId = String(screenId || 'title');
    const inBattle = this.screenId.startsWith('battle:');
    if (!RESULT_SCREENS.has(this.screenId) && this.screenId !== 'settings') this.stingArmed = true;
    if (!inBattle) this.lowHp = null;
    if (nextTheme === this.themeId) return false;
    if (!inBattle) this.tension = 0;
    this.themeId = nextTheme;
    this.stopScheduler();
    this.fadeThemeBuses();
    // Everything the previous screen scheduled, including battle cues queued ahead on the
    // audio clock, ends here; the new screen's cues (a results sting) open a fresh session.
    this.closeSfxSession();
    if (this.ctx && this.graph) this.createThemeBuses(true);
    this.applyMixerLevels();
    this.stepIndex = 0;
    this.nextStepTime = this.ctx ? this.ctx.currentTime + 0.05 : 0;
    this.startScheduler();
    return true;
  }

  // A results sting belongs to the results screen: it only plays once setScreen has moved to
  // that screen (so the transition cannot cancel it), once per arrival from gameplay, and never
  // again when the same results are re-rendered (settings return, mute or language toggle).
  // The arrival is consumed even when muted, so unmuting later does not celebrate late.
  claimResultsSting() {
    if (!RESULT_SCREENS.has(this.screenId) || !this.stingArmed) return false;
    this.stingArmed = false;
    return true;
  }

  // Called by the HUD patch with the presented view (never the resolved end-of-turn state), so
  // the score and the low-HP cue follow what the player sees. Change-gated by a deadband.
  setBattleState(view) {
    const metrics = battleMetrics(view);
    if (!metrics) return;
    const tension = calculateTension(metrics);
    if (Math.abs(tension - this.tension) >= TENSION_DEADBAND) {
      this.tension = tension;
      this.applyMixerLevels();
    }
    this.trackLowHp(metrics);
  }

  // The threshold cue fires when the player's creature is seen falling under LOW_HP_ENTER, once;
  // it re-arms above LOW_HP_RESET or when another creature comes in. The first sight of a
  // creature only records its HP, so an entrance never sounds the cue.
  trackLowHp({ playerHpRatio: ratio, playerActiveId: id }) {
    const previous = this.lowHp?.id === id ? this.lowHp : null;
    const state = previous || { id, ratio, armed: true };
    if (previous) {
      if (ratio > LOW_HP_RESET) state.armed = true;
      else if (state.armed && ratio > 0 && ratio < LOW_HP_ENTER && ratio < state.ratio) {
        state.armed = false;
        this.lowHealthCue();
      }
      state.ratio = ratio;
    }
    this.lowHp = state;
  }

  // Only an audible cue may duck the music (a refused SFX must not leave a silent dip).
  duck(floor = 0.35, duration = 0.45) {
    if (!this.graph || !this.enabled()) return;
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
    const level = MUSIC_THEMES[this.themeId]?.level ?? 1;
    this.themeBus = this.createNode('createGain');
    this.themeWetBus = this.createNode('createGain');
    this.tensionThemeBus = this.createNode('createGain');
    for (const bus of [this.themeBus, this.themeWetBus, this.tensionThemeBus]) {
      bus.gain.setValueAtTime(fadeIn ? 0.0001 : level, now);
      if (fadeIn) bus.gain.exponentialRampToValueAtTime(level, now + 0.42);
    }
    this.themeBus.connect(this.graph.musicLevel);
    this.themeWetBus.connect(this.graph.musicReverb);
    this.tensionThemeBus.connect(this.graph.tensionLevel);
  }

  fadeThemeBuses() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const fadingBuses = [this.themeBus, this.themeWetBus, this.tensionThemeBus].filter(Boolean);
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
    const now = this.ctx.currentTime;
    if (this.nextStepTime < now - SCHEDULER_STALE_SECONDS) {
      // A main-thread stall outran the lookahead: keep the rhythmic grid but skip the steps
      // that are already gone rather than starting them all at once.
      const skipped = Math.ceil((now - this.nextStepTime) / stepDuration);
      this.nextStepTime += skipped * stepDuration;
      this.stepIndex += skipped;
    }
    while (this.nextStepTime < now + this.horizon) {
      this.scheduleMusicStep(config, this.stepIndex, Math.max(now, this.nextStepTime), stepDuration);
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
    const chain = [oscillator, filter, gain];
    if (options.tension) gain.connect(this.tensionThemeBus);
    else {
      gain.connect(this.themeBus);
      const send = this.createNode('createGain');
      send.gain.setValueAtTime(options.reverb, time);
      gain.connect(send).connect(this.themeWetBus);
      chain.push(send);
    }
    this.trackSource(oscillator, this.musicSources, chain);
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
    gain.connect(send).connect(this.themeWetBus);
    this.trackSource(source, this.musicSources, [source, filter, gain, send]);
    source.start(time);
    source.stop(time + duration + 0.02);
  }

  openSfxSession() {
    const dry = this.createNode('createGain');
    const wet = this.createNode('createGain');
    dry.connect(this.graph.sfxLevel);
    wet.connect(this.graph.sfxRoomFilter);
    this.sfxSession = { dry, wet };
    return this.sfxSession;
  }

  // Ends the current screen's SFX: a short fade (no click) then every source it owns stops,
  // future-scheduled layers included. The next cue opens a new session.
  closeSfxSession(fade = SFX_SESSION_FADE_SECONDS) {
    const session = this.sfxSession;
    this.sfxSession = null;
    if (!this.ctx) {
      this.sfxSources.clear();
      return;
    }
    this.cancelSources(this.sfxSources, fade);
    if (!session) return;
    const now = this.ctx.currentTime;
    for (const bus of [session.dry, session.wet]) {
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(bus.gain.value, now);
      bus.gain.linearRampToValueAtTime(0, now + fade);
    }
    globalThis.setTimeout(
      () => {
        this.disconnectNode(session.dry);
        this.disconnectNode(session.wet);
      },
      (fade + 0.05) * 1000
    );
  }

  // One SFX cue: its voices share a short-lived bus (dry + room send, optional low-pass) so the
  // arbiter can duck a whole cue at once. Voices are placed relative to the cue start; `trim`
  // (cueTrim) tightens layer spacing and tails at ×2/hurry without touching pitch. `seed` picks
  // deterministic noise offsets (fxSeed/fxRandom). Returns null while SFX are refused.
  openCue({ reverb = 0.18, lowpass = 0, trim = 1, seed = 'cue' } = {}) {
    if (!this.enabled()) return null;
    const now = this.ctx.currentTime;
    const session = this.sfxSession || this.openSfxSession();
    const bus = this.createNode('createGain');
    const send = this.createNode('createGain');
    bus.gain.setValueAtTime(1, now);
    send.gain.setValueAtTime(clamp01(reverb, 0.18), now);
    bus.connect(session.dry);
    bus.connect(send).connect(session.wet);
    const nodes = [bus, send];
    let input = bus;
    if (lowpass) {
      input = this.createNode('createBiquadFilter');
      input.type = 'lowpass';
      input.frequency.setValueAtTime(lowpass, now);
      input.Q.setValueAtTime(0.7, now);
      input.connect(bus);
      nodes.push(input);
    }
    return { input, bus, nodes, start: now, end: now, trim, random: fxRandom(fxSeed(seed)) };
  }

  // One voice of a cue: an oscillator (`wave`) or a noise/grain buffer, an optional filter
  // `[type, from, to, Q]` swept over the voice, and an exponential envelope. `rough` adds an
  // amplitude flutter (Hz) for hostile, grainy gestures. Durations over 60 ms follow the trim.
  voice(cue, spec) {
    const {
      at = 0,
      gain,
      attack = 0.003,
      hold = 0,
      wave,
      freq = 440,
      end = 0,
      filter,
      rough = 0,
      grain,
    } = spec;
    const start = cue.start + at * cue.trim;
    const duration = spec.dur <= 0.06 ? spec.dur : 0.06 + (spec.dur - 0.06) * cue.trim;
    const stop = start + duration;
    let source;
    if (wave) {
      source = this.createNode('createOscillator');
      source.type = wave;
      source.frequency.setValueAtTime(freq, start);
      if (end) source.frequency.exponentialRampToValueAtTime(end, stop);
    } else {
      source = this.createNode('createBufferSource');
      source.buffer = grain
        ? this.getGrainBuffer(grain, Math.floor(cue.random() * 4))
        : this.getNoiseBuffer('sfx', NOISE_SECONDS);
    }
    const chain = [source];
    let head = source;
    if (filter) {
      const [type, from, to = from, q = 0.9] = filter;
      const node = this.createNode('createBiquadFilter');
      node.type = type;
      node.frequency.setValueAtTime(from, start);
      if (to !== from) node.frequency.exponentialRampToValueAtTime(to, stop);
      node.Q.setValueAtTime(q, start);
      head.connect(node);
      head = node;
      chain.push(node);
    }
    const amp = this.createNode('createGain');
    this.envelope(amp.gain, start, stop, gain, attack, hold);
    head.connect(amp).connect(cue.input);
    chain.push(amp);
    this.trackSource(source, this.sfxSources, [...chain, ...cue.nodes]);
    if (wave) source.start(start);
    else source.start(start, cue.random() * Math.max(0, NOISE_SECONDS - duration - 0.02));
    source.stop(stop + 0.02);
    if (rough) {
      const flutter = this.createNode('createOscillator');
      const depth = this.createNode('createGain');
      flutter.type = 'sine';
      flutter.frequency.setValueAtTime(rough, start);
      this.envelope(depth.gain, start, stop, gain * 0.7, attack, hold);
      flutter.connect(depth).connect(amp.gain);
      this.trackSource(flutter, this.sfxSources, [flutter, depth, amp, ...cue.nodes]);
      flutter.start(start);
      flutter.stop(stop + 0.02);
    }
    cue.end = Math.max(cue.end, stop);
  }

  envelope(param, start, end, peak, attack, hold = 0) {
    const top = start + Math.min(attack, (end - start) / 2);
    param.setValueAtTime(0.0001, start);
    param.exponentialRampToValueAtTime(Math.max(0.0001, peak), top);
    if (hold > 0) param.setValueAtTime(Math.max(0.0001, peak), Math.min(end - 0.005, top + hold));
    param.exponentialRampToValueAtTime(0.0001, end);
  }

  // Sparse seeded noise grains: 'crackle' (dry fire pops, rubble) and 'rustle' (papery leaves,
  // a denser, softer grain over a faint hiss). Four cached variants per kind.
  getGrainBuffer(kind, variant) {
    const key = `grain:${kind}:${variant}`;
    if (this.noiseBuffers.has(key)) return this.noiseBuffers.get(key);
    const rate = this.ctx.sampleRate || 44100;
    const length = Math.max(1, Math.floor(rate * NOISE_SECONDS));
    const buffer = this.ctx.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    const random = fxRandom(fxSeed(kind, variant));
    const [perSecond, grainMs, hiss] = kind === 'crackle' ? [70, 1.6, 0] : [180, 5, 0.06];
    for (let i = 0; i < length; i++) data[i] = hiss * (random() * 2 - 1);
    for (let grain = 0; grain < perSecond * NOISE_SECONDS; grain++) {
      const at = Math.floor(random() * length);
      const peak = 0.3 + random() * 0.7;
      const size = Math.max(1, Math.floor((rate * grainMs * (0.5 + random())) / 1000));
      for (let i = 0; i < size && at + i < length; i++)
        data[at + i] = Math.max(
          -1,
          Math.min(1, data[at + i] + peak * (random() * 2 - 1) * (1 - i / size) ** 2)
        );
    }
    this.noiseBuffers.set(key, buffer);
    return buffer;
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

  // --- Battle cues (docs/battle-presentation.md §5 and §12) ---

  // The director's entry point, through its '*' subscription on the session cue bus. Never
  // throws; silent while audio is disabled, locked or hidden. Returns the arbitration outcome
  // `{ name, beat, level, family }` (level 'dominant' | 'full' | 'ducked' | 'dropped'), or null
  // when nothing was considered.
  cue(name, payload) {
    try {
      return this.playCue(name, payload && typeof payload === 'object' ? payload : {});
    } catch {
      return null;
    }
  }

  playCue(name, payload) {
    const tier = cueTier(name, payload);
    if (!tier || !this.enabled()) return null;
    const beat = this.beatFor(payload.beat);
    const outcome = (level, family = null) => ({ name, beat: beat.id, level, family });
    const key = cueKey(name, payload);
    // The windup is cosmetic anticipation: reduced motion shows none and hurry skips it.
    const cosmetic = name === 'windup' && (payload.reducedMotion || payload.speed >= 3);
    if (cosmetic || (key && beat.keys.has(key))) return outcome('dropped');
    const rank = CUE_RANK[tier];
    const now = this.ctx.currentTime;
    let level = rank > beat.top ? 'dominant' : 'full';
    if (rank < beat.top && beat.dominantEnd > now) {
      if (tier === 'ui') return outcome('dropped');
      level = 'ducked';
    }
    const played = this.renderCue(name, payload, beat, level, cueTrim(payload.speed));
    if (!played) return outcome('dropped');
    const { cue, family } = played;
    if (key) beat.keys.add(key);
    if (level === 'ducked') this.duckCue(cue.bus, now, beat.dominantEnd, true);
    else if (rank >= beat.top) {
      beat.top = rank;
      beat.dominantEnd = Math.max(beat.dominantEnd, cue.end);
      for (const live of beat.live)
        if (live.rank < rank && live.end > now) this.duckCue(live.bus, now, beat.dominantEnd, false);
    }
    beat.live = beat.live.filter((live) => live.end > now);
    beat.live.push({ rank, bus: cue.bus, end: cue.end });
    return outcome(level, family);
  }

  beatFor(id) {
    const fresh = () => ({ id: id ?? null, top: -1, dominantEnd: 0, keys: new Set(), live: [] });
    if (id == null) return fresh();
    if (this.cueBeat?.id !== id) this.cueBeat = fresh();
    return this.cueBeat;
  }

  // Ducks a cue's bus to DUCK_GAIN (at once for a cue starting under the dominant one, with a
  // short slope for one already sounding) and restores it when the dominant cue ends.
  duckCue(bus, now, until, immediate) {
    const gain = bus.gain;
    gain.cancelScheduledValues(now);
    if (immediate) gain.setValueAtTime(DUCK_GAIN, now);
    else {
      gain.setValueAtTime(gain.value, now);
      gain.setTargetAtTime(DUCK_GAIN, now, 0.015);
    }
    gain.setTargetAtTime(1, until, 0.05);
  }

  renderCue(name, p, beat, level, trim) {
    // A damage number already sounded as its contact.
    if (name === 'readout' && !['heal', 'tick', 'recoil', 'barrier'].includes(p.kind)) return null;
    const family = materialFamily(p.affinity);
    const resisted = name === 'contact' && !p.blocked && !p.critical && p.effectiveness < 1;
    const cue = this.openCue({
      reverb: name === 'contact' && p.lethal ? 0.3 : CUE_REVERB[name],
      lowpass: resisted ? RESISTED_LOWPASS_HZ : 0,
      trim,
      seed: `${name}|${p.moveId ?? p.creatureId ?? ''}|${p.hit ?? 0}|${beat.id ?? ''}`,
    });
    if (!cue) return null;
    const audible = level !== 'ducked';
    switch (name) {
      case 'windup':
        this.windupVoices(cue, family, p.archetype);
        break;
      case 'release':
        this.releaseVoices(cue, family, p.archetype);
        break;
      case 'contact':
        this.contactVoices(cue, family, p, beat.keys);
        if (audible && (p.lethal || p.tier >= 2)) this.duck(p.lethal ? 0.45 : 0.7, p.lethal ? 0.6 : 0.3);
        break;
      case 'critical':
        this.critVoices(cue);
        break;
      case 'effective':
        this.brightVoices(cue);
        break;
      case 'resisted':
        this.dampedVoices(cue);
        break;
      case 'blocked':
        this.thunkVoices(cue);
        break;
      case 'miss':
        this.whiffVoices(cue);
        break;
      case 'readout':
        if (p.kind === 'heal') this.healVoices(cue);
        else if (p.kind === 'tick') this.burnVoices(cue);
        else if (p.kind === 'recoil') this.knockVoices(cue);
        else this.guardVoices(cue);
        break;
      case 'heal':
        this.healVoices(cue);
        break;
      case 'status+':
        if (statusPolarity(p.statuses) === 'positive') this.buffVoices(cue);
        else this.cleanseVoices(cue);
        break;
      case 'status-':
        if (statusPolarity(p.statuses) === 'negative') this.debuffVoices(cue);
        else this.stripVoices(cue);
        break;
      case 'break':
        this.shatterVoices(cue);
        break;
      case 'ko':
        this.koVoices(cue);
        if (audible) this.duck(0.45, 0.7);
        break;
      case 'faint-cry':
        this.cryVoices(cue, p.creatureId, 'faint');
        break;
      case 'switch-out':
        this.recallVoices(cue);
        break;
      case 'switch-in':
        this.cryVoices(cue, p.creatureId, 'entry');
        break;
      case 'signature-ready':
        // Full motif with the player's first-time banner; a softer statement otherwise.
        this.motifVoices(cue, { gain: p.first ? 1 : 0.6 });
        break;
      case 'signature-cutin':
        this.cutinVoices(cue, p.creatureId, p.clash);
        if (audible) this.duck(0.35, 0.9);
        break;
      case 'victory':
        this.cheerVoices(cue);
        break;
      case 'defeat':
        this.sighVoices(cue);
    }
    return { cue, family: MATERIAL_CUES.has(name) ? family : null };
  }

  // One landed hit. A blocked hit is the shield thunk. Otherwise the family's material, scaled by
  // tier, effectiveness and hit index (later hits of a multi-hit step up in pitch), plus the
  // outcome accent on the first hit that earns one; the matching stamp cues then stay silent.
  contactVoices(cue, family, { hit = 1, tier = 1, effectiveness = 1, critical, blocked, lethal }, keys) {
    if (blocked) {
      this.thunkVoices(cue);
      keys.add('blocked');
      return;
    }
    const effective = effectiveness > 1,
      resisted = effectiveness < 1,
      index = Math.max(0, hit - 1);
    this.materialVoices(cue, family, {
      strength:
        (1 + (Math.min(3, tier) - 1) * 0.12) * (effective ? 1.12 : resisted ? 0.75 : 1) * (index ? 0.9 : 1),
      pitch: 1 + index * 0.06,
    });
    if (lethal) this.lethalVoices(cue);
    if (keys.has('accent') || !(critical || effective || resisted)) return;
    keys.add('accent');
    if (critical) this.critVoices(cue, 0.02);
    if (effective) this.brightVoices(cue, 0.02);
    else if (resisted) this.dampedVoices(cue);
  }

  materialVoices(cue, family, { strength: s = 1, pitch: k = 1 } = {}) {
    const v = (spec) => this.voice(cue, spec);
    switch (family) {
      case 'eau': // filtered-noise splash + rounded droplets
        v({ dur: 0.16, gain: 0.09 * s, attack: 0.004, filter: ['bandpass', 2200 * k, 900 * k, 1.1] });
        v({
          wave: 'sine',
          freq: 850 * k,
          end: 1750 * k,
          at: 0.018,
          dur: 0.07,
          gain: 0.065 * s,
          attack: 0.002,
        });
        v({
          wave: 'sine',
          freq: 1250 * k,
          end: 2300 * k,
          at: 0.07,
          dur: 0.055,
          gain: 0.04 * s,
          attack: 0.002,
        });
        v({ wave: 'sine', freq: 190, end: 110, dur: 0.1, gain: 0.03 * s });
        break;
      case 'feu': // dry crackle + warm burst
        v({ dur: 0.2, gain: 0.11 * s, attack: 0.012, filter: ['bandpass', 1300 * k, 600 * k, 0.9] });
        v({
          grain: 'crackle',
          dur: 0.24,
          gain: 0.5 * s,
          attack: 0.002,
          filter: ['bandpass', 2600 * k, 2600 * k, 1.2],
        });
        v({ wave: 'triangle', freq: 170 * k, end: 95, dur: 0.14, gain: 0.03 * s, filter: ['lowpass', 900] });
        v({
          wave: 'sawtooth',
          freq: 330 * k,
          end: 240 * k,
          dur: 0.12,
          gain: 0.05 * s,
          filter: ['lowpass', 1600, 600],
        });
        break;
      case 'plante': // papery pluck + rustle
        v({ wave: 'triangle', freq: 1180 * k, end: 1120 * k, dur: 0.09, gain: 0.085 * s, attack: 0.0015 });
        v({ wave: 'sine', freq: 2360 * k, end: 2240 * k, dur: 0.05, gain: 0.04 * s, attack: 0.0015 });
        v({
          grain: 'rustle',
          dur: 0.2,
          gain: 0.24 * s,
          attack: 0.004,
          filter: ['bandpass', 2600 * k, 1900 * k, 1.4],
        });
        v({ wave: 'triangle', freq: 300 * k, end: 220, dur: 0.08, gain: 0.03 * s });
        break;
      case 'psy': // clean inharmonic bell (partials 1 : 2.32 : 4.25) + glassy tick
        v({ wave: 'sine', freq: 740 * k, dur: 0.42, gain: 0.034 * s, attack: 0.002 });
        v({ wave: 'sine', freq: 1717 * k, dur: 0.26, gain: 0.022 * s, attack: 0.002 });
        v({ wave: 'sine', freq: 3145 * k, dur: 0.14, gain: 0.012 * s, attack: 0.002 });
        v({ dur: 0.025, gain: 0.03 * s, attack: 0.001, filter: ['highpass', 5000] });
        v({ wave: 'sine', freq: 220, end: 180, dur: 0.09, gain: 0.03 * s });
        break;
      case 'combat': // woody midrange body strike: body, resonant knock, two wood modes, slap
        v({ wave: 'triangle', freq: 200 * k, end: 140, dur: 0.12, gain: 0.04 * s, attack: 0.002 });
        v({ dur: 0.05, gain: 0.05 * s, attack: 0.001, filter: ['bandpass', 1150 * k, 1150 * k, 5] });
        v({ wave: 'sine', freq: 720 * k, end: 690 * k, dur: 0.1, gain: 0.095 * s, attack: 0.001 });
        v({ wave: 'sine', freq: 1540 * k, dur: 0.05, gain: 0.055 * s, attack: 0.001 });
        v({ dur: 0.015, gain: 0.04 * s, attack: 0.001, filter: ['highpass', 2000] });
        break;
      case 'tenebres': // breathy downward spectral cut
        v({ dur: 0.24, gain: 0.21 * s, attack: 0.008, filter: ['bandpass', 3200 * k, 520 * k, 5] });
        v({ dur: 0.2, gain: 0.08 * s, attack: 0.006, filter: ['bandpass', 1700 * k, 360 * k, 3] });
        v({ wave: 'sine', freq: 560 * k, end: 250 * k, dur: 0.2, gain: 0.028 * s });
        v({ wave: 'sine', freq: 120, end: 80, dur: 0.12, gain: 0.03 * s });
        break;
      default: // neutral: a clean light knock
        v({ wave: 'triangle', freq: 260 * k, end: 190, dur: 0.1, gain: 0.05 * s, attack: 0.002 });
        v({ dur: 0.04, gain: 0.08 * s, attack: 0.001, filter: ['bandpass', 1500 * k, 1500 * k, 3] });
    }
  }

  lethalVoices(cue) {
    this.voice(cue, { dur: 0.32, gain: 0.07, attack: 0.006, filter: ['bandpass', 1100, 320, 1] });
    this.voice(cue, { wave: 'triangle', freq: 150, end: 70, dur: 0.36, gain: 0.035 });
    this.voice(cue, { wave: 'sine', freq: 880, end: 440, at: 0.02, dur: 0.3, gain: 0.02 });
  }

  // Critical: a short metallic "tsching" (air tick, bright fifth).
  critVoices(cue, at = 0) {
    this.voice(cue, { at, dur: 0.05, gain: 0.04, attack: 0.001, filter: ['highpass', 4000] });
    this.voice(cue, { wave: 'square', freq: 1976, at, dur: 0.05, gain: 0.012, filter: ['lowpass', 4200] });
    this.voice(cue, { wave: 'sine', freq: 2960, end: 2800, at: at + 0.012, dur: 0.18, gain: 0.03 });
    this.voice(cue, { wave: 'sine', freq: 1480, at: at + 0.012, dur: 0.15, gain: 0.022 });
  }

  // Super-effective: two bright rising pips over a sparkle.
  brightVoices(cue, at = 0) {
    this.voice(cue, { wave: 'triangle', freq: 1568, at, dur: 0.07, gain: 0.03 });
    this.voice(cue, { wave: 'sine', freq: 2093, at: at + 0.05, dur: 0.12, gain: 0.03 });
    this.voice(cue, { at, dur: 0.12, gain: 0.018, attack: 0.01, filter: ['highpass', 5500] });
  }

  // Resisted: a damped "tup" (the contact itself also plays darker and quieter).
  dampedVoices(cue) {
    this.voice(cue, {
      wave: 'triangle',
      freq: 420,
      end: 300,
      dur: 0.08,
      gain: 0.035,
      filter: ['lowpass', 900],
    });
  }

  // Blocked by a barrier: a dull thunk with a short shield ring.
  thunkVoices(cue) {
    this.voice(cue, { wave: 'triangle', freq: 240, end: 170, dur: 0.1, gain: 0.06, attack: 0.002 });
    this.voice(cue, { dur: 0.04, gain: 0.07, attack: 0.001, filter: ['lowpass', 800, 800, 1] });
    this.voice(cue, { wave: 'sine', freq: 880, at: 0.005, dur: 0.16, gain: 0.02 });
    this.voice(cue, { wave: 'sine', freq: 1320, at: 0.005, dur: 0.1, gain: 0.012 });
  }

  // Miss: a light, non-punitive whiff (a swelling air pass, no buzzer).
  whiffVoices(cue) {
    this.voice(cue, { dur: 0.18, gain: 0.1, attack: 0.07, filter: ['bandpass', 900, 2600, 1.4] });
    this.voice(cue, { wave: 'sine', freq: 1100, end: 1500, at: 0.05, dur: 0.08, gain: 0.012 });
  }

  // Heal: three rising notes (E5 G♯5 B5), once per beat however many allies it reaches.
  healVoices(cue) {
    [659.3, 830.6, 987.8].forEach((freq, index) => {
      this.voice(cue, {
        wave: 'sine',
        freq,
        end: freq * 1.02,
        at: index * 0.065,
        dur: 0.26,
        gain: 0.024,
        attack: 0.01,
      });
      this.voice(cue, {
        wave: 'triangle',
        freq: freq * 2,
        at: index * 0.065,
        dur: 0.14,
        gain: 0.008,
        attack: 0.01,
      });
    });
    this.voice(cue, { at: 0.13, dur: 0.2, gain: 0.01, attack: 0.03, filter: ['highpass', 6000] });
  }

  // Buff: a rising glide and a chime (clearly not the heal's discrete notes).
  buffVoices(cue) {
    this.voice(cue, { wave: 'sine', freq: 660, end: 1320, dur: 0.22, gain: 0.035, attack: 0.02 });
    this.voice(cue, {
      wave: 'triangle',
      freq: 990,
      end: 1980,
      at: 0.05,
      dur: 0.18,
      gain: 0.018,
      attack: 0.02,
    });
    this.voice(cue, { wave: 'sine', freq: 1760, at: 0.16, dur: 0.16, gain: 0.02 });
  }

  // Cleanse (a malus removed): an airy upward clear and one clean ping.
  cleanseVoices(cue) {
    this.voice(cue, { dur: 0.22, gain: 0.022, attack: 0.03, filter: ['highpass', 1200, 5000, 0.8] });
    this.voice(cue, { wave: 'sine', freq: 1318.5, at: 0.12, dur: 0.2, gain: 0.025 });
  }

  // Debuff: a roughened, falling buzz.
  debuffVoices(cue) {
    this.voice(cue, {
      wave: 'sawtooth',
      freq: 720,
      end: 430,
      dur: 0.24,
      gain: 0.055,
      attack: 0.01,
      rough: 34,
      filter: ['bandpass', 1100, 800, 1.2],
    });
    this.voice(cue, {
      wave: 'square',
      freq: 360,
      end: 250,
      dur: 0.2,
      gain: 0.02,
      rough: 27,
      filter: ['lowpass', 1400],
    });
  }

  // A boon stripped away: the buff glide falling, slightly roughened.
  stripVoices(cue) {
    this.voice(cue, { wave: 'sine', freq: 1320, end: 660, dur: 0.22, gain: 0.03, attack: 0.01, rough: 22 });
    this.voice(cue, { dur: 0.15, gain: 0.03, attack: 0.01, filter: ['bandpass', 1600, 700, 1.2] });
  }

  // Barrier break: a real shatter (glass burst, crunch, falling shards).
  shatterVoices(cue) {
    this.voice(cue, { dur: 0.2, gain: 0.05, attack: 0.002, filter: ['highpass', 3200] });
    this.voice(cue, {
      wave: 'square',
      freq: 1180,
      end: 390,
      dur: 0.12,
      gain: 0.025,
      filter: ['lowpass', 4600, 900],
    });
    for (const [freq, at, dur, gain] of [
      [2350, 0.02, 0.14, 0.026],
      [3130, 0.05, 0.12, 0.02],
      [2780, 0.085, 0.1, 0.016],
      [3720, 0.11, 0.08, 0.012],
    ])
      this.voice(cue, { wave: 'sine', freq, at, dur, gain, attack: 0.001 });
  }

  // Barrier gained: a rising shield shimmer.
  guardVoices(cue) {
    this.voice(cue, {
      wave: 'sine',
      freq: 490,
      end: 780,
      dur: 0.22,
      gain: 0.04,
      attack: 0.01,
      filter: ['lowpass', 2800],
    });
    this.voice(cue, { wave: 'triangle', freq: 1175, at: 0.03, dur: 0.2, gain: 0.02 });
    this.voice(cue, { dur: 0.08, gain: 0.015, filter: ['bandpass', 2400, 2400, 1.2] });
  }

  // Recoil on the attacker: a light woody knock (the Combat material, smaller).
  knockVoices(cue) {
    this.materialVoices(cue, 'combat', { strength: 0.6, pitch: 1.1 });
  }

  // Burn tick: the Feu material, smaller (the status is fire, not the victim's type).
  burnVoices(cue) {
    this.materialVoices(cue, 'feu', { strength: 0.75, pitch: 1.05 });
  }

  // K.O. flash: a soft bright flash settling down; the lethal contact already carried the weight.
  koVoices(cue) {
    this.voice(cue, { dur: 0.07, gain: 0.045, attack: 0.002, filter: ['highpass', 2500] });
    this.voice(cue, {
      wave: 'sine',
      freq: 1046.5,
      end: 392,
      dur: 0.38,
      gain: 0.035,
      attack: 0.01,
      filter: ['lowpass', 3000, 900],
    });
    this.voice(cue, { wave: 'triangle', freq: 262, end: 131, dur: 0.3, gain: 0.04, attack: 0.004 });
  }

  // Switch-out: a reversed air swell, the creature drawn back.
  recallVoices(cue) {
    this.voice(cue, { dur: 0.16, gain: 0.06, attack: 0.12, filter: ['bandpass', 700, 2100, 1.5] });
    this.voice(cue, { wave: 'sine', freq: 880, end: 1320, at: 0.08, dur: 0.07, gain: 0.012 });
  }

  // The original 3-note Signature motif. Signature-ready states it bright; the cut-in restates
  // it an octave down in a brassier voice, so the two moments are audibly one idea.
  motifVoices(cue, { octave = 1, wave = 'triangle', gain = 1, at = 0 } = {}) {
    SIGNATURE_MOTIF_HZ.forEach((hz, index) => {
      const freq = hz * octave,
        start = at + index * 0.09;
      this.voice(cue, {
        wave,
        freq,
        at: start,
        dur: index === 2 ? 0.36 : 0.13,
        gain: 0.034 * gain,
        attack: 0.004,
        filter: wave === 'sawtooth' ? ['lowpass', 2400] : undefined,
      });
      this.voice(cue, { wave: 'sine', freq: freq * 2, at: start, dur: 0.08, gain: 0.01 * gain });
    });
    this.voice(cue, {
      at: at + 0.18,
      dur: 0.22,
      gain: 0.01 * gain,
      attack: 0.02,
      filter: ['highpass', 6000],
    });
  }

  // Signature cut-in: a riser into a stinger, the motif restated, and the creature's effort cry.
  // A clash stacks a second motif a semitone apart over a crash.
  cutinVoices(cue, creatureId, clash) {
    this.voice(cue, { dur: 0.42, gain: 0.05, attack: 0.34, filter: ['bandpass', 500, 2600, 1.2] });
    this.voice(cue, { wave: 'triangle', freq: 330, end: 200, dur: 0.16, gain: 0.05, attack: 0.002 });
    this.voice(cue, { dur: 0.06, gain: 0.06, attack: 0.001, filter: ['bandpass', 1200, 1200, 1.5] });
    this.motifVoices(cue, { octave: 0.5, wave: 'sawtooth', gain: 0.8, at: 0.1 });
    if (clash) {
      this.motifVoices(cue, { octave: 0.5 * 2 ** (-1 / 12), wave: 'sawtooth', gain: 0.6, at: 0.14 });
      this.voice(cue, { dur: 0.5, gain: 0.03, attack: 0.004, filter: ['highpass', 1500] });
    }
    if (creatureId) this.cryVoices(cue, creatureId, 'effort', { at: 0.08, gain: 0.8 });
  }

  // Victory on stage: a short crowd swell and a bright arpeggio (the fanfare stays on results).
  cheerVoices(cue) {
    this.voice(cue, { dur: 0.5, gain: 0.05, attack: 0.08, filter: ['bandpass', 1600, 1600, 0.7] });
    [784, 987.8, 1174.7].forEach((freq, index) =>
      this.voice(cue, { wave: 'triangle', freq, at: index * 0.06, dur: 0.2, gain: 0.022 })
    );
  }

  // Defeat on stage: two gentle falling notes, dignified and brief.
  sighVoices(cue) {
    this.voice(cue, { wave: 'sine', freq: 659.3, end: 640, dur: 0.3, gain: 0.028, attack: 0.01 });
    this.voice(cue, {
      wave: 'sine',
      freq: 523.3,
      end: 500,
      at: 0.18,
      dur: 0.4,
      gain: 0.026,
      attack: 0.01,
      filter: ['lowpass', 1800],
    });
  }

  windupVoices(cue, family, archetype) {
    if (PHYSICAL_ARCHETYPES.has(archetype))
      this.voice(cue, { dur: 0.12, gain: 0.08, attack: 0.09, filter: ['bandpass', 500, 1400, 1] });
    else if (SUPPORT_ARCHETYPES.has(archetype))
      this.voice(cue, { wave: 'sine', freq: 1320, end: 1760, dur: 0.12, gain: 0.016, attack: 0.06 });
    else {
      const colour = FAMILY_COLOUR_HZ[family];
      this.voice(cue, {
        wave: 'sine',
        freq: colour * 0.5,
        end: colour * 0.75,
        dur: 0.14,
        gain: 0.012,
        attack: 0.1,
      });
      this.voice(cue, {
        dur: 0.14,
        gain: 0.022,
        attack: 0.1,
        filter: ['bandpass', colour * 0.8, colour * 1.2, 2],
      });
    }
  }

  // Release (lunge starts / projectile leaves): airy and upward, never the contact's material
  // body, so the ear hears "thrown" then "landed".
  releaseVoices(cue, family, archetype) {
    const v = (spec) => this.voice(cue, spec);
    if (archetype === 'DASH')
      return v({ dur: 0.12, gain: 0.11, attack: 0.02, filter: ['bandpass', 900, 2400, 1.1] });
    if (archetype === 'SLASH') {
      v({ dur: 0.1, gain: 0.11, attack: 0.015, filter: ['bandpass', 1400, 3600, 1.4] });
      return v({ wave: 'sine', freq: 2400, end: 1800, dur: 0.05, gain: 0.01 });
    }
    if (archetype === 'QUAKE') {
      v({ grain: 'crackle', dur: 0.22, gain: 0.3, attack: 0.02, filter: ['bandpass', 1100, 750, 1] });
      v({ wave: 'triangle', freq: 110, end: 80, dur: 0.2, gain: 0.015, attack: 0.03 });
      return v({ dur: 0.2, gain: 0.06, attack: 0.03, filter: ['bandpass', 600, 1000, 0.9] });
    }
    if (SUPPORT_ARCHETYPES.has(archetype)) {
      v({ wave: 'sine', freq: 988, end: 1319, dur: 0.14, gain: 0.02, attack: 0.02 });
      return v({ wave: 'triangle', freq: 1976, at: 0.04, dur: 0.1, gain: 0.008 });
    }
    const long = archetype === 'BEAM' ? 1.6 : 1;
    switch (family) {
      case 'eau':
        v({ dur: 0.12 * long, gain: 0.08, attack: 0.01, filter: ['bandpass', 1600, 2600, 1.2] });
        v({ wave: 'sine', freq: 700, end: 1200, dur: 0.06, gain: 0.03 });
        break;
      case 'feu':
        v({ dur: 0.16 * long, gain: 0.08, attack: 0.02, filter: ['bandpass', 700, 1400, 1] });
        v({ grain: 'crackle', dur: 0.14 * long, gain: 0.2, filter: ['bandpass', 2600, 2600, 1.2] });
        break;
      case 'plante':
        v({
          grain: 'rustle',
          dur: 0.14 * long,
          gain: 0.14,
          attack: 0.01,
          filter: ['bandpass', 2600, 2200, 1.4],
        });
        v({ wave: 'triangle', freq: 880, end: 1320, dur: 0.06, gain: 0.03 });
        break;
      case 'psy':
        v({ wave: 'sine', freq: 1480, end: 1976, dur: 0.18 * long, gain: 0.016, attack: 0.01 });
        v({ wave: 'sine', freq: 2220, dur: 0.12 * long, gain: 0.008, attack: 0.01 });
        break;
      case 'combat':
        v({ dur: 0.1 * long, gain: 0.1, attack: 0.012, filter: ['bandpass', 800, 1600, 1.1] });
        break;
      case 'tenebres':
        v({ dur: 0.16 * long, gain: 0.1, attack: 0.02, filter: ['bandpass', 2400, 1100, 2.5] });
        break;
      default:
        v({ wave: 'sine', freq: 1046.5, end: 1568, dur: 0.12 * long, gain: 0.016, attack: 0.01 });
    }
  }

  // Creature voices, profiled per creature id (authored profiles arrive with the baked cries).
  // 'entry' on arrival, 'effort' in a Signature, 'faint' = softened: two rounded sighing
  // syllables settling downward, never a wail. Trims shorten syllables, never raise the pitch.
  // Voices under CRY_FLOOR_HZ fold up by octaves so a phone speaker still carries them.
  cryVoices(cue, id, variant = 'entry', { at = 0, gain = 1 } = {}) {
    const seed = this.hash(id);
    const profile = CRY_PITCH_HZ[id] || 180 + (seed % 470);
    const freq =
      profile < CRY_FLOOR_HZ ? profile * 2 ** Math.ceil(Math.log2(CRY_FLOOR_HZ / profile)) : profile;
    const v = (spec) => this.voice(cue, { ...spec, at: at + (spec.at || 0), gain: spec.gain * gain });
    if (variant === 'faint') {
      v({
        wave: 'sawtooth',
        freq: freq * 1.05,
        end: freq * 0.84,
        dur: 0.32,
        gain: 0.026,
        attack: 0.03,
        filter: ['lowpass', 2600, 900, 0.5],
      });
      v({
        wave: 'triangle',
        freq: freq * 0.9,
        end: freq * 0.62,
        at: 0.17,
        dur: 0.4,
        gain: 0.022,
        attack: 0.04,
        filter: ['lowpass', 1800, 600, 0.5],
      });
      v({ dur: 0.3, gain: 0.012, attack: 0.08, filter: ['bandpass', 1400, 700, 1] });
      return;
    }
    const effort = variant === 'effort',
      bright = ['lowpass', Math.max(2400, freq * 7), Math.max(1600, freq * 4), 0.8],
      breath = 900 + (seed % 7) * 240;
    v({
      wave: CRY_WAVES[seed % 4],
      freq,
      end: freq * (effort ? 1.3 : 1.08 + (seed % 4) * 0.025),
      dur: effort ? 0.2 : 0.22,
      gain: effort ? 0.05 : 0.043,
      attack: 0.008,
      filter: bright,
    });
    v({
      wave: CRY_WAVES[(seed + 1) % 4],
      freq: freq * (effort ? 1.35 : 1.25 + (seed % 5) * 0.04),
      end: freq * (effort ? 1.5 : 0.92),
      at: effort ? 0.06 : 0.065,
      dur: effort ? 0.24 : 0.25,
      gain: effort ? 0.03 : 0.026,
      attack: 0.008,
      filter: bright,
    });
    v({
      dur: 0.12,
      gain: 0.016 + (seed % 4) * 0.004,
      attack: 0.004,
      filter: ['bandpass', breath, breath, 0.8],
    });
  }

  // One soft "ba-dum" when the player's creature falls under a quarter of its HP (trackLowHp).
  lowHealthCue() {
    const cue = this.openCue({ reverb: 0.3, seed: 'low-hp' });
    if (!cue) return;
    for (const [freq, at] of [
      [523.3, 0],
      [466.2, 0.2],
    ]) {
      this.voice(cue, {
        wave: 'triangle',
        freq,
        end: freq * 0.96,
        at,
        dur: 0.16,
        gain: 0.04,
        attack: 0.006,
        filter: ['lowpass', 2000],
      });
      this.voice(cue, { wave: 'sine', freq: freq * 2, at, dur: 0.1, gain: 0.014 });
    }
    const beat = this.cueBeat,
      now = this.ctx.currentTime;
    if (beat && beat.dominantEnd > now) this.duckCue(cue.bus, now, beat.dominantEnd, true);
  }

  // --- Move Theater and UI (battle playback uses cue() only) ---

  ui() {
    const cue = this.openCue({ reverb: 0.08, seed: 'ui' });
    if (!cue) return;
    this.voice(cue, {
      wave: 'sine',
      freq: 660,
      end: 880,
      dur: 0.075,
      gain: 0.045,
      filter: ['lowpass', 2400],
    });
    this.voice(cue, { dur: 0.02, gain: 0.006, filter: ['highpass', 3000] });
  }

  hit(affinity = 'neutral') {
    const cue = this.openCue({ reverb: 0.18, seed: `hit|${affinity}` });
    if (cue) this.materialVoices(cue, materialFamily(affinity));
  }

  victory() {
    if (!this.claimResultsSting()) return;
    const cue = this.openCue({ reverb: 0.42, seed: 'victory-sting' });
    if (!cue) return;
    this.duck(0.25, 0.75);
    [392, 494, 587, 784].forEach((freq, index) => {
      this.voice(cue, {
        wave: 'triangle',
        freq,
        end: freq * 1.04,
        at: index * 0.105,
        dur: 0.38,
        gain: 0.038,
        attack: 0.008,
      });
      this.voice(cue, {
        wave: 'sine',
        freq: freq * 2,
        at: index * 0.105,
        dur: 0.2,
        gain: 0.01,
        attack: 0.008,
      });
    });
    this.voice(cue, { at: 0.315, dur: 0.11, gain: 0.012, filter: ['bandpass', 2600, 2600, 0.8] });
  }

  defeat() {
    if (!this.claimResultsSting()) return;
    const cue = this.openCue({ reverb: 0.5, seed: 'defeat-sting' });
    if (!cue) return;
    this.duck(0.18, 0.9);
    [392, 330, 262, 196].forEach((freq, index) => {
      this.voice(cue, {
        wave: 'sine',
        freq,
        end: freq * 0.91,
        at: index * 0.13,
        dur: 0.46,
        gain: 0.028,
        attack: 0.008,
      });
      this.voice(cue, {
        wave: 'triangle',
        freq: freq * 2,
        at: index * 0.13,
        dur: 0.22,
        gain: 0.016,
        attack: 0.008,
      });
    });
  }

  hash(value) {
    return [...String(value)].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 7);
  }

  // A creature's arrival voice outside battle playback (team-select pick, Pioche du jour pick).
  call(id) {
    const cue = this.openCue({ reverb: 0.36, seed: `cry|${id}` });
    if (cue) this.cryVoices(cue, id, 'entry');
  }
}
