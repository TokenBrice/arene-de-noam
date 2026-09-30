import { ctx, registerRoutes, route } from '../app/context.js';

const {
  MOVES,
  PERFORMANCE_GRADES,
  CHROMATIQUE_RANK,
  GAUNTLET_STAGES,
  masteryProgress,
  masteryRank,
  performanceGrade,
  battleAchievementSignals,
  battleAdviceKeys,
  chromatiqueUnlocked,
  isChromatiqueShown,
  setChromatique,
  unlockedModes,
  TRAINERS,
  TRIALS,
  t,
  screen,
  sound,
  LADDER_COUNT,
  sprite,
  creatureName,
  affinity,
  persist,
  escapeHtml,
  disposeArena,
  testAnimationScale,
  badgeArt,
  chromeActions,
} = ctx;
const {
  bindCommon,
  newSelection,
  renderTeamSelect,
  renderLeague,
  renderAcademy,
  renderTitle,
  openChallenges,
  startDraft,
  advanceGauntlet,
  guardGauntletRun,
  renderTrials,
  startBattle,
  startSelectionBattle,
  openBattleLog,
  openSheet,
  icon,
  battleOutroFx,
} = route;
// Battle states whose results screen already played its sting.
const resultsShown = new WeakSet();
const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
// Confetti pieces per quality tier; reduced motion gets a static sprinkle instead of a burst.
const CONFETTI_PIECES = { low: 12, mid: 20, high: 36 };
const STATIC_CONFETTI_PIECES = 12;
// The rank stamp lands (and thunks) just after the victory fanfare's last note (~0.7 s); the
// matching CSS delay lives on `.rs-stamp` in styles/screens/results.css.
const STAMP_LAND_MS = 900;
const STAMP_LAND_REDUCED_MS = 200;
// Unlock order of the side modes and their hub icons (title.js lists them the same way).
const MODE_ICONS = Object.freeze({ gauntlet: 'mountain', trials: 'crown', draft: 'calendar' });

/* Leaves the tutorial for team select, whose one-time guide (ctx.selectionGuide) says what to
   do next. The tutorial's own win reaches it from its results ("Choisis ton équipe"); the
   battle's skip chip calls it directly. */
function completeTutorial() {
  ctx.save.tutorialComplete = true;
  persist();
  disposeArena();
  ctx.battleSession = null;
  ctx.selection = null;
  ctx.selectionGuide = 'tutorial';
  renderTeamSelect('ladder');
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
  if (
    win &&
    state.history.filter(
      (e) => e.type === 'damage' && e.sourceSide === 'player' && e.hit === 1 && e.weather > 1
    ).length >= 3
  )
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

async function finishBattle() {
  const session = ctx.battleSession,
    state = session.state,
    win = state.winner === 'player',
    grade = gradeBattle(state, win);
  // The tutorial ends here, won like any battle: XP, records and a real results screen.
  if (session.mode === 'tutorial') ctx.save.tutorialComplete = true;
  // A first win over the League's next rival earns its badge, and maybe opens a side mode.
  let badge = null,
    unlocks = [];
  if (win && session.mode === 'ladder' && session.trainerIndex === ctx.save.ladderVictories) {
    const before = unlockedModes(ctx.save);
    ctx.save.ladderVictories = Math.min(LADDER_COUNT, ctx.save.ladderVictories + 1);
    badge = session.trainerIndex;
    const after = unlockedModes(ctx.save);
    unlocks = Object.keys(after).filter((mode) => after[mode].unlocked && !before[mode].unlocked);
  }
  if (win && session.mode === 'trial' && !ctx.save.trials.includes(session.trialId))
    ctx.save.trials.push(session.trialId);
  if (win && session.mode === 'draft') ctx.save.draftWins = Math.min(9999, ctx.save.draftWins + 1);
  if (win && session.mode === 'circuit') ctx.save.circuitWins = Math.min(9999, ctx.save.circuitWins + 1);
  if (
    !ctx.save.bestGrade ||
    PERFORMANCE_GRADES.indexOf(grade.letter) > PERFORMANCE_GRADES.indexOf(ctx.save.bestGrade)
  )
    ctx.save.bestGrade = grade.letter;
  ctx.pendingRewards = { ...awardBattleProgress(state, win, grade), badge, unlocks };
  persist();
  void battleOutroFx(state).then(() => {
    if (!ctx.battleSession || ctx.battleSession.cancelled) return;
    // A won Expédition stage shows its results first ("Étape suivante" → boons); the final
    // stage goes through advanceGauntlet(), which books the run win and then renders results.
    if (win && session.mode === 'gauntlet' && isFinalGauntletStage()) {
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

function isFinalGauntletStage() {
  return ctx.gauntletRun.stage + 1 >= GAUNTLET_STAGES.length;
}

function isReducedMotion() {
  return ctx.save.reducedMotion || reducedMotionQuery.matches;
}

// The screen's one gold call to action, then up to three secondary icon buttons
// (Revanche · Équipe · Accueil; a defeat swaps Revanche, which became the CTA, for École).
function resultActions(win, mode) {
  const home = { action: 'title', icon: 'home', label: t('result.home') };
  if (mode === 'tutorial')
    return { primary: { action: 'pick-team', label: t('result.pickTeam') }, secondary: [home] };
  let primary;
  if (!win) primary = { action: 'rematch', label: t('result.rematch') };
  else if (mode === 'ladder')
    primary =
      ctx.save.ladderVictories < LADDER_COUNT
        ? { action: 'next-battle', label: t('result.nextRival') }
        : { action: 'league', label: t('result.leagueMap') };
  else if (mode === 'circuit') primary = { action: 'next-circuit', label: t('circuit.next') };
  else if (mode === 'trial') primary = { action: 'next-trial', label: t('result.nextTrial') };
  else if (mode === 'gauntlet')
    primary =
      ctx.gauntletRun.stage < GAUNTLET_STAGES.length
        ? { action: 'next-stage', label: t('result.nextStage') }
        : { action: 'new-gauntlet', label: t('gauntlet.again') };
  // The Pioche du jour is one seed a day: replaying it deals the same offers again.
  else if (mode === 'draft') primary = { action: 'replay-draft', label: t('result.replayDraft') };
  else primary = { action: 'new-battle', label: t('result.newBattle') };
  const secondary = [];
  if (primary.action !== 'rematch' && mode !== 'gauntlet')
    secondary.push({ action: 'rematch', icon: 'refresh', label: t('result.rematch') });
  if (mode === 'draft') {
    if (primary.action !== 'replay-draft')
      secondary.push({ action: 'replay-draft', icon: 'calendar', label: t('result.replayDraft') });
    secondary.push({ action: 'challenges', icon: 'flag', label: t('hub.challenges') });
  }
  if (['ladder', 'quick', 'circuit', 'trial'].includes(mode))
    secondary.push({ action: 'adjust-team', icon: 'team', label: t('result.team') });
  if (!win && secondary.length < 2)
    secondary.push({ action: 'academy', icon: 'school', label: t('result.school') });
  secondary.push(home);
  return { primary, secondary };
}

function resultSubtitle(win, mode) {
  if (!win) return t('result.noProgressLost');
  const session = ctx.battleSession;
  if (mode === 'tutorial') return t('result.tutorialWin');
  if (mode === 'ladder') return t('result.rivalBeaten', { name: t(TRAINERS[session.trainerIndex].nameKey) });
  if (mode === 'trial') return t('trial.reward', { count: ctx.save.trials.length, total: TRIALS.length });
  if (mode === 'gauntlet')
    return ctx.gauntletRun.stage < GAUNTLET_STAGES.length
      ? t('result.stageClear', { round: ctx.gauntletRun.stage + 1, total: GAUNTLET_STAGES.length })
      : t('gauntlet.conquered', { count: ctx.save.gauntletWins });
  if (mode === 'draft') return t('draft.won', { count: ctx.save.draftWins });
  if (mode === 'circuit') return t('circuit.won', { count: ctx.save.circuitWins });
  return t('result.victoryText');
}

function confettiHtml() {
  const still = isReducedMotion(),
    count = still ? STATIC_CONFETTI_PIECES : CONFETTI_PIECES[ctx.quality?.tier] || CONFETTI_PIECES.mid;
  return `<div class="rs-confetti${still ? ' rs-confetti--still' : ''}" aria-hidden="true">${Array.from(
    { length: count },
    (_, i) =>
      `<i style="--piece:${i};--angle:${Math.round((i * 137.5) % 360)}deg;--distance:${still ? 96 + (i % 5) * 22 : 150 + (i % 7) * 28}px;--delay:${(i % 9) * 45}ms"></i>`
  ).join('')}</div>`;
}

function switchHtml(id) {
  const shown = isChromatiqueShown(id, ctx.save);
  return `<button type="button" class="rs-switch" role="switch" aria-checked="${shown}" data-chromatique="${id}" aria-label="${escapeHtml(t('result.chromaShowFor', { name: creatureName(id) }))}"><span>${t('result.chromaShow')}</span><i aria-hidden="true"><i></i></i></button>`;
}

// Hero: the Chromatique reveal (before → after) when a creature crossed the unlock rank in
// this battle, else the League badge this win earned, otherwise the creature of the match.
function heroHtml(win, recap, chromatiques, grade, badge) {
  const stamp =
    win && grade
      ? `<div class="rs-stamp rs-stamp--${grade.letter.toLowerCase()}" role="img" aria-label="${escapeHtml(t('result.rankLabel', { grade: grade.letter }))}"><b>${grade.letter}</b><small>${t('result.rankStamp')}</small></div>`
      : '';
  if (chromatiques.length) {
    const id = chromatiques[0];
    return `<section class="rs-hero rs-hero--chroma"><div class="rs-rays" aria-hidden="true"></div><div class="rs-chroma-pair"><img class="rs-chroma-before" data-variant="normal" src="${sprite(id, 'normal')}" alt="" draggable="false">${icon('chevron-right')}<img class="rs-hero-sprite" data-variant="chromatique" src="${sprite(id, 'chromatique')}" alt="${escapeHtml(t('result.chromaName', { name: creatureName(id) }))}" draggable="false"></div>${stamp}<p class="rs-ribbon">${icon('sparkle')}<span>${t('result.chromaUnlocked')}</span></p></section>`;
  }
  if (badge !== null) {
    const name = t(TRAINERS[badge].badgeNameKey);
    return `<section class="rs-hero rs-hero--badge"><div class="rs-rays" aria-hidden="true"></div><div class="rs-badge">${badgeArt(badge, 'earned', { label: name })}</div><p class="rs-badge-count"><small>${t('result.badgeEarned')}</small><b class="num">${t('result.badgeCount', { count: badge + 1, total: LADDER_COUNT })}</b></p>${stamp}<p class="rs-ribbon">${icon('badge')}<span>${name}</span></p></section>`;
  }
  const id = recap.mvp.id;
  return `<section class="rs-hero"><div class="rs-rays" aria-hidden="true"></div><img class="rs-hero-sprite" src="${sprite(id)}" alt="" draggable="false">${stamp}<p class="rs-ribbon">${icon('star')}<span>${t('result.mvpRibbon', { name: creatureName(id) })}</span></p></section>`;
}

function teamRowsHtml(state) {
  const fallen = new Set(state.sides.player.team.filter((creature) => creature.hp <= 0).map((c) => c.id));
  return (ctx.pendingRewards?.mastery || [])
    .map((reward, index) => {
      const up = reward.afterRank > reward.beforeRank,
        name = creatureName(reward.id);
      return `<li class="rs-row${up ? ' is-up' : ''}${fallen.has(reward.id) ? ' is-fallen' : ''}" style="--row:${index}"><span class="rs-pic"><img src="${sprite(reward.id)}" alt="" draggable="false"></span><span class="rs-row-main"><span class="rs-row-name"><b>${up ? t('result.masteryUp', { name, rank: reward.afterRank }) : name}</b>${up ? '' : `<span class="rs-rank" role="img" aria-label="${escapeHtml(t('mastery.rank', { rank: reward.afterRank }))}">${icon('star')}${reward.afterRank}</span>`}</span><span class="rs-xp" aria-hidden="true"><i style="--xp:${reward.progress.ratio.toFixed(3)}"></i></span></span><em class="rs-gain num">${t('result.xpGain', { xp: reward.gain })}</em></li>`;
    })
    .join('');
}

// The progress cards: a badge the Chromatique hero left out, a side mode this badge opened,
// the Chromatique switches. With none of these: a defeat tip, else the first new feat, else a
// live win streak.
function highlightHtml(win, state, chromatiques) {
  const { badge = null, unlocks = [] } = ctx.pendingRewards || {},
    cards = [];
  if (badge !== null && chromatiques.length)
    cards.push(
      `<section class="rs-card rs-badge-card">${badgeArt(badge, 'earned')}<span><small>${t('result.badgeEarned')}</small><b>${t(TRAINERS[badge].badgeNameKey)}</b><span>${t('result.badgeCount', { count: badge + 1, total: LADDER_COUNT })}</span></span></section>`
    );
  for (const mode of unlocks)
    cards.push(
      `<section class="rs-card rs-unlock rs-unlock--${mode}"><span class="rs-unlock-icon">${icon(MODE_ICONS[mode])}</span><span><b>${t('result.newMode', { mode: t(`app.${mode}`) })}</b><span>${t('result.newModeHint')}</span></span></section>`
    );
  if (chromatiques.length)
    cards.push(
      `<section class="rs-card rs-chroma">${chromatiques.map((id) => `<div class="rs-chroma-row"><img src="${sprite(id, 'chromatique')}" data-variant="chromatique" alt="" draggable="false"><b>${t('result.chromaName', { name: creatureName(id) })}</b>${switchHtml(id)}</div>`).join('')}</section>`
    );
  if (cards.length) return cards.join('');
  if (!win) {
    const [tip] = battleAdviceKeys(state, win);
    return tip
      ? `<section class="rs-card rs-tip">${icon('info')}<span><small>${t('result.tip')}</small><b>${t(`advice.${tip}`)}</b></span></section>`
      : '';
  }
  const feats = ctx.pendingRewards?.newFeats || [];
  if (feats.length)
    return `<section class="rs-card rs-feat">${icon('trophy')}<span><small>${t('feat.unlocked')}</small><b>${t(`feat.${feats[0]}`)}</b><span>${t(`feat.effect.${feats[0]}`)}</span></span></section>`;
  const streak = ctx.pendingRewards?.streak;
  if (streak?.current >= 2)
    return `<section class="rs-card rs-streak">${icon('flag')}<span><small>${t('streak.best', { count: streak.best })}</small><b>${t('streak.result', { count: streak.current })}</b></span></section>`;
  return '';
}

// "Voir le récap du combat": every number of the battle, zero values hidden, plus the journal.
function recapHtml(win) {
  const state = ctx.battleSession.state,
    recap = battleRecap(state),
    rewards = ctx.pendingRewards,
    grade = win ? rewards?.grade : null,
    biggest = state.history
      .filter((e) => e.type === 'damage' && e.sourceSide === 'player')
      .sort((a, b) => b.amount - a.amount)[0],
    stats = [
      [recap.dealt, 'result.dealt'],
      [recap.taken, 'result.taken'],
      [recap.healed, 'result.healed'],
      [recap.absorbed, 'result.absorbed'],
      [recap.combos, 'result.combos'],
      [recap.signatures, 'result.signatures'],
    ]
      .filter(([value]) => value > 0)
      .map(([value, key]) => `<span><b class="num">${value}</b><small>${t(key)}</small></span>`)
      .join(''),
    columns = [
      ['damage', 'result.dealt'],
      ['actions', 'result.actions'],
      ['combos', 'result.combos'],
      ['kos', 'result.kos'],
    ].filter(([key]) => recap.contributions.some((entry) => entry[key] > 0)),
    streak = rewards?.streak,
    advice = battleAdviceKeys(state, win),
    feats = rewards?.newFeats || [];
  const mvp =
    recap.mvp.damage > 0
      ? `<div class="rs-mvp"><img src="${sprite(recap.mvp.id)}" alt="" draggable="false"><span><small>${t('result.mvp')}</small><b>${creatureName(recap.mvp.id)}</b><em>${t('result.mvpDamage', { damage: recap.mvp.damage })}</em></span></div>`
      : '';
  const gradeBlock = grade
    ? `<section class="rs-grade rs-grade--${grade.letter.toLowerCase()}"><b class="rs-grade-letter" role="img" aria-label="${escapeHtml(t('result.rankLabel', { grade: grade.letter }))}">${grade.letter}</b><div>${['victory', 'tempo', 'survival'].map((key) => `<span class="rs-grade-part">${t(`grade.${key}`)} <b class="num">+${grade.breakdown[key] || 0}</b></span>`).join('')}${grade.bonusXp ? `<strong>${icon('star')}${t('grade.bonus', { xp: grade.bonusXp })}</strong>` : ''}</div></section>`
    : '';
  const trio = columns.length
    ? `<section class="rs-trio"><h3>${t('result.squadReport')}</h3>${recap.contributions
        .map(
          (entry) =>
            `<article style="--report-color:${affinity(entry.id).color}"><img src="${sprite(entry.id)}" alt="" draggable="false"><b>${creatureName(entry.id)}</b><dl>${columns.map(([key, label]) => `<div data-stat="${key}"><dt>${t(label)}</dt><dd class="num">${entry[key]}</dd></div>`).join('')}</dl></article>`
        )
        .join('')}</section>`
    : '';
  const moment = `<p class="rs-moment">${biggest ? `<span><small>${t('result.moment')}</small><b>${creatureName(biggest.sourceCreatureId)} · ${biggest.amount} ${t('battle.hpUnit')}</b></span>` : ''}<span><small>${t('result.duration')}</small><b>${t('result.turns', { turns: state.turn })}</b></span></p>`;
  const featList = feats.length
    ? `<section class="rs-sheet-feats"><h3>${t('feat.unlocked')}</h3>${feats.map((id) => `<p>${icon('trophy')}<span><b>${t(`feat.${id}`)}</b><small>${t(`feat.effect.${id}`)}</small></span></p>`).join('')}</section>`
    : '';
  const streakLine =
    streak && (win ? streak.current >= 2 : streak.broken >= 2)
      ? `<p class="rs-sheet-streak">${icon('flag')}<span><b>${win ? t('streak.result', { count: streak.current }) : t('streak.broken', { count: streak.broken })}</b><small>${t('streak.best', { count: streak.best })}</small></span></p>`
      : '';
  const adviceList = advice.length
    ? `<section class="rs-sheet-advice"><h3>${t('advice.title')}</h3>${advice.map((key) => `<p>${icon('info')}<span>${t(`advice.${key}`)}</span></p>`).join('')}</section>`
    : '';
  const badges =
    ctx.battleSession.mode === 'ladder'
      ? `<section class="rs-sheet-badges"><h3>${t('result.badges')}</h3><ul class="rs-badges">${TRAINERS.map((trainer, i) => `<li>${i < ctx.save.ladderVictories ? badgeArt(i, 'earned', { label: t(trainer.badgeNameKey) }) : badgeArt(i, 'locked', { label: t('badge.locked') })}</li>`).join('')}</ul></section>`
      : '';
  return `<div class="rs-recap">${mvp}${stats ? `<div class="rs-stats">${stats}</div>` : ''}${gradeBlock}${moment}${trio}${featList}${streakLine}${adviceList}${badges}</div>`;
}

function openRecap(win) {
  openSheet({
    title: t('result.recapTitle'),
    body: recapHtml(win),
    actions: [
      {
        label: t('result.chronicle'),
        icon: 'scroll',
        action: 'result-log',
        keepOpen: true,
        onSelect: (close) => {
          close();
          openBattleLog();
        },
      },
    ],
  });
}

function renderResults(win) {
  disposeArena();
  ctx.previousScreen = 'title';
  screen.dataset.page = 'results';
  screen.className = 'screen';
  const session = ctx.battleSession,
    state = session.state,
    mode = session.mode,
    recap = battleRecap(state),
    grade = ctx.pendingRewards?.grade,
    chromatiques = (ctx.pendingRewards?.mastery || [])
      .filter((reward) => reward.beforeRank < CHROMATIQUE_RANK && chromatiqueUnlocked(reward.id, ctx.save))
      .map((reward) => reward.id),
    { primary, secondary } = resultActions(win, mode),
    hero = heroHtml(win, recap, chromatiques, grade, ctx.pendingRewards?.badge ?? null);
  screen.innerHTML = `<div class="shell rs rs--${win ? 'win' : 'loss'}${chromatiques.length ? ' rs--chroma' : ''}">${win ? confettiHtml() : ''}<main class="rs-stage"><div class="rs-lead"><header class="rs-head"><h1 class="rs-title">${win ? t('result.victory') : t('result.defeat')}</h1><p class="rs-sub">${resultSubtitle(win, mode)}</p></header>${hero}</div><div class="rs-side"><ul class="rs-team">${teamRowsHtml(state)}</ul>${highlightHtml(win, state, chromatiques)}<div class="rs-tools"><button type="button" class="rs-link" data-action="result-recap">${t('result.recapLink')}</button><div class="icon-actions">${chromeActions()}</div></div><nav class="rs-actions" aria-label="${escapeHtml(t('result.actionsLabel'))}"><button type="button" class="primary-btn rs-cta" data-action="${primary.action}">${primary.label}</button><div class="rs-more">${secondary.map((item) => `<button type="button" class="subtle-btn" data-action="${item.action}">${icon(item.icon)}<span>${item.label}</span></button>`).join('')}</div></nav></div></main><div id="replacement-root"></div></div>`;
  bindCommon();
  // A run with a cleared stage (this win, or earlier ones before a lost stage) is still live
  // between stages: leaving asks first.
  const run = ctx.gauntletRun;
  if (mode === 'gauntlet' && run.stage < GAUNTLET_STAGES.length && (win || run.stage > 0)) guardGauntletRun();
  // bindCommon() → setScreen() cancels stale battle SFX, so the sting starts
  // after it. Re-renders of the same battle (Settings return, language
  // switch) must not replay the sting or the stamp thunk.
  const firstShow = !resultsShown.has(state);
  resultsShown.add(state);
  if (firstShow) {
    if (win) sound.victory();
    else sound.defeat();
  }
  // The rank stamp lands after the fanfare with a soft thunk (existing synth hit). Skipped
  // under ?animations=0.
  if (firstShow && testAnimationScale !== 0 && screen.querySelector('.rs-stamp')) {
    setTimeout(
      () => {
        if (ctx.battleSession === session && screen.dataset.page === 'results') sound.hit('force');
      },
      isReducedMotion() ? STAMP_LAND_REDUCED_MS : STAMP_LAND_MS
    );
  }
  if (!firstShow) screen.querySelector('.rs')?.classList.add('rs--settled');
  const on = (action, handler) =>
    screen
      .querySelectorAll(`[data-action="${action}"]`)
      .forEach((button) => button.addEventListener('click', handler));
  on('result-recap', () => openRecap(win));
  // After a League win, Équipe prepares the next rival (like "Rival suivant", but through team
  // select); otherwise it reopens this battle's team select.
  on(
    'adjust-team',
    win && mode === 'ladder' && ctx.save.ladderVictories < LADDER_COUNT
      ? () => {
          ctx.selection = null;
          renderTeamSelect('ladder');
        }
      : adjustBattleTeam
  );
  on('rematch', () => {
    const config = { ...ctx.battleSession };
    delete config.state;
    delete config.lastLine;
    startBattle(config);
  });
  // "Rival suivant" plays the next League duel straight away with the same team, like JOUER.
  on('next-battle', () => startSelectionBattle(newSelection('ladder')));
  on('replay-draft', startDraft);
  on('challenges', () => {
    renderTitle();
    openChallenges();
  });
  on('pick-team', completeTutorial);
  on('next-circuit', () => {
    ctx.selection = null;
    renderTeamSelect('circuit');
  });
  on('next-trial', () => {
    ctx.selection = null;
    renderTrials();
  });
  on('next-stage', advanceGauntlet);
  on('new-gauntlet', () => {
    ctx.selection = null;
    renderTeamSelect('gauntlet');
  });
  on('new-battle', () => {
    ctx.selection = null;
    renderTeamSelect('quick');
  });
  on('league', renderLeague);
  on('academy', renderAcademy);
  screen.querySelectorAll('[data-chromatique]').forEach((toggle) =>
    toggle.addEventListener('click', () => {
      const shown = setChromatique(
        toggle.dataset.chromatique,
        toggle.getAttribute('aria-checked') !== 'true'
      );
      toggle.setAttribute('aria-checked', String(shown));
      sound.ui();
    })
  );
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
