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
  syncBattleAnimationSpeed,
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
  if (event.type === 'status' && event.consumed && event.source === 'combo')
    return 60 / ctx.save.battleSpeed;
  if (event.type === 'move-skip') return 120 / ctx.save.battleSpeed;
  if (event.type === 'move-start')
    return (
      (MOVES[event.moveId]?.signature ? 780 : (MOVES[event.moveId]?.power || 0) >= 46 ? 420 : 300) /
      ctx.save.battleSpeed
    );
  if (event.type === 'trainer-command') return 760 / ctx.save.battleSpeed;
  if (event.type === 'damage')
    return (
      (event.hp <= 0 ? 900 : event.affinity !== 1 ? 700 : ctx.currentFxMove?.strong ? 620 : 300) /
      ctx.save.battleSpeed
    );
  if (event.type === 'arena-pulse') return 760 / ctx.save.battleSpeed;
  if (event.type === 'surge')
    return (
      (event.source === 'switch' && event.amount >= 24 ? 650 : event.ready ? 760 : 60) / ctx.save.battleSpeed
    );
  if (event.type === 'assist') return 480 / ctx.save.battleSpeed;
  if (event.type === 'perfect-relay') return 620 / ctx.save.battleSpeed;
  if (event.type === 'ace') return 1050 / ctx.save.battleSpeed;
  if (event.type === 'ko') return 700 / ctx.save.battleSpeed;
  if (event.type === 'switch' || event.type === 'replace') return 640 / ctx.save.battleSpeed;
  if (
    ['heal', 'status', 'barrier', 'barrier-hit', 'barrier-break', 'miss', 'recoil', 'status-tick'].includes(
      event.type
    )
  )
    return 250 / ctx.save.battleSpeed;
  return 180 / ctx.save.battleSpeed;
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
    if (event.type === 'assist' && event.combo === true) {
      session.lastLine = t('battle.comboCredit', { helper: creatureName(event.creatureId) });
      comboCreditFx(event);
    }
    if (event.type === 'perfect-relay') {
      session.lastLine = t('battle.perfectRelay', { actor: creatureName(event.creatureId) });
      perfectRelayFx(event);
    }
    if (event.type === 'damage') {
      const affinityNote =
        event.affinity > 1
          ? `↑ ${t('battle.effective')} · `
          : event.affinity < 1
            ? `↓ ${t('battle.resisted')} · `
            : '';
      session.lastLine = `${affinityNote}${event.combo ? `${t('battle.combo')} · ` : ''}${t('battle.action.damage', { target: creatureName(event.creatureId), amount: event.amount })}${event.hits > 1 ? ` · ${t('battle.hit', { hit: event.hit, hits: event.hits })}` : ''}`;
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
    if (event.type === 'status' && !(event.consumed && event.source === 'combo')) {
      session.lastLine = event.consumed
        ? t('battle.action.consumed', {
            actor: creatureName(event.creatureId),
            status: t(`status.${event.status}`),
          })
        : event.applied
          ? t('battle.action.status', {
              actor: creatureName(event.creatureId),
              status: t(`status.${event.status}`),
            })
          : t('battle.action.cleanse', {
              actor: creatureName(event.creatureId),
              status: t(`status.${event.status}`),
            });
      tacticalFx(event);
      sound.guard();
    }
    if (event.type === 'barrier') {
      session.lastLine = t('battle.action.barrier', {
        actor: creatureName(event.creatureId),
        amount: event.amount,
      });
      tacticalFx(event);
      sound.guard();
    }
    if (event.type === 'barrier-hit') {
      session.lastLine = t('battle.action.absorb', { amount: event.amount });
      fighter?.classList.add('barrier-hit');
      ctx.arenaScene?.flash('hit', '#73eaff', event.side);
      if (event.total <= 0) {
        // The dome just broke: glass shatter instead of the usual guard hum.
        barrierShatterFx(event);
        sound.shatter();
      } else sound.guard();
    }
    if (event.type === 'barrier-break') {
      session.lastLine = t('battle.action.barrierBreak', {
        actor: creatureName(event.creatureId),
        amount: event.amount,
      });
      fighter?.classList.add('barrier-hit');
      tacticalFx({ ...event, type: 'barrier' });
      if (event.total <= 0) barrierShatterFx(event);
      sound.guard();
    }
    if (event.type === 'miss') {
      session.lastLine = t('battle.action.miss', { actor: creatureName(event.creatureId) });
      fighter?.classList.add('dodging');
      missWhiffFx(event);
      sound.ui();
    }
    if (event.type === 'recoil') {
      session.lastLine = t('battle.action.recoil', {
        actor: creatureName(event.creatureId),
        amount: event.amount,
      });
      fighter?.classList.add('hit');
      statusTickFx({ ...event, status: 'countering' });
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
    if (event.type === 'surge' && event.ready) {
      session.lastLine = t('battle.surgeReady');
      screen.querySelector(`#hud-${event.side}`)?.classList.add('surge-flash');
      signatureReadyFx(event);
    }
    if (event.type === 'arena-pulse') {
      session.lastLine = t('battle.arenaPulse', { arena: t(`arena.${event.arena}`) });
      arenaPulseFx(event);
    }
    if (event.type === 'ace') {
      session.lastLine = t('battle.ace', {
        actor: creatureName(event.creatureId),
        ace: t(`ace.${event.ace}`),
      });
      aceFx(event);
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
      session.lastLine =
        event.source === 'signature'
          ? t('battle.immaculateRelay', { actor: creatureName(event.creatureId) })
          : t('battle.action.switch', { actor: creatureName(event.creatureId) });
      if (event.source === 'signature') immaculateRelayFx(event);
      switchOutFx(event);
      sound.ui();
    }
    if (event.type === 'ko') {
      session.lastLine = t('battle.ko', { name: creatureName(event.creatureId) });
      fighter?.classList.add('ko');
      screen.classList.add('ko-shock');
      faintFx(event);
      sound.call(event.creatureId, { fall: true });
      sound.ko();
    }
    if (event.type === 'move-skip') {
      const skipped = activeOf(session.state, event.side);
      session.lastLine = t('battle.action.skip', { name: creatureName(skipped.id) });
    }
    if (event.type === 'battle-end') {
      session.lastLine =
        event.reason === 'turn-cap'
          ? t('battle.logEnd.cap')
          : event.winner === 'player'
            ? t('battle.logEnd.win')
            : t('battle.logEnd.loss');
    }
    if (LOG_EVENT_TYPES.has(event.type)) {
      const timelineCreature =
        event.creatureId || (event.type === 'move-skip' ? activeOf(session.state, event.side)?.id : null);
      session.timeline.push({
        type: event.type === 'damage' && event.combo ? 'combo' : event.type,
        side: event.side,
        name: timelineCreature ? creatureName(timelineCreature) : null,
        turn: event.turn || session.state.turn,
        text: session.lastLine,
      });
      if (session.timeline.length > 40) session.timeline.shift();
    }
    const switchLeadIn =
      event.type === 'switch' || event.type === 'replace'
        ? (ctx.save.reducedMotion ? 70 : 220) / ctx.save.battleSpeed
        : 0;
    if (switchLeadIn) {
      // Let the outgoing recall read before revealing the already-resolved
      // incoming fighter. The overlap begins near the end of the light beam.
      syncBattleAnimationSpeed();
      await wait(switchLeadIn);
      if (!sessionIsActive(session)) return;
    }
    refreshBattle();
    if (event.type === 'switch' || event.type === 'replace') switchInFx(event);
    syncBattleAnimationSpeed();
    await wait(Math.max(1, eventPresentationDelay(event) - switchLeadIn));
    if (!sessionIsActive(session)) return;
    fighter?.classList.remove('attacking', 'hit', 'ko', 'barrier-hit', 'dodging', 'status-hit', 'entering');
    const next = events[eventIndex + 1];
    if (
      (event.type === 'damage' &&
        !['damage', 'status', 'barrier-hit', 'passive', 'ko'].includes(next?.type)) ||
      ['heal', 'barrier', 'miss', 'recoil', 'status-tick', 'arena-pulse', 'ace'].includes(event.type) ||
      (event.type === 'status' && !['status', 'damage'].includes(next?.type)) ||
      (event.type === 'passive' && !['barrier', 'heal', 'status'].includes(next?.type)) ||
      event.type === 'move-skip' ||
      event.type === 'ko'
    )
      clearBattleFx();
  }
}

registerRoutes({ eventPresentationDelay, playEvents });
