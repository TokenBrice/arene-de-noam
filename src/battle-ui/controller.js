import { ctx, registerRoutes, route } from '../app/context.js';

const {
  AFFINITIES,
  affinityMultiplier,
  MOVES,
  PASSIVES,
  masteryRank,
  quickRule,
  TRAINERS,
  ARENAS,
  TRIALS,
  GAUNTLET_STAGES,
  circuitMatch,
  createBattle,
  activeOf,
  resolveTurn,
  applyReplacement,
  applyTrainerCommand,
  canUseTrainerCommand,
  getLegalActions,
  signatureCostFor,
  previewIncomingAfterSwitch,
  chooseAiAction,
  STATUS_DEFINITIONS,
  ArenaScene,
  params,
  testAnimationScale,
  t,
  screen,
  sound,
  LADDER_COUNT,
  LOG_TYPE_GROUPS,
  sprite,
  creatureName,
  affinity,
  affinityName,
  actionButton,
  wait,
  persist,
  escapeHtml,
  disposeArena,
  statusVisuals,
  comboRoutesHtml,
} = ctx;
const {
  bindCommon,
  renderTitle,
  enemyPlan,
  plannedEnemyAction,
  hudHtml,
  hudDetailHtml,
  moveButton,
  exchangeForecastHtml,
  tutorialEnemyAction,
  clearBattleFx,
  playEvents,
  completeTutorial,
  finishBattle,
} = route;

let battleSessionSequence = 0;

function sessionIsActive(session) {
  return Boolean(
    session &&
    ctx.battleSession === session &&
    !session.cancelled &&
    screen.classList.contains('battle-screen')
  );
}

function cancelBattleSession(session) {
  if (session) session.cancelled = true;
  ctx.locked = false;
  clearBattleFx();
}

function startBattle(config) {
  ctx.previousScreen = 'selection';
  const seed = Number(params.get('seed')) || Math.floor(Date.now() / 1000);
  const state = createBattle({
    playerTeam: config.playerTeam,
    enemyTeam: config.enemyTeam,
    playerLead: config.playerLead,
    enemyLead: config.enemyLead,
    seed,
    mode: config.mode,
    arena: config.arena,
    modifiers: config.modifiers,
    enemyAce: ['ladder', 'gauntlet', 'circuit'].includes(config.mode)
      ? TRAINERS[config.trainerIndex]?.ace
      : null,
  });
  if (config.playerCondition)
    state.sides.player.team.forEach((creature) => {
      const ratio = config.playerCondition[creature.id];
      if (Number.isFinite(ratio))
        creature.hp = Math.max(1, Math.min(creature.maxHp, Math.round(creature.maxHp * ratio)));
    });
  const testHp = Number(params.get('playerHp'));
  if (Number.isFinite(testHp) && testHp > 0)
    activeOf(state, 'player').hp = Math.min(activeOf(state, 'player').maxHp, Math.round(testHp));
  const testEnemyHp = Number(params.get('enemyHp'));
  if (Number.isFinite(testEnemyHp) && testEnemyHp > 0)
    state.sides.enemy.team.forEach((creature) => {
      creature.hp = Math.min(creature.maxHp, Math.round(testEnemyHp));
    });
  const testTeamHp = Number(params.get('teamHp'));
  if (Number.isFinite(testTeamHp) && testTeamHp > 0)
    state.sides.player.team.forEach((creature) => {
      creature.hp = Math.min(creature.maxHp, Math.round(testTeamHp));
    });
  if (params.get('finalDuel') === '1')
    for (const side of ['player', 'enemy'])
      state.sides[side].team.forEach((creature, index) => {
        if (index !== state.sides[side].active) creature.hp = 0;
      });
  ctx.battleSession = {
    ...config,
    state,
    style: ['ladder', 'gauntlet', 'circuit'].includes(config.mode)
      ? TRAINERS[config.trainerIndex]?.style || 'direct'
      : 'direct',
    lastLine: t('battle.yourTurn'),
    timeline: [],
    tutorialStep: config.tutorialStep ?? null,
    sessionToken: ++battleSessionSequence,
    cancelled: false,
  };
  renderBattle();
}

function renderBattle() {
  disposeArena();
  const session = ctx.battleSession;
  screen.dataset.page = 'battle';
  screen.className = `screen battle-screen ${ctx.save.expertMode ? 'expert-mode' : 'simple-mode'}`;
  const trial =
    ctx.battleSession.mode === 'trial' ? TRIALS.find((x) => x.id === ctx.battleSession.trialId) : null;
  const gauntlet =
    ctx.battleSession.mode === 'gauntlet' ? GAUNTLET_STAGES[ctx.battleSession.gauntletStage] : null;
  const circuit =
    ctx.battleSession.mode === 'circuit' ? circuitMatch(ctx.save.circuitWins, LADDER_COUNT) : null;
  const arenaHeading = trial
      ? `${trial.icon} ${t(trial.nameKey)}`
      : gauntlet
        ? `↟ ${t(gauntlet.nameKey)} · ${ctx.battleSession.gauntletStage + 1}/${GAUNTLET_STAGES.length}`
        : circuit
          ? `${circuit.condition.icon} ${t('circuit.round', { round: circuit.round })}`
          : t(`arena.${ctx.battleSession.arena}`),
    arenaRule = trial
      ? t(trial.descKey)
      : gauntlet
        ? t('gauntlet.battleRule', { boons: ctx.gauntletRun?.boons.length || 0 })
        : circuit
          ? t(`circuit.effect.${circuit.condition.id}`)
          : t(`arena.rule.${ctx.battleSession.arena}`);
  screen.innerHTML = `<canvas id="arena" class="arena-canvas" aria-hidden="true"></canvas><div class="battle-vignette"></div><div class="battle-layout"><section class="battle-info-zone" data-battle-zone="info"><div class="battle-top"><span class="turn-chip" id="turn-chip"></span><div class="arena-nameplate" tabindex="0" title="${escapeHtml(arenaRule)}" aria-label="${escapeHtml(`${arenaHeading} — ${arenaRule}`)}"><b>${arenaHeading}</b><small>${arenaRule}</small></div><div class="battle-tools"><button class="icon-btn" data-action="battle-help" aria-label="${t('battle.codex')}">?</button><button class="icon-btn" data-action="battle-speed" aria-pressed="${ctx.save.battleSpeed === 2}">×${ctx.save.battleSpeed}</button><button class="icon-btn" data-action="toggle-mute" aria-label="${t('settings.mute')}">${ctx.save.muted ? '🔇' : '🔊'}</button><button class="icon-btn" data-action="battle-exit" aria-label="${t('app.back')}">✕</button></div></div><div class="battle-plates"><div class="hud-card player-hud" id="hud-player"></div><div class="hud-card enemy-hud" id="hud-enemy"></div></div></section><section class="battle-stage" data-battle-zone="stage"><div class="battle-stage-camera"><div class="battlefield"><div class="fighter enemy" id="fighter-enemy"><div class="status-orbits"></div><img alt=""></div><div class="fighter player" id="fighter-player"><div class="status-orbits"></div><img alt=""></div></div><div id="fx-stage" class="fx-stage" aria-hidden="true"></div></div></section><section class="battle-command-dock" data-battle-zone="controls"><div id="tutorial-root"></div><div class="action-line" id="action-line" role="status" aria-live="polite"></div><div class="battle-controls"><div class="move-grid" id="moves"></div><button class="switch-btn" data-action="open-switch"><span>↺</span><b>${t('battle.switch')}</b></button></div></section></div><div id="replacement-root"></div>`;
  if (ctx.battleSession.quickRuleId && ctx.battleSession.quickRuleId !== 'standard') {
    const rule = quickRule(ctx.battleSession.quickRuleId);
    screen
      .querySelector('.arena-nameplate')
      ?.insertAdjacentHTML(
        'beforeend',
        `<span class="quick-rule-chip">${rule.icon} ${t(`quickRule.${rule.id}`)}</span>`
      );
  }
  const logButton = document.createElement('button');
  logButton.type = 'button';
  logButton.className = 'icon-btn';
  logButton.dataset.action = 'battle-log';
  logButton.setAttribute('aria-label', t('battle.log'));
  logButton.textContent = '≡';
  screen.querySelector('[data-action="battle-help"]')?.before(logButton);
  screen
    .querySelector('.battle-tools')
    ?.insertAdjacentHTML(
      'afterbegin',
      `<button class="icon-btn trainer-command-btn command-coach" data-action="trainer-command" aria-label="${t('battle.command')}"><span>⚑</span><small>${t('command.coach')}</small></button>`
    );
  try {
    if (params.get('failWebgl') === '1') throw new Error('WEBGL_UNAVAILABLE');
    ctx.arenaScene = new ArenaScene(screen.querySelector('#arena'), ctx.battleSession.arena, {
      reducedMotion: ctx.save.reducedMotion,
    });
  } catch (error) {
    cancelBattleSession(session);
    ctx.battleSession = null;
    screen.innerHTML = `<div class="shell"><section class="boot-card error-card"><h1>Oups !</h1><p>${t('error.webgl')}</p>${actionButton(t('app.back'), 'title', 'primary-btn')}</section></div>`;
    bindCommon();
    return;
  }
  screen.querySelector('#arena').addEventListener('arena-context-lost', () => {
    if (!sessionIsActive(session)) return;
    cancelBattleSession(session);
    ctx.battleSession = null;
    disposeArena();
    screen.innerHTML = `<div class="shell"><section class="boot-card error-card"><h1>Oups !</h1><p>${t('error.context')}</p>${actionButton(t('app.back'), 'title', 'primary-btn')}</section></div>`;
    bindCommon();
  });
  screen.querySelector('[data-action="toggle-mute"]').addEventListener('click', () => {
    if (!sessionIsActive(session)) return;
    ctx.save.muted = !ctx.save.muted;
    persist();
    refreshBattle();
  });
  screen.querySelector('[data-action="battle-speed"]').addEventListener('click', () => {
    if (!sessionIsActive(session)) return;
    ctx.save.battleSpeed = ctx.save.battleSpeed === 2 ? 1 : 2;
    persist();
    refreshBattle();
  });
  screen.querySelector('[data-action="battle-help"]').addEventListener('click', openBattleCodex);
  screen.querySelector('[data-action="battle-log"]').addEventListener('click', openBattleLog);
  screen.querySelector('[data-action="trainer-command"]').addEventListener('click', handleTrainerCommand);
  screen.querySelector('[data-action="battle-exit"]').addEventListener('click', () => {
    if (!sessionIsActive(session) || !confirm(t('battle.exitConfirm'))) return;
    cancelBattleSession(session);
    renderTitle();
  });
  refreshBattle();
  sound.unlock();
  battleEntrance(session);
}

function openBattleCodex() {
  if (ctx.locked) return;
  const state = ctx.battleSession.state,
    root = screen.querySelector('#replacement-root'),
    statusIds = [
      ...new Set(['player', 'enemy'].flatMap((side) => Object.keys(activeOf(state, side).statuses))),
    ],
    boons = ctx.gauntletRun?.boons || [],
    activeRule = ctx.battleSession.quickRuleId ? quickRule(ctx.battleSession.quickRuleId) : null,
    circuit = ctx.battleSession.mode === 'circuit' ? circuitMatch(ctx.save.circuitWins, LADDER_COUNT) : null,
    trainerAce = state.enemyAce;
  const activeStatuses = statusIds.length
    ? statusIds
        .map((id) => {
          const meta = STATUS_DEFINITIONS[id];
          return `<div class="codex-status" style="--status-color:${meta.color}"><i>${meta.icon}</i><span><b>${t(`status.${id}`)}</b><small>${t(`status.effect.${id}`)}</small></span></div>`;
        })
        .join('')
    : `<p>${t('battle.codexNoStatus')}</p>`;
  const routes = comboRoutesHtml(
    state.sides.player.team.map((creature) => creature.id),
    true
  );
  root.innerHTML = `<div class="replacement codex-overlay"><section class="glass-panel battle-codex" role="dialog" aria-modal="true" aria-labelledby="codex-title"><button class="codex-close icon-btn" data-action="close-codex" aria-label="${t('app.close')}">✕</button><span class="eyebrow">${t('battle.fieldState')}</span><h2 id="codex-title">${t('battle.codex')}</h2><div class="codex-grid"><article><h3>⚡ ${t('arena.ruleTitle')}</h3><b>${t(`arena.${state.arena}`)}</b><p>${t(`arena.rule.${state.arena}`)}</p></article><article><h3>✦ ${t('battle.surge')}</h3><p>${t('academy.surge')}</p></article><article class="codex-wide"><h3>↺ ${t('battle.switchRead')}</h3><p>${t('battle.perfectRelayHint')}</p></article>${routes ? `<article class="codex-wide"><h3>↗ ${t('combo.title')}</h3>${routes}</article>` : ''}${boons.length ? `<article class="codex-wide"><h3>↟ ${t('gauntlet.boons')}</h3><ul>${boons.map((id) => `<li><b>${t(`boon.${id}`)}</b> — ${t(`boon.effect.${id}`)}</li>`).join('')}</ul></article>` : ''}<article class="codex-wide"><h3>☿ ${t('battle.activeStatuses')}</h3><div class="codex-statuses">${activeStatuses}</div></article><article class="codex-wide affinity-reminder"><h3>◈ ${t('battle.affinityCycle')}</h3><p>${t('settings.affinities')}</p></article></div></section></div>`;
  root
    .querySelector('.codex-grid')
    ?.insertAdjacentHTML(
      'beforeend',
      `<article class="codex-wide final-duel-codex"><h3>⚔ ${t('battle.finalDuel')}</h3><p>${t('battle.finalDuelHint')}</p></article>`
    );
  root
    .querySelector('.codex-grid')
    ?.insertAdjacentHTML(
      'afterbegin',
      `<article class="codex-wide trainer-command-codex command-coach ${state.sides.player.commandUsed ? 'used' : ''}"><h3>⚑ ${t('battle.command')} · ${t('command.coach')}</h3><p>${t('command.effect.coach')}</p><strong>${state.sides.player.commandUsed ? '✓ ' + t('battle.commandUsed') : t('battle.command')}</strong></article>`
    );
  if (activeRule && activeRule.id !== 'standard')
    root
      .querySelector('.codex-grid')
      ?.insertAdjacentHTML(
        'afterbegin',
        `<article class="codex-wide quick-rule-codex"><h3>${activeRule.icon} ${t('quickRule.title')}</h3><b>${t(`quickRule.${activeRule.id}`)}</b><p>${t(`quickRule.effect.${activeRule.id}`)}</p></article>`
      );
  if (circuit)
    root
      .querySelector('.codex-grid')
      ?.insertAdjacentHTML(
        'afterbegin',
        `<article class="codex-wide circuit-codex"><h3>${circuit.condition.icon} ${t('circuit.condition')}</h3><b>${t(`circuit.${circuit.condition.id}`)}</b><p>${t(`circuit.effect.${circuit.condition.id}`)}</p></article>`
      );
  if (trainerAce)
    root
      .querySelector('.codex-grid')
      ?.insertAdjacentHTML(
        'afterbegin',
        `<article class="codex-wide ace-codex ${state.aceTriggered ? 'triggered' : ''}"><h3>♛ ${t('ace.title')}</h3><b>${t(`ace.${trainerAce}`)}</b><p>${t(`ace.effect.${trainerAce}`)}</p></article>`
      );
  const close = () => {
    root.innerHTML = '';
    screen.querySelector('[data-action="battle-help"]')?.focus();
  };
  root.querySelector('[data-action="close-codex"]').addEventListener('click', close);
  root.querySelector('.codex-overlay').addEventListener('click', (e) => {
    if (e.target.classList.contains('codex-overlay')) close();
  });
  root.querySelector('[data-action="close-codex"]').focus();
}

function openBattleLog() {
  if (ctx.locked) return;
  const root = screen.querySelector('#replacement-root');
  if (!root) return;
  const entries = [...(ctx.battleSession.timeline || [])].reverse(),
    icons = { player: '◆', enemy: '◇' };
  root.innerHTML = `<div class="replacement battle-log-overlay"><section class="glass-panel battle-log" role="dialog" aria-modal="true" aria-labelledby="battle-log-title"><button class="codex-close icon-btn" data-action="close-log" aria-label="${t('app.close')}">✕</button><span class="eyebrow">${t('battle.logSubtitle')}</span><h2 id="battle-log-title">${t('battle.log')}</h2><p>${t('battle.logHint')}</p><ol>${
    entries.length
      ? entries
          .map((entry, index) => {
            const turn = entry.turn || 1,
              turnStart = index === 0 || entries[index - 1].turn !== turn;
            return `<li class="log-${entry.side || 'field'} ${index === 0 ? 'latest' : ''} ${turnStart ? 'turn-start' : ''}" data-turn="${t('battle.turn', { turn })}"><i>${icons[entry.side] || '✦'}</i><span><small>${t(`battle.logType.${LOG_TYPE_GROUPS[entry.type] || 'effect'}`)}</small>${escapeHtml(entry.text)}</span></li>`;
          })
          .join('')
      : `<li class="empty">${t('battle.logEmpty')}</li>`
  }</ol></section></div>`;
  const close = () => {
    root.innerHTML = '';
    screen.querySelector('[data-action="battle-log"],[data-action="result-log"]')?.focus();
  };
  root.querySelector('[data-action="close-log"]').addEventListener('click', close);
  root.querySelector('.battle-log-overlay').addEventListener('click', (event) => {
    if (event.target.classList.contains('battle-log-overlay')) close();
  });
  root.querySelector('[data-action="close-log"]').focus();
}

function openPlateDetails(side) {
  if (ctx.locked || !ctx.battleSession) return;
  const session = ctx.battleSession,
    root = screen.querySelector('#replacement-root'),
    trigger = screen.querySelector(`[data-plate-side="${side}"]`),
    creature = activeOf(session.state, side);
  if (!root || !trigger || !creature) return;
  trigger.setAttribute('aria-expanded', 'true');
  root.innerHTML = `<div class="replacement plate-detail-overlay"><section class="glass-panel plate-detail-card" role="dialog" aria-modal="true" aria-labelledby="plate-detail-title"><button type="button" class="codex-close icon-btn" data-action="close-plate" aria-label="${t('app.close')}">✕</button><span class="eyebrow">${t('battle.plateHint')}</span><h2 id="plate-detail-title">${t('battle.plateTitle', { name: creatureName(creature.id) })}</h2>${hudDetailHtml(side)}</section></div>`;
  const close = () => {
    if (!sessionIsActive(session)) return;
    root.innerHTML = '';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus();
  };
  root.querySelector('[data-action="close-plate"]')?.addEventListener('click', close);
  root.querySelector('.plate-detail-overlay')?.addEventListener('click', (event) => {
    if (event.target.classList.contains('plate-detail-overlay')) close();
  });
  root.querySelector('[data-action="close-plate"]')?.focus();
}

function bindBattleChoiceContext(session) {
  const line = screen.querySelector('#action-line');
  if (!line) return;
  const restore = () => {
    if (!sessionIsActive(session)) return;
    line.classList.remove('contextual');
    line.textContent = session.lastLine;
  };
  const show = (button) => {
    if (!sessionIsActive(session)) return;
    const source = button.querySelector('.move-context-source');
    if (!source) return;
    line.classList.add('contextual');
    line.innerHTML = source.innerHTML;
  };
  screen.querySelectorAll('[data-move]').forEach((button) => {
    let longPressTimer = 0;
    button.addEventListener('pointerenter', () => show(button));
    button.addEventListener('pointerleave', () => {
      clearTimeout(longPressTimer);
      if (document.activeElement !== button) restore();
    });
    button.addEventListener('focus', () => show(button));
    button.addEventListener('blur', restore);
    button.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch') return;
      longPressTimer = window.setTimeout(() => {
        if (!sessionIsActive(session)) return;
        button.dataset.longPressed = 'true';
        show(button);
      }, 420);
    });
    const endLongPress = () => clearTimeout(longPressTimer);
    button.addEventListener('pointerup', endLongPress);
    button.addEventListener('pointercancel', endLongPress);
  });
}

async function battleEntrance(session = ctx.battleSession) {
  if (testAnimationScale === 0 || !sessionIsActive(session)) return;
  ctx.locked = true;
  refreshBattle();
  const stage = screen.querySelector('#fx-stage'),
    state = session.state,
    player = activeOf(state, 'player'),
    enemy = activeOf(state, 'enemy'),
    trainer = ['ladder', 'circuit'].includes(session.mode) ? TRAINERS[session.trainerIndex] : null,
    trial = session.mode === 'trial' ? TRIALS.find((x) => x.id === session.trialId) : null;
  const gauntletTrainer = session.mode === 'gauntlet' ? TRAINERS[session.trainerIndex] : null,
    rival = trainer || gauntletTrainer,
    rivalName = rival ? t(rival.nameKey) : trial ? t(trial.nameKey) : t('battle.freeRival'),
    quote = rival ? t(`style.taunt.${rival.style}`) : trial ? t(trial.descKey) : t('battle.freeTaunt');
  stage.className = 'fx-stage active battle-intro-fx';
  stage.innerHTML = `<div class="intro-side player"><span>${t('battle.yourTeam')}</span><img src="${sprite(player.id)}" alt=""><b>${creatureName(player.id)}</b></div><div class="intro-vs"><i>VS</i><small>${escapeHtml(quote)}</small></div><div class="intro-side enemy"><span>${escapeHtml(rivalName)}</span><img src="${sprite(enemy.id)}" alt=""><b>${creatureName(enemy.id)}</b></div>`;
  screen.classList.add('intro-mode');
  sound.call(player.id);
  setTimeout(() => {
    if (sessionIsActive(session)) sound.call(enemy.id);
  }, 220 / ctx.save.battleSpeed);
  await wait((ctx.save.reducedMotion ? 300 : 1380) / ctx.save.battleSpeed);
  if (!sessionIsActive(session)) return;
  clearBattleFx();
  ctx.locked = false;
  if (session.state.phase === 'choice') {
    session.lastLine = t('battle.yourTurn');
    refreshBattle();
  }
}

function refreshBattle() {
  if (!ctx.battleSession || !screen.classList.contains('battle-screen')) return;
  const session = ctx.battleSession,
    state = session.state,
    p = activeOf(state, 'player'),
    e = activeOf(state, 'enemy'),
    expertMode = Boolean(ctx.save.expertMode);
  const cadence = state.modifiers?.includes('rapid_arena') ? 2 : 4,
    until = cadence - ((state.turn - 1) % cadence),
    sideRatio = (side) =>
      state.sides[side].team.reduce((sum, c) => sum + c.hp, 0) /
      state.sides[side].team.reduce((sum, c) => sum + c.maxHp, 1),
    lastStand = ['player', 'enemy'].some(
      (side) => state.sides[side].team.filter((c) => c.hp > 0).length === 1
    ),
    tension = Math.min(
      1,
      (state.turn - 1) / 25 +
        (1 - Math.min(sideRatio('player'), sideRatio('enemy'))) * 0.58 +
        (lastStand ? 0.3 : 0)
    );
  screen.classList.toggle('locked', ctx.locked);
  screen.classList.toggle('expert-mode', expertMode);
  screen.classList.toggle('simple-mode', !expertMode);
  screen.classList.toggle('arena-imminent', until === 1);
  screen.classList.toggle('player-last-stand', state.sides.player.team.filter((c) => c.hp > 0).length === 1);
  screen.classList.toggle('enemy-last-stand', state.sides.enemy.team.filter((c) => c.hp > 0).length === 1);
  screen.classList.toggle('tension-rising', tension >= 0.38);
  screen.classList.toggle('tension-high', tension >= 0.68);
  screen.style.setProperty('--battle-tension', tension.toFixed(2));
  ctx.arenaScene?.setBattleState({ tension, imminent: until === 1 });
  screen.querySelector('#turn-chip').innerHTML =
    `<b>${t('battle.turn', { turn: state.turn })}</b><small>⚡ ${t('battle.arenaIn', { turns: until })}</small>`;
  screen.querySelector('#action-line').textContent = ctx.battleSession.lastLine;
  for (const side of ['player', 'enemy']) {
    const owner = state.sides[side],
      c = activeOf(state, side),
      fighter = screen.querySelector(`#fighter-${side}`),
      img = fighter.querySelector('img'),
      rank = side === 'player' ? masteryRank(ctx.save.mastery[c.id] || 0) : 0;
    img.src = sprite(c.id);
    img.alt = creatureName(c.id);
    fighter.dataset.creature = c.id;
    fighter.dataset.affinity = c.affinity;
    fighter.style.setProperty('--mastery-rank', rank);
    fighter.querySelector('.status-orbits').innerHTML = statusVisuals(c);
    fighter.classList.toggle('has-barrier', c.barrier > 0);
    fighter.classList.toggle(
      'has-negative',
      Object.keys(c.statuses).some((id) => !STATUS_DEFINITIONS[id].positive)
    );
    fighter.classList.toggle(
      'has-positive',
      Object.keys(c.statuses).some((id) => STATUS_DEFINITIONS[id].positive)
    );
    fighter.classList.toggle('mastered', rank >= 3);
    fighter.classList.toggle('low-health', c.hp / c.maxHp <= 0.25);
    fighter.classList.toggle(
      'signature-ready',
      owner.surge >= signatureCostFor(c) && c.moves.some((id) => MOVES[id].signature)
    );
    const hud = screen.querySelector(`#hud-${side}`);
    hud.innerHTML = hudHtml(side, expertMode);
    hud.querySelector('[data-plate-side]')?.addEventListener('click', () => openPlateDetails(side));
  }
  screen.querySelector('#moves').innerHTML = p.moves.map(moveButton).join('');
  const forecastPlan = ctx.battleSession.difficulty === 'apprentice' && !ctx.locked ? enemyPlan() : null;
  if (forecastPlan)
    screen
      .querySelectorAll('[data-move]')
      .forEach((button) =>
        button
          .querySelector('.move-tags')
          ?.insertAdjacentHTML('afterbegin', exchangeForecastHtml(button.dataset.move, forecastPlan))
      );
  screen.querySelectorAll('[data-move]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.longPressed === 'true') {
        delete b.dataset.longPressed;
        return;
      }
      handlePlayerAction({ type: 'move', moveId: b.dataset.move });
    })
  );
  bindBattleChoiceContext(session);
  const switchButton = screen.querySelector('[data-action="open-switch"]');
  switchButton.disabled =
    ctx.locked ||
    (ctx.battleSession.mode === 'tutorial' && ctx.battleSession.tutorialStep < 2) ||
    !getLegalActions(state, 'player').some((action) => action.type === 'switch');
  switchButton.onclick = openSwitch;
  const speedButton = screen.querySelector('[data-action="battle-speed"]');
  speedButton.textContent = `×${ctx.save.battleSpeed}`;
  speedButton.setAttribute('aria-pressed', String(ctx.save.battleSpeed === 2));
  const mute = screen.querySelector('[data-action="toggle-mute"]');
  mute.textContent = ctx.save.muted ? '🔇' : '🔊';
  mute.setAttribute('aria-pressed', String(ctx.save.muted));
  const commandButton = screen.querySelector('[data-action="trainer-command"]');
  if (commandButton) {
    const used = state.sides.player.commandUsed;
    commandButton.disabled = ctx.locked || !canUseTrainerCommand(state, 'player');
    commandButton.classList.toggle('used', used);
    commandButton.innerHTML = `<span>${used ? '✓' : '⚑'}</span><small>${used ? t('battle.commandUsed') : t('command.coach')}</small>`;
    commandButton.title = t('command.effect.coach');
  }
  renderTutorialTip();
}

function renderTutorialTip() {
  const root = screen.querySelector('#tutorial-root');
  if (!root || ctx.battleSession.mode !== 'tutorial') {
    if (root) root.innerHTML = '';
    return;
  }
  const step = Math.min(3, ctx.battleSession.tutorialStep);
  root.innerHTML = `<div class="tutorial-tip"><strong>${t('tutorial.title')}</strong><br>${t(`tutorial.${step + 1}`)} ${step < 3 ? `<button class="subtle-btn" data-action="skip-tutorial">${t('app.skip')}</button>` : ''}</div>`;
  root.querySelector('[data-action="skip-tutorial"]')?.addEventListener('click', completeTutorial);
}

function openSwitch() {
  if (ctx.locked) return;
  const state = ctx.battleSession.state,
    legal = getLegalActions(state, 'player'),
    foe = activeOf(state, 'enemy'),
    options = legal
      .filter((action) => action.type === 'switch' || action.type === 'replace')
      .map(({ index }) => ({ c: state.sides.player.team[index], index })),
    plan =
      !state.sides.player.pendingReplacement && ctx.battleSession.difficulty === 'apprentice'
        ? enemyPlan()
        : null;
  if (!options.length) return;
  const forecastFor = (index) => {
    if (!plan) return null;
    if (plan.type === 'switch') return { icon: '↺', text: t('battle.switchIncomingSwitch'), lethal: false };
    if (MOVES[plan.moveId]?.kind !== 'damage')
      return { icon: '✦', text: t('battle.switchIncomingTactic'), lethal: false };
    const incoming = previewIncomingAfterSwitch(state, 'player', index, plan.moveId);
    if (!incoming) return null;
    return {
      icon: incoming.lethal ? '☠' : '⚔',
      lethal: incoming.lethal,
      read: incoming.perfectRelay,
      text: incoming.miss
        ? t('battle.switchIncomingMiss')
        : incoming.lethal
          ? t('battle.switchIncomingKo')
          : incoming.absorbed
            ? t('battle.switchIncomingShield', { damage: incoming.damage, shield: incoming.absorbed })
            : t('battle.switchIncoming', { damage: incoming.damage }),
    };
  };
  const scouted = options.map(({ c, index }) => {
      const mult = affinityMultiplier(c.affinity, foe.affinity),
        incoming = affinityMultiplier(foe.affinity, c.affinity),
        forecast = forecastFor(index),
        score =
          (mult > 1 ? 24 : mult < 1 ? -8 : 0) +
          (incoming < 1 ? 18 : incoming > 1 ? -20 : 0) +
          (c.hp / c.maxHp) * 12 +
          c.barrier * 0.18 +
          (forecast?.read ? 38 : 0) -
          (forecast?.lethal ? 90 : ((forecast?.damage || 0) / c.maxHp) * 36);
      return { c, index, mult, forecast, score };
    }),
    recommended = scouted.slice().sort((a, b) => b.score - a.score || a.index - b.index)[0]?.index;
  const optionHtml = scouted
    .map(({ c, index, mult, forecast }) => {
      const match = mult === 1.5 ? 'good' : mult === 0.75 ? 'risky' : 'neutral',
        passive = PASSIVES[c.passive],
        statuses = Object.keys(c.statuses)
          .map((id) => STATUS_DEFINITIONS[id].icon)
          .join(' ');
      return `<button class="switch-option matchup-${match} ${forecast?.read ? 'perfect-read' : ''} ${index === recommended ? 'recommended' : ''}" data-switch-index="${index}">${index === recommended ? `<b class="switch-recommended">★ ${t('battle.switchRecommended')}</b>` : ''}<div class="switch-portrait"><img src="${sprite(c.id)}" alt=""><i style="--switch-color:${AFFINITIES[c.affinity].color}">${AFFINITIES[c.affinity].icon}</i></div><strong>${creatureName(c.id)}</strong><span>${c.hp}/${c.maxHp} PV${c.barrier ? ` · +${c.barrier} ⬡` : ''}</span><small class="switch-match ${match}">${mult === 1.5 ? '↑ ' + t('battle.switchGood') : mult === 0.75 ? '↓ ' + t('battle.switchRisky') : '◆ ' + t('battle.switchNeutral')}</small>${forecast ? `<em class="switch-incoming ${forecast.lethal ? 'lethal' : ''}">${forecast.icon} ${forecast.text}</em>` : ''}${forecast?.read ? `<em class="perfect-read-bonus">↺ ${t('battle.switchRead')}</em>` : ''}<small title="${escapeHtml(t(`passive.effect.${c.passive}`))}">${passive.icon} ${t(`passive.${c.passive}`)}${statuses ? ` · ${statuses}` : ''}</small></button>`;
    })
    .join('');
  const switchBonusKey = state.modifiers?.includes('relay_fever')
    ? 'battle.switchBonusFever'
    : 'battle.switchBonus';
  screen.querySelector('#replacement-root').innerHTML =
    `<div class="replacement"><section class="glass-panel replacement-card"><span class="eyebrow">${state.sides.player.pendingReplacement ? t('battle.chooseReplacement') : t('battle.switchForecast')}</span><h2>${state.sides.player.pendingReplacement ? t('battle.chooseReplacement') : t('battle.switchTitle')}</h2><p>${state.sides.player.pendingReplacement ? t('battle.replacementHint') : t('battle.switchHint')}</p><div class="replacement-options">${optionHtml}</div>${!state.sides.player.pendingReplacement ? `<div class="switch-bonus">✦ ${t(switchBonusKey)}</div>${actionButton(t('battle.cancel'), 'cancel-switch', 'subtle-btn')}` : ''}</section></div>`;
  screen
    .querySelectorAll('.switch-option>span')
    .forEach((label) => (label.textContent = label.textContent.replace(/\bPV\b/, t('battle.hpUnit'))));
  screen.querySelectorAll('[data-switch-index]').forEach((button) =>
    button.addEventListener('click', () => {
      screen.querySelector('#replacement-root').innerHTML = '';
      if (state.sides.player.pendingReplacement) handleReplacement(Number(button.dataset.switchIndex));
      else handlePlayerAction({ type: 'switch', index: Number(button.dataset.switchIndex) });
    })
  );
  screen
    .querySelector('[data-action="cancel-switch"]')
    ?.addEventListener('click', () => (screen.querySelector('#replacement-root').innerHTML = ''));
}

async function handleTrainerCommand() {
  if (ctx.locked || !canUseTrainerCommand(ctx.battleSession.state, 'player')) return;
  const session = ctx.battleSession;
  await sound.unlock();
  if (!sessionIsActive(session)) return;
  ctx.locked = true;
  refreshBattle();
  const result = applyTrainerCommand(session.state, 'player');
  session.state = result.state;
  await playEvents(result.events);
  if (!sessionIsActive(session)) return;
  ctx.locked = false;
  session.lastLine = t('battle.yourTurn');
  refreshBattle();
}

async function handlePlayerAction(action) {
  if (ctx.locked) return;
  const session = ctx.battleSession;
  await sound.unlock();
  if (!sessionIsActive(session)) return;
  ctx.locked = true;
  refreshBattle();
  const tutorialStep = session.tutorialStep;
  const enemyAction = session.mode === 'tutorial' ? tutorialEnemyAction(tutorialStep) : plannedEnemyAction();
  if (session.mode === 'tutorial') {
    if (tutorialStep === 0 && action.type === 'move') session.tutorialStep = 1;
    else if (tutorialStep === 1 && action.moveId === 'oracle_veil') session.tutorialStep = 2;
    else if (tutorialStep === 2 && action.type === 'switch') session.tutorialStep = 3;
  }
  if (
    action?.type === 'move' &&
    MOVES[action.moveId]?.signature &&
    enemyAction?.type === 'move' &&
    MOVES[enemyAction.moveId]?.signature
  )
    session.committedClash = {
      left: { creatureId: activeOf(session.state, 'player').id, moveId: action.moveId },
      right: { creatureId: activeOf(session.state, 'enemy').id, moveId: enemyAction.moveId },
    };
  const result = resolveTurn(session.state, action, enemyAction);
  session.state = result.state;
  await playEvents(result.events);
  if (!sessionIsActive(session)) return;
  ctx.locked = false;
  if (session.state.phase === 'ended') {
    finishBattle();
    return;
  }
  await resolvePendingReplacements(session);
  if (!sessionIsActive(session)) return;
  if (session.state.phase !== 'ended') {
    session.lastLine = t('battle.yourTurn');
    refreshBattle();
  }
}

async function resolvePendingReplacements(session = ctx.battleSession) {
  if (!sessionIsActive(session)) return;
  let state = session.state;
  if (state.sides.enemy.pendingReplacement) {
    const action = chooseAiAction(state, 'enemy', session.difficulty, session.style);
    const result = applyReplacement(state, 'enemy', action);
    session.state = result.state;
    await playEvents(result.events);
    if (!sessionIsActive(session)) return;
    state = session.state;
  }
  if (state.sides.player.pendingReplacement) {
    session.lastLine = t('battle.chooseReplacement');
    refreshBattle();
    openSwitch();
  }
}

async function handleReplacement(index) {
  const session = ctx.battleSession;
  if (!sessionIsActive(session)) return;
  ctx.locked = true;
  const result = applyReplacement(session.state, 'player', { type: 'replace', index });
  session.state = result.state;
  await playEvents(result.events);
  if (!sessionIsActive(session)) return;
  ctx.locked = false;
  await resolvePendingReplacements(session);
  if (!sessionIsActive(session)) return;
  refreshBattle();
}

registerRoutes({
  startBattle,
  renderBattle,
  openBattleCodex,
  openBattleLog,
  openPlateDetails,
  battleEntrance,
  refreshBattle,
  renderTutorialTip,
  openSwitch,
  handleTrainerCommand,
  handlePlayerAction,
  resolvePendingReplacements,
  handleReplacement,
});
