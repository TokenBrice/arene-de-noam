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
  comboSetupStatus,
  sortStatusIds,
  statusBadgeHtml,
  statusIcon,
  t,
  sprite,
  creatureName,
  affinity,
  affinityName,
  affinityIcon,
  escapeHtml,
} = ctx;
const { moveArchetype } = route;

function polarityLabel(meta) {
  return `${meta.positive ? '▲' : '▼'} ${t(
    meta.positive ? 'status.polarity.positive' : 'status.polarity.negative'
  )}`;
}

function moveStatusBadgesHtml(move) {
  const comboStatus = comboSetupStatus(move),
    ids = sortStatusIds([
      ...(move.selfStatuses || []).map(({ id }) => id),
      ...(move.targetStatuses || []).map(({ id }) => id),
      ...(comboStatus ? [comboStatus] : []),
    ]);
  return ids.length
    ? `<span class="move-status-badges">${[...new Set(ids)]
        .map((id) => statusBadgeHtml(id, { label: escapeHtml(t(`status.${id}`)), compact: true }))
        .join('')}</span>`
    : '';
}

function plannedEnemyAction() {
  const session = ctx.battleSession,
    state = session?.state;
  if (!session || !state || state.phase !== 'choice' || session.mode === 'tutorial') return null;
  if (session.enemyPlanCache?.state === state) return session.enemyPlanCache.action;
  // Test-only hook: force one move, or a comma-separated move sequence.
  const forcedMoves = (ctx.params.get('enemyMove') || '').split(',').filter(Boolean),
    forcedIndex = session.forcedEnemyMoveCount || 0,
    forcedMove = forcedMoves[forcedIndex];
  if (forcedMove) {
    const legal = getLegalActions(state, 'enemy').find(
      (option) => option.type === 'move' && option.moveId === forcedMove
    );
    if (legal) {
      session.forcedEnemyMoveCount = forcedIndex + 1;
      session.enemyPlanCache = { state, action: legal };
      return legal;
    }
  }
  // Non-champion battles historically spend one seeded scouting choice while
  // presenting the forecast. Keep that cadence, then lock the committed plan
  // so every HUD consumer and resolveTurn see the exact same action.
  if (session.difficulty !== 'champion')
    chooseAiAction(state, 'enemy', session.difficulty || 'apprentice', session.style);
  const action = chooseAiAction(state, 'enemy', session.difficulty || 'apprentice', session.style);
  session.enemyPlanCache = { state, action };
  return action;
}

function enemyIntentHtml() {
  const state = ctx.battleSession.state;
  if (ctx.locked || state.phase !== 'choice' || ctx.battleSession.mode === 'tutorial') return '';
  const level = ctx.battleSession.difficulty || 'apprentice';
  if (level !== 'apprentice')
    return `<div class="intent-read hidden"><span>◉ ${t('battle.intent')}</span><b>${t('battle.intentHidden')}</b></div>`;
  const action = plannedEnemyAction();
  if (!action) return '';
  let icon = '↺',
    detail = t('battle.intentSwitch');
  if (action.type === 'move') {
    const move = MOVES[action.moveId],
      forecast = ctx.save.expertMode ? previewMove(state, 'enemy', action.moveId) : null;
    icon = move.signature ? '☄' : move.kind === 'damage' ? '⚔' : '✦';
    if (!ctx.save.expertMode) {
      detail = move.signature
        ? t('battle.intentSignature')
        : move.kind === 'damage'
          ? t('battle.intentAttack')
          : t('battle.intentTactic');
      return `<div class="intent-read simple-intent"><span>${icon}</span><b>${detail}</b></div>`;
    }
    detail = `${t(`move.${action.moveId}`)}${forecast ? ` · ${forecast.miss ? t('battle.previewMiss') : t('battle.intentDamage', { damage: forecast.damage })}` : ''}`;
  }
  if (action.type === 'switch')
    detail = ctx.save.expertMode
      ? t('battle.intentSwitchTo', { name: creatureName(state.sides.enemy.team[action.index].id) })
      : t('battle.intentSwitch');
  if (!ctx.save.expertMode)
    return `<div class="intent-read simple-intent"><span>${icon}</span><b>${detail}</b></div>`;
  return `<div class="intent-read"><span>${icon} ${t('battle.intent')}</span><b>${detail}</b></div>`;
}

function enemyPlan() {
  if (
    ctx.locked ||
    ctx.battleSession.state.phase !== 'choice' ||
    ctx.battleSession.mode === 'tutorial' ||
    ctx.battleSession.difficulty !== 'apprentice'
  )
    return null;
  return plannedEnemyAction();
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

function hudHtml(side, expertMode = Boolean(ctx.save.expertMode)) {
  const state = ctx.battleSession.state,
    owner = state.sides[side],
    c = activeOf(state, side),
    a = AFFINITIES[c.affinity],
    ratio = c.hp / c.maxHp,
    surge = owner.surge,
    cost = signatureCostFor(c),
    passive = PASSIVES[c.passive],
    rank = side === 'player' ? masteryRank(ctx.save.mastery[c.id] || 0) : 0;
  const statusEntries = [
      ...(c.barrier
        ? [
            {
              id: 'barrier',
              icon: '⬡',
              color: '#73eaff',
              label: t('battle.barrier', { amount: c.barrier }),
            },
          ]
        : []),
      ...sortStatusIds(Object.keys(c.statuses)).map((id) => {
        const meta = STATUS_DEFINITIONS[id],
          status = c.statuses[id];
        return {
          id,
          icon: statusIcon(id),
          color: meta.color,
          iconKey: meta.iconKey,
          positive: meta.positive,
          lightInk: meta.lightInk,
          stacks: status.stacks || 1,
          label: `${t(`status.${id}`)}${status.stacks > 1 ? ` ×${status.stacks}` : ''}${status.remaining ? ` · ${status.remaining}` : ''}`,
        };
      }),
    ],
    statusLimit = expertMode ? 4 : 2,
    visibleStatuses = statusEntries.slice(0, statusLimit),
    overflow = Math.max(0, statusEntries.length - visibleStatuses.length),
    visibleStatusLabel = (entry) =>
      expertMode
        ? entry.label
        : `${entry.id === 'barrier' ? t('battle.barrierName') : t(`status.${entry.id}`)}${entry.stacks > 1 ? ` ×${entry.stacks}` : ''}`,
    stateText = [
      passive ? `${passive.icon} ${t(`passive.${c.passive}`)}` : '',
      ...visibleStatuses.map(visibleStatusLabel),
    ]
      .filter(Boolean)
      .join(' · ');
  const gaugeLabel = t(expertMode ? 'battle.surge' : 'battle.sigGauge');
  return `<button type="button" class="battle-plate-toggle" data-plate-side="${side}" aria-expanded="false" aria-label="${escapeHtml(t('battle.plateOpen', { name: creatureName(c.id) }))}"><span class="plate-line plate-primary"><strong>${creatureName(c.id)}${rank ? ` <i class="battle-rank">${'★'.repeat(rank)}</i>` : ''}</strong><i class="affinity-dot" style="--affinity-color:${a.color}">${affinityIcon(c.affinity)}</i><b class="plate-hp-number">${c.hp}/${c.maxHp}</b><span class="team-dots">${teamPipsHtml(owner)}</span></span><span class="plate-line plate-meters"><span class="hp-track"><i class="hp-fill ${ratio < 0.3 ? 'low' : ''}" style="width:${Math.max(0, ratio * 100)}%"></i>${c.barrier ? `<i class="barrier-fill" style="width:${Math.min(100, (c.barrier / c.maxHp) * 100)}%"></i>` : ''}</span><span class="surge-row ${surge >= cost ? 'ready' : ''}" title="${escapeHtml(`${gaugeLabel} ${surge}/${cost}`)}"><span class="surge-caption">${gaugeLabel}</span><span class="surge-track"><i style="width:${surge}%"></i></span><b class="plate-surge-number">✦ ${surge}/${cost}</b></span><span class="plate-statuses">${visibleStatuses.map((entry) => (entry.id === 'barrier' ? `<i class="plate-status status-barrier" style="--status-color:${entry.color}" title="${escapeHtml(visibleStatusLabel(entry))}">${entry.icon}</i>` : `<i class="plate-status status-${entry.id} ${entry.positive ? 'positive' : 'negative'}${entry.lightInk ? ' light-ink' : ''}" data-status="${entry.id}" data-icon="${entry.iconKey}" data-polarity="${entry.positive ? 'positive' : 'negative'}" style="--status-color:${entry.color}" title="${escapeHtml(visibleStatusLabel(entry))}">${entry.icon}</i>`)).join('')}${overflow ? `<b class="plate-status-more">+${overflow}</b>` : ''}</span></span><span class="plate-state-text">${escapeHtml(stateText)}</span></button>${side === 'enemy' ? enemyIntentHtml() : ''}`;
}

function hudDetailHtml(side) {
  const state = ctx.battleSession.state,
    owner = state.sides[side],
    c = activeOf(state, side),
    passive = PASSIVES[c.passive],
    statusItems = [
      ...(c.barrier
        ? [
            `<div class="plate-detail-status barrier"><i>⬡</i><span><b>${t('battle.barrier', { amount: c.barrier })}</b></span></div>`,
          ]
        : []),
      ...sortStatusIds(Object.keys(c.statuses)).map((id) => {
        const meta = STATUS_DEFINITIONS[id],
          status = c.statuses[id],
          helper = status.sourceCreatureId;
        return `<div class="plate-detail-status ${meta.positive ? 'positive' : 'negative'}${meta.lightInk ? ' light-ink' : ''}" data-status="${id}" data-icon="${meta.iconKey}" data-polarity="${meta.positive ? 'positive' : 'negative'}" style="--status-color:${meta.color}"><i>${statusIcon(id)}</i><span><em class="status-polarity-label">${polarityLabel(meta)}</em><b>${t(`status.${id}`)}${status.stacks > 1 ? ` ×${status.stacks}` : ''}${status.remaining ? ` · ${status.remaining}` : ''}</b><small>${t(`status.effect.${id}`)}${helper ? ` · ${t('battle.preparedBy', { helper: creatureName(helper) })}` : ''}</small></span></div>`;
      }),
    ];
  if (!ctx.save.expertMode) {
    const compactStatusItems = [
        ...(c.barrier
          ? [
              `<div class="plate-detail-status barrier"><i>⬡</i><span><b>${t('battle.barrierName')}</b></span></div>`,
            ]
          : []),
        ...sortStatusIds(Object.keys(c.statuses)).map((id) => {
          const meta = STATUS_DEFINITIONS[id],
            status = c.statuses[id];
          return `<div class="plate-detail-status ${meta.positive ? 'positive' : 'negative'}${meta.lightInk ? ' light-ink' : ''}" data-status="${id}" data-icon="${meta.iconKey}" data-polarity="${meta.positive ? 'positive' : 'negative'}" style="--status-color:${meta.color}"><i>${statusIcon(id)}</i><span><em class="status-polarity-label">${polarityLabel(meta)}</em><b>${t(`status.${id}`)}${status.stacks > 1 ? ` ×${status.stacks}` : ''}</b></span></div>`;
        }),
      ],
      compact = compactStatusItems.slice(0, 2).join(''),
      extra = Math.max(0, compactStatusItems.length - 2);
    return `<article class="plate-detail-talent"><span>${passive.icon}</span><div><small>${t('battle.talent')}</small><b>${t(`passive.${c.passive}`)}</b></div></article><div class="plate-detail-statuses compact">${compact || `<p>${t('battle.noStatuses')}</p>`}${extra ? `<b>+${extra}</b>` : ''}</div>${side === 'enemy' ? `<div class="plate-detail-intent">${enemyIntentHtml()}</div>` : ''}`;
  }
  return `<article class="plate-detail-talent"><span>${passive.icon}</span><div><small>${t('battle.talent')}</small><b>${t(`passive.${c.passive}`)}</b><p>${t(`passive.effect.${c.passive}`)}</p></div></article><div class="plate-detail-statuses">${statusItems.join('') || `<p>${t('battle.noStatuses')}</p>`}</div>${side === 'enemy' ? `<div class="plate-detail-intent">${enemyIntentHtml()}</div>` : ''}`;
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
  if (mult > 1) {
    label = t('battle.effective');
    cls = 'good';
  }
  if (mult < 1) {
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
    ctx.battleSession.tutorialStep >= 4 ||
    (ctx.battleSession.tutorialStep === 0 && moveId === 'lucid_arc') ||
    (ctx.battleSession.tutorialStep === 1 && moveId === 'slowing_riddle') ||
    (ctx.battleSession.tutorialStep === 2 && moveId === 'oracle_veil');
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
  const dominant = preview?.damage
      ? `<b>⚔ ${preview.damage}</b>`
      : `<b>${move.kind === 'heal' ? '✚' : '✦'} ${t(move.kind === 'heal' ? 'battle.moveRoleHeal' : 'battle.moveRoleTactic')}</b>`,
    badges = [
      ...(cd || move.cooldown ? [`<span class="move-badge">⌛ ${cd || move.cooldown}</span>`] : []),
      ...(move.signature ? [`<span class="move-badge signature-cost">✦ ${cost}</span>`] : []),
    ].slice(0, 2);
  const comboBadge = preview?.combo
    ? `<span class="combo-ready move-combo-badge">COMBO +40%${ctx.save.expertMode && preview.helperId ? ` · ${creatureName(preview.helperId)}` : ''}</span>`
    : '';
  const advancedClasses = ctx.save.expertMode
      ? `${move.hits > 1 ? 'multi-hit' : ''} ${move.drain ? 'drain-move' : ''} ${move.priority > 0 ? 'priority-move' : ''}`
      : '',
    context = `<span class="move-context-source" hidden><span class="move-effect">${t(`move.effect.${moveId}`)}${moveStatusBadgesHtml(move)}</span><span class="move-tags">${preview ? `<span class="tag damage-preview ${preview.lethal ? 'lethal' : ''} ${preview.miss ? 'miss' : ''}">${preview.miss ? '≋' : preview.lethal ? '☠' : '⚔'} ${preview.miss ? t('battle.previewMiss') : t('battle.preview', { damage: preview.damage })}${preview.absorbed ? ` · ⬡${preview.absorbed}` : ''}</span>${preview.combo ? `<span class="tag combo-ready">COMBO +40%</span>` : ''}${preview.helperId ? `<span class="tag combo-helper-detail">${t('battle.preparedBy', { helper: creatureName(preview.helperId) })}</span>` : ''}` : ''}<span class="tag">${affinityIcon(move.affinity)} ${affinityName(move.affinity)}</span><span class="tag ${order ? `order-${order}` : ''}">${speedLabel}</span><span class="tag">${cooldownLabel}</span>${move.signature ? `<span class="tag signature-cost">${signatureLabel}</span>` : ''}${move.power ? `<span class="tag effect-label ${cls}">${label}</span>` : ''}</span></span>`;
  if (ctx.save.expertMode)
    return `<button type="button" class="move-btn kind-${move.kind} ${advancedClasses} ${move.signature ? 'signature-move' : ''} ${move.signature && !legal ? 'signature-locked' : ''}" data-move="${moveId}" style="--move-color:${a.color}" ${!legal || ctx.locked || !tutorialAllowed ? 'disabled' : ''}><span class="move-archetype" aria-hidden="true">${archetype}</span><span class="move-name">${move.signature ? '<i class="move-signature-mark">✦</i> ' : ''}<i class="move-index">${index + 1}.</i> <span class="move-label">${t(`move.${moveId}`)}</span></span><span class="move-figure">${dominant}${comboBadge}<span class="move-badges">${badges.join('')}</span></span>${context}</button>`;
  const effectiveness =
      mult > 1
        ? `<strong class="move-effectiveness effective">▲ ${t('battle.effective')}</strong>`
        : mult < 1
          ? `<strong class="move-effectiveness not-effective">▼ ${t('battle.notEffective')}</strong>`
          : '',
    signatureState = move.signature
      ? `<span class="simple-signature-state ${owner.surge >= cost ? 'ready' : ''}">${owner.surge >= cost ? t('battle.sigReady') : `✦ ${owner.surge}/${cost}`}</span>`
      : '',
    cooldownState = cd ? `<span class="move-badge simple-cooldown">⌛ ${cd}</span>` : '',
    comboState = preview?.combo ? `<span class="combo-ready move-combo-badge">COMBO +40%</span>` : '';
  return `<button type="button" class="move-btn simple-move kind-${move.kind} ${move.signature ? 'signature-move' : ''} ${move.signature && !legal ? 'signature-locked' : ''}" data-move="${moveId}" style="--move-color:${a.color}" ${!legal || ctx.locked || !tutorialAllowed ? 'disabled' : ''}><span class="move-name"><i class="move-index">${index + 1}.</i> <span class="move-label">${t(`move.${moveId}`)}</span></span><span class="simple-affinity" aria-hidden="true">${affinityIcon(move.affinity)}</span><span class="move-figure">${effectiveness}${signatureState}${cooldownState}${comboState}</span></button>`;
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

registerRoutes({
  enemyIntentHtml,
  plannedEnemyAction,
  enemyPlan,
  teamPipsHtml,
  hudHtml,
  hudDetailHtml,
  moveButton,
  exchangeForecastHtml,
});
