import { ctx, registerRoutes, route } from '../app/context.js';

const {
  AFFINITIES,
  affinityMultiplier,
  MOVES,
  PASSIVES,
  masteryRank,
  activeOf,
  resolveTurn,
  getLegalActions,
  signatureCostFor,
  previewMove,
  previewMoveOrder,
  chooseAiAction,
  effectiveSpeed,
  STATUS_DEFINITIONS,
  t,
  sprite,
  creatureName,
  affinity,
  affinityName,
  escapeHtml,
  bondsHtml,
} = ctx;
const { moveArchetype } = route;

function enemyIntentHtml() {
  const state = ctx.battleSession.state;
  if (ctx.locked || state.phase !== 'choice' || ctx.battleSession.mode === 'tutorial') return '';
  const level = ctx.battleSession.difficulty || 'apprentice';
  if (level === 'champion')
    return `<div class="intent-read hidden"><span>◉ ${t('battle.intent')}</span><b>${t('battle.intentHidden')}</b></div>`;
  const action = chooseAiAction(state, 'enemy', level, ctx.battleSession.style);
  if (!action) return '';
  let icon = '↺',
    detail = t('battle.intentSwitch');
  if (action.type === 'move') {
    const move = MOVES[action.moveId],
      forecast = level === 'apprentice' ? previewMove(state, 'enemy', action.moveId) : null;
    icon = move.signature ? '☄' : move.kind === 'damage' ? '⚔' : '✦';
    detail =
      level === 'apprentice'
        ? `${t(`move.${action.moveId}`)}${forecast ? ` · ${forecast.miss ? t('battle.previewMiss') : t('battle.intentDamage', { damage: forecast.damage })}` : ''}`
        : move.signature
          ? t('battle.intentSignature')
          : move.kind === 'damage'
            ? t('battle.intentAttack')
            : t('battle.intentTactic');
  }
  if (action.type === 'switch' && level === 'apprentice')
    detail = t('battle.intentSwitchTo', { name: creatureName(state.sides.enemy.team[action.index].id) });
  return `<div class="intent-read"><span>${icon} ${t('battle.intent')}</span><b>${detail}</b></div>`;
}

function enemyPlan() {
  if (
    ctx.locked ||
    ctx.battleSession.state.phase !== 'choice' ||
    ctx.battleSession.mode === 'tutorial' ||
    ctx.battleSession.difficulty === 'champion'
  )
    return null;
  return chooseAiAction(
    ctx.battleSession.state,
    'enemy',
    ctx.battleSession.difficulty || 'apprentice',
    ctx.battleSession.style
  );
}

function teamPipsHtml(owner) {
  return owner.team
    .map((creature, index) => {
      const ready =
          creature.hp > 0 &&
          owner.surge >= signatureCostFor(creature) &&
          creature.moves.some((id) => MOVES[id].signature),
        label = `${creatureName(creature.id)} · ${creature.hp}/${creature.maxHp} ${t('battle.hpUnit')}${ready ? ` · ${t('battle.surgeReady')}` : ''}`;
      return `<span class="team-dot ${index === owner.active ? 'active' : ''} ${creature.hp <= 0 ? 'ko' : ''} ${ready ? 'signature-ready' : ''}" style="--team-hp:${Math.max(0, (creature.hp / creature.maxHp) * 100)}" aria-label="${escapeHtml(label)}"><img src="${sprite(creature.id)}" alt=""></span>`;
    })
    .join('');
}

function hudHtml(side) {
  const state = ctx.battleSession.state,
    owner = state.sides[side],
    c = activeOf(state, side),
    a = AFFINITIES[c.affinity],
    ratio = c.hp / c.maxHp,
    surge = owner.surge,
    cost = signatureCostFor(c),
    passive = PASSIVES[c.passive],
    rank = side === 'player' ? masteryRank(ctx.save.mastery[c.id] || 0) : 0;
  return `<div class="hud-title"><strong>${creatureName(c.id)}${rank ? ` <i class="battle-rank">${'★'.repeat(rank)}</i>` : ''}</strong><span class="affinity-dot" style="background:${a.color}">${a.icon}</span><span class="talent-chip" title="${escapeHtml(t(`passive.effect.${c.passive}`))}">${passive.icon} ${t(`passive.${c.passive}`)}</span><div class="team-dots">${teamPipsHtml(owner)}</div></div><div class="hp-row"><div class="hp-track"><div class="hp-fill ${ratio < 0.3 ? 'low' : ''}" style="width:${Math.max(0, ratio * 100)}%"></div>${c.barrier ? `<div class="barrier-fill" style="width:${Math.min(100, (c.barrier / c.maxHp) * 100)}%"></div>` : ''}</div><span class="hp-value">${c.hp}/${c.maxHp}${c.barrier ? ` <b>+${c.barrier}</b>` : ''}</span></div><div class="surge-row ${surge >= cost ? 'ready' : ''}"><span>✦ ${t('battle.surge')}</span><div class="surge-track"><i style="width:${surge}%"></i></div><b>${surge}/${cost}</b></div>${bondsHtml(
    owner.team.map((x) => x.id),
    true
  )}<div class="status-row">${c.barrier ? `<span class="status-chip positive">⬡ ${t('battle.barrier', { amount: c.barrier })}</span>` : ''}${Object.keys(
    c.statuses
  )
    .map((id) => {
      const meta = STATUS_DEFINITIONS[id],
        helper = c.statuses[id].sourceCreatureId;
      return `<span class="status-chip ${meta.positive ? 'positive' : 'negative'} ${helper ? 'team-primed' : ''}" style="--status-color:${meta.color}" ${helper ? `title="${escapeHtml(t('battle.preparedBy', { name: creatureName(helper) }))}"` : ''}>${meta.icon} ${t(`status.${id}`)}${c.statuses[id].stacks > 1 ? ` ×${c.statuses[id].stacks}` : ''}${c.statuses[id].remaining ? ` · ${c.statuses[id].remaining}` : ''}${helper ? ' ↗' : ''}</span>`;
    })
    .join('')}</div>${side === 'enemy' ? enemyIntentHtml() : ''}`;
}

function moveButton(moveId, index) {
  const state = ctx.battleSession.state,
    owner = state.sides.player,
    c = activeOf(state, 'player'),
    enemy = activeOf(state, 'enemy'),
    move = MOVES[moveId],
    a = AFFINITIES[move.affinity],
    cd = c.cooldowns[moveId]?.remaining || 0,
    mult = move.power ? affinityMultiplier(move.affinity, enemy.affinity) : 1;
  let label = t('battle.neutral'),
    cls = '';
  if (mult === 1.5) {
    label = t('battle.effective');
    cls = 'good';
  }
  if (mult === 0.75) {
    label = t('battle.resisted');
    cls = 'risky';
  }
  const plan = ctx.battleSession.difficulty === 'apprentice' ? enemyPlan() : null,
    order = plan?.type === 'move' ? previewMoveOrder(state, 'player', moveId, plan.moveId) : null,
    speedLabel = order
      ? t(`battle.order.${order}`)
      : move.priority > 0
        ? t('battle.priority', { priority: move.priority })
        : `${t('battle.priority', { priority: 0 })} · ${effectiveSpeed(c) >= effectiveSpeed(enemy) ? t('battle.faster') : t('battle.slower')}`;
  const cooldownLabel = cd
    ? t('battle.cooldownLeft', { turns: cd })
    : move.cooldown
      ? t('battle.cooldown', { turns: move.cooldown })
      : t('battle.noCooldown');
  const tutorialAllowed =
    ctx.battleSession.mode !== 'tutorial' ||
    ctx.battleSession.tutorialStep >= 3 ||
    (ctx.battleSession.tutorialStep === 0 && move.kind === 'damage') ||
    (ctx.battleSession.tutorialStep === 1 && moveId === 'oracle_veil');
  const legal = getLegalActions(state, 'player').some(
      (action) => action.type === 'move' && action.moveId === moveId
    ),
    cost = signatureCostFor(c),
    signatureLabel = move.signature
      ? state.sides.player.surge >= cost
        ? t('battle.signatureReady')
        : t('battle.signatureCost', { cost: cost - state.sides.player.surge })
      : '';
  const preview = previewMove(state, 'player', moveId);
  const archetype = moveArchetype(move);
  const flowRoute =
      legal && owner.lastMoveId && owner.lastMoveId !== moveId
        ? { count: Math.min(3, owner.flow + 1), surge: Math.min(3, owner.flow + 1) * 2 }
        : null,
    flowReset = legal && owner.flow > 0 && owner.lastMoveId === moveId;
  return `<button type="button" class="move-btn kind-${move.kind} ${flowRoute ? 'continues-flow' : ''} ${flowReset ? 'breaks-flow' : ''} ${move.hits > 1 ? 'multi-hit' : ''} ${move.drain ? 'drain-move' : ''} ${move.priority > 0 ? 'priority-move' : ''} ${move.signature ? 'signature-move' : ''} ${move.signature && !legal ? 'signature-locked' : ''}" data-move="${moveId}" style="--move-color:${a.color}" ${!legal || ctx.locked || !tutorialAllowed ? 'disabled' : ''}><span class="move-archetype" aria-hidden="true">${archetype}</span><span class="move-name">${move.signature ? '<i>✦</i> ' : ''}${index + 1}. ${t(`move.${moveId}`)}</span><span class="move-effect">${t(`move.effect.${moveId}`)}</span><span class="move-tags">${flowRoute ? `<span class="tag flow-route">${t('battle.flowGain', { count: flowRoute.count, surge: flowRoute.surge })}</span>` : ''}${flowReset ? `<span class="tag flow-reset">${t('battle.flowReset')}</span>` : ''}${preview ? `<span class="tag damage-preview ${preview.lethal ? 'lethal' : ''} ${preview.miss ? 'miss' : ''}">${preview.miss ? '≋' : preview.lethal ? '☠' : '⚔'} ${preview.miss ? t('battle.previewMiss') : t('battle.preview', { damage: preview.damage })}${preview.absorbed ? ` · ⬡${preview.absorbed}` : ''}</span>${preview.combo.length ? `<span class="tag combo-ready">✦ ${t('battle.comboReady', { count: preview.combo.length })}</span>` : ''}${preview.assists.length ? `<span class="tag team-assist-ready">↗ ${t('battle.assistReady', { name: creatureName(preview.assists[0]) })}</span>` : ''}` : ''}<span class="tag">${a.icon} ${affinityName(move.affinity)}</span><span class="tag ${order ? `order-${order}` : ''}">${speedLabel}</span><span class="tag">${cooldownLabel}</span>${move.signature ? `<span class="tag signature-cost">${signatureLabel}</span>` : ''}${move.power ? `<span class="tag effect-label ${cls}">${label}</span>` : ''}</span></button>`;
}

function exchangeForecastHtml(moveId, enemyAction) {
  const state = ctx.battleSession.state,
    legal = getLegalActions(state, 'player').some(
      (action) => action.type === 'move' && action.moveId === moveId
    );
  if (!enemyAction || !legal) return '';
  try {
    const sum = (owner) => owner.team.reduce((total, c) => total + c.hp, 0),
      beforePlayer = sum(state.sides.player),
      beforeEnemy = sum(state.sides.enemy),
      outcome = resolveTurn(state, { type: 'move', moveId }, enemyAction).state,
      playerChange = sum(outcome.sides.player) - beforePlayer,
      enemyChange = sum(outcome.sides.enemy) - beforeEnemy,
      format = (change) => (change > 0 ? `+${change}` : String(change).replace('-', '−')),
      playerKo = outcome.sides.player.team.every((c) => c.hp <= 0),
      enemyKo = outcome.sides.enemy.team.every((c) => c.hp <= 0);
    return `<span class="tag exchange-preview ${playerKo ? 'self-ko' : ''} ${enemyKo ? 'rival-ko' : ''}" title="${t('battle.exchange')}" data-self-change="${playerChange}" data-rival-change="${enemyChange}"><b>↔</b><span>${t('battle.exchangeYou', { change: format(playerChange) })}</span><span>${t('battle.exchangeRival', { change: format(enemyChange) })}</span></span>`;
  } catch {
    return '';
  }
}

registerRoutes({ enemyIntentHtml, enemyPlan, teamPipsHtml, hudHtml, moveButton, exchangeForecastHtml });
