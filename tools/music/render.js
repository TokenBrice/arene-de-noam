// Browser-side synthesis for tools/bake-music.mjs: renders a track's notes (tools/music/score.js)
// into an OfflineAudioContext through per-instrument channels and the track's reverb. Runs in
// Chromium; every voice is plain Web Audio (oscillators, FM, filtered seeded noise).
import { SAMPLE_RATE } from './score.js';

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (text) => [...text].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

// Loudness trims that bring every voice to about −18 LUFS at vel 1 and 0 dB mix gain (measured
// on 32 quarter notes over two octaves, or 32 hits, dry), so the score's mix gains are the
// balance. Re-measure after changing a voice.
const LEVEL = Object.freeze({
  pad: 2.21,
  harp: 0.72,
  pluck: 1.12,
  glass: 0.6,
  bell: 0.51,
  marimba: 0.62,
  pizz: 1.58,
  lead: 0.68,
  square: 1.41,
  brass: 0.75,
  bass: 0.53,
  epiano: 0.68,
  celesta: 0.55,
  stac: 2.19,
  pulse: 1.46,
  kick: 0.78,
  snare: 1.88,
  hat: 5.75,
  ohat: 2.85,
  shaker: 6.17,
  tom: 0.97,
  metal: 1.62,
  clap: 5.43,
  wood: 2.07,
  rim: 4.27,
  timp: 0.39,
  swell: 1.93,
});

// Node helpers bound to one context; `stop` returns the time a voice has fully decayed.
function kit(ctx, seed) {
  const rand = random(seed);
  const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1;
  const waves = new Map();
  const pulseWave = (duty) => {
    if (!waves.has(duty)) {
      const count = 64,
        real = new Float32Array(count + 1),
        imag = new Float32Array(count + 1);
      for (let n = 1; n <= count; n++) {
        real[n] = Math.sin(2 * Math.PI * n * duty) / (n * Math.PI);
        imag[n] = (1 - Math.cos(2 * Math.PI * n * duty)) / (n * Math.PI);
      }
      waves.set(duty, ctx.createPeriodicWave(real, imag));
    }
    return waves.get(duty);
  };
  const nyquist = ctx.sampleRate / 2 - 100;
  const k = {
    ctx,
    osc(type, freq, detune = 0) {
      const node = ctx.createOscillator();
      if (type.startsWith('pulse')) node.setPeriodicWave(pulseWave(Number(type.slice(5)) / 100));
      else node.type = type;
      node.frequency.value = Math.min(freq, nyquist);
      node.detune.value = detune;
      return node;
    },
    gain(value = 1) {
      const node = ctx.createGain();
      node.gain.value = value;
      return node;
    },
    filter(type, freq, q = 0.7) {
      const node = ctx.createBiquadFilter();
      node.type = type;
      node.frequency.value = Math.min(freq, nyquist);
      node.Q.value = q;
      return node;
    },
    noise() {
      const node = ctx.createBufferSource();
      node.buffer = noiseBuffer;
      node.loop = true;
      return node;
    },
    // Starts sources at t (noise at a seeded offset) and stops them at `stop`.
    play(sources, t, stop) {
      for (const source of sources) {
        if (source instanceof AudioBufferSourceNode) source.start(t, rand() * 2.5);
        else source.start(t);
        source.stop(stop);
      }
    },
    // Attack to `peak`, exponential decay toward `sustain` × peak, release from `end`.
    envelope(param, t, { attack = 0.003, peak, decay = 0.3, sustain = 0, release = 0.1 }, end) {
      param.setValueAtTime(0, t);
      param.linearRampToValueAtTime(peak, t + attack);
      param.setTargetAtTime(peak * sustain, t + attack, decay / 3);
      const off = Math.max(t + attack, end);
      param.setTargetAtTime(0, off, release / 3);
      const released = off + release * 2.5;
      return sustain > 0 ? released : Math.min(released, t + attack + decay * 2.4);
    },
    // A simple decaying hit on `param` (time constant `tc`).
    hit(param, t, peak, tc, attack = 0.0015) {
      param.setValueAtTime(0, t);
      param.linearRampToValueAtTime(peak, t + attack);
      param.setTargetAtTime(0, t + attack, tc);
      return t + attack + tc * 7;
    },
    // A sine-carrier FM pair: modulator at ratio × f, index envelope from peak to rest.
    fm(f, ratio, t, { peak, rest, tc }) {
      const carrier = k.osc('sine', f);
      const modulator = k.osc('sine', f * ratio);
      const depth = k.gain(0);
      depth.gain.setValueAtTime(peak, t);
      depth.gain.setTargetAtTime(rest, t, tc);
      modulator.connect(depth).connect(carrier.frequency);
      return [carrier, modulator];
    },
    vibrato(oscs, t, { rate = 5.3, cents = 12, delay = 0.2 }) {
      const lfo = k.osc('sine', rate);
      const depth = k.gain(0);
      depth.gain.setValueAtTime(0, t + delay);
      depth.gain.linearRampToValueAtTime(cents, t + delay + 0.35);
      lfo.connect(depth);
      for (const osc of oscs) depth.connect(osc.detune);
      return lfo;
    },
  };
  return k;
}

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

// Voices: (kit, out, t, dur, f, vel). Each builds its nodes, schedules them and stops them.
const VOICES = {
  pad(k, out, t, dur, f, vel) {
    const amp = k.gain(0);
    const lp = k.filter('lowpass', f * 2.5, 0.5);
    lp.frequency.setTargetAtTime(Math.min(3200, f * 5), t, 0.5);
    lp.connect(amp).connect(out);
    const stop = k.envelope(
      amp.gain,
      t,
      { attack: 0.35, peak: 0.08 * vel, decay: 1.2, sustain: 0.75, release: 0.9 },
      t + dur
    );
    const sources = [-9, 0, 9].map((cents, index) => {
      const osc = k.osc('sawtooth', f, cents);
      const pan = k.ctx.createStereoPanner();
      pan.pan.value = (index - 1) * 0.45;
      osc.connect(pan).connect(lp);
      return osc;
    });
    k.play(sources, t, stop);
  },
  harp(k, out, t, dur, f, vel) {
    const amp = k.gain(0);
    const lp = k.filter('lowpass', Math.min(9000, f * 9), 0.7);
    lp.frequency.setTargetAtTime(f * 3, t, 0.15);
    lp.connect(amp).connect(out);
    const stop = k.envelope(
      amp.gain,
      t,
      { attack: 0.002, peak: 0.5 * vel, decay: clamp(2.2 - f / 600, 0.6, 2), release: 0.25 },
      t + dur
    );
    const sources = [
      [k.osc('triangle', f), 1],
      [k.osc('sine', f * 2), 0.25],
      [k.osc('sine', f * 3), 0.06],
    ].map(([osc, level]) => {
      osc.connect(k.gain(level)).connect(lp);
      return osc;
    });
    k.play(sources, t, stop);
  },
  pluck(k, out, t, dur, f, vel) {
    const amp = k.gain(0);
    const lp = k.filter('lowpass', Math.min(10000, f * 10), 3);
    lp.frequency.setTargetAtTime(f * 1.6, t, 0.07);
    lp.connect(amp).connect(out);
    const stop = k.envelope(
      amp.gain,
      t,
      { attack: 0.001, peak: 0.35 * vel, decay: 0.5, release: 0.08 },
      t + dur
    );
    const saw = k.osc('sawtooth', f);
    const square = k.osc('square', f, 7);
    saw.connect(lp);
    square.connect(k.gain(0.5)).connect(lp);
    k.play([saw, square], t, stop);
  },
  glass(k, out, t, dur, f, vel) {
    const amp = k.gain(0);
    amp.connect(out);
    const stop = k.envelope(
      amp.gain,
      t,
      { attack: 0.001, peak: 0.45 * vel, decay: 1.6, release: 0.5 },
      t + Math.max(dur, 0.3)
    );
    const [carrier, modulator] = k.fm(f, 3, t, { peak: f * 1.8 * vel, rest: f * 0.15, tc: 0.12 });
    carrier.connect(amp);
    const ping = k.osc('sine', f * 4.2);
    const pingGain = k.gain(0);
    k.hit(pingGain.gain, t, 0.12, 0.06);
    ping.connect(pingGain).connect(amp);
    k.play([carrier, modulator, ping], t, stop);
  },
  bell(k, out, t, dur, f, vel) {
    const amp = k.gain(0);
    amp.connect(out);
    const stop = k.envelope(
      amp.gain,
      t,
      { attack: 0.003, peak: 0.4 * vel, decay: 3.2, release: 1.2 },
      t + dur + 0.8
    );
    // A harmonic FM body (modulator an octave up: odd harmonics fading to a pure tone) keeps the
    // pitch unambiguous; a quiet, quickly dying inharmonic partial gives the bell colour.
    const [carrier, modulator] = k.fm(f, 2, t, { peak: f * 1.6, rest: f * 0.1, tc: 0.4 });
    carrier.connect(amp);
    const partial = k.osc('sine', f * 2.76);
    const partialGain = k.gain(0);
    k.hit(partialGain.gain, t, 0.12, 0.25);
    partial.connect(partialGain).connect(amp);
    k.play([carrier, modulator, partial], t, stop);
  },
  marimba(k, out, t, dur, f, vel) {
    const amp = k.gain(0);
    amp.connect(out);
    const stop = k.envelope(
      amp.gain,
      t,
      { attack: 0.001, peak: 0.6 * vel, decay: clamp(1.2 - f / 1500, 0.3, 1), release: 0.06 },
      t + dur
    );
    const sources = [k.osc('sine', f)];
    sources[0].connect(amp);
    for (const [ratio, level, tc] of [
      [3.93, 0.3, 0.025],
      [9.2, 0.08, 0.008],
    ]) {
      if (f * ratio > 16000) continue;
      const osc = k.osc('sine', f * ratio);
      const g = k.gain(0);
      k.hit(g.gain, t, level, tc);
      osc.connect(g).connect(amp);
      sources.push(osc);
    }
    const tick = k.noise();
    const tickGain = k.gain(0);
    k.hit(tickGain.gain, t, 0.08, 0.004);
    tick
      .connect(k.filter('bandpass', 2500, 1))
      .connect(tickGain)
      .connect(amp);
    k.play([...sources, tick], t, stop);
  },
  pizz(k, out, t, dur, f, vel) {
    const amp = k.gain(0);
    const lp = k.filter('lowpass', Math.min(5500, f * 7), 1.5);
    lp.frequency.setTargetAtTime(f * 1.6, t, 0.045);
    lp.connect(amp).connect(out);
    const stop = k.envelope(
      amp.gain,
      t,
      { attack: 0.002, peak: 0.45 * vel, decay: 0.35, release: 0.05 },
      t + dur
    );
    const saw = k.osc('sawtooth', f);
    saw.connect(lp);
    k.play([saw], t, stop);
  },
  lead(k, out, t, dur, f, vel) {
    const amp = k.gain(0);
    const lp = k.filter('lowpass', 6500, 0.5);
    lp.connect(amp).connect(out);
    const stop = k.envelope(
      amp.gain,
      t,
      { attack: 0.045, peak: 0.32 * vel, decay: 0.4, sustain: 0.85, release: 0.12 },
      t + dur
    );
    const oscs = [
      [k.osc('triangle', f), 0.7],
      [k.osc('sine', f), 0.45],
      [k.osc('sine', f * 2), 0.12],
    ].map(([osc, level]) => {
      osc.connect(k.gain(level)).connect(lp);
      return osc;
    });
    const lfo = k.vibrato(oscs, t, { rate: 5.3, cents: 14, delay: 0.18 });
    const breath = k.noise();
    const breathGain = k.gain(0);
    breathGain.gain.setValueAtTime(0, t);
    breathGain.gain.linearRampToValueAtTime(0.05, t + 0.03);
    breathGain.gain.setTargetAtTime(0.015, t + 0.03, 0.08);
    breath
      .connect(k.filter('bandpass', f * 2, 1.5))
      .connect(breathGain)
      .connect(lp);
    k.play([...oscs, lfo, breath], t, stop);
  },
  square(k, out, t, dur, f, vel) {
    const amp = k.gain(0);
    const lp = k.filter('lowpass', Math.min(7000, f * 8), 0.7);
    lp.connect(amp).connect(out);
    const stop = k.envelope(
      amp.gain,
      t,
      { attack: 0.008, peak: 0.22 * vel, decay: 0.3, sustain: 0.7, release: 0.09 },
      t + dur
    );
    const osc = k.osc('pulse25', f);
    osc.connect(lp);
    const lfo = k.vibrato([osc], t, { rate: 5.6, cents: 10, delay: 0.15 });
    k.play([osc, lfo], t, stop);
  },
  brass(k, out, t, dur, f, vel) {
    const amp = k.gain(0);
    const lp = k.filter('lowpass', f * 1.2, 1.4);
    lp.frequency.setValueAtTime(f * 1.2, t);
    lp.frequency.linearRampToValueAtTime(Math.min(6500, f * 6), t + 0.07);
    lp.frequency.setTargetAtTime(Math.min(6500, f * 3), t + 0.07, 0.35);
    lp.connect(amp).connect(out);
    const stop = k.envelope(
      amp.gain,
      t,
      { attack: 0.04, peak: 0.28 * vel, decay: 0.6, sustain: 0.75, release: 0.16 },
      t + dur
    );
    const oscs = [-6, 6].map((cents) => {
      const osc = k.osc('sawtooth', f, -25);
      osc.detune.setTargetAtTime(cents, t, 0.025);
      osc.connect(lp);
      return osc;
    });
    k.play(oscs, t, stop);
  },
  bass(k, out, t, dur, f, vel) {
    const amp = k.gain(0);
    amp.connect(out);
    const stop = k.envelope(
      amp.gain,
      t,
      { attack: 0.005, peak: 0.5 * vel, decay: 0.5, sustain: 0.5, release: 0.08 },
      t + dur
    );
    const sine = k.osc('sine', f);
    sine.connect(amp);
    const saw = k.osc('sawtooth', f);
    // Upper harmonics up to ~2.4 kHz carry the line on a phone speaker, which drops the fundamental.
    saw
      .connect(k.filter('lowpass', Math.min(f * 8, 2400), 0.7))
      .connect(k.gain(0.45))
      .connect(amp);
    k.play([sine, saw], t, stop);
  },
  epiano(k, out, t, dur, f, vel) {
    const amp = k.gain(0);
    amp.connect(out);
    const stop = k.envelope(
      amp.gain,
      t,
      { attack: 0.002, peak: 0.4 * vel, decay: 2.4, release: 0.25 },
      t + dur
    );
    const [carrier, modulator] = k.fm(f, 1, t, { peak: f * 1.1 * vel, rest: f * 0.15, tc: 0.5 });
    carrier.connect(amp);
    const tine = k.osc('sine', f * 7);
    const tineGain = k.gain(0);
    k.hit(tineGain.gain, t, 0.06, 0.015);
    tine.connect(tineGain).connect(amp);
    k.play([carrier, modulator, tine], t, stop);
  },
  celesta(k, out, t, dur, f, vel) {
    const amp = k.gain(0);
    amp.connect(out);
    const stop = k.envelope(
      amp.gain,
      t,
      { attack: 0.002, peak: 0.45 * vel, decay: 1.8, release: 0.5 },
      t + dur + 0.3
    );
    const sources = [k.osc('sine', f)];
    sources[0].connect(amp);
    for (const [ratio, level, tc] of [
      [2, 0.22, 0.35],
      [4, 0.08, 0.06],
    ]) {
      const osc = k.osc('sine', f * ratio);
      const g = k.gain(0);
      k.hit(g.gain, t, level, tc);
      osc.connect(g).connect(amp);
      sources.push(osc);
    }
    k.play(sources, t, stop);
  },
  stac(k, out, t, dur, f, vel) {
    const amp = k.gain(0);
    const lp = k.filter('lowpass', Math.min(3500, f * 6), 0.7);
    lp.connect(amp).connect(out);
    const stop = k.envelope(
      amp.gain,
      t,
      { attack: 0.006, peak: 0.22 * vel, decay: 0.15, sustain: 0.35, release: 0.05 },
      t + Math.min(dur, 0.18)
    );
    const oscs = [-7, 7].map((cents) => {
      const osc = k.osc('sawtooth', f, cents);
      osc.connect(lp);
      return osc;
    });
    k.play(oscs, t, stop);
  },
  pulse(k, out, t, dur, f, vel) {
    const amp = k.gain(0);
    const lp = k.filter('lowpass', Math.min(8000, f * 9), 2);
    lp.frequency.setTargetAtTime(f * 4, t, 0.05);
    lp.connect(amp).connect(out);
    const stop = k.envelope(
      amp.gain,
      t,
      { attack: 0.003, peak: 0.35 * vel, decay: 0.12, sustain: 0.25, release: 0.04 },
      t + dur * 0.8
    );
    const osc = k.osc('square', f);
    osc.connect(lp);
    k.play([osc], t, stop);
  },
  kick(k, out, t, dur, f, vel) {
    const body = k.osc('sine', 140);
    body.frequency.setTargetAtTime(46, t, 0.035);
    const bodyGain = k.gain(0);
    const stop = k.hit(bodyGain.gain, t, 0.9 * vel, 0.12, 0.001);
    body.connect(bodyGain).connect(out);
    const knock = k.osc('triangle', 190);
    knock.frequency.setTargetAtTime(130, t, 0.03);
    const knockGain = k.gain(0);
    k.hit(knockGain.gain, t, 0.25 * vel, 0.04, 0.001);
    knock.connect(knockGain).connect(out);
    const click = k.noise();
    const clickGain = k.gain(0);
    k.hit(clickGain.gain, t, 0.15 * vel, 0.004, 0.0005);
    click.connect(k.filter('highpass', 3000)).connect(clickGain).connect(out);
    k.play([body, knock, click], t, stop);
  },
  snare(k, out, t, dur, f, vel) {
    const sources = [];
    let stop = t;
    for (const [type, freq, q, peak, tc] of [
      ['bandpass', 1800, 0.8, 0.5, 0.06],
      ['highpass', 6500, 0.7, 0.25, 0.035],
    ]) {
      const noise = k.noise();
      const g = k.gain(0);
      stop = Math.max(stop, k.hit(g.gain, t, peak * vel, tc, 0.001));
      noise
        .connect(k.filter(type, freq, q))
        .connect(g)
        .connect(out);
      sources.push(noise);
    }
    const tone = k.osc('triangle', 205);
    tone.frequency.setTargetAtTime(170, t, 0.03);
    const toneGain = k.gain(0);
    k.hit(toneGain.gain, t, 0.35 * vel, 0.03, 0.001);
    tone.connect(toneGain).connect(out);
    k.play([...sources, tone], t, stop);
  },
  hat(k, out, t, dur, f, vel) {
    const noise = k.noise();
    const g = k.gain(0);
    const stop = k.hit(g.gain, t, 0.22 * vel, 0.012, 0.0008);
    noise.connect(k.filter('highpass', 7000)).connect(g).connect(out);
    k.play([noise], t, stop);
  },
  ohat(k, out, t, dur, f, vel) {
    const noise = k.noise();
    const g = k.gain(0);
    const stop = k.hit(g.gain, t, 0.18 * vel, 0.09, 0.001);
    noise.connect(k.filter('highpass', 6500)).connect(g).connect(out);
    k.play([noise], t, stop);
  },
  shaker(k, out, t, dur, f, vel) {
    const noise = k.noise();
    const g = k.gain(0);
    const stop = k.hit(g.gain, t, 0.25 * vel, 0.025, 0.01);
    noise
      .connect(k.filter('bandpass', 6500, 1.2))
      .connect(g)
      .connect(out);
    k.play([noise], t, stop);
  },
  tom(k, out, t, dur, f, vel) {
    const body = k.osc('sine', f);
    body.frequency.setTargetAtTime(f * 0.72, t, 0.1);
    const bodyGain = k.gain(0);
    const stop = k.hit(bodyGain.gain, t, 0.6 * vel, 0.13, 0.001);
    body.connect(bodyGain).connect(out);
    const upper = k.osc('sine', f * 2.4);
    const upperGain = k.gain(0);
    k.hit(upperGain.gain, t, 0.15 * vel, 0.05, 0.001);
    upper.connect(upperGain).connect(out);
    const skin = k.noise();
    const skinGain = k.gain(0);
    k.hit(skinGain.gain, t, 0.22 * vel, 0.02, 0.001);
    skin
      .connect(k.filter('bandpass', 1000, 1))
      .connect(skinGain)
      .connect(out);
    // A stick click around 3 kHz so the drum reads on a phone speaker.
    const click = k.noise();
    const clickGain = k.gain(0);
    k.hit(clickGain.gain, t, 0.1 * vel, 0.008, 0.0005);
    click
      .connect(k.filter('bandpass', 3000, 1.5))
      .connect(clickGain)
      .connect(out);
    k.play([body, upper, skin, click], t, stop);
  },
  metal(k, out, t, dur, f, vel) {
    const amp = k.gain(0);
    amp.connect(out);
    const stop = k.hit(amp.gain, t, 0.3 * vel, 0.1, 0.0005);
    const [carrier, modulator] = k.fm(f, 1.414, t, { peak: f * 3.5, rest: f * 0.4, tc: 0.06 });
    carrier.connect(amp);
    const second = k.osc('sine', f * 2.51);
    const secondGain = k.gain(0);
    k.hit(secondGain.gain, t, 0.35, 0.08, 0.0005);
    second.connect(secondGain).connect(amp);
    const noise = k.noise();
    const noiseGain = k.gain(0);
    k.hit(noiseGain.gain, t, 0.1 * vel, 0.02, 0.0005);
    noise.connect(k.filter('highpass', 5000)).connect(noiseGain).connect(out);
    k.play([carrier, modulator, second, noise], t, stop);
  },
  clap(k, out, t, dur, f, vel) {
    const noise = k.noise();
    const g = k.gain(0);
    g.gain.setValueAtTime(0, t);
    for (const offset of [0, 0.011, 0.022]) {
      g.gain.setValueAtTime(0.5 * vel, t + offset);
      g.gain.setTargetAtTime(0, t + offset + 0.0005, 0.004);
    }
    g.gain.setValueAtTime(0.4 * vel, t + 0.03);
    g.gain.setTargetAtTime(0, t + 0.0305, 0.06);
    noise
      .connect(k.filter('bandpass', 1200, 1.1))
      .connect(g)
      .connect(out);
    k.play([noise], t, t + 0.5);
  },
  wood(k, out, t, dur, f, vel) {
    const body = k.osc('sine', f);
    const bodyGain = k.gain(0);
    const stop = k.hit(bodyGain.gain, t, 0.5 * vel, 0.022, 0.0005);
    body.connect(bodyGain).connect(out);
    const mode = k.osc('sine', f * 2.46);
    const modeGain = k.gain(0);
    k.hit(modeGain.gain, t, 0.2 * vel, 0.012, 0.0005);
    mode.connect(modeGain).connect(out);
    const click = k.noise();
    const clickGain = k.gain(0);
    k.hit(clickGain.gain, t, 0.12 * vel, 0.004, 0.0005);
    click
      .connect(k.filter('bandpass', 2600, 2))
      .connect(clickGain)
      .connect(out);
    k.play([body, mode, click], t, stop);
  },
  rim(k, out, t, dur, f, vel) {
    const body = k.osc('triangle', f);
    const bodyGain = k.gain(0);
    const stop = k.hit(bodyGain.gain, t, 0.4 * vel, 0.012, 0.0005);
    body.connect(bodyGain).connect(out);
    const click = k.noise();
    const clickGain = k.gain(0);
    k.hit(clickGain.gain, t, 0.2 * vel, 0.008, 0.0005);
    click
      .connect(k.filter('bandpass', 3800, 3))
      .connect(clickGain)
      .connect(out);
    k.play([body, click], t, stop);
  },
  timp(k, out, t, dur, f, vel) {
    const body = k.osc('sine', f * 1.03);
    body.frequency.setTargetAtTime(f, t, 0.03);
    const bodyGain = k.gain(0);
    const stop = k.hit(bodyGain.gain, t, 0.6 * vel, 0.45, 0.002);
    body.connect(bodyGain).connect(out);
    const sources = [body];
    for (const [ratio, level, tc] of [
      [1.5, 0.18, 0.3],
      [2, 0.1, 0.2],
    ]) {
      const osc = k.osc('sine', f * ratio);
      const g = k.gain(0);
      k.hit(g.gain, t, level * vel, tc, 0.002);
      osc.connect(g).connect(out);
      sources.push(osc);
    }
    const skin = k.noise();
    const skinGain = k.gain(0);
    k.hit(skinGain.gain, t, 0.15 * vel, 0.05, 0.001);
    skin.connect(k.filter('lowpass', 500)).connect(skinGain).connect(out);
    k.play([...sources, skin], t, stop);
  },
  swell(k, out, t, dur, f, vel) {
    const noise = k.noise();
    const band = k.filter('bandpass', 400, 1.1);
    band.frequency.setValueAtTime(400, t);
    band.frequency.exponentialRampToValueAtTime(5500, t + dur);
    const g = k.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35 * vel, t + dur);
    g.gain.setTargetAtTime(0, t + dur, 0.015);
    noise.connect(band).connect(g).connect(out);
    k.play([noise], t, t + dur + 0.12);
  },
};

export const INSTRUMENTS = Object.freeze(Object.keys(VOICES));

// Stereo reverb impulse: pre-delay, a few early reflections, then decorrelated noise decaying
// to -60 dB at `seconds` whose high end darkens over time (`tone` 0 dark … 1 bright);
// normalised to unit energy so the send levels are the reverb levels.
function impulse(ctx, { seconds, predelay, tone }, seed) {
  const rate = ctx.sampleRate;
  const length = Math.ceil((seconds + predelay) * rate);
  const buffer = ctx.createBuffer(2, length, rate);
  let energy = 0;
  for (let channel = 0; channel < 2; channel++) {
    const rand = random(seed + channel * 7919);
    const data = buffer.getChannelData(channel);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const t = i / rate - predelay;
      if (t < 0) continue;
      const progress = t / seconds;
      const cutoff = (2000 + 12000 * tone) * (1 - progress) + (1200 + 3000 * tone) * progress;
      const a = Math.exp((-2 * Math.PI * cutoff) / rate);
      low = (1 - a) * (rand() * 2 - 1) + a * low;
      data[i] = low * Math.exp((-6.9078 * t) / seconds);
    }
    for (let tap = 0; tap < 6; tap++) {
      const at = Math.floor((predelay + 0.004 + rand() * 0.05) * rate);
      data[at] += (rand() < 0.5 ? -1 : 1) * 0.25 * (1 - tap / 8);
    }
    for (const value of data) energy += value * value;
  }
  const scale = 1 / Math.sqrt(energy / 2);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) data[i] *= scale;
  }
  return buffer;
}

// Renders `stems` (and, if given, only notes whose role is in `roles`) of a built score over
// loop time [start, start + length) seconds — start may be negative: notes come from the
// previous, current and next pass of the loop, so any window within one loop either side is
// seamless. Returns one Float32Array per channel.
export async function renderScore(
  score,
  { stems, roles = null, start, length, rate = SAMPLE_RATE, channels = 2, reverb = true }
) {
  const ctx = new OfflineAudioContext(channels, Math.round(length * rate), rate);
  const k = kit(ctx, hash(`${score.id}:${stems.join('+')}`));
  const { track } = score;
  // `stemGain` (dB per stem) sets a stem's level against the base, e.g. how loud the tension
  // stem plays at full tension.
  const master = k.gain(10 ** (stems.reduce((sum, stem) => sum + (track.stemGain?.[stem] ?? 0), 0) / 20));
  master.connect(ctx.destination);
  let hall = null;
  if (reverb) {
    hall = ctx.createConvolver();
    hall.normalize = false;
    hall.buffer = impulse(ctx, track.reverb, hash(`${score.id}:hall`));
    hall.connect(k.gain(track.reverb.wet)).connect(master);
  }
  const buses = new Map();
  const bus = (inst) => {
    if (!buses.has(inst)) {
      const { gain, pan, send } = track.mix[inst];
      const input = k.gain(10 ** (gain / 20));
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      input.connect(panner).connect(master);
      if (hall) input.connect(k.gain(send)).connect(hall);
      buses.set(inst, input);
    }
    return buses.get(inst);
  };
  const beat = 60 / track.bpm;
  const loopSeconds = score.loopSamples / SAMPLE_RATE;
  for (const cycle of [-1, 0, 1])
    for (const event of score.events) {
      if (!stems.includes(event.stem) || (roles && !roles.includes(event.role))) continue;
      const t = cycle * loopSeconds + event.t * beat - start;
      if (t < 0 || t >= length) continue;
      let out = bus(event.inst);
      if (event.pan) {
        const panner = ctx.createStereoPanner();
        panner.pan.value = event.pan;
        panner.connect(out);
        out = panner;
      }
      VOICES[event.inst](k, out, t, event.d * beat, hz(event.midi), event.vel * LEVEL[event.inst]);
    }
  const rendered = await ctx.startRendering();
  return Array.from({ length: channels }, (_, channel) => rendered.getChannelData(channel));
}
