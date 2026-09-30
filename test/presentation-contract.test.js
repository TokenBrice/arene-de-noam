import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { MOVES } from '../src/data/moves.js';
import { AFFINITIES, AFFINITY_ORDER } from '../src/data/affinities.js';
import { CREATURES, CREATURE_IDS } from '../src/data/creatures.js';
import { STATUS_DEFINITIONS } from '../src/battle/statuses.js';
import { CLASSES, CLASS_ORDER, classIcon } from '../src/data/classes.js';
import { BEAT_BUDGET_MS, beatBudgetMs, moveTier } from '../src/battle-ui/beats.js';
import { CUE_NAMES } from '../src/battle-ui/cues.js';
import {
  ARCHETYPES,
  ATLAS,
  BANNER_MS,
  BEAT_TIMELINES,
  MOVE_FX,
  STATUS_LOOPS,
  TIERS,
  TIMELINES,
  movePalette,
  tierStretch,
} from '../src/data/choreo.js';

test('all six types have unique original SVG geometry and the settled accessible palette', () => {
  const expectedColors = {
    flame: '#FF6B4A',
    tide: '#4DA6FF',
    grove: '#55C878',
    force: '#F2B84B',
    mind: '#E879C6',
    shadow: '#9B8CFF',
  };
  const paths = AFFINITY_ORDER.map((id) => AFFINITIES[id].iconPath);
  const statusColors = new Set(Object.values(STATUS_DEFINITIONS).map(({ color }) => color.toUpperCase()));
  assert.equal(new Set(paths).size, 6);
  for (const id of AFFINITY_ORDER) {
    assert.ok(AFFINITIES[id].iconPath.length > 30, `${id} needs authored SVG geometry`);
    assert.equal(AFFINITIES[id].color, expectedColors[id]);
    assert.equal(statusColors.has(AFFINITIES[id].color.toUpperCase()), false);
    assert.equal('icon' in AFFINITIES[id], false, `${id} must not fall back to a text glyph`);
  }
});

test('all six classes have distinct muted SVG identities outside type and status palettes', () => {
  const colors = CLASS_ORDER.map((id) => CLASSES[id].color.toUpperCase()),
    paths = CLASS_ORDER.map((id) => CLASSES[id].iconPath),
    reserved = new Set([
      ...Object.values(AFFINITIES).map(({ color }) => color.toUpperCase()),
      ...Object.values(STATUS_DEFINITIONS).map(({ color }) => color.toUpperCase()),
    ]);
  assert.equal(new Set(colors).size, 6);
  assert.equal(new Set(paths).size, 6);
  for (const id of CLASS_ORDER) {
    assert.ok(CLASSES[id].iconPath.length > 30);
    assert.equal(reserved.has(CLASSES[id].color.toUpperCase()), false);
    assert.match(classIcon(id, { title: id }), /viewBox="0 0 24 24"/);
    assert.match(classIcon(id, { title: id }), /role="img"/);
  }
});

test('high-contrast and compact presentation details keep their semantic cues', async () => {
  const root = new URL('../', import.meta.url);
  const battleMoves = await readFile(new URL('styles/overrides/battle-moves.css', root), 'utf8');
  // Disabled move tiles keep a non-colour cue (dashed outline) in high contrast.
  assert.match(battleMoves, /body\.high-contrast[^{]*\.move-tile:disabled\s*\{[^}]*dashed/);
});

// --- Choreography contract (docs/battle-presentation.md §10.1) -----------------------------------

const EMITTERS = new Set([
  'burst',
  'ring',
  'streak',
  'beamQuad',
  'pillar',
  'rain',
  'orbit',
  'trailFollow',
  'groundDecal',
]);
const PERSISTENT_EMITTERS = new Set(['orbit', 'trailFollow']);
const REACTIONS = new Set([
  'windup',
  'lunge',
  'hit',
  'knockback',
  'recoil',
  'dodge',
  'tint',
  'flash',
  'ko',
  'faint',
  'recall',
  'enter',
  'victory',
  'idle',
]);
const OPS = new Set([
  'fighter',
  'emit',
  'shot',
  'punch',
  'grade',
  'cheer',
  'contact',
  'readout',
  'chips',
  'band',
  'banner',
  'cue',
  'end',
  'swap',
]);
const SHOTS = new Set(['intro', 'attack', 'lean', 'impact', 'ko', 'victory', 'cut']);
const WHO = new Set(['actor', 'target', 'both']);
const POINTS = new Set(['feet', 'center', 'head']);
const CUES = new Set(CUE_NAMES);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const timelineCues = (timeline) => [...timeline.cues, ...(timeline.perHit?.cues ?? [])];
const opsOf = (timeline, name) => timelineCues(timeline).filter((cue) => cue.op === name);
const endOf = (timeline) => opsOf(timeline, 'end')[0].at;
const isContactArchetype = (archetype) => opsOf(TIMELINES[archetype], 'contact').length > 0;

test('every move has choreography: a known archetype, an atlas motif and its palette source', () => {
  assert.deepEqual(Object.keys(MOVE_FX).sort(), Object.keys(MOVES).sort());
  for (const [id, move] of Object.entries(MOVES)) {
    const { archetype, motif, palette } = MOVE_FX[id];
    assert.ok(ARCHETYPES.includes(archetype), `${id}: unknown archetype ${archetype}`);
    assert.ok(motif in ATLAS.cells, `${id}: motif ${motif} is not an atlas cell`);
    // Typed moves show their type colour; neutral moves borrow their creature's.
    assert.equal(palette, move.affinity === 'neutral' ? 'owner' : 'move', `${id}: palette source`);
    const colour = movePalette(id);
    assert.notEqual(colour, AFFINITIES.neutral.color, `${id} must never tint FX neutral grey`);
    assert.equal(
      colour,
      AFFINITIES[move.affinity === 'neutral' ? CREATURES[move.owner].affinity : move.affinity].color
    );
    if (move.signature)
      assert.equal(motif, `motif-${move.owner}`, `${id}: a Signature carries its creature's glyph`);
  }
});

test('damage moves play a contact archetype; supports play an effect archetype or cast HEX at the target', () => {
  for (const archetype of ARCHETYPES) {
    const timeline = TIMELINES[archetype],
      contacts = opsOf(timeline, 'contact');
    if (contacts.length) {
      assert.equal(contacts.length, 1, `${archetype}: exactly one contact op`);
      if (timeline.perHit)
        assert.ok(timeline.perHit.cues.includes(contacts[0]), `${archetype}: contact lives in perHit`);
      assert.equal(
        opsOf(timeline, 'chips').length,
        0,
        `${archetype}: damage chips play in the add-on window`
      );
      assert.ok(
        opsOf(timeline, 'cue').some((cue) => cue.name === 'release'),
        `${archetype}: authors its release`
      );
    } else {
      assert.equal(timeline.perHit, undefined, `${archetype}: a support archetype has no per-hit block`);
      assert.ok(
        opsOf(timeline, 'readout').length + opsOf(timeline, 'chips').length > 0,
        `${archetype}: shows its effect`
      );
    }
  }
  for (const [id, move] of Object.entries(MOVES)) {
    const { archetype } = MOVE_FX[id];
    if (move.kind === 'damage')
      assert.ok(isContactArchetype(archetype), `${id} deals damage but ${archetype} has no contact`);
    else if (archetype === 'HEX')
      assert.ok(move.targetStatuses?.length, `${id} casts HEX without affecting the target`);
    else
      assert.equal(
        isContactArchetype(archetype),
        false,
        `${id} is a ${move.kind} move on the contact archetype ${archetype}`
      );
  }
});

test('no creature plays all three of its moves with one archetype', () => {
  for (const id of CREATURE_IDS) {
    const archetypes = CREATURES[id].moves.map((moveId) => MOVE_FX[moveId].archetype);
    assert.equal(archetypes.length, 3);
    assert.ok(new Set(archetypes).size > 1, `${id}: ${archetypes.join(', ')}`);
  }
});

function checkCue(where, cue, { end, cells }) {
  assert.ok(OPS.has(cue.op), `${where}: unknown op ${cue.op}`);
  assert.ok(Number.isFinite(cue.at) && cue.at >= 0, `${where}: ${cue.op} needs a time`);
  if (end !== undefined) assert.ok(cue.at <= end, `${where}: ${cue.op} @${cue.at} after end @${end}`);
  if ('who' in cue) assert.ok(WHO.has(cue.who), `${where}: who ${cue.who}`);
  if ('color' in cue) assert.match(cue.color, HEX_COLOR, where);
  if (cue.op === 'fighter') assert.ok(REACTIONS.has(cue.reaction), `${where}: reaction ${cue.reaction}`);
  if (cue.op === 'cue') assert.ok(CUES.has(cue.name), `${where}: cue ${cue.name}`);
  if (cue.op === 'shot') assert.ok(SHOTS.has(cue.name), `${where}: shot ${cue.name}`);
  if (cue.op === 'banner' || cue.op === 'band')
    assert.ok(cue.kind in BANNER_MS, `${where}: banner ${cue.kind}`);
  if (cue.op === 'emit') {
    assert.ok(EMITTERS.has(cue.emitter), `${where}: emitter ${cue.emitter}`);
    for (const anchor of [cue.from, cue.to].filter(Boolean)) {
      assert.ok(WHO.has(anchor.who) && POINTS.has(anchor.at), `${where}: anchor ${JSON.stringify(anchor)}`);
    }
    assert.ok(cue.from, `${where}: emit needs an anchor`);
    if (['streak', 'beamQuad'].includes(cue.emitter))
      assert.ok(cue.to, `${where}: ${cue.emitter} travels to an anchor`);
    assert.ok(Number.isInteger(cue.q) && cue.q > 0, `${where}: quad count`);
    assert.ok(
      cue.cell in ATLAS.cells || cue.cell === 'solid' || (cells === 'motif' && cue.cell === 'motif'),
      `${where}: cell ${cue.cell}`
    );
  }
}

test('every timeline op, emitter, reaction, cue, banner and atlas cell exists', () => {
  for (const archetype of ARCHETYPES) {
    const timeline = TIMELINES[archetype],
      end = endOf(timeline);
    assert.equal(opsOf(timeline, 'end').length, 1, `${archetype}: one end`);
    for (const cue of timeline.cues) checkCue(archetype, cue, { end, cells: 'motif' });
    for (const cue of timeline.perHit?.cues ?? [])
      checkCue(`${archetype} perHit`, { ...cue, at: timeline.perHit.at + cue.at }, { end, cells: 'motif' });
  }
  assert.deepEqual(Object.keys(TIMELINES).sort(), [...ARCHETYPES].sort());
  assert.deepEqual(
    Object.keys(BEAT_TIMELINES).sort(),
    [
      'ace',
      'defeat',
      'intro',
      'ko',
      'perfect-relay',
      'replacement',
      'switch',
      'tick',
      'trainer-command',
      'victory',
    ].sort()
  );
  for (const [kind, timeline] of Object.entries(BEAT_TIMELINES)) {
    assert.equal(timeline.perHit, undefined);
    assert.equal(
      opsOf(timeline, 'contact').length + opsOf(timeline, 'chips').length,
      0,
      `${kind}: no contact, chips follow the end`
    );
    for (const cue of timeline.cues) checkCue(kind, cue, { end: endOf(timeline), cells: 'none' });
  }
});

// Wall-clock length of an action timeline: stretched authored end, extra-hit spacing and every
// hit-stop (§3.4, §10.3). `lastContact` is when the last landed hit freezes and releases.
function actionWall(timeline, tier, hits) {
  const s = tierStretch(tier),
    stop = TIERS[tier].hitStopMs,
    extra = BEAT_BUDGET_MS.extraHit[tier],
    contact = opsOf(timeline, 'contact')[0],
    landed = contact ? hits : 0,
    stops = landed ? stop + (landed - 1) * Math.min(stop, 40) : 0,
    spacing = Math.max(0, landed - 1) * extra;
  return {
    end: s * endOf(timeline) + spacing + stops,
    lastContact: contact ? s * (timeline.perHit.at + contact.at) + spacing + stops : 0,
  };
}

function budget(move, tier, hits, { clash = false, lethal = false } = {}) {
  const beat = {
    kind: 'action',
    signature: Boolean(move.signature),
    clash,
    tier,
    lethal,
    hits: Array.from({ length: move.kind === 'damage' ? hits : 0 }),
    chips: [],
    talents: [],
  };
  const cutIn = beat.signature ? (clash ? BEAT_BUDGET_MS.clashCutIn : BEAT_BUDGET_MS.signatureCutIn) : 0;
  return beatBudgetMs(beat) - cutIn;
}

test('archetype timelines fit the beat budget at every tier and hit count a move can reach', () => {
  for (const [id, move] of Object.entries(MOVES)) {
    const timeline = TIMELINES[MOVE_FX[id].archetype],
      baseTier = moveTier(move),
      // Only damage can crit (tier + 1); a Signature is T3 and may open a clash.
      tiers = move.kind === 'damage' ? new Set([baseTier, Math.min(3, baseTier + 1)]) : new Set([baseTier]),
      counts = new Set([1, move.hits || 1]),
      clashes = move.signature ? [false, true] : [false];
    for (const tier of tiers)
      for (const hits of counts)
        for (const clash of clashes) {
          const wall = actionWall(timeline, tier, hits),
            label = `${id} T${tier} ×${hits}${clash ? ' clash' : ''}`;
          assert.ok(
            wall.end <= budget(move, tier, hits, { clash }),
            `${label}: ${wall.end} > ${budget(move, tier, hits, { clash })}`
          );
          // A lethal hit hands its tail to the K.O. beat: the contact must land before that cut.
          // (A 5-hit clash that is lethal on its last hit is compressed by the director.)
          if (move.kind === 'damage' && !clash) {
            const cut = budget(move, tier, hits, { lethal: true });
            assert.ok(wall.lastContact <= cut, `${label} lethal: contact ${wall.lastContact} > ${cut}`);
          }
        }
  }
});

test('non-action beats end inside their budgets and the outro banner stays readable', () => {
  const limits = {
    ko: BEAT_BUDGET_MS.ko,
    switch: BEAT_BUDGET_MS.switch,
    replacement: BEAT_BUDGET_MS.replacement,
    'perfect-relay': BEAT_BUDGET_MS.cutin['perfect-relay'],
    'trainer-command': BEAT_BUDGET_MS.cutin['trainer-command'],
    ace: BEAT_BUDGET_MS.cutin.ace,
    tick: BEAT_BUDGET_MS.tick,
    intro: 2000, // §6.6: the whole intro, weather banner included
  };
  for (const [kind, limit] of Object.entries(limits))
    assert.ok(endOf(BEAT_TIMELINES[kind]) <= limit, `${kind}: ${endOf(BEAT_TIMELINES[kind])} > ${limit}`);
  const intro = BEAT_TIMELINES.intro.cues,
    weatherAt = intro.find((cue) => cue.kind === 'weather').at;
  assert.ok(weatherAt + BANNER_MS.weather.ms <= 2000, 'the weather banner ends inside the intro');
  assert.ok(BANNER_MS.intro.ms <= 1000 && BANNER_MS.weather.ms <= 800);
  assert.ok(BANNER_MS.intro.reduced + BANNER_MS.weather.reduced <= 750);
  for (const kind of ['victory', 'defeat'])
    assert.ok(BANNER_MS[kind].ms >= 800 && BANNER_MS[kind].reduced >= 800);
  assert.equal(BANNER_MS.signature.ms, BEAT_BUDGET_MS.signatureCutIn);
  assert.equal(BANNER_MS.clash.ms, BEAT_BUDGET_MS.clashCutIn);
  assert.ok(BANNER_MS['signature-ready'].ms <= 600);
  // The softened K.O. flash: ≤ 150 ms, never under reduced motion; no band under reduced motion.
  assert.ok(BANNER_MS['ko-flash'].ms <= 150);
  for (const kind of ['ko-flash', 'signature', 'clash']) assert.equal(BANNER_MS[kind].reduced, 0);
});

test('each status keeps one persistent loop of at most eight quads in its own cell', () => {
  assert.deepEqual(Object.keys(STATUS_LOOPS).sort(), Object.keys(STATUS_DEFINITIONS).sort());
  const cells = Object.values(STATUS_LOOPS).map(({ cell }) => cell);
  assert.equal(new Set(cells).size, cells.length, 'two statuses share a motif');
  for (const [id, loop] of Object.entries(STATUS_LOOPS)) {
    assert.ok(PERSISTENT_EMITTERS.has(loop.emitter), `${id}: ${loop.emitter} cannot loop`);
    assert.ok(Number.isInteger(loop.q) && loop.q >= 1 && loop.q <= 8, `${id}: ${loop.q} quads`);
    assert.ok(loop.cell in ATLAS.cells, `${id}: cell ${loop.cell}`);
    assert.ok(POINTS.has(loop.at), `${id}: anchor ${loop.at}`);
    assert.equal('color' in loop, false, `${id}: colour comes from STATUS_DEFINITIONS`);
  }
});

// Minimal PNG reader (8-bit RGBA, non-interlaced) for the atlas checks.
function readPng(buffer) {
  assert.equal(buffer.toString('latin1', 1, 4), 'PNG');
  let offset = 8,
    header,
    data = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset),
      type = buffer.toString('latin1', offset + 4, offset + 8),
      body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR')
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        color: body[9],
        interlace: body[12],
      };
    if (type === 'IDAT') data.push(body);
    offset += length + 12;
  }
  assert.deepEqual(
    [header.depth, header.color, header.interlace],
    [8, 6, 0],
    'atlas must be 8-bit RGBA, non-interlaced'
  );
  const raw = inflateSync(Buffer.concat(data)),
    stride = header.width * 4,
    pixels = Buffer.alloc(stride * header.height);
  for (let y = 0; y < header.height; y++) {
    const filter = raw[y * (stride + 1)],
      line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
      out = pixels.subarray(y * stride, (y + 1) * stride),
      up = y ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[x - 4] : 0,
        b = up[x],
        c = x >= 4 ? up[x - 4] : 0,
        p = a + b - c,
        paeth =
          Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c)
            ? a
            : Math.abs(p - b) <= Math.abs(p - c)
              ? b
              : c;
      out[x] = (line[x] + [0, a, b, (a + b) >> 1, paeth][filter]) & 255;
    }
  }
  return { ...header, pixels };
}

test('the atlas is a premultiplied 1024² 8×8 grid holding every named cell without bleeding', async () => {
  // §9.4 fixes the generic cell order (the image and fx-layer.js share these indices).
  const generic = [
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
  ];
  generic.push(
    ...[
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
    ]
  );
  generic.forEach((name, index) => assert.equal(ATLAS.cells[name], index, name));
  for (const id of CREATURE_IDS)
    assert.ok(ATLAS.cells[`motif-${id}`] >= 24 && ATLAS.cells[`motif-${id}`] < 54, id);
  assert.equal(new Set(Object.values(ATLAS.cells)).size, Object.keys(ATLAS.cells).length);
  assert.ok(Object.values(ATLAS.cells).every((index) => index < ATLAS.grid * ATLAS.grid));
  assert.equal(ATLAS.url, './assets/fx/atlas.png');

  const png = readPng(await readFile(new URL(`../${ATLAS.url}`, import.meta.url))),
    cell = ATLAS.size / ATLAS.grid;
  assert.deepEqual([png.width, png.height, ATLAS.size, ATLAS.grid], [1024, 1024, 1024, 8]);
  for (let i = 0; i < png.pixels.length; i += 4) {
    const alpha = png.pixels[i + 3];
    if (png.pixels[i] > alpha || png.pixels[i + 1] > alpha || png.pixels[i + 2] > alpha)
      assert.fail(`pixel ${i / 4} is not premultiplied`);
  }
  for (const [name, index] of Object.entries(ATLAS.cells)) {
    const x0 = (index % ATLAS.grid) * cell,
      y0 = Math.floor(index / ATLAS.grid) * cell;
    let covered = 0,
      edge = 0;
    for (let y = 0; y < cell; y++)
      for (let x = 0; x < cell; x++) {
        const alpha = png.pixels[((y0 + y) * png.width + x0 + x) * 4 + 3];
        if (alpha > 24) covered++;
        if (alpha && (x < 2 || y < 2 || x >= cell - 2 || y >= cell - 2)) edge++;
      }
    assert.ok(covered > 80, `${name}: the cell is empty`);
    assert.equal(edge, 0, `${name}: art touches the cell border (mip/filter bleed)`);
  }
});
