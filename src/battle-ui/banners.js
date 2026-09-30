// Stage banners and cut-ins (docs/battle-presentation.md §9.6). One pooled node per kind inside the
// #fx-text layer (the K.O. flash and the top-band pills: on the .battle-screen root), animated with WAAPI on
// transform and opacity only. Durations are virtual ms on the session clock: the animation length is
// clock.realMs(duration) taken at start and `done` is clock.wait(duration), so ×2, hurry and a dead
// session all apply. Reduced motion fades in place; the band, the clash and the flash are absent.
// Portraits are enlarged crops of the battle sprite at an integer texel scale (owner decision).
import { ctx } from '../app/context.js';
import { icon } from '../app/icons.js';
import { BANNER_MS, movePalette } from '../data/choreo.js';

const { AFFINITIES, CREATURES, sprite, creatureName, affinityIcon } = ctx;

// Banner lines are short and large: keep French high punctuation on its word's line.
function t(key, vars) {
  return ctx.t(key, vars).replace(/ ([!?:;])/g, '\u00a0$1');
}

// Texel each creature's 48-texel portrait window centres on: its face (and crest), placed by hand
// on the normalised 128² battle sprites.
const PORTRAIT_FOCUS = {
  abyssar: [100, 36],
  aubeastre: [84, 36],
  brontusk: [82, 52],
  calderoc: [26, 98],
  deuilastre: [100, 76],
  farfombre: [62, 66],
  ferrax: [104, 42],
  flambelier: [86, 50],
  florafae: [78, 42],
  hexalune: [64, 34],
  kordane: [70, 44],
  lumivox: [68, 50],
  magmoth: [96, 66],
  mareclat: [48, 60],
  mnemora: [88, 62],
  monolith: [70, 30],
  mossaur: [106, 90],
  nocturnyx: [70, 52],
  nymbloom: [76, 40],
  orakyn: [57, 40],
  pactigon: [100, 76],
  prismage: [72, 58],
  pyrolynx: [98, 72],
  riptalon: [92, 34],
  solflare: [98, 68],
  thornox: [100, 80],
  umbrawl: [94, 66],
  virelia: [88, 50],
  voltide: [90, 36],
  xylocorne: [84, 84],
};
const PORTRAIT_TEXELS = 48;
const MINUS = '\u2212';

const pools = new WeakMap();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function typeColor(creatureId) {
  return (AFFINITIES[CREATURES[creatureId]?.affinity] ?? AFFINITIES.neutral).color;
}

// A 48 × 48-texel window of the battle sprite; CSS picks the integer scale (--texel).
function portrait(creatureId, className = '') {
  const frame = element('span', `fx-portrait ${className}`.trim()),
    image = element('img'),
    [x, y] = PORTRAIT_FOCUS[creatureId] ?? [64, 40],
    left = Math.max(0, Math.min(128 - PORTRAIT_TEXELS, x - PORTRAIT_TEXELS / 2)),
    top = Math.max(0, Math.min(128 - PORTRAIT_TEXELS, y - PORTRAIT_TEXELS / 2));
  image.alt = '';
  image.decoding = 'async';
  image.src = sprite(creatureId);
  frame.style.setProperty('--crop-x', left);
  frame.style.setProperty('--crop-y', top);
  frame.style.setProperty('--portrait-color', typeColor(creatureId));
  frame.append(image);
  return frame;
}

// Fills `node` with a translated sentence whose {placeholders} become the given DOM nodes.
function appendTemplate(node, key, parts) {
  const marks = Object.fromEntries(Object.keys(parts).map((name) => [name, `\u0000${name}\u0000`])),
    pieces = t(key, marks).split('\u0000');
  pieces.forEach((piece, index) => {
    if (index % 2) node.append(parts[piece]);
    else if (piece) node.append(piece);
  });
  return node;
}

function sideOf(data) {
  return data.side === 'enemy' ? 'enemy' : 'player';
}

// --- Builders: fill the pooled node for one showing and return its WAAPI tracks ---------------------
// Each track is [element, keyframes (motion), keyframes (reduced motion) | null].

const easeOut = 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  easeIn = 'cubic-bezier(0.5, 0, 0.9, 0.4)',
  pop = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

function fadeTrack(inAt = 0.14, outAt = 0.82) {
  return [
    { opacity: 0, offset: 0 },
    { opacity: 1, offset: inAt },
    { opacity: 1, offset: outAt },
    { opacity: 0, offset: 1 },
  ];
}

// Slide in from `from` px, hold, slide on and fade out.
function slideTrack(from, { inAt = 0.16, outAt = 0.84, exit = -from * 0.4, extra = '' } = {}) {
  return [
    { transform: `translateX(${from}px) ${extra}`, opacity: 0, offset: 0, easing: easeOut },
    { transform: `translateX(0) ${extra}`, opacity: 1, offset: inAt },
    { transform: `translateX(${exit * 0.1}px) ${extra}`, opacity: 1, offset: outAt, easing: easeIn },
    { transform: `translateX(${exit}px) ${extra}`, opacity: 0, offset: 1 },
  ];
}

function buildSignature(node, { creatureId, moveId, side }) {
  const flip = side === 'enemy' ? -1 : 1,
    strip = element('div', 'fx-band-strip'),
    copy = element('span', 'fx-band-copy');
  node.style.setProperty('--banner-color', movePalette(moveId));
  copy.append(element('small', 'fx-band-caption', `✦ ${creatureName(creatureId)}`));
  copy.append(element('b', 'fx-band-title', t('battle.signatureBanner', { move: t(`move.${moveId}`) })));
  strip.append(portrait(creatureId, 'fx-band-portrait'), copy);
  node.append(strip);
  const skew = `skewY(${-5 * flip}deg)`;
  return [
    [
      strip,
      [
        { transform: `translateX(${-110 * flip}%) ${skew}`, opacity: 1, offset: 0, easing: easeOut },
        { transform: `translateX(0) ${skew}`, offset: 0.2 },
        { transform: `translateX(${3 * flip}%) ${skew}`, opacity: 1, offset: 0.8, easing: easeIn },
        { transform: `translateX(${110 * flip}%) ${skew}`, opacity: 1, offset: 1 },
      ],
    ],
    [
      strip.firstChild,
      [
        { transform: `translateX(${-48 * flip}px) scale(0.92)`, offset: 0, easing: easeOut },
        { transform: 'translateX(0) scale(1)', offset: 0.3 },
        { transform: `translateX(${8 * flip}px) scale(1.04)`, offset: 1 },
      ],
    ],
    [
      copy.lastChild,
      [
        { transform: 'scale(1.35)', opacity: 0, offset: 0, easing: pop },
        { transform: 'scale(1)', opacity: 1, offset: 0.26 },
        { transform: 'scale(1.03)', opacity: 1, offset: 1 },
      ],
    ],
  ];
}

function clashHalf(side, { creatureId, moveId }) {
  const half = element('div', `fx-clash-half side-${side}`),
    copy = element('span', 'fx-band-copy');
  half.style.setProperty('--banner-color', movePalette(moveId));
  copy.append(element('small', 'fx-band-caption', `✦ ${creatureName(creatureId)}`));
  copy.append(element('b', 'fx-band-title', t(`move.${moveId}`)));
  half.append(portrait(creatureId, 'fx-band-portrait'), copy);
  return half;
}

function buildClash(node, { left, right }) {
  const top = clashHalf('player', left),
    bottom = clashHalf('enemy', right),
    versus = element('b', 'fx-clash-vs', 'VS');
  node.append(top, versus, bottom);
  return [
    [top, slideTrack(-360, { inAt: 0.18, outAt: 0.86, exit: -360, extra: 'skewY(-5deg)' })],
    [bottom, slideTrack(360, { inAt: 0.18, outAt: 0.86, exit: 360, extra: 'skewY(-5deg)' })],
    [
      versus,
      [
        { transform: 'scale(0)', opacity: 0, offset: 0 },
        { transform: 'scale(0)', opacity: 0, offset: 0.16, easing: pop },
        { transform: 'scale(1)', opacity: 1, offset: 0.3 },
        { transform: 'scale(1)', opacity: 1, offset: 0.86 },
        { transform: 'scale(1.4)', opacity: 0, offset: 1 },
      ],
    ],
  ];
}

function buildSignatureReady(node, { creatureId, moveId }) {
  const pill = element('div', 'fx-pill fx-ready-pill'),
    copy = element('span', 'fx-ready-copy'),
    mark = element('i', 'fx-ready-icon');
  node.style.setProperty('--banner-color', movePalette(moveId));
  mark.innerHTML = icon('sparkle');
  copy.append(
    element('small', null, t('battle.signatureReadyBanner')),
    element('b', null, t(`move.${moveId}`))
  );
  pill.append(portrait(creatureId, 'fx-mini-portrait'), copy, mark);
  node.append(pill);
  // Drops into the top band (never over the fighters, §6.4), then lifts away.
  return [
    [
      pill,
      [
        { transform: 'translateY(-18px) scale(0.9)', opacity: 0, offset: 0, easing: pop },
        { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.22 },
        { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.8 },
        { transform: 'translateY(-10px) scale(1)', opacity: 0, offset: 1 },
      ],
      fadeTrack(),
    ],
  ];
}

function buildSwitchIn(node, { side, creatureId, source, surge = 0 }) {
  const pill = element('div', 'fx-pill fx-switch-pill'),
    title = element('b', 'fx-switch-title'),
    name = creatureName(creatureId);
  node.style.setProperty('--banner-color', typeColor(creatureId));
  title.innerHTML = affinityIcon(CREATURES[creatureId].affinity);
  title.append(t(side === 'enemy' ? 'battle.enemySwitchInBanner' : 'battle.switchInBanner', { name }));
  pill.append(title);
  const notes = element('span', 'fx-switch-notes');
  if (source === 'signature')
    notes.append(element('small', 'fx-switch-note', `✦ ${t('move.immaculate_relay')}`));
  if (surge > 0) notes.append(element('small', 'fx-switch-note', t('battle.surgeBonus', { amount: surge })));
  if (notes.childElementCount) pill.append(notes);
  node.append(pill);
  return [[pill, slideTrack(40, { inAt: 0.14, outAt: 0.84 }), fadeTrack()]];
}

// `team`: the side's creature ids, lead first (a bare lead id shows no bench).
function introCard(side, team) {
  const [lead, ...bench] = [].concat(team),
    card = element('div', `fx-intro-card side-${side}`),
    copy = element('span', 'fx-intro-copy'),
    name = element('b', 'fx-intro-name');
  card.style.setProperty('--banner-color', typeColor(lead));
  name.innerHTML = affinityIcon(CREATURES[lead].affinity);
  name.append(creatureName(lead));
  const benchRow = element('span', 'fx-intro-bench');
  for (const id of bench) benchRow.append(portrait(id, 'fx-mini-portrait'));
  copy.append(name, benchRow);
  card.append(portrait(lead, 'fx-intro-portrait'), copy);
  return card;
}

function buildIntro(node, { player, enemy }) {
  const enemyCard = introCard('enemy', enemy),
    playerCard = introCard('player', player),
    versus = element('b', 'fx-intro-vs', 'VS');
  node.append(enemyCard, versus, playerCard);
  return [
    [enemyCard, slideTrack(120, { inAt: 0.2, outAt: 0.82, exit: 60 }), fadeTrack(0.2, 0.8)],
    [playerCard, slideTrack(-120, { inAt: 0.26, outAt: 0.82, exit: -60 }), fadeTrack(0.2, 0.8)],
    [
      versus,
      [
        { transform: 'scale(0) rotate(-12deg)', opacity: 0, offset: 0 },
        { transform: 'scale(0) rotate(-12deg)', opacity: 0, offset: 0.2, easing: pop },
        { transform: 'scale(1) rotate(-6deg)', opacity: 1, offset: 0.36 },
        { transform: 'scale(1) rotate(-6deg)', opacity: 1, offset: 0.82 },
        { transform: 'scale(1.3) rotate(-6deg)', opacity: 0, offset: 1 },
      ],
      fadeTrack(0.2, 0.8),
    ],
  ];
}

// "Forge du volcan : Feu +20 %, Plante −20 %": boosts first, then the weakened type.
function buildWeather(node, { arena, weather }) {
  const pill = element('div', 'fx-pill fx-weather-pill'),
    effects = element('span', 'fx-weather-effects'),
    entries = Object.entries(weather).sort(([, a], [, b]) => b - a);
  entries.forEach(([type, multiplier], index) => {
    const percent = Math.round((multiplier - 1) * 100),
      chip = element('span', `fx-weather-chip ${percent > 0 ? 'boost' : 'nerf'}`);
    chip.style.setProperty('--chip-color', AFFINITIES[type].color);
    chip.innerHTML = affinityIcon(type);
    chip.append(
      t('battle.weatherEffect', {
        type: t(`affinity.${type}`),
        percent: `${percent > 0 ? '+' : MINUS}${Math.abs(percent)}`,
      })
    );
    if (index) effects.append(', ');
    effects.append(chip);
  });
  appendTemplate(pill, 'battle.weatherBanner', {
    arena: element('b', 'fx-weather-arena', t(`arena.${arena}`)),
    effects,
  });
  node.append(pill);
  return [
    [
      pill,
      [
        { transform: 'translateY(-14px) scale(0.92)', opacity: 0, offset: 0, easing: pop },
        { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.2 },
        { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.82 },
        { transform: 'translateY(-8px) scale(1)', opacity: 0, offset: 1 },
      ],
      fadeTrack(),
    ],
  ];
}

function buildOutro(node, won) {
  const band = element('div', 'fx-outro-band'),
    title = element('b', 'fx-outro-title', t(won ? 'battle.victoryBanner' : 'battle.defeatBanner'));
  if (won) {
    const left = element('i', 'fx-outro-spark'),
      right = element('i', 'fx-outro-spark');
    left.innerHTML = right.innerHTML = icon('sparkle');
    band.append(left, title, right);
  } else band.append(title);
  node.append(band);
  const tracks = [[band, fadeTrack(0.1, 0.86), fadeTrack(0.1, 0.86)]];
  if (won)
    tracks.push([
      title,
      [
        { transform: 'scale(1.6)', opacity: 0, offset: 0, easing: pop },
        { transform: 'scale(1)', opacity: 1, offset: 0.16 },
        { transform: 'scale(1.04)', opacity: 1, offset: 1 },
      ],
      null,
    ]);
  else
    tracks.push([
      title,
      [
        { transform: 'translateY(8px)', offset: 0, easing: easeOut },
        { transform: 'translateY(0)', offset: 0.2 },
        { transform: 'translateY(0)', offset: 1 },
      ],
      null,
    ]);
  return tracks;
}

// Perfect relay, coach and Ace: one compact card sliding in from the event's side.
function buildCutIn(node, { side, creatureId }, { glyph, caption, title, note }) {
  const card = element('div', 'fx-cutin-card'),
    copy = element('span', 'fx-cutin-copy'),
    mark = element('i', 'fx-cutin-icon');
  node.style.setProperty('--banner-color', typeColor(creatureId));
  mark.innerHTML = icon(glyph);
  copy.append(element('small', null, caption), element('b', null, title));
  if (note) copy.append(element('em', null, note));
  card.append(portrait(creatureId, 'fx-cutin-portrait'), copy, mark);
  node.append(card);
  return [
    [
      card,
      slideTrack(side === 'enemy' ? 90 : -90, { inAt: 0.2, outAt: 0.84, exit: side === 'enemy' ? -40 : 40 }),
      fadeTrack(),
    ],
  ];
}

const BUILDERS = {
  signature: buildSignature,
  clash: buildClash,
  'signature-ready': buildSignatureReady,
  'switch-in': buildSwitchIn,
  intro: buildIntro,
  weather: buildWeather,
  victory: (node) => buildOutro(node, true),
  defeat: (node) => buildOutro(node, false),
  'perfect-relay': (node, data) =>
    buildCutIn(node, data, {
      glyph: 'swap',
      caption: creatureName(data.creatureId),
      title: t('battle.perfectRelayBanner'),
      note: data.surge > 0 ? t('battle.surgeBonus', { amount: data.surge }) : '',
    }),
  'trainer-command': (node, data) =>
    buildCutIn(node, data, {
      glyph: 'flag',
      caption: creatureName(data.creatureId),
      title: t('command.coach'),
    }),
  ace: (node, data) =>
    buildCutIn(node, data, {
      glyph: 'crown',
      caption: `${t('ace.reveal')} · ${creatureName(data.creatureId)}`,
      title: t(`ace.${data.ace}`),
    }),
  'ko-flash': () => [],
};

// --- Pool and playback ------------------------------------------------------------------------------

function slot(host, kind, className) {
  let byKind = pools.get(host);
  if (!byKind) pools.set(host, (byKind = new Map()));
  let entry = byKind.get(kind);
  if (!entry || !entry.node.isConnected) {
    const node = element('div', className);
    node.dataset.kind = kind;
    node.hidden = true;
    host.append(node);
    entry = { node, animations: [], token: 0 };
    byKind.set(kind, entry);
  }
  return entry;
}

function stop(entry) {
  for (const animation of entry.animations) animation.cancel();
  entry.animations = [];
  entry.node.hidden = true;
}

const NOTHING = Object.freeze({ done: Promise.resolve(true), remove() {} });

// Pills that must never sit on the fighters (§6.4) live in the top band, over the top row and
// outside the stage: full width in portrait, the dock column's top in landscape.
const TOP_BAND = new Set(['signature-ready', 'switch-in', 'weather']);

export function showBanner(kind, data = {}, { layer, clock, reducedMotion = false }) {
  const timing = BANNER_MS[kind];
  if (!timing) throw new TypeError(`Unknown banner: ${kind}`);
  const ms = reducedMotion ? timing.reduced : timing.ms;
  if (!ms) return NOTHING;
  const flash = kind === 'ko-flash',
    band = TOP_BAND.has(kind),
    host = flash || band ? layer.closest('.battle-screen') : layer;
  if (!host) return NOTHING;
  const entry = slot(host, kind, flash ? 'fx-ko-flash' : band ? 'fx-banner fx-top-band' : 'fx-banner'),
    token = ++entry.token;
  stop(entry);
  entry.node.replaceChildren();
  entry.node.dataset.side = sideOf(data);
  const tracks = flash
      ? [[entry.node, [{ opacity: 0 }, { opacity: 0.3, offset: 0.3 }, { opacity: 0 }]]]
      : BUILDERS[kind](entry.node, data),
    duration = clock.realMs(ms);
  entry.node.hidden = false;
  entry.animations = tracks
    .map(([target, motion, reduced]) => [target, reducedMotion ? reduced : motion])
    .filter(([, frames]) => frames)
    .map(([target, frames]) => target.animate(frames, { duration, fill: 'both' }));
  const remove = () => {
    if (entry.token === token) stop(entry);
  };
  return { done: clock.wait(ms).then((alive) => (remove(), alive)), remove };
}
