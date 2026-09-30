import { ctx, registerRoutes, route } from '../app/context.js';
import { icon } from '../app/icons.js';

const {
  CREATURE_IDS,
  GAUNTLET_STAGES,
  TRAINERS,
  TRIALS,
  LADDER_COUNT,
  loaded,
  t,
  screen,
  sprite,
  creatureName,
  notify,
  disposeArena,
  testAnimationScale,
  unlockedModes,
  badgeArt,
  chromeActions,
} = ctx;
const {
  bindCommon,
  openSheet,
  newSelection,
  startSelectionBattle,
  startTutorial,
  renderTeamSelect,
  renderLeague,
  startDraft,
  renderTrials,
  renderBestiary,
  renderAcademy,
  renderGauntletBoons,
} = route;

// Title = mode hub: the lead creature on a spotlight, the League strip, one
// gold JOUER and four mode tiles. JOUER opens the tutorial on a fresh save and
// otherwise starts the next League (or Circuit) battle straight away with the
// saved team; "Mon équipe" is the way into team select.

const isValidTeam = (team) =>
  team.length === 3 && new Set(team).size === 3 && team.every((id) => CREATURE_IDS.includes(id));

function playIntent() {
  if (!ctx.save.tutorialComplete) return { action: 'play', hint: t('hub.playFirst') };
  if (ctx.save.ladderVictories >= LADDER_COUNT) return { action: 'circuit', hint: t('circuit.play') };
  return {
    action: 'continue',
    hint: isValidTeam(ctx.save.lastTeam) ? t('hub.playLeague') : t('hub.playPick'),
  };
}

function ladderMode() {
  return ctx.save.ladderVictories >= LADDER_COUNT ? 'circuit' : 'ladder';
}

// newSelection lives in the lazy screens chunk: its route call may resolve later.
async function play() {
  if (!ctx.save.tutorialComplete) {
    startTutorial();
    return;
  }
  const mode = ladderMode();
  ctx.selection = await newSelection(mode);
  if (isValidTeam(ctx.selection.team)) startSelectionBattle(ctx.selection);
  else renderTeamSelect(mode);
}

// The trio carries data-shared-creature: team select shows the same creatures in its slots, and
// the route transition (shell.js) moves each one between the two screens.
function heroHtml() {
  const [lead, ...bench] = ctx.save.lastTeam;
  const benchHtml = bench
    .map(
      (id, index) =>
        `<img class="hub-bench hub-bench-${index ? 'right' : 'left'}" src="${sprite(id)}" alt="${creatureName(id)}" width="128" height="128" decoding="async" data-shared-creature="${id}">`
    )
    .join('');
  return `<section class="hub-hero"><div class="hub-stage"><i class="hub-cone" aria-hidden="true"></i><i class="hub-pad" aria-hidden="true"></i>${benchHtml}<div class="hub-lead"><img src="${sprite(lead)}" alt="${creatureName(lead)}" width="128" height="128" data-shared-creature="${lead}"></div></div></section>`;
}

// The strip's twelve badges, in the same art as the League map and the results.
function leagueHtml() {
  const progress = Math.min(ctx.save.ladderVictories, LADDER_COUNT),
    next = progress < LADDER_COUNT ? t(TRAINERS[progress].nameKey) : t('hub.leagueDone'),
    badges = TRAINERS.map((_, index) =>
      badgeArt(index, index < progress ? 'earned' : index === progress ? 'open' : 'locked')
    ).join('');
  return `<button type="button" class="hub-league" data-action="league"><span class="hub-league-icon">${icon('trophy')}</span><span class="hub-league-text"><b>${t('hub.league', { count: progress, total: LADDER_COUNT })}</b><small>${next}</small></span><span class="hub-badges" aria-hidden="true">${badges}</span>${icon('chevron-right')}</button>`;
}

function tileHtml(action, iconName, label, hint, marker = '') {
  return `<button type="button" class="hub-tile hub-tile--${action}" data-action="${action}"><span class="hub-tile-icon">${icon(iconName)}</span><span class="hub-tile-text"><b>${label}</b><small>${hint}</small></span>${marker}</button>`;
}

const newPill = () => `<span class="new-pill">${t('hub.new')}</span>`;

function statsLine() {
  const { wins, winStreak, bestGrade, battlesPlayed } = ctx.save;
  if (!battlesPlayed) return '';
  const parts = [t('hub.wins', { count: wins })];
  if (winStreak >= 2) parts.push(t('hub.streak', { count: winStreak }));
  if (bestGrade) parts.push(t('hub.bestGrade', { grade: bestGrade }));
  return `<p class="hub-stats">${parts.join(' · ')}</p>`;
}

// A live Expédition run with at least one cleared stage still to finish: the Défis sheet resumes
// it at the faveur screen instead of starting over.
function resumableGauntlet() {
  const run = ctx.gauntletRun;
  return run && run.stage > 0 && run.stage < GAUNTLET_STAGES.length ? run : null;
}

// In unlock order (2, 4 then 6 badges), so open modes come first.
const CHALLENGES = [
  { action: 'gauntlet', icon: 'mountain', label: 'app.gauntlet' },
  { action: 'trials', icon: 'crown', label: 'app.trials' },
  { action: 'draft', icon: 'calendar', label: 'app.draft' },
];

// A side mode is "Nouveau" while it is open and was never played, read from the save as it is
// (no flag of its own): no Expédition won or under way, no trial cleared, no Pioche won.
const PLAYED = Object.freeze({
  gauntlet: (save) => save.gauntletWins > 0 || Boolean(resumableGauntlet()),
  trials: (save) => save.trials.length > 0,
  draft: (save) => save.draftWins > 0,
});
const isNewMode = (action, modes) => modes[action].unlocked && !PLAYED[action](ctx.save);

function challengeHint(action) {
  if (action === 'draft') return t('hub.draftHint');
  if (action === 'gauntlet') return t('hub.gauntletHint', { count: GAUNTLET_STAGES.length });
  return t('hub.trialsHint', { count: ctx.save.trials.length, total: TRIALS.length });
}

// A live Expédition run with a cleared stage takes the Expédition row (resumableGauntlet).
function challengeRow({ action, icon: iconName, label }, modes) {
  const run = action === 'gauntlet' ? resumableGauntlet() : null,
    { unlocked, badgesNeeded } = modes[action],
    title = run ? t('hub.gauntletResume') : t(label),
    detail = run
      ? `<small>${t('hub.gauntletResumeHint', { round: run.stage + 1, total: GAUNTLET_STAGES.length })}</small>`
      : unlocked
        ? `<small>${challengeHint(action)}</small>`
        : `<small class="hub-lock">${icon('lock')}<span>${t('hub.locked', { count: badgesNeeded - ctx.save.ladderVictories })}</span></small>`;
  return `<button type="button" class="hub-challenge hub-challenge--${action}${unlocked ? '' : ' is-locked'}" data-action="${action}"${run ? ' data-resume' : ''}${unlocked ? '' : ' disabled'}><span class="hub-challenge-icon">${icon(iconName)}</span><span class="hub-challenge-text"><b>${title}</b>${detail}</span>${unlocked ? icon('chevron-right') : ''}${isNewMode(action, modes) ? newPill() : ''}</button>`;
}

function openChallenges() {
  const modes = unlockedModes(ctx.save),
    rows = CHALLENGES.map((challenge) => challengeRow(challenge, modes)).join('');
  openSheet({ title: t('hub.challenges'), body: `<div class="hub-challenges">${rows}</div>` });
  const routes = {
    draft: startDraft,
    gauntlet: () => (resumableGauntlet() ? renderGauntletBoons() : renderTeamSelect('gauntlet')),
    trials: renderTrials,
  };
  screen
    .querySelectorAll('.hub-challenge:not(:disabled)')
    .forEach((button) => button.addEventListener('click', () => routes[button.dataset.action]()));
}

function renderTitle() {
  disposeArena();
  ctx.battleSession = null;
  ctx.selection = null;
  ctx.draftRun = null;
  ctx.previousScreen = 'title';
  screen.dataset.page = 'title';
  screen.className = 'screen hub-screen';
  const intent = playIntent(),
    modes = unlockedModes(ctx.save),
    lockedCount = CHALLENGES.filter(({ action }) => !modes[action].unlocked).length,
    still = testAnimationScale === 0 || ctx.save.reducedMotion;
  const icons = `<div class="hub-icons">${chromeActions()}</div>`;
  const playRow = `<div class="hub-play-row"><button type="button" class="primary-btn hub-play" data-action="${intent.action}"><span class="hub-play-label">${t('app.play')}</span><small>${intent.hint}</small></button><button type="button" class="subtle-btn hub-team" data-action="team">${icon('team')}<span>${t('hub.team')}</span></button></div>`;
  const tiles = [
    tileHtml('quick', 'sword', t('app.quick'), t('hub.quickHint')),
    tileHtml(
      'challenges',
      'flag',
      t('hub.challenges'),
      lockedCount ? t('hub.challengesLocked', { count: lockedCount }) : t('hub.challengesHint'),
      CHALLENGES.some(({ action }) => isNewMode(action, modes)) ? newPill() : ''
    ),
    tileHtml('bestiary', 'book', t('hub.creatures'), t('hub.creaturesHint', { count: CREATURE_IDS.length })),
    tileHtml('academy', 'school', t('app.academy'), t('hub.schoolHint')),
  ].join('');
  screen.innerHTML = `<div class="hub${still ? ' hub-still' : ''}"><h1 class="hub-logo">${t('title.brandPrefix')} <span>${t('title.brandName')}</span></h1>${icons}${heroHtml()}${leagueHtml()}${playRow}<nav class="hub-modes" aria-label="${t('title.battleModes')}">${tiles}</nav>${statsLine()}</div>`;
  bindCommon();
  screen.querySelector('.hub-play').addEventListener('click', play);
  screen
    .querySelector('[data-action="team"]')
    .addEventListener('click', () => renderTeamSelect(ladderMode()));
  screen.querySelector('[data-action="league"]').addEventListener('click', renderLeague);
  screen.querySelector('[data-action="quick"]').addEventListener('click', () => renderTeamSelect('quick'));
  screen.querySelector('[data-action="challenges"]').addEventListener('click', openChallenges);
  screen.querySelector('[data-action="bestiary"]').addEventListener('click', renderBestiary);
  screen.querySelector('[data-action="academy"]').addEventListener('click', renderAcademy);
  if (loaded.notice) {
    notify(t(`notice.${loaded.notice}`));
    loaded.notice = null;
  }
}

registerRoutes({ renderTitle, openChallenges });
