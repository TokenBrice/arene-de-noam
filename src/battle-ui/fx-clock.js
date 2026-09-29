// Presentation clock for one battle session (docs/battle-presentation.md §4).
//
// Virtual time (ms) advances with real time × rate, where rate = battleSpeed × hurry. Every
// choreography consumer (director cues, fighter reactions, FX particles, camera shots) reads
// this clock, so ×2, hold-to-hurry and hit-stop apply to all of them at once. Pausing freezes
// virtual time (a true hit-stop). Real-time stalls (hidden tab, long task) are clamped to
// `maxStepMs` so a resumed turn never skips ahead. `instant` (?animations=0) turns every timed
// step into one ~1 ms timer tick. Nothing here touches the DOM or the engine.

export const HURRY_RATE = 3;
export const READOUT_MIN_REAL_MS = 350;
export const MAX_STEP_MS = 100;

const HIT_STOP = Symbol('hit-stop');

function reportAsync(error) {
  queueMicrotask(() => {
    throw error;
  });
}

export class FxClock {
  #realNow;
  #requestFrame;
  #cancelFrame;
  #setTimer;
  #clearTimer;
  #alive;
  #instant;
  #maxStep;
  #virtual = 0;
  #anchor;
  #speed;
  #hurry = false;
  #holds = new Set();
  #timers = [];
  #sequence = 0;
  #frame = null;
  #frameIsTimer = false;
  #hitStopUntil = 0;
  #hitStopWaiters = [];
  #disposed = false;

  constructor({
    speed = 1,
    instant = false,
    alive = () => true,
    now = () => globalThis.performance.now(),
    requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
    cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
    setTimer = globalThis.setTimeout.bind(globalThis),
    clearTimer = globalThis.clearTimeout.bind(globalThis),
    maxStepMs = MAX_STEP_MS,
  } = {}) {
    this.#realNow = now;
    this.#requestFrame = requestFrame;
    this.#cancelFrame = cancelFrame;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
    this.#alive = alive;
    this.#instant = Boolean(instant);
    this.#maxStep = maxStepMs;
    this.#speed = FxClock.#validRate(speed);
    this.#anchor = now();
  }

  static #validRate(value) {
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate <= 0) throw new RangeError(`Invalid clock speed: ${value}`);
    return rate;
  }

  get instant() {
    return this.#instant;
  }
  get speed() {
    return this.#speed;
  }
  get hurry() {
    return this.#hurry;
  }
  get rate() {
    return this.#speed * (this.#hurry ? HURRY_RATE : 1);
  }
  get paused() {
    return this.#holds.size > 0;
  }
  get disposed() {
    return this.#disposed;
  }

  // Current virtual time. Reading it advances the clock (stall-clamped), so frequent readers
  // (the arena at 30–60 fps) see continuous time.
  now() {
    this.#sample();
    return this.#virtual;
  }

  // Virtual ms -> real ms at the current rate; 0 in instant mode.
  realMs(virtualMs) {
    return this.#instant ? 0 : Math.max(0, virtualMs) / this.rate;
  }

  setSpeed(speed) {
    const next = FxClock.#validRate(speed);
    this.#sample();
    this.#speed = next;
  }

  setHurry(on) {
    this.#sample();
    this.#hurry = Boolean(on);
  }

  pause(reason = 'manual') {
    this.#sample();
    this.#holds.add(reason);
  }

  resume(reason = 'manual') {
    this.#sample();
    this.#holds.delete(reason);
    this.#schedule();
  }

  // Freeze virtual time for `ms` of virtual time at the current rate (ms / rate real ms).
  // Overlapping hit-stops extend to the latest end. Instant mode never freezes.
  hitStop(ms) {
    if (!this.#usable()) return Promise.resolve(false);
    if (this.#instant || !(ms > 0)) return Promise.resolve(true);
    const real = this.#sample();
    this.#hitStopUntil = Math.max(this.#hitStopUntil, real + ms / this.rate);
    this.#holds.add(HIT_STOP);
    return new Promise((resolve) => {
      this.#hitStopWaiters.push(resolve);
      this.#schedule();
    });
  }

  // Resolves true once virtual time reaches `time` and at least `minRealMs` real ms have passed
  // since the call; false if the clock is cancelled or disposed first.
  waitUntil(time, { minRealMs = 0 } = {}) {
    if (!this.#usable()) return Promise.resolve(false);
    const real = this.#sample();
    return new Promise((resolve) => {
      this.#timers.push({
        due: time,
        minRealAt: this.#instant ? 0 : real + Math.max(0, minRealMs),
        sequence: ++this.#sequence,
        resolve,
        callback: null,
      });
      this.#schedule();
    });
  }

  wait(ms, options) {
    return this.waitUntil(this.now() + Math.max(0, ms), options);
  }

  // Calls `callback(virtualNow)` once virtual time reaches `time`. Returns a cancel function.
  atTime(time, callback) {
    if (!this.#usable()) return () => {};
    const timer = { due: time, minRealAt: 0, sequence: ++this.#sequence, resolve: null, callback };
    this.#timers.push(timer);
    this.#schedule();
    return () => {
      const index = this.#timers.indexOf(timer);
      if (index >= 0) this.#timers.splice(index, 1);
    };
  }

  at(ms, callback) {
    return this.atTime(this.now() + Math.max(0, ms), callback);
  }

  // Drops every pending wait (resolved false), callback and hit-stop. The clock stays usable.
  cancelAll() {
    const timers = this.#timers;
    this.#timers = [];
    for (const timer of timers) timer.resolve?.(false);
    this.#releaseHitStop(false);
    this.#stopFrame();
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.cancelAll();
  }

  #usable() {
    if (this.#disposed) return false;
    if (this.#alive()) return true;
    this.dispose();
    return false;
  }

  #sample() {
    const real = this.#realNow();
    if (!this.#instant && !this.#disposed && this.#holds.size === 0)
      this.#virtual += Math.min(Math.max(0, real - this.#anchor), this.#maxStep) * this.rate;
    this.#anchor = real;
    return real;
  }

  #releaseHitStop(completed) {
    if (!this.#holds.has(HIT_STOP) && !this.#hitStopWaiters.length) return;
    this.#holds.delete(HIT_STOP);
    this.#hitStopUntil = 0;
    const waiters = this.#hitStopWaiters;
    this.#hitStopWaiters = [];
    for (const resolve of waiters) resolve(completed);
  }

  #needsTick() {
    if (this.#disposed) return false;
    if (this.#holds.has(HIT_STOP)) return true;
    return this.#timers.length > 0 && this.#holds.size === 0;
  }

  #schedule() {
    if (this.#frame !== null || !this.#needsTick()) return;
    if (this.#instant || !this.#requestFrame) {
      this.#frameIsTimer = true;
      this.#frame = this.#setTimer(this.#tick, this.#instant ? 1 : 16);
    } else {
      this.#frameIsTimer = false;
      this.#frame = this.#requestFrame(this.#tick);
    }
  }

  #stopFrame() {
    if (this.#frame === null) return;
    if (this.#frameIsTimer) this.#clearTimer(this.#frame);
    else this.#cancelFrame?.(this.#frame);
    this.#frame = null;
  }

  #tick = () => {
    this.#frame = null;
    if (this.#disposed) return;
    if (!this.#alive()) {
      this.dispose();
      return;
    }
    const real = this.#sample();
    if (this.#holds.has(HIT_STOP) && real >= this.#hitStopUntil) this.#releaseHitStop(true);
    if (this.#holds.size === 0) {
      if (this.#instant && this.#timers.length) {
        // One timed step per tick: jump straight to the earliest pending deadline.
        const next = Math.min(...this.#timers.map((timer) => timer.due));
        if (next > this.#virtual) this.#virtual = next;
      }
      this.#fireDue(real);
    }
    this.#schedule();
  };

  #fireDue(real) {
    const due = this.#timers
      .filter((timer) => timer.due <= this.#virtual && real >= timer.minRealAt)
      .sort((a, b) => a.due - b.due || a.sequence - b.sequence);
    if (!due.length) return;
    this.#timers = this.#timers.filter((timer) => !due.includes(timer));
    for (const timer of due) {
      if (timer.resolve) timer.resolve(true);
      else
        try {
          timer.callback(this.#virtual);
        } catch (error) {
          reportAsync(error);
        }
    }
  }
}
