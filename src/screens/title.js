import { ctx, registerRoutes, route } from '../app/context.js';

const {
  CREATURE_IDS,
  CURRENT_FEAT_IDS,
  masteryRank,
  TRAINERS,
  TRIALS,
  loaded,
  i18n,
  t,
  screen,
  LADDER_COUNT,
  sprite,
  creatureName,
  actionButton,
  notify,
  disposeArena,
  emblemHtml,
  topbar,
} = ctx;
const {
  bindCommon,
  renderAcademy,
  renderLeague,
  renderTeamSelect,
  startDraft,
  renderTrials,
  startTutorial,
  renderBestiary,
} = route;

function renderTitle() {
  disposeArena();
  ctx.battleSession = null;
  ctx.selection = null;
  ctx.gauntletRun = null;
  ctx.draftRun = null;
  ctx.previousScreen = 'title';
  screen.dataset.page = 'title';
  screen.className = 'screen';
  const progress = ctx.save.ladderVictories,
    featured = CREATURE_IDS.filter((_, i) => i % 4 === Math.min(3, Math.floor(progress / 3))).slice(0, 6);
  const totalRanks = CREATURE_IDS.reduce((sum, id) => sum + masteryRank(ctx.save.mastery[id] || 0), 0),
    visibleFeatIds = [
      ...CURRENT_FEAT_IDS,
      ...(ctx.save.feats.includes('team_assist') ? ['team_assist'] : []),
    ],
    earnedFeats = visibleFeatIds.filter((id) => ctx.save.feats.includes(id)).length,
    featTotal = visibleFeatIds.length;
  const primaryButton =
    progress >= LADDER_COUNT
      ? actionButton(`${t('circuit.play')} <span>♛</span>`, 'circuit', 'primary-btn')
      : ctx.save.tutorialComplete
        ? actionButton(`${t('app.continue')} <span>→</span>`, 'continue', 'primary-btn')
        : actionButton(`${t('app.play')} <span>→</span>`, 'play', 'primary-btn');
  screen.innerHTML = `<div class="title-ambience" aria-hidden="true">${'<i></i>'.repeat(8)}</div><div class="shell"><header class="topbar"><div class="brand-small">✦ ${t('app.title')}</div><div class="icon-actions"><button class="icon-btn" data-action="toggle-mute" aria-label="${t('settings.mute')}" aria-pressed="${ctx.save.muted}">${ctx.save.muted ? '🔇' : '🔊'}</button><button class="icon-btn" data-action="settings" aria-label="${t('app.settings')}">⚙</button></div></header><div class="hero"><section class="hero-copy"><div class="eyebrow">${t('title.rosterLine')}</div><h1>${i18n.lang === 'fr' ? 'Arène de' : 'Noam’s'} <span>${i18n.lang === 'fr' ? 'Noam' : 'Arena'}</span></h1><p>${t('app.tagline')}</p><div class="menu"><div class="menu-primary">${primaryButton}</div><div class="menu-group"><span class="menu-label">${t('title.battleModes')}</span><div class="menu-mode-grid">${actionButton(`${t('app.league')} <span>♜</span>`, 'league', 'league-btn')}${actionButton(`${t('app.gauntlet')} <span>↟</span>`, 'gauntlet', 'gauntlet-btn')}${actionButton(`${t('app.draft')} <span>◫</span>`, 'draft', 'draft-btn')}${actionButton(`${t('app.trials')} <span>♛</span>`, 'trials', 'trial-btn')}${actionButton(`${t('app.quick')} <span>⚡</span>`, 'quick')}</div></div><div class="menu-group menu-library"><span class="menu-label">${t('title.library')}</span><div class="menu-library-grid">${actionButton(`${t('app.bestiary')} <span>◈</span>`, 'bestiary')}${actionButton(`${t('app.academy')} <span>◎</span>`, 'academy')}</div></div></div></section><aside class="glass-panel progress-card"><div class="progress-orbit"></div><span class="eyebrow">${t('title.progress')}</span><h2>${t('title.emblems', { count: progress })}</h2>${ctx.save.winStreak ? `<div class="streak-banner"><i>🔥</i><span><b>${t('streak.current', { count: ctx.save.winStreak })}</b><small>${t('streak.best', { count: ctx.save.bestStreak })}</small></span></div>` : ''}<div class="career-strip"><span>★ ${t('mastery.total', { count: totalRanks })}</span><span>◆ ${t('feat.total', { count: earnedFeats, total: featTotal })}</span><span>♛ ${ctx.save.trials.length}/${TRIALS.length}</span><span>↟ ${ctx.save.gauntletWins}</span><span>◫ ${ctx.save.draftWins}</span>${ctx.save.circuitWins ? `<span title="${t('circuit.title')}">♚ ${ctx.save.circuitWins}</span>` : ''}<span title="${t('grade.best')}">◇ ${ctx.save.bestGrade || '—'}</span><span title="${t('streak.best', { count: ctx.save.bestStreak })}">🔥 ${ctx.save.bestStreak}</span><span>⚔ ${ctx.save.wins}/${ctx.save.battlesPlayed}</span></div><button class="emblem-map" data-action="league" aria-label="${t('app.league')}"><div class="emblems epic-emblems">${TRAINERS.map((_, i) => emblemHtml(i, i < progress)).join('')}</div></button><div class="roster-fan">${featured.map((id) => `<img src="${sprite(id)}" alt="${creatureName(id)}">`).join('')}</div></aside></div></div>`;
  screen.querySelector('.hero-copy>.eyebrow').textContent = t('title.rosterLine');
  const careerStrip = screen.querySelector('.career-strip');
  careerStrip.innerHTML = `<div class="career-highlights"><span title="${t('streak.current', { count: ctx.save.winStreak })}">🔥 ${ctx.save.winStreak}</span><span title="${t('grade.best')}">◇ ${ctx.save.bestGrade || '—'}</span><span title="${t('title.battlesWon')}">⚔ ${ctx.save.wins}</span></div><button type="button" class="career-expander" aria-expanded="false" aria-controls="career-records">${t('title.allRecords')}</button><div class="career-records" id="career-records" hidden><span>★ ${t('mastery.total', { count: totalRanks })}</span><span>◆ ${t('feat.total', { count: earnedFeats, total: featTotal })}</span><span>♛ ${ctx.save.trials.length}/${TRIALS.length}</span><span>↟ ${ctx.save.gauntletWins}</span><span>◫ ${ctx.save.draftWins}</span>${ctx.save.circuitWins ? `<span title="${t('circuit.title')}">♚ ${ctx.save.circuitWins}</span>` : ''}<span title="${t('streak.best', { count: ctx.save.bestStreak })}">🔥 ${ctx.save.bestStreak}</span><span>⚔ ${ctx.save.wins}/${ctx.save.battlesPlayed}</span></div>`;
  bindCommon();
  screen.querySelector('.career-expander').addEventListener('click', (event) => {
    const button = event.currentTarget,
      expanded = button.getAttribute('aria-expanded') === 'true',
      records = screen.querySelector('#career-records');
    button.setAttribute('aria-expanded', String(!expanded));
    button.textContent = expanded ? t('title.allRecords') : t('title.hideRecords');
    records.hidden = expanded;
  });
  screen
    .querySelector('[data-action="play"]')
    ?.addEventListener('click', () =>
      ctx.save.tutorialComplete ? renderTeamSelect('ladder') : startTutorial()
    );
  screen
    .querySelector('[data-action="continue"]')
    ?.addEventListener('click', () => renderTeamSelect('ladder'));
  screen
    .querySelector('[data-action="circuit"]')
    ?.addEventListener('click', () => renderTeamSelect('circuit'));
  screen.querySelector('[data-action="quick"]')?.addEventListener('click', () => renderTeamSelect('quick'));
  screen
    .querySelectorAll('[data-action="league"]')
    .forEach((button) => button.addEventListener('click', renderLeague));
  screen
    .querySelector('[data-action="gauntlet"]')
    ?.addEventListener('click', () => renderTeamSelect('gauntlet'));
  screen.querySelector('[data-action="draft"]')?.addEventListener('click', startDraft);
  screen.querySelector('[data-action="trials"]')?.addEventListener('click', renderTrials);
  screen.querySelector('[data-action="bestiary"]')?.addEventListener('click', renderBestiary);
  screen.querySelector('[data-action="academy"]')?.addEventListener('click', renderAcademy);
  if (loaded.notice) {
    notify(t(`notice.${loaded.notice}`));
    loaded.notice = null;
  }
}

registerRoutes({ renderTitle });
