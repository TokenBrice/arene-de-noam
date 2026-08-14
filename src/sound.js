export class SoundSystem {
  constructor(settings, onFailure = () => {}) {
    this.settings = settings;
    this.ctx = null;
    this.onFailure = onFailure;
  }
  update(settings) {
    this.settings = settings;
  }
  async unlock() {
    if (this.ctx) return;
    try {
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) throw new Error('no audio');
      this.ctx = new Audio();
      await this.ctx.resume();
    } catch {
      this.onFailure();
    }
  }
  enabled() {
    return Boolean(this.ctx && !this.settings.muted && this.settings.volume > 0);
  }
  tone(freq = 320, duration = 0.12, type = 'sine', gain = 0.08, delay = 0, endFreq = 0) {
    if (!this.enabled()) return;
    const now = this.ctx.currentTime + delay,
      o = this.ctx.createOscillator(),
      g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(30, freq), now);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), now + duration);
    g.gain.setValueAtTime(Math.max(0.0001, gain * this.settings.volume), now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    o.connect(g).connect(this.ctx.destination);
    o.start(now);
    o.stop(now + duration);
  }
  noise(seed = 'impact', duration = 0.1, gain = 0.025, delay = 0, frequency = 1200) {
    if (!this.enabled() || !this.ctx.createBuffer) return;
    const rate = this.ctx.sampleRate || 44100,
      length = Math.max(1, Math.floor(rate * duration)),
      buffer = this.ctx.createBuffer(1, length, rate),
      data = buffer.getChannelData(0);
    let value = this.hash(seed) || 1;
    for (let i = 0; i < length; i++) {
      value = (value * 1664525 + 1013904223) >>> 0;
      const envelope = Math.pow(1 - i / length, 1.8);
      data[i] = ((value / 4294967295) * 2 - 1) * envelope;
    }
    const source = this.ctx.createBufferSource(),
      filter = this.ctx.createBiquadFilter(),
      g = this.ctx.createGain(),
      now = this.ctx.currentTime + delay;
    source.buffer = buffer;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(frequency, now);
    g.gain.setValueAtTime(gain * this.settings.volume, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(g).connect(this.ctx.destination);
    source.start(now);
    source.stop(now + duration);
  }
  ui() {
    this.tone(520, 0.06, 'square', 0.035);
    this.tone(780, 0.05, 'square', 0.025, 0.045);
  }
  hit(affinity = 'neutral') {
    const f =
      { mind: 560, force: 180, tide: 390, flame: 240, grove: 470, shadow: 130, neutral: 300 }[affinity] ||
      300;
    this.tone(f, 0.14, 'sawtooth', 0.055);
    this.tone(f * 1.8, 0.08, 'square', 0.02, 0.03);
  }
  guard() {
    this.tone(260, 0.18, 'sine', 0.05, 0, 390);
    this.tone(390, 0.2, 'sine', 0.035, 0.02, 310);
  }
  heal() {
    [330, 440, 550].forEach((f, i) => this.tone(f, 0.22, 'sine', 0.035, i * 0.07, f * 1.12));
  }
  ko() {
    this.noise('ko', 0.28, 0.035, 0, 420);
    this.tone(190, 0.35, 'sawtooth', 0.06, 0, 82);
    this.tone(120, 0.4, 'triangle', 0.05, 0.1, 55);
  }
  victory() {
    [392, 494, 587, 784].forEach((f, i) => this.tone(f, 0.35, 'square', 0.04, i * 0.1));
  }
  hash(value) {
    return [...String(value)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
  }
  call(id) {
    const families = { orakyn: 610, kordane: 190, farfombre: 430, abyssar: 125, calderoc: 155, virelia: 520 },
      seed = this.hash(id),
      f = families[id] || 180 + (seed % 470),
      waves = ['triangle', 'sine', 'square', 'sawtooth'],
      wave = waves[seed % waves.length];
    this.tone(f, 0.12 + (seed % 5) * 0.018, wave, 0.042, 0, f * (1.04 + (seed % 3) * 0.03));
    this.tone(f * (1.12 + (seed % 7) * 0.035), 0.18, waves[(seed + 1) % 4], 0.028, 0.055);
  }
  move(move) {
    if (!move) return;
    const affinityBase = {
        mind: 520,
        force: 175,
        tide: 280,
        flame: 145,
        grove: 430,
        shadow: 205,
        neutral: 340,
      },
      seed = this.hash(move.visual || move.id),
      f = (affinityBase[move.affinity] || 340) + (seed % 120),
      waves = ['sine', 'triangle', 'square', 'sawtooth'],
      wave = waves[seed % 4];
    if (move.signature) {
      this.tone(f * 0.38, 0.46, 'sine', 0.038, 0, f * 0.72);
      this.tone(f * 0.7, 0.36, waves[(seed + 1) % 4], 0.036, 0.07, f * 1.15);
      [1, 1.5, 2].forEach((ratio, i) =>
        this.tone(
          f * ratio,
          0.28 + i * 0.03,
          waves[(seed + i) % 4],
          0.035 + (i === 0 ? 0.018 : 0),
          0.16 + i * 0.055,
          f * ratio * 1.08
        )
      );
      return;
    }
    if ((move.hits || 1) > 1) {
      for (let i = 0; i < move.hits; i++)
        this.tone(f * (1 + i * 0.13), 0.09, wave, 0.037, i * 0.055, f * (1.18 + i * 0.14));
      return;
    }
    if (move.kind === 'heal') {
      [0.75, 1, 1.25, 1.5].forEach((ratio, i) =>
        this.tone(f * ratio, 0.26, 'sine', 0.028, i * 0.055, f * ratio * 1.15)
      );
      return;
    }
    if (move.kind !== 'damage') {
      [1, 1.22, 1.52].forEach((ratio, i) =>
        this.tone(f * ratio, 0.22, waves[(seed + i) % 2], 0.029, i * 0.06, f * ratio * (i === 1 ? 0.9 : 1.1))
      );
      return;
    }
    if (move.targetStatuses?.length) {
      this.tone(f * 1.2, 0.13, 'triangle', 0.038, 0, f * 1.48);
      this.tone(f * 0.78, 0.24, wave, 0.041, 0.075, f * 0.52);
      return;
    }
    this.tone(f, 0.14, wave, 0.046, 0, f * (move.priority > 0 ? 1.65 : 0.72));
    this.tone(f * (1.35 + (seed % 5) * 0.06), 0.11, waves[(seed + 2) % 4], 0.028, 0.055);
  }
  impact(move, event = {}) {
    if (!move) {
      this.hit(event.moveAffinity);
      return;
    }
    const seed = this.hash(`${move.visual}:${event.hit || 1}`),
      hits = move.hits || 1,
      power = move.power || 0,
      base =
        { mind: 240, force: 94, tide: 165, flame: 118, grove: 150, shadow: 76, neutral: 130 }[
          move.affinity
        ] || 130;
    if (event.affinity === 1.5) {
      this.tone(base * 3.4, 0.16, 'square', 0.026, 0, base * 5.1);
      this.tone(base * 5.1, 0.2, 'sine', 0.02, 0.045, base * 6.4);
    } else if (event.affinity === 0.75) {
      this.tone(Math.max(45, base * 0.48), 0.19, 'triangle', 0.025, 0, Math.max(38, base * 0.32));
    }
    if (event.hp <= 0) {
      this.finisher(move.affinity, seed);
      return;
    }
    if (event.combo?.length) {
      this.noise(`${seed}:combo`, 0.18, 0.038, 0, 1800);
      [1, 1.32, 1.76].forEach((r, i) => this.tone((base + 180) * r, 0.18, 'square', 0.027, i * 0.035));
    }
    if (hits > 1) {
      const index = Math.max(0, (event.hit || 1) - 1),
        pitch = base + index * 42;
      this.noise(`${seed}:hit`, 0.065, 0.024, 0, 900 + index * 240);
      this.tone(pitch, 0.1, index % 2 ? 'square' : 'sawtooth', 0.045, 0, pitch * 0.58);
      if (event.hit === hits) this.tone(base * 0.72, 0.2, 'triangle', 0.042, 0.025, base * 0.34);
      return;
    }
    const heavy = power >= 42 || move.signature,
      noiseGain = heavy ? 0.045 : 0.027;
    this.noise(`${seed}:impact`, heavy ? 0.18 : 0.09, noiseGain, 0, heavy ? 720 : 1350);
    this.tone(
      base * (heavy ? 1 : 0.82),
      heavy ? 0.25 : 0.13,
      heavy ? 'sawtooth' : 'triangle',
      heavy ? 0.065 : 0.042,
      0,
      Math.max(42, base * (heavy ? 0.36 : 0.64))
    );
    if (move.ignoreGuard || move.ignoreBarrier)
      this.tone(base * 3.1, 0.12, 'square', 0.024, 0.015, base * 1.1);
    if (move.detonate) this.tone(base * 4, 0.22, 'sawtooth', 0.032, 0.035, base * 0.8);
  }
  assist(affinity = 'neutral') {
    const f =
      { mind: 590, force: 260, tide: 410, flame: 330, grove: 520, shadow: 220, neutral: 440 }[affinity] ||
      440;
    [1, 1.26, 1.68].forEach((r, i) => this.tone(f * r, 0.18, 'triangle', 0.028, i * 0.045, f * r * 1.08));
  }
  detonate(status = 'charged') {
    const seed = this.hash(status),
      base = 125 + (seed % 145);
    this.noise(`${status}:detonate`, 0.22, 0.045, 0.08, 820);
    this.tone(base, 0.3, 'sawtooth', 0.052, 0, base * 2.8);
    this.tone(base * 3.2, 0.18, 'square', 0.038, 0.11, base * 0.7);
    this.tone(70, 0.32, 'triangle', 0.05, 0.16, 42);
  }
  resonance(affinity = 'neutral') {
    const f =
      { mind: 440, force: 132, tide: 294, flame: 196, grove: 349, shadow: 110, neutral: 262 }[affinity] ||
      262;
    this.tone(f, 0.5, 'sine', 0.04, 0, f * 2);
    [1, 1.5, 2].forEach((r, i) => this.tone(f * r, 0.34, 'triangle', 0.027, 0.1 + i * 0.055, f * r * 1.16));
  }
  clash() {
    this.noise('signature-clash', 0.32, 0.048, 0.16, 1100);
    this.tone(92, 0.55, 'sawtooth', 0.065, 0, 260);
    this.tone(620, 0.45, 'square', 0.035, 0.12, 118);
    this.tone(1040, 0.22, 'sine', 0.028, 0.18, 310);
  }
  finisher(affinity = 'neutral', seed = 7) {
    const base =
      { mind: 150, force: 82, tide: 120, flame: 95, grove: 110, shadow: 62, neutral: 100 }[affinity] || 100;
    this.noise(`${seed}:finisher`, 0.42, 0.055, 0, 640);
    this.tone(base * 3.4, 0.13, 'square', 0.045, 0, base * 1.4);
    this.tone(base, 0.48, 'sawtooth', 0.075, 0.035, 42);
    this.tone(base * 1.5, 0.38, 'triangle', 0.045, 0.1, 55);
  }
}
