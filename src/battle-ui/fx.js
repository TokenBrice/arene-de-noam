import { ctx, registerRoutes, route } from '../app/context.js';

const {
  AFFINITIES,
  CREATURES,
  MOVES,
  quickRule,
  activeOf,
  STATUS_DEFINITIONS,
  statusIcon,
  testAnimationScale,
  t,
  screen,
  sound,
  sprite,
  creatureName,
  affinity,
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

let lastAppliedSpeed = null;
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
    rings: Array.from({ length: 4 }, (_, i) => `<i class="fx-ring" style="--ring:${i};--delay:${i * 85}ms"></i>`).join(''),
    detail: Array.from({ length: 6 }, (_, i) => `<i style="--detail:${i}"></i>`).join(''),
    particles: radialParticles(particleCount, 'tactical', 5, 6, 30),
  };
  radialFxTemplateCache.set(key, template);
  return template;
}

function syncBattleAnimationSpeed() {
  const speed = ctx.save.battleSpeed;
  if (speed === 1 && lastAppliedSpeed === 1) return;
  queueMicrotask(() => {
    const apply = () => {
      if (!screen.classList.contains('battle-screen')) return;
      const currentSpeed = ctx.save.battleSpeed;
      if (currentSpeed === 1 && lastAppliedSpeed === 1) return;
      for (const animation of screen.getAnimations({ subtree: true })) {
        animation.updatePlaybackRate(currentSpeed);
        animation.playbackRate = currentSpeed;
      }
      lastAppliedSpeed = currentSpeed;
    };
    apply();
    if (ctx.save.battleSpeed !== 1) requestAnimationFrame(apply);
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
  // standing) gets a bigger show — more particles, hotter vignette, and the
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
  stage.className = `fx-stage active fx-${move.affinity} move-${move.id} visual-${move.archetype || move.visual} owner-${move.owner} from-${source} ${strong ? 'signature' : ''} ${move.power === 0 ? 'self-fx' : ''}`;
  stage.style.setProperty('--fx-color', a.color);
  stage.style.setProperty('--from-x', source === 'player' ? '23%' : '77%');
  stage.style.setProperty('--from-y', source === 'player' ? '68%' : '30%');
  stage.style.setProperty('--to-x', target === 'enemy' ? '77%' : '23%');
  stage.style.setProperty('--to-y', target === 'enemy' ? '30%' : '68%');
  const particleCount = particleBudget(strong ? (cornered ? 52 : 42) : cornered ? 34 : 24),
    detailCount = strong ? 12 : 8,
    archetype = move.archetype || move.visual || 'default',
    template = beginFxTemplate(archetype, particleCount, detailCount, strong ? 6 : 3);
  // Archetype-specific extra bodies: slashes/eruption pillars/storm drops sync
  // to the .impact class; the charge ghost is the only per-event template part.
  stage.innerHTML = `<div class="fx-curtain"></div><div class="fx-sky-symbol"><b>${affinityIcon(move.affinity)}</b><span></span></div><div class="fx-source-aura">${template.echoes}</div><div class="fx-trail"></div><div class="fx-detail">${template.detail}</div><div class="fx-projectile"><b>${affinityIcon(move.affinity)}</b><span></span></div><div class="fx-impact">${template.particles}<i class="fx-core">${affinityIcon(move.affinity)}</i>${template.echoes}</div><div class="fx-aftershock"></div>${template.archExtras}`;
  if (archetype === 'charge') {
    const ghost = document.createElement('img');
    ghost.className = 'fx-dash-ghost';
    ghost.src = sprite(event.creatureId);
    ghost.alt = '';
    stage.append(ghost);
  }
  screen.classList.add(
    'cinematic',
    `cinematic-${move.affinity}`,
    `camera-${source}`,
    `camera-${cameraBumped}`
  );
  if (strong) screen.classList.add('cinematic-signature');
  if (cornered) screen.classList.add('stakes-high');
  const attacker = screen.querySelector(`#fighter-${source}`);
  attacker?.style.setProperty('--attack-affinity-color', a.color);
  attacker?.classList.add('windup');
  screen.querySelector('#action-line')?.classList.toggle('epic', strong);
}

function impactMoveFx(event) {
  if (testAnimationScale === 0) return;
  const session = ctx.battleSession;
  const stage = screen.querySelector('#fx-stage'),
    fx = ctx.currentFxMove;
  if (!stage || !fx) return;
  stage.classList.add('impact');
  screen.classList.add('camera-impact');
  const impact = stage.querySelector('.fx-impact'),
    core = impact?.querySelector('.fx-core');
  if (core) {
    core.textContent = event.hp <= 0 ? 'K.O.' : `${event.combo ? 'COMBO ' : ''}−${event.amount}`;
    core.classList.add('damage-number');
  }
  stage.querySelectorAll('.affinity-callout,.hit-chain').forEach((node) => node.remove());
  if (event.hits > 1) {
    const chain = document.createElement('span');
    chain.className = `hit-chain ${event.hit === event.hits ? 'final' : ''}`;
    chain.dataset.hit = String(event.hit);
    chain.innerHTML = `<b>${event.hit}</b><small>/${event.hits}</small>`;
    impact?.append(chain);
    stage.classList.add('multi-hit-impact');
  }
  if (event.combo) {
    stage.classList.add('combo-impact');
    screen.classList.add('combo-hit');
  }
  if (event.hp <= 0) {
    stage.classList.add('finisher-impact');
    screen.classList.add('finisher-mode');
    if (!sessionIsActive(session)) return;
    session.lastLine = t('battle.finisher', { move: t(`move.${fx.moveId}`) });
    screen.querySelector('#action-line').textContent = session.lastLine;
  } else if (MOVES[fx.moveId]?.signature) {
    // Mini-finisher (plan §4.2): a non-lethal signature still gets a short
    // slash and a brief canvas dim, softer and shorter than a K.O.
    stage.classList.add('mini-finisher-impact');
    screen.classList.add('mini-finisher-mode');
  }
  const color = AFFINITIES[fx.affinity]?.color || '#ffffff';
  ctx.arenaScene?.flash(fx.strong ? 'power' : 'hit', color, event.side);
  ctx.arenaScene?.punch(event.side, fx.strong ? 1.55 : (event.hits || 1) > 1 ? 0.8 : 1);
  screen.classList.add('hit-stop');
  scheduleFxTimer(
    () => {
      screen.classList.remove('hit-stop');
    },
    ctx.save.reducedMotion ? 20 : 72 / ctx.save.battleSpeed
  );
}

function effectivenessCalloutFx(event) {
  if (testAnimationScale === 0) return;
  if (!event.affinity || event.affinity === 1) return;
  const stage = screen.querySelector('#fx-stage'),
    impact = stage?.querySelector('.fx-impact');
  if (!stage || !impact) return;
  const effective = event.affinity > 1,
    kind = effective ? 'effective' : 'weak',
    callout = document.createElement('b');
  stage.querySelectorAll('.affinity-callout').forEach((node) => node.remove());
  callout.className = `affinity-callout ${kind}`;
  callout.textContent = t(effective ? 'battle.hitEffective' : 'battle.hitWeak');
  impact.append(callout);
  stage.classList.add(`affinity-${kind}`);
}

function tacticalFx(event) {
  if (testAnimationScale === 0) return;
  const stage = screen.querySelector('#fx-stage');
  if (!stage) return;
  const side = event.side,
    meta = STATUS_DEFINITIONS[event.status],
    color =
      event.type === 'heal' ? '#8dffb0' : event.type === 'barrier' ? '#73eaff' : meta?.color || '#79e9ff';
  const moveClass = ctx.currentFxMove?.moveId ? `move-${ctx.currentFxMove.moveId}` : '',
    numeric = ['heal', 'barrier'].includes(event.type) && event.amount > 0,
    statusPolarity = meta ? (meta.positive ? 'status-positive' : 'status-negative') : '',
    statusChange = meta ? (event.applied === false ? 'status-remove' : 'status-application') : '',
    coreText =
      event.type === 'heal' && numeric
        ? `+${event.amount}`
        : event.type === 'barrier' && numeric
          ? `+${event.amount} ⬡`
          : event.type === 'heal'
            ? '✦'
            : meta
              ? statusIcon(event.status)
              : '⬡';
  stage.className = `fx-stage active tactical-fx tactical-${['heal', 'barrier'].includes(event.type) ? event.type : event.status || 'cleanse'} ${numeric ? 'tactical-numeric' : ''} ${statusPolarity} ${statusChange} ${moveClass} from-${side}`;
  stage.style.setProperty('--fx-color', color);
  stage.style.setProperty('--from-x', side === 'player' ? '23%' : '77%');
  const tacticalTemplate = tacticalFxTemplate(particleBudget(18));
  stage.innerHTML = `<div class="fx-source-aura">${tacticalTemplate.rings}</div><div class="fx-detail">${tacticalTemplate.detail}</div><div class="fx-impact">${tacticalTemplate.particles}<i class="fx-core ${numeric ? 'tactical-number' : ''}${meta?.lightInk ? ' light-ink' : ''}">${coreText}</i></div>`;
  ctx.arenaScene?.burst(color, side, event.type === 'heal' ? 1.2 : 0.8);
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
  stage.style.setProperty('--from-x', event.side === 'player' ? '23%' : '77%');
  stage.style.setProperty('--from-y', event.side === 'player' ? '68%' : '30%');
  stage.innerHTML = `<div class="fx-curtain"></div><div class="relay-sweep"></div><div class="relay-cut"><img src="${sprite(event.creatureId)}" alt=""><span><small>↺ ${t('battle.switchRead')}</small><b>${creatureName(event.creatureId)}</b><em>+6 ${t('battle.surge')}</em></span></div><div class="relay-rings">${Array.from({ length: 5 }, (_, i) => `<i style="--ring:${i}"></i>`).join('')}</div>`;
  screen.classList.add('perfect-relay-mode', `relay-${event.side}`);
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
  stage.style.setProperty('--from-x', event.side === 'player' ? '23%' : '77%');
  stage.style.setProperty('--from-y', event.side === 'player' ? '68%' : '30%');
  stage.innerHTML = `<div class="fx-curtain"></div><div class="relay-rush-lines"></div><div class="relay-rush-call ${event.side}"><i>↺</i><img src="${sprite(creature.id)}" alt=""><span><small>${t('quickRule.relay_rush')}</small><b>${creatureName(creature.id)}</b><em>+24 ${t('battle.surge')} · ${t('status.haste')}</em></span></div><div class="relay-rings">${Array.from({ length: 6 }, (_, i) => `<i style="--ring:${i}"></i>`).join('')}</div>`;
  screen.classList.add('relay-rush-mode', `relay-${event.side}`);
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
  ctx.arenaScene?.flash('power', a.color, 'enemy');
  ctx.arenaScene?.burst(a.color, 'enemy', 1.7);
  ctx.arenaScene?.punch('enemy', 1.3);
}

function statusTickFx(event) {
  if (testAnimationScale === 0) return;
  const stage = screen.querySelector('#fx-stage');
  if (!stage) return;
  const meta = STATUS_DEFINITIONS[event.status],
    side = event.side;
  stage.className = `fx-stage active status-tick-fx status-${event.status} from-${side}`;
  stage.style.setProperty('--fx-color', meta?.color || '#fff');
  stage.style.setProperty('--from-x', side === 'player' ? '23%' : '77%');
  stage.style.setProperty('--from-y', side === 'player' ? '68%' : '30%');
  const particles = radialParticles(particleBudget(24), `status:${event.status}`, 7, 6);
  stage.innerHTML = `<div class="fx-curtain"></div><div class="fx-impact">${particles}<i class="status-tick-icon${meta?.lightInk ? ' light-ink' : ''}">${meta ? statusIcon(event.status) : ''}</i><i class="fx-core damage-number">−${event.amount}</i></div>`;
  ctx.arenaScene?.burst(meta?.color || '#fff', side, 0.8);
}

function arenaPulseFx(event) {
  sound.guard();
  if (testAnimationScale === 0) return;
  const stage = screen.querySelector('#fx-stage');
  if (!stage) return;
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
  screen.classList.add('arena-awake');
  ctx.arenaScene?.flash('power', color, 'enemy');
  ctx.arenaScene?.burst(color, 'player', 1.4);
  ctx.arenaScene?.burst(color, 'enemy', 1.4);
}

function missWhiffFx(event) {
  if (testAnimationScale === 0) return;
  const stage = screen.querySelector('#fx-stage');
  if (!stage) return;
  // The attack sailed past: the projectile keeps flying beyond the dodger and
  // dissolves, and a callout pops where the hit would have landed. The callout
  // lives on the stage's parent so the follow-up status-cleanse FX (which
  // rebuilds the stage) does not wipe it early.
  stage.classList.add('whiff');
  const layer = stage.parentElement;
  layer.querySelectorAll('.whiff-callout').forEach((node) => node.remove());
  const call = document.createElement('b');
  call.className = `whiff-callout side-${event.side}`;
  call.textContent = t('battle.missCallout');
  layer.append(call);
  scheduleFxTimer(() => call.remove(), 900 / ctx.save.battleSpeed);
}

function barrierShatterFx(event) {
  if (testAnimationScale === 0) return;
  const stage = screen.querySelector('#fx-stage');
  if (!stage) return;
  // Same parent-layer trick as the whiff callout: the shards must outlive the
  // stage rebuild that the barrier-broken follow-up events trigger.
  const shards = document.createElement('div');
  shards.className = `barrier-shatter side-${event.side}`;
  shards.style.left = event.side === 'player' ? '23%' : '77%';
  shards.style.top = event.side === 'player' ? '62%' : '24%';
  shards.innerHTML = `<i class="shatter-ring"></i>${Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * Math.PI * 2 + 0.4;
    return `<i class="shatter-hex" style="--i:${i};--dx:${Math.cos(angle) * (58 + (i % 3) * 26)}px;--dy:${Math.sin(angle) * (44 + (i % 3) * 22) - 26}px;--spin:${i % 2 ? 1 : -1}"></i>`;
  }).join('')}`;
  stage.parentElement.append(shards);
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
  syncBattleAnimationSpeed();
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
  scheduleFxTimer(
    () => {
      ghost.remove();
      beam.remove();
    },
    640 / ctx.save.battleSpeed
  );
}

function switchInFx(event) {
  const fighter = screen.querySelector(`#fighter-${event.side}`),
    creature = CREATURES[event.creatureId];
  if (!fighter || !creature || fighter.classList.contains('fainted')) return;
  sound.call(event.creatureId);
  if (testAnimationScale === 0) return;
  fighter.classList.remove('switch-awaiting');
  fighter.classList.add('entering');
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
    const color = AFFINITIES[champion.affinity]?.color || '#ffe9a8';
    screen.querySelector(`#fighter-${winner}`)?.classList.add('victory-pose');
    screen.classList.add('battle-outro', winner === 'player' ? 'outro-win' : 'outro-loss');
    if (!reduced) {
      sound.call(champion.id);
      ctx.arenaScene?.burst(color, winner, 1.35);
      scheduleFxTimer(() => {
        if (sessionIsActive(session)) ctx.arenaScene?.burst('#fff6d8', winner, 0.85);
      }, 240 / speed);
    }
  } else {
    screen.classList.add('battle-outro', 'outro-draw');
  }
  syncBattleAnimationSpeed();
  await wait((reduced ? 340 : champion ? 820 : 520) / speed);
  if (!sessionIsActive(session)) return;
  screen.classList.add('battle-exit');
  syncBattleAnimationSpeed();
  await wait((reduced ? 150 : 420) / speed);
}

function clearBattleFx({ preservePresentation = false } = {}) {
  clearFxTimers();
  if (!preservePresentation && ctx.battleSession) ctx.battleSession.displayState = null;
  const stage = screen.querySelector('#fx-stage');
  if (stage) {
    stage.className = 'fx-stage';
    stage.replaceChildren();
  }
  screen.classList.remove(
    'cinematic',
    'cinematic-signature',
    'cinematic-mind',
    'cinematic-force',
    'cinematic-tide',
    'cinematic-flame',
    'cinematic-grove',
    'cinematic-shadow',
    'cinematic-neutral',
    'camera-player',
    'camera-enemy',
    'camera-strike',
    'camera-rush',
    'camera-heavy',
    'camera-wide',
    'camera-ultimate',
    'camera-impact',
    'hit-stop',
    'arena-awake',
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
    'stakes-high',
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
      'victory-pose'
    );
    fighter.style.removeProperty('--attack-affinity-color');
  });
  screen.querySelectorAll('.switch-ghost, .switch-beam, .whiff-callout, .barrier-shatter').forEach((node) => node.remove());
  screen.querySelector('#action-line')?.classList.remove('epic');
  ctx.currentFxMove = null;
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
  aceFx,
  statusTickFx,
  arenaPulseFx,
  missWhiffFx,
  barrierShatterFx,
  signatureClashIntro,
  faintFx,
  switchOutFx,
  switchInFx,
  battleOutroFx,
  syncBattleAnimationSpeed,
  clearBattleFx,
});
