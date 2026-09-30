// Battle director (docs/battle-presentation.md §6). Engine events → beats (beats.js) → timed
// choreography (choreo.js) on the session fx-clock. It drives the arena (shots, punch, grade,
// cheer), the fighters (reactions), the GPU FX layer, the #fx-text readouts (numbers, stamps,
// hit counts), 3C-2's banners, 3D's HUD routes (patchHud, drainHp, narrate) and the cue bus.
// It never calls the engine, never mutates session.state and never reads the engine RNG: FX
// randomness comes from fxSeed. One code path serves ×1, ×2, hurry, reduced motion and
// ?animations=0; each sink knows what it does in each mode (§13).
import { ctx, route } from '../app/context.js';
import { attachHaptics } from '../app/haptics.js';
import { icon } from '../app/icons.js';
import {
  BEAT_TIMELINES,
  MOVE_FX,
  STATUS_LOOPS,
  TIERS,
  TIMELINES,
  movePalette,
  punchKick,
  tierStretch,
} from '../data/choreo.js';
import { SPRITE_METRICS } from '../data/sprite-metrics.js';
import { showBanner } from './banners.js';
import { BEAT_BUDGET_MS, beatBudgetMs, fxSeed, groupBeats } from './beats.js';
import { CueBus } from './cues.js';
import { FxClock, READOUT_FLOOR_MS } from './fx-clock.js';

const {
  AFFINITIES,
  CREATURES,
  MOVES,
  STATUS_DEFINITIONS,
  STATUS_DISPLAY_ORDER,
  LOG_EVENT_TYPES,
  TRAINERS,
  TRIALS,
  activeOf,
  affinityIcon,
  creatureName,
  escapeHtml,
  params,
  screen,
  signatureCostFor,
  sprite,
  t,
} = ctx;

const SIDES = ['player', 'enemy'];
const QUALITY_QUADS = { low: 0.6, mid: 1, high: 1.4 };
const LOW_SHAKE = 0.6;
const TIMELINE_CAP = 40;
// A lethal action ends this long (virtual ms) after its last contact, never after its budget: the
// K.O. beat takes over the readout (§3.4). A lethal multi-hit that has to be compressed lands its
// last contact this early too.
const LETHAL_CONTACT_MARGIN = 40;
const MIN_HIT_SPACING = 60;
// Trailing readouts (drain heals, recoil) land just after the contact readout.
const TRAILING_READOUT_DELAY = 150;
const MISS_OVERSHOOT = 0.45;
const INTRO_SECOND_LEAD_MS = 250;
const DEVELOPMENT = typeof __DIST__ !== 'boolean';

const other = (side) => (side === 'player' ? 'enemy' : 'player');

// A battle session is alive while it is the current battle on the battle screen; a Move Theater
// session (bestiary, §8.5) carries its own `alive` predicate.
function sessionAlive(session) {
  if (!session || session.cancelled) return false;
  if (session.alive) return session.alive();
  return ctx.battleSession === session && screen.classList.contains('battle-screen');
}

function viewOf(session) {
  return session.displayState ?? session.state;
}

function creatureIn(view, side, creatureId) {
  return view?.sides?.[side]?.team.find((creature) => creature.id === creatureId) ?? null;
}

function typeColor(creatureId) {
  return AFFINITIES[CREATURES[creatureId]?.affinity]?.color ?? '#ffffff';
}

function signatureOf(creature) {
  return creature?.moves.find((id) => MOVES[id]?.signature) ?? null;
}

// Only the player's side shows a Chromatique: every rival image pins the normal look, and
// `data-variant` keeps a Chromatique toggle from repainting it (ctx.setChromatique).
function spriteAttrs(side, creatureId) {
  return side === 'player'
    ? `src="${sprite(creatureId)}"`
    : `src="${sprite(creatureId, 'normal')}" data-variant="normal"`;
}

// ---------------------------------------------------------------------------------------------
// Session presentation pair (§1.3)

// Sessions that own their presentation pair. A rematch builds its session by spreading the
// previous one (results.js), so an inherited `session.clock` belongs to a finished battle.
const presentedSessions = new WeakSet();

// Creates the session clock and cue bus once and binds the arena to the clock.
export function ensurePresentation(session) {
  if (presentedSessions.has(session)) return session;
  presentedSessions.add(session);
  session.clock = new FxClock({
    speed: ctx.save.battleSpeed,
    instant: ctx.testAnimationScale === 0,
    alive: () => sessionAlive(session),
  });
  session.cues = new CueBus();
  session.cues.on('*', (payload, name) => ctx.sound.cue(name, payload));
  attachHaptics(session, () => sessionAlive(session));
  session.beatSerial = 0;
  session.signatureReadyShown = new Set();
  session.statusLoops = new Map();
  session.tints = { player: undefined, enemy: undefined };
  session.banners = new Set();
  session.pendingCut = false;
  session.beatCursor = null;
  // Floor time (§4) at which the last readout appeared: a beat ends no earlier than its floor.
  session.lastReadoutAt = -Infinity;
  ctx.arenaScene?.setClock(session.clock);
  if (params.get('fxdebug') === '1') installFxDebug(session);
  return session;
}

// ?fxdebug=1: live FX-layer and arena counters in a corner (§9.2, §17).
function installFxDebug(session) {
  const overlay = document.createElement('pre');
  overlay.className = 'fx-debug';
  overlay.setAttribute('aria-hidden', 'true');
  screen.append(overlay);
  const timer = setInterval(() => {
    if (!sessionAlive(session)) {
      clearInterval(timer);
      overlay.remove();
      return;
    }
    const arena = ctx.arenaScene,
      fx = arena?.fx?.stats(),
      scene = arena?.stats?.();
    overlay.textContent = [
      `fx ${fx ? `${fx.live}/${fx.budget} peak ${fx.peak}` : '—'}`,
      `area ${fx ? fx.areaViewports.toFixed(2) : '—'} vp`,
      `draws ${scene?.draws ?? '—'} tris ${scene?.triangles ?? '—'}`,
      `buffer ${scene ? scene.drawingBuffer.join('×') : '—'} @${scene?.pixelRatio ?? '—'}`,
      `tier ${ctx.quality.tier} ×${session.clock.rate}`,
    ].join('\n');
  }, 250);
}

// ---------------------------------------------------------------------------------------------
// #fx-text readouts (§11.3): pooled nodes animated with WAAPI (transform/opacity only). A readout
// pops in at its presented moment beside the creature's visible outline (its opaque sprite box at
// rest), clear of both creatures, the attack's path, the plates and the other showing readouts,
// then holds until its beat's tail retires it (after ≥ READOUT_FLOOR_MS of floor time on screen),
// so the stage never shows the previous action's text under the next action's line; a lethal
// action's readouts hand over to the K.O. beat instead.
// Pool (≤ 9 nodes): per side three readout blocks and a K.O. stamp, plus one bench-ally chip. A
// block is one readout: the beat's single stamp pill over its number, then a multi-hit's count in
// words ("−31" over "3 coups": never "×3", which would read as a multiplier beside COMBO ×1,3), then
// the small tags (critical, combo, weather, absorbed, cause); a multi-hit bumps one running total.

const EDGE = 8;
const GAP = 6;
const NUMBER_SLOTS = 3;
// A block that fits no free spot at full size shrinks to this scale; shrinking costs as much as
// covering ~125 px² of its creature, so full size wins whenever it fits.
const FIT_SCALE = 0.84;
const SHRINK_COST = 1500;
// Pop-in, re-pop and exit: virtual ms at ×1 and floor ms (§4: real ms, ÷ HURRY_RATE while held).
// Reduced motion fades in place.
const ENTRY = [240, 110];
const BUMP = [180, 90];
const EXIT = [120, 80];
const REDUCED_FADE_MS = 120;
// Real ms a readout's pop or exit takes: its virtual length at the clock rate, never under its floor.
const popRealMs = (run, [virtualMs, floorMs]) =>
  run.reduced
    ? run.clock.realFloorMs(REDUCED_FADE_MS)
    : Math.max(run.clock.realMs(virtualMs), run.clock.realFloorMs(floorMs));
// The exit in floor ms: a readout's READOUT_FLOOR_MS on screen includes it.
const exitFloorMs = (run) => popRealMs(run, EXIT) * run.clock.floorRate;
// A pop overshoots its box (≤ 1.18 for a critical, which also tilts): placement keeps this much
// room around it inside the stage.
const POP_ROOM = 1.2;
// Placement cost of a spot: px² it covers of each obstacle, each point of the attack's path it
// hides, and its distance (px) from the outline. Spots are tried in preference order (ties).
const COVER = { target: 12, rival: 6, keepOut: 8, readout: 10 };
const PATH_POINT = 600;
const DISTANCE = 30;
// Attribution: a block's centre must sit at least twice as close to its own creature's outline as
// to the other's (plus ATTRIBUTION_MARGIN px); each px short costs as much as covering ~33 px² of
// its own creature, so the portrait court's shared middle band (the player's head level with the
// enemy's feet, the space between them) never takes a number that belongs to one side.
const ATTRIBUTION = 800;
const ATTRIBUTION_MARGIN = 12;

const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));

function overlap(a, b) {
  return (
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  );
}

function distanceBetween(a, b) {
  return Math.hypot(
    Math.max(0, b.left - a.right, a.left - b.right),
    Math.max(0, b.top - a.bottom, a.top - b.bottom)
  );
}

// Layout box of an element (page px, transforms ignored).
function layoutBox(element) {
  let left = 0,
    top = 0;
  for (let node = element; node; node = node.offsetParent) {
    left += node.offsetLeft;
    top += node.offsetTop;
  }
  return { left, top, right: left + element.offsetWidth, bottom: top + element.offsetHeight };
}

class ReadoutLayer {
  constructor(element) {
    this.element = element;
    this.stage = element.closest('.battle-stage') ?? element.parentElement;
    const rect = this.stage.getBoundingClientRect();
    this.size = { width: rect.width, height: rect.height };
    this.observer = new ResizeObserver((entries) => {
      const box = entries.at(-1).contentRect;
      this.size = { width: box.width, height: box.height };
      this.measureKeepOut();
    });
    this.observer.observe(this.stage);
    this.keepOut = [];
    // Showing and retiring nodes: { at (transform builder), box, fit, animation, shownAt, retiring }.
    this.live = new Map();
    const node = (className, html = '') => {
      const div = document.createElement('div');
      div.className = className;
      div.innerHTML = html;
      return div;
    };
    const numberHtml =
      '<span class="fx-stamp-pill" hidden></span><b class="fx-value"></b><small class="fx-hits" hidden></small><span class="fx-tags"><small class="fx-tag crit" hidden></small><small class="fx-tag combo" hidden></small><small class="fx-tag assist" hidden></small><small class="fx-tag weather" hidden></small><small class="fx-tag absorbed" hidden></small><small class="fx-tag cause" hidden></small></span>';
    this.sides = {};
    const fragment = document.createDocumentFragment();
    for (const side of SIDES) {
      const numbers = Array.from({ length: NUMBER_SLOTS }, () => node('fx-number', numberHtml)),
        ko = node('fx-stamp', '<span class="fx-stamp-pill" data-kind="ko"></span>');
      for (const item of [...numbers, ko]) item.dataset.side = side;
      this.sides[side] = { numbers, next: 0, ko };
      fragment.append(...numbers, ko);
    }
    this.ally = node('fx-ally', '<img alt="" width="28" height="28"><span></span>');
    fragment.append(this.ally);
    element.append(fragment);
  }

  dispose() {
    this.observer.disconnect();
    this.clear();
  }

  anchors(side) {
    const anchors = ctx.arenaScene?.anchors?.()?.[side];
    if (anchors) return anchors;
    const { width, height } = this.size,
      player = side === 'player';
    return {
      head: { x: width * (player ? 0.3 : 0.7), y: height * (player ? 0.4 : 0.2) },
      center: { x: width * (player ? 0.3 : 0.7), y: height * (player ? 0.66 : 0.41) },
      feet: { x: width * (player ? 0.3 : 0.7), y: height * (player ? 0.93 : 0.62) },
      sizePx: height * (player ? 0.53 : 0.42),
    };
  }

  // The creature's visible outline at rest (stage px): its opaque sprite box (SPRITE_METRICS,
  // square texels) fitted between the head and feet anchors, centred on the feet.
  outline(side) {
    const anchors = this.anchors(side),
      bbox = SPRITE_METRICS[this.stage.querySelector(`#fighter-${side}`)?.dataset.creature]?.bbox,
      ratio = bbox ? (bbox[2] - bbox[0] + 1) / (bbox[3] - bbox[1] + 1) : 0.7,
      half = (anchors.sizePx * ratio) / 2;
    return {
      left: anchors.feet.x - half,
      right: anchors.feet.x + half,
      top: anchors.head.y,
      bottom: anchors.feet.y,
    };
  }

  // The plates, the top row and the narration bar sit above the stage or overlap its edges
  // (§11.2; landscape turns lay the top row and the bar over the stage's top strip): a readout
  // under them would be hidden. Their layout boxes (stage coordinates, 4 px margin; transforms
  // ignored, so a plate still gliding after the stage re-fit counts where it lands) are measured
  // when a turn starts and when the stage re-fits. The rival's intent tab under its plate is
  // hidden while a turn plays, so it keeps nothing out.
  measureKeepOut() {
    const stage = layoutBox(this.stage),
      screenRoot = this.stage.closest('.battle-screen');
    this.keepOut = [
      ...(screenRoot?.querySelectorAll('.battle-top, .battle-plate, .battle-command-dock') ?? []),
    ]
      .map(layoutBox)
      .filter((box) => box.right > box.left && box.bottom > box.top)
      .map((box) => ({
        left: box.left - stage.left - 4,
        top: box.top - stage.top - 4,
        right: box.right - stage.left + 4,
        bottom: box.bottom - stage.top + 4,
      }));
  }

  // Top-left of a w×h box centred on (x, y), clamped EDGE px inside the stage (pop room included).
  clampBox(width, height, x, y, room = POP_ROOM) {
    const w = width * room,
      h = height * room,
      cx = clamp(x, EDGE + w / 2, this.size.width - EDGE - w / 2),
      cy = clamp(y, EDGE + h / 2, this.size.height - EDGE - h / 2);
    return [Math.round(cx - width / 2), Math.round(cy - height / 2)];
  }

  // A box centred on (x, y), clamped, then stepped out of the plates: below a box in the stage's
  // upper half, above one in its lower half (the K.O. stamp and the bench-ally chip).
  place(width, height, x, y, room = POP_ROOM) {
    let [left, top] = this.clampBox(width, height, x, y, room);
    for (const zone of this.keepOut) {
      if (overlap({ left, top, right: left + width, bottom: top + height }, zone) <= 0) continue;
      const below = zone.top + zone.bottom < this.size.height;
      [left, top] = this.clampBox(
        width,
        height,
        left + width / 2,
        below ? zone.bottom + (height * room) / 2 : zone.top - (height * room) / 2,
        room
      );
    }
    return [left, top];
  }

  // Centre and fit scale of a w×h readout beside `side`'s outline: spots on its inner flank (toward
  // the stage centre), over its head, under its feet and on its outer flank, each clamped inside
  // the stage and costed by what it would cover — the creature, the other creature, the attack's
  // path between them, the plates, the readouts already showing — by its distance from the
  // outline and by how clearly it reads as this creature's (ATTRIBUTION). A block too wide for
  // every free spot shrinks (FIT_SCALE) rather than cover its creature.
  besideOutline(side, width, height, self) {
    const target = this.outline(side),
      rival = this.outline(other(side)),
      centerX = (target.left + target.right) / 2,
      span = target.bottom - target.top,
      wide = target.right - target.left,
      inward = centerX < this.size.width / 2 ? 1 : -1,
      from = [(rival.left + rival.right) / 2, (rival.top + rival.bottom) / 2],
      to = [centerX, (target.top + target.bottom) / 2],
      path = [0.25, 0.375, 0.5, 0.625, 0.75].map((u) => [
        from[0] + (to[0] - from[0]) * u,
        from[1] + (to[1] - from[1]) * u,
      ]),
      // The rival's band: its outline stretched across the stage along the axis the two creatures
      // are stacked on (portrait: the rows of the court), so a number level with the other
      // creature reads as its, however far aside it sits.
      stacked = Math.abs(to[1] - from[1]) > Math.abs(to[0] - from[0]),
      rivalBand = stacked
        ? { left: 0, right: this.size.width, top: rival.top, bottom: rival.bottom }
        : { left: rival.left, right: rival.right, top: 0, bottom: this.size.height },
      showing = [...this.live]
        .filter(([node, entry]) => node !== self && !entry.retiring)
        .map(([, entry]) => entry.box);
    let best = null;
    for (const fit of [1, FIT_SCALE]) {
      const bw = width * fit,
        bh = height * fit,
        w = bw * POP_ROOM,
        h = bh * POP_ROOM,
        flank = (direction) => (direction > 0 ? target.right + GAP + w / 2 : target.left - GAP - w / 2),
        spots = [
          ...[0.22, 0.45, 0.68].map((share) => [flank(inward), target.top + span * share]),
          ...[0, 0.35, -0.35].map((shift) => [centerX + inward * shift * wide, target.top - GAP - h / 2]),
          ...[0.35, 0].map((shift) => [centerX + inward * shift * wide, target.bottom + GAP + h / 2]),
          ...[0.22, 0.45].map((share) => [flank(-inward), target.top + span * share]),
        ];
      spots.forEach(([x, y], order) => {
        const [left, top] = this.clampBox(bw, bh, x, y),
          box = { left, top, right: left + bw, bottom: top + bh };
        let cost =
          order +
          (fit < 1 ? SHRINK_COST : 0) +
          COVER.target * overlap(box, target) +
          COVER.rival * overlap(box, rival) +
          DISTANCE * distanceBetween(box, target);
        const centre = { left: left + bw / 2, right: left + bw / 2, top: top + bh / 2, bottom: top + bh / 2 };
        cost +=
          ATTRIBUTION *
          Math.max(
            0,
            2 * distanceBetween(centre, target) + ATTRIBUTION_MARGIN - distanceBetween(centre, rivalBand)
          );
        for (const zone of this.keepOut) cost += COVER.keepOut * overlap(box, zone);
        for (const readout of showing) cost += COVER.readout * overlap(box, readout);
        for (const [px, py] of path)
          if (px >= box.left && px <= box.right && py >= box.top && py <= box.bottom) cost += PATH_POINT;
        if (!best || cost < best.cost) best = { cost, x: left + bw / 2, y: top + bh / 2, fit };
      });
    }
    return best;
  }

  // A free block of the side's pool: an idle one, else one already retiring, else the next.
  freeSlot(pool) {
    const idle = pool.numbers.findIndex((node) => !this.live.has(node));
    if (idle >= 0) return idle;
    const retiring = pool.numbers.findIndex((node) => this.live.get(node).retiring);
    if (retiring >= 0) return retiring;
    pool.next = (pool.next + 1) % NUMBER_SLOTS;
    return pool.next;
  }

  // Pops a w×h node in, centred on (x, y) at scale `fit`, and holds it (fill forwards) until it
  // is retired. `bump` re-pops a showing node in place (a multi-hit's running total).
  show(run, node, x, y, width, height, { bump = false, pop = 1.12, tilt = 0, from = 0.4, fit = 1 } = {}) {
    const left = Math.round(x - width / 2),
      top = Math.round(y - height / 2),
      at = (dy, scale) =>
        `translate(${left}px, ${top + dy}px) scale(${scale * fit})${tilt ? ` rotate(${tilt}deg)` : ''}`,
      frames = run.reduced
        ? [
            { opacity: bump ? 1 : 0, transform: at(0, 1) },
            { opacity: 1, transform: at(0, 1) },
          ]
        : bump
          ? [
              { opacity: 1, transform: at(-4, pop), easing: 'cubic-bezier(.3,1.4,.5,1)' },
              { opacity: 1, transform: at(0, 1) },
            ]
          : [
              { opacity: 0, transform: at(10, from), easing: 'cubic-bezier(.2,.9,.3,1.3)' },
              { offset: 0.45, opacity: 1, transform: at(-3, pop), easing: 'ease-out' },
              { opacity: 1, transform: at(0, 1) },
            ];
    this.live.get(node)?.animation.cancel();
    const animation = node.animate(frames, {
      duration: popRealMs(run, bump ? BUMP : ENTRY),
      fill: 'forwards',
    });
    node.classList.add('showing');
    this.live.set(node, {
      at,
      box: {
        left: x - (width * fit) / 2,
        top: y - (height * fit) / 2,
        right: x + (width * fit) / 2,
        bottom: y + (height * fit) / 2,
      },
      fit,
      animation,
      shownAt: run.clock.floorNow(),
      retiring: null,
    });
  }

  // A readout block for `side`: a damage / heal / barrier / recoil / tick number (or none: a
  // dodge shows only its stamp) with its optional stamp pill, hit count (`hits` landed so far of a
  // multi-hit) and tags. `slot` bumps a block that is still showing, in place (a multi-hit's
  // running total: one node for the whole chain, so hits never recycle a slot under hurry).
  // Returns the slot used.
  number(
    run,
    side,
    { kind, text = '', critical = false, effect = 1, stamp = null, hits = 0, tags = {}, slot = null }
  ) {
    const pool = this.sides[side],
      held = slot != null ? this.live.get(pool.numbers[slot]) : null,
      bump = Boolean(held && !held.retiring),
      index = bump ? slot : this.freeSlot(pool),
      node = pool.numbers[index],
      value = node.querySelector('.fx-value'),
      count = node.querySelector('.fx-hits'),
      pill = node.querySelector('.fx-stamp-pill'),
      fontSize = critical ? 38 : kind === 'damage' && effect > 1 ? 36 : kind === 'damage' ? 32 : 28;
    node.dataset.kind = kind;
    node.style.setProperty('--fx-number-size', `${fontSize}px`);
    node.dataset.effect = effect > 1 ? 'effective' : effect < 1 ? 'resisted' : 'neutral';
    node.classList.toggle('critical', critical);
    value.innerHTML = text;
    value.hidden = !text;
    count.hidden = !hits;
    if (hits) count.textContent = t('battle.hitCount', { count: hits });
    pill.hidden = !stamp;
    if (stamp) {
      pill.dataset.kind = stamp;
      pill.innerHTML = stampHtml(stamp);
    }
    for (const tag of node.querySelectorAll('.fx-tag')) {
      const key = [...tag.classList].find((name) => name !== 'fx-tag'),
        content = tags[key];
      tag.hidden = !content;
      tag.classList.toggle('boost', Boolean(content?.boost));
      if (content) tag.innerHTML = content.html;
    }
    // The block's layout box (transforms excluded): it is laid out while hidden.
    const width = node.offsetWidth,
      height = node.offsetHeight;
    let spot;
    if (bump) {
      // A running total grows in place, around its centre, at its scale.
      const [left, top] = this.clampBox(
        width * held.fit,
        height * held.fit,
        (held.box.left + held.box.right) / 2,
        (held.box.top + held.box.bottom) / 2
      );
      spot = { x: left + (width * held.fit) / 2, y: top + (height * held.fit) / 2, fit: held.fit };
    } else spot = this.besideOutline(side, width, height, node);
    this.show(run, node, spot.x, spot.y, width, height, {
      bump,
      fit: spot.fit,
      pop: bump ? (critical ? 1.14 : 1.1) : critical ? 1.18 : 1.12,
      tilt: critical ? -4 : 0,
    });
    return index;
  }

  // The big K.O. stamp on the fallen creature (it is dissolving: the stamp is the moment).
  koStamp(run, side) {
    const node = this.sides[side].ko,
      anchors = this.anchors(side);
    node.firstElementChild.textContent = STAMP_TEXT.ko();
    const width = node.offsetWidth,
      height = node.offsetHeight,
      [left, top] = this.place(width, height, anchors.head.x, anchors.center.y - anchors.sizePx * 0.12, 1.35);
    this.show(run, node, left + width / 2, top + height / 2, width, height, { pop: 1.35, from: 2.2 });
    return node;
  }

  // Heals on benched allies: a chip under the side's pad, never over the active sprite.
  allyHeal(run, side, creatureId, amount) {
    const node = this.ally,
      anchors = this.anchors(side);
    node.dataset.side = side;
    node.querySelector('img').outerHTML =
      `<img ${spriteAttrs(side, creatureId)} alt="" width="28" height="28">`;
    node.querySelector('span').textContent = t('battle.allyHeal', { name: creatureName(creatureId), amount });
    const width = node.offsetWidth,
      height = node.offsetHeight,
      [left, top] = this.place(width, height, anchors.feet.x, anchors.feet.y + 20, 1.08);
    this.show(run, node, left + width / 2, top + height / 2, width, height, { pop: 1.08 });
  }

  // Retires readouts (default: every one showing): each keeps ≥ READOUT_FLOOR_MS of floor time on
  // screen, its exit included, then drifts up and fades. The wait for the floor runs on the clock,
  // so a hold that starts meanwhile shortens it. Resolves once every exit has finished (or was
  // superseded).
  retire(run, nodes = [...this.live.keys()]) {
    return Promise.all(nodes.map((node) => this.retireNode(run, node)));
  }

  retireNode(run, node) {
    const entry = this.live.get(node);
    if (!entry) return Promise.resolve();
    if (entry.retiring) return entry.retiring;
    const clock = run.clock,
      left = entry.shownAt + READOUT_FLOOR_MS - exitFloorMs(run) - clock.floorNow();
    entry.retiring = clock.wait(0, { floorMs: Math.max(0, left) }).then((alive) => {
      // Re-shown (a new readout took the node) or cleared meanwhile.
      if (this.live.get(node) !== entry) return undefined;
      if (!alive) {
        this.drop(node);
        return undefined;
      }
      const at = entry.at,
        animation = node.animate(
          run.reduced
            ? [
                { opacity: 1, transform: at(0, 1) },
                { opacity: 0, transform: at(0, 1) },
              ]
            : [
                { opacity: 1, transform: at(0, 1) },
                { opacity: 0, transform: at(-10, 0.94) },
              ],
          { duration: popRealMs(run, EXIT), easing: 'ease-in', fill: 'both' }
        );
      entry.animation.cancel();
      entry.animation = animation;
      return animation.finished.then(
        () => {
          if (this.live.get(node)?.animation === animation) this.drop(node);
        },
        () => {}
      );
    });
    return entry.retiring;
  }

  drop(node) {
    this.live.get(node)?.animation.cancel();
    this.live.delete(node);
    node.classList.remove('showing');
  }

  clear() {
    for (const [node, entry] of this.live) {
      entry.animation.cancel();
      node.classList.remove('showing');
    }
    this.live.clear();
  }
}

const STAMP_TEXT = {
  critical: () => t('battle.critical'),
  effective: () => t('battle.hitEffective'),
  resisted: () => t('battle.hitWeak'),
  miss: () => t('battle.missCallout'),
  blocked: () => t('battle.blocked'),
  ko: () => t('battle.koStamp'),
};
const STAMP_ICON = { critical: 'star', blocked: 'shield' };
const STAMP_CUES = new Set(['critical', 'effective', 'resisted', 'miss', 'blocked']);
// One stamp per beat, on the stage and as the narration's emphasis. Type effectiveness wins over a
// critical (the matchup is what the child can act on); a critical number keeps its gold and star.
const STAMP_PRIORITY = ['miss', 'blocked', 'effective', 'resisted', 'critical'];

function stampOf(kinds) {
  return STAMP_PRIORITY.find((kind) => kinds.includes(kind)) ?? null;
}

function stampHtml(kind) {
  const glyph = STAMP_ICON[kind];
  return `${glyph ? icon(glyph) : ''}<span>${escapeHtml(STAMP_TEXT[kind]())}</span>`;
}

let currentLayer = null;

function readoutLayer() {
  const element = screen.querySelector('#fx-text');
  if (!element) return null;
  if (currentLayer?.element !== element) {
    currentLayer?.dispose();
    currentLayer = new ReadoutLayer(element);
  }
  return currentLayer;
}

// Drops every in-flight readout, banner and FX quad of a presentation session (the battle's by
// default; clearBattleFx). A readout layer whose #fx-text left the DOM (a closed Move Theater) is
// disposed. Status loops die with the FX layer, so the session forgets them and re-syncs later.
export function clearPresentation(session = ctx.battleSession) {
  if (currentLayer && !currentLayer.element.isConnected) {
    currentLayer.dispose();
    currentLayer = null;
  }
  currentLayer?.clear();
  ctx.arenaScene?.fx?.clear();
  if (session?.banners) {
    for (const banner of session.banners) banner.remove();
    session.banners.clear();
  }
  session?.statusLoops?.clear();
}

// A multiplier as the player reads it (≤ 2 decimals, "1,3" in French). Not Intl.NumberFormat: its
// first construction loads the ICU number data, ≈ 30 ms at 6× CPU inside the first hit's frame.
function decimal(value) {
  const text = String(Math.round(value * 100) / 100);
  return ctx.i18n.lang === 'en' ? text : text.replace('.', ',');
}

// ---------------------------------------------------------------------------------------------
// Beat runs

// A beat starts where the previous one was due to end (within one late frame, real ms, at any
// rate), else now.
const CURSOR_SLACK_MS = 40;
function beatStart(session, clock) {
  const now = clock.now(),
    cursor = session.beatCursor;
  return cursor != null && now >= cursor && now - cursor <= CURSOR_SLACK_MS * clock.rate ? cursor : now;
}

function createRun(session, beat, beats, budget) {
  const clock = session.clock,
    arena = ctx.arenaScene;
  return {
    session,
    beat,
    beats,
    clock,
    arena,
    fighters: arena?.fighters ?? null,
    fx: arena?.fx ?? null,
    instant: clock.instant,
    reduced: Boolean(ctx.save.reducedMotion),
    serial: ++session.beatSerial,
    start: beatStart(session, clock),
    budget,
    presented: new Set(),
    stamped: new Set(),
    surgesShown: false,
    readoutsShown: false,
    chipsShown: false,
    consumedShown: false,
    // The action's running damage readout (contact): { dealt, absorbed, slot, tags }.
    tally: null,
    // The beat's narration line (hud handle, once), the stamp shown with it and the beat's summed
    // hit-stops (its wall-clock length is `end + stops`).
    narrated: false,
    line: null,
    lineText: '',
    stamp: null,
    stops: 0,
  };
}

function emitCue(run, name, fields = {}) {
  run.session.cues.emit(name, {
    beat: run.serial,
    speed: run.clock.rate,
    reducedMotion: run.reduced,
    ...fields,
  });
}

function markReadout(run) {
  run.session.lastReadoutAt = run.clock.floorNow();
}

function text(run) {
  return run.instant ? null : readoutLayer();
}

// Advances one event into the display state, once.
function present(run, event) {
  if (!event || run.presented.has(event)) return false;
  run.presented.add(event);
  route.advancePresentation(run.session, event);
  return true;
}

function patch(run, ...sides) {
  const view = viewOf(run.session);
  for (const side of new Set(sides)) if (side) route.patchHud(side, view);
}

function presentAll(run, events) {
  const sides = [];
  for (const event of events) if (present(run, event)) sides.push(event.side, event.targetSide);
  patch(run, ...sides);
}

// HP bars drain over DRAIN_MS; a blow that empties the bar empties it at once, so the bar reads 0
// before the K.O. beat's stamp and line land (the lethal action hands over 40 ms after its
// contact, the stamp comes 90 ms into the K.O. beat).
const DRAIN_MS = 450;
const LETHAL_DRAIN_MS = 100;
function drain(run, side, fromHp, toHp) {
  if (fromHp === toHp) return;
  route.drainHp(side, fromHp, Math.max(0, toHp), run.clock.realMs(toHp <= 0 ? LETHAL_DRAIN_MS : DRAIN_MS));
}

// The stamp shown with the beat's line becomes its emphasis at the instant it lands on the stage
// (§6.3): the narration never announces a hit before its contact.
function emphasize(run, kind) {
  if (kind === run.stamp) return;
  run.stamp = kind;
  const emphasis = kind ? STAMP_TEXT[kind]() : null;
  if (run.line) route.emphasizeNarration(run.line, emphasis);
  if (run.lineText) run.session.lastLine = emphasis ? `${run.lineText} ${emphasis}` : run.lineText;
}

// The beat's one stamp (stampOf) goes to the stage block and the narration; every fresh stamp kind
// still emits its cue. Returns the stamp shown.
function showStamps(run, side, kinds, creatureId) {
  for (const fresh of kinds.filter((candidate) => !run.stamped.has(candidate))) {
    run.stamped.add(fresh);
    if (STAMP_CUES.has(fresh)) emitCue(run, fresh, { side, creatureId, moveId: run.beat.moveId ?? null });
  }
  const kind = stampOf(kinds);
  emphasize(run, kind);
  return kind;
}

// Surges ride the beat's readout moment and never wait (§6.2); Signature-ready per §6.4. The
// engine flags `ready` at 100, but a Sunborn creature's Signature is playable from 80
// (signatureCostFor): the side also counts as ready when its gauge crosses the active
// creature's cost in this beat, which is when the dock starts to show "Prête !".
function presentSurges(run) {
  if (run.surgesShown) return;
  run.surgesShown = true;
  const beat = run.beat,
    session = run.session,
    before = Object.fromEntries(SIDES.map((side) => [side, viewOf(session).sides[side].surge]));
  presentAll(run, beat.surges ?? []);
  const view = viewOf(session);
  for (const side of SIDES) {
    const creature = activeOf(view, side);
    if (!creature || creature.hp <= 0 || !signatureOf(creature)) continue;
    const cost = signatureCostFor(creature),
      crossed = before[side] < cost && view.sides[side].surge >= cost;
    if (!crossed && !beat.readySides?.includes(side)) continue;
    const first = side === 'player' && !session.signatureReadyShown.has(creature.id);
    if (first) session.signatureReadyShown.add(creature.id);
    emitCue(run, 'signature-ready', { side, creatureId: creature.id, first });
    if (first)
      banner(run, 'signature-ready', { side, creatureId: creature.id, moveId: signatureOf(creature) });
  }
}

function presentConsumed(run) {
  if (run.consumedShown) return;
  run.consumedShown = true;
  presentAll(run, run.beat.consumed ?? []);
  syncStatusLoops(run);
}

// Why a trailing number happened, as a tag on it: the talent that fired, Ricochet, or the damage
// move whose side effect it is (drain, recoil, its barrier). A support move's heal or barrier is
// its main effect and needs none: its line says it.
function causeTags(run, event) {
  const beat = run.beat;
  let label = null;
  if (event.source === 'passive') {
    const talent = beat.events?.find(
      (candidate) =>
        candidate.type === 'passive' &&
        candidate.side === event.side &&
        candidate.creatureId === event.creatureId
    );
    if (talent) label = t(`passive.${talent.passive}`);
  } else if (event.source === 'bramblehide') label = t('passive.bramblehide');
  else if (event.source === 'countering') label = t('status.countering');
  else if (beat.kind === 'action' && event.side === beat.side && MOVES[beat.moveId]?.kind === 'damage')
    label = t(`move.${beat.moveId}`);
  return label ? { cause: { html: escapeHtml(label), text: label } } : {};
}

// Number readouts of the beat's heal / barrier / barrier-break / recoil effects (§6.2).
function presentReadouts(run) {
  if (run.readoutsShown) return;
  run.readoutsShown = true;
  const layer = text(run);
  for (const event of run.beat.readouts ?? []) {
    const view = viewOf(run.session),
      creature = creatureIn(view, event.side, event.creatureId),
      fromHp = creature?.hp ?? 0,
      active = activeOf(view, event.side)?.id === event.creatureId;
    if (!present(run, event)) continue;
    if (event.type === 'heal') {
      if (active) {
        layer?.number(run, event.side, {
          kind: 'heal',
          text: `+${event.amount}`,
          tags: causeTags(run, event),
        });
        drain(run, event.side, fromHp, event.hp);
      } else layer?.allyHeal(run, event.side, event.creatureId, event.amount);
      emitCue(run, 'heal', {
        side: event.side,
        creatureId: event.creatureId,
        amount: event.amount,
        team: event.source === 'team',
      });
      emitCue(run, 'readout', {
        side: event.side,
        creatureId: event.creatureId,
        kind: 'heal',
        amount: event.amount,
      });
    } else if (event.type === 'barrier') {
      if (event.amount > 0 && active) {
        layer?.number(run, event.side, {
          kind: 'barrier',
          text: `${icon('shield')}+${event.amount}`,
          tags: causeTags(run, event),
        });
        emitCue(run, 'readout', {
          side: event.side,
          creatureId: event.creatureId,
          kind: 'barrier',
          amount: event.amount,
        });
      }
    } else if (event.type === 'barrier-break') {
      if (event.total <= 0) {
        emitCue(run, 'break', { side: event.side, creatureId: event.creatureId, amount: event.amount });
        shatter(run, event.side);
      }
    } else if (event.type === 'recoil') {
      layer?.number(run, event.side, {
        kind: 'recoil',
        text: `−${event.amount}`,
        tags: causeTags(run, event),
      });
      if (!run.instant) run.fighters?.react(event.side, 'recoil');
      drain(run, event.side, fromHp, event.hp);
      emitCue(run, 'readout', {
        side: event.side,
        creatureId: event.creatureId,
        kind: 'recoil',
        amount: event.amount,
      });
    }
    patch(run, event.side);
    markReadout(run);
  }
}

function shatter(run, side) {
  if (run.instant || !run.fx) return;
  run.fx.emit('burst', {
    side,
    cell: 'shard',
    count: Math.round(10 * QUALITY_QUADS[ctx.quality.tier]),
    color: '#73eaff',
    speed: 1.8,
    drag: 0.85,
    gravity: 1.6,
    life: 520,
    size: 0.1,
    hot: 0.5,
    seed: fxSeed('break', side, run.serial),
  });
}

// Chip row: statuses and talents of the beat, merged (§6.2). HUD chips via patchHud, status
// loops on the fighters, one status+ / status- cue per polarity ("benefit for the creature").
function presentChips(run) {
  if (run.chipsShown) return;
  run.chipsShown = true;
  const beat = run.beat;
  if (!beat.chips?.length && !beat.talents?.length) return;
  presentAll(
    run,
    (beat.effects ?? []).filter((event) => event.type === 'status' || event.type === 'passive')
  );
  const groups = new Map();
  for (const chip of beat.chips) {
    const positive = Boolean(STATUS_DEFINITIONS[chip.status]?.positive),
      polarity = positive === Boolean(chip.applied) ? 'status+' : 'status-';
    if (!groups.has(polarity))
      groups.set(polarity, { side: chip.side, creatureId: chip.creatureId, statuses: [] });
    groups.get(polarity).statuses.push(chip.status);
    if (chip.applied) popStatus(run, chip);
  }
  for (const [name, fields] of groups) emitCue(run, name, fields);
  for (const talent of beat.talents) {
    if (run.instant || !run.fx) continue;
    run.fx.emit('ring', {
      side: talent.side,
      cell: 'ring',
      count: 1,
      color: typeColor(talent.creatureId),
      r0: 0.2,
      r1: 0.8,
      life: 320,
      hot: 0.4,
      seed: fxSeed('talent', talent.creatureId, run.serial),
    });
  }
  syncStatusLoops(run);
}

// A newly applied status pops its motif once on the fighter before its loop settles in.
function popStatus(run, chip) {
  const recipe = STATUS_LOOPS[chip.status];
  if (run.instant || !run.fx || !recipe) return;
  const view = viewOf(run.session);
  if (activeOf(view, chip.side)?.id !== chip.creatureId) return;
  run.fx.emit('burst', {
    side: chip.side,
    at: recipe.at,
    cell: recipe.cell,
    count: Math.max(1, Math.round(4 * QUALITY_QUADS[ctx.quality.tier])),
    color: STATUS_DEFINITIONS[chip.status].color,
    speed: 0.9,
    drag: 0.85,
    gravity: -0.3,
    life: 480,
    size: 0.14,
    hot: 0.3,
    seed: fxSeed('pop', chip.status, chip.creatureId, run.serial),
  });
}

// Status loops follow the presented view: one persistent emitter per status of each active
// creature; tint = its first negative status (STATUS_DISPLAY_ORDER).
function syncStatusLoops(run) {
  const session = run.session,
    view = viewOf(session),
    wanted = new Map();
  for (const side of SIDES) {
    const creature = activeOf(view, side);
    if (!creature || creature.hp <= 0) continue;
    for (const status of Object.keys(creature.statuses))
      if (STATUS_LOOPS[status]) wanted.set(`${side}:${creature.id}:${status}`, { side, creature, status });
  }
  for (const [key, handle] of session.statusLoops)
    if (!wanted.has(key)) {
      handle?.stop();
      session.statusLoops.delete(key);
    }
  const fx = ctx.arenaScene?.fx;
  for (const [key, { side, creature, status }] of wanted) {
    if (session.statusLoops.has(key) || run.instant || !fx) continue;
    const { emitter, q, ...recipe } = STATUS_LOOPS[status];
    session.statusLoops.set(
      key,
      fx.emit(emitter, {
        ...recipe,
        side,
        count: q,
        color: STATUS_DEFINITIONS[status].color,
        seed: fxSeed(status, creature.id),
      })
    );
  }
  if (run.instant || !run.fighters) return;
  for (const side of SIDES) {
    const creature = activeOf(view, side),
      statuses = creature && creature.hp > 0 ? creature.statuses : {},
      tint = STATUS_DISPLAY_ORDER.find((id) => statuses[id] && !STATUS_DEFINITIONS[id].positive) ?? null;
    if (session.tints[side] === tint) continue;
    session.tints[side] = tint;
    run.fighters.react(side, 'tint', { status: tint });
  }
}

function banner(run, kind, data) {
  if (run.instant) return;
  const layer = screen.querySelector('#fx-text');
  if (!layer) return;
  const handle = showBanner(kind, data, { layer, clock: run.clock, reducedMotion: run.reduced }),
    banners = run.session.banners;
  banners.add(handle);
  handle.done.then(
    () => banners.delete(handle),
    () => banners.delete(handle)
  );
}

// ---------------------------------------------------------------------------------------------
// Timeline ops (§10.3)

// Stretches ms-like parameters (`ms`, `life`, `…Ms`) by the tier factor.
function stretchParams(raw, stretch) {
  const out = {};
  for (const [key, value] of Object.entries(raw))
    out[key] =
      stretch !== 1 && Number.isFinite(value) && (key === 'ms' || key === 'life' || key.endsWith('Ms'))
        ? value * stretch
        : value;
  return out;
}

function sidesOf(who, scope) {
  if (who === 'both') return scope.both ?? SIDES;
  const side = scope.roles[who];
  return side ? [side] : [];
}

function opFighter(run, cue, scope) {
  if (run.instant || !run.fighters) return;
  const { at, op, who, reaction, ...raw } = cue,
    options = stretchParams(raw, scope.stretch);
  for (const side of sidesOf(who, scope)) {
    const opts = { ...options };
    if (typeof opts.toward === 'string') opts.toward = sidesOf(opts.toward, scope)[0];
    if (typeof opts.from === 'string') opts.from = sidesOf(opts.from, scope)[0];
    if (reaction === 'lunge' && opts.reach == null) opts.reach = TIERS[scope.tier].reach;
    if (reaction === 'knockback' && opts.px == null) opts.px = TIERS[scope.tier].knockPx;
    if (reaction === 'hit' && !opts.color) opts.color = scope.palette;
    if (reaction === 'recall' && !opts.color) opts.color = scope.recallColor ?? scope.palette;
    run.fighters.react(side, reaction, opts);
  }
}

function opEmit(run, cue, scope) {
  if (run.instant || !run.fx) return;
  const { at, op, emitter, from, to, q, cell, color, ...raw } = cue,
    fromWho = from?.who ?? 'actor';
  if (scope.miss && fromWho === 'target' && emitter !== 'streak' && emitter !== 'beamQuad') return;
  const count = Math.round((q ?? 1) * scope.quadScale * QUALITY_QUADS[ctx.quality.tier]);
  if (count <= 0) return;
  const options = stretchParams(raw, scope.stretch),
    toSide = to ? sidesOf(to.who, scope)[0] : null;
  if (scope.missed && to?.who === 'target' && emitter === 'streak') options.overshoot = MISS_OVERSHOOT;
  for (const side of sidesOf(fromWho, scope)) {
    const opts = {
      ...options,
      side,
      cell: cell === 'motif' ? scope.motif : cell,
      color: color ?? scope.palette,
      count,
      seed: scope.seed,
    };
    if (from?.at) opts.at = from.at;
    if (toSide) opts.to = { side: toSide, at: to.at ?? 'center' };
    run.fx.emit(emitter, opts);
  }
}

function opShot(run, cue, scope) {
  if (run.instant || !run.arena) return;
  const options = {};
  if (cue.who) options.side = sidesOf(cue.who, scope)[0];
  if (Number.isFinite(cue.ms)) options.duration = cue.ms * scope.stretch;
  void run.arena.shot(cue.name, options);
}

function opPunch(run, cue, scope) {
  if (run.instant || run.reduced || !run.arena) return;
  const tier = TIERS[scope.tier],
    shake = ctx.quality.tier === 'low' ? LOW_SHAKE : 1;
  run.arena.punch(scope.punchSide, {
    kick: punchKick(cue, scope.tier, scope.hit),
    shakePx: (cue.shakePx ?? tier.shakePx) * shake,
    shakeMs: Number.isFinite(cue.shakeMs) ? cue.shakeMs * scope.stretch : tier.shakeMs,
  });
}

function opGrade(run, cue, scope) {
  if (run.instant || !run.arena) return;
  const grade = {};
  for (const key of ['saturation', 'exposure', 'contrast'])
    if (Number.isFinite(cue[key])) grade[key] = cue[key];
  run.arena.setGrade(grade, { ms: (cue.ms ?? 0) * scope.stretch });
}

function execOp(run, cue, scope) {
  switch (cue.op) {
    case 'fighter':
      return opFighter(run, cue, scope);
    case 'emit':
      return opEmit(run, cue, scope);
    case 'shot':
      return opShot(run, cue, scope);
    case 'punch':
      return opPunch(run, cue, scope);
    case 'grade':
      return opGrade(run, cue, scope);
    case 'cheer':
      if (!run.instant) run.arena?.cheer(cue.strength ?? 1);
      return undefined;
    case 'contact':
      return scope.contact?.();
    case 'readout':
      return scope.readout?.();
    case 'chips':
      presentSurges(run);
      return presentChips(run);
    case 'band':
    case 'banner':
      return scope.banner?.(cue.kind);
    case 'cue':
      return scope.cue?.(cue.name);
    case 'swap':
      return scope.swap?.();
    case 'end':
      return undefined;
    default:
      if (DEVELOPMENT) throw new TypeError(`Unknown choreography op: ${cue.op}`);
      return undefined;
  }
}

// Plays timed items on the clock in (time, authoring) order. Items already due run in the same
// frame; a `swap` (patchFighters) is awaited before later items. Absolute deadlines never drift.
async function runSchedule(run, items) {
  items.sort((a, b) => a.time - b.time || a.order - b.order);
  for (const item of items) {
    // Nothing outlives the beat: an item authored past its end (a lethal action's tail, a
    // compressed beat's add-on) plays at the end.
    const deadline = run.start + Math.min(item.time, run.end ?? Infinity);
    if (run.clock.now() < deadline && !(await run.clock.waitUntil(deadline))) return false;
    if (!sessionAlive(run.session)) return false;
    const result = item.exec();
    if (result && typeof result.then === 'function') await result;
  }
  return sessionAlive(run.session);
}

function scheduler() {
  const items = [];
  return {
    items,
    add(time, exec) {
      items.push({ time: Math.max(0, time), order: items.length, exec });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Beat kinds

function actionPlan(run) {
  const beat = run.beat,
    tier = beat.tier,
    reduced = run.reduced,
    timeline = TIMELINES[MOVE_FX[beat.moveId].archetype],
    perHit = timeline.perHit ?? null,
    s = tierStretch(tier),
    cutIn =
      beat.signature && !beat.clashAnswer && !reduced
        ? beat.clash
          ? BEAT_BUDGET_MS.clashCutIn
          : BEAT_BUDGET_MS.signatureCutIn
        : 0,
    landed = beat.hits.length,
    hitStops = beat.hits.map((_, index) =>
      reduced || run.instant ? 0 : index === 0 ? TIERS[tier].hitStopMs : Math.min(TIERS[tier].hitStopMs, 40)
    ),
    virtualBudget = run.budget - hitStops.reduce((sum, ms) => sum + ms, 0),
    endAt = timeline.cues.find((cue) => cue.op === 'end')?.at ?? 0,
    contactAt = perHit?.cues.find((cue) => cue.op === 'contact')?.at ?? 0,
    addOn = !reduced && beat.chips.length + beat.talents.length > 0 ? BEAT_BUDGET_MS.addOn : 0;
  let spacing = reduced ? BEAT_BUDGET_MS.reducedExtraHit : BEAT_BUDGET_MS.extraHit[tier];
  // Never lengthen a beat: a long multi-hit that cannot fit (a lethal clash five-hit) compresses
  // its hit spacing instead (§3.4 "may end earlier, never later").
  if (!reduced && perHit && landed > 1) {
    const lastContact = cutIn + s * (perHit.at + contactAt) + (landed - 1) * spacing,
      end = cutIn + s * endAt + (landed - 1) * spacing + addOn,
      over = beat.lethal ? lastContact - (virtualBudget - LETHAL_CONTACT_MARGIN) : end - virtualBudget;
    if (over > 0) spacing = Math.max(MIN_HIT_SPACING, spacing - over / (landed - 1));
  }
  const time = (at) => (reduced ? 0 : cutIn + s * at),
    hitStart = (index) => (reduced ? index * spacing : cutIn + s * perHit.at + index * spacing),
    hitTime = (index, at) => hitStart(index) + (reduced ? 0 : s * at),
    authoredEnd = reduced
      ? Math.max(0, landed - 1) * spacing
      : cutIn + s * endAt + Math.max(0, landed - 1) * spacing,
    lastContact = landed ? hitTime(landed - 1, contactAt) : 0,
    // The beat ends with its choreography (authored end + chip add-on), never after its budget;
    // a lethal one LETHAL_CONTACT_MARGIN after its last contact (the K.O. beat takes over).
    end = reduced
      ? virtualBudget
      : beat.lethal && landed
        ? Math.min(virtualBudget, lastContact + LETHAL_CONTACT_MARGIN)
        : Math.min(virtualBudget, authoredEnd + (perHit ? addOn : 0));
  return { timeline, perHit, s, cutIn, hitStops, end, time, hitTime, contactAt, authoredEnd };
}

function actionScope(run, plan, extra = {}) {
  const beat = run.beat;
  return {
    roles: { actor: beat.side, target: beat.targetSide },
    both: [beat.side, beat.targetSide],
    tier: beat.tier,
    stretch: run.reduced ? 1 : plan.s,
    quadScale: TIERS[beat.tier].quadScale,
    palette: movePalette(beat.moveId),
    motif: MOVE_FX[beat.moveId].motif,
    punchSide: beat.targetSide,
    seed: beat.seed,
    missed: Boolean(beat.miss),
    readout: () => {
      presentSurges(run);
      presentConsumed(run);
      presentReadouts(run);
    },
    banner: (kind) =>
      banner(run, kind, { side: beat.side, creatureId: beat.creatureId, moveId: beat.moveId }),
    cue: (name) => emitCue(run, name, { ...actionCueFields(run), hit: extra.hitNumber ?? 1 }),
    ...extra,
  };
}

function actionCueFields(run) {
  const beat = run.beat,
    move = MOVES[beat.moveId];
  return {
    side: beat.side,
    creatureId: beat.creatureId,
    moveId: beat.moveId,
    affinity: move?.affinity ?? null,
    archetype: MOVE_FX[beat.moveId].archetype,
    tier: beat.tier,
    signature: beat.signature,
  };
}

// Contact routine for one landed hit (§6.2): cue, true hit-stop, target reactions, then the
// readout — number (+ hit count, tags), HP drain, stamps, readout cue.
function contact(run, hit, index, hitStop) {
  const beat = run.beat,
    target = beat.targetSide,
    damage = hit.damage,
    move = MOVES[beat.moveId],
    view = viewOf(run.session),
    fromHp = creatureIn(view, target, damage.creatureId)?.hp ?? 0;
  emitCue(run, 'contact', {
    side: target,
    sourceSide: beat.side,
    creatureId: damage.creatureId,
    moveId: beat.moveId,
    affinity: move?.affinity ?? null,
    hit: damage.hit,
    hits: damage.hits,
    amount: damage.amount,
    absorbed: damage.absorbed,
    critical: hit.critical,
    effectiveness: damage.affinity,
    blocked: hit.blocked,
    lethal: hit.lethal,
    tier: beat.tier,
  });
  if (hitStop > 0) void run.clock.hitStop(hitStop);
  if (!run.instant && run.fighters) {
    if (hit.blocked) run.fighters.react(target, 'flash', { color: '#73eaff' });
    else {
      run.fighters.react(target, 'hit', { color: movePalette(beat.moveId) });
      run.fighters.react(target, 'knockback', { px: TIERS[beat.tier].knockPx, from: beat.side });
    }
  }
  presentAll(run, [hit.barrierHit, damage, ...hit.between]);
  drain(run, target, fromHp, damage.hp);
  if (hit.barrierHit && hit.barrierHit.total <= 0) {
    emitCue(run, 'break', { side: target, creatureId: damage.creatureId, amount: hit.barrierHit.amount });
    shatter(run, target);
  }
  if (index === 0) {
    presentSurges(run);
    presentConsumed(run);
  }
  // One readout block per action: later hits of a multi-hit bump a running total in the first
  // hit's block (each hit re-pops it with its hit count), so a fast chain never recycles a
  // showing number and the child reads what the whole chain did. Its stamp is the shield while
  // nothing got through, then the beat's landed stamps from its first landed hit on.
  const tally = (run.tally ??= { dealt: 0, absorbed: 0, critical: false, slot: null, tags: {} });
  tally.dealt += damage.amount;
  tally.absorbed += hit.barrierHit?.amount ?? damage.absorbed ?? 0;
  tally.critical ||= hit.critical && !hit.blocked;
  const blocked = tally.dealt === 0,
    stamp = showStamps(
      run,
      target,
      blocked ? ['blocked'] : beat.stamps.filter((kind) => kind !== 'blocked' && kind !== 'miss'),
      damage.creatureId
    ),
    layer = text(run);
  if (layer) {
    if (index === 0 && damage.combo) {
      const label = t('battle.comboTag', { multiplier: decimal(damage.combo.multiplier) });
      tally.tags.combo = { html: escapeHtml(label), text: label };
      if (beat.assist) {
        const helper = t('battle.preparedBy', { helper: creatureName(beat.assist.creatureId) });
        tally.tags.assist = {
          html: `<img ${spriteAttrs(beat.assist.side, beat.assist.creatureId)} alt="" width="18" height="18">${escapeHtml(helper)}`,
          text: helper,
          icon: true,
        };
      }
    }
    if (Number.isFinite(damage.weather) && damage.weather !== 1 && !hit.blocked) {
      const percent = Math.round(Math.abs(damage.weather - 1) * 100),
        label = t('battle.weatherTag', { value: `${damage.weather > 1 ? '+' : '−'}${percent}` });
      tally.tags.weather = {
        html: `${AFFINITIES[damage.moveAffinity] ? affinityIcon(damage.moveAffinity) : ''}${escapeHtml(label)}`,
        text: label,
        icon: true,
        boost: damage.weather > 1,
      };
    }
    const tags = { ...tally.tags },
      critical = tally.critical && !blocked;
    // A critical behind an effectiveness stamp keeps its gold number and says so in a gold
    // "★ Coup critique !" tag right under it (the stamp is the matchup lesson).
    if (critical && stamp !== 'critical') {
      const label = t('battle.critical');
      tags.crit = { html: `${icon('star')}${escapeHtml(label)}`, text: label, icon: true };
    }
    if (tally.absorbed > 0 && !blocked)
      tags.absorbed = {
        html: `${icon('shield')}${tally.absorbed}`,
        text: String(tally.absorbed),
        icon: true,
      };
    tally.slot = layer.number(run, target, {
      kind: blocked ? 'blocked' : 'damage',
      text: blocked ? `${icon('shield')}${tally.absorbed}` : `−${tally.dealt}`,
      critical,
      effect: blocked ? 1 : damage.affinity,
      stamp,
      hits: damage.hits > 1 ? damage.hit : 0,
      tags,
      slot: tally.slot,
    });
  }
  emitCue(run, 'readout', {
    side: target,
    creatureId: damage.creatureId,
    kind: 'damage',
    amount: damage.amount,
    hit: damage.hit,
    hits: damage.hits,
  });
  markReadout(run);
}

// A dodge replaces the contact routine (§6.2): the "Esquivé !" block, no number.
function dodge(run) {
  const beat = run.beat,
    target = beat.targetSide;
  if (!run.instant) run.fighters?.react(target, 'dodge', { from: beat.side });
  presentAll(run, [beat.miss]);
  presentSurges(run);
  presentConsumed(run);
  const stamp = showStamps(run, target, ['miss'], beat.miss.creatureId);
  text(run)?.number(run, target, { kind: 'miss', stamp });
  markReadout(run);
}

function signatureCutIn(run, plan) {
  const beat = run.beat;
  emitCue(run, 'signature-cutin', {
    side: beat.side,
    creatureId: beat.creatureId,
    moveId: beat.moveId,
    clash: beat.clash,
  });
  if (run.instant || run.reduced) return;
  run.arena?.setGrade({ exposure: -0.35 }, { ms: 120 });
  if (beat.clash) {
    const rival = run.beats.find(
        (candidate) =>
          candidate !== beat &&
          candidate.kind === 'action' &&
          candidate.signature &&
          candidate.side !== beat.side
      ),
      [left, right] = beat.side === 'player' ? [beat, rival] : [rival, beat];
    banner(run, 'clash', {
      left: { side: 'player', creatureId: left.creatureId, moveId: left.moveId },
      right: { side: 'enemy', creatureId: right.creatureId, moveId: right.moveId },
    });
  } else banner(run, 'signature', { side: beat.side, creatureId: beat.creatureId, moveId: beat.moveId });
  run.clock.at(Math.max(0, plan.cutIn - 90), () => run.arena?.setGrade({}, { ms: 150 }));
}

async function playAction(run, plan) {
  const beat = run.beat,
    { timeline, perHit } = plan,
    queue = scheduler();
  // The clash band already announced the answering Signature: it plays no band of its own.
  if (beat.signature && !beat.clashAnswer) queue.add(0, () => signatureCutIn(run, plan));
  // The Signature spend empties the gauge as the move fires.
  queue.add(plan.cutIn, () => {
    presentAll(
      run,
      beat.surges.filter((event) => event.source === 'signature' && event.amount < 0)
    );
    emitCue(run, 'windup', actionCueFields(run));
  });
  // Authored cues may be Signature-only (`sig: true`) or plain-only (`sig: false`); a `once` per-hit
  // cue plays on the first entry only (the first landed hit, or the miss stand-in).
  const plays = (cue, index = 0) =>
    (cue.sig === undefined || cue.sig === beat.signature) && (!cue.once || index === 0);
  const main = actionScope(run, plan);
  for (const cue of timeline.cues)
    if (cue.op !== 'end' && plays(cue)) queue.add(plan.time(cue.at), () => execOp(run, cue, main));
  if (perHit) {
    const hits = beat.hits.length ? beat.hits : beat.miss ? [null] : [];
    hits.forEach((hit, index) => {
      const scope = actionScope(run, plan, {
        seed: hit?.seed ?? beat.seed,
        hitNumber: hit?.hit ?? 1,
        miss: !hit,
        hit,
        contact: () => (hit ? contact(run, hit, index, plan.hitStops[index]) : dodge(run)),
      });
      for (const cue of perHit.cues) {
        if (!plays(cue, index) || (!hit && (cue.op === 'punch' || cue.op === 'shot'))) continue;
        queue.add(plan.hitTime(index, cue.at), () => execOp(run, cue, scope));
      }
    });
    // Drain heals and recoil overlap the last contact's readout window.
    if (beat.hits.length)
      queue.add(plan.hitTime(beat.hits.length - 1, plan.contactAt) + TRAILING_READOUT_DELAY, () =>
        presentReadouts(run)
      );
    // Add-on window after the authored end: the chip row (and any no-contact beat's readouts).
    queue.add(plan.authoredEnd, () => {
      presentSurges(run);
      presentConsumed(run);
      presentReadouts(run);
      presentChips(run);
    });
  }
  return runSchedule(run, queue.items);
}

// Non-action beats play one BEAT_TIMELINES entry per role set (§10.1). `extra` adds per-kind
// handlers (readout, swap, cue fields).
function beatScope(run, roles, extra) {
  return {
    roles,
    tier: 1,
    stretch: 1,
    quadScale: 1,
    punchSide: roles.target ?? roles.actor,
    seed: fxSeed(run.beat.kind, extra.creatureId ?? '', run.beat.events?.[0]?.turn ?? 0),
    motif: extra.creatureId ? `motif-${extra.creatureId}` : 'glow',
    ...extra,
  };
}

// Chip add-on window of a non-action beat (§3.4).
function addOnMs(beat) {
  return beat.chips?.length || beat.talents?.length ? BEAT_BUDGET_MS.addOn : 0;
}

// A non-action beat never runs past its budget: its authored timeline (`authored` virtual ms,
// which fits the ×1 budget, §3.4) is time-scaled into the budget less the chip add-on window when
// it is longer (reduced motion's 450 ms readout beat).
function fitScale(run, authored) {
  const room = run.budget - (run.reduced ? 0 : addOnMs(run.beat));
  return authored > room && authored > 0 ? Math.max(0, room) / authored : 1;
}

// Schedules a BEAT_TIMELINES entry from `offset` (authored ms), its times scaled by `scale`.
function scheduleTimeline(queue, run, timeline, scope, { offset = 0, scale = 1 } = {}) {
  for (const cue of timeline.cues)
    if (cue.op !== 'end') queue.add((offset + cue.at) * scale, () => execOp(run, cue, scope));
  return (offset + timelineEnd(timeline)) * scale;
}

async function playKo(run) {
  const beat = run.beat,
    queue = scheduler(),
    stamps = [],
    scale = fitScale(
      run,
      (run.reduced ? 0 : (beat.kos.length - 1) * BEAT_BUDGET_MS.extraKo) + timelineEnd(BEAT_TIMELINES.ko)
    );
  // A lethal action's readouts were handed over (§3.4): they bow out now, once their floor is over.
  text(run)?.retire(run);
  presentAll(run, beat.skips);
  let end = 0;
  beat.kos.forEach(({ side, creatureId }, index) => {
    const event = beat.events.find((candidate) => candidate.type === 'ko' && candidate.side === side),
      scope = beatScope(
        run,
        { target: side, actor: other(side) },
        {
          creatureId,
          palette: typeColor(creatureId),
          readout: () => {
            presentAll(run, [event]);
            const stamp = text(run)?.koStamp(run, side);
            if (stamp) stamps.push(stamp);
            markReadout(run);
            narrateBeat(run);
          },
          cue: (name) => emitCue(run, name, { side, creatureId }),
          // One softened flash per beat, never stacked, none under reduced motion.
          banner: (kind) =>
            kind === 'ko-flash' && (index > 0 || run.reduced)
              ? undefined
              : banner(run, kind, { side, creatureId }),
        }
      );
    end = Math.max(
      end,
      scheduleTimeline(queue, run, BEAT_TIMELINES.ko, scope, {
        offset: run.reduced ? 0 : index * BEAT_BUDGET_MS.extraKo,
        scale,
      })
    );
  });
  // The stamp bows out before the beat hands over: a replacement never drops under "K.O. !".
  queue.add(end - (run.reduced ? REDUCED_FADE_MS : EXIT[0]), () => text(run)?.retire(run, stamps));
  queue.add(end, () => route.patchFighters(viewOf(run.session)));
  run.session.pendingCut = true;
  return runSchedule(run, queue.items);
}

async function playSwitch(run) {
  const beat = run.beat,
    side = beat.side,
    queue = scheduler(),
    outgoing = viewOf(run.session).sides[side].team[beat.from],
    timeline = BEAT_TIMELINES[beat.replacement ? 'replacement' : 'switch'],
    // One ✦ number at a time: when this switch is a good one, its relay card that follows carries
    // the only number (+6, the lesson), and the switch pill drops the generic switch bonus.
    relayFollows = run.beats.some(
      (candidate) =>
        candidate.kind === 'cutin' && candidate.cutIn === 'perfect-relay' && candidate.side === side
    ),
    scope = beatScope(
      run,
      { actor: side, target: other(side) },
      {
        creatureId: beat.creatureId,
        palette: typeColor(beat.creatureId),
        recallColor: outgoing ? typeColor(outgoing.id) : undefined,
        swap: async () => {
          presentAll(run, [beat.start]);
          narrateBeat(run);
          await route.patchFighters(viewOf(run.session));
          syncStatusLoops(run);
        },
        banner: (kind) =>
          banner(run, kind, {
            side,
            creatureId: beat.creatureId,
            source: beat.source,
            surge: relayFollows ? 0 : surgeGain(beat, side, 'switch'),
          }),
        cue: (name) => {
          if (name === 'switch-out') emitCue(run, name, { side, creatureId: outgoing?.id ?? null });
          else if (name === 'switch-in') {
            emitCue(run, name, { side, creatureId: beat.creatureId, source: beat.source });
            // The HUD follows the landing (±50 ms), with the switch Surge.
            patch(run, side);
            presentSurges(run);
          } else emitCue(run, name, { side, creatureId: beat.creatureId });
        },
      }
    ),
    end = scheduleTimeline(queue, run, timeline, scope, { scale: fitScale(run, timelineEnd(timeline)) });
  // The recall has its own line (§6.3), so the bar never sits empty while the outgoing creature
  // leaves; the entry line takes over at the swap. A replacement enters an empty pad: no recall.
  if (!beat.replacement && outgoing)
    queue.add(0, () =>
      route.narrate(
        t(side === 'player' ? 'battle.recall' : 'battle.enemyRecall', { name: creatureName(outgoing.id) })
      )
    );
  queue.add(end, () => {
    presentSurges(run);
    presentReadouts(run);
    presentChips(run);
  });
  return runSchedule(run, queue.items);
}

// Surge a beat grants a side from one source (the relay bonus shown on its banner).
function surgeGain(beat, side, source) {
  return beat.surges.reduce(
    (sum, event) =>
      sum + (event.side === side && event.source === source && event.amount > 0 ? event.amount : 0),
    0
  );
}

function cutInData(beat) {
  const event = beat.start;
  if (beat.cutIn === 'trainer-command')
    return { side: beat.side, creatureId: beat.creatureId, command: event.command };
  if (beat.cutIn === 'ace') return { side: beat.side, creatureId: beat.creatureId, ace: event.ace };
  return {
    side: beat.side,
    creatureId: beat.creatureId,
    moveId: event.moveId,
    surge: surgeGain(beat, beat.side, 'perfect-relay'),
  };
}

async function playCutIn(run) {
  const beat = run.beat,
    queue = scheduler(),
    scope = beatScope(
      run,
      { actor: beat.side, target: other(beat.side) },
      {
        creatureId: beat.creatureId,
        palette: typeColor(beat.creatureId),
        banner: (kind) => {
          presentAll(run, [beat.start]);
          presentSurges(run);
          banner(run, kind, cutInData(beat));
        },
        cue: (name) => emitCue(run, name, { side: beat.side, creatureId: beat.creatureId }),
      }
    ),
    timeline = BEAT_TIMELINES[beat.cutIn],
    end = scheduleTimeline(queue, run, timeline, scope, { scale: fitScale(run, timelineEnd(timeline)) });
  queue.add(end, () => {
    presentAll(run, [beat.start]);
    presentSurges(run);
    presentReadouts(run);
    presentChips(run);
  });
  return runSchedule(run, queue.items);
}

async function playChip(run) {
  const beat = run.beat,
    queue = scheduler();
  if (beat.chip === 'tick') {
    let end = 0;
    for (const side of new Set(beat.ticks.map((tick) => tick.side))) {
      const ticks = beat.ticks.filter((tick) => tick.side === side),
        status = ticks[0].status,
        scope = beatScope(
          run,
          { target: side, actor: other(side) },
          {
            creatureId: ticks[0].creatureId,
            palette: STATUS_DEFINITIONS[status]?.color ?? '#ffffff',
            readout: () => {
              for (const tick of ticks) {
                const fromHp = creatureIn(viewOf(run.session), side, tick.creatureId)?.hp ?? 0;
                presentAll(run, [tick]);
                drain(run, side, fromHp, tick.hp);
                text(run)?.number(run, side, { kind: 'tick', text: `−${tick.amount}` });
                emitCue(run, 'readout', {
                  side,
                  creatureId: tick.creatureId,
                  kind: 'tick',
                  amount: tick.amount,
                });
              }
              markReadout(run);
            },
            cue: (name) => emitCue(run, name, { side, creatureId: ticks[0].creatureId }),
          }
        );
      end = Math.max(
        end,
        // A lethal tick is cut, not compressed: its number lands at 80 and the K.O. beat takes over.
        scheduleTimeline(queue, run, BEAT_TIMELINES.tick, scope, {
          scale: beat.lethal && !run.reduced ? 1 : fitScale(run, timelineEnd(BEAT_TIMELINES.tick)),
        })
      );
    }
    queue.add(end, () => {
      presentSurges(run);
      presentReadouts(run);
      presentChips(run);
    });
  } else
    queue.add(0, () => {
      presentSurges(run);
      presentReadouts(run);
      presentChips(run);
    });
  return runSchedule(run, queue.items);
}

// ---------------------------------------------------------------------------------------------
// Narration and battle log (§6.3)

const plainName = (side, creatureId) => creatureName(creatureId);

// Per-event battle-log text. `name(side, creatureId)` names each creature: plain in the narration
// box, with its side in the journal.
function eventLine(event, name = plainName) {
  const actor = event.creatureId ? name(event.side, event.creatureId) : '';
  switch (event.type) {
    case 'move-start':
      return t('battle.action.move', { actor, move: t(`move.${event.moveId}`) });
    case 'trainer-command':
      return t('battle.commandLine', { command: t(`command.${event.command}`) });
    case 'perfect-relay':
      return t('battle.perfectRelay', { actor });
    case 'damage':
      return event.amount === 0 && event.absorbed > 0
        ? t('battle.action.blocked', { target: actor })
        : t('battle.action.damage', { target: actor, amount: event.amount });
    case 'heal':
      return t('battle.action.heal', { actor, amount: event.amount });
    case 'status': {
      const status = t(`status.${event.status}`);
      // A used-up bonus kicks in; a used-up malus (Marqué spent by a combo) fades.
      if (event.consumed)
        return t(
          STATUS_DEFINITIONS[event.status]?.positive
            ? 'battle.action.consumed'
            : 'battle.action.consumedMalus',
          { actor, status }
        );
      return event.applied
        ? t('battle.action.status', { actor, status })
        : t('battle.action.cleanse', { actor, status });
    }
    case 'barrier':
      return t('battle.action.barrier', { actor, amount: event.amount });
    case 'barrier-hit':
      return t('battle.action.absorbed', { actor, amount: event.amount });
    case 'barrier-break':
      return t('battle.action.barrierBreak', { actor, amount: event.amount });
    case 'miss':
      return t('battle.action.miss', { actor });
    case 'recoil':
      return t('battle.action.recoil', { actor, amount: event.amount });
    case 'status-tick':
      return t('battle.action.tick', { actor, amount: event.amount, status: t(`status.${event.status}`) });
    case 'ace':
      return t('battle.ace', { actor, ace: t(`ace.${event.ace}`) });
    case 'passive':
      return t('battle.passive', { actor, passive: t(`passive.${event.passive}`) });
    case 'switch':
    case 'replace':
      return event.source === 'signature'
        ? t('battle.immaculateRelay', { actor })
        : t('battle.action.switch', { actor });
    case 'ko':
      return t('battle.ko', { name: actor });
    case 'battle-end':
      return endLine(event);
    default:
      return '';
  }
}

// A landed hit's qualifiers in the words its stage readout used (stamp, tags): the journal's
// sub-line under "X perd N PV.".
function damageNotes(event) {
  if (event.amount === 0 && event.absorbed > 0) return [];
  const notes = [];
  if (event.critical) notes.push(t('battle.critical'));
  if (event.affinity > 1) notes.push(t('battle.hitEffective'));
  else if (event.affinity < 1) notes.push(t('battle.hitWeak'));
  if (event.combo) notes.push(t('battle.comboTag', { multiplier: decimal(event.combo.multiplier) }));
  if (event.hits > 1) notes.push(t('battle.hit', { hit: event.hit, hits: event.hits }));
  return notes;
}

const capitalized = (text) =>
  text.replace(/^((?:<[^>]*>)*)(\p{Ll})/u, (_, tags, letter) => `${tags}${letter.toUpperCase()}`);

// One journal entry per semantic event (§6.3). Each creature is named with its side, in bold,
// inside the sentence ("Ton Orakyn utilise…", "L’effet Marqué sur Nymbloom rival s’efface."), so
// no row repeats a name; a hit's qualifiers go on a sub-line (`notes`) under its sentence.
function journalEntry(event, turn) {
  const names = new Set(),
    line = eventLine(event, (side, creatureId) => {
      const label = t(`battle.logSide.${side}`, { name: creatureName(creatureId) });
      names.add(escapeHtml(label));
      return label;
    }),
    bold = names.size
      ? new RegExp([...names].map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
      : null,
    html = bold
      ? escapeHtml(line).replace(bold, (label) => `<b class="log-side-label">${label}</b>`)
      : escapeHtml(line);
  return {
    type: event.type === 'damage' && event.combo ? 'combo' : event.type,
    side: event.side,
    creatureId: event.creatureId ?? null,
    turn,
    text: capitalized(line),
    html: capitalized(html),
    notes: event.type === 'damage' ? damageNotes(event) : [],
  };
}

function endLine(event) {
  return event.reason === 'turn-cap'
    ? t('battle.logEnd.cap')
    : event.winner === 'player'
      ? t('battle.logEnd.win')
      : t('battle.logEnd.loss');
}

// One line per beat that carries news. Its emphasis (the stage stamp) joins it at contact; a KoBeat's
// line already reads "X est K.O. !", so its stamp stays on the stage only.
function beatLine(beat) {
  switch (beat.kind) {
    case 'action':
    case 'switch':
    case 'cutin':
      return eventLine(beat.start);
    case 'ko':
      return beat.kos.map(({ creatureId }) => t('battle.ko', { name: creatureName(creatureId) })).join(' ');
    case 'chip':
      return beat.chip === 'tick' ? beat.ticks.map((tick) => eventLine(tick)).join(' ') : null;
    case 'end':
      return endLine(beat);
    default:
      return null;
  }
}

// The beat's journal entries land at its start (§6.3).
function journalBeat(run) {
  const session = run.session;
  for (const event of run.beat.events ?? []) {
    if (!LOG_EVENT_TYPES.has(event.type) || event.type === 'move-skip') continue;
    session.timeline.push(journalEntry(event, event.turn || session.state.turn));
    if (session.timeline.length > TIMELINE_CAP) session.timeline.shift();
  }
}

// The beat's line lands with its stage event (§6.3): a switch's with the swap (the recall is over
// and the plate names the newcomer), a K.O.'s with its stamp (the HP bar is empty), any other
// beat's at its start. It holds the box for the rest of its beat, but never longer than a
// readout's floor once the next beat's line arrives (hurry), so the text follows the stage
// instead of falling behind it.
function narrateBeat(run) {
  if (run.narrated) return;
  run.narrated = true;
  const line = beatLine(run.beat);
  if (!line) return;
  const wallMs = Math.max(0, run.start + run.end + run.stops - run.clock.now());
  run.line = route.narrate(line, {
    minMs: Math.min(run.clock.realMs(wallMs), run.clock.realFloorMs(READOUT_FLOOR_MS)),
  });
  run.lineText = line;
  run.session.lastLine = line;
}

// ---------------------------------------------------------------------------------------------
// Beat loop (§6.2)

function timelineEnd(timeline) {
  return timeline.cues.find((cue) => cue.op === 'end')?.at ?? 0;
}

// Virtual length of a non-action beat: its timeline (plus the chip add-on) within its budget
// (fitScale time-scales a longer timeline to fit). A lethal tick ends LETHAL_CONTACT_MARGIN after
// its number, as a lethal action after its last contact (§3.4).
function beatEnd(run) {
  const beat = run.beat,
    addOn = addOnMs(beat);
  if (run.reduced) return run.budget;
  const tick = BEAT_TIMELINES.tick,
    authored =
      beat.kind === 'ko'
        ? (beat.kos.length - 1) * BEAT_BUDGET_MS.extraKo + timelineEnd(BEAT_TIMELINES.ko)
        : beat.kind === 'switch'
          ? timelineEnd(BEAT_TIMELINES[beat.replacement ? 'replacement' : 'switch']) + addOn
          : beat.kind === 'cutin'
            ? timelineEnd(BEAT_TIMELINES[beat.cutIn]) + addOn
            : beat.kind === 'chip' && beat.chip === 'tick'
              ? beat.lethal
                ? tick.cues.find((cue) => cue.op === 'readout').at + LETHAL_CONTACT_MARGIN
                : timelineEnd(tick) + addOn
              : run.budget;
  return Math.min(run.budget, authored);
}

async function playBeat(session, beat, beats) {
  const budget = beatBudgetMs(beat, { reducedMotion: Boolean(ctx.save.reducedMotion) }),
    run = createRun(session, beat, beats, budget),
    plan = beat.kind === 'action' ? actionPlan(run) : null,
    end = plan ? plan.end : beatEnd(run),
    stops = plan ? plan.hitStops.reduce((sum, ms) => sum + ms, 0) : 0,
    clock = session.clock,
    // A lethal action or tick hands its readouts to the K.O. beat that follows (§3.4).
    handOff =
      (beat.kind === 'action' || beat.kind === 'chip') &&
      beat.lethal &&
      beats[beats.indexOf(beat) + 1]?.kind === 'ko';
  run.end = end;
  run.stops = stops;
  ctx.currentFxMove = beat;
  if (session.pendingCut && beat.kind !== 'ko') {
    session.pendingCut = false;
    if (!run.instant) void run.arena?.shot('cut');
  }
  journalBeat(run);
  if (beat.kind !== 'switch' && beat.kind !== 'ko') narrateBeat(run);
  const ok =
    beat.kind === 'action'
      ? await playAction(run, plan)
      : beat.kind === 'ko'
        ? await playKo(run)
        : beat.kind === 'switch'
          ? await playSwitch(run)
          : beat.kind === 'cutin'
            ? await playCutIn(run)
            : beat.kind === 'chip'
              ? await playChip(run)
              : true;
  if (!ok || !sessionAlive(session)) return false;
  // Every event of the beat is presented exactly once by its end.
  presentAll(run, beat.events ?? []);
  patch(run, ...SIDES);
  syncStatusLoops(run);
  // Readouts bow out in their own beat's tail: their exit starts EXIT[0] before the deadline (and
  // no earlier than their READOUT_FLOOR_MS floor, the exit included), so at ×1 it ends as the
  // next beat's line arrives. The beat still ends once the last readout has had its floor (×2
  // compresses the beats, never the readouts; holding compresses both); the exit never lengthens
  // it. A hand-off skips both: the K.O. beat retires the readouts once their floor is over.
  const floorLeft = () => Math.max(0, session.lastReadoutAt + READOUT_FLOOR_MS - clock.floorNow()),
    floored = !run.instant && !handOff;
  let done = true;
  if (floored) {
    done = await clock.waitUntil(run.start + end - EXIT[0], {
      floorMs: Math.max(0, floorLeft() - exitFloorMs(run)),
    });
    if (done) currentLayer?.retire(run);
  }
  done = done && (await clock.waitUntil(run.start + end, { floorMs: floored ? floorLeft() : 0 }));
  // The next beat starts on this deadline, not on the frame that noticed it: no frame lag
  // accumulates across a turn.
  session.beatCursor = run.start + end;
  ctx.currentFxMove = null;
  return done && sessionAlive(session);
}

// Hold anywhere on the stage (or Space) = ×3 while the turn plays (§6.5). Pointers pressed on the
// stage and a held Space are tracked for the whole page, so a finger that is already down when a
// turn starts (pressed while the dock locks, or held across the enemy's replacement) hurries it
// from its first beat; only a running playEvents turns the hold into hurry.
const hold = { pointers: new Set(), space: false, apply: null };

function holding() {
  return hold.pointers.size > 0 || hold.space;
}

function updateHold(change) {
  change();
  hold.apply?.(holding());
}

document.addEventListener(
  'pointerdown',
  (event) => {
    if (event.target instanceof Element && event.target.closest('.battle-screen .battle-stage'))
      updateHold(() => hold.pointers.add(event.pointerId));
  },
  true
);
for (const type of ['pointerup', 'pointercancel'])
  document.addEventListener(type, (event) => updateHold(() => hold.pointers.delete(event.pointerId)), true);
for (const type of ['keydown', 'keyup'])
  document.addEventListener(type, (event) => {
    if (event.code !== 'Space') return;
    // During playback Space only hurries (the dock is hidden; no scroll, no stray activation).
    if (hold.apply) event.preventDefault();
    if (type === 'keyup' || !event.repeat) updateHold(() => (hold.space = type === 'keydown'));
  });
window.addEventListener('blur', () =>
  updateHold(() => {
    hold.pointers.clear();
    hold.space = false;
  })
);

function bindHurry(session) {
  const clock = session.clock;
  hold.apply = (on) => clock.setHurry(on);
  clock.setHurry(holding());
  return () => {
    hold.apply = null;
    clock.setHurry(false);
  };
}

// Plays one engine result. Resolves true when every beat played, false if the session died.
export async function playBeats(session, events) {
  ensurePresentation(session);
  session.clock.setSpeed(ctx.save.battleSpeed);
  // No cursor reset: the enemy's replacement right after a turn continues on the turn's last
  // deadline, and beatStart drops a cursor older than one late frame (a new turn starts now).
  if (!session.clock.instant) readoutLayer()?.measureKeepOut();
  const beats = groupBeats(events),
    unbind = bindHurry(session);
  try {
    for (const beat of beats) if (!(await playBeat(session, beat, beats))) return false;
    return true;
  } finally {
    unbind();
    ctx.currentFxMove = null;
    // A turn cut short leaves readouts showing: they bow out as the dock returns.
    if (sessionAlive(session))
      currentLayer?.retire({ clock: session.clock, reduced: Boolean(ctx.save.reducedMotion) });
    else session.cues.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Intro (§6.6) and outro (§6.7)

function rivalIntro(session) {
  const trainer = ['ladder', 'circuit', 'gauntlet'].includes(session.mode)
      ? TRAINERS[session.trainerIndex]
      : null,
    trial = session.mode === 'trial' ? TRIALS.find((candidate) => candidate.id === session.trialId) : null;
  return {
    rival: trainer ? t(trainer.nameKey) : trial ? t(trial.nameKey) : t('battle.freeRival'),
    quote: trainer ? t(`style.taunt.${trainer.style}`) : trial ? t(trial.descKey) : t('battle.freeTaunt'),
  };
}

// Holding the stage hurries the intro and the outro as well as the turns (§6.5).
async function hurried(session, play) {
  const unbind = bindHurry(session);
  try {
    return await play();
  } finally {
    unbind();
  }
}

export async function playIntro(session) {
  if (!sessionAlive(session)) return false;
  ensurePresentation(session);
  if (session.clock.instant) return true;
  return hurried(session, () => introTimeline(session));
}

async function introTimeline(session) {
  const clock = session.clock,
    state = session.state,
    leads = { player: activeOf(state, 'player').id, enemy: activeOf(state, 'enemy').id },
    // Team ids, lead first, for the portrait VS stack.
    teams = Object.fromEntries(
      SIDES.map((side) => [
        side,
        [leads[side], ...state.sides[side].team.map((c) => c.id).filter((id) => id !== leads[side])],
      ])
    ),
    weather = Object.keys(state.weather ?? {}).length > 0,
    reduced = Boolean(ctx.save.reducedMotion),
    timeline = BEAT_TIMELINES.intro,
    weatherAt = reduced
      ? 300
      : (timeline.cues.find((cue) => cue.op === 'banner' && cue.kind === 'weather')?.at ?? 0),
    end = reduced
      ? weatherAt + (weather ? BEAT_BUDGET_MS.reducedReadout : 0)
      : weather
        ? (timeline.cues.find((cue) => cue.op === 'end')?.at ?? weatherAt)
        : weatherAt,
    beat = { kind: 'intro', events: [] },
    run = createRun(session, beat, [beat], end),
    queue = scheduler(),
    scope = beatScope(
      run,
      { actor: 'player', target: 'enemy' },
      {
        both: SIDES,
        palette: '#ffffff',
        banner: (kind) => {
          if (kind === 'weather') {
            if (weather) banner(run, 'weather', { arena: state.arena, weather: state.weather });
          } else banner(run, kind, { ...teams, arena: state.arena, ...rivalIntro(session) });
        },
        // Both leads call in, the rival a beat after the player so the cries never overlap.
        cue: (name) => {
          if (name !== 'switch-in') return emitCue(run, name, {});
          emitCue(run, name, { side: 'player', creatureId: leads.player, source: 'intro' });
          clock.at(INTRO_SECOND_LEAD_MS, () =>
            emitCue(run, name, { side: 'enemy', creatureId: leads.enemy, source: 'intro' })
          );
        },
      }
    );
  for (const cue of timeline.cues) {
    if (cue.op === 'end') continue;
    const at = cue.op === 'banner' && cue.kind === 'weather' ? weatherAt : reduced ? 0 : cue.at;
    queue.add(at, () => execOp(run, cue, scope));
  }
  if (!(await runSchedule(run, queue.items))) return false;
  syncStatusLoops(run);
  return clock.waitUntil(run.start + end);
}

export async function playOutro(state) {
  const session = ctx.battleSession;
  if (!sessionAlive(session)) return;
  ensurePresentation(session);
  if (session.clock.instant) return;
  await hurried(session, () => outroTimeline(session, state));
  if (!sessionAlive(session)) session.cues.dispose();
}

async function outroTimeline(session, state) {
  const clock = session.clock;
  // The winner's hero moment takes the whole screen (§6.7, §11.2).
  route.restage('full', () => screen.classList.add('battle-outro'));
  const winner = state.winner === 'enemy' ? 'enemy' : 'player',
    kind = winner === 'player' ? 'victory' : 'defeat',
    champion = activeOf(state, winner),
    beat = { kind: 'outro', events: [] },
    timeline = BEAT_TIMELINES[kind],
    end = timeline.cues.find((cue) => cue.op === 'end')?.at ?? 0,
    run = createRun(session, beat, [beat], end),
    queue = scheduler(),
    scope = beatScope(
      run,
      { actor: winner, target: other(winner) },
      {
        creatureId: champion.id,
        palette: typeColor(champion.id),
        banner: (bannerKind) =>
          banner(run, bannerKind, { winner, reason: state.reason, creatureId: champion.id }),
        cue: (name) => emitCue(run, name, { winner, reason: state.reason }),
      }
    );
  clearStatusMarkers(run);
  scheduleTimeline(queue, run, timeline, scope);
  const reduced = run.reduced;
  if (!(await runSchedule(run, queue.items)) || !(await clock.waitUntil(run.start + end))) return;
  // A quick clean fade (battle-fx.css: 180 ms, 150 ms reduced; floor time, so a hold shortens
  // it with the rest) hands over to the results: the results screen replaces the layout only
  // once it is fully faded, at any speed.
  const exitMs = reduced ? 150 : 180,
    layout = screen.querySelector('.battle-layout');
  if (layout) layout.style.transitionDuration = `${clock.realFloorMs(exitMs)}ms`;
  screen.classList.add('battle-exit');
  ctx.arenaScene?.setPaused(true);
  await clock.wait(0, { floorMs: exitMs });
}

// The hero shot shows the winner clean: its status loops (the Marqué reticle, orbiting motes) and
// status tint clear as the outro starts, fading while the camera turns, or at once with the
// reduced-motion cut.
function clearStatusMarkers(run) {
  const session = run.session;
  for (const handle of session.statusLoops.values()) handle?.stop(run.reduced ? { fadeMs: 0 } : undefined);
  session.statusLoops.clear();
  if (!run.fighters) return;
  for (const side of SIDES) {
    if (!session.tints[side]) continue;
    session.tints[side] = null;
    run.fighters.react(side, 'tint', { status: null });
  }
}
