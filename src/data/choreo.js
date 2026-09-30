// Battle choreography data (docs/battle-presentation.md §9.4, §9.5, §10). Pure data and pure
// helpers: no DOM, no Three. The director (src/battle-ui/director.js) plays these timelines on the
// session fx-clock; test/presentation-contract.test.js validates them against the beat budgets.
//
// Identity = archetype (the motion verb) × move palette (type colour) × tier × motif (atlas cell).
// Timelines are authored for tier 1 in virtual ms from the beat start. The director stretches
// `at`, `ms`, `life` and every `…Ms` parameter by `tierStretch(tier)`; `perHit` cue times are
// relative to the hit start, hit i starting at s × perHit.at + (i − 1) × BEAT_BUDGET_MS.extraHit.
// Emitter sizes, speeds and distances are in fighter heights (h). `q` is the quad count before the
// tier (TIERS.quadScale) and quality scaling. Emit anchors are `{ who, at }` objects because a
// cue's own `at` is its time. `color` is an optional '#rrggbb' literal; otherwise the palette.
import { BEAT_BUDGET_MS } from '../battle-ui/beats.js';
import { AFFINITIES } from './affinities.js';
import { CREATURES } from './creatures.js';
import { MOVES } from './moves.js';

// Each archetype has one motion verb (who moves, where the energy comes from):
// DASH the body charges across · SLASH quick hop-in, arcs cut the target · QUAKE stomp, the ground
// erupts under the target · BEAM a ray joins both fighters · PROJ a shot flies straight · LOB a shot
// arcs high and splashes · RAIN it falls from the sky onto the target · WAVE a wall rolls along the
// floor · VORTEX the target is swirled and drained back · NOVA a shockwave bursts out of the
// attacker · HEX a curse circle closes on the target · GUARD a shield dome forms · BOOST the
// attacker hops and power rises · HEAL soft light and rising motes · RELAY a gate of feathers opens.
export const ARCHETYPES = Object.freeze([
  'DASH',
  'SLASH',
  'QUAKE',
  'BEAM',
  'PROJ',
  'LOB',
  'RAIN',
  'WAVE',
  'VORTEX',
  'NOVA',
  'HEX',
  'GUARD',
  'BOOST',
  'HEAL',
  'RELAY',
]);

// §10.2. Quality scaling on top (director): quads × low 0.6 / mid 1 / high 1.4, shake × low 0.6.
export const TIERS = Object.freeze({
  1: Object.freeze({
    hitStopMs: 50,
    shakePx: 3,
    shakeMs: 90,
    knockPx: 10,
    reach: 0.55,
    kick: 0.6,
    quadScale: 1,
  }),
  2: Object.freeze({
    hitStopMs: 80,
    shakePx: 5,
    shakeMs: 130,
    knockPx: 14,
    reach: 0.62,
    kick: 1,
    quadScale: 1.5,
  }),
  3: Object.freeze({
    hitStopMs: 110,
    shakePx: 8,
    shakeMs: 180,
    knockPx: 18,
    reach: 0.7,
    kick: 1.4,
    quadScale: 2,
  }),
});

// s(tier) of §10.3: T1 1, T2 ≈ 1.415, T3 1.6. A timeline that ends by 650 at T1 fills its budget
// at every tier.
export function tierStretch(tier) {
  const action = BEAT_BUDGET_MS.action;
  return (action[tier] - TIERS[tier].hitStopMs) / (action[1] - TIERS[1].hitStopMs);
}

// §10.2 punch feel: a plain hit's camera snap says what the hit meant. The tier's kick is scaled by
// the hit's effectiveness (a resisted or barrier-blocked hit only nudges, a super-effective one
// snaps) and again on a critical, capped under the Signature's authored kick so framing holds.
// Signature punches (`sig` cues) and cues without a landed hit keep their authored kick.
export const PUNCH_FEEL = Object.freeze({
  resisted: 0.6,
  neutral: 1.2,
  effective: 1.8,
  critical: 1.5,
  max: 2,
});
export function punchKick(cue, tier, hit = null) {
  const kick = cue.kick ?? TIERS[tier].kick;
  if (cue.sig || !hit) return kick;
  const affinity = hit.affinity ?? 1,
    effect =
      hit.blocked || affinity < 1
        ? PUNCH_FEEL.resisted
        : affinity > 1
          ? PUNCH_FEEL.effective
          : PUNCH_FEEL.neutral;
  return Math.min(PUNCH_FEEL.max, kick * effect * (hit.critical ? PUNCH_FEEL.critical : 1));
}

// §9.4: 8 × 8 cells of 128 px, index = row × 8 + column. Generic cells first, then one motif per
// creature (its Signature's identity glyph), then the effect cells in 54–63. Stretched quads
// (streak, beamQuad, `stretch`) map the cell's +u axis to the travel direction; billboards keep
// the cell upright (art faces +u; `face` mirrors it). `beam` tiles along u for scrolled beams.
const GENERIC_CELLS = [
  'glow',
  'spark',
  'streak',
  'ring',
  'shard',
  'leaf',
  'drop',
  'bolt',
  'rune',
  'star',
  'smoke',
  'crescent',
  'ember',
  'bubble',
  'petal',
  'feather',
  'dust',
  'reticle',
  'vine',
  'eye',
  'spike',
  'speedline',
  'shield',
  'cross',
];
const MOTIF_CREATURES = [
  'orakyn',
  'lumivox',
  'mnemora',
  'prismage',
  'kordane',
  'brontusk',
  'ferrax',
  'monolith',
  'abyssar',
  'riptalon',
  'nymbloom',
  'voltide',
  'calderoc',
  'pyrolynx',
  'magmoth',
  'solflare',
  'virelia',
  'mossaur',
  'florafae',
  'thornox',
  'farfombre',
  'nocturnyx',
  'umbrawl',
  'hexalune',
  'deuilastre',
  'aubeastre',
  'flambelier',
  'mareclat',
  'xylocorne',
  'pactigon',
];
// Archetype identity art: ground cracks and rock chunks (QUAKE), a wave crest (WAVE), chains and
// a seal (HEX), impact flare and shock ring (contact frames, NOVA), the tiling beam body (BEAM),
// a sweeping blade arc (SLASH) and a spiral (VORTEX).
const EFFECT_CELLS = [
  'crack',
  'chunk',
  'crest',
  'chain',
  'sigil',
  'flare',
  'beam',
  'slash',
  'swirl',
  'shock',
];
export const ATLAS = Object.freeze({
  url: './assets/fx/atlas.png',
  size: 1024,
  grid: 8,
  cells: Object.freeze(
    Object.fromEntries(
      [...GENERIC_CELLS, ...MOTIF_CREATURES.map((id) => `motif-${id}`), ...EFFECT_CELLS].map(
        (name, index) => [name, index]
      )
    )
  ),
});

// ---------------------------------------------------------------------------------------------
// Cue builders (authoring shorthand; the exported timelines are plain frozen data).
const ACTOR = Object.freeze({ who: 'actor', at: 'center' });
const TARGET = Object.freeze({ who: 'target', at: 'center' });
const anchor = (who, at = 'center') => ({ who, at });
const WHITE = '#ffffff';
const DUST = '#d8ccb4';
// Heal reads as heal whatever the healer's type: the court pulse, crosses and motes.
const HEAL_GREEN = '#7dffa8';

const fighter = (at, who, reaction, options = {}) => ({ at, op: 'fighter', who, reaction, ...options });
const emit = (at, emitter, from, options) => ({ at, op: 'emit', emitter, from, ...options });
const cue = (at, name) => ({ at, op: 'cue', name });
const op = (at, name, params = {}) => ({ at, op: name, ...params });

// Identity first: each archetype spends the tier's quad-area budget (§14) on one or two large,
// solid shapes that name the verb at a glance on a 360 px phone (a blade arc, erupting spires, a
// crest, a sky column, a seal), sized in fighter heights, held near full strength for ~150 ms
// after the contact. Particles only garnish them. One-off shapes carry `max: 1` so tier and
// quality scale the particles around them, never the shape itself. Solid identity art blends
// mostly alpha-over (`additive` ≤ 0.3) so the type colour stays saturated on bright courts, with
// `hot` whitening only its cores and leading edges.
const flare = (at, from, size, options = {}) =>
  emit(at, 'burst', from, {
    cell: 'flare',
    q: 1,
    max: 1,
    speed: 0,
    gravity: 0,
    drag: 1,
    offset: 0,
    life: 200,
    size,
    sizeJitter: 0.1,
    grow: 0.5,
    fade: 0.8,
    rot: 0,
    hot: 0.6,
    ...options,
  });
const glow = (at, from, size, life, options = {}) =>
  emit(at, 'burst', from, {
    cell: 'glow',
    q: 1,
    max: 1,
    speed: 0,
    gravity: 0,
    drag: 1,
    offset: 0,
    life,
    size,
    sizeJitter: 0,
    grow: 1,
    fade: 0.6,
    hot: 0.3,
    ...options,
  });
// One large shape parked on its anchor (a seal, a blade arc, a crest): no drift, a fixed
// orientation, `grow` from its full size.
const stamp = (at, from, cell, size, life, options = {}) =>
  emit(at, 'burst', from, {
    cell,
    q: 1,
    max: 1,
    offset: 0,
    speed: 0,
    gravity: 0,
    drag: 1,
    life,
    size,
    sizeJitter: 0.06,
    grow: 1,
    fade: 0.5,
    rot: 0,
    additive: 0.15,
    hot: 0.6,
    ...options,
  });
const shockwave = (at, from, r1, life, options = {}) =>
  emit(at, 'ring', from, { cell: 'shock', q: 1, max: 1, r0: 0.12, r1, life, hot: 0.35, ...options });
// A shockwave lying on the court around a fighter's feet.
const courtRing = (at, who, r1, life, options = {}) =>
  emit(at, 'ring', anchor(who, 'feet'), {
    cell: 'shock',
    flat: true,
    q: 1,
    max: 1,
    r0: 0.15,
    r1,
    life,
    hot: 0.35,
    ...options,
  });
const sparks = (at, from, q, options = {}) =>
  emit(at, 'burst', from, {
    cell: 'spark',
    q,
    speed: 2.3,
    drag: 0.8,
    gravity: 0.8,
    life: 340,
    size: 0.11,
    stretch: 45,
    hot: 0.5,
    ...options,
  });
const dust = (at, who, q, options = {}) =>
  emit(at, 'burst', anchor(who, 'feet'), {
    cell: 'smoke',
    q,
    speed: 0.7,
    spread: 2,
    drag: 0.9,
    gravity: -0.15,
    life: 480,
    size: 0.36,
    additive: false,
    alpha: 0.65,
    color: DUST,
    ...options,
  });
// Victory confetti: paper squares and ribbons (`solid` rectangles, no atlas art) in festive
// colours, each flipping (`flutter`, its darker back showing) and swaying (`sway`) as it falls
// under gravity and air drag. One call = a squares emit and a ribbons emit (≈ 0.85 × q).
const CONFETTI = Object.freeze(['#ffd23f', '#ff5d8f', '#4fd8ff', '#8cff6b', '#ffffff', '#b98cff']);
const confetti = (at, from, q, options = {}) => {
  const paper = {
    cell: 'solid',
    colors: CONFETTI,
    drag: 0.88,
    sizeJitter: 0.3,
    grow: 1,
    fade: 0.3,
    additive: false,
    hot: 0,
    flutter: 0.013,
    sway: 0.1,
    ...options,
  };
  return [
    emit(at, 'burst', from, { ...paper, q, size: 0.075 }),
    emit(at + 15, 'burst', from, {
      ...paper,
      q: Math.max(1, Math.round(q * 0.85)),
      size: 0.17,
      aspect: 0.32,
      flutter: paper.flutter * 0.8,
    }),
  ];
};

// The contact frame shared by the damage archetypes: a type-coloured flare with a white-hot
// heart, a shock ring, sparks thrown through the target along the attack and a court scorch.
// `front` (melee) draws the flare and ring over the attacker that lunged in front of the target.
const impactKit = (at, { sparks: count = 10, size = 1.1, ring = 0.7, decal = 0.5, front = false } = {}) => [
  flare(at, TARGET, size, front ? { front } : {}),
  shockwave(at, TARGET, ring, 260, front ? { front } : {}),
  sparks(at, TARGET, count, { face: 'away', spread: 2.2 }),
  emit(at, 'groundDecal', anchor('target', 'feet'), {
    cell: 'shock',
    q: 1,
    max: 1,
    radius: decal,
    life: 320,
    alpha: 0.9,
  }),
];

// Signature payoff (`sig: true` cues play on Signature beats only; `once: true` perHit cues on
// the first landed hit only). The wind-up fills the time after the cut-in band: the camera slowly
// leans in between caster and target while a type-coloured aura swells, a ring and sparks
// converge on the caster and its glyph rises from the court, until `until`.
const signatureWindup = (until) => [
  op(0, 'shot', { name: 'lean', who: 'actor', ms: until + 260, sig: true }),
  glow(0, ACTOR, 1.3, until + 160, {
    grow: 1.15,
    alpha: 0.7,
    additive: 0.3,
    hot: 0.35,
    fade: 0.4,
    sig: true,
  }),
  emit(0, 'ring', ACTOR, {
    cell: 'shock',
    q: 1,
    max: 1,
    r0: 1.05,
    r1: 0.12,
    life: until,
    hot: 0.4,
    sig: true,
  }),
  emit(0, 'burst', ACTOR, {
    cell: 'spark',
    q: 5,
    offset: 0.8,
    speed: -1.8,
    drag: 1,
    gravity: 0,
    life: until,
    size: 0.12,
    stretch: 40,
    hot: 0.5,
    sig: true,
  }),
  emit(20, 'burst', anchor('actor', 'feet'), {
    cell: 'motif',
    q: 3,
    speed: 1.5,
    spread: 1.3,
    drag: 0.9,
    gravity: -1.3,
    life: until + 220,
    size: 0.22,
    additive: 0.2,
    sig: true,
  }),
];
// The Signature impact frame: the stage flashes white and the camera kicks hard, an oversized
// flare and shock ring, the creature's glyph bursting out and a court-wide shockwave.
const signatureImpact = (at) => [
  op(at, 'grade', { exposure: 0.55, contrast: 1.25, ms: 0, sig: true, once: true }),
  op(at + 70, 'grade', { exposure: 0, contrast: 1, ms: 160, sig: true, once: true }),
  op(at, 'punch', { kick: 2.2, shakePx: 12, shakeMs: 260, sig: true, once: true }),
  flare(at, TARGET, 1.6, { life: 260, sig: true, once: true }),
  shockwave(at, TARGET, 1, 340, { alpha: 1, sig: true, once: true }),
  courtRing(at, 'target', 1.5, 460, { alpha: 1, sig: true, once: true }),
  emit(at, 'burst', TARGET, {
    cell: 'motif',
    q: 4,
    speed: 2.6,
    drag: 0.86,
    gravity: 1.2,
    life: 660,
    size: 0.26,
    additive: 0.2,
    sig: true,
    once: true,
  }),
];

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

// ---------------------------------------------------------------------------------------------
// §10.3 archetype timelines (T1 authoring). Every damage archetype lands its single `contact` in
// `perHit` by 250 ms (a lethal T1 hit hands off at 300 wall ms) and ends by 650; multi-hit
// archetypes contact earlier and end earlier so their extra hits and hit-stops still fit
// (SLASH/RAIN carry 3-hit T1 moves, RAIN the 5-hit ninefold_inferno Signature, NOVA 2–3 hits).
export const TIMELINES = freezeDeep({
  // The body charges across the court inside a type-coloured comet and slams into the target.
  DASH: {
    cues: [
      fighter(0, 'actor', 'windup', { ms: 110, squash: 0.12 }),
      ...signatureWindup(110),
      emit(0, 'ring', ACTOR, { cell: 'ring', q: 1, max: 1, r0: 0.8, r1: 0.1, life: 110, hot: 0.4 }),
      dust(90, 'actor', 4, { spread: 1.4, speed: 0.8, life: 380 }),
      cue(110, 'release'),
      fighter(110, 'actor', 'lunge', { outMs: 110, holdMs: 60, backMs: 180 }),
      emit(110, 'trailFollow', ACTOR, {
        cell: 'glow',
        q: 1,
        intervalMs: 36,
        life: 140,
        fade: 170,
        size: 0.82,
        alpha: 0.75,
        additive: 0.3,
        hot: 0.3,
      }),
      emit(110, 'trailFollow', ACTOR, {
        cell: 'speedline',
        q: 1,
        intervalMs: 40,
        life: 140,
        fade: 140,
        size: 0.85,
        hot: 0.4,
      }),
      op(650, 'end'),
    ],
    perHit: {
      at: 220,
      cues: [
        op(0, 'contact'),
        ...impactKit(0, { sparks: 12, size: 1.3, ring: 0.8, front: true }),
        emit(0, 'burst', TARGET, {
          cell: 'motif',
          q: 4,
          speed: 1.8,
          face: 'away',
          spread: 1.6,
          drag: 0.85,
          gravity: 0.9,
          life: 460,
          size: 0.24,
          additive: 0.2,
        }),
        dust(0, 'target', 3, { speed: 0.9, spread: 1.6 }),
        op(0, 'punch'),
        op(0, 'shot', { name: 'impact', who: 'target' }),
        ...signatureImpact(0),
      ],
    },
  },

  // A short hop-in per hit; a thin blade arc cuts diagonally across the target and is gone within
  // ~100 ms at full strength, so the target's hit reaction shows through the swing.
  SLASH: {
    cues: [fighter(0, 'actor', 'windup', { ms: 60, squash: 0.08 }), ...signatureWindup(60), op(520, 'end')],
    perHit: {
      at: 60,
      cues: [
        cue(0, 'release'),
        fighter(0, 'actor', 'lunge', { outMs: 100, holdMs: 40, backMs: 150 }),
        emit(40, 'trailFollow', ACTOR, {
          cell: 'glow',
          q: 1,
          intervalMs: 30,
          life: 70,
          fade: 120,
          size: 0.6,
          alpha: 0.5,
        }),
        op(100, 'contact'),
        stamp(100, TARGET, 'slash', 1.3, 130, {
          face: 'away',
          grow: 1.2,
          rotJitter: 0.8,
          spin: -0.0032,
          fade: 0.7,
          additive: 0.35,
          hot: 0.75,
          front: true,
        }),
        flare(100, TARGET, 0.55, { life: 150, front: true }),
        sparks(100, TARGET, 8, { speed: 2.6, face: 'away', spread: 1, life: 300, stretch: 55 }),
        emit(100, 'burst', TARGET, {
          cell: 'motif',
          q: 3,
          speed: 1.1,
          face: 'away',
          spread: 1.6,
          drag: 0.8,
          gravity: 0.6,
          life: 380,
          size: 0.18,
          additive: 0.2,
        }),
        op(100, 'punch'),
        ...signatureImpact(100),
      ],
    },
  },

  // A stomp shakes the court and glowing cracks race along the floor; the ground breaks open under
  // the target (a wide glowing crack, rock chunks, dust) and rock spires tower up behind it on both
  // sides, framing its hit reaction. The Signature leaps before the stomp.
  QUAKE: {
    cues: [
      fighter(0, 'actor', 'windup', { ms: 140, squash: 0.16 }),
      ...signatureWindup(130),
      fighter(0, 'actor', 'victory', { hops: 1, ms: 130, sig: true }),
      cue(130, 'release'),
      op(130, 'punch', { kick: 0.25, shakePx: 3, shakeMs: 90 }),
      courtRing(130, 'actor', 1, 280, { alpha: 1 }),
      dust(130, 'actor', 4, { spread: 1.8, speed: 0.9, life: 400 }),
      emit(135, 'groundDecal', anchor('actor', 'feet'), {
        to: anchor('target', 'feet'),
        cell: 'crack',
        q: 4,
        radius: 0.42,
        staggerMs: 22,
        life: 560,
        grow: 0.6,
        additive: 0.2,
        hot: 0.6,
      }),
      op(650, 'end'),
    ],
    // The ground erupts 30 ms before the contact frame, so the spires already tower (easeOutBack)
    // when the hit-stop freezes it.
    perHit: {
      at: 205,
      cues: [
        emit(0, 'groundDecal', anchor('target', 'feet'), {
          cell: 'crack',
          q: 1,
          max: 1,
          radius: 1.2,
          life: 660,
          grow: 0.5,
          additive: 0.15,
          hot: 0.7,
        }),
        ...[-0.55, 0.55].map((shift) =>
          emit(0, 'pillar', anchor('target', 'feet'), {
            cell: 'spike',
            q: 2,
            shift,
            height: 1.35,
            width: 0.36,
            staggerMs: 15,
            popMs: 90,
            life: 540,
            additive: 0,
            hot: 0.5,
            back: true,
          })
        ),
        op(30, 'contact'),
        flare(30, anchor('target', 'feet'), 1, { life: 200 }),
        // Rock chunks are thrown wide to both sides and gone within ~0.4 s, so they never pile
        // up over the target's body.
        emit(30, 'burst', anchor('target', 'feet'), {
          cell: 'chunk',
          q: 4,
          speed: 3,
          spread: 2.3,
          drag: 0.92,
          gravity: 4.2,
          life: 440,
          size: 0.26,
          additive: false,
          fade: 0.35,
          grow: 0.85,
        }),
        dust(30, 'target', 3, { speed: 0.9, spread: 2.4, size: 0.45, life: 560 }),
        op(30, 'punch'),
        op(30, 'shot', { name: 'impact', who: 'target' }),
        ...signatureImpact(30),
      ],
    },
  },

  // Light gathers at the attacker, then a thick scrolling ray joins both fighters: muzzle flare
  // at the caster, impact flare on the target.
  BEAM: {
    cues: [
      fighter(0, 'actor', 'windup', { ms: 150, squash: 0.06 }),
      ...signatureWindup(150),
      emit(0, 'ring', ACTOR, { cell: 'ring', q: 1, max: 1, r0: 0.8, r1: 0.08, life: 150, hot: 0.5 }),
      glow(0, ACTOR, 0.5, 220, { grow: 1.4, hot: 0.6 }),
      emit(10, 'burst', ACTOR, {
        cell: 'spark',
        q: 6,
        offset: 0.6,
        speed: -1.5,
        drag: 1,
        gravity: 0,
        life: 140,
        size: 0.09,
        stretch: 30,
        hot: 0.5,
      }),
      cue(150, 'release'),
      emit(150, 'beamQuad', ACTOR, {
        to: TARGET,
        cell: 'beam',
        q: 4,
        width: 0.52,
        scroll: 4,
        life: 300,
        grow: 0.7,
        additive: 0.3,
        hot: 0.55,
      }),
      flare(150, ACTOR, 0.6, { life: 170 }),
      sparks(150, ACTOR, 5, { face: 'toward', spread: 0.9, speed: 1.6, gravity: 0.2, life: 240 }),
      op(650, 'end'),
    ],
    perHit: {
      at: 190,
      cues: [
        op(0, 'contact'),
        ...impactKit(0, { sparks: 12, size: 1.2, ring: 0.75 }),
        emit(0, 'burst', TARGET, {
          cell: 'motif',
          q: 4,
          speed: 1.3,
          face: 'away',
          spread: 2,
          drag: 0.85,
          gravity: 0.3,
          life: 400,
          size: 0.2,
          additive: 0.2,
        }),
        op(0, 'punch'),
        ...signatureImpact(0),
      ],
    },
  },

  // A glowing orb with a long tail and a sparkle wake flies straight across the court.
  PROJ: {
    cues: [
      fighter(0, 'actor', 'windup', { ms: 100, squash: 0.08 }),
      glow(0, ACTOR, 0.55, 120, { grow: 1.3, hot: 0.5 }),
      cue(100, 'release'),
      flare(100, ACTOR, 0.6, { life: 150 }),
      emit(100, 'streak', ACTOR, {
        to: TARGET,
        cell: 'glow',
        q: 1,
        max: 1,
        size: 0.6,
        length: 0.3,
        travelMs: 130,
        life: 40,
        additive: 0.3,
        hot: 0.65,
      }),
      emit(100, 'streak', ACTOR, {
        to: TARGET,
        cell: 'streak',
        q: 1,
        max: 1,
        size: 0.32,
        length: 1.2,
        travelMs: 130,
        life: 60,
        hot: 0.4,
      }),
      emit(100, 'streak', ACTOR, {
        to: TARGET,
        cell: 'motif',
        q: 1,
        max: 1,
        size: 0.36,
        length: 0.15,
        travelMs: 130,
        life: 40,
        additive: 0.15,
      }),
      emit(110, 'streak', ACTOR, {
        to: TARGET,
        cell: 'spark',
        q: 4,
        size: 0.1,
        length: 0.35,
        travelMs: 150,
        life: 140,
        hot: 0.4,
      }),
      op(650, 'end'),
    ],
    perHit: {
      at: 230,
      cues: [
        op(0, 'contact'),
        ...impactKit(0, { sparks: 10, size: 1.25, ring: 0.75 }),
        emit(0, 'burst', TARGET, {
          cell: 'motif',
          q: 5,
          speed: 1.6,
          face: 'away',
          spread: 2.2,
          drag: 0.8,
          gravity: 0.5,
          life: 420,
          size: 0.2,
          additive: 0.2,
        }),
        op(0, 'punch'),
      ],
    },
  },

  // The attacker rears back and lobs a shot high; it bursts on the target's head in a crown of
  // splashes and a splash column, and rings the court.
  LOB: {
    cues: [
      fighter(0, 'actor', 'windup', { ms: 80, squash: 0.14 }),
      cue(70, 'release'),
      emit(70, 'streak', anchor('actor', 'head'), {
        to: anchor('target', 'head'),
        cell: 'motif',
        q: 1,
        max: 1,
        size: 0.5,
        length: 0.3,
        arc: 0.8,
        travelMs: 170,
        life: 30,
        additive: 0.15,
      }),
      emit(70, 'streak', anchor('actor', 'head'), {
        to: anchor('target', 'head'),
        cell: 'glow',
        q: 1,
        max: 1,
        size: 0.45,
        length: 0.9,
        arc: 0.8,
        travelMs: 170,
        life: 30,
        hot: 0.4,
      }),
      emit(80, 'streak', anchor('actor', 'head'), {
        to: anchor('target', 'head'),
        cell: 'drop',
        q: 3,
        size: 0.14,
        length: 0.3,
        arc: 0.8,
        travelMs: 185,
        life: 40,
        additive: 0.15,
      }),
      op(650, 'end'),
    ],
    perHit: {
      at: 240,
      cues: [
        op(0, 'contact'),
        // The lobbed glyph lands on the head and splashes: a large copy of it blooms behind the
        // head (framing it, never over the face), then a hollow splash ring and a crown of drops.
        stamp(0, anchor('target', 'head'), 'motif', 0.8, 300, {
          back: true,
          grow: 1.6,
          fade: 0.7,
          rotJitter: 0.5,
          additive: 0.25,
          hot: 0.5,
        }),
        flare(0, anchor('target', 'head'), 0.7, { life: 160 }),
        emit(0, 'burst', anchor('target', 'head'), {
          cell: 'motif',
          q: 5,
          speed: 2.1,
          spread: 1.8,
          drag: 0.9,
          gravity: 3.4,
          life: 560,
          size: 0.22,
          additive: 0.15,
        }),
        emit(0, 'burst', anchor('target', 'head'), {
          cell: 'drop',
          q: 8,
          speed: 2.2,
          spread: 1.6,
          drag: 0.9,
          gravity: 4,
          life: 520,
          size: 0.15,
          additive: 0.15,
          hot: 0.4,
        }),
        shockwave(0, anchor('target', 'head'), 0.85, 260),
        courtRing(0, 'target', 1, 380, { alpha: 1 }),
        emit(0, 'groundDecal', anchor('target', 'feet'), {
          cell: 'glow',
          q: 1,
          max: 1,
          radius: 0.6,
          life: 400,
          alpha: 0.8,
        }),
        op(0, 'punch'),
      ],
    },
  },

  // Energy is sent skyward, then it falls on the target: a drizzle of motifs, and per hit a thick
  // light column strikes from the sky and splashes on the court.
  RAIN: {
    cues: [
      fighter(0, 'actor', 'windup', { ms: 90, squash: 0.06 }),
      ...signatureWindup(90),
      emit(0, 'burst', anchor('actor', 'head'), {
        cell: 'spark',
        q: 5,
        speed: 3.6,
        spread: 0.4,
        drag: 0.95,
        gravity: 0,
        life: 220,
        size: 0.13,
        stretch: 60,
        hot: 0.4,
      }),
      cue(30, 'release'),
      emit(30, 'rain', anchor('target', 'head'), {
        cell: 'motif',
        q: 8,
        area: 1.4,
        fall: 4.5,
        life: 520,
        size: 0.22,
        additive: 0.15,
      }),
      emit(30, 'groundDecal', anchor('target', 'feet'), {
        cell: 'glow',
        q: 1,
        max: 1,
        radius: 0.7,
        life: 420,
        alpha: 0.6,
      }),
      op(280, 'end'),
    ],
    perHit: {
      at: 90,
      cues: [
        emit(0, 'beamQuad', anchor('target', 'head'), {
          to: anchor('target', 'feet'),
          sky: 2.2,
          cell: 'beam',
          q: 4,
          max: 2,
          width: 0.55,
          scroll: 5,
          life: 170,
          fadeIn: 20,
          grow: 0.55,
          additive: 0.25,
          hot: 0.6,
        }),
        op(30, 'contact'),
        flare(30, TARGET, 1, { life: 170 }),
        sparks(30, TARGET, 6, { speed: 1.8, gravity: 0.8, life: 280 }),
        courtRing(30, 'target', 0.85, 280),
        emit(30, 'burst', anchor('target', 'feet'), {
          cell: 'motif',
          q: 3,
          speed: 1.4,
          spread: 1.4,
          drag: 0.9,
          gravity: 2.6,
          life: 420,
          size: 0.18,
          additive: 0.15,
        }),
        op(30, 'punch'),
        ...signatureImpact(30),
      ],
    },
  },

  // Water gathers at the attacker's feet, a wave crest rolls along the floor and breaks behind the
  // target (`back`: it lands behind it, never over its hit reaction): a crest taller than it rears
  // up behind it, framing its hit reaction, and a column of spray bursts. The rolling crest lands
  // 30 ms (× tier stretch) before the contact, over one fx step, and fades behind the target into
  // the contact's crest: its `back` bias only puts it behind the target on arrival, and the
  // contact's hit-stop would freeze it in flight, still in front of a far target and as large as
  // it, hiding its head and body.
  WAVE: {
    cues: [
      fighter(0, 'actor', 'windup', { ms: 100, squash: 0.1 }),
      ...signatureWindup(100),
      courtRing(40, 'actor', 0.8, 240, { alpha: 0.9 }),
      cue(100, 'release'),
      fighter(100, 'actor', 'lunge', { reach: 0.16, outMs: 100, holdMs: 60, backMs: 160 }),
      emit(100, 'streak', anchor('actor', 'feet'), {
        to: anchor('target', 'feet'),
        cell: 'crest',
        q: 1,
        max: 1,
        upright: true,
        size: 1.05,
        grow: 1.25,
        travelMs: 110,
        life: 70,
        additive: 0,
        hot: 0.6,
        back: true,
      }),
      emit(100, 'streak', anchor('actor', 'feet'), {
        to: anchor('target', 'feet'),
        cell: 'glow',
        q: 1,
        max: 1,
        size: 0.6,
        length: 0.9,
        travelMs: 110,
        life: 60,
        hot: 0.3,
      }),
      emit(105, 'streak', anchor('actor', 'feet'), {
        to: anchor('target', 'feet'),
        cell: 'drop',
        q: 4,
        size: 0.14,
        length: 0.3,
        arc: 0.4,
        travelMs: 165,
        life: 60,
        additive: 0.15,
      }),
      op(580, 'end'),
    ],
    perHit: {
      at: 240,
      cues: [
        op(0, 'contact'),
        stamp(0, TARGET, 'crest', 1.6, 320, {
          face: 'away',
          grow: 1.08,
          fade: 0.55,
          additive: 0,
          back: true,
        }),
        emit(0, 'pillar', anchor('target', 'feet'), {
          cell: 'glow',
          q: 1,
          max: 1,
          height: 1.8,
          width: 0.8,
          staggerMs: 0,
          life: 320,
          alpha: 0.6,
          additive: 0.3,
          hot: 0.4,
          back: true,
        }),
        emit(0, 'burst', TARGET, {
          cell: 'drop',
          q: 8,
          speed: 2.4,
          spread: 1.6,
          drag: 0.9,
          gravity: 3.6,
          life: 520,
          size: 0.14,
          additive: 0.1,
          hot: 0.5,
        }),
        emit(0, 'burst', TARGET, {
          cell: 'motif',
          q: 4,
          speed: 1.9,
          spread: 2,
          drag: 0.9,
          gravity: 2.6,
          life: 520,
          size: 0.18,
          additive: 0.15,
        }),
        flare(0, TARGET, 0.8),
        courtRing(0, 'target', 1.1, 380),
        op(0, 'punch'),
        ...signatureImpact(0),
      ],
    },
  },

  // A spiral opens on the target and spins it, then its energy streams back into the attacker.
  VORTEX: {
    cues: [
      fighter(0, 'actor', 'windup', { ms: 130, squash: 0.06 }),
      ...signatureWindup(130),
      stamp(0, TARGET, 'swirl', 1.6, 460, {
        grow: 0.7,
        fade: 0.45,
        rotJitter: 6,
        spin: -0.02,
        additive: 0.25,
        hot: 0.5,
      }),
      emit(0, 'orbit', TARGET, {
        cell: 'motif',
        q: 6,
        radius: 0.7,
        periodMs: 420,
        tilt: 0.35,
        size: 0.18,
        life: 420,
        additive: 0.2,
      }),
      emit(20, 'ring', TARGET, { cell: 'ring', q: 2, max: 2, r0: 1, r1: 0.1, life: 220, hot: 0.4 }),
      cue(60, 'release'),
      glow(420, ACTOR, 0.8, 240, { hot: 0.5 }),
      emit(420, 'burst', ACTOR, {
        cell: 'spark',
        q: 6,
        speed: 1.1,
        gravity: -0.6,
        life: 360,
        size: 0.1,
        hot: 0.4,
      }),
      op(650, 'end'),
    ],
    perHit: {
      at: 220,
      cues: [
        op(0, 'contact'),
        flare(0, TARGET, 0.85),
        emit(0, 'ring', TARGET, { cell: 'ring', q: 1, max: 1, r0: 0.6, r1: 0.05, life: 160, hot: 0.5 }),
        sparks(0, TARGET, 8, { speed: 1.3, drag: 0.7, gravity: 0, life: 260, stretch: 30 }),
        emit(40, 'streak', TARGET, {
          to: ACTOR,
          cell: 'motif',
          q: 4,
          size: 0.2,
          length: 0.4,
          travelMs: 200,
          life: 30,
          additive: 0.15,
        }),
        emit(40, 'streak', TARGET, {
          to: ACTOR,
          cell: 'glow',
          q: 1,
          max: 1,
          size: 0.35,
          length: 1.1,
          travelMs: 200,
          life: 40,
          hot: 0.4,
        }),
        op(0, 'punch', { kick: 0.5 }),
        ...signatureImpact(0),
      ],
    },
  },

  // Power gathers, then a shockwave bursts out of the attacker (in the air and along the court)
  // and its debris sweeps over the target (per hit).
  NOVA: {
    cues: [
      fighter(0, 'actor', 'windup', { ms: 100, squash: 0.12 }),
      ...signatureWindup(100),
      emit(0, 'ring', ACTOR, { cell: 'ring', q: 1, max: 1, r0: 0.8, r1: 0.1, life: 100, hot: 0.5 }),
      glow(0, ACTOR, 0.6, 140, { grow: 1.3, hot: 0.5 }),
      op(560, 'end'),
    ],
    perHit: {
      at: 100,
      cues: [
        cue(0, 'release'),
        fighter(0, 'actor', 'flash', { ms: 90 }),
        // Rings are mostly empty quads: kept just over a fighter wide and short-lived so both hits
        // of a 2-hit NOVA never stack four of them (Low's 0.6-viewport area budget).
        shockwave(0, ACTOR, 0.64, 220, { r0: 0.25, alpha: 1, hot: 0.45 }),
        courtRing(0, 'actor', 0.78, 240, { r0: 0.3, alpha: 1 }),
        emit(0, 'burst', ACTOR, {
          cell: 'motif',
          q: 6,
          speed: 3.2,
          drag: 0.85,
          gravity: 0,
          life: 380,
          size: 0.18,
          additive: 0.2,
        }),
        sparks(0, ACTOR, 8, { speed: 3.8, drag: 0.88, gravity: 0, life: 300, stretch: 55 }),
        op(70, 'contact'),
        flare(70, TARGET, 0.9, { life: 170 }),
        sparks(70, TARGET, 8, { face: 'away', spread: 1.8, speed: 1.8, life: 280 }),
        op(70, 'punch'),
        ...signatureImpact(70),
      ],
    },
  },

  // A crystal circle opens under the target and glyphs circle it; a lock seal closes behind it and
  // chains cross over it. The curse lives in the main cues so the two ranged debuff supports on
  // HEX (no landed hit) still read; their chips play in the add-on window after `end`.
  HEX: {
    cues: [
      fighter(0, 'actor', 'windup', { ms: 120, squash: 0.05 }),
      ...signatureWindup(120),
      emit(0, 'burst', anchor('actor', 'head'), {
        cell: 'rune',
        q: 2,
        speed: 0.5,
        spread: 0.8,
        gravity: -0.4,
        life: 280,
        size: 0.2,
        hot: 0.4,
      }),
      cue(40, 'release'),
      emit(40, 'groundDecal', anchor('target', 'feet'), {
        cell: 'rune',
        q: 1,
        max: 1,
        radius: 0.85,
        life: 620,
        grow: 0.4,
        additive: 0.2,
        hot: 0.4,
      }),
      emit(40, 'orbit', TARGET, {
        cell: 'rune',
        q: 4,
        radius: 0.7,
        periodMs: 700,
        tilt: 0.3,
        size: 0.2,
        life: 420,
        hot: 0.4,
      }),
      // Two thin chains snap across the target around the contact and are gone ~100 ms after it
      // at full strength; a lock seal closes behind it, framing its hit reaction.
      stamp(180, TARGET, 'chain', 1.2, 190, {
        offset: 0.04,
        rot: 0.7,
        rotJitter: 0.2,
        fade: 0.6,
        alpha: 0.85,
        additive: 0,
      }),
      stamp(190, TARGET, 'chain', 1.2, 180, {
        offset: 0.04,
        rot: -0.7,
        rotJitter: 0.2,
        fade: 0.6,
        alpha: 0.85,
        additive: 0,
      }),
      stamp(175, TARGET, 'sigil', 1.55, 440, {
        grow: 0.85,
        fade: 0.45,
        rotJitter: 0.3,
        hot: 0.65,
        back: true,
      }),
      emit(220, 'burst', TARGET, {
        cell: 'motif',
        q: 4,
        speed: 0.8,
        drag: 0.8,
        gravity: 0.2,
        life: 420,
        size: 0.18,
        additive: 0.2,
      }),
      op(650, 'end'),
    ],
    perHit: {
      at: 220,
      cues: [
        op(0, 'contact'),
        flare(0, TARGET, 0.65),
        sparks(0, TARGET, 8, { speed: 1.5, gravity: 0.4, life: 260, stretch: 30 }),
        op(0, 'punch', { kick: 0.6 }),
        ...signatureImpact(0),
      ],
    },
  },

  // The attacker braces and a shield dome snaps shut around it.
  GUARD: {
    cues: [
      fighter(0, 'actor', 'windup', { ms: 140, squash: 0.1 }),
      ...signatureWindup(120),
      emit(80, 'ring', ACTOR, { cell: 'ring', q: 1, max: 1, r0: 1, r1: 0.5, life: 160, hot: 0.4 }),
      stamp(120, ACTOR, 'shield', 1.15, 560, {
        sizeJitter: 0,
        fade: 0.5,
        alpha: 0.9,
        additive: 0.4,
        hot: 0.2,
      }),
      emit(120, 'orbit', ACTOR, {
        cell: 'motif',
        q: 6,
        radius: 0.6,
        periodMs: 900,
        tilt: 0.3,
        size: 0.15,
        life: 520,
        additive: 0.2,
      }),
      courtRing(120, 'actor', 0.8, 380, { cell: 'ring', r0: 0.5 }),
      shockwave(120, ACTOR, 0.9, 320, { sig: true }),
      op(200, 'readout'),
      op(200, 'chips'),
      op(520, 'end'),
    ],
  },

  // The attacker crouches and hops; a column of power rises around it and streaks shoot up.
  BOOST: {
    cues: [
      fighter(0, 'actor', 'windup', { ms: 120, squash: 0.14 }),
      ...signatureWindup(120),
      fighter(120, 'actor', 'victory', { hops: 1, ms: 320 }),
      courtRing(120, 'actor', 0.9, 340, { alpha: 1 }),
      emit(120, 'beamQuad', anchor('actor', 'feet'), {
        to: anchor('actor', 'feet'),
        sky: 1.9,
        cell: 'beam',
        q: 4,
        max: 2,
        width: 0.8,
        scroll: -3,
        life: 420,
        grow: 0.9,
        alpha: 0.7,
        additive: 0.45,
        hot: 0.5,
      }),
      emit(120, 'burst', anchor('actor', 'feet'), {
        cell: 'spark',
        q: 8,
        offset: 0.3,
        speed: 3.2,
        spread: 0.7,
        drag: 0.9,
        gravity: -0.8,
        life: 480,
        size: 0.12,
        stretch: 80,
        hot: 0.5,
      }),
      emit(160, 'burst', ACTOR, {
        cell: 'motif',
        q: 4,
        speed: 1.2,
        spread: 1.2,
        drag: 0.85,
        gravity: -0.6,
        life: 560,
        size: 0.2,
        additive: 0.2,
      }),
      glow(200, ACTOR, 1.1, 320, { grow: 1.1, alpha: 0.55, additive: 0.35, hot: 0.3 }),
      op(260, 'readout'),
      op(260, 'chips'),
      op(560, 'end'),
    ],
  },

  // Drops (or petals, leaves: the move's motif) fall thick on the healer inside a column of green
  // light, a pulse spreads on the court at its feet and motes and crosses rise around it.
  HEAL: {
    cues: [
      fighter(0, 'actor', 'windup', { ms: 100, squash: 0.04 }),
      ...signatureWindup(100),
      emit(20, 'rain', anchor('actor', 'head'), {
        cell: 'motif',
        q: 8,
        area: 1.2,
        fall: 2.4,
        life: 560,
        size: 0.22,
        additive: 0.1,
        hot: 0.5,
      }),
      emit(40, 'rain', anchor('actor', 'head'), {
        cell: 'petal',
        q: 4,
        area: 1.1,
        fall: 2,
        life: 520,
        size: 0.16,
        additive: 0.1,
        hot: 0.5,
      }),
      emit(60, 'beamQuad', anchor('actor', 'feet'), {
        to: anchor('actor', 'feet'),
        sky: 1.9,
        cell: 'beam',
        q: 4,
        max: 2,
        width: 0.85,
        scroll: -2.5,
        life: 560,
        grow: 0.9,
        alpha: 0.6,
        additive: 0.45,
        hot: 0.5,
        color: HEAL_GREEN,
      }),
      emit(60, 'groundDecal', anchor('actor', 'feet'), {
        cell: 'glow',
        q: 1,
        max: 1,
        radius: 0.85,
        life: 600,
        alpha: 0.85,
        color: HEAL_GREEN,
      }),
      courtRing(60, 'actor', 1, 520, { alpha: 1, color: HEAL_GREEN }),
      emit(140, 'burst', anchor('actor', 'feet'), {
        cell: 'glow',
        q: 8,
        speed: 1,
        spread: 1.2,
        drag: 0.95,
        gravity: -1.6,
        life: 720,
        size: 0.16,
        hot: 0.7,
        color: HEAL_GREEN,
      }),
      emit(160, 'burst', anchor('actor', 'feet'), {
        cell: 'cross',
        q: 5,
        speed: 0.9,
        spread: 1,
        drag: 0.95,
        gravity: -1.2,
        life: 700,
        size: 0.18,
        rot: 0,
        additive: 0.1,
        hot: 0.4,
        color: HEAL_GREEN,
      }),
      op(260, 'readout'),
      op(260, 'chips'),
      op(600, 'end'),
    ],
  },

  // A gate of feathers rises around the attacker: the chosen ally will step through after the attacks.
  RELAY: {
    cues: [
      fighter(0, 'actor', 'windup', { ms: 120, squash: 0.06 }),
      ...signatureWindup(100),
      emit(100, 'pillar', anchor('actor', 'feet'), {
        cell: 'glow',
        q: 1,
        max: 1,
        height: 1.7,
        width: 0.5,
        staggerMs: 0,
        life: 460,
        alpha: 0.7,
        hot: 0.4,
      }),
      // Two feather columns flank the relayer (T3 × quality scales them): a gate, not a curtain.
      emit(100, 'pillar', anchor('actor', 'feet'), {
        cell: 'feather',
        q: 2,
        height: 1.1,
        width: 0.24,
        staggerMs: 50,
        life: 360,
        hot: 0.3,
      }),
      courtRing(100, 'actor', 0.85, 420),
      emit(120, 'orbit', ACTOR, {
        cell: 'motif',
        q: 6,
        radius: 0.6,
        periodMs: 800,
        tilt: 0.3,
        size: 0.14,
        life: 520,
      }),
      emit(160, 'burst', anchor('actor', 'head'), {
        cell: 'star',
        q: 6,
        speed: 1.2,
        spread: 1.4,
        drag: 0.9,
        gravity: -0.2,
        life: 520,
        size: 0.1,
        hot: 0.4,
      }),
      op(300, 'readout'),
      op(300, 'chips'),
      op(600, 'end'),
    ],
  },
});

// Non-action beats (§3.4 budgets). Actors: ko → 'target' = the fallen side (per K.O.); switch,
// replacement and cut-ins → 'actor' = the event side; tick → 'target' = the ticking side; intro →
// 'both'; victory/defeat → 'actor' = the winner. Palette: the beat creature's type colour (tick:
// the ticking status colour). Chip rows are never authored here: the director plays them in the
// add-on window after `end`.
export const BEAT_TIMELINES = freezeDeep({
  // The K.O. flash and stamp land at once; the dissolve (420 ms) starts as the stamp settles and
  // the beat hands over 10 ms after it, inside the 600 budget: K.O. turns are the long tail of
  // turn pacing (§3.4, p90 ≤ 3.5 s). Everything here is over by `end`, and the director clears
  // the stamp there, so a replacement always drops onto a clean pad.
  ko: {
    cues: [
      fighter(0, 'target', 'ko'),
      cue(0, 'ko'),
      op(0, 'shot', { name: 'ko', who: 'target' }),
      op(0, 'banner', { kind: 'ko-flash' }),
      emit(0, 'burst', TARGET, {
        cell: 'spark',
        q: 12,
        speed: 2,
        drag: 0.8,
        gravity: 0.6,
        life: 360,
        size: 0.1,
        stretch: 40,
        color: WHITE,
      }),
      op(60, 'cheer'),
      op(90, 'readout'),
      fighter(150, 'target', 'faint', { ms: 330 }),
      cue(150, 'faint-cry'),
      emit(165, 'burst', TARGET, {
        cell: 'spark',
        q: 10,
        speed: 0.6,
        spread: 1.2,
        drag: 0.95,
        gravity: -0.5,
        life: 320,
        size: 0.07,
        hot: 0.4,
      }),
      op(500, 'end'),
    ],
  },
  switch: {
    cues: [
      cue(0, 'switch-out'),
      fighter(0, 'actor', 'recall'),
      emit(0, 'ring', ACTOR, { cell: 'ring', q: 1, r0: 0.55, r1: 0.05, life: 180, hot: 0.6 }),
      emit(150, 'burst', anchor('actor', 'feet'), {
        cell: 'spark',
        q: 6,
        speed: 1.1,
        spread: 0.8,
        drag: 0.85,
        gravity: -0.4,
        life: 260,
        size: 0.08,
        hot: 0.7,
      }),
      op(240, 'swap'),
      fighter(240, 'actor', 'enter'),
      op(240, 'banner', { kind: 'switch-in' }),
      cue(430, 'switch-in'),
      emit(430, 'groundDecal', anchor('actor', 'feet'), { cell: 'ring', q: 1, radius: 0.7, life: 320 }),
      emit(430, 'burst', anchor('actor', 'feet'), {
        cell: 'dust',
        q: 8,
        speed: 0.9,
        spread: 1.8,
        gravity: -0.1,
        life: 420,
        size: 0.22,
        additive: false,
        color: DUST,
      }),
      op(650, 'end'),
    ],
  },
  replacement: {
    cues: [
      op(0, 'swap'),
      fighter(0, 'actor', 'enter'),
      op(0, 'banner', { kind: 'switch-in' }),
      // The drop lands at 45 % of the 360 ms enter: the cry, dust and HUD follow it.
      cue(165, 'switch-in'),
      emit(165, 'groundDecal', anchor('actor', 'feet'), { cell: 'ring', q: 1, radius: 0.7, life: 320 }),
      emit(165, 'burst', anchor('actor', 'feet'), {
        cell: 'dust',
        q: 8,
        speed: 0.9,
        spread: 1.8,
        gravity: -0.1,
        life: 420,
        size: 0.22,
        additive: false,
        color: DUST,
      }),
      op(400, 'end'),
    ],
  },
  'perfect-relay': {
    cues: [
      op(0, 'banner', { kind: 'perfect-relay' }),
      fighter(0, 'actor', 'flash', { ms: 120 }),
      emit(60, 'ring', ACTOR, { cell: 'ring', q: 1, r0: 0.15, r1: 0.9, life: 260, hot: 0.6 }),
      emit(60, 'burst', ACTOR, {
        cell: 'star',
        q: 8,
        speed: 1.6,
        drag: 0.85,
        gravity: 0.2,
        life: 420,
        size: 0.1,
        hot: 0.5,
      }),
      op(560, 'end'),
    ],
  },
  'trainer-command': {
    cues: [
      op(0, 'banner', { kind: 'trainer-command' }),
      fighter(120, 'actor', 'victory', { hops: 1, ms: 300 }),
      emit(120, 'pillar', anchor('actor', 'feet'), {
        cell: 'streak',
        q: 4,
        height: 1.3,
        width: 0.1,
        staggerMs: 40,
        life: 320,
        hot: 0.5,
      }),
      emit(160, 'burst', ACTOR, {
        cell: 'star',
        q: 8,
        speed: 1.4,
        spread: 1.6,
        drag: 0.88,
        gravity: -0.2,
        life: 480,
        size: 0.1,
        hot: 0.5,
      }),
      op(640, 'end'),
    ],
  },
  ace: {
    cues: [
      op(0, 'banner', { kind: 'ace' }),
      op(80, 'cheer'),
      fighter(200, 'actor', 'victory', { hops: 1, ms: 360 }),
      emit(200, 'ring', ACTOR, { cell: 'ring', q: 1, r0: 0.2, r1: 1.1, life: 320, hot: 0.5 }),
      emit(220, 'burst', anchor('actor', 'head'), {
        cell: 'star',
        q: 10,
        speed: 1.8,
        spread: 1.6,
        drag: 0.88,
        gravity: 0.4,
        life: 560,
        size: 0.11,
        hot: 0.5,
      }),
      op(860, 'end'),
    ],
  },
  tick: {
    cues: [
      emit(0, 'burst', TARGET, {
        cell: 'ember',
        q: 8,
        speed: 1,
        spread: 1.2,
        drag: 0.9,
        gravity: -0.8,
        life: 480,
        size: 0.12,
        hot: 0.4,
      }),
      fighter(60, 'target', 'flash', { ms: 90 }),
      op(80, 'readout'),
      op(450, 'end'),
    ],
  },
  // The VS stack (BANNER_MS.intro) ends exactly where the weather band starts: the plates only
  // slide in once the VS cards are gone (Crystal hands over at the weather slot), and the solid
  // weather pill slides over the top row after them, so no two layers ever cross-fade in place.
  intro: {
    cues: [
      op(0, 'shot', { name: 'intro' }),
      op(0, 'banner', { kind: 'intro' }),
      emit(420, 'groundDecal', anchor('both', 'feet'), { cell: 'ring', q: 1, radius: 0.75, life: 520 }),
      cue(600, 'switch-in'),
      emit(600, 'burst', anchor('both', 'feet'), {
        cell: 'spark',
        q: 6,
        speed: 1.2,
        spread: 0.9,
        drag: 0.85,
        gravity: -0.3,
        life: 360,
        size: 0.08,
        hot: 0.6,
      }),
      op(850, 'banner', { kind: 'weather' }),
      op(1550, 'end'),
    ],
  },
  // The winner's hero moment: the camera turns to it and frames it as the hero (centred, filling
  // the room under the banner, §7.4) and orbits gently while the rival's emptied pad lowers away.
  // A warm spotlight rises behind it, it hops three times and the stands roar twice while confetti
  // celebrates: a pop of paper squares and ribbons out of the winner, then a flutter of them
  // falling over the whole upper stage (`band`), each piece flipping and swaying on its way down.
  // The flutter spawns one piece every `staggerMs`, so its length and density follow the
  // quality-scaled count (restrained on Low, generous on High). "VICTOIRE !" enters once the
  // plates have faded (200 ms).
  victory: {
    cues: [
      cue(0, 'victory'),
      op(0, 'shot', { name: 'victory', who: 'actor' }),
      op(0, 'cheer', { strength: 1.5 }),
      fighter(0, 'actor', 'flash', { color: '#fff3c4', ms: 160 }),
      courtRing(0, 'actor', 1.4, 700, { alpha: 1, color: '#ffcb3d' }),
      emit(60, 'beamQuad', anchor('actor', 'feet'), {
        to: anchor('actor', 'feet'),
        sky: 2.4,
        cell: 'beam',
        q: 2,
        max: 2,
        width: 0.9,
        scroll: -1.6,
        life: 1500,
        fadeIn: 260,
        grow: 1,
        alpha: 0.55,
        additive: 0.7,
        hot: 0.3,
        color: '#fff1b8',
        back: true,
      }),
      fighter(120, 'actor', 'victory', { hops: 3, ms: 960 }),
      op(200, 'banner', { kind: 'victory' }),
      ...confetti(230, anchor('actor', 'head'), 7, { speed: 3.4, spread: 2.3, gravity: 3, life: 1300 }),
      ...confetti(320, anchor('actor', 'head'), 13, {
        band: [0.15, 1.1],
        staggerMs: 60,
        speed: 0.5,
        spread: 6.3,
        gravity: 2.4,
        life: 1600,
      }),
      emit(270, 'burst', anchor('actor', 'head'), {
        cell: 'star',
        q: 6,
        staggerMs: 90,
        speed: 2.7,
        spread: 1.4,
        drag: 0.9,
        gravity: 2.2,
        life: 1100,
        size: 0.13,
        grow: 0.8,
        hot: 0.5,
        color: '#ffcb3d',
      }),
      op(700, 'cheer', { strength: 1.2 }),
      op(1600, 'end'),
    ],
  },
  // Dignified: no confetti, no cheer, no shake. The camera turns to the rival and slowly frames it
  // as the hero (§7.4) while the player's emptied pad lowers away; the rival gives one small hop
  // and "Défaite… Bien joué !" enters below it once the plates have faded.
  defeat: {
    cues: [
      cue(0, 'defeat'),
      op(0, 'shot', { name: 'defeat', who: 'actor' }),
      fighter(200, 'actor', 'victory', { hops: 1, ms: 500 }),
      op(200, 'banner', { kind: 'defeat' }),
      op(1600, 'end'),
    ],
  },
});

// §9.5: one persistent emitter recipe per status (≤ 8 quads); `at` is the anchor point, `lift`
// raises it by that many fighter heights. The director adds side, colour (STATUS_DEFINITIONS) and
// seed, and stop()s it on removal. Loops stay off the face: Concentré's eye and Sonné's stars
// float just above the head, Marqué's hollow reticle locks onto the creature's own chest (never
// drifting toward the other fighter or out of the stage top), ground effects hug the feet, and the
// layer caps one creature's loops at 10 quads, phase-staggered, so several statuses stay readable.
export const STATUS_LOOPS = freezeDeep({
  burning: {
    emitter: 'orbit',
    at: 'feet',
    cell: 'ember',
    q: 4,
    radius: 0.34,
    periodMs: 1700,
    tilt: 0.2,
    rise: 0.55,
    height: 0.9,
    size: 0.11,
  },
  stunned: {
    emitter: 'orbit',
    at: 'head',
    cell: 'star',
    q: 3,
    radius: 0.26,
    periodMs: 1100,
    tilt: 0.35,
    size: 0.12,
    lift: 0.04,
  },
  rooted: {
    emitter: 'orbit',
    at: 'feet',
    cell: 'vine',
    q: 4,
    radius: 0.4,
    periodMs: 7000,
    tilt: 0.12,
    size: 0.26,
  },
  marked: {
    emitter: 'orbit',
    at: 'center',
    cell: 'reticle',
    q: 1,
    radius: 0,
    periodMs: 3000,
    tilt: 0,
    size: 0.34,
    lift: 0.14,
  },
  haste: {
    emitter: 'orbit',
    at: 'center',
    cell: 'speedline',
    q: 3,
    radius: 0.52,
    periodMs: 520,
    tilt: 0.12,
    size: 0.26,
    alpha: 0.8,
  },
  evasive: {
    emitter: 'orbit',
    at: 'center',
    cell: 'smoke',
    q: 2,
    radius: 0.3,
    periodMs: 2600,
    tilt: 0,
    size: 0.6,
    alpha: 0.3,
    additive: false,
  },
  focused: {
    emitter: 'orbit',
    at: 'head',
    cell: 'eye',
    q: 1,
    radius: 0,
    periodMs: 3000,
    tilt: 0,
    size: 0.22,
    lift: 0.02,
  },
  countering: {
    emitter: 'orbit',
    at: 'center',
    cell: 'spike',
    q: 4,
    radius: 0.54,
    periodMs: 2600,
    tilt: 0.3,
    size: 0.15,
  },
});

// §9.6 banner kinds and durations in virtual ms (`reduced`: the reduced-motion fade in place;
// 0 = not shown). The Signature band fills the beat's cut-in window exactly.
export const BANNER_MS = freezeDeep({
  signature: { ms: BEAT_BUDGET_MS.signatureCutIn, reduced: 0 },
  clash: { ms: BEAT_BUDGET_MS.clashCutIn, reduced: 0 },
  'signature-ready': { ms: 600, reduced: 600 },
  'switch-in': { ms: 900, reduced: 600 },
  intro: { ms: 850, reduced: 300 },
  weather: { ms: 700, reduced: 450 },
  victory: { ms: 1400, reduced: 1000 },
  defeat: { ms: 1400, reduced: 1000 },
  'perfect-relay': { ms: 600, reduced: 450 },
  'trainer-command': { ms: 700, reduced: 450 },
  ace: { ms: 900, reduced: 450 },
  'ko-flash': { ms: 150, reduced: 0 },
});

// ---------------------------------------------------------------------------------------------
// §10.1: all moves. `motif` is the move's particle cell (a Signature uses its creature's glyph);
// `palette` is the colour source: 'move' = the move's type, 'owner' = the owner's type (neutral
// supports). Mapped from the VFX review coverage table, re-judged per move: every creature's three
// moves span at least two archetypes and damage moves always use a contact archetype.
const fx = (archetype, motif, palette = 'move') => ({ archetype, motif, palette });
export const MOVE_FX = freezeDeep({
  lucid_arc: fx('PROJ', 'crescent'),
  slowing_riddle: fx('HEX', 'rune'),
  oracle_veil: fx('GUARD', 'motif-orakyn', 'owner'),
  echo_chorus: fx('NOVA', 'ring'),
  crescendo_lock: fx('HEX', 'rune'),
  finale_nova: fx('NOVA', 'motif-lumivox'),
  memory_leech: fx('VORTEX', 'shard'),
  forgotten_name: fx('HEX', 'rune'),
  deja_vu: fx('BOOST', 'motif-mnemora', 'owner'),
  refraction_lance: fx('BEAM', 'shard'),
  mirror_maze: fx('BOOST', 'shard', 'owner'),
  spectrum_break: fx('BEAM', 'motif-prismage'),
  crystal_strike: fx('DASH', 'shard'),
  fault_charge: fx('DASH', 'motif-kordane'),
  resonant_focus: fx('BOOST', 'spark', 'owner'),
  tectonic_ram: fx('DASH', 'motif-brontusk'),
  iron_resolve: fx('GUARD', 'shield', 'owner'),
  seismic_reversal: fx('QUAKE', 'shard'),
  razor_rush: fx('SLASH', 'crescent'),
  momentum_claw: fx('SLASH', 'crescent'),
  terminal_velocity: fx('DASH', 'motif-ferrax'),
  gravity_fist: fx('QUAKE', 'shard'),
  fortress_protocol: fx('GUARD', 'shield', 'owner'),
  continental_divide: fx('QUAKE', 'motif-monolith'),
  abyssal_surge: fx('WAVE', 'drop'),
  undertow: fx('WAVE', 'bubble'),
  shell_bastion: fx('GUARD', 'motif-abyssar', 'owner'),
  foam_blitz: fx('DASH', 'bubble'),
  rip_current: fx('VORTEX', 'drop'),
  maw_of_maelstrom: fx('VORTEX', 'motif-riptalon'),
  healing_rain: fx('HEAL', 'drop', 'owner'),
  bubble_burst: fx('LOB', 'bubble'),
  tide_reversal: fx('WAVE', 'motif-nymbloom'),
  static_wake: fx('BEAM', 'bolt'),
  storm_chain: fx('RAIN', 'bolt'),
  thunder_deluge: fx('RAIN', 'motif-voltide'),
  cinder_burst: fx('PROJ', 'ember'),
  caldera_roar: fx('QUAKE', 'motif-calderoc'),
  furnace_heart: fx('BOOST', 'ember', 'owner'),
  flash_pounce: fx('DASH', 'ember'),
  scorch_mark: fx('LOB', 'ember'),
  ninefold_inferno: fx('RAIN', 'motif-pyrolynx'),
  ember_armor: fx('GUARD', 'ember', 'owner'),
  smoldering_charge: fx('DASH', 'smoke'),
  ash_rebirth: fx('HEAL', 'motif-magmoth', 'owner'),
  sun_spear: fx('BEAM', 'spark'),
  solar_wings: fx('BOOST', 'feather', 'owner'),
  supernova: fx('NOVA', 'motif-solflare'),
  petal_ray: fx('BEAM', 'petal'),
  seed_bloom: fx('HEAL', 'leaf', 'owner'),
  leaf_mantle: fx('GUARD', 'motif-virelia', 'owner'),
  mossy_crush: fx('QUAKE', 'leaf'),
  ancient_bark: fx('GUARD', 'leaf', 'owner'),
  forest_quake: fx('QUAKE', 'motif-mossaur'),
  pollen_dream: fx('RAIN', 'petal'),
  nectar_circle: fx('HEAL', 'drop', 'owner'),
  wild_bloom: fx('QUAKE', 'motif-florafae'),
  toxic_spines: fx('LOB', 'spike'),
  bramble_trap: fx('HEX', 'vine'),
  venom_harvest: fx('SLASH', 'motif-thornox'),
  shade_spark: fx('PROJ', 'spark'),
  crooked_glimmer: fx('HEX', 'star'),
  shadow_shed: fx('BOOST', 'motif-farfombre', 'owner'),
  sonic_gloom: fx('NOVA', 'ring'),
  midnight_lullaby: fx('HEX', 'star', 'owner'),
  nightmare_dive: fx('DASH', 'motif-nocturnyx'),
  ambush_claw: fx('SLASH', 'crescent'),
  smoke_step: fx('BOOST', 'smoke', 'owner'),
  eclipse_execution: fx('SLASH', 'motif-umbrawl'),
  hex_bolt: fx('PROJ', 'rune'),
  fate_exchange: fx('VORTEX', 'smoke'),
  moonless_omen: fx('HEX', 'motif-hexalune', 'owner'),
  dire_pinion: fx('PROJ', 'feather'),
  spectral_knell: fx('NOVA', 'ring'),
  eclipse_of_grace: fx('RAIN', 'motif-deuilastre'),
  dawn_dew: fx('RAIN', 'drop'),
  kindred_halo: fx('NOVA', 'feather'),
  immaculate_relay: fx('RELAY', 'motif-aubeastre', 'owner'),
  ember_feint: fx('SLASH', 'ember'),
  red_horn: fx('DASH', 'shard'),
  last_spark_duel: fx('DASH', 'motif-flambelier'),
  foam_foil: fx('SLASH', 'bubble'),
  ebb_cut: fx('SLASH', 'drop'),
  mirror_tide: fx('WAVE', 'motif-mareclat'),
  heartwood_breach: fx('DASH', 'shard'),
  resin_vise: fx('HEX', 'drop'),
  falling_rings: fx('RAIN', 'motif-xylocorne'),
  pulse_punch: fx('DASH', 'ring'),
  linked_guard: fx('GUARD', 'ring', 'owner'),
  unbroken_circle: fx('HEAL', 'motif-pactigon', 'owner'),
});

// The '#rrggbb' colour FX tint with for a move (§9.3 `color`).
export function movePalette(moveId) {
  const move = MOVES[moveId],
    affinity = MOVE_FX[moveId]?.palette === 'owner' ? CREATURES[move?.owner]?.affinity : move?.affinity;
  return (AFFINITIES[affinity] ?? AFFINITIES.neutral).color;
}
