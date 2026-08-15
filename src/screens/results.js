import { ctx, registerRoutes, route } from '../app/context.js';

const {
  AFFINITIES,
  CREATURES,
  MOVES,
  FEATS,
  PERFORMANCE_GRADES,
  masteryProgress,
  masteryRank,
  performanceGrade,
  battleAchievementSignals,
  quickRule,
  battleAdviceKeys,
  TRAINERS,
  TRIALS,
  t,
  screen,
  sound,
  LADDER_COUNT,
  sprite,
  creatureName,
  affinity,
  actionButton,
  persist,
  notify,
  escapeHtml,
  disposeArena,
  emblemHtml,
  topbar,
} = ctx;
const {
  bindCommon,
  newSelection,
  renderTeamSelect,
  startDraft,
  advanceGauntlet,
  performanceHtml,
  startBattle,
  openBattleLog,
  battleOutroFx,
} = route;

function completeTutorial() {
  ctx.save.tutorialComplete = true;
  persist();
  disposeArena();
  ctx.battleSession = null;
  ctx.selection = null;
  renderTeamSelect('ladder');
  notify(t('tutorial.done'));
}

function gradeBattle(state, win) {
  return performanceGrade({
    win,
    turns: state.turn,
    survivors: state.sides.player.team.filter((creature) => creature.hp > 0).length,
  });
}

function awardBattleProgress(state, win, grade = gradeBattle(state, win)) {
  const mastery = [],
    newFeats = [],
    uses = {};
  for (const event of state.history)
    if (event.type === 'move-start' && event.side === 'player')
      uses[event.creatureId] = (uses[event.creatureId] || 0) + 1;
  for (const creature of state.sides.player.team) {
    const before = ctx.save.mastery[creature.id] || 0,
      gain = 1 + (win ? 2 : 0) + grade.bonusXp + Math.min(2, Math.floor((uses[creature.id] || 0) / 3)),
      after = Math.min(999, before + gain);
    ctx.save.mastery[creature.id] = after;
    mastery.push({
      id: creature.id,
      gain,
      beforeRank: masteryRank(before),
      afterRank: masteryRank(after),
      progress: masteryProgress(after),
    });
  }
  ctx.save.records = { ...(ctx.save.records || {}) };
  for (const creature of state.sides.player.team) {
    const id = creature.id,
      previous = ctx.save.records[id] || {
        battles: 0,
        wins: 0,
        damage: 0,
        kos: 0,
        signatures: 0,
        assists: 0,
        combos: 0,
      },
      damage = state.history
        .filter(
          (event) => event.type === 'damage' && event.sourceSide === 'player' && event.sourceCreatureId === id
        )
        .reduce((sum, event) => sum + event.amount, 0),
      kos = state.history.filter(
        (event) =>
          event.type === 'damage' &&
          event.sourceSide === 'player' &&
          event.sourceCreatureId === id &&
          event.hp === 0
      ).length,
      signatures = state.history.filter(
        (event) =>
          event.type === 'move-start' &&
          event.side === 'player' &&
          event.creatureId === id &&
          MOVES[event.moveId]?.signature
      ).length,
      combos = state.history.filter(
        (event) =>
          event.type === 'damage' &&
          event.sourceSide === 'player' &&
          event.sourceCreatureId === id &&
          event.combo
      ).length;
    ctx.save.records[id] = {
      battles: Math.min(99999, previous.battles + 1),
      wins: Math.min(99999, previous.wins + (win ? 1 : 0)),
      damage: Math.min(9999999, previous.damage + damage),
      kos: Math.min(99999, previous.kos + kos),
      signatures: Math.min(99999, previous.signatures + signatures),
      assists: Math.min(99999, previous.assists || 0),
      combos: Math.min(99999, (previous.combos || 0) + combos),
    };
  }
  const signals = battleAchievementSignals(state.history),
    candidates = [];
  if (signals.signature) candidates.push('first_signature');
  if (win && !state.history.some((e) => e.type === 'ko' && e.side === 'player')) candidates.push('flawless');
  if (win && (state.turn <= 10 || signals.onslaught)) candidates.push('blitz');
  if (win && state.sides.player.team.some((c) => c.hp > 0 && c.hp / c.maxHp <= 0.12))
    candidates.push('survivor');
  if (win && signals.guardian) candidates.push('survivor');
  if (signals.tactician) candidates.push('tactician');
  if (win && new Set(state.sides.player.team.map((c) => c.affinity)).size === 3) candidates.push('harmony');
  if (win && state.history.filter((e) => e.type === 'arena-pulse').length >= 2)
    candidates.push('arena_master');
  if (win && state.sides.player.team.filter((c) => c.hp <= 0).length === 2) candidates.push('comeback');
  if (state.history.some((e) => e.type === 'perfect-relay' && e.side === 'player'))
    candidates.push('perfect_relay');
  for (const id of candidates)
    if (!ctx.save.feats.includes(id)) {
      ctx.save.feats.push(id);
      newFeats.push(id);
    }
  const previousStreak = ctx.save.winStreak || 0;
  ctx.save.battlesPlayed = Math.min(9999, ctx.save.battlesPlayed + 1);
  if (win) {
    ctx.save.wins = Math.min(9999, ctx.save.wins + 1);
    ctx.save.winStreak = Math.min(9999, previousStreak + 1);
    ctx.save.bestStreak = Math.max(ctx.save.bestStreak || 0, ctx.save.winStreak);
  } else ctx.save.winStreak = 0;
  return {
    mastery,
    newFeats,
    achievementSignals: signals,
    grade,
    streak: { current: ctx.save.winStreak, best: ctx.save.bestStreak, broken: win ? 0 : previousStreak },
  };
}

function finishBattle() {
  const state = ctx.battleSession.state;
  if (ctx.battleSession.mode === 'tutorial') {
    setTimeout(completeTutorial, 500 / ctx.save.battleSpeed);
    return;
  }
  const win = state.winner === 'player',
    grade = gradeBattle(state, win);
  if (win && ctx.battleSession.mode === 'ladder') {
    const index = ctx.battleSession.trainerIndex;
    if (index === ctx.save.ladderVictories && ctx.save.ladderVictories < LADDER_COUNT) {
      ctx.save.ladderVictories++;
      const emblem = TRAINERS[index].id;
      if (!ctx.save.emblems.includes(emblem)) ctx.save.emblems.push(emblem);
      for (const unlocked of TRAINERS.slice(0, ctx.save.ladderVictories).map((x) => x.arena))
        if (!ctx.save.cosmetics.includes(unlocked)) ctx.save.cosmetics.push(unlocked);
    }
  }
  if (win && ctx.battleSession.mode === 'trial' && !ctx.save.trials.includes(ctx.battleSession.trialId))
    ctx.save.trials.push(ctx.battleSession.trialId);
  if (win && ctx.battleSession.mode === 'draft') ctx.save.draftWins = Math.min(9999, ctx.save.draftWins + 1);
  if (win && ctx.battleSession.mode === 'circuit')
    ctx.save.circuitWins = Math.min(9999, ctx.save.circuitWins + 1);
  if (
    !ctx.save.bestGrade ||
    PERFORMANCE_GRADES.indexOf(grade.letter) > PERFORMANCE_GRADES.indexOf(ctx.save.bestGrade)
  )
    ctx.save.bestGrade = grade.letter;
  ctx.pendingRewards = awardBattleProgress(state, win, grade);
  persist();
  void battleOutroFx(state).then(() => {
    if (!ctx.battleSession || ctx.battleSession.cancelled) return;
    if (win && ctx.battleSession.mode === 'gauntlet') {
      advanceGauntlet();
      return;
    }
    renderResults(win);
  });
}

function battleRecap(state) {
  const damage = state.history.filter((e) => e.type === 'damage'),
    playerDamage = damage.filter((e) => e.sourceSide === 'player'),
    byCreature = {};
  playerDamage.forEach((e) => {
    if (e.sourceCreatureId) byCreature[e.sourceCreatureId] = (byCreature[e.sourceCreatureId] || 0) + e.amount;
  });
  const mvp = Object.entries(byCreature).sort((a, b) => b[1] - a[1])[0] || [state.sides.player.team[0].id, 0];
  const contributions = state.sides.player.team.map((creature) => ({
    id: creature.id,
    damage: byCreature[creature.id] || 0,
    actions: state.history.filter(
      (event) => event.type === 'move-start' && event.side === 'player' && event.creatureId === creature.id
    ).length,
    combos: state.history.filter(
      (event) =>
        event.type === 'damage' &&
        event.sourceSide === 'player' &&
        event.sourceCreatureId === creature.id &&
        event.combo
    ).length,
    kos: playerDamage.filter((event) => event.sourceCreatureId === creature.id && event.hp === 0).length,
  }));
  return {
    dealt: playerDamage.reduce((n, e) => n + e.amount, 0),
    taken: damage.filter((e) => e.sourceSide === 'enemy').reduce((n, e) => n + e.amount, 0),
    healed: state.history
      .filter((e) => e.type === 'heal' && e.side === 'player')
      .reduce((n, e) => n + e.amount, 0),
    absorbed: state.history
      .filter((e) => e.type === 'barrier-hit' && e.side === 'player')
      .reduce((n, e) => n + e.amount, 0),
    combos: playerDamage.filter((e) => e.combo).length,
    signatures: state.history.filter(
      (e) => e.type === 'move-start' && e.side === 'player' && MOVES[e.moveId]?.signature
    ).length,
    mvp: { id: mvp[0], damage: mvp[1] },
    contributions,
  };
}

function adjustBattleTeam() {
  const session = ctx.battleSession;
  if (!session || !['ladder', 'quick', 'circuit', 'trial'].includes(session.mode)) return;
  const mode = session.mode,
    base = newSelection(mode === 'trial' ? 'quick' : mode);
  ctx.selection = {
    ...base,
    mode,
    team: [...(session.playerTeam || session.state.sides.player.team.map((c) => c.id))],
    lead: session.playerLead || 0,
    enemyTeam: [...(session.enemyTeam || session.state.sides.enemy.team.map((c) => c.id))],
    trainerIndex: session.trainerIndex || 0,
    arena: session.arena,
    difficulty: session.difficulty,
    quickRule: session.quickRuleId || 'standard',
    circuitCondition: session.circuitCondition || base.circuitCondition,
    trialId: session.trialId,
    modifiers: [...(session.modifiers || [])],
  };
  renderTeamSelect(mode);
}

function renderResults(win) {
  disposeArena();
  ctx.previousScreen = 'title';
  screen.dataset.page = 'results';
  screen.className = 'screen';
  const state = ctx.battleSession.state,
    team = state.sides.player.team,
    recap = battleRecap(state),
    biggest = state.history
      .filter((e) => e.type === 'damage' && e.sourceSide === 'player')
      .sort((a, b) => b.amount - a.amount)[0];
  if (win) sound.victory();
  else sound.defeat();
  const progress =
    ctx.battleSession.mode === 'ladder'
      ? `<div><span class="eyebrow">${t('title.progress')}</span><div class="emblems epic-emblems">${TRAINERS.map((_, i) => emblemHtml(i, i < ctx.save.ladderVictories)).join('')}</div></div>`
      : ctx.battleSession.mode === 'trial' && win
        ? `<div class="trial-victory">♛ ${t('trial.reward', { count: ctx.save.trials.length, total: TRIALS.length })}</div>`
        : ctx.battleSession.mode === 'gauntlet' && win
          ? `<div class="gauntlet-victory">↟ ${t('gauntlet.conquered', { count: ctx.save.gauntletWins })}</div>`
          : ctx.battleSession.mode === 'draft' && win
            ? `<div class="draft-victory">◫ ${t('draft.won', { count: ctx.save.draftWins })}</div>`
            : ctx.battleSession.mode === 'circuit' && win
              ? `<div class="circuit-victory">♚ ${t('circuit.won', { count: ctx.save.circuitWins })}</div>`
              : '';
  const mastery =
    ctx.pendingRewards?.mastery
      .map(
        (reward) =>
          `<div class="mastery-reward ${reward.afterRank > reward.beforeRank ? 'rank-up' : ''}"><img src="${sprite(reward.id)}" alt=""><span><b>${creatureName(reward.id)} · ${t('mastery.rank', { rank: reward.afterRank })}</b><i><u style="width:${reward.progress.ratio * 100}%"></u></i><small>+${reward.gain} ${t('mastery.xp')}${reward.afterRank > reward.beforeRank ? ` · ✦ ${t('mastery.rankUp')}` : ''}</small></span></div>`
      )
      .join('') || '';
  const feats = ctx.pendingRewards?.newFeats.length
    ? `<div class="feat-rewards"><strong>${t('feat.unlocked')}</strong>${ctx.pendingRewards.newFeats.map((id) => `<div><b>${FEATS[id].icon} ${t(`feat.${id}`)}</b><span>${t(`feat.effect.${id}`)}</span></div>`).join('')}</div>`
    : '';
  const streak = ctx.pendingRewards?.streak,
    streakReward =
      streak && (win || streak.broken >= 2)
        ? `<div class="result-streak ${win ? 'alive' : 'broken'}"><i>${win ? '🔥' : '◇'}</i><span><b>${win ? t('streak.result', { count: streak.current }) : t('streak.broken', { count: streak.broken })}</b><small>${t('streak.best', { count: streak.best })}</small></span></div>`
        : '';
  const contributionReport = `<section class="squad-report"><span class="eyebrow">${t('result.squadReport')}</span><div>${recap.contributions
    .map((entry) => {
      const creature = CREATURES[entry.id],
        color = AFFINITIES[creature.affinity].color;
      return `<article style="--report-color:${color}"><img src="${sprite(entry.id)}" alt=""><span><b>${creatureName(entry.id)}</b><small>${t(`role.${creature.role}`)}</small></span><dl><div><dt>${t('result.dealt')}</dt><dd>${entry.damage}</dd></div><div><dt>${t('result.actions')}</dt><dd>${entry.actions}</dd></div><div><dt>${t('result.combos')}</dt><dd>${entry.combos}</dd></div><div><dt>${t('result.kos')}</dt><dd>${entry.kos}</dd></div></dl></article>`;
    })
    .join('')}</div></section>`;
  const celebration = win
    ? `<div class="victory-burst" aria-hidden="true">${Array.from({ length: 36 }, (_, i) => `<i style="--piece:${i};--angle:${i * 137.5}deg;--distance:${150 + (i % 7) * 28}px;--delay:${(i % 9) * 45}ms"></i>`).join('')}</div>`
    : '';
  screen.innerHTML = `<div class="shell result-page results-scene results-scene--${win ? 'win' : 'loss'}${ctx.save.reducedMotion ? ' results-scene--reduced' : ''}">${topbar()}${celebration}<div class="result-shell results-stage"><section class="glass-panel result-card ${win ? 'won' : 'lost'} results-panel"><div class="result-icon results-heading">${win ? '✦' : '◇'}</div><h1 class="results-heading">${win ? t('result.victory') : t('result.defeat')}</h1><p class="results-intro">${win ? t('result.victoryText') : t('result.defeatText')}</p><div class="results-grade">${performanceHtml(ctx.pendingRewards?.grade)}</div><div class="results-reveal results-reveal--1">${streakReward}<div class="result-team">${team.map((c) => `<img class="${c.hp <= 0 ? 'fallen' : ''}" src="${sprite(c.id)}" alt="${creatureName(c.id)}">`).join('')}</div></div><div class="battle-recap results-reveal results-reveal--2"><div class="recap-mvp"><img src="${sprite(recap.mvp.id)}" alt=""><span><small>${t('result.mvp')}</small><b>${creatureName(recap.mvp.id)}</b><em>${t('result.mvpDamage', { damage: recap.mvp.damage })}</em></span></div><div class="recap-stats"><span><b>${recap.dealt}</b><small>${t('result.dealt')}</small></span><span><b>${recap.taken}</b><small>${t('result.taken')}</small></span><span><b>${recap.healed}</b><small>${t('result.healed')}</small></span><span><b>${recap.absorbed}</b><small>${t('result.absorbed')}</small></span><span><b>${recap.combos}</b><small>${t('result.combos')}</small></span><span><b>${recap.signatures}</b><small>${t('result.signatures')}</small></span></div></div><div class="results-reveal results-reveal--3">${contributionReport}<p class="result-moment"><strong>${t('result.moment')} :</strong> ${biggest ? `${creatureName(biggest.sourceCreatureId)} · ${biggest.amount} PV` : '—'}<br>${t('result.turns', { turns: state.turn })}</p><div class="mastery-rewards">${mastery}</div>${feats}${progress}</div><div class="result-actions results-reveal results-reveal--4">${actionButton(`≡ ${t('result.chronicle')}`, 'result-log', 'subtle-btn')}${actionButton(win && ctx.battleSession.mode === 'gauntlet' ? t('gauntlet.again') : t('result.rematch'), 'rematch')}${win && ctx.battleSession.mode === 'ladder' && ctx.save.ladderVictories < LADDER_COUNT ? actionButton(t('result.next'), 'next-battle', 'primary-btn') : ''}${win && ctx.battleSession.mode === 'circuit' ? actionButton(t('circuit.next'), 'next-circuit', 'primary-btn') : ''}${actionButton(t('result.title'), 'title')}</div></section></div><div id="replacement-root"></div></div>`;
  const moment = screen.querySelector('.result-moment');
  if (moment) moment.innerHTML = moment.innerHTML.replace(/\bPV\b/, t('battle.hpUnit'));
  if (['ladder', 'quick', 'circuit', 'trial'].includes(ctx.battleSession.mode))
    screen
      .querySelector('.result-actions')
      ?.insertAdjacentHTML(
        'afterbegin',
        actionButton(
          `↺ ${t('result.adjust')}`,
          'adjust-team',
          'subtle-btn',
          `title="${escapeHtml(t('result.adjustHint'))}"`
        )
      );
  const advice = battleAdviceKeys(state, win);
  if (advice.length)
    screen
      .querySelector('.battle-recap')
      ?.insertAdjacentHTML(
        'afterend',
        `<section class="battle-advice"><h3>☿ ${t('advice.title')}</h3>${advice.map((key) => `<p><i>${key === 'ace' ? '♛' : key === 'affinity' ? '△' : key === 'switch' ? '↺' : key === 'barrier' ? '⬡' : '✦'}</i><span>${t(`advice.${key}`)}</span></p>`).join('')}</section>`
      );
  bindCommon();
  screen.querySelector('[data-action="result-log"]')?.addEventListener('click', openBattleLog);
  screen.querySelector('[data-action="adjust-team"]')?.addEventListener('click', adjustBattleTeam);
  screen.querySelector('[data-action="rematch"]').addEventListener('click', () => {
    if (win && ctx.battleSession.mode === 'gauntlet') {
      ctx.selection = null;
      renderTeamSelect('gauntlet');
      return;
    }
    if (ctx.battleSession.mode === 'draft') {
      startDraft();
      return;
    }
    const config = { ...ctx.battleSession };
    delete config.state;
    delete config.lastLine;
    startBattle(config);
  });
  screen.querySelector('[data-action="next-battle"]')?.addEventListener('click', () => {
    ctx.selection = null;
    renderTeamSelect('ladder');
  });
  screen.querySelector('[data-action="next-circuit"]')?.addEventListener('click', () => {
    ctx.selection = null;
    renderTeamSelect('circuit');
  });
}

registerRoutes({
  completeTutorial,
  gradeBattle,
  awardBattleProgress,
  finishBattle,
  battleRecap,
  adjustBattleTeam,
  renderResults,
});
