// The original score of Arène de Noam, baked to assets/music/ by tools/bake-music.mjs (dev only).
//
// Identity: a bright melodic synth / chamber sound built on one original five-note motif,
// MOTIF = scale degrees 1 5 6 2' 1' (e.g. D A B E' D'), rhythm ♪ ♪ ♩ ♪ ♩. — one bar of 4/4. Its
// opening rising fifth then step is the same cell as the Signature cue (src/sound.js). Title,
// every arena and the victory state it in their own mode and voice; each loop is an A/B form of
// 8 + 8 bars (defeat: 4 + 4), so nothing repeats every four bars. All material is written for
// this game; no melody, progression or rhythm is taken from another work.
//
// Notation (validated by buildScore, so an authoring slip fails the bake):
// - Scale degrees are integers from the tonic in the track's mode (7 = the octave, -1 = the step
//   below), with an optional '#' / 'b' alteration.
// - A phrase token is `degree/length` ('.' is a rest); a length is in beats ('.5', '1.5') or in
//   triplet eighths ('2t' = 2/3 beat); no length = 1 beat; '!' accents. Each bar sums to 4 beats.
// - A chord is `degree[+mod…][/bassDegree]`, triads stacked diatonically; mods: 7, add9, sus2,
//   sus4, maj, min, dim. A bar holds one chord or an array splitting it evenly.
// - A drum grid is one bar of steps ('.' rest, 'x' hit, 'X' accent, 'g' ghost); its length sets
//   the step (16 = sixteenths, 12 = triplet eighths).
// - Bass tokens: r root, t third, f fifth, o octave, s seventh, l fifth below, '.' rest.
// - A track's `stemGain` (dB per stem) sets a stem's level against the base, e.g. how loud
//   the tension stem plays at full tension.

export const SAMPLE_RATE = 48000;
export const BEATS_PER_BAR = 4;

export const MODES = Object.freeze({
  major: Object.freeze([0, 2, 4, 5, 7, 9, 11]),
  mixolydian: Object.freeze([0, 2, 4, 5, 7, 9, 10]),
  lydian: Object.freeze([0, 2, 4, 6, 7, 9, 11]),
  dorian: Object.freeze([0, 2, 3, 5, 7, 9, 10]),
  aeolian: Object.freeze([0, 2, 3, 5, 7, 8, 10]),
  phrygian: Object.freeze([0, 1, 3, 5, 7, 8, 10]),
});

// The motif as scale degrees, and its home phrase (one bar).
export const MOTIF = Object.freeze([0, 4, 5, 8, 7]);
const M = '0/.5 4/.5 5 8/.5 7/1.5';

export const semis = (mode, degree) => mode[((degree % 7) + 7) % 7] + 12 * Math.floor(degree / 7);

function parseLength(text, where) {
  if (text === undefined || text === '') return 1;
  const triplets = /^(\d+)t$/.exec(text);
  const value = triplets ? Number(triplets[1]) / 3 : Number(text);
  if (!(value > 0)) throw new Error(`${where}: bad length "${text}"`);
  return value;
}

function parseChord(spec, mode, where) {
  const match = /^(-?\d+)((?:\+\w+)*)(?:\/(-?\d+))?$/.exec(spec);
  if (!match) throw new Error(`${where}: bad chord "${spec}"`);
  const degree = Number(match[1]);
  const mods = new Set(match[2].split('+').filter(Boolean));
  for (const mod of mods)
    if (!['7', 'add9', 'sus2', 'sus4', 'maj', 'min', 'dim'].includes(mod))
      throw new Error(`${where}: unknown chord mod "${mod}"`);
  const root = semis(mode, degree);
  let third = semis(mode, degree + 2) - root,
    fifth = semis(mode, degree + 4) - root;
  if (mods.has('maj') || mods.has('min')) [third, fifth] = [mods.has('maj') ? 4 : 3, 7];
  if (mods.has('dim')) [third, fifth] = [3, 6];
  if (mods.has('sus4')) third = 5;
  if (mods.has('sus2')) third = 2;
  const tones = [0, third, fifth];
  if (mods.has('7')) tones.push(semis(mode, degree + 6) - root);
  if (mods.has('add9')) tones.push(semis(mode, degree + 8) - root);
  const bass = match[3] === undefined ? root : semis(mode, Number(match[3]));
  return { root, tones, bass, spec };
}

// Puts a pitch class (any MIDI number) into [lo, lo + 11].
const placeIn = (midi, lo) => lo + ((((midi - lo) % 12) + 12) % 12);

class Writer {
  constructor(id, track) {
    this.id = id;
    this.track = track;
    this.mode = MODES[track.mode];
    if (!this.mode) throw new Error(`${id}: unknown mode ${track.mode}`);
    this.events = [];
    this.voicing = new Map();
    if (track.chords.length !== track.bars) throw new Error(`${id}: ${track.chords.length} chord bars`);
    this.chords = track.chords.map((bar, index) =>
      (Array.isArray(bar) ? bar : [bar]).map((spec) => parseChord(spec, this.mode, `${id} bar ${index + 1}`))
    );
  }

  chordAt(beat) {
    const bar = Math.floor(beat / BEATS_PER_BAR + 1e-9);
    const split = this.chords[bar];
    const within = beat - bar * BEATS_PER_BAR;
    return split[Math.min(split.length - 1, Math.floor((within * split.length) / BEATS_PER_BAR + 1e-9))];
  }

  emit(inst, t, d, midi, vel, opts = {}) {
    if (!(t >= 0 && t < this.track.bars * BEATS_PER_BAR - 1e-9)) throw new Error(`${this.id}: event at ${t}`);
    this.events.push({
      inst,
      t,
      d,
      midi,
      vel: vel * (opts.vel ?? 1),
      stem: opts.stem ?? 'base',
      role: opts.role ?? null,
      pan: opts.pan ?? 0,
    });
  }

  *bars([from, to]) {
    for (let bar = from; bar <= to; bar++) yield (bar - 1) * BEATS_PER_BAR;
  }

  // One phrase per bar, starting at `bar` (1-based). Tones sound for `legato` × their length.
  line(inst, bar, phrases, { oct = 12, legato = 0.92, role = 'lead', ...opts } = {}) {
    phrases.forEach((phrase, index) => {
      const where = `${this.id} ${inst} bar ${bar + index}`;
      let t = (bar - 1 + index) * BEATS_PER_BAR;
      const start = t;
      for (const token of phrase.trim().split(/\s+/)) {
        const [head, lengthText] = token.split('/');
        const length = parseLength(lengthText, where);
        if (head !== '.') {
          const match = /^(-?\d+)([#b]?)(!?)$/.exec(head);
          if (!match) throw new Error(`${where}: bad note "${token}"`);
          const alter = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
          const midi = this.track.tonic + oct + semis(this.mode, Number(match[1])) + alter;
          this.emit(inst, t, length * legato, midi, match[3] ? 1.2 : 1, { ...opts, role });
        }
        t += length;
      }
      if (Math.abs(t - start - BEATS_PER_BAR) > 1e-6)
        throw new Error(`${where}: phrase lasts ${t - start} beats`);
    });
  }

  // Broken chords: pattern indexes the chord tones upward across octaves from a root placed in
  // [lo, lo + 11], on an even `step` grid or at explicit `times` (beats in the bar; equal times
  // sound together). A tone lasts until the next onset, × `len`.
  arp(inst, range, { pattern, step = 0.5, times, lo = 50, len = 1, vel = 1, spread = 0, ...opts }) {
    const at = times ?? Array.from({ length: Math.round(BEATS_PER_BAR / step) }, (_, index) => index * step);
    for (const barStart of this.bars(range))
      at.forEach((offset, index) => {
        const tone = pattern[index % pattern.length];
        const t = barStart + offset;
        const chord = this.chordAt(t);
        const n = chord.tones.length;
        const root = placeIn(this.track.tonic + chord.root, lo);
        const midi = root + chord.tones[((tone % n) + n) % n] + 12 * Math.floor(tone / n);
        const next = at.find((other) => other > offset + 1e-9) ?? BEATS_PER_BAR;
        this.emit(inst, t, (next - offset) * len, midi, vel, {
          ...opts,
          pan: spread ? (index % 2 ? spread : -spread) : opts.pan,
        });
      });
  }

  // Sustained close-voiced chords (the inversion nearest the previous one) every `every` beats;
  // above `voices` tones the fifth is left out.
  pad(inst, range, { lo = 55, hi = 76, voices = 4, every = BEATS_PER_BAR, len = 1, vel = 1, ...opts } = {}) {
    const key = `${inst}:${opts.stem ?? 'base'}`;
    for (const barStart of this.bars(range))
      for (let t = barStart; t < barStart + BEATS_PER_BAR - 1e-9; t += every) {
        const chord = this.chordAt(t);
        const classes = chord.tones.map((tone) => (this.track.tonic + chord.root + tone) % 12);
        if (classes.length > voices) classes.splice(2, 1);
        const candidates = [];
        for (let rotation = 0; rotation < classes.length; rotation++) {
          const order = [...classes.slice(rotation), ...classes.slice(0, rotation)];
          const base = placeIn(order[0], lo);
          const notes = [base];
          for (const pc of order.slice(1))
            notes.push(notes.at(-1) + 1 + ((pc - notes.at(-1) - 1 + 120) % 12));
          if (notes.at(-1) <= hi) candidates.push(notes);
        }
        if (!candidates.length) throw new Error(`${this.id} ${inst}: no voicing for ${chord.spec}`);
        const previous = this.voicing.get(key);
        const centre = (lo + hi) / 2;
        const cost = (notes) =>
          previous
            ? notes.reduce((sum, note) => sum + Math.min(...previous.map((old) => Math.abs(note - old))), 0)
            : Math.abs(notes.reduce((a, b) => a + b) / notes.length - centre);
        const best = candidates.reduce((a, b) => (cost(b) < cost(a) ? b : a));
        this.voicing.set(key, best);
        for (const midi of best) this.emit(inst, t, every * len, midi, vel, opts);
      }
  }

  bass(inst, range, rhythm, { lo = 38, vel = 1, legato = 0.9, ...opts } = {}) {
    for (const barStart of this.bars(range)) {
      let t = barStart;
      for (const token of rhythm.trim().split(/\s+/)) {
        const [head, lengthText] = token.split('/');
        const length = parseLength(lengthText, `${this.id} ${inst}`);
        if (head !== '.') {
          const chord = this.chordAt(t);
          const root = placeIn(this.track.tonic + chord.bass, lo);
          const tones = chord.tones;
          const offset = { r: 0, t: tones[1], f: tones[2], o: 12, s: tones[3] ?? 12, l: tones[2] - 12 }[head];
          if (offset === undefined) throw new Error(`${this.id} ${inst}: bad bass token "${token}"`);
          this.emit(inst, t, length * legato, root + offset, head === 'r' ? vel : vel * 0.9, opts);
        }
        t += length;
      }
      if (Math.abs(t - barStart - BEATS_PER_BAR) > 1e-6)
        throw new Error(`${this.id} ${inst}: bass bar lasts ${t - barStart} beats`);
    }
  }

  // `pitch` is a MIDI number, or (chordRootMidi, stepIndex) => MIDI for tuned drums.
  drum(inst, range, grid, { vel = 1, pitch = 60, len = 0.25, ...opts } = {}) {
    const steps = grid.replace(/\s+/g, '');
    const step = BEATS_PER_BAR / steps.length;
    for (const barStart of this.bars(range))
      [...steps].forEach((char, index) => {
        if (char === '.') return;
        const level = { x: 1, X: 1.3, g: 0.45 }[char];
        if (level === undefined) throw new Error(`${this.id} ${inst}: bad grid char "${char}"`);
        const t = barStart + index * step;
        const midi =
          typeof pitch === 'function' ? pitch(this.track.tonic + this.chordAt(t).root, index) : pitch;
        this.emit(inst, t, len, midi, level * vel, opts);
      });
  }

  // A noise riser over the last `beats` of each listed bar (into the next section).
  swell(bars, { beats = 2, vel = 1, ...opts } = {}) {
    for (const bar of bars) this.emit('swell', bar * BEATS_PER_BAR - beats, beats, 72, vel, opts);
  }
}

const A = [1, 8],
  B = [9, 16],
  ALL = [1, 16];
// Tuned-drum pitches from the chord root: low (root) and high (fifth) toms in a midrange a
// phone speaker still plays, and timpani.
const tomLow = (root) => placeIn(root, 45);
const tomHigh = (root) => placeIn(root + 7, 52);
const timpani = (root) => placeIn(root, 38);

// The tension stem of every arena shares one grammar (a busier pulse, an ostinato on the chord
// tones, fills into each phrase) voiced in the arena's own articulation.
export const TRACKS = Object.freeze({
  // Title: the theme stated plainly — flute-like lead over harp and chamber strings; the B half
  // lifts with percussion and a glass counter-line.
  title: {
    bpm: 100,
    bars: 16,
    tonic: 62,
    mode: 'major',
    reverb: { seconds: 2.4, predelay: 0.024, tone: 0.55, wet: 1 },
    chords: [
      '0',
      '5',
      '3',
      '4',
      '0',
      '2',
      '3',
      ['4+sus4', '4'],
      '5',
      '3',
      '0',
      '4',
      '5',
      '3',
      '1+7',
      ['4+sus4', '4'],
    ],
    mix: {
      lead: { gain: -1, pan: 0, send: 0.28 },
      harp: { gain: -7, pan: -0.25, send: 0.35 },
      pad: { gain: -13, pan: 0, send: 0.45 },
      glass: { gain: -12, pan: 0.35, send: 0.5 },
      bass: { gain: -8, pan: 0, send: 0.1 },
      kick: { gain: -11, pan: 0, send: 0.05 },
      shaker: { gain: -17, pan: 0.3, send: 0.2 },
      clap: { gain: -15, pan: 0, send: 0.3 },
      timp: { gain: -10, pan: 0, send: 0.3 },
    },
    compose(w) {
      w.line('lead', 1, [
        M,
        '6 5/.5 4/.5 2/2',
        '3/.5 7/.5 8 11/.5 10/1.5',
        '9/.5 8/.5 7/.5 6/.5 5 4',
        M,
        '9 8/.5 7/.5 6 4',
        '5/.5 7/.5 8 10/.5 9/1.5',
        '8/1.5 7/.5 6/2',
        '5 7/.5 8/.5 9/2',
        '10/.5 9/.5 8 7/2',
        '4/.5 7/.5 8 9/.5 7/1.5',
        '8 6 4/2',
        '5 7/.5 8/.5 9 11',
        '10/1.5 9/.5 8 7',
        '8 7/.5 6/.5 5 4',
        '4/2 ./1 4/.5 6/.5',
      ]);
      w.arp('harp', ALL, { pattern: [0, 2, 3, 4, 5, 4, 3, 2], step: 0.5, lo: 50, len: 2, spread: 0.2 });
      w.pad('pad', A, { vel: 0.8 });
      w.pad('pad', B, { vel: 1 });
      w.bass('bass', A, 'r/2 f/2');
      w.bass('bass', B, 'r/1 r/.5 f/.5 o/1 f/1');
      w.arp('glass', B, { pattern: [5, 4, 6, 5], times: [0.5, 1.5, 2.5, 3.5], lo: 50, vel: 0.8, len: 0.9 });
      w.drum('kick', B, 'x.......x.......');
      w.drum('shaker', B, '..x...x...x...x.');
      w.drum('clap', [13, 16], '....x.......x...');
      w.drum('timp', [9, 9], 'x...............', { pitch: 38, len: 2 });
      w.drum('timp', [16, 16], '........x.x.xxxx', { pitch: 45, vel: 0.7 });
    },
  },

  // Team select, league, draft, trials: a bouncy pizzicato-and-marimba "getting ready" tune in
  // G mixolydian, the motif in a dotted, playful rhythm.
  selection: {
    bpm: 2880000 / 27000,
    bars: 16,
    tonic: 67,
    mode: 'mixolydian',
    reverb: { seconds: 1.3, predelay: 0.012, tone: 0.65, wet: 0.75 },
    chords: ['0', '6', '3', '0', '0', '6', '3', '4+maj', '3', '4', '5', '0', '3', '6', '1', '4+maj'],
    mix: {
      square: { gain: -3, pan: 0, send: 0.2 },
      marimba: { gain: -3, pan: 0.15, send: 0.2 },
      pizz: { gain: -6, pan: -0.3, send: 0.2 },
      bass: { gain: -8, pan: 0, send: 0.05 },
      pad: { gain: -16, pan: 0, send: 0.4 },
      kick: { gain: -11, pan: 0, send: 0.03 },
      wood: { gain: -14, pan: 0.35, send: 0.15 },
      shaker: { gain: -18, pan: -0.35, send: 0.1 },
      clap: { gain: -14, pan: 0, send: 0.2 },
    },
    compose(w) {
      w.line(
        'square',
        1,
        [
          '0/.75 4/.25 5 8/.5 7/1.5',
          '6/.5 5/.5 6/.5 8/.5 7/2',
          '3/.5 4/.5 5/.5 7/.5 5 3',
          '4/.5 2/.5 0 ./2',
          '0/.75 4/.25 5 8/.5 7/1.5',
          '8/.5 7/.5 6 5/.5 3/1.5',
          '5/.5 7/.5 8/.5 10/.5 9 7',
          '8/1.5 6#/.5 4/2',
        ],
        { oct: 0, legato: 0.8 }
      );
      w.line('marimba', 4, ['./2 4/.25 5/.25 6/.25 7/.25 8'], { oct: 0 });
      w.line('marimba', 8, ['./2 8/.25 9/.25 10/.25 11/.25 12'], { oct: 0, role: 'counter' });
      w.line(
        'marimba',
        9,
        [
          '7 5/.5 7/.5 10/2',
          '8/.5 7/.5 6/.5 7/.5 4/2',
          '5 7/.5 9/.5 12/2',
          '11/.5 9/.5 7 4/2',
          '3/.5 4/.5 5/.5 7/.5 10 9',
          '8 6/.5 8/.5 7/.5 6/.5 5',
          '8/.5 9/.5 10/.5 8/.5 12/2',
          '11/2 ./1.5 6#/.5',
        ],
        { oct: 0 }
      );
      w.line('square', 13, ['7/2 5/2', '6/2 5/2', '8/2 10/2', '11/2 ./2'], {
        oct: -12,
        role: 'counter',
        vel: 0.6,
      });
      w.arp('pizz', ALL, { pattern: [0, 3, 2, 3, 1, 3, 2, 3], step: 0.5, lo: 55 });
      w.bass('bass', ALL, 'r/.5 ./.5 r/.5 f/.5 ./.5 f/.5 o/.5 f/.5', { lo: 43 });
      w.pad('pad', B, { vel: 0.8 });
      w.drum('kick', ALL, 'x.....x...x.....');
      w.drum('shaker', ALL, 'gxgxgxgxgxgxgxgx');
      w.drum('wood', B, '....x.......x..x', { pitch: 84 });
      w.drum('clap', [16, 16], '............x...');
    },
  },

  // Bestiary and academy: calm C lydian music box, harp and strings; no drums in A.
  library: {
    bpm: 2880000 / 32400,
    bars: 16,
    tonic: 72,
    mode: 'lydian',
    reverb: { seconds: 2.6, predelay: 0.03, tone: 0.5, wet: 1.15 },
    chords: [
      '0+7',
      '1',
      '0+7',
      '1',
      '5+7',
      '6',
      '2+7',
      ['1+sus4', '1'],
      '4',
      '1',
      '5',
      '2',
      '4',
      '1',
      '0/4',
      '1',
    ],
    mix: {
      celesta: { gain: -2, pan: 0.1, send: 0.35 },
      harp: { gain: -8, pan: -0.3, send: 0.35 },
      pad: { gain: -12, pan: 0, send: 0.5 },
      bass: { gain: -12, pan: 0, send: 0.15 },
      glass: { gain: -15, pan: 0.4, send: 0.55 },
      shaker: { gain: -22, pan: 0.25, send: 0.3 },
    },
    compose(w) {
      w.line(
        'celesta',
        1,
        [
          '0 4 5/2',
          '8 7/3',
          './1 6/.5 5/.5 4/2',
          '3/1.5 4/.5 5/2',
          '7/1.5 6/.5 5/2',
          '6 8/.5 7/.5 6/2',
          '8/1.5 7/.5 6 4',
          '5/2 3/2',
          '4/.5 7/.5 8 9/2',
          '10/1.5 9/.5 8/2',
          '7/.5 8/.5 9 7/2',
          '6 4/.5 6/.5 4/2',
          '4/.5 7/.5 8 11/.5 10/1.5',
          '10 9/.5 8/.5 7 5',
          '7/2 4/2',
          '3/2 5 ./1',
        ],
        { oct: 0 }
      );
      w.arp('harp', ALL, { pattern: [0, 2, 3, 4, 3, 2, 1, 2], step: 0.5, lo: 48, len: 2, spread: 0.15 });
      w.pad('pad', ALL, { vel: 0.7, lo: 52, hi: 72 });
      w.bass('bass', A, 'r/4', { lo: 36 });
      w.bass('bass', B, 'r/2 f/2', { lo: 36 });
      w.arp('glass', B, { pattern: [6], times: [2], lo: 60, vel: 0.7 });
      w.drum('shaker', B, '..x...x...x...x.');
    },
  },

  // Crystal arena: struck-glass lead over a bright synth-pluck arpeggio, four-to-the-floor lift.
  crystal: {
    bpm: 2880000 / 25200,
    bars: 16,
    tonic: 62,
    mode: 'major',
    reverb: { seconds: 1.5, predelay: 0.015, tone: 0.7, wet: 0.8 },
    stemGain: { tension: 6 },
    chords: ['0', '4', '5', '3', '0', '4', '3', ['4+sus4', '4'], '5', '3', '0', '4', '5', '3', '1+7', '4'],
    mix: {
      glass: { gain: -1, pan: 0.05, send: 0.3 },
      square: { gain: -9, pan: -0.1, send: 0.2 },
      pluck: { gain: -8, pan: 0, send: 0.25 },
      pad: { gain: -15, pan: 0, send: 0.4 },
      bass: { gain: -8, pan: 0, send: 0.05 },
      kick: { gain: -10, pan: 0, send: 0.03 },
      snare: { gain: -13, pan: 0, send: 0.15 },
      hat: { gain: -19, pan: 0.3, send: 0.08 },
      ohat: { gain: -20, pan: 0.3, send: 0.1 },
      stac: { gain: -8, pan: -0.25, send: 0.2 },
      pulse: { gain: -10, pan: 0, send: 0.05 },
      tom: { gain: -11, pan: 0, send: 0.15 },
      swell: { gain: -16, pan: 0, send: 0.3 },
    },
    compose(w) {
      const lead = [
        M,
        '6/.5 4/.5 1 4/.5 6/1.5',
        '5/.5 7/.5 9 8/.5 7/1.5',
        '3/.5 4/.5 5/.5 7/.5 5/2',
        '0/.5 4/.5 5 8/.5 9/1.5',
        '8/.5 6/.5 4 6/.5 8/1.5',
        '10/.5 9/.5 7 5/.5 7/1.5',
        '8/2 7/.5 6/1.5',
        '5 9/.5 8/.5 7 5',
        '3 7/.5 8/.5 9/2',
        '4/.5 7/.5 8/.5 7/.5 4/.5 2/.5 4',
        '8/1.5 6/.5 4/2',
        '5/.5 7/.5 9/.5 12/.5 11/2',
        '10/.5 9/.5 7/.5 9/.5 10/2',
        '8/.5 9/.5 10/.5 8/.5 11/2',
        '11/1.5 10/.5 9/.5 8/.5 6',
      ];
      w.line('glass', 1, lead);
      w.line('square', 9, lead.slice(8), { oct: 0, role: 'counter', legato: 0.85 });
      w.arp('pluck', A, { pattern: [0, 2, 3, 2, 4, 2, 3, 2], step: 0.5, lo: 50, spread: 0.3 });
      w.arp('pluck', B, { pattern: [0, 2, 3, 4], step: 0.25, lo: 50, spread: 0.3 });
      w.pad('pad', B);
      w.bass('bass', A, 'r/.75 r/.75 r/.5 f/1 o/1');
      w.bass('bass', B, 'r/.5 r/.5 r/.5 r/.5 r/.5 r/.5 f/.5 o/.5');
      w.drum('kick', ALL, 'x...x...x...x...');
      w.drum('snare', ALL, '....x.......x...');
      w.drum('hat', A, 'x.x.x.x.x.x.x.x.');
      w.drum('hat', B, 'xgxgxgxgxgxgxgxg');
      const T = { stem: 'tension' };
      w.arp('stac', ALL, { pattern: [0, 2, 3, 2], step: 0.25, lo: 62, ...T });
      w.bass('pulse', ALL, 'r/.5 o/.5 r/.5 o/.5 r/.5 o/.5 r/.5 o/.5', { lo: 50, ...T });
      w.drum('ohat', ALL, '..x...x...x...x.', T);
      w.drum('tom', [4, 4], '............xxxx', { pitch: tomHigh, ...T });
      w.drum('tom', [12, 12], '............xxxx', { pitch: tomHigh, ...T });
      w.drum('snare', [8, 8], '........xxxxXXXX', { vel: 0.7, ...T });
      w.drum('snare', [16, 16], 'x.x.x.x.xxxxXXXX', { vel: 0.7, ...T });
      w.swell([8, 16], T);
    },
  },

  // Grove arena: woody marimba syncopation (3+3+2), flute answer in B, woodblock and shaker.
  grove: {
    bpm: 2880000 / 27000,
    bars: 16,
    tonic: 69,
    mode: 'dorian',
    reverb: { seconds: 1.2, predelay: 0.01, tone: 0.5, wet: 0.65 },
    stemGain: { tension: 3 },
    chords: ['0+7', '3', '0+7', '3', '2', '6', '3', '4+min', '2', '6', '3', '0', '2', '6', '1', '4+maj'],
    mix: {
      marimba: { gain: -2, pan: 0.1, send: 0.2 },
      lead: { gain: -3, pan: 0, send: 0.25 },
      pizz: { gain: -9, pan: -0.3, send: 0.2 },
      bass: { gain: -7, pan: 0, send: 0.05 },
      pad: { gain: -16, pan: 0, send: 0.4 },
      kick: { gain: -10, pan: 0, send: 0.03 },
      wood: { gain: -12, pan: 0.35, send: 0.12 },
      shaker: { gain: -17, pan: -0.3, send: 0.1 },
      clap: { gain: -14, pan: 0, send: 0.2 },
      tom: { gain: -11, pan: 0, send: 0.12 },
      stac: { gain: -7, pan: 0.25, send: 0.2 },
      pulse: { gain: -10, pan: 0, send: 0.05 },
      swell: { gain: -17, pan: 0, send: 0.3 },
    },
    compose(w) {
      w.line(
        'marimba',
        1,
        [
          '0/.5 4/.5 5/.75 8/.75 7/1.5',
          '5/.5 3/.5 5/.5 7/.5 5/.75 3/.75 2/.5',
          '0/.5 4/.5 5/.75 8/.75 9/1.5',
          '10/.75 8/.75 7/.5 5/2',
          '2/.5 4/.5 6/.5 7/.5 9/.75 7/.75 6/.5',
          '6/.5 8/.5 10/.5 8/.5 6 4',
          '3/.5 5/.5 7/.5 5/.5 3/.75 5/.75 7/.5',
          '8/1.5 7/.5 4/2',
        ],
        { oct: 0, legato: 1 }
      );
      w.line(
        'lead',
        9,
        [
          '7/1.5 9/.5 11/2',
          '10/1.5 8/.5 6/2',
          '7 8/.5 7/.5 5/2',
          '4/1.5 5/.5 7/2',
          '9 11 13/.5 11/.5 9',
          '10/1.5 11/.5 10 8',
          '8/1.5 7/.5 5 3',
          '4/2 8 6#',
        ],
        { oct: 0 }
      );
      w.arp('marimba', B, {
        pattern: [0, 2, 1, 3, 2, 1],
        times: [0, 0.75, 1.5, 2, 2.75, 3.5],
        lo: 57,
        vel: 0.7,
      });
      w.arp('pizz', A, { pattern: [0, 2, 1, 2], times: [0.5, 1.25, 2.5, 3.25], lo: 57 });
      w.pad('pad', B, { vel: 0.8 });
      w.bass('bass', ALL, 'r/.75 r/.75 f/.5 o/.75 f/.75 r/.5', { lo: 40 });
      w.drum('kick', ALL, 'x.....x...x.....');
      w.drum('wood', ALL, '..x..x....x..x..', { pitch: 79 });
      w.drum('shaker', ALL, 'gxggxggxgxggxggx');
      w.drum('clap', B, '....x.......x...');
      const T = { stem: 'tension' };
      w.drum('tom', ALL, 'x..x..x.x..x..x.', {
        pitch: (root, step) => (step % 3 ? tomHigh(root) : tomLow(root)),
        ...T,
      });
      w.drum('shaker', ALL, 'xxxxxxxxxxxxxxxx', { vel: 0.6, ...T });
      w.arp('stac', ALL, { pattern: [1, 2, 1, 2], times: [0.5, 1.5, 2.5, 3.5], lo: 57, ...T });
      w.bass('pulse', ALL, 'r/.75 r/.75 r/.5 r/.75 r/.75 f/.5', { lo: 45, ...T });
      w.drum('tom', [8, 8], '........xxxxXXXX', { pitch: tomHigh, ...T });
      w.drum('tom', [16, 16], '........xxxxXXXX', { pitch: tomHigh, ...T });
      w.swell([8, 16], T);
    },
  },

  // Tidal arena: B dorian in a rolling triplet feel — a fluid harp arpeggio with space, the motif
  // in triplet phrasing, soft brushes and an electric-piano B half.
  tidal: {
    bpm: 100,
    bars: 16,
    tonic: 71,
    mode: 'dorian',
    reverb: { seconds: 2.2, predelay: 0.022, tone: 0.55, wet: 1.05 },
    stemGain: { tension: 6 },
    chords: [
      '0+7',
      '3',
      '0+7',
      '3',
      '2+7',
      '6',
      '3',
      '4+min',
      '2+7',
      '6',
      '0+7',
      '3',
      '2+7',
      '6',
      '1',
      '4+maj',
    ],
    mix: {
      lead: { gain: 0, pan: 0, send: 0.35 },
      harp: { gain: -6, pan: -0.2, send: 0.35 },
      epiano: { gain: -9, pan: 0.25, send: 0.3 },
      pad: { gain: -15, pan: 0, send: 0.5 },
      bass: { gain: -8, pan: 0, send: 0.08 },
      kick: { gain: -12, pan: 0, send: 0.05 },
      snare: { gain: -18, pan: 0.1, send: 0.3 },
      shaker: { gain: -18, pan: 0.3, send: 0.15 },
      tom: { gain: -11, pan: 0, send: 0.2 },
      stac: { gain: -9, pan: -0.25, send: 0.25 },
      pulse: { gain: -10, pan: 0, send: 0.05 },
      ohat: { gain: -21, pan: 0.3, send: 0.2 },
      swell: { gain: -17, pan: 0, send: 0.4 },
    },
    compose(w) {
      const motif = '0/2t 4/1t 5/3t 8/2t 7/4t';
      w.line(
        'lead',
        1,
        [
          motif,
          '5/6t 4/3t 3/3t',
          '0/2t 4/1t 5/3t 8/2t 9/4t',
          '8/6t ./6t',
          '2/3t 4/3t 6/3t 8/3t',
          '7/6t 6/3t 4/3t',
          '5/3t 6/3t 7/3t 8/3t',
          '8/6t 4/6t',
          '9/6t 11/3t 9/3t',
          '8/6t 7/3t 6/3t',
          '7/2t 8/1t 9/3t 11/2t 10/4t',
          '9/6t 8/6t',
          '11/3t 12/3t 11/3t 9/3t',
          '8/6t 10/6t',
          '8/3t 7/3t 6/3t 5/3t',
          '4/6t 6#/6t',
        ],
        { oct: 0 }
      );
      w.arp('harp', ALL, {
        pattern: [0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1],
        step: 1 / 3,
        lo: 47,
        len: 3,
        spread: 0.25,
      });
      w.arp('epiano', B, {
        pattern: [1, 2, 3, 1, 2, 3],
        times: [0, 0, 0, 5 / 3, 5 / 3, 5 / 3],
        lo: 59,
        vel: 0.8,
      });
      w.pad('pad', ALL, { vel: 0.7, lo: 54, hi: 74 });
      w.bass('bass', ALL, 'r/2t ./1t f/2t r/1t o/2t ./1t f/2t ./1t', { lo: 35 });
      w.drum('kick', ALL, 'x.....x.....');
      w.drum('shaker', ALL, 'gxggxggxggxg');
      w.drum('snare', B, '...x.....x..', { vel: 0.8 });
      const T = { stem: 'tension' };
      w.drum('tom', ALL, 'x.gx.gx.gxxg', {
        pitch: (root, step) => (step % 3 === 0 ? tomLow(root) : tomHigh(root)),
        ...T,
      });
      w.arp('stac', ALL, { pattern: [0, 2, 1, 3, 2, 1], step: 1 / 3, lo: 59, ...T });
      w.bass('pulse', ALL, 'r/2t r/1t r/2t r/1t f/2t r/1t o/2t f/1t', { lo: 47, ...T });
      w.drum('ohat', ALL, '..x..x..x..x', T);
      w.swell([8, 16], T);
    },
  },

  // Volcano arena: G phrygian — a dry midrange tom ostinato and anvil hits under a brass motif;
  // the loop turns on the ♭II → i cadence.
  volcano: {
    bpm: 120,
    bars: 16,
    tonic: 67,
    mode: 'phrygian',
    reverb: { seconds: 0.9, predelay: 0.008, tone: 0.45, wet: 0.55 },
    chords: ['0', '1', '0', '1', '6', '5', '1', '0+maj', '5', '6', '1', '0', '5', '6', '3', '1'],
    mix: {
      brass: { gain: -2, pan: 0, send: 0.2 },
      tom: { gain: -6, pan: 0, send: 0.12 },
      metal: { gain: -12, pan: 0.3, send: 0.2 },
      bass: { gain: -10, pan: 0, send: 0.03 },
      pad: { gain: -14, pan: 0, send: 0.3 },
      kick: { gain: -10, pan: 0, send: 0.02 },
      clap: { gain: -12, pan: 0, send: 0.15 },
      stac: { gain: -6, pan: -0.25, send: 0.15 },
      pulse: { gain: -9, pan: 0, send: 0.03 },
      hat: { gain: -18, pan: 0.3, send: 0.05 },
      swell: { gain: -15, pan: 0, send: 0.25 },
    },
    compose(w) {
      w.line(
        'brass',
        1,
        [
          M,
          '8/.5 7/.5 5 3/.5 5/1.5',
          '0/.5 4/.5 5 8/.5 9/1.5',
          '10 9/.5 8/.5 7/2',
          '6/.5 8/.5 10 9/.5 8/1.5',
          '5/.5 7/.5 9 8/.5 7/1.5',
          '8/.5 10/.5 12 10/.5 8/1.5',
          '11/2 9#/1 ./1',
          '5 4/.5 5/.5 7/2',
          '8/1.5 6/.5 3/2',
          '5/.5 7/.5 8 10/.5 8/1.5',
          '7/1.5 4/.5 2/2',
          '5/.5 7/.5 9 8/.5 7/1.5',
          '6/.5 8/.5 10 9/.5 8/1.5',
          '3/.5 5/.5 7 10/.5 9/1.5',
          '8 7/.5 8/.5 1/2',
        ],
        { oct: 0 }
      );
      w.drum('tom', ALL, 'x..x..x.x.x.x...', {
        pitch: (root, step) => (step === 0 ? tomLow(root) : tomHigh(root)),
      });
      w.drum('metal', A, 'x.....x.........', { pitch: 79 });
      w.drum('metal', B, 'x.....x.....x.x.', { pitch: 79 });
      w.bass('bass', ALL, 'r/.5 r/.5 r/.5 r/.5 r/.5 r/.5 l/.5 r/.5', { lo: 36 });
      w.pad('pad', B, { lo: 50, hi: 70, vel: 0.9 });
      w.drum('kick', ALL, 'x.....x...x.....');
      w.drum('clap', ALL, '............x...');
      const T = { stem: 'tension' };
      w.drum('tom', ALL, 'xxxxXxxxxxxxXxxx', { pitch: tomHigh, vel: 0.7, ...T });
      w.drum('hat', ALL, 'x.x.x.x.x.x.x.x.', T);
      w.arp('stac', ALL, { pattern: [0, 0, 3, 0, 1, 0, 2, 0], step: 0.25, lo: 55, ...T });
      w.bass(
        'pulse',
        ALL,
        'r/.25 r/.25 r/.25 r/.25 r/.25 r/.25 r/.25 r/.25 r/.25 r/.25 r/.25 r/.25 l/.25 l/.25 r/.25 r/.25',
        {
          lo: 43,
          ...T,
        }
      );
      w.swell([8, 16], T);
    },
  },

  // Astral arena: E lydian, sparse FM bells with long space over a shimmering pad and a half-time
  // beat; eighth hats keep the pulse.
  astral: {
    bpm: 2880000 / 26400,
    bars: 16,
    tonic: 64,
    mode: 'lydian',
    reverb: { seconds: 2.8, predelay: 0.035, tone: 0.6, wet: 1.2 },
    stemGain: { tension: 6 },
    chords: [
      '0+7',
      '1',
      '0+7',
      '1',
      '5+7',
      '6',
      '2+7',
      '1',
      '4',
      '1',
      '5',
      '2',
      '4',
      '1',
      '0/4',
      ['1+sus4', '1'],
    ],
    mix: {
      bell: { gain: -1, pan: 0.05, send: 0.4 },
      square: { gain: -12, pan: -0.2, send: 0.35 },
      glass: { gain: -11, pan: 0.3, send: 0.45 },
      pad: { gain: -11, pan: 0, send: 0.5 },
      bass: { gain: -8, pan: 0, send: 0.08 },
      kick: { gain: -10, pan: 0, send: 0.05 },
      snare: { gain: -13, pan: 0, send: 0.3 },
      hat: { gain: -20, pan: 0.3, send: 0.1 },
      shaker: { gain: -20, pan: -0.3, send: 0.15 },
      ohat: { gain: -21, pan: 0.3, send: 0.2 },
      pulse: { gain: -11, pan: 0, send: 0.05 },
      swell: { gain: -16, pan: 0, send: 0.45 },
    },
    compose(w) {
      const lead = [
        M,
        './2 8 6',
        '0/.5 4/.5 5 8/.5 9/1.5',
        '10/2 8/2',
        '5 7 9/2',
        '8/1.5 6/.5 3/2',
        '9 7 4 6',
        '8/2 10/2',
        '11/1.5 10/.5 8/2',
        '8 10 12/2',
        '12/1.5 11/.5 9/2',
        '9 7 6/2',
        '4/.5 8/.5 9 12/.5 11/1.5',
        '10/1.5 8/.5 6/2',
        '7/2 4/2',
        '5/2 3 ./1',
      ];
      w.line('bell', 1, lead);
      w.line('square', 9, lead.slice(8), { oct: 0, role: 'counter', vel: 0.8 });
      w.arp('glass', ALL, { pattern: [0, 2, 3, 4], step: 1, lo: 52, vel: 0.7, len: 1.5 });
      w.pad('pad', ALL, { lo: 55, hi: 76 });
      w.bass('bass', A, 'r/4', { lo: 40 });
      w.bass('bass', B, 'r/2 f/2', { lo: 40 });
      w.drum('kick', ALL, 'x.........x.....');
      w.drum('snare', ALL, '........x.......');
      w.drum('hat', ALL, 'x.x.x.x.x.x.x.x.');
      w.drum('shaker', B, 'gxgxgxgxgxgxgxgx');
      const T = { stem: 'tension' };
      w.arp('glass', ALL, { pattern: [0, 2, 3, 4, 5, 4, 3, 2], step: 0.25, lo: 64, vel: 0.6, ...T });
      w.drum('kick', ALL, '..x.......x.x...', T);
      w.drum('ohat', ALL, '..x...x...x...x.', T);
      w.bass('pulse', ALL, 'r/.5 r/.5 f/.5 r/.5 o/.5 r/.5 f/.5 r/.5', { lo: 52, ...T });
      w.swell([8, 16], T);
    },
  },

  // Eclipse arena: F# aeolian, restrained broken rhythm (3+3+2 kicks, gapped hats), muted plucks
  // and a dark pad; the motif arrives in fragments, then whole, then an octave up.
  eclipse: {
    bpm: 2880000 / 25800,
    bars: 16,
    tonic: 66,
    mode: 'aeolian',
    reverb: { seconds: 1.7, predelay: 0.02, tone: 0.4, wet: 0.85 },
    stemGain: { tension: 5 },
    chords: ['0', '5', '3', '4', '0', '5', '6', '4+maj', '5+7', '6', '0', '3', '5', '6', '1', '4+maj'],
    mix: {
      pluck: { gain: -2, pan: 0, send: 0.3 },
      square: { gain: -9, pan: 0.15, send: 0.3 },
      stac: { gain: -9, pan: -0.25, send: 0.25 },
      pad: { gain: -12, pan: 0, send: 0.45 },
      bass: { gain: -8, pan: 0, send: 0.05 },
      kick: { gain: -11, pan: 0, send: 0.03 },
      clap: { gain: -13, pan: 0, send: 0.25 },
      hat: { gain: -18, pan: 0.3, send: 0.08 },
      rim: { gain: -16, pan: -0.3, send: 0.2 },
      tom: { gain: -11, pan: 0, send: 0.2 },
      pulse: { gain: -10, pan: 0, send: 0.05 },
      swell: { gain: -16, pan: 0, send: 0.35 },
    },
    compose(w) {
      const lead = [
        '0/.5 4/.5 5 ./2',
        './1 8/.75 7/1.25 ./1',
        '3/.75 5/.75 7/.5 5 ./1',
        '4/.75 6/.75 8/.5 7/2',
        M,
        '5/.75 7/.75 9/.5 8/2',
        '6/.75 8/.75 10/.5 9 8',
        '11/1.5 13#/.5 11/2',
        '9/1.5 8/.5 7 5',
        '6/.75 8/.75 10/.5 8/2',
        '7/.5 11/.5 12 15/.5 14/1.5',
        '10/1.5 9/.5 7/2',
        '12 11/.5 12/.5 14/2',
        '13/1.5 11/.5 10/2',
        '10 8 5 3',
        '4/2 6# 4',
      ];
      w.line('pluck', 1, lead, { oct: 0, legato: 1 });
      w.line('square', 9, lead.slice(8), { oct: -12, role: 'counter', vel: 0.8 });
      w.arp('stac', ALL, {
        pattern: [0, 2, 1, 3, 2, 1],
        times: [0, 0.75, 1.5, 2, 2.75, 3.5],
        lo: 54,
        vel: 0.8,
      });
      w.pad('pad', ALL, { lo: 50, hi: 70, vel: 0.8 });
      w.bass('bass', ALL, 'r/.75 r/.75 r/.5 ./1 f/.5 r/.5', { lo: 38 });
      w.drum('kick', ALL, 'x..x..x.........');
      w.drum('clap', ALL, '........x.......');
      w.drum('hat', ALL, 'x.x..x.x.x..x.x.');
      w.drum('rim', B, '...x......x...x.', { pitch: 84 });
      const T = { stem: 'tension' };
      w.drum('hat', ALL, 'XxxXxxXxXxxXxxXx', { vel: 0.7, ...T });
      w.bass('pulse', ALL, 'r/.5 r/.5 r/.5 ./.5 r/.5 r/.5 f/.5 r/.5', { lo: 50, ...T });
      w.drum('tom', [4, 4], '..........xxXXXX', { pitch: tomHigh, ...T });
      w.drum('tom', [8, 8], '........xxxxXXXX', { pitch: tomHigh, ...T });
      w.drum('tom', [12, 12], '..........xxXXXX', { pitch: tomHigh, ...T });
      w.drum('tom', [16, 16], '........xxxxXXXX', { pitch: tomHigh, ...T });
      w.arp('stac', ALL, { pattern: [3, 4, 3, 5], times: [0.25, 1, 2.25, 3], lo: 66, vel: 0.7, ...T });
      w.swell([8, 16], T);
    },
  },

  // Victory: the motif as a brass fanfare with timpani and a march snare, then a bright lap of
  // honour with claps and a synth lead.
  victory: {
    bpm: 120,
    bars: 16,
    tonic: 67,
    mode: 'major',
    reverb: { seconds: 1.8, predelay: 0.02, tone: 0.6, wet: 0.85 },
    chords: ['0', '4', '3', '4', '0', '5', '3', '4', '3', '4', '2', '5', '3', '4', '0/4', '4+7'],
    mix: {
      brass: { gain: -1, pan: 0, send: 0.25 },
      square: { gain: -3, pan: 0.1, send: 0.2 },
      pad: { gain: -12, pan: 0, send: 0.4 },
      pluck: { gain: -10, pan: -0.25, send: 0.25 },
      bass: { gain: -6, pan: 0, send: 0.05 },
      timp: { gain: -8, pan: 0, send: 0.25 },
      snare: { gain: -14, pan: 0.1, send: 0.2 },
      kick: { gain: -9, pan: 0, send: 0.03 },
      clap: { gain: -13, pan: 0, send: 0.2 },
      hat: { gain: -19, pan: 0.3, send: 0.08 },
    },
    compose(w) {
      w.line(
        'brass',
        1,
        [
          '0!/.5 4/.5 5 8/.5 7/1.5',
          '4/.5 4/.5 8 7/.5 6/1.5',
          '3!/.5 7/.5 8 11/.5 10/1.5',
          '9/.5 8/.5 7/.5 6/.5 4/2',
          '0!/.5 4/.5 5 8/.5 9/1.5',
          '9/.5 8/.5 7 5/.5 4/1.5',
          '7/.5 8/.5 9 10/.5 9/1.5',
          '8 11 ./.5 11/.5 11',
        ],
        { oct: 0 }
      );
      w.line(
        'square',
        9,
        [
          '10/1.5 9/.5 7/2',
          '8/1.5 7/.5 6/2',
          '9/.5 8/.5 9/.5 11/.5 9/2',
          '7/1.5 5/.5 4/2',
          '3/.5 7/.5 8 11/.5 10/1.5',
          '11/.5 9/.5 11/.5 12/.5 11/2',
          '7 9 11/2',
          '12 11/.5 10/.5 9 8',
        ],
        { oct: 0 }
      );
      w.pad('brass', B, { every: 2, len: 0.35, lo: 55, hi: 72, voices: 3, vel: 0.5 });
      w.pad('pad', ALL, { lo: 55, hi: 74, vel: 0.9 });
      w.arp('pluck', B, { pattern: [0, 2, 3, 4, 3, 2, 3, 4], step: 0.5, lo: 55, spread: 0.3 });
      w.bass('bass', ALL, 'r f o f', { lo: 43 });
      w.drum('timp', A, 'x.......x.......', { pitch: timpani, len: 1 });
      w.drum('timp', [8, 8], 'x...x...xxxxXXXX', { pitch: 50, vel: 0.8 });
      w.drum('snare', A, 'x..x.xx.x..x.xx.', { vel: 0.6 });
      w.drum('kick', B, 'x...x...x...x...');
      w.drum('clap', B, '....x.......x...');
      w.drum('hat', B, '..x...x...x...x.');
      w.drum('snare', [16, 16], '........xxxxXXXX', { vel: 0.7 });
    },
  },

  // Defeat: A aeolian, slow and dignified — the motif's opening sighs once, strings and electric
  // piano, a half cadence that loops home. Four plus four bars, no drums.
  defeat: {
    bpm: 80,
    bars: 8,
    tonic: 69,
    mode: 'aeolian',
    reverb: { seconds: 2.4, predelay: 0.028, tone: 0.45, wet: 1.15 },
    chords: ['0', '5', '2', '6', '3+7', '5', '3', ['4+sus4', '4+maj']],
    mix: {
      lead: { gain: -3, pan: 0, send: 0.35 },
      epiano: { gain: -6, pan: -0.15, send: 0.35 },
      pad: { gain: -10, pan: 0, send: 0.5 },
      bass: { gain: -10, pan: 0, send: 0.1 },
    },
    compose(w) {
      w.line(
        'lead',
        1,
        [
          '0 4 5/2',
          '4 2/.5 3/.5 0/2',
          '2 4 7/2',
          '6 4/.5 5/.5 1/2',
          '3 5 7/1.5 6/.5',
          '5/1.5 4/.5 2/2',
          '5 3/.5 2/.5 3/2',
          '4/2 -1#/2',
        ],
        { oct: 0 }
      );
      w.arp('epiano', [1, 8], { pattern: [0, 2, 3, 2], step: 1, lo: 57, vel: 0.8 });
      w.pad('pad', [1, 8], { lo: 55, hi: 74, vel: 0.8 });
      w.bass('bass', [1, 8], 'r/4', { lo: 38 });
    },
  },
});

// Every note of one track as { inst, t, d, midi, vel, stem, role, pan } (t, d in beats), plus the
// loop length in samples; throws on any authoring error.
export function buildScore(id) {
  const track = TRACKS[id];
  if (!track) throw new Error(`unknown track ${id}`);
  const samplesPerBeat = (SAMPLE_RATE * 60) / track.bpm;
  if (Math.abs(samplesPerBeat - Math.round(samplesPerBeat)) > 1e-6)
    throw new Error(`${id}: ${track.bpm} BPM is not a whole number of samples per beat`);
  const writer = new Writer(id, track);
  track.compose(writer);
  for (const event of writer.events)
    if (!track.mix[event.inst]) throw new Error(`${id}: ${event.inst} has no mix`);
  writer.events.sort((a, b) => a.t - b.t || a.midi - b.midi);
  return {
    id,
    track,
    events: writer.events,
    samplesPerBeat: Math.round(samplesPerBeat),
    loopSamples: Math.round(samplesPerBeat) * track.bars * BEATS_PER_BAR,
    stems: [...new Set(writer.events.map((event) => event.stem))].sort(),
  };
}
