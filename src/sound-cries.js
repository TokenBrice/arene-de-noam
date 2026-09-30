// Creature cries (AUD-07): thirty authored voices, synthesised at runtime by sound.js.
//
// Each profile is a small score for one creature: a base pitch `f0`, a few layers (syllables,
// clicks, breaths, rings) and two authored variant shapes. A layer is either a tone (`wave`, a
// pitch contour in ratios of `f0`) or a noise (`noise`: 'white' | 'crackle' | 'rustle'), with
// optional filters, vibrato (`vib`), amplitude flutter (`am`: purr, rasp, bleat, wing beats) and
// a sine FM modulator (`fm`: glass, metal, bells). Vowel colour comes from two formant peaks.
// Species, size and type pick the palette: big bodies sit low with slow envelopes and growl,
// small ones chirp; Psy rings, Combat barks, Eau gurgles and bubbles, Feu crackles and hisses,
// Plante hoots and rustles, Ténèbres breathes, hisses and warbles. Low voices keep their
// identity in formants and harmonics inside the 0.5–3 kHz band a phone speaker plays.
//
// Variants: `entry` is the score as written (arrival and the team-select pick); `effort`
// (Signature) is higher, tighter, brighter and more exaggerated, sometimes roughened; `faint`
// is lower and slower, every tone sags at its end, the timbre darkens and a breath settles
// under it. Speed trims happen in sound.js (shorter, same pitch).
//
// Everything here is pure data and planning: cryPlan() resolves a profile to absolute Hz and
// seconds, and sound.js turns the plan into Web Audio nodes.

export const CRY_VARIANTS = Object.freeze(['entry', 'effort', 'faint']);

// First two formants (Hz) of the vowel colours the voices glide between.
const VOWELS = Object.freeze({
  a: [750, 1250],
  ae: [660, 1720],
  e: [480, 1900],
  i: [320, 2450],
  o: [520, 950],
  u: [360, 780],
});

// Two formant peaks gliding from one vowel to another across the layer.
const vowel = (from, to = from, db = 12, q = 4) => [
  ['peaking', VOWELS[from][0], VOWELS[to][0], q, db],
  ['peaking', VOWELS[from][1], VOWELS[to][1], q, db],
];
// A closed-mouth nasal hum ("mm"), its colour kept around 1 kHz for phone speakers.
const HUM = Object.freeze([
  ['highpass', 240, 240, 0.7],
  ['lowpass', 1500, 1500, 0.9],
  ['peaking', 1100, 1100, 3, 10],
]);

const effort = (pitch, time, bend, bright, grit = null) => ({ pitch, time, bend, bright, grit });
const faint = (pitch, time, fall, dark) => ({ pitch, time, fall, dark });

export const CRY_PROFILES = Object.freeze({
  // Psy — a crystal mantis seer: three glassy ticks, then a ringing "ii-ee".
  orakyn: {
    f0: 620,
    breath: 2400,
    layers: [
      {
        wave: 'sine',
        at: 0,
        dur: 0.2,
        gain: 0.05,
        pitch: [
          [0, 2],
          [0.34, 2.24],
          [0.67, 2.52],
        ],
        steps: true,
        am: [15, 1],
        fm: [3.5, 0.8],
        attack: 0.004,
        hold: 0.15,
      },
      {
        wave: 'triangle',
        at: 0.19,
        dur: 0.42,
        gain: 0.06,
        pitch: [
          [0, 1],
          [0.25, 1.19],
          [1, 1.12],
        ],
        vib: [6.5, 0.018],
        fm: [2.76, 0.3],
        filters: vowel('i', 'e'),
        attack: 0.015,
        hold: 0.16,
      },
    ],
    effort: effort(1.1, 0.8, 1.4, 1.2),
    faint: faint(0.86, 1.4, 0.7, 0.7),
  },
  // Psy — a ringed bird-dragon: a three-voice chord swelling open, with a ring's "ting".
  lumivox: {
    f0: 440,
    breath: 1800,
    layers: [
      {
        wave: 'sawtooth',
        at: 0,
        dur: 0.5,
        gain: 0.03,
        pitch: [
          [0, 0.94],
          [0.2, 1],
        ],
        filters: vowel('a', 'o'),
        attack: 0.04,
        hold: 0.25,
      },
      {
        wave: 'sawtooth',
        at: 0.05,
        dur: 0.45,
        gain: 0.026,
        pitch: [
          [0, 1.19],
          [0.2, 1.26],
        ],
        filters: vowel('a', 'o'),
        attack: 0.04,
        hold: 0.2,
      },
      {
        wave: 'sawtooth',
        at: 0.1,
        dur: 0.4,
        gain: 0.024,
        pitch: [
          [0, 1.42],
          [0.2, 1.5],
        ],
        vib: [5.5, 0.012],
        filters: vowel('e', 'o'),
        attack: 0.04,
        hold: 0.15,
      },
      { wave: 'sine', at: 0.02, dur: 0.35, gain: 0.02, pitch: 4, attack: 0.002 },
    ],
    effort: effort(1.12, 0.7, 1, 1.3, [30, 0.25]),
    faint: faint(0.84, 1.5, 0.75, 0.65),
  },
  // Psy — a silver moth: a soft sighing "hoo" fluttering with its wing beats over dust.
  mnemora: {
    f0: 700,
    breath: 3000,
    layers: [
      {
        wave: 'triangle',
        at: 0,
        dur: 0.5,
        gain: 0.06,
        pitch: [
          [0, 1.12],
          [0.4, 0.95],
          [1, 1.06],
        ],
        am: [19, 0.8],
        filters: vowel('u', 'o'),
        attack: 0.05,
        hold: 0.25,
      },
      {
        noise: 'white',
        at: 0.02,
        dur: 0.45,
        gain: 0.03,
        filters: [['highpass', 5000, 7000, 0.7]],
        am: [19, 0.6],
        attack: 0.06,
        hold: 0.2,
      },
    ],
    effort: effort(1.15, 0.8, 1.3, 1.2),
    faint: faint(0.85, 1.5, 0.7, 0.7),
  },
  // Psy — a crystal lion: a short "rya!" that shatters into ringing glass partials.
  prismage: {
    f0: 360,
    breath: 2200,
    layers: [
      {
        wave: 'sawtooth',
        at: 0,
        dur: 0.22,
        gain: 0.035,
        pitch: [
          [0, 0.9],
          [0.3, 1.15],
          [1, 0.95],
        ],
        am: [28, 0.2],
        filters: vowel('i', 'a'),
        attack: 0.008,
        hold: 0.08,
      },
      { wave: 'sine', at: 0.12, dur: 0.6, gain: 0.045, pitch: 5.4, fm: [2.76, 0.08], attack: 0.002 },
      { wave: 'sine', at: 0.15, dur: 0.55, gain: 0.035, pitch: 7.93, attack: 0.002 },
      { wave: 'sine', at: 0.18, dur: 0.5, gain: 0.025, pitch: 10.7, attack: 0.002 },
      {
        noise: 'white',
        at: 0.12,
        dur: 0.1,
        gain: 0.05,
        filters: [['highpass', 3500, 5000, 0.8]],
        attack: 0.002,
      },
    ],
    effort: effort(1.1, 0.85, 1.3, 1.25),
    faint: faint(0.85, 1.5, 0.7, 0.7),
  },
  // Combat — a goat duelist: a barked "hup-HAH!" and its bracers singing after it.
  kordane: {
    f0: 190,
    breath: 1100,
    layers: [
      {
        noise: 'white',
        at: 0,
        dur: 0.05,
        gain: 0.06,
        filters: [['bandpass', 1300, 900, 1.4]],
        attack: 0.002,
      },
      {
        wave: 'sawtooth',
        at: 0.01,
        dur: 0.13,
        gain: 0.05,
        pitch: [
          [0, 1.1],
          [1, 1.25],
        ],
        filters: vowel('u', 'a'),
        attack: 0.006,
        hold: 0.06,
      },
      {
        wave: 'sawtooth',
        at: 0.2,
        dur: 0.22,
        gain: 0.055,
        pitch: [
          [0, 1.35],
          [0.3, 1.42],
          [1, 1.05],
        ],
        filters: vowel('a'),
        attack: 0.006,
        hold: 0.08,
      },
      {
        wave: 'sine',
        at: 0.21,
        dur: 0.5,
        gain: 0.03,
        pitch: 7.8,
        fm: [1.41, 0.35],
        vib: [9, 0.004],
        attack: 0.002,
      },
    ],
    effort: effort(1.12, 0.85, 1.2, 1.3, [40, 0.35]),
    faint: faint(0.85, 1.4, 0.72, 0.65),
  },
  // Combat — a mountain-sized tusked beast: a trumpeting, growling bellow over a rumble.
  brontusk: {
    f0: 105,
    breath: 700,
    layers: [
      { noise: 'white', at: 0, dur: 0.28, gain: 0.04, filters: [['lowpass', 420, 300, 0.8]], attack: 0.03 },
      {
        wave: 'sawtooth',
        at: 0.02,
        dur: 0.7,
        gain: 0.05,
        pitch: [
          [0, 0.85],
          [0.2, 1.3],
          [0.6, 1.35],
          [1, 0.95],
        ],
        am: [31, 0.35],
        vib: [4.5, 0.02],
        filters: [
          ['highpass', 150, 150, 0.6],
          ['peaking', 900, 1150, 5, 14],
          ['peaking', 2200, 2400, 3, 8],
          ['lowpass', 3200, 2400, 0.7],
        ],
        attack: 0.05,
        hold: 0.35,
      },
      {
        wave: 'square',
        at: 0.07,
        dur: 0.55,
        gain: 0.018,
        pitch: [
          [0, 1.8],
          [0.25, 2.66],
          [0.7, 2.7],
          [1, 1.9],
        ],
        filters: [['bandpass', 1400, 1600, 2]],
        attack: 0.06,
        hold: 0.25,
      },
    ],
    effort: effort(1.12, 0.75, 1.2, 1.25),
    faint: faint(0.82, 1.35, 0.7, 0.65),
  },
  // Combat — a blade raptor: a metallic "shiing!" and two dry "kek"s, over in a blink.
  ferrax: {
    f0: 900,
    breath: 3200,
    layers: [
      {
        wave: 'sawtooth',
        at: 0,
        dur: 0.13,
        gain: 0.035,
        pitch: [
          [0, 1],
          [1, 1.9],
        ],
        fm: [1.41, 1.2],
        filters: [['bandpass', 2200, 3800, 5]],
        attack: 0.003,
        hold: 0.04,
      },
      {
        noise: 'white',
        at: 0,
        dur: 0.12,
        gain: 0.04,
        filters: [['highpass', 4000, 6000, 0.7]],
        attack: 0.002,
      },
      {
        wave: 'square',
        at: 0.16,
        dur: 0.05,
        gain: 0.03,
        pitch: [
          [0, 0.9],
          [1, 0.8],
        ],
        filters: vowel('e'),
        attack: 0.002,
      },
      {
        wave: 'square',
        at: 0.23,
        dur: 0.06,
        gain: 0.03,
        pitch: [
          [0, 0.95],
          [1, 0.82],
        ],
        filters: vowel('e'),
        attack: 0.002,
      },
    ],
    effort: effort(1.1, 0.8, 1.2, 1.2, [70, 0.3]),
    faint: faint(0.85, 1.6, 0.65, 0.6),
  },
  // Combat — a stone golem: a slow grinding "hrrmm" of rubble, then one low "m".
  monolith: {
    f0: 82,
    breath: 500,
    layers: [
      {
        noise: 'crackle',
        at: 0,
        dur: 0.62,
        gain: 0.28,
        filters: [['bandpass', 700, 450, 1.2]],
        am: [11, 0.5],
        attack: 0.08,
        hold: 0.3,
      },
      {
        wave: 'square',
        at: 0.02,
        dur: 0.62,
        gain: 0.04,
        pitch: [
          [0, 0.95],
          [0.5, 1.06],
          [1, 0.9],
        ],
        filters: [['highpass', 160, 160, 0.6], ...vowel('o', 'u', 14), ['lowpass', 1500, 1100, 0.7]],
        am: [11, 0.5],
        attack: 0.12,
        hold: 0.3,
      },
      {
        wave: 'sawtooth',
        at: 0.74,
        dur: 0.26,
        gain: 0.05,
        pitch: [
          [0, 0.9],
          [1, 0.84],
        ],
        filters: [
          ['highpass', 160, 160, 0.6],
          ['peaking', 400, 400, 3, 10],
          ['peaking', 1100, 1100, 4, 10],
          ['lowpass', 1300, 1300, 0.7],
        ],
        attack: 0.03,
        hold: 0.08,
      },
    ],
    effort: effort(1.15, 0.8, 1.2, 1.3),
    faint: faint(0.85, 1.3, 0.75, 0.7),
  },
  // Eau — a sea-dragon gatekeeper: a long, high whale moan over its own undertone, ending in a gurgle.
  abyssar: {
    f0: 300,
    breath: 800,
    layers: [
      {
        wave: 'triangle',
        at: 0,
        dur: 0.8,
        gain: 0.07,
        pitch: [
          [0, 0.9],
          [0.35, 1.45],
          [0.7, 1.3],
          [1, 1.05],
        ],
        vib: [3.8, 0.025],
        filters: vowel('u', 'o', 14),
        attack: 0.1,
        hold: 0.4,
      },
      {
        wave: 'sawtooth',
        at: 0.03,
        dur: 0.72,
        gain: 0.025,
        pitch: [
          [0, 0.45],
          [0.35, 0.72],
          [0.7, 0.65],
          [1, 0.52],
        ],
        filters: [['bandpass', 700, 1000, 1.5]],
        attack: 0.12,
        hold: 0.3,
      },
      {
        noise: 'crackle',
        at: 0.45,
        dur: 0.35,
        gain: 0.16,
        filters: [['bandpass', 700, 500, 1]],
        attack: 0.02,
      },
    ],
    effort: effort(1.15, 0.75, 1.2, 1.25, [26, 0.35]),
    faint: faint(0.85, 1.3, 0.75, 0.7),
  },
  // Eau — a wave-surfing raptor: a shrill "kree-yah!" breaking into spray and a droplet.
  riptalon: {
    f0: 820,
    breath: 2600,
    layers: [
      {
        wave: 'sawtooth',
        at: 0,
        dur: 0.32,
        gain: 0.04,
        pitch: [
          [0, 0.9],
          [0.2, 1.2],
          [0.55, 1.15],
          [1, 0.7],
        ],
        am: [55, 0.3],
        filters: vowel('i', 'a'),
        attack: 0.008,
        hold: 0.12,
      },
      {
        noise: 'white',
        at: 0.2,
        dur: 0.16,
        gain: 0.06,
        filters: [['bandpass', 1800, 3200, 1.2]],
        attack: 0.01,
      },
      {
        wave: 'sine',
        at: 0.3,
        dur: 0.06,
        gain: 0.025,
        pitch: [
          [0, 1.9],
          [1, 2.9],
        ],
        attack: 0.003,
      },
    ],
    effort: effort(1.08, 0.85, 1.3, 1.2),
    faint: faint(0.85, 1.5, 0.65, 0.6),
  },
  // Eau — a bubble-crowned fawn: three rising "bloop"s and a sweet trill.
  nymbloom: {
    f0: 520,
    breath: 2000,
    layers: [
      {
        wave: 'triangle',
        at: 0,
        dur: 0.09,
        gain: 0.05,
        pitch: [
          [0, 0.8],
          [1, 1.4],
        ],
        filters: [['lowpass', 700, 3200, 1.5]],
        attack: 0.004,
      },
      {
        wave: 'triangle',
        at: 0.11,
        dur: 0.09,
        gain: 0.05,
        pitch: [
          [0, 1],
          [1, 1.76],
        ],
        filters: [['lowpass', 800, 3600, 1.5]],
        attack: 0.004,
      },
      {
        wave: 'triangle',
        at: 0.22,
        dur: 0.09,
        gain: 0.05,
        pitch: [
          [0, 1.2],
          [1, 2.1],
        ],
        filters: [['lowpass', 900, 4000, 1.5]],
        attack: 0.004,
      },
      {
        wave: 'sine',
        at: 0.33,
        dur: 0.3,
        gain: 0.04,
        pitch: [
          [0, 2],
          [0.3, 2.1],
          [1, 2],
        ],
        vib: [7, 0.02],
        attack: 0.02,
        hold: 0.1,
      },
    ],
    effort: effort(1.12, 0.8, 1.2, 1.2),
    faint: faint(0.85, 1.5, 0.7, 0.7),
  },
  // Eau — a storm eel: a crackling "bzzt" then a wobbling electric "wiiu".
  voltide: {
    f0: 220,
    breath: 1800,
    layers: [
      {
        noise: 'crackle',
        at: 0,
        dur: 0.25,
        gain: 0.2,
        filters: [['highpass', 2500, 2500, 0.7]],
        attack: 0.003,
      },
      {
        wave: 'square',
        at: 0,
        dur: 0.2,
        gain: 0.035,
        pitch: 1,
        am: [60, 0.7],
        filters: [['bandpass', 1500, 1800, 1.5]],
        attack: 0.004,
        hold: 0.12,
      },
      {
        wave: 'sawtooth',
        at: 0.2,
        dur: 0.35,
        gain: 0.04,
        pitch: [
          [0, 2.2],
          [0.3, 3],
          [1, 1.6],
        ],
        vib: [22, 0.06],
        filters: vowel('i', 'u'),
        attack: 0.01,
        hold: 0.12,
      },
    ],
    effort: effort(1.1, 0.8, 1.25, 1.25),
    faint: faint(0.85, 1.4, 0.65, 0.65),
  },
  // Feu — a lava tortoise: a bubbling "blorrp" with embers, then a puff of steam.
  calderoc: {
    f0: 120,
    breath: 900,
    layers: [
      {
        wave: 'sawtooth',
        at: 0,
        dur: 0.38,
        gain: 0.055,
        pitch: [
          [0, 1.1],
          [0.4, 0.95],
          [1, 0.8],
        ],
        am: [9, 0.7],
        filters: [
          ['highpass', 180, 180, 0.6],
          ['lowpass', 500, 1800, 2],
          ['peaking', 700, 900, 3, 10],
        ],
        attack: 0.02,
        hold: 0.18,
      },
      {
        noise: 'crackle',
        at: 0.05,
        dur: 0.3,
        gain: 0.22,
        filters: [['bandpass', 2200, 2200, 1.2]],
        attack: 0.01,
      },
      {
        noise: 'white',
        at: 0.36,
        dur: 0.3,
        gain: 0.035,
        filters: [['highpass', 3000, 5000, 0.7]],
        attack: 0.05,
      },
    ],
    effort: effort(1.12, 0.8, 1.2, 1.3),
    faint: faint(0.85, 1.4, 0.72, 0.65),
  },
  // Feu — a many-tailed fox: "yip-yip-YAOW" and a flick of sparks.
  pyrolynx: {
    f0: 640,
    breath: 2400,
    layers: [
      {
        wave: 'sawtooth',
        at: 0,
        dur: 0.07,
        gain: 0.035,
        pitch: [
          [0, 1],
          [0.5, 1.6],
          [1, 1.2],
        ],
        filters: vowel('i'),
        attack: 0.004,
      },
      {
        wave: 'sawtooth',
        at: 0.1,
        dur: 0.07,
        gain: 0.035,
        pitch: [
          [0, 1.05],
          [0.5, 1.68],
          [1, 1.25],
        ],
        filters: vowel('i'),
        attack: 0.004,
      },
      {
        wave: 'sawtooth',
        at: 0.21,
        dur: 0.22,
        gain: 0.045,
        pitch: [
          [0, 1.2],
          [0.3, 1.75],
          [1, 1.05],
        ],
        am: [40, 0.25],
        filters: vowel('i', 'a'),
        attack: 0.006,
        hold: 0.07,
      },
      {
        noise: 'crackle',
        at: 0.3,
        dur: 0.14,
        gain: 0.18,
        filters: [['bandpass', 3000, 3000, 1.2]],
        attack: 0.004,
      },
    ],
    effort: effort(1.1, 0.85, 1.25, 1.2),
    faint: faint(0.84, 1.5, 0.68, 0.65),
  },
  // Feu — a furry ash moth: two breathy chuffs, then a purring "rrouh" over embers.
  magmoth: {
    f0: 160,
    breath: 1000,
    layers: [
      { noise: 'white', at: 0, dur: 0.07, gain: 0.08, filters: [['bandpass', 800, 600, 1.2]], attack: 0.004 },
      {
        noise: 'white',
        at: 0.13,
        dur: 0.07,
        gain: 0.08,
        filters: [['bandpass', 850, 650, 1.2]],
        attack: 0.004,
      },
      {
        wave: 'sawtooth',
        at: 0.26,
        dur: 0.45,
        gain: 0.05,
        pitch: [
          [0, 0.9],
          [0.4, 1.15],
          [1, 0.95],
        ],
        am: [24, 0.65],
        filters: [['highpass', 200, 200, 0.6], ...vowel('o', 'u'), ['lowpass', 2200, 1600, 0.7]],
        attack: 0.04,
        hold: 0.2,
      },
      {
        noise: 'crackle',
        at: 0.5,
        dur: 0.22,
        gain: 0.15,
        filters: [['lowpass', 3500, 3500, 0.7]],
        attack: 0.01,
      },
    ],
    effort: effort(1.15, 0.8, 1.2, 1.3),
    faint: faint(0.85, 1.35, 0.75, 0.65),
  },
  // Feu — a sun lion: one roar climbing a fifth toward the sun, bright and brassy, flaring sparks.
  solflare: {
    f0: 280,
    breath: 1100,
    layers: [
      {
        wave: 'sawtooth',
        at: 0,
        dur: 0.55,
        gain: 0.05,
        pitch: [
          [0, 0.8],
          [0.3, 1],
          [0.75, 1.5],
          [1, 1.42],
        ],
        am: [36, 0.3],
        filters: [...vowel('o', 'ae'), ['peaking', 3000, 3200, 3, 8]],
        attack: 0.03,
        hold: 0.28,
      },
      {
        noise: 'white',
        at: 0,
        dur: 0.5,
        gain: 0.06,
        filters: [['bandpass', 900, 1800, 0.9]],
        attack: 0.06,
        hold: 0.15,
      },
      {
        noise: 'crackle',
        at: 0.3,
        dur: 0.3,
        gain: 0.2,
        filters: [['highpass', 3000, 3000, 0.7]],
        attack: 0.03,
      },
    ],
    effort: effort(1.1, 0.8, 1.25, 1.25),
    faint: faint(0.84, 1.4, 0.7, 0.65),
  },
  // Plante — a leaf fawn: a breathy flute "hoo-wee" rising a fourth.
  virelia: {
    f0: 700,
    breath: 1500,
    layers: [
      {
        wave: 'triangle',
        at: 0,
        dur: 0.18,
        gain: 0.05,
        pitch: [
          [0, 0.97],
          [1, 1],
        ],
        attack: 0.03,
        hold: 0.08,
      },
      { noise: 'white', at: 0, dur: 0.18, gain: 0.025, filters: [['bandpass', 1400, 1400, 4]], attack: 0.03 },
      {
        wave: 'triangle',
        at: 0.2,
        dur: 0.32,
        gain: 0.055,
        pitch: [
          [0, 1.26],
          [0.4, 1.5],
          [1, 1.49],
        ],
        vib: [5, 0.012],
        attack: 0.03,
        hold: 0.15,
      },
      {
        noise: 'white',
        at: 0.2,
        dur: 0.3,
        gain: 0.022,
        filters: [['bandpass', 2100, 2100, 4]],
        attack: 0.04,
      },
    ],
    effort: effort(1.12, 0.8, 1.3, 1.2),
    faint: faint(0.86, 1.5, 0.72, 0.7),
  },
  // Plante — a mossy armoured giant: two slow, friendly "hoom"s and rustling leaves.
  mossaur: {
    f0: 95,
    breath: 600,
    layers: [
      {
        wave: 'sawtooth',
        at: 0,
        dur: 0.3,
        gain: 0.05,
        pitch: [
          [0, 1],
          [0.5, 1.05],
          [1, 0.92],
        ],
        filters: [['highpass', 150, 150, 0.6], ...vowel('u', 'o', 14), ['lowpass', 1300, 1300, 0.7]],
        attack: 0.04,
        hold: 0.12,
      },
      {
        wave: 'sawtooth',
        at: 0.38,
        dur: 0.42,
        gain: 0.05,
        pitch: [
          [0, 0.97],
          [1, 0.85],
        ],
        filters: [['highpass', 150, 150, 0.6], ...vowel('o', 'u', 14), ['lowpass', 1300, 1100, 0.7]],
        attack: 0.05,
        hold: 0.15,
      },
      {
        noise: 'rustle',
        at: 0.1,
        dur: 0.55,
        gain: 0.12,
        filters: [['bandpass', 3000, 2600, 1.2]],
        attack: 0.08,
      },
    ],
    effort: effort(1.15, 0.8, 1.2, 1.3),
    faint: faint(0.86, 1.3, 0.78, 0.7),
  },
  // Plante — a flower fairy: a tinkling giggle stepping down, pollen shimmering.
  florafae: {
    f0: 1050,
    breath: 3400,
    layers: [
      {
        wave: 'triangle',
        at: 0,
        dur: 0.42,
        gain: 0.05,
        pitch: [
          [0, 1.5],
          [0.2, 1.34],
          [0.4, 1.19],
          [0.6, 1.12],
          [0.8, 1],
        ],
        steps: true,
        am: [12, 1],
        filters: vowel('i'),
        attack: 0.004,
        hold: 0.3,
      },
      {
        noise: 'white',
        at: 0,
        dur: 0.4,
        gain: 0.02,
        filters: [['highpass', 6000, 7000, 0.7]],
        am: [24, 0.5],
        attack: 0.02,
      },
    ],
    effort: effort(1.1, 0.8, 1.2, 1.2),
    faint: faint(0.86, 1.5, 0.75, 0.7),
  },
  // Plante — a thorny boar: a snort, a gritty "hnngk" and a rattle of brambles.
  thornox: {
    f0: 170,
    breath: 900,
    layers: [
      { noise: 'white', at: 0, dur: 0.1, gain: 0.08, filters: [['bandpass', 900, 700, 1.5]], attack: 0.005 },
      {
        wave: 'sawtooth',
        at: 0.1,
        dur: 0.3,
        gain: 0.05,
        pitch: [
          [0, 1.2],
          [0.3, 1],
          [1, 0.88],
        ],
        am: [48, 0.6],
        filters: [['highpass', 260, 260, 0.7], ...vowel('e', 'i')],
        attack: 0.01,
        hold: 0.1,
      },
      {
        noise: 'rustle',
        at: 0.12,
        dur: 0.25,
        gain: 0.15,
        filters: [['bandpass', 2500, 2500, 1.4]],
        attack: 0.01,
      },
    ],
    effort: effort(1.12, 0.8, 1.2, 1.25),
    faint: faint(0.85, 1.4, 0.72, 0.65),
  },
  // Ténèbres — a lantern octopus: its shadow's whisper comes first, then a hollow "wooo-ip".
  farfombre: {
    f0: 440,
    breath: 1600,
    layers: [
      {
        wave: 'sine',
        at: 0,
        dur: 0.3,
        gain: 0.02,
        pitch: [
          [0, 0.8],
          [0.6, 1.2],
          [1, 1.5],
        ],
        variants: ['entry', 'effort'],
      },
      {
        wave: 'triangle',
        at: 0.22,
        dur: 0.38,
        gain: 0.06,
        pitch: [
          [0, 0.8],
          [0.6, 1.2],
          [1, 1.5],
        ],
        vib: [6, 0.03],
        filters: vowel('u', 'i'),
        attack: 0.04,
        hold: 0.12,
      },
      { noise: 'white', at: 0, dur: 0.55, gain: 0.03, filters: [['bandpass', 2400, 1600, 2]], attack: 0.1 },
    ],
    effort: effort(1.1, 0.8, 1.2, 1.2),
    faint: faint(0.84, 1.4, 0.6, 0.65),
  },
  // Ténèbres — a moon bat: two quick high chirps, then a soft lullaby "coo-oo".
  nocturnyx: {
    f0: 520,
    breath: 2000,
    layers: [
      {
        wave: 'sine',
        at: 0,
        dur: 0.12,
        gain: 0.03,
        pitch: [
          [0, 4],
          [1, 5],
        ],
        am: [16, 1],
        attack: 0.003,
        hold: 0.08,
        variants: ['entry', 'effort'],
      },
      {
        wave: 'triangle',
        at: 0.16,
        dur: 0.2,
        gain: 0.05,
        pitch: [
          [0, 1.19],
          [1, 1.17],
        ],
        filters: vowel('u'),
        attack: 0.03,
        hold: 0.08,
      },
      {
        wave: 'triangle',
        at: 0.36,
        dur: 0.32,
        gain: 0.05,
        pitch: [
          [0, 1],
          [1, 0.96],
        ],
        vib: [5, 0.012],
        filters: vowel('u'),
        attack: 0.03,
        hold: 0.12,
      },
    ],
    effort: effort(1.12, 0.8, 1.2, 1.2),
    faint: faint(0.85, 1.5, 0.75, 0.7),
  },
  // Ténèbres — a shadow panther: a creeping hiss that snaps into a snarl.
  umbrawl: {
    f0: 115,
    breath: 1400,
    layers: [
      {
        noise: 'white',
        at: 0,
        dur: 0.36,
        gain: 0.06,
        filters: [['bandpass', 2800, 2000, 1.2]],
        attack: 0.14,
        hold: 0.08,
      },
      {
        wave: 'sawtooth',
        at: 0.25,
        dur: 0.32,
        gain: 0.055,
        pitch: [
          [0, 1.3],
          [0.2, 1.45],
          [1, 1],
        ],
        am: [38, 0.7],
        filters: [...vowel('a', 'e'), ['lowpass', 2600, 2000, 0.7]],
        attack: 0.008,
        hold: 0.1,
      },
    ],
    effort: effort(1.12, 0.8, 1.2, 1.25),
    faint: faint(0.85, 1.4, 0.7, 0.65),
  },
  // Ténèbres — a many-eyed owl: an ominous warbling "ooo-ah-ooo" under a detuned ring.
  hexalune: {
    f0: 330,
    breath: 1300,
    layers: [
      {
        wave: 'square',
        at: 0,
        dur: 0.55,
        gain: 0.035,
        pitch: [
          [0, 0.9],
          [0.5, 1.06],
          [1, 0.84],
        ],
        vib: [11, 0.06],
        filters: [...vowel('o', 'a'), ['lowpass', 2000, 1600, 0.7]],
        attack: 0.03,
        hold: 0.25,
      },
      { wave: 'sine', at: 0.1, dur: 0.42, gain: 0.018, pitch: 2.02, fm: [1.5, 0.5], attack: 0.02 },
    ],
    effort: effort(1.1, 0.8, 1.25, 1.2),
    faint: faint(0.85, 1.4, 0.7, 0.65),
  },
  // Ténèbres — a ruin raven: two harsh nasal caws, "KRAA-kraa".
  deuilastre: {
    f0: 470,
    breath: 1500,
    layers: [
      {
        noise: 'white',
        at: 0,
        dur: 0.03,
        gain: 0.05,
        filters: [['highpass', 2000, 2000, 0.7]],
        attack: 0.001,
      },
      {
        wave: 'sawtooth',
        at: 0,
        dur: 0.2,
        gain: 0.045,
        pitch: [
          [0, 1.05],
          [0.3, 1.1],
          [1, 0.85],
        ],
        am: [70, 0.45],
        filters: [
          ['peaking', 1500, 1400, 5, 14],
          ['peaking', 3000, 2800, 3, 8],
          ['highpass', 400, 400, 0.7],
        ],
        attack: 0.006,
        hold: 0.08,
      },
      {
        noise: 'white',
        at: 0.26,
        dur: 0.03,
        gain: 0.05,
        filters: [['highpass', 2000, 2000, 0.7]],
        attack: 0.001,
      },
      {
        wave: 'sawtooth',
        at: 0.26,
        dur: 0.26,
        gain: 0.045,
        pitch: [
          [0, 1],
          [0.3, 1.06],
          [1, 0.78],
        ],
        am: [70, 0.45],
        filters: [
          ['peaking', 1400, 1300, 5, 14],
          ['peaking', 2900, 2700, 3, 8],
          ['highpass', 400, 400, 0.7],
        ],
        attack: 0.006,
        hold: 0.1,
      },
    ],
    effort: effort(1.1, 0.85, 1.2, 1.2),
    faint: faint(0.84, 1.4, 0.7, 0.65),
  },
  // Psy — a white phoenix: a soaring whistled glissando answered a sixth above.
  aubeastre: {
    f0: 1150,
    breath: 3000,
    layers: [
      {
        wave: 'sine',
        at: 0,
        dur: 0.55,
        gain: 0.05,
        pitch: [
          [0, 0.85],
          [0.4, 1.35],
          [0.7, 1.3],
          [1, 1.5],
        ],
        vib: [8, 0.02],
        attack: 0.03,
        hold: 0.3,
      },
      {
        wave: 'sine',
        at: 0.06,
        dur: 0.5,
        gain: 0.025,
        pitch: [
          [0, 1.43],
          [0.4, 2.27],
          [0.7, 2.18],
          [1, 2.52],
        ],
        attack: 0.04,
        hold: 0.25,
      },
      {
        noise: 'white',
        at: 0,
        dur: 0.45,
        gain: 0.018,
        filters: [['highpass', 4500, 6000, 0.7]],
        attack: 0.2,
      },
    ],
    effort: effort(1.08, 0.8, 1.3, 1.15),
    faint: faint(0.86, 1.5, 0.72, 0.7),
  },
  // Feu — a black ram with burning horns: a horn strike, a nasal quavering "MEHHH", a fire whoosh.
  flambelier: {
    f0: 250,
    breath: 1200,
    layers: [
      {
        wave: 'triangle',
        at: 0,
        dur: 0.04,
        gain: 0.06,
        pitch: 5.2,
        filters: [['bandpass', 1300, 1300, 9]],
        attack: 0.001,
      },
      {
        wave: 'sawtooth',
        at: 0.08,
        dur: 0.45,
        gain: 0.045,
        pitch: [
          [0, 1],
          [0.7, 1.08],
          [1, 1.25],
        ],
        am: [11, 0.9],
        vib: [11, 0.03],
        filters: [
          ['highpass', 200, 200, 0.6],
          ['peaking', 1000, 1100, 6, 14],
          ['peaking', 2600, 2600, 4, 10],
        ],
        attack: 0.01,
        hold: 0.25,
      },
      { noise: 'white', at: 0.1, dur: 0.4, gain: 0.05, filters: [['bandpass', 900, 2000, 1]], attack: 0.2 },
    ],
    effort: effort(1.1, 0.8, 1.2, 1.25),
    faint: faint(0.85, 1.4, 0.7, 0.65),
  },
  // Eau — a reef crustacean: three claw snaps, a squeaky "skrii" and a bubble pop.
  mareclat: {
    f0: 950,
    breath: 2800,
    layers: [
      {
        noise: 'white',
        at: 0,
        dur: 0.03,
        gain: 0.07,
        filters: [['bandpass', 3000, 2600, 1.2]],
        attack: 0.002,
      },
      {
        noise: 'white',
        at: 0.06,
        dur: 0.03,
        gain: 0.07,
        filters: [['bandpass', 3200, 2800, 1.2]],
        attack: 0.002,
      },
      {
        noise: 'white',
        at: 0.12,
        dur: 0.03,
        gain: 0.07,
        filters: [['bandpass', 3400, 3000, 1.2]],
        attack: 0.002,
      },
      {
        wave: 'square',
        at: 0.17,
        dur: 0.16,
        gain: 0.03,
        pitch: [
          [0, 0.8],
          [1, 1.25],
        ],
        filters: [['bandpass', 2400, 2600, 4]],
        attack: 0.005,
        hold: 0.05,
      },
      {
        wave: 'sine',
        at: 0.34,
        dur: 0.05,
        gain: 0.03,
        pitch: [
          [0, 1],
          [1, 1.8],
        ],
        attack: 0.003,
      },
    ],
    effort: effort(1.1, 0.8, 1.2, 1.2),
    faint: faint(0.85, 1.5, 0.7, 0.65),
  },
  // Plante — a log beetle: two hollow wooden knocks, then a creaking groan.
  xylocorne: {
    f0: 140,
    breath: 1000,
    layers: [
      {
        wave: 'triangle',
        at: 0,
        dur: 0.06,
        gain: 0.07,
        pitch: 8,
        filters: [['bandpass', 1120, 1120, 8]],
        attack: 0.001,
      },
      {
        wave: 'triangle',
        at: 0.09,
        dur: 0.06,
        gain: 0.07,
        pitch: 6,
        filters: [['bandpass', 840, 840, 8]],
        attack: 0.001,
      },
      {
        wave: 'sawtooth',
        at: 0.2,
        dur: 0.45,
        gain: 0.045,
        pitch: [
          [0, 0.9],
          [0.5, 1.1],
          [1, 0.95],
        ],
        am: [62, 0.85],
        filters: [['bandpass', 900, 1300, 2]],
        attack: 0.02,
        hold: 0.2,
      },
    ],
    effort: effort(1.12, 0.8, 1.2, 1.25),
    faint: faint(0.85, 1.4, 0.72, 0.65),
  },
  // Combat — a shielded armadillo: a warm three-step hum, a stone tapped on the second.
  pactigon: {
    f0: 196,
    breath: 800,
    layers: [
      { wave: 'sawtooth', at: 0, dur: 0.12, gain: 0.05, pitch: 1, filters: HUM, attack: 0.015, hold: 0.05 },
      {
        wave: 'sawtooth',
        at: 0.16,
        dur: 0.12,
        gain: 0.05,
        pitch: 1.12,
        filters: HUM,
        attack: 0.015,
        hold: 0.05,
      },
      {
        wave: 'sawtooth',
        at: 0.32,
        dur: 0.36,
        gain: 0.055,
        pitch: [
          [0, 1.2],
          [0.3, 1.26],
          [1, 1.25],
        ],
        vib: [5, 0.012],
        filters: HUM,
        attack: 0.02,
        hold: 0.18,
      },
      {
        wave: 'triangle',
        at: 0.16,
        dur: 0.03,
        gain: 0.04,
        pitch: 9.2,
        filters: [['bandpass', 1800, 1800, 10]],
        attack: 0.001,
      },
    ],
    effort: effort(1.12, 0.8, 1.2, 1.25),
    faint: faint(0.86, 1.4, 0.75, 0.7),
  },
});

// Loudness calibration, measured on renders through the shipped graph (agents/impl/P5C_Cries):
// per creature, the entry level, then the effort and faint gains relative to it, so entries sit
// near −20 LUFS-M, Signature efforts near −19 and faints near −21 whatever the recipe's crest.
export const CRY_LEVELS = Object.freeze({
  orakyn: [0.146, 1.21, 0.91],
  lumivox: [0.194, 1.32, 0.77],
  mnemora: [0.091, 0.99, 0.83],
  prismage: [0.178, 1.2, 0.81],
  kordane: [0.223, 1.2, 0.75],
  brontusk: [0.206, 1.25, 0.82],
  ferrax: [0.963, 1.19, 0.74],
  monolith: [0.162, 1.23, 0.89],
  abyssar: [0.041, 1.21, 0.85],
  riptalon: [0.273, 1.2, 0.85],
  nymbloom: [0.332, 1.15, 0.78],
  voltide: [0.341, 1.04, 0.75],
  calderoc: [0.326, 1.05, 0.71],
  pyrolynx: [0.323, 1.23, 0.78],
  magmoth: [0.216, 1.28, 0.74],
  solflare: [0.149, 1.32, 0.84],
  virelia: [0.242, 1.18, 0.84],
  mossaur: [0.298, 1.04, 0.72],
  florafae: [0.157, 1.18, 0.89],
  thornox: [0.38, 0.98, 0.69],
  farfombre: [0.146, 1.22, 1.17],
  nocturnyx: [0.196, 1.14, 0.87],
  umbrawl: [0.278, 1.2, 0.75],
  hexalune: [0.149, 1.26, 0.75],
  deuilastre: [0.201, 1.25, 1.05],
  aubeastre: [0.139, 1.2, 0.8],
  flambelier: [0.177, 1.17, 0.99],
  mareclat: [1.076, 1.32, 1.1],
  xylocorne: [1.049, 1.24, 0.78],
  pactigon: [0.221, 1.13, 0.8],
});

// Filter frequencies follow the variant's colour: peaks move by the square root (the vowel stays
// recognisable), low-/band-passes by the full factor, high-passes only darken.
function colourFilters(filters, factor) {
  if (factor === 1) return filters.map((filter) => [...filter]);
  return filters.map(([type, from, to, q, db]) => {
    const k = type === 'peaking' ? Math.sqrt(factor) : type === 'highpass' ? Math.min(1, factor) : factor;
    return [type, from * k, to * k, q, db];
  });
}

const contourOf = (pitch) => (Array.isArray(pitch) ? pitch : [[0, pitch]]);

// Resolves one creature's cry to absolute layers: `pitch` as [[fraction, Hz], ...], filters in
// Hz, `vib` as [rate, depth Hz], `fm` as [ratio, depth Hz], times in seconds from the cry start.
// Returns null for an unknown id (every roster creature has a profile).
export function cryPlan(id, variant = 'entry') {
  const profile = Object.hasOwn(CRY_PROFILES, id) ? CRY_PROFILES[id] : null;
  if (!profile) return null;
  const kind = CRY_VARIANTS.includes(variant) ? variant : 'entry';
  const shape = kind === 'effort' ? profile.effort : kind === 'faint' ? profile.faint : null;
  const [entryLevel, effortGain, faintGain] = CRY_LEVELS[id];
  const time = shape?.time ?? 1,
    level = entryLevel * (kind === 'effort' ? effortGain : kind === 'faint' ? faintGain : 1),
    colour = kind === 'effort' ? shape.bright : kind === 'faint' ? shape.dark : 1;
  const layers = profile.layers
    .filter((layer) => !layer.variants || layer.variants.includes(kind))
    .map((layer) => {
      const out = {
        at: layer.at * time,
        dur: layer.dur * time,
        gain: layer.gain * level,
        attack: layer.attack ?? 0.01,
        hold: (layer.hold ?? 0) * time,
        filters: colourFilters(layer.filters ?? [], colour),
      };
      if (kind === 'effort') out.attack *= 0.6;
      if (kind === 'faint') out.attack = Math.max(out.attack * 2, 0.02);
      if (layer.am) {
        const [rate, depth] = layer.am;
        if (kind === 'faint') out.am = [rate * 0.8, depth * 0.7];
        else if (kind === 'effort') out.am = [rate, Math.min(1, depth * 1.3)];
        else out.am = [rate, depth];
      } else if (kind === 'effort' && shape.grit && layer.wave) out.am = [...shape.grit];
      if (!layer.wave) return { ...out, noise: layer.noise };
      let contour = contourOf(layer.pitch);
      if (kind === 'effort') contour = contour.map(([at, ratio]) => [at, ratio ** shape.bend * shape.pitch]);
      if (kind === 'faint') {
        const last = contour.at(-1)[1];
        contour = [
          ...contour.map(([at, ratio]) => [at * 0.7, ratio * shape.pitch]),
          [1, last * shape.pitch * shape.fall],
        ];
      }
      const pitch = contour.map(([at, ratio]) => [at, ratio * profile.f0]),
        start = pitch[0][1],
        buzzy = layer.wave === 'sawtooth' || layer.wave === 'square';
      if (kind === 'faint' && buzzy && !layer.filters?.some(([type]) => type === 'lowpass'))
        out.filters.push(['lowpass', 2600 * shape.dark, 1400 * shape.dark, 0.7]);
      return {
        ...out,
        wave: layer.wave,
        pitch,
        steps: Boolean(layer.steps),
        vib: layer.vib ? [layer.vib[0] * (kind === 'faint' ? 0.8 : 1), layer.vib[1] * start] : null,
        fm: layer.fm ? [layer.fm[0], layer.fm[1] * start] : null,
      };
    });
  if (kind === 'faint') {
    const end = Math.max(...layers.map((layer) => layer.at + layer.dur));
    layers.push({
      noise: 'white',
      at: 0.05,
      dur: end * 0.8,
      gain: 0.02 * level,
      attack: 0.12,
      hold: 0,
      filters: [['bandpass', profile.breath, profile.breath * 0.7, 1.2]],
    });
  }
  return layers;
}
