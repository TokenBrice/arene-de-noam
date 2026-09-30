import { ctx } from './context.js';

// Quality tiers: the single source for the arena render budget, the DOM FX budget, the
// `html.q-*` CSS cuts and the audio cost. The detected tier is a ceiling; in automatic mode the
// FrameGovernor steps down from it when the arena's own frames run late, and back up between
// battles once frames stay comfortably inside the budget.

export const PERF_KEY = 'arene-de-noam-perf';
export const QUALITY_TIERS = Object.freeze(['low', 'mid', 'high']);

// Every Samsung Galaxy A GPU (Mali-G52/G57/G68) and every software rasterizer lands in Low.
const LOW_GPU =
  /Mali-(G5\d|G6[0-8]|G7[0-2]|T\d)|Adreno \(TM\) ([1-5]\d\d|6[01]\d)|PowerVR|IMG|SwiftShader|llvmpipe/i;

const budget = (tier, arena, fx, audio) =>
  Object.freeze({ tier, arena: Object.freeze(arena), fx: Object.freeze(fx), audio: Object.freeze(audio) });

// arena: renderer settings read by ArenaScene (DPR caps, MSAA, frame caps, ambient dust points).
// fx: GPU FX layer live-quad budget and summed quad area (stage viewports).
// audio: SFX room reverb cost ('lite' = a short mono impulse); the music is baked.
export const QUALITY_BUDGETS = Object.freeze({
  low: budget(
    'low',
    {
      maxPixelRatio: 1,
      largeCanvasPixelRatio: 1,
      antialias: false,
      powerPreference: 'default',
      ambientFps: 30,
      activeFps: 30,
      dust: 60,
    },
    { quads: 96, quadArea: 0.6 },
    { reverb: 'lite' }
  ),
  mid: budget(
    'mid',
    {
      maxPixelRatio: 1.5,
      largeCanvasPixelRatio: 1.5,
      antialias: false,
      powerPreference: 'default',
      ambientFps: 30,
      activeFps: 60,
      dust: 120,
    },
    { quads: 160, quadArea: 1 },
    { reverb: 'full' }
  ),
  high: budget(
    'high',
    {
      maxPixelRatio: 2,
      largeCanvasPixelRatio: 1.5,
      antialias: true,
      powerPreference: 'high-performance',
      ambientFps: 60,
      activeFps: 60,
      dust: 170,
    },
    { quads: 256, quadArea: 1.5 },
    { reverb: 'full' }
  ),
});

export function classifyTier({
  deviceMemory,
  gpu = '',
  cores,
  saveData = false,
  coarse = false,
  screenPixels = 0,
}) {
  if ((deviceMemory && deviceMemory <= 4) || LOW_GPU.test(gpu) || (cores && cores <= 4) || saveData)
    return 'low';
  if ((deviceMemory && deviceMemory <= 6) || (coarse && screenPixels >= 1080)) return 'mid';
  return 'high';
}

function readPerfCache() {
  try {
    const cached = JSON.parse(globalThis.localStorage?.getItem(PERF_KEY) ?? 'null');
    return cached && typeof cached.gpu === 'string' && QUALITY_TIERS.includes(cached.tier) ? cached : null;
  } catch {
    return null;
  }
}

// Unmasked renderer string from a throwaway 1×1 context, released right away. Runs once per
// device: the string is cached beside the tier.
function probeGpu() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const gl = canvas.getContext('webgl', { antialias: false, depth: false, stencil: false });
    if (!gl) return '';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return gpu;
  } catch {
    return '';
  }
}

export function detectTier() {
  const nav = globalThis.navigator || {},
    cached = readPerfCache(),
    gpu = cached ? cached.gpu : probeGpu(),
    tier = classifyTier({
      deviceMemory: nav.deviceMemory,
      gpu,
      cores: nav.hardwareConcurrency,
      saveData: Boolean(nav.connection?.saveData),
      coarse: globalThis.matchMedia?.('(pointer: coarse)').matches ?? false,
      screenPixels: (globalThis.screen?.width || 0) * (globalThis.devicePixelRatio || 1),
    });
  if (!cached || cached.tier !== tier) {
    try {
      globalThis.localStorage?.setItem(PERF_KEY, JSON.stringify({ tier, gpu }));
    } catch {
      // The cache is an optimisation only.
    }
  }
  return { tier, gpu };
}

// Applies a tier everywhere at once. The live arena takes the parts that are safe mid-battle
// (frame caps, DPR, dust); antialiasing follows with the next arena.
export function applyTier(tier) {
  const quality = QUALITY_BUDGETS[tier];
  const root = document.documentElement;
  for (const id of QUALITY_TIERS) root.classList.toggle(`q-${id}`, id === tier);
  ctx.quality = quality;
  ctx.sound.setQuality(quality.audio);
  ctx.arenaScene?.setQuality(quality);
  return quality;
}

const WINDOW_MS = 2000;
const SLOW_WINDOWS = 2;
const SLOW_RATIO = 1.5;
const FAST_RATIO = 0.8;
const PROMOTE_MS = 30000;
const MIN_WINDOW_SAMPLES = 20;
const LOAF_BLOCKING_MS = 100;
const LOAF_SPAN_MS = 10000;
const LOAF_LIMIT = 3;
// Battle entry builds the whole battle screen and plays the intro: never judge it.
const ENTRY_GRACE_MS = 2000;
// A gap this long means the arena loop was stopped (paused, idle under reduced motion).
const GAP_MS = 1000;

const tierIndex = (tier) => QUALITY_TIERS.indexOf(tier);
const frameTarget = (tier) => 1000 / QUALITY_BUDGETS[tier].arena.activeFps;

// Watches the arena's own rAF cadence (ArenaScene calls sample() on every animation frame it
// receives, rendered or not) plus long-animation-frame entries while a battle arena is attached.
// Demotions wait for an idle arena frame outside move FX; promotions wait for the arena to be
// detached, i.e. between battles, and never exceed the detected ceiling.
export class FrameGovernor {
  constructor({ ceiling, apply, atBoundary = () => true, clock = () => performance.now() }) {
    this.ceiling = ceiling;
    this.tier = ceiling;
    this.enabled = false;
    this.apply = apply;
    this.atBoundary = atBoundary;
    this.clock = clock;
    this.scene = null;
    this.observer = null;
    this.graceUntil = 0;
    this.intervals = new Float32Array(512);
    this.resetStreaks();
  }
  configure({ tier, enabled }) {
    this.tier = tier;
    this.enabled = enabled;
    this.resetStreaks();
    if (this.scene) this.observeLongFrames();
  }
  resetStreaks() {
    this.count = 0;
    this.windowStart = 0;
    this.lastSampleAt = 0;
    this.slowWindows = 0;
    this.fastMs = 0;
    this.longFrames = [];
    this.pending = null;
    this.promotionReady = false;
  }
  attach(scene) {
    this.scene = scene;
    this.resetStreaks();
    this.graceUntil = this.clock() + ENTRY_GRACE_MS;
    this.observeLongFrames();
  }
  detach(scene) {
    if (this.scene !== scene) return;
    this.scene = null;
    this.observer?.disconnect();
    this.observer = null;
    const next = this.pending ?? (this.promotionReady ? QUALITY_TIERS[tierIndex(this.tier) + 1] : null);
    this.resetStreaks();
    if (this.enabled && next) this.switchTo(next);
  }
  observeLongFrames() {
    this.observer?.disconnect();
    this.observer = null;
    if (
      !this.enabled ||
      !globalThis.PerformanceObserver?.supportedEntryTypes?.includes('long-animation-frame')
    )
      return;
    this.observer = new PerformanceObserver((list) => this.recordLongFrames(list.getEntries()));
    this.observer.observe({ type: 'long-animation-frame' });
  }
  recordLongFrames(entries) {
    if (!this.enabled || !this.scene || this.scene.paused) return;
    for (const entry of entries) {
      if (entry.blockingDuration <= LOAF_BLOCKING_MS || entry.startTime < this.graceUntil) continue;
      this.longFrames.push(entry.startTime);
      this.fastMs = 0;
    }
    const since = this.clock() - LOAF_SPAN_MS;
    this.longFrames = this.longFrames.filter((start) => start >= since);
    if (this.longFrames.length >= LOAF_LIMIT) {
      this.longFrames = [];
      this.demote();
    }
  }
  // `interval` is the time since the previous animation frame of an uninterrupted loop.
  sample(interval, now, active) {
    if (!this.enabled) return;
    if (this.pending && !active && this.atBoundary()) {
      const next = this.pending;
      this.resetStreaks();
      this.switchTo(next);
      return;
    }
    if (now < this.graceUntil) return;
    if (now - this.lastSampleAt > GAP_MS) {
      this.count = 0;
      this.windowStart = now;
      this.slowWindows = 0;
    }
    this.lastSampleAt = now;
    if (this.count < this.intervals.length) this.intervals[this.count++] = interval;
    if (now - this.windowStart >= WINDOW_MS) this.closeWindow(now);
  }
  closeWindow(now) {
    const count = this.count;
    this.count = 0;
    this.windowStart = now;
    if (count < MIN_WINDOW_SAMPLES) return;
    const sorted = this.intervals.subarray(0, count).sort(),
      p90 = sorted[Math.min(count - 1, Math.floor(count * 0.9))];
    if (p90 > frameTarget(this.tier) * SLOW_RATIO) {
      this.fastMs = 0;
      this.slowWindows += 1;
      if (this.slowWindows >= SLOW_WINDOWS) {
        this.slowWindows = 0;
        this.demote();
      }
      return;
    }
    this.slowWindows = 0;
    // Promotion needs the next tier's own slow threshold to hold with 20 % headroom.
    const up = QUALITY_TIERS[tierIndex(this.tier) + 1];
    if (!up || tierIndex(up) > tierIndex(this.ceiling)) return;
    if (p90 < frameTarget(up) * SLOW_RATIO * FAST_RATIO) {
      this.fastMs += WINDOW_MS;
      if (this.fastMs >= PROMOTE_MS) this.promotionReady = true;
    } else this.fastMs = 0;
  }
  // One step below the current tier; a second trigger before it applies changes nothing.
  demote() {
    const down = QUALITY_TIERS[tierIndex(this.tier) - 1];
    this.promotionReady = false;
    this.fastMs = 0;
    if (down) this.pending = down;
  }
  switchTo(tier) {
    this.tier = tier;
    this.apply(tier);
  }
}

const urlTier = QUALITY_TIERS.includes(ctx.params.get('quality')) ? ctx.params.get('quality') : null;
const detected = detectTier();

const governor = new FrameGovernor({
  ceiling: detected.tier,
  apply: applyTier,
  atBoundary: () => !ctx.currentFxMove,
});

// Resolves a saved choice ('auto' | tier) to the active tier. The `?quality=` test hook wins
// over the save; only automatic mode lets the governor move the tier.
export function applyQualityChoice(choice) {
  const tier = urlTier || (QUALITY_TIERS.includes(choice) ? choice : detected.tier);
  governor.configure({ tier, enabled: !urlTier && !QUALITY_TIERS.includes(choice) });
  return applyTier(tier);
}

ctx.qualityGovernor = governor;
applyQualityChoice(ctx.save.quality);
