import { ctx, registerRoutes, route } from '../app/context.js';

const {
  CREATURES,
  MOVES,
  activeOf,
  STATUS_DEFINITIONS,
  testAnimationScale,
  t,
  screen,
  sound,
  LOG_EVENT_TYPES,
  creatureName,
  affinity,
  affinityName,
  wait,
} = ctx;
const {
  refreshBattle,
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
} = route;

function sessionIsActive(session) {
  return Boolean(
    session &&
    ctx.battleSession === session &&
    !session.cancelled &&
    screen.classList.contains('battle-screen')
  );
}

function eventPresentationDelay(event) {
  if (testAnimationScale === 0) return 1;
  if (ctx.save.reducedMotion) return 190 / ctx.save.battleSpeed;
  if (event.type === 'move-start')
    return (
      (MOVES[event.moveId]?.signature ? 780 : (MOVES[event.moveId]?.power || 0) >= 46 ? 580 : 430) /
      ctx.save.battleSpeed
    );
  if (event.type === 'trainer-command') return 760 / ctx.save.battleSpeed;
  if (event.type === 'damage')
    return (
      (event.hp <= 0 ? 900 : event.affinity !== 1 ? 700 : ctx.currentFxMove?.strong ? 620 : 430) /
      ctx.save.battleSpeed
    );
  if (event.type === 'arena-pulse') return 760 / ctx.save.battleSpeed;
  if (event.type === 'rally') return 620 / ctx.save.battleSpeed;
  if (event.type === 'surge')
    return (
      (event.source === 'switch' && event.amount >= 24 ? 650 : event.ready ? 760 : 100) / ctx.save.battleSpeed
    );
  if (event.type === 'assist') return 480 / ctx.save.battleSpeed;
  if (event.type === 'perfect-relay') return 620 / ctx.save.battleSpeed;
  if (event.type === 'final-duel') return 1050 / ctx.save.battleSpeed;
  if (event.type === 'resonance') return 560 / ctx.save.battleSpeed;
  if (event.type === 'flow') return (event.count === 3 ? 620 : 220) / ctx.save.battleSpeed;
  if (event.type === 'ace') return 1050 / ctx.save.battleSpeed;
  if (event.type === 'ko') return 700 / ctx.save.battleSpeed;
  if (['heal', 'status', 'barrier', 'barrier-hit', 'miss', 'recoil', 'status-tick'].includes(event.type))
    return 460 / ctx.save.battleSpeed;
  return 300 / ctx.save.battleSpeed;
}

async function playEvents(events) {
  const session = ctx.battleSession;
  if (!sessionIsActive(session)) return;
  refreshBattle();
  await signatureClashIntro(events);
  if (!sessionIsActive(session)) return;
  for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
    const event = events[eventIndex];
    while (document.hidden) {
      await wait(150);
      if (!sessionIsActive(session)) return;
    }
    if (!sessionIsActive(session)) return;
    const actorSide = event.side;
    const fighter = screen.querySelector(`#fighter-${actorSide}`);
    if (event.type === 'trainer-command') {
      session.lastLine = t('battle.commandLine', { command: t(`command.${event.command}`) });
      trainerCommandFx(event);
    }
    if (event.type === 'move-start') {
      session.lastLine = t('battle.action.move', {
        actor: creatureName(event.creatureId),
        move: t(`move.${event.moveId}`),
      });
      beginMoveFx(event);
      fighter?.classList.add('attacking');
      sound.call(event.creatureId);
      sound.move(MOVES[event.moveId]);
    }
    if (event.type === 'assist') {
      session.lastLine = t('battle.assist', {
        helper: creatureName(event.creatureId),
        actor: creatureName(event.attackerId),
      });
      assistFx(event);
    }
    if (event.type === 'perfect-relay') {
      session.lastLine = t('battle.perfectRelay', { actor: creatureName(event.creatureId) });
      perfectRelayFx(event);
    }
    if (event.type === 'final-duel') {
      session.lastLine = t('battle.finalDuelLine');
      finalDuelFx(event);
    }
    if (event.type === 'flow') {
      const refreshed = Boolean(event.refreshed?.length),
        flowLine =
          event.count === 3
            ? refreshed
              ? event.surge
                ? 'battle.flowCrescendoLine'
                : 'battle.flowCrescendoCappedLine'
              : event.surge
                ? 'battle.flowPeakLine'
                : 'battle.flowPeakCappedLine'
            : 'battle.flowLine';
      session.lastLine = t(flowLine, { count: event.count, surge: event.surge });
      screen.querySelector(`#hud-${event.side}`)?.classList.add('flow-flash');
      if (event.count === 3) flowCrescendoFx(event);
      else sound.ui();
    }
    if (event.type === 'damage') {
      const affinityNote =
        event.affinity === 1.5
          ? `↑ ${t('battle.effective')} · `
          : event.affinity === 0.75
            ? `↓ ${t('battle.resisted')} · `
            : '';
      session.lastLine = `${affinityNote}${event.combo?.length ? `${t('battle.combo')} · ` : ''}${t('battle.action.damage', { target: creatureName(event.creatureId), amount: event.amount })}${event.hits > 1 ? ` · ${t('battle.hit', { hit: event.hit, hits: event.hits })}` : ''}`;
      fighter?.classList.add('hit');
      impactMoveFx(event);
      effectivenessCalloutFx(event);
      sound.impact(MOVES[ctx.currentFxMove?.moveId], event);
    }
    if (event.type === 'heal') {
      session.lastLine = t('battle.action.heal', {
        actor: creatureName(event.creatureId),
        amount: event.amount,
      });
      tacticalFx(event);
      sound.heal();
    }
    if (event.type === 'status') {
      session.lastLine = event.detonated
        ? t('battle.detonate', { status: t(`status.${event.status}`) })
        : event.applied
          ? t('battle.action.status', {
              actor: creatureName(event.creatureId),
              status: t(`status.${event.status}`),
            })
          : t('battle.action.cleanse', {
              actor: creatureName(event.creatureId),
              status: t(`status.${event.status}`),
            });
      if (event.detonated) {
        screen.classList.add('combo-hit');
        detonationFx(event);
        ctx.arenaScene?.burst(STATUS_DEFINITIONS[event.status]?.color || '#fff', event.side, 1.35);
      } else {
        tacticalFx(event);
        sound.guard();
      }
    }
    if (event.type === 'barrier') {
      session.lastLine = t('battle.action.barrier', {
        actor: creatureName(event.creatureId),
        amount: event.amount,
      });
      tacticalFx({ ...event, status: 'guarded' });
      sound.guard();
    }
    if (event.type === 'barrier-hit') {
      session.lastLine = t('battle.action.absorb', { amount: event.amount });
      fighter?.classList.add('barrier-hit');
      ctx.arenaScene?.flash('hit', '#73eaff', event.side);
      sound.guard();
    }
    if (event.type === 'miss') {
      session.lastLine = t('battle.action.miss', { actor: creatureName(event.creatureId) });
      fighter?.classList.add('dodging');
      sound.ui();
    }
    if (event.type === 'recoil') {
      session.lastLine = t('battle.action.recoil', {
        actor: creatureName(event.creatureId),
        amount: event.amount,
      });
      fighter?.classList.add('hit');
      statusTickFx({ ...event, status: event.source === 'thorns' ? 'thorns' : 'exposed' });
      sound.hit('force');
    }
    if (event.type === 'status-tick') {
      session.lastLine = t('battle.action.tick', {
        actor: creatureName(event.creatureId),
        amount: event.amount,
        status: t(`status.${event.status}`),
      });
      fighter?.classList.add('status-hit');
      statusTickFx(event);
      sound.hit(CREATURES[event.creatureId].affinity);
    }
    if (event.type === 'surge' && event.source === 'switch' && event.amount >= 24) {
      const incoming = activeOf(session.state, event.side);
      session.lastLine = t('battle.relayRushLine', { actor: creatureName(incoming.id) });
      relayRushFx(event);
      screen.querySelector(`#hud-${event.side}`)?.classList.add('surge-flash');
    }
    if (event.type === 'surge' && event.source === 'mastery') {
      session.lastLine = t('battle.masterySpark');
      screen.querySelector(`#hud-${event.side}`)?.classList.add('surge-flash');
      sound.ui();
    }
    if (event.type === 'surge' && event.ready) {
      session.lastLine = t('battle.surgeReady');
      screen.querySelector(`#hud-${event.side}`)?.classList.add('surge-flash');
      signatureReadyFx(event);
    }
    if (event.type === 'arena-pulse') {
      session.lastLine = t('battle.arenaPulse', { arena: t(`arena.${event.arena}`) });
      arenaPulseFx(event);
    }
    if (event.type === 'resonance') {
      session.lastLine = t('battle.resonanceLine', {
        actor: creatureName(event.creatureId),
        affinity: affinityName(event.affinity),
      });
      resonanceFx(event);
    }
    if (event.type === 'ace') {
      session.lastLine = t('battle.ace', {
        actor: creatureName(event.creatureId),
        ace: t(`ace.${event.ace}`),
      });
      aceFx(event);
    }
    if (event.type === 'rally') {
      session.lastLine = t('battle.rally', { actor: creatureName(event.creatureId) });
      tacticalFx({ ...event, status: 'focused' });
      screen.classList.add('rally-beat');
      sound.rally();
    }
    if (event.type === 'passive') {
      session.lastLine = t('battle.passive', {
        actor: creatureName(event.creatureId),
        passive: t(`passive.${event.passive}`),
      });
      tacticalFx({ ...event, status: 'focused' });
      sound.guard();
    }
    if (event.type === 'switch' || event.type === 'replace') {
      session.lastLine = t('battle.action.switch', { actor: creatureName(event.creatureId) });
      sound.ui();
    }
    if (event.type === 'ko') {
      session.lastLine = t('battle.ko', { name: creatureName(event.creatureId) });
      fighter?.classList.add('ko');
      screen.classList.add('ko-shock');
      sound.ko();
    }
    if (event.type === 'battle-end' && event.reason === 'turn-cap') session.lastLine = t('battle.cap');
    if (LOG_EVENT_TYPES.has(event.type)) {
      session.timeline.push({
        type: event.type,
        side: event.side,
        turn: event.turn || session.state.turn,
        text: session.lastLine,
      });
      if (session.timeline.length > 40) session.timeline.shift();
    }
    refreshBattle();
    await wait(eventPresentationDelay(event));
    if (!sessionIsActive(session)) return;
    fighter?.classList.remove('attacking', 'hit', 'ko', 'barrier-hit', 'dodging', 'status-hit');
    const next = events[eventIndex + 1];
    if (
      (event.type === 'damage' &&
        !['damage', 'status', 'barrier-hit', 'passive', 'ko'].includes(next?.type)) ||
      [
        'heal',
        'barrier',
        'miss',
        'recoil',
        'status-tick',
        'arena-pulse',
        'rally',
        'resonance',
        'ace',
        'final-duel',
      ].includes(event.type) ||
      (event.type === 'status' && !['status', 'damage'].includes(next?.type)) ||
      (event.type === 'passive' && !['barrier', 'heal', 'status'].includes(next?.type)) ||
      event.type === 'move-skip' ||
      event.type === 'ko'
    )
      clearBattleFx();
  }
}

registerRoutes({ eventPresentationDelay, playEvents });
