import { ctx, registerRoutes, route } from '../app/context.js';

const {
  AFFINITIES,
  CREATURES,
  MOVES,
  quickRule,
  activeOf,
  STATUS_DEFINITIONS,
  testAnimationScale,
  t,
  screen,
  sound,
  sprite,
  creatureName,
  affinity,
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

function beginMoveFx(event) {
  const move = MOVES[event.moveId],
    a = AFFINITIES[move.affinity],
    stage = screen.querySelector('#fx-stage');
  if (!stage) return;
  const source = event.side,
    target = source === 'player' ? 'enemy' : 'player',
    strong = Boolean(move.signature) || move.power >= 46,
    cameraGrammar = move.signature
      ? 'ultimate'
      : move.kind !== 'damage'
        ? 'wide'
        : (move.hits || 1) > 1 || move.priority > 0
          ? 'rush'
          : move.power >= 42
            ? 'heavy'
            : 'strike';
  ctx.currentFxMove = {
    moveId: event.moveId,
    creatureId: event.creatureId,
    affinity: move.affinity,
    source,
    target,
    strong,
    kind: move.kind,
  };
  stage.className = `fx-stage active fx-${move.affinity} move-${move.id} visual-${move.visual} owner-${move.owner} from-${source} ${strong ? 'signature' : ''} ${move.power === 0 ? 'self-fx' : ''}`;
  stage.style.setProperty('--fx-color', a.color);
  stage.style.setProperty('--from-x', source === 'player' ? '23%' : '77%');
  stage.style.setProperty('--from-y', source === 'player' ? '68%' : '30%');
  stage.style.setProperty('--to-x', target === 'enemy' ? '77%' : '23%');
  stage.style.setProperty('--to-y', target === 'enemy' ? '30%' : '68%');
  const particleCount = strong ? 42 : 24,
    detailCount = strong ? 12 : 8;
  const particles = Array.from({ length: particleCount }, (_, i) => {
    const angle = (i / particleCount) * Math.PI * 2,
      distance = 55 + ((i * 37) % 145);
    return `<i class="fx-particle" style="--particle:${i};--dx:${Math.cos(angle) * distance}px;--dy:${Math.sin(angle) * distance}px;--delay:${(i % 9) * 16}ms;--spin:${i % 2 ? 1 : -1}"></i>`;
  }).join('');
  const echoes = Array.from(
    { length: strong ? 6 : 3 },
    (_, i) => `<i class="fx-ring" style="--ring:${i};--delay:${i * 58}ms"></i>`
  ).join('');
  stage.innerHTML = `<div class="fx-curtain"></div><div class="fx-sky-symbol"><b>${a.icon}</b><span></span></div><div class="fx-source-aura">${echoes}</div><div class="fx-trail"></div><div class="fx-detail">${Array.from({ length: detailCount }, (_, i) => `<i style="--detail:${i}"></i>`).join('')}</div><div class="fx-projectile"><b>${a.icon}</b><span></span></div><div class="fx-impact">${particles}<i class="fx-core">${a.icon}</i>${echoes}</div><div class="fx-aftershock"></div>`;
  screen.classList.add(
    'cinematic',
    `cinematic-${move.affinity}`,
    `camera-${source}`,
    `camera-${cameraGrammar}`
  );
  if (strong) screen.classList.add('cinematic-signature');
  const attacker = screen.querySelector(`#fighter-${source}`);
  attacker?.classList.add('windup', `attack-${move.affinity}`);
  screen.querySelector('#action-line')?.classList.toggle('epic', strong);
}

function impactMoveFx(event) {
  const session = ctx.battleSession;
  const stage = screen.querySelector('#fx-stage'),
    fx = ctx.currentFxMove;
  if (!stage || !fx) return;
  stage.classList.add('impact');
  screen.classList.add('camera-impact');
  const impact = stage.querySelector('.fx-impact'),
    core = impact?.querySelector('.fx-core');
  if (core) {
    core.textContent = event.hp <= 0 ? 'K.O.' : `${event.combo?.length ? 'COMBO ' : ''}−${event.amount}`;
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
  if (event.combo?.length) {
    stage.classList.add('combo-impact');
    screen.classList.add('combo-hit');
  }
  if (event.hp <= 0) {
    stage.classList.add('finisher-impact');
    screen.classList.add('finisher-mode');
    if (!sessionIsActive(session)) return;
    session.lastLine = t('battle.finisher', { move: t(`move.${fx.moveId}`) });
    screen.querySelector('#action-line').textContent = session.lastLine;
  }
  const color = AFFINITIES[fx.affinity]?.color || '#ffffff';
  ctx.arenaScene?.flash(fx.strong ? 'power' : 'hit', color, event.side);
  ctx.arenaScene?.punch(event.side, fx.strong ? 1.55 : (event.hits || 1) > 1 ? 0.8 : 1);
  screen.classList.add('hit-stop');
  setTimeout(
    () => {
      if (sessionIsActive(session)) screen.classList.remove('hit-stop');
    },
    ctx.save.reducedMotion ? 20 : 72 / ctx.save.battleSpeed
  );
}

function effectivenessCalloutFx(event) {
  if (event.affinity !== 1.5 && event.affinity !== 0.75) return;
  const stage = screen.querySelector('#fx-stage'),
    impact = stage?.querySelector('.fx-impact');
  if (!stage || !impact) return;
  const effective = event.affinity === 1.5,
    kind = effective ? 'effective' : 'weak',
    callout = document.createElement('b');
  stage.querySelectorAll('.affinity-callout').forEach((node) => node.remove());
  callout.className = `affinity-callout ${kind}`;
  callout.textContent = t(effective ? 'battle.hitEffective' : 'battle.hitWeak');
  impact.append(callout);
  stage.classList.add(`affinity-${kind}`);
}

function tacticalFx(event) {
  const stage = screen.querySelector('#fx-stage');
  if (!stage) return;
  const side = event.side,
    color = event.type === 'heal' ? '#8dffb0' : event.status === 'focused' ? '#ffd66b' : '#79e9ff';
  const moveClass = ctx.currentFxMove?.moveId ? `move-${ctx.currentFxMove.moveId}` : '',
    numeric = ['heal', 'barrier'].includes(event.type) && event.amount > 0,
    coreText =
      event.type === 'heal' && numeric
        ? `+${event.amount}`
        : event.type === 'barrier' && numeric
          ? `+${event.amount} ⬡`
          : event.type === 'heal'
            ? '✦'
            : event.status === 'focused'
              ? '◎'
              : '⬡';
  stage.className = `fx-stage active tactical-fx tactical-${event.type === 'heal' ? 'heal' : event.status || 'cleanse'} ${numeric ? 'tactical-numeric' : ''} ${moveClass} from-${side}`;
  stage.style.setProperty('--fx-color', color);
  stage.style.setProperty('--from-x', side === 'player' ? '23%' : '77%');
  stage.style.setProperty('--from-y', side === 'player' ? '68%' : '30%');
  stage.innerHTML = `<div class="fx-source-aura">${Array.from({ length: 4 }, (_, i) => `<i class="fx-ring" style="--ring:${i};--delay:${i * 85}ms"></i>`).join('')}</div><div class="fx-detail">${Array.from({ length: 6 }, (_, i) => `<i style="--detail:${i}"></i>`).join('')}</div><div class="fx-impact">${Array.from(
    { length: 18 },
    (_, i) => {
      const angle = (i / 18) * Math.PI * 2,
        d = 45 + (i % 5) * 13;
      return `<i class="fx-particle" style="--dx:${Math.cos(angle) * d}px;--dy:${Math.sin(angle) * d}px;--delay:${(i % 6) * 30}ms"></i>`;
    }
  ).join('')}<i class="fx-core ${numeric ? 'tactical-number' : ''}">${coreText}</i></div>`;
  ctx.arenaScene?.burst(color, side, event.type === 'heal' ? 1.2 : 0.8);
}

function detonationFx(event) {
  const stage = screen.querySelector('#fx-stage'),
    meta = STATUS_DEFINITIONS[event.status];
  if (!stage || !meta) return;
  stage.classList.add('active', 'detonation-prime');
  stage.style.setProperty('--detonate-color', meta.color);
  stage.querySelectorAll('.detonation-call').forEach((node) => node.remove());
  const call = document.createElement('div');
  call.className = `detonation-call ${event.side}`;
  call.style.setProperty('--detonate-color', meta.color);
  call.innerHTML = `<i>${meta.icon}</i><span><small>${t('battle.chainReaction')}</small><b>${t(`status.${event.status}`)}</b><em>${t('battle.detonation')}</em></span>`;
  stage.append(call);
  ctx.arenaScene?.flash('power', meta.color, event.side);
  ctx.arenaScene?.punch(event.side, 1.15);
  sound.detonate(event.status);
}

function assistFx(event) {
  const stage = screen.querySelector('#fx-stage');
  if (!stage) return;
  const a = AFFINITIES[CREATURES[event.creatureId].affinity],
    call = document.createElement('div');
  call.className = `assist-call ${event.side}`;
  call.style.setProperty('--assist-color', a.color);
  call.innerHTML = `<img src="${sprite(event.creatureId)}" alt=""><span><small>${t('battle.teamAssist')}</small><b>${creatureName(event.creatureId)}</b><em>+8 ${t('battle.surge')}</em></span>`;
  stage.append(call);
  screen.classList.add('assist-mode');
  ctx.arenaScene?.burst(a.color, event.side, 1);
  sound.call(event.creatureId);
  sound.assist(CREATURES[event.creatureId].affinity);
}

function perfectRelayFx(event) {
  const stage = screen.querySelector('#fx-stage'),
    creature = CREATURES[event.creatureId],
    a = AFFINITIES[creature.affinity];
  if (!stage) return;
  stage.className = `fx-stage active perfect-relay-fx from-${event.side}`;
  stage.style.setProperty('--fx-color', a.color);
  stage.style.setProperty('--from-x', event.side === 'player' ? '23%' : '77%');
  stage.style.setProperty('--from-y', event.side === 'player' ? '68%' : '30%');
  stage.innerHTML = `<div class="fx-curtain"></div><div class="relay-sweep"></div><div class="relay-cut"><img src="${sprite(event.creatureId)}" alt=""><span><small>↺ ${t('battle.switchRead')}</small><b>${creatureName(event.creatureId)}</b><em>+6 ${t('battle.surge')}</em></span></div><div class="relay-rings">${Array.from({ length: 5 }, (_, i) => `<i style="--ring:${i}"></i>`).join('')}</div>`;
  screen.classList.add('perfect-relay-mode', `relay-${event.side}`);
  ctx.arenaScene?.flash('hit', a.color, event.side);
  ctx.arenaScene?.burst(a.color, event.side, 1.2);
  sound.guard();
  sound.ui();
}

function relayRushFx(event) {
  const session = ctx.battleSession;
  const stage = screen.querySelector('#fx-stage'),
    creature = sessionIsActive(session) ? activeOf(session.state, event.side) : null;
  if (!stage || !creature) return;
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
  sound.assist(creature.affinity);
  sound.ui();
}

function flowCrescendoFx(event) {
  const session = ctx.battleSession;
  const stage = screen.querySelector('#fx-stage'),
    creature = CREATURES[event.creatureId];
  if (!stage || !creature) return;
  const a = AFFINITIES[creature.affinity],
    call = document.createElement('div'),
    surgeNote = event.surge ? `+${event.surge} ${t('battle.surge')} · ` : '',
    refreshed = (event.refreshed || []).map((id) => t(`move.${id}`)),
    refreshNote = refreshed.length
      ? `${t('battle.flowRefresh')} · ${refreshed.join(' / ')}`
      : t('battle.flowPeak');
  stage.querySelector('.flow-crescendo-call')?.remove();
  call.className = `flow-crescendo-call ${event.side}`;
  call.style.setProperty('--flow-color', a.color);
  call.innerHTML = `<i>↯</i><span><small>${t('battle.flowCrescendo')}</small><b>${creatureName(creature.id)}</b><em>${surgeNote}${refreshNote}</em></span>`;
  stage.append(call);
  screen.classList.add('flow-crescendo-mode');
  ctx.arenaScene?.flash('power', a.color, event.side);
  ctx.arenaScene?.burst(a.color, event.side, 1.25);
  sound.clash();
  setTimeout(
    () => {
      if (!sessionIsActive(session)) return;
      call.remove();
      screen.classList.remove('flow-crescendo-mode');
    },
    ctx.save.reducedMotion ? 220 : Math.max(700, 620 / ctx.save.battleSpeed)
  );
}

function trainerCommandFx(event) {
  const stage = screen.querySelector('#fx-stage'),
    creature = CREATURES[event.creatureId],
    a = AFFINITIES[creature.affinity],
    icons = { balanced: '◇', assault: '⚔', bastion: '⬡', ambush: '◐' };
  if (!stage) return;
  stage.className = `fx-stage active trainer-command-fx command-${event.command}`;
  stage.style.setProperty('--fx-color', a.color);
  stage.innerHTML = `<div class="fx-curtain"></div><div class="command-stripe"><i>${icons[event.command]}</i><span><small>${t('battle.command')}</small><b>${t(`command.${event.command}`)}</b><em>${creatureName(event.creatureId)}</em></span><img src="${sprite(event.creatureId)}" alt=""></div><div class="fx-aftershock"></div>`;
  screen.classList.add('command-mode');
  ctx.arenaScene?.flash('power', a.color, 'player');
  ctx.arenaScene?.burst(a.color, 'player', 1.25);
  sound.clash();
}

function signatureReadyFx(event) {
  const session = ctx.battleSession;
  const stage = screen.querySelector('#fx-stage'),
    creature = sessionIsActive(session) ? activeOf(session.state, event.side) : null,
    signature = creature?.moves.find((id) => MOVES[id].signature);
  if (!stage || !creature || !signature) return;
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
  sound.call(creature.id);
  sound.ui();
  setTimeout(
    () => {
      if (sessionIsActive(session)) call.remove();
    },
    (ctx.save.reducedMotion ? 180 : 900) / ctx.save.battleSpeed
  );
}

function finalDuelFx(event) {
  const stage = screen.querySelector('#fx-stage'),
    player = CREATURES[event.playerCreatureId],
    enemy = CREATURES[event.enemyCreatureId];
  if (!stage) return;
  stage.className = 'fx-stage active final-duel-fx';
  stage.style.setProperty('--player-color', AFFINITIES[player.affinity].color);
  stage.style.setProperty('--enemy-color', AFFINITIES[enemy.affinity].color);
  stage.innerHTML = `<div class="duel-half player"><img src="${sprite(player.id)}" alt=""><b>${creatureName(player.id)}</b></div><div class="duel-center"><i>⚔</i><strong>${t('battle.finalDuel')}</strong><small>+12 ${t('battle.surge')}</small></div><div class="duel-half enemy"><img src="${sprite(enemy.id)}" alt=""><b>${creatureName(enemy.id)}</b></div>`;
  screen.classList.add('final-duel-mode');
  ctx.arenaScene?.flash('power', '#fff09a', 'enemy');
  ctx.arenaScene?.burst(AFFINITIES[player.affinity].color, 'player', 1.6);
  ctx.arenaScene?.burst(AFFINITIES[enemy.affinity].color, 'enemy', 1.6);
  sound.clash();
}

function resonanceFx(event) {
  const stage = screen.querySelector('#fx-stage'),
    a = AFFINITIES[event.affinity];
  if (!stage) return;
  stage.className = `fx-stage active resonance-fx resonance-${event.affinity} from-${event.side}`;
  stage.style.setProperty('--fx-color', a.color);
  stage.style.setProperty('--from-x', event.side === 'player' ? '23%' : '77%');
  stage.style.setProperty('--from-y', event.side === 'player' ? '68%' : '30%');
  stage.innerHTML = `<div class="fx-curtain"></div><div class="resonance-sigil"><i>${a.icon}</i><b>${t('battle.resonance')}</b><span>${creatureName(event.creatureId)}</span></div><div class="fx-source-aura">${Array.from({ length: 5 }, (_, i) => `<i class="fx-ring" style="--ring:${i};--delay:${i * 55}ms"></i>`).join('')}</div>`;
  screen.classList.add('resonance-mode');
  ctx.arenaScene?.burst(a.color, event.side, 1.3);
  sound.resonance(event.affinity);
}

function aceFx(event) {
  const stage = screen.querySelector('#fx-stage'),
    creature = CREATURES[event.creatureId],
    a = AFFINITIES[creature.affinity];
  if (!stage) return;
  stage.className = `fx-stage active ace-phase ace-${event.ace}`;
  stage.style.setProperty('--fx-color', a.color);
  stage.innerHTML = `<div class="fx-curtain"></div><div class="ace-crown">♛</div><div class="ace-reveal"><span>${t('ace.reveal')}</span><img src="${sprite(event.creatureId)}" alt=""><small>${creatureName(event.creatureId)}</small><b>${t(`ace.${event.ace}`)}</b><em>${t(`ace.effect.${event.ace}`)}</em></div><div class="fx-aftershock"></div>`;
  screen.classList.add('ace-mode');
  ctx.arenaScene?.flash('power', a.color, 'enemy');
  ctx.arenaScene?.burst(a.color, 'enemy', 1.7);
  ctx.arenaScene?.punch('enemy', 1.3);
  sound.clash();
}

function statusTickFx(event) {
  const stage = screen.querySelector('#fx-stage');
  if (!stage) return;
  const meta = STATUS_DEFINITIONS[event.status],
    side = event.side;
  stage.className = `fx-stage active status-tick-fx status-${event.status} from-${side}`;
  stage.style.setProperty('--fx-color', meta?.color || '#fff');
  stage.style.setProperty('--from-x', side === 'player' ? '23%' : '77%');
  stage.style.setProperty('--from-y', side === 'player' ? '68%' : '30%');
  stage.innerHTML = `<div class="fx-curtain"></div><div class="fx-impact">${Array.from(
    { length: 24 },
    (_, i) => {
      const a = (i / 24) * Math.PI * 2,
        d = 45 + (i % 7) * 12;
      return `<i class="fx-particle" style="--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;--delay:${(i % 6) * 24}ms"></i>`;
    }
  ).join('')}<i class="fx-core damage-number">−${event.amount}</i></div>`;
  ctx.arenaScene?.burst(meta?.color || '#fff', side, 0.8);
}

function arenaPulseFx(event) {
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
    color = colors[event.arena] || '#fff';
  stage.className = `fx-stage active arena-pulse-fx arena-pulse-${event.arena}`;
  stage.style.setProperty('--fx-color', color);
  stage.innerHTML = `<div class="fx-curtain"></div><div class="arena-pulse-rune"><b>${icons[event.arena]}</b><i></i><span>${t(`arena.${event.arena}`)}</span></div><div class="fx-aftershock"></div>`;
  screen.classList.add('arena-awake');
  ctx.arenaScene?.flash('power', color, 'enemy');
  ctx.arenaScene?.burst(color, 'player', 1.4);
  ctx.arenaScene?.burst(color, 'enemy', 1.4);
  sound.guard();
}

async function signatureClashIntro(events) {
  const session = ctx.battleSession;
  const signatures = events.filter((event) => event.type === 'move-start' && MOVES[event.moveId]?.signature);
  if (signatures.length < 2 || testAnimationScale === 0 || !sessionIsActive(session)) return;
  const stage = screen.querySelector('#fx-stage'),
    left = signatures.find((x) => x.side === 'player'),
    right = signatures.find((x) => x.side === 'enemy');
  if (!stage || !left || !right) return;
  stage.className = 'fx-stage active signature-clash';
  stage.innerHTML = `<div class="clash-half player"><img src="${sprite(left.creatureId)}" alt=""><b>${t(`move.${left.moveId}`)}</b></div><div class="clash-bolt">VS</div><div class="clash-half enemy"><img src="${sprite(right.creatureId)}" alt=""><b>${t(`move.${right.moveId}`)}</b></div>`;
  screen.classList.add('clash-mode');
  session.lastLine = t('battle.signatureClash');
  screen.querySelector('#action-line').textContent = session.lastLine;
  sound.clash();
  await wait((ctx.save.reducedMotion ? 260 : 1050) / ctx.save.battleSpeed);
  if (!sessionIsActive(session)) return;
  clearBattleFx();
}

function clearBattleFx() {
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
    'rally-beat',
    'assist-mode',
    'resonance-mode',
    'perfect-relay-mode',
    'relay-rush-mode',
    'flow-crescendo-mode',
    'relay-player',
    'relay-enemy',
    'final-duel-mode',
    'command-mode',
    'ace-mode',
    'finisher-mode',
    'ko-shock'
  );
  screen.querySelectorAll('.fighter').forEach((fighter) => {
    fighter.className = fighter.classList.contains('enemy') ? 'fighter enemy' : 'fighter player';
  });
  screen.querySelector('#action-line')?.classList.remove('epic');
  ctx.currentFxMove = null;
}

registerRoutes({
  beginMoveFx,
  impactMoveFx,
  effectivenessCalloutFx,
  tacticalFx,
  detonationFx,
  assistFx,
  perfectRelayFx,
  relayRushFx,
  flowCrescendoFx,
  trainerCommandFx,
  signatureReadyFx,
  finalDuelFx,
  resonanceFx,
  aceFx,
  statusTickFx,
  arenaPulseFx,
  signatureClashIntro,
  clearBattleFx,
});
