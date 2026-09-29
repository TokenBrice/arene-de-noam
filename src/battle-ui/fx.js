import { ctx, registerRoutes, route } from '../app/context.js';

const {
  AFFINITIES,
  CREATURES,
  MOVES,
  activeOf,
  STATUS_DEFINITIONS,
  statusIcon,
  testAnimationScale,
  t,
  screen,
  sound,
  sprite,
  creatureName,
  affinityIcon,
  wait,
} = ctx;

function sessionIsActive(session) {
  return Boolean(
    session &&
    ctx.battleSession === session &&
    !session.cancelled &&
    screen.classList.contains('battle-screen')
  );
}

// Stage anchors (percent of the stage box) for each side. Flight vectors,
// readouts and tactical beats all resolve from these.
const ANCHOR = { player: { x: 23, y: 68 }, enemy: { x: 77, y: 30 } };

const beginFxTemplateCache = new Map(),
  radialFxTemplateCache = new Map();
let coarseRetinaParticleScale = null;

function particleBudget(count) {
  if (coarseRetinaParticleScale === null) {
    coarseRetinaParticleScale =
      typeof window !== 'undefined' &&
      window.devicePixelRatio >= 2 &&
      window.matchMedia?.('(pointer: coarse)').matches
        ? 0.5
        : 1;
  }
  return Math.max(1, Math.ceil(count * coarseRetinaParticleScale));
}

function radialParticles(count, cacheKey, distanceModulo, delayModulo, delayUnit = 24) {
  const key = `${cacheKey}:${count}:${distanceModulo}:${delayModulo}:${delayUnit}`,
    cached = radialFxTemplateCache.get(key);
  if (cached) return cached;
  const particles = Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2,
      distance = 45 + (i % distanceModulo) * 12;
    return `<i class="fx-particle" style="--dx:${Math.cos(angle) * distance}px;--dy:${Math.sin(angle) * distance}px;--delay:${(i % delayModulo) * delayUnit}ms"></i>`;
  }).join('');
  radialFxTemplateCache.set(key, particles);
  return particles;
}

function beginFxTemplate(archetype, particleCount, detailCount, echoCount) {
  const key = `${archetype}:${particleCount}:${detailCount}:${echoCount}`,
    cached = beginFxTemplateCache.get(key);
  if (cached) return cached;
  const particles = Array.from({ length: particleCount }, (_, i) => {
      const angle = (i / particleCount) * Math.PI * 2,
        distance = 55 + ((i * 37) % 145);
      return `<i class="fx-particle" style="--particle:${i};--dx:${Math.cos(angle) * distance}px;--dy:${Math.sin(angle) * distance}px;--delay:${(i % 9) * 16}ms;--spin:${i % 2 ? 1 : -1}"></i>`;
    }).join(''),
    echoes = Array.from(
      { length: echoCount },
      (_, i) => `<i class="fx-ring" style="--ring:${i};--delay:${i * 58}ms"></i>`
    ).join(''),
    detail = Array.from({ length: detailCount }, (_, i) => `<i style="--detail:${i}"></i>`).join(''),
    archExtras =
      archetype === 'slash'
        ? `<div class="fx-arch fx-slashes">${Array.from({ length: 3 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>`
        : archetype === 'eruption'
          ? `<div class="fx-arch fx-pillars">${Array.from({ length: 5 }, (_, i) => `<i style="--i:${i};--ox:${(i - 2) * 34 + (i % 2 ? 9 : -7)}px"></i>`).join('')}</div>`
          : archetype === 'storm'
            ? `<div class="fx-arch fx-drops">${Array.from({ length: 9 }, (_, i) => `<i style="--i:${i};--ox:${((i * 53) % 130) - 65}px"></i>`).join('')}</div>`
            : '';
  const template = { particles, echoes, detail, archExtras };
  beginFxTemplateCache.set(key, template);
  return template;
}

function tacticalFxTemplate(particleCount) {
  const key = `tactical:${particleCount}`,
    cached = radialFxTemplateCache.get(key);
  if (cached) return cached;
  const template = {
    rings: Array.from(
      { length: 4 },
      (_, i) => `<i class="fx-ring" style="--ring:${i};--delay:${i * 85}ms"></i>`
    ).join(''),
    detail: Array.from({ length: 6 }, (_, i) => `<i style="--detail:${i}"></i>`).join(''),
    particles: radialParticles(particleCount, 'tactical', 5, 6, 30),
  };
  radialFxTemplateCache.set(key, template);
  return template;
}

/* Battle speed. Each CSS animation or transition gets the ×2 rate once, when
   it is created, and animations already at speed are never touched again:
   - FX nodes built here are rated as soon as they exist (delayed rings and
     particles then also run their delay at speed);
   - elements whose own animations restart when FX classes change (fighters,
     HUD plates, stage camera, canvas, action line) are rated, element-scoped,
     right after the change;
   - anything else is rated by its animationstart/transitionrun event.
   The whole screen is only scanned when the speed or the battle screen
   changes, never per event. At ×1 nothing is scanned. */
let appliedSpeed = 1,
  appliedStage = null;
const pendingRateRoots = new Map();

function rateAnimations(animations, speed) {
  for (const animation of animations) {
    if (animation.playbackRate === speed) continue;
    animation.updatePlaybackRate(speed);
    animation.playbackRate = speed;
  }
}

function flushRateRoots() {
  const speed = ctx.save.battleSpeed,
    battle = screen.classList.contains('battle-screen');
  for (const [root, subtree] of pendingRateRoots)
    if (battle && root.isConnected) rateAnimations(root.getAnimations({ subtree }), speed);
  pendingRateRoots.clear();
}

function rateNewAnimations(root, subtree = true) {
  if (ctx.save.battleSpeed === 1 || !root) return;
  if (!pendingRateRoots.size) queueMicrotask(flushRateRoots);
  pendingRateRoots.set(root, subtree || pendingRateRoots.get(root) || false);
}

function rateBattleTargets() {
  if (ctx.save.battleSpeed === 1) return;
  for (const id of ['#fighter-player', '#fighter-enemy', '#hud-player', '#hud-enemy'])
    rateNewAnimations(screen.querySelector(id));
  for (const selector of ['#arena', '.battle-stage-camera', '#action-line'])
    rateNewAnimations(screen.querySelector(selector), false);
}

function rateStartedAnimation(event) {
  const speed = ctx.save.battleSpeed;
  if (speed === 1 || !screen.classList.contains('battle-screen')) return;
  const target = event.target;
  rateAnimations(target.getAnimations({ subtree: Boolean(event.pseudoElement) }), speed);
}
screen.addEventListener('animationstart', rateStartedAnimation, true);
screen.addEventListener('transitionrun', rateStartedAnimation, true);

// Called after each HUD refresh and after each playback beat.
function syncBattleAnimationSpeed() {
  const speed = ctx.save.battleSpeed,
    stage = screen.querySelector('#fx-stage');
  if (speed === appliedSpeed && (stage === appliedStage || speed === 1)) {
    rateBattleTargets();
    return;
  }
  appliedSpeed = speed;
  appliedStage = stage;
  queueMicrotask(() => {
    if (screen.classList.contains('battle-screen'))
      rateAnimations(screen.getAnimations({ subtree: true }), ctx.save.battleSpeed);
  });
}

const theaterFxTimers = new Set();

function fxTimerRegistry() {
  return ctx.battleSession?.fxTimers || theaterFxTimers;
}

function scheduleFxTimer(callback, delay) {
  const timers = fxTimerRegistry();
  let timer;
  timer = setTimeout(() => {
    timers.delete(timer);
    callback();
  }, delay);
  timers.add(timer);
  return timer;
}

function clearFxTimers() {
  const timers = ctx.battleSession?.fxTimers || theaterFxTimers;
  timers.forEach(clearTimeout);
  timers.clear();
}

/* Stage geometry. The stage size is read once per stage element and then kept
   current by a ResizeObserver, so building a move never forces a layout. */
let observedStage = null,
  observedSize = { width: 0, height: 0 },
  stageObserver = null;

function stageSize(stage) {
  if (stage !== observedStage) {
    stageObserver ??=
      typeof ResizeObserver === 'function'
        ? new ResizeObserver((entries) => {
            const box = entries.at(-1).contentRect;
            observedSize = { width: box.width, height: box.height };
          })
        : null;
    stageObserver?.disconnect();
    observedStage = stage;
    observedSize = { width: stage.clientWidth, height: stage.clientHeight };
    stageObserver?.observe(stage);
  }
  return observedSize;
}

function setOrigin(layer, side) {
  layer.style.setProperty('--from-x', `${ANCHOR[side].x}%`);
  layer.style.setProperty('--from-y', `${ANCHOR[side].y}%`);
}

// One compositor-only vector per move: projectiles and flights translate by
// --fx-dx/--fx-dy, the trail is rotated and sized from the same vector, and a
// miss overshoots past the dodger along --fx-whiff-dx/--fx-whiff-dy.
function setFlightVector(stage, source, target) {
  const { width, height } = stageSize(stage),
    from = ANCHOR[source],
    to = ANCHOR[target],
    dx = ((to.x - from.x) / 100) * width,
    dy = ((to.y - from.y) / 100) * height,
    sign = source === 'player' ? 1 : -1;
  stage.style.setProperty('--to-x', `${to.x}%`);
  stage.style.setProperty('--to-y', `${to.y}%`);
  stage.style.setProperty('--fx-dx', `${dx.toFixed(1)}px`);
  stage.style.setProperty('--fx-dy', `${dy.toFixed(1)}px`);
  stage.style.setProperty('--fx-whiff-dx', `${(dx + sign * 0.14 * width).toFixed(1)}px`);
  stage.style.setProperty('--fx-whiff-dy', `${(dy - sign * 0.1 * height).toFixed(1)}px`);
  stage.style.setProperty('--trail-angle', `${Math.atan2(dy, dx).toFixed(4)}rad`);
  stage.style.setProperty('--trail-len', `${Math.hypot(dx, dy).toFixed(1)}px`);
}

// The move-start beat is also the flight time, so projectiles land exactly on
// the impact instead of parking on the target or vanishing mid-arc.
function moveStartBeatMs(move) {
  return move?.signature ? 780 : (move?.power || 0) >= 46 ? 420 : 300;
}

function isBlockedHit(event) {
  return event.amount === 0 && event.absorbed > 0;
}

/* Extra FX layers next to #fx-stage. Tactical beats (statuses, heals,
   barriers, passives, ticks) draw on their own layer so they never clobber a
   move in flight. Readouts (numbers, stamps, callouts) live outside the stage
   camera, are never rebuilt, and each one removes itself when its own
   animation ends. */
const fxLayers = new WeakMap();
const readoutStack = { player: 0, enemy: 0 };
let moveFxNodes = null;

function layersOf(stage) {
  let layers = fxLayers.get(stage);
  if (layers?.tactical.isConnected && layers.readouts.isConnected) return layers;
  layers?.tactical.remove();
  layers?.readouts.remove();
  const tactical = document.createElement('div'),
    readouts = document.createElement('div'),
    camera = stage.closest('.battle-stage-camera');
  tactical.className = 'fx-stage fx-tactical';
  tactical.setAttribute('aria-hidden', 'true');
  readouts.className = 'fx-readouts';
  readouts.setAttribute('aria-hidden', 'true');
  stage.after(tactical);
  (camera || tactical).after(readouts);
  layers = { tactical, readouts };
  fxLayers.set(stage, layers);
  return layers;
}

function removeReadout(event) {
  if (event.target === event.currentTarget && !event.pseudoElement) event.currentTarget.remove();
}

function readout(stage, side, className, text, { pill = false } = {}) {
  const node = document.createElement('b');
  node.className = `fx-readout ${className} side-${side}`;
  if (pill) {
    const label = document.createElement('span');
    label.textContent = text;
    node.append(label);
  } else node.textContent = text;
  node.addEventListener('animationend', removeReadout);
  layersOf(stage).readouts.append(node);
  rateNewAnimations(node);
  return node;
}

function numberReadout(stage, side, text, kind, { strong = false, combo = false } = {}) {
  const node = readout(stage, side, `fx-number ${kind}${strong ? ' strong' : ''}`, text);
  node.style.setProperty('--stack', String(readoutStack[side]++ % 3));
  if (combo) node.insertAdjacentHTML('afterbegin', '<small>COMBO</small>');
  return node;
}

function replaceSideReadout(stage, side, selector) {
  layersOf(stage)
    .readouts.querySelectorAll(`:is(${selector}).side-${side}`)
    .forEach((node) => node.remove());
}

/* Readouts must not outlive the playback that made them. `settleReadouts`
   gets the time left (×1 ms) before controls return; any readout whose own
   animation would run past that fades out early instead, over a short tail
   that ends when the turn does. The fade never starts before the readout has
   been fully visible for READOUT_HOLD_MS (pop-in plus ≥ 450 ms), so a late
   last hit may keep its number a moment longer rather than stretch the turn.
   Opacity only, on top of the CSS pop (the transform keeps running). */
const READOUT_HOLD_MS = 600,
  READOUT_TAIL_MS = 120,
  // The longest readout animation (stampKo, 1.05 s): with more turn left than
  // this, nothing on screen can outlive the playback.
  READOUT_LONGEST_MS = 1050,
  retiringReadouts = new WeakSet();

function settleReadouts(turnLeftMs = 0) {
  if (testAnimationScale === 0 || turnLeftMs >= READOUT_LONGEST_MS) return;
  const stage = screen.querySelector('#fx-stage'),
    layers = stage && fxLayers.get(stage);
  if (!layers?.readouts.firstChild) return;
  for (const node of layers.readouts.children) {
    if (retiringReadouts.has(node)) continue;
    const pop = node.getAnimations().find((animation) => animation instanceof CSSAnimation);
    if (!pop) continue;
    const elapsed = pop.currentTime ?? 0,
      naturalLeft = pop.effect.getComputedTiming().endTime - elapsed;
    if (naturalLeft <= turnLeftMs) continue;
    const delay = Math.max(0, READOUT_HOLD_MS - elapsed, turnLeftMs - READOUT_TAIL_MS);
    if (delay + READOUT_TAIL_MS >= naturalLeft) continue;
    retiringReadouts.add(node);
    const fade = node.animate(
      { opacity: 0 },
      { duration: READOUT_TAIL_MS, delay, easing: 'ease-in', fill: 'forwards' }
    );
    fade.updatePlaybackRate(ctx.save.battleSpeed);
    fade.finished.then(
      () => node.remove(),
      () => {}
    );
  }
}

function beginMoveFx(event) {
  const move = MOVES[event.moveId],
    a = AFFINITIES[move.affinity],
    source = event.side,
    target = source === 'player' ? 'enemy' : 'player';
  ctx.currentFxMove = {
    moveId: event.moveId,
    creatureId: event.creatureId,
    affinity: move.affinity,
    source,
    target,
    strong: Boolean(move.signature) || move.power >= 46,
    kind: move.kind,
  };
  if (testAnimationScale === 0) return;
  const stage = screen.querySelector('#fx-stage');
  if (!stage) return;
  const strong = ctx.currentFxMove.strong,
    cameraGrammar = move.signature
      ? 'ultimate'
      : move.kind !== 'damage'
        ? 'wide'
        : (move.hits || 1) > 1 || move.priority > 0
          ? 'rush'
          : move.power >= 42
            ? 'heavy'
            : 'strike';
  // Stakes scaling (plan §4.2): a cornered attacker (low HP or last creature
  // standing) gets a bigger show — more particles, a hot edge pulse, and the
  // camera grammar bumps one tier.
  const stakesSession = ctx.battleSession,
    attackerState = sessionIsActive(stakesSession) ? activeOf(stakesSession.state, source) : null,
    cornered =
      attackerState &&
      attackerState.hp > 0 &&
      (attackerState.hp / attackerState.maxHp <= 0.25 ||
        stakesSession.state.sides[source].team.filter((c) => c.hp > 0).length === 1);
  const cameraBumped = cornered
    ? { strike: 'heavy', rush: 'heavy', heavy: 'ultimate' }[cameraGrammar] || cameraGrammar
    : cameraGrammar;
  setFlightVector(stage, source, target);
  stage.className = `fx-stage active move-fx fx-${move.affinity} move-${move.id} visual-${move.archetype || move.visual} owner-${move.owner} from-${source} ${strong ? 'signature' : ''} ${move.power === 0 ? 'self-fx' : ''}`;
  stage.style.setProperty('--fx-color', a.color);
  setOrigin(stage, source);
  const particleCount = particleBudget(strong ? (cornered ? 52 : 42) : cornered ? 34 : 24),
    detailCount = strong ? 12 : 8,
    archetype = move.archetype || move.visual || 'default',
    template = beginFxTemplate(archetype, particleCount, detailCount, strong ? 6 : 3);
  // Archetype-specific extra bodies: slashes/eruption pillars/storm drops sync
  // to the .impact class; the charge ghost is the only per-event template part.
  stage.innerHTML = `${cornered ? '<div class="fx-stakes"></div>' : ''}<div class="fx-curtain"></div><div class="fx-sky-symbol"><b>${affinityIcon(move.affinity)}</b><span></span></div><div class="fx-source-aura">${template.echoes}</div><div class="fx-trail"></div><div class="fx-detail">${template.detail}</div><div class="fx-projectile"><b>${affinityIcon(move.affinity)}</b><span></span></div><div class="fx-impact">${template.particles}<i class="fx-core">${affinityIcon(move.affinity)}</i>${template.echoes}</div><div class="fx-aftershock"></div>${template.archExtras}`;
  const flight = `${moveStartBeatMs(move)}ms`;
  stage.querySelector('.fx-projectile').style.animationDuration = flight;
  stage.querySelector('.fx-trail').style.animationDuration = flight;
  if (archetype === 'charge') {
    const ghost = document.createElement('img');
    ghost.className = 'fx-dash-ghost';
    ghost.src = sprite(event.creatureId);
    ghost.alt = '';
    stage.append(ghost);
  }
  moveFxNodes = { stage, impact: stage.querySelector('.fx-impact') };
  screen.classList.add('cinematic', `camera-${source}`, `camera-${cameraBumped}`);
  if (strong) screen.classList.add('cinematic-signature');
  const attacker = screen.querySelector(`#fighter-${source}`);
  attacker?.style.setProperty('--attack-affinity-color', a.color);
  attacker?.classList.add('windup');
  screen.querySelector('#action-line')?.classList.toggle('epic', strong);
  rateNewAnimations(stage);
  rateBattleTargets();
}

function impactMoveFx(event) {
  if (testAnimationScale === 0) return;
  const session = ctx.battleSession,
    stage = screen.querySelector('#fx-stage'),
    fx = ctx.currentFxMove;
  if (!stage || !fx) return;
  // The move keeps its own nodes from beginMoveFx; the impact burst starts on
  // the first hit and replays on a fresh copy for every later hit.
  const nodes = moveFxNodes?.stage === stage && moveFxNodes.impact?.isConnected ? moveFxNodes : null;
  if (nodes) {
    if (stage.classList.contains('impact')) {
      const replay = nodes.impact.cloneNode(true);
      nodes.impact.replaceWith(replay);
      nodes.impact = replay;
      rateNewAnimations(replay);
    }
    stage.classList.add('impact');
    if (event.hits > 1) stage.classList.add('multi-hit-impact');
    if (event.combo) stage.classList.add('combo-impact');
  }
  screen.classList.add('camera-impact');
  if (event.combo) screen.classList.add('combo-hit');
  const side = event.side;
  // A newer hit owns this side's readouts: the previous hit's counter and
  // stamp band ("Bloqué !", callout) go, and a K.O. also clears the earlier
  // numbers so the stamp lands clean.
  replaceSideReadout(stage, side, '.hit-chain, .fx-stamp, .fx-callout');
  if (event.hp <= 0) {
    replaceSideReadout(stage, side, '.fx-number');
    readout(stage, side, 'fx-stamp ko', 'K.O.');
  } else if (isBlockedHit(event))
    readout(stage, side, 'fx-stamp blocked', t('battle.blocked'), { pill: true });
  else if (event.amount > 0)
    numberReadout(stage, side, `−${event.amount}`, 'damage', {
      strong: fx.strong,
      combo: Boolean(event.combo),
    });
  if (event.hits > 1) {
    const chain = readout(stage, side, `hit-chain${event.hit === event.hits ? ' final' : ''}`, '');
    chain.dataset.hit = String(event.hit);
    chain.innerHTML = `<b>${event.hit}</b><small>/${event.hits}</small>`;
  }
  if (event.hp <= 0) {
    if (nodes) stage.classList.add('finisher-impact');
    screen.classList.add('finisher-mode');
    if (!sessionIsActive(session)) return;
    session.lastLine = t('battle.finisher', { move: t(`move.${fx.moveId}`) });
    screen.querySelector('#action-line').textContent = session.lastLine;
  } else if (MOVES[fx.moveId]?.signature) {
    // Mini-finisher (plan §4.2): a non-lethal signature still gets a short
    // slash and a brief canvas dim, softer and shorter than a K.O.
    if (nodes) stage.classList.add('mini-finisher-impact');
    screen.classList.add('mini-finisher-mode');
  }
  const color = AFFINITIES[fx.affinity]?.color || '#ffffff';
  ctx.arenaScene?.flash(fx.strong ? 'power' : 'hit', color, event.side);
  ctx.arenaScene?.punch(event.side, fx.strong ? 1.55 : (event.hits || 1) > 1 ? 0.8 : 1);
  // Hit-stop freezes only the FX stage and the two fighters.
  const frozen = [stage, ...screen.querySelectorAll('#fighter-player, #fighter-enemy')];
  frozen.forEach((node) => node.classList.add('hit-stop'));
  rateBattleTargets();
  scheduleFxTimer(
    () => {
      frozen.forEach((node) => node.classList.remove('hit-stop'));
    },
    ctx.save.reducedMotion ? 20 : 72 / ctx.save.battleSpeed
  );
}

function effectivenessCalloutFx(event) {
  if (testAnimationScale === 0) return;
  if (!event.affinity || event.affinity === 1) return;
  const stage = screen.querySelector('#fx-stage');
  if (!stage) return;
  const effective = event.affinity > 1;
  replaceSideReadout(stage, event.side, '.affinity-callout');
  readout(
    stage,
    event.side,
    `fx-callout affinity-callout ${effective ? 'effective' : 'weak'}`,
    t(effective ? 'battle.hitEffective' : 'battle.hitWeak'),
    { pill: true }
  );
}

function tacticalFx(event) {
  if (testAnimationScale === 0) return;
  const stage = screen.querySelector('#fx-stage');
  if (!stage) return;
  const layer = layersOf(stage).tactical,
    side = event.side,
    kind = event.type === 'barrier-break' ? 'barrier' : event.type,
    meta = STATUS_DEFINITIONS[event.status],
    color = kind === 'heal' ? '#8dffb0' : kind === 'barrier' ? '#73eaff' : meta?.color || '#79e9ff';
  const moveClass = ctx.currentFxMove?.moveId ? `move-${ctx.currentFxMove.moveId}` : '',
    numeric = ['heal', 'barrier'].includes(kind) && event.amount > 0,
    statusPolarity = meta ? (meta.positive ? 'status-positive' : 'status-negative') : '',
    statusChange = meta ? (event.applied === false ? 'status-remove' : 'status-application') : '',
    coreText = kind === 'heal' ? '✦' : meta ? statusIcon(event.status) : '⬡';
  layer.className = `fx-stage fx-tactical active tactical-fx tactical-${['heal', 'barrier'].includes(kind) ? kind : event.status || 'cleanse'} ${statusPolarity} ${statusChange} ${moveClass} from-${side}`;
  layer.style.setProperty('--fx-color', color);
  setOrigin(layer, side);
  const tacticalTemplate = tacticalFxTemplate(particleBudget(18));
  layer.innerHTML = `<div class="fx-source-aura">${tacticalTemplate.rings}</div><div class="fx-detail">${tacticalTemplate.detail}</div><div class="fx-impact">${tacticalTemplate.particles}<i class="fx-core${meta?.lightInk ? ' light-ink' : ''}">${coreText}</i></div>`;
  if (numeric)
    numberReadout(
      stage,
      side,
      `${event.type === 'barrier-break' ? '−' : '+'}${event.amount}`,
      event.type === 'barrier-break' ? 'barrier loss' : kind
    );
  if (event.type === 'barrier' && event.amount > 0) barrierGainPulse(side);
  rateNewAnimations(layer);
  ctx.arenaScene?.burst(color, side, kind === 'heal' ? 1.2 : 0.8);
}

// A gained barrier pulses the floor ring once (components.css .aura-gain);
// the class clears itself when the pulse ends so the next gain pulses again.
function barrierGainPulse(side) {
  if (ctx.save.reducedMotion) return;
  const shadow = screen.querySelector(`#fighter-${side} .fighter-shadow`);
  if (!shadow || shadow.classList.contains('aura-gain')) return;
  const done = (event) => {
    if (event.target !== shadow || event.animationName !== 'auraGain') return;
    shadow.removeEventListener('animationend', done);
    shadow.removeEventListener('animationcancel', done);
    shadow.classList.remove('aura-gain');
  };
  shadow.addEventListener('animationend', done);
  shadow.addEventListener('animationcancel', done);
  shadow.classList.add('aura-gain');
  rateNewAnimations(shadow);
}

function comboCreditFx(event) {
  const creature = CREATURES[event.creatureId];
  sound.call(event.creatureId);
  sound.comboCredit(creature.affinity);
  if (testAnimationScale === 0) return;
  const stage = screen.querySelector('#fx-stage');
  if (!stage) return;
  const a = AFFINITIES[creature.affinity],
    call = document.createElement('div');
  call.className = `combo-credit-call ${event.side}`;
  call.style.setProperty('--combo-credit-color', a.color);
  call.innerHTML = `<img src="${sprite(event.creatureId)}" alt=""><span><small>COMBO</small><b>${creatureName(event.creatureId)}</b><em>${t('battle.preparedBy', { helper: creatureName(event.creatureId) })}</em></span>`;
  stage.append(call);
  screen.classList.add('combo-credit-mode');
  ctx.arenaScene?.burst(a.color, event.side, 1);
}
function perfectRelayFx(event) {
  const creature = CREATURES[event.creatureId],
    a = AFFINITIES[creature.affinity];
  sound.guard();
  sound.ui();
  if (testAnimationScale === 0) return;
  const stage = screen.querySelector('#fx-stage');
  if (!stage) return;
  stage.className = `fx-stage active perfect-relay-fx from-${event.side}`;
  stage.style.setProperty('--fx-color', a.color);
  setOrigin(stage, event.side);
  stage.innerHTML = `<div class="fx-curtain"></div><div class="relay-sweep"></div><div class="relay-cut"><img src="${sprite(event.creatureId)}" alt=""><span><small>↺ ${t('battle.switchRead')}</small><b>${creatureName(event.creatureId)}</b><em>+6 ${t('battle.surge')}</em></span></div><div class="relay-rings">${Array.from({ length: 5 }, (_, i) => `<i style="--ring:${i}"></i>`).join('')}</div>`;
  screen.classList.add('perfect-relay-mode', `relay-${event.side}`);
  rateNewAnimations(stage);
  ctx.arenaScene?.flash('hit', a.color, event.side);
  ctx.arenaScene?.burst(a.color, event.side, 1.2);
}

function relayRushFx(event) {
  const session = ctx.battleSession,
    creature = sessionIsActive(session) ? activeOf(session.state, event.side) : null;
  if (!creature) return;
  sound.comboCredit(creature.affinity);
  sound.ui();
  if (testAnimationScale === 0) return;
  const stage = screen.querySelector('#fx-stage');
  if (!stage) return;
  const a = AFFINITIES[creature.affinity];
  stage.className = `fx-stage active relay-rush-fx from-${event.side}`;
  stage.style.setProperty('--fx-color', a.color);
  setOrigin(stage, event.side);
  stage.innerHTML = `<div class="fx-curtain"></div><div class="relay-rush-lines"></div><div class="relay-rush-call ${event.side}"><i>↺</i><img src="${sprite(creature.id)}" alt=""><span><small>${t('quickRule.relay_rush')}</small><b>${creatureName(creature.id)}</b><em>+24 ${t('battle.surge')} · ${t('status.haste')}</em></span></div><div class="relay-rings">${Array.from({ length: 6 }, (_, i) => `<i style="--ring:${i}"></i>`).join('')}</div>`;
  screen.classList.add('relay-rush-mode', `relay-${event.side}`);
  rateNewAnimations(stage);
  ctx.arenaScene?.flash('power', a.color, event.side);
  ctx.arenaScene?.burst(a.color, event.side, 1.5);
  ctx.arenaScene?.punch(event.side, 1.15);
}
function immaculateRelayFx(event) {
  const creature = CREATURES[event.creatureId];
  if (!creature) return;
  const color = AFFINITIES[creature.affinity].color;
  sound.guard();
  if (testAnimationScale === 0) return;
  const stage = screen.querySelector('#fx-stage');
  if (!stage) return;
  stage.className = `fx-stage active immaculate-relay-fx from-${event.side}`;
  stage.style.setProperty('--fx-color', color);
  stage.innerHTML = `<div class="immaculate-gate"></div><div class="immaculate-feathers">${Array.from({ length: 7 }, (_, index) => `<i style="--feather:${index}"></i>`).join('')}</div><div class="immaculate-call"><img src="${sprite(event.creatureId)}" alt=""><span><small>${t('move.immaculate_relay')}</small><b>${creatureName(event.creatureId)}</b></span></div>`;
  screen.classList.add('immaculate-relay-mode', `relay-${event.side}`);
  rateNewAnimations(stage);
  ctx.arenaScene?.flash('power', color, event.side);
  ctx.arenaScene?.burst(color, event.side, 1.4);
}
function trainerCommandFx(event) {
  const creature = CREATURES[event.creatureId],
    a = AFFINITIES[creature.affinity];
  sound.clash();
  if (testAnimationScale === 0) return;
  const stage = screen.querySelector('#fx-stage');
  if (!stage) return;
  stage.className = `fx-stage active trainer-command-fx command-${event.command}`;
  stage.style.setProperty('--fx-color', a.color);
  stage.innerHTML = `<div class="fx-curtain"></div><div class="command-stripe"><i>⚑</i><span><small>${t('battle.command')}</small><b>${t('command.coach')}</b><em>${creatureName(event.creatureId)}</em></span><img src="${sprite(event.creatureId)}" alt=""></div><div class="fx-aftershock"></div>`;
  screen.classList.add('command-mode');
  rateNewAnimations(stage);
  ctx.arenaScene?.flash('power', a.color, 'player');
  ctx.arenaScene?.burst(a.color, 'player', 1.25);
}

function signatureReadyFx(event) {
  const session = ctx.battleSession,
    creature = sessionIsActive(session) ? activeOf(session.state, event.side) : null,
    signature = creature?.moves.find((id) => MOVES[id].signature);
  if (!creature || !signature) return;
  sound.call(creature.id);
  sound.ui();
  if (testAnimationScale === 0) return;
  const stage = screen.querySelector('#fx-stage');
  if (!stage) return;
  stage.classList.add('active');
  stage.querySelector('.signature-ready-call')?.remove();
  const a = AFFINITIES[creature.affinity],
    call = document.createElement('div');
  call.className = `signature-ready-call ${event.side}`;
  call.style.setProperty('--ready-color', a.color);
  call.innerHTML = `<i>✦</i><img src="${sprite(creature.id)}" alt=""><span><small>${t('battle.signatureReady')}</small><b>${creatureName(creature.id)}</b><em>${t(`move.${signature}`)}</em></span>`;
  stage.append(call);
  ctx.arenaScene?.flash('power', a.color, event.side);
  ctx.arenaScene?.burst(a.color, event.side, 1.15);
  scheduleFxTimer(
    () => {
      call.remove();
    },
    (ctx.save.reducedMotion ? 180 : 900) / ctx.save.battleSpeed
  );
}

// The HUD plate glows once per Surge moment; the class clears itself when the
// glow ends so the next Surge moment flashes again.
function surgeFlashFx(side) {
  if (testAnimationScale === 0) return;
  const hud = screen.querySelector(`#hud-${side}`);
  if (!hud || hud.classList.contains('surge-flash')) return;
  const done = (event) => {
    if (event.target !== hud || event.animationName !== 'surgeFlashGlow') return;
    hud.removeEventListener('animationend', done);
    hud.classList.remove('surge-flash');
  };
  hud.addEventListener('animationend', done);
  hud.classList.add('surge-flash');
}

function aceFx(event) {
  const creature = CREATURES[event.creatureId],
    a = AFFINITIES[creature.affinity];
  sound.clash();
  if (testAnimationScale === 0) return;
  const stage = screen.querySelector('#fx-stage');
  if (!stage) return;
  stage.className = `fx-stage active ace-phase ace-${event.ace}`;
  stage.style.setProperty('--fx-color', a.color);
  stage.innerHTML = `<div class="fx-curtain"></div><div class="ace-crown">♛</div><div class="ace-reveal"><span>${t('ace.reveal')}</span><img src="${sprite(event.creatureId)}" alt=""><small>${creatureName(event.creatureId)}</small><b>${t(`ace.${event.ace}`)}</b><em>${t(`ace.effect.${event.ace}`)}</em></div><div class="fx-aftershock"></div>`;
  screen.classList.add('ace-mode');
  rateNewAnimations(stage);
  ctx.arenaScene?.flash('power', a.color, 'enemy');
  ctx.arenaScene?.burst(a.color, 'enemy', 1.7);
  ctx.arenaScene?.punch('enemy', 1.3);
}

function statusTickFx(event) {
  if (testAnimationScale === 0) return;
  const stage = screen.querySelector('#fx-stage');
  if (!stage) return;
  const layer = layersOf(stage).tactical,
    meta = STATUS_DEFINITIONS[event.status],
    side = event.side;
  layer.className = `fx-stage fx-tactical active status-tick-fx status-${event.status} from-${side}`;
  layer.style.setProperty('--fx-color', meta?.color || '#fff');
  setOrigin(layer, side);
  const particles = radialParticles(particleBudget(24), `status:${event.status}`, 7, 6);
  layer.innerHTML = `<div class="fx-curtain"></div><div class="fx-impact">${particles}<i class="status-tick-icon${meta?.lightInk ? ' light-ink' : ''}">${meta ? statusIcon(event.status) : ''}</i></div>`;
  if (event.amount > 0) numberReadout(stage, side, `−${event.amount}`, 'damage');
  rateNewAnimations(layer);
  ctx.arenaScene?.burst(meta?.color || '#fff', side, 0.8);
}

function arenaPulseFx(event) {
  sound.guard();
  if (testAnimationScale === 0) return;
  const stage = screen.querySelector('#fx-stage');
  if (!stage) return;
  // The pulse runes and their label take the whole stage: earlier readouts
  // (a recoil number, a last hit) fade out instead of sitting under the label.
  settleReadouts();
  const icons = { crystal: '◇', grove: '❧', tidal: '≋', volcano: '♨', astral: '✦', eclipse: '☾' },
    colors = {
      crystal: '#73eaff',
      grove: '#8dff8a',
      tidal: '#54dfff',
      volcano: '#ff653d',
      astral: '#c69cff',
      eclipse: '#e37aff',
    },
    color = colors[event.arena] || '#fff',
    hostile = event.arena === 'volcano' || event.arena === 'eclipse';
  stage.className = `fx-stage active arena-pulse-fx arena-pulse-${event.arena} ${hostile ? 'pulse-hostile' : 'pulse-kind'}`;
  stage.style.setProperty('--fx-color', color);
  stage.innerHTML = `<div class="fx-curtain"></div><div class="arena-pulse-rune pulse-player"><b>${icons[event.arena]}</b><i></i><span>${t(`arena.${event.arena}`)}</span></div><div class="arena-pulse-rune pulse-enemy"><b>${icons[event.arena]}</b><i></i></div><div class="fx-aftershock"></div>`;
  rateNewAnimations(stage);
  ctx.arenaScene?.flash('power', color, 'enemy');
  ctx.arenaScene?.burst(color, 'player', 1.4);
  ctx.arenaScene?.burst(color, 'enemy', 1.4);
}

function missWhiffFx(event) {
  if (testAnimationScale === 0) return;
  const stage = screen.querySelector('#fx-stage');
  if (!stage) return;
  // The attack sailed past: the projectile keeps flying beyond the dodger and
  // dissolves, and a callout pops where the hit would have landed.
  stage.classList.add('whiff');
  replaceSideReadout(stage, event.side, '.whiff-callout');
  readout(stage, event.side, 'fx-callout whiff-callout', t('battle.missCallout'), { pill: true });
}

// A hit absorbed by a barrier lands on the shield: the projectile and trail
// stop there instead of parking over the target until the damage beat.
function landMoveFx() {
  if (testAnimationScale === 0) return;
  const stage = screen.querySelector('#fx-stage');
  if (moveFxNodes?.stage === stage) stage.classList.add('landed');
}

function barrierShatterFx(event) {
  if (testAnimationScale === 0) return;
  const stage = screen.querySelector('#fx-stage');
  if (!stage) return;
  // The shards live next to the stage so a later beat rebuilding the stage
  // does not cut them short.
  const shards = document.createElement('div');
  shards.className = `barrier-shatter side-${event.side}`;
  shards.style.left = event.side === 'player' ? '23%' : '77%';
  shards.style.top = event.side === 'player' ? '62%' : '24%';
  shards.innerHTML = `<i class="shatter-ring"></i>${Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * Math.PI * 2 + 0.4;
    return `<i class="shatter-hex" style="--i:${i};--dx:${Math.cos(angle) * (58 + (i % 3) * 26)}px;--dy:${Math.sin(angle) * (44 + (i % 3) * 22) - 26}px;--spin:${i % 2 ? 1 : -1}"></i>`;
  }).join('')}`;
  stage.parentElement.append(shards);
  rateNewAnimations(shards);
  scheduleFxTimer(() => shards.remove(), 900 / ctx.save.battleSpeed);
}

async function signatureClashIntro(events) {
  const session = ctx.battleSession;
  const signatures = events.filter((event) => event.type === 'move-start' && MOVES[event.moveId]?.signature);
  const committed = session?.committedClash;
  if (session) session.committedClash = null;
  const left = committed?.left || signatures.find((x) => x.side === 'player'),
    right = committed?.right || signatures.find((x) => x.side === 'enemy');
  if ((!committed && signatures.length < 2) || testAnimationScale === 0 || !sessionIsActive(session)) return;
  const stage = screen.querySelector('#fx-stage');
  if (!stage || !left || !right) return;
  stage.className = 'fx-stage active signature-clash';
  stage.innerHTML = `<div class="clash-half player"><img src="${sprite(left.creatureId)}" alt=""><b>${t(`move.${left.moveId}`)}</b></div><div class="clash-bolt">VS</div><div class="clash-half enemy"><img src="${sprite(right.creatureId)}" alt=""><b>${t(`move.${right.moveId}`)}</b></div>`;
  screen.classList.add('clash-mode');
  session.lastLine = t('battle.signatureClash');
  screen.querySelector('#action-line').textContent = session.lastLine;
  sound.clash();
  rateNewAnimations(stage);
  await wait((ctx.save.reducedMotion ? 260 : 1050) / ctx.save.battleSpeed);
  if (!sessionIsActive(session)) return;
  clearBattleFx({ preservePresentation: true });
}

function faintFx(event) {
  if (testAnimationScale === 0) return;
  const stage = screen.querySelector('#fx-stage');
  if (!stage) return;
  const creature = CREATURES[event.creatureId],
    color = creature ? AFFINITIES[creature.affinity].color : '#cfd6ff',
    wisps = document.createElement('div');
  wisps.className = 'faint-wisps';
  wisps.style.setProperty('--fx-color', color);
  wisps.style.left = event.side === 'player' ? '23%' : '77%';
  wisps.style.top = event.side === 'player' ? '62%' : '26%';
  wisps.innerHTML = Array.from(
    { length: 7 },
    (_, i) => `<i style="--wisp:${i};--wisp-dx:${(i % 2 ? -1 : 1) * (8 + ((i * 13) % 26))}px"></i>`
  ).join('');
  stage.classList.add('active');
  stage.append(wisps);
  rateNewAnimations(wisps);
  scheduleFxTimer(() => wisps.remove(), 1500 / ctx.save.battleSpeed);
}

function switchOutFx(event) {
  if (testAnimationScale === 0) return;
  const owner = ctx.battleSession?.state.sides[event.side],
    outgoing = owner?.team[event.from],
    fighter = screen.querySelector(`#fighter-${event.side}`);
  if (!fighter || !outgoing || outgoing.hp <= 0) return;
  const ghost = document.createElement('img'),
    color = outgoing ? AFFINITIES[outgoing.affinity].color : '#9fd8ff',
    beam = document.createElement('i');
  ghost.src = sprite(outgoing.id);
  ghost.className = 'switch-ghost';
  ghost.alt = '';
  beam.className = 'switch-beam';
  beam.style.setProperty('--fx-color', color);
  fighter.classList.add('switch-awaiting');
  fighter.append(ghost, beam);
  scheduleFxTimer(() => {
    ghost.remove();
    beam.remove();
  }, 640 / ctx.save.battleSpeed);
}

function switchInFx(event) {
  const fighter = screen.querySelector(`#fighter-${event.side}`),
    creature = CREATURES[event.creatureId];
  if (!fighter || !creature || fighter.classList.contains('fainted')) return;
  sound.call(event.creatureId);
  if (testAnimationScale === 0) return;
  fighter.classList.remove('switch-awaiting');
  fighter.classList.add('entering');
  rateNewAnimations(fighter);
  ctx.arenaScene?.burst(AFFINITIES[creature.affinity].color, event.side, 0.9);
}

async function battleOutroFx(state) {
  const session = ctx.battleSession;
  if (!session || testAnimationScale === 0 || !screen.classList.contains('battle-screen')) return;
  const speed = ctx.save.battleSpeed,
    reduced = ctx.save.reducedMotion,
    neutral = state?.reason === 'turn-cap',
    winner = neutral ? null : state?.winner,
    champion = winner ? activeOf(state, winner) : null;
  if (champion && champion.hp > 0) {
    const color = AFFINITIES[champion.affinity]?.color || '#ffe9a8',
      fighter = screen.querySelector(`#fighter-${winner}`);
    fighter?.classList.add('victory-pose');
    screen.classList.add('battle-outro', winner === 'player' ? 'outro-win' : 'outro-loss');
    // The winner's cry is audio, not motion: it plays with reduced motion too.
    sound.call(champion.id);
    rateNewAnimations(fighter);
    if (!reduced) {
      ctx.arenaScene?.burst(color, winner, 1.35);
      scheduleFxTimer(() => {
        if (sessionIsActive(session)) ctx.arenaScene?.burst('#fff6d8', winner, 0.85);
      }, 240 / speed);
    }
  } else {
    screen.classList.add('battle-outro', 'outro-draw');
  }
  await wait((reduced ? 340 : champion ? 820 : 520) / speed);
  if (!sessionIsActive(session)) return;
  screen.classList.add('battle-exit');
  ctx.arenaScene?.setPaused(true);
  await wait((reduced ? 150 : 420) / speed);
}

function clearBattleFx({ preservePresentation = false, keepReadouts = false } = {}) {
  clearFxTimers();
  if (!preservePresentation && ctx.battleSession) ctx.battleSession.displayState = null;
  const stage = screen.querySelector('#fx-stage');
  if (stage) {
    stage.className = 'fx-stage';
    stage.replaceChildren();
    const layers = fxLayers.get(stage);
    if (layers) {
      layers.tactical.className = 'fx-stage fx-tactical';
      layers.tactical.replaceChildren();
      if (!keepReadouts) layers.readouts.replaceChildren();
    }
  }
  moveFxNodes = null;
  readoutStack.player = 0;
  readoutStack.enemy = 0;
  screen.classList.remove(
    'cinematic',
    'cinematic-signature',
    'camera-player',
    'camera-enemy',
    'camera-strike',
    'camera-rush',
    'camera-heavy',
    'camera-wide',
    'camera-ultimate',
    'camera-impact',
    'clash-mode',
    'combo-hit',
    'intro-mode',
    'combo-credit-mode',
    'perfect-relay-mode',
    'relay-rush-mode',
    'immaculate-relay-mode',
    'relay-player',
    'relay-enemy',
    'command-mode',
    'ace-mode',
    'finisher-mode',
    'mini-finisher-mode',
    'ko-shock'
  );
  screen.querySelectorAll('.fighter').forEach((fighter) => {
    fighter.classList.remove(
      'attacking',
      'hit',
      'ko',
      'barrier-hit',
      'dodging',
      'status-hit',
      'entering',
      'switch-awaiting',
      'windup',
      'victory-pose',
      'hit-stop'
    );
    fighter.style.removeProperty('--attack-affinity-color');
  });
  screen.querySelectorAll('.switch-ghost, .switch-beam, .barrier-shatter').forEach((node) => node.remove());
  screen.querySelector('#action-line')?.classList.remove('epic');
  ctx.currentFxMove = null;
  rateBattleTargets();
}

registerRoutes({
  beginMoveFx,
  impactMoveFx,
  effectivenessCalloutFx,
  tacticalFx,
  comboCreditFx,
  perfectRelayFx,
  relayRushFx,
  immaculateRelayFx,
  trainerCommandFx,
  signatureReadyFx,
  surgeFlashFx,
  aceFx,
  statusTickFx,
  arenaPulseFx,
  missWhiffFx,
  barrierShatterFx,
  landMoveFx,
  signatureClashIntro,
  faintFx,
  switchOutFx,
  switchInFx,
  battleOutroFx,
  moveStartBeatMs,
  isBlockedHit,
  settleReadouts,
  syncBattleAnimationSpeed,
  clearBattleFx,
});
