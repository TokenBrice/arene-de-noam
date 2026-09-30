import { ctx, registerRoutes } from '../app/context.js';
import { clearPresentation, playOutro } from './director.js';

// Battle FX routes kept for results.js and the controller (§6.1): the battle outro and the
// presentation reset. The rest of this module is the bestiary Move Theater's DOM FX path (§8.5):
// its DOM fighters and its #fx-stage (with the `move-<id>` class) keep the legacy CSS
// choreography scaffold of battle-fx.css. Battles play through director.js instead.

const {
  AFFINITIES,
  MOVES,
  STATUS_DEFINITIONS,
  statusIcon,
  testAnimationScale,
  screen,
  sprite,
  affinityIcon,
} = ctx;

// Theater stage anchors (percent of the stage box) for each side.
const ANCHOR = { player: { x: 23, y: 68 }, enemy: { x: 77, y: 30 } };

const beginFxTemplateCache = new Map(),
  radialFxTemplateCache = new Map();

// Particle counts follow the active quality tier (src/app/quality.js).
function particleBudget(count) {
  return Math.max(1, Math.ceil(count * ctx.quality.fx.particleScale));
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

function theaterStage() {
  return screen.querySelector('.move-theater #fx-stage');
}

// One compositor-only vector per move: projectiles translate by --fx-dx/--fx-dy and the trail is
// rotated and sized from the same vector. Read once per replay.
function setFlightVector(stage, source, target) {
  const width = stage.clientWidth,
    height = stage.clientHeight,
    from = ANCHOR[source],
    to = ANCHOR[target],
    dx = ((to.x - from.x) / 100) * width,
    dy = ((to.y - from.y) / 100) * height;
  stage.style.setProperty('--to-x', `${to.x}%`);
  stage.style.setProperty('--to-y', `${to.y}%`);
  stage.style.setProperty('--fx-dx', `${dx.toFixed(1)}px`);
  stage.style.setProperty('--fx-dy', `${dy.toFixed(1)}px`);
  stage.style.setProperty('--trail-angle', `${Math.atan2(dy, dx).toFixed(4)}rad`);
  stage.style.setProperty('--trail-len', `${Math.hypot(dx, dy).toFixed(1)}px`);
}

function setOrigin(layer, side) {
  layer.style.setProperty('--from-x', `${ANCHOR[side].x}%`);
  layer.style.setProperty('--from-y', `${ANCHOR[side].y}%`);
}

// The theater's tactical beats and readouts draw on their own layers next to its #fx-stage.
const theaterLayers = new WeakMap();
let theaterMove = null;

function layersOf(stage) {
  let layers = theaterLayers.get(stage);
  if (layers?.tactical.isConnected && layers.readouts.isConnected) return layers;
  const tactical = document.createElement('div'),
    readouts = document.createElement('div');
  tactical.className = 'fx-stage fx-tactical';
  tactical.setAttribute('aria-hidden', 'true');
  readouts.className = 'fx-readouts';
  readouts.setAttribute('aria-hidden', 'true');
  stage.after(tactical, readouts);
  layers = { tactical, readouts };
  theaterLayers.set(stage, layers);
  return layers;
}

function removeReadout(event) {
  if (event.target === event.currentTarget && !event.pseudoElement) event.currentTarget.remove();
}

function readout(stage, side, className, text) {
  const node = document.createElement('b');
  node.className = `fx-readout ${className} side-${side}`;
  node.textContent = text;
  node.addEventListener('animationend', removeReadout);
  layersOf(stage).readouts.append(node);
  return node;
}

// The flight time of the theater's projectile: it lands exactly on the impact.
function flightMs(move) {
  return move?.signature ? 780 : (move?.power || 0) >= 46 ? 420 : 300;
}

function beginMoveFx(event) {
  const move = MOVES[event.moveId],
    a = AFFINITIES[move.affinity],
    source = event.side,
    target = source === 'player' ? 'enemy' : 'player';
  theaterMove = { moveId: event.moveId, strong: Boolean(move.signature) || move.power >= 46 };
  if (testAnimationScale === 0) return;
  const stage = theaterStage();
  if (!stage) return;
  const strong = theaterMove.strong;
  setFlightVector(stage, source, target);
  stage.className = `fx-stage active move-fx fx-${move.affinity} move-${move.id} visual-${move.archetype || move.visual} owner-${move.owner} from-${source} ${strong ? 'signature' : ''} ${move.power === 0 ? 'self-fx' : ''}`;
  stage.style.setProperty('--fx-color', a.color);
  setOrigin(stage, source);
  const archetype = move.archetype || move.visual || 'default',
    template = beginFxTemplate(archetype, particleBudget(strong ? 42 : 24), strong ? 12 : 8, strong ? 6 : 3);
  stage.innerHTML = `<div class="fx-curtain"></div><div class="fx-sky-symbol"><b>${affinityIcon(move.affinity)}</b><span></span></div><div class="fx-source-aura">${template.echoes}</div><div class="fx-trail"></div><div class="fx-detail">${template.detail}</div><div class="fx-projectile"><b>${affinityIcon(move.affinity)}</b><span></span></div><div class="fx-impact">${template.particles}<i class="fx-core">${affinityIcon(move.affinity)}</i>${template.echoes}</div><div class="fx-aftershock"></div>${template.archExtras}`;
  const flight = `${flightMs(move)}ms`;
  stage.querySelector('.fx-projectile').style.animationDuration = flight;
  stage.querySelector('.fx-trail').style.animationDuration = flight;
  if (archetype === 'charge') {
    const ghost = document.createElement('img');
    ghost.className = 'fx-dash-ghost';
    ghost.src = sprite(event.creatureId);
    ghost.alt = '';
    stage.append(ghost);
  }
  const attacker = screen.querySelector(`.theater-battlefield #fighter-${source}`);
  attacker?.style.setProperty('--attack-affinity-color', a.color);
  attacker?.classList.add('windup');
}

function impactMoveFx(event) {
  if (testAnimationScale === 0) return;
  const stage = theaterStage();
  if (!stage || !theaterMove) return;
  stage.classList.add('impact');
  if (event.hits > 1) stage.classList.add('multi-hit-impact');
  if (event.amount > 0) readout(stage, event.side, theaterMove.strong ? 'strong' : '', `−${event.amount}`);
  // Hit-stop: the theater stage and its two fighters freeze for a beat.
  const frozen = [stage, ...screen.querySelectorAll('.theater-battlefield .fighter')];
  frozen.forEach((node) => node.classList.add('hit-stop'));
  ctx.theaterTimers.push(
    setTimeout(
      () => frozen.forEach((node) => node.classList.remove('hit-stop')),
      ctx.save.reducedMotion ? 20 : 72
    )
  );
}

function tacticalFx(event) {
  if (testAnimationScale === 0) return;
  const stage = theaterStage();
  if (!stage) return;
  const layer = layersOf(stage).tactical,
    side = event.side,
    kind = event.type,
    meta = STATUS_DEFINITIONS[event.status],
    color = kind === 'heal' ? '#8dffb0' : meta?.color || '#79e9ff',
    moveClass = theaterMove ? `move-${theaterMove.moveId}` : '',
    statusPolarity = meta ? (meta.positive ? 'status-positive' : 'status-negative') : '',
    coreText = kind === 'heal' ? '✦' : meta ? statusIcon(event.status) : '⬡';
  layer.className = `fx-stage fx-tactical active tactical-fx tactical-${kind === 'heal' ? kind : event.status || 'cleanse'} ${statusPolarity} ${meta ? 'status-application' : ''} ${moveClass} from-${side}`;
  layer.style.setProperty('--fx-color', color);
  setOrigin(layer, side);
  const template = tacticalFxTemplate(particleBudget(18));
  layer.innerHTML = `<div class="fx-source-aura">${template.rings}</div><div class="fx-detail">${template.detail}</div><div class="fx-impact">${template.particles}<i class="fx-core${meta?.lightInk ? ' light-ink' : ''}">${coreText}</i></div>`;
}

// Victory / defeat finale before the results (§6.7), played by the director.
function battleOutroFx(state) {
  return playOutro(state);
}

// Drops every in-flight battle readout, banner and FX quad, and resets the Move Theater stage.
function clearBattleFx() {
  clearPresentation();
  theaterMove = null;
  const stage = theaterStage();
  if (!stage) return;
  stage.className = 'fx-stage';
  stage.replaceChildren();
  const layers = theaterLayers.get(stage);
  if (layers) {
    layers.tactical.className = 'fx-stage fx-tactical';
    layers.tactical.replaceChildren();
    layers.readouts.replaceChildren();
  }
  screen.querySelectorAll('.theater-battlefield .fighter').forEach((fighter) => {
    fighter.classList.remove('windup', 'hit-stop');
    fighter.style.removeProperty('--attack-affinity-color');
  });
}

registerRoutes({
  beginMoveFx,
  impactMoveFx,
  tacticalFx,
  battleOutroFx,
  clearBattleFx,
});
