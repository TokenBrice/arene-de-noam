import { ctx, registerRoutes, route } from '../app/context.js';

const { TRIALS, t, screen, sound, sprite, creatureName, disposeArena, topbar } = ctx;
const { arenaWeatherHtml, bindCommon, icon, newSelection, renderTeamSelect } = route;

// Chrome icon per trial (the data keeps its glyph for other screens).
const TRIAL_SIGILS = Object.freeze({
  starstorm: 'sparkle',
  razorline: 'sword',
  unbroken: 'shield',
  eruption: 'mountain',
  lastlight: 'heart',
  ascension: 'crown',
});

// The open row (null: none) carries the screen's one gold button; tapping it again closes it.
let selectedTrial = null;

function detailHtml(trial, index) {
  const rivals = trial.enemyTeam
    .map(
      (id) =>
        `<figure><img src="${sprite(id, 'normal')}" alt="" width="128" height="128"><figcaption>${creatureName(id)}</figcaption></figure>`
    )
    .join('');
  return `<div class="trial-detail" id="trial-detail-${index}">${arenaWeatherHtml(trial.arena)}<div class="trial-enemies" role="group" aria-label="${t('trial.rivals')}">${rivals}</div><button type="button" class="primary-btn wide" data-action="trial-${index}">${t('trial.challenge')}</button></div>`;
}

function rowHtml(trial, index) {
  const cleared = ctx.save.trials.includes(trial.id),
    selected = index === selectedTrial,
    status = cleared
      ? `<span class="trial-clear">${icon('check', { label: t('trial.complete') })}</span>`
      : `<span class="trial-chevron">${icon('chevron-down')}</span>`;
  return `<li class="trial-row${selected ? ' selected' : ''}${cleared ? ' cleared' : ''}" style="--trial-a:${trial.colors[0]};--trial-b:${trial.colors[1]}"><button type="button" class="trial-pick" data-trial-select="${index}" aria-expanded="${selected}" aria-controls="trial-detail-${index}"><span class="trial-sigil">${icon(TRIAL_SIGILS[trial.id])}</span><span class="trial-text"><b>${t(trial.nameKey)}</b><small>${t(trial.descKey)}</small></span>${status}</button>${selected ? detailHtml(trial, index) : ''}</li>`;
}

function bindDetail(index) {
  screen
    .querySelector(`[data-action="trial-${index}"]`)
    ?.addEventListener('click', () => openTrialPreparation(index));
}

// Opening a row patches the list: the previous row closes, focus stays put. Tapping the open
// row folds it.
function selectTrial(index) {
  const previous = screen.querySelector('.trial-row.selected');
  previous?.classList.remove('selected');
  previous?.querySelector('.trial-detail')?.remove();
  previous?.querySelector('.trial-pick')?.setAttribute('aria-expanded', 'false');
  sound.ui();
  if (index === selectedTrial) {
    selectedTrial = null;
    return;
  }
  selectedTrial = index;
  const pick = screen.querySelector(`[data-trial-select="${index}"]`),
    row = pick.closest('.trial-row');
  row.classList.add('selected');
  pick.setAttribute('aria-expanded', 'true');
  row.insertAdjacentHTML('beforeend', detailHtml(TRIALS[index], index));
  bindDetail(index);
  row.scrollIntoView({ block: 'nearest' });
}

// The first visit opens the next trial to clear; later visits keep the player's choice.
let visited = false;

function renderTrials() {
  disposeArena();
  ctx.battleSession = null;
  ctx.selection = null;
  screen.dataset.page = 'trials';
  screen.className = 'screen';
  if (!visited) {
    visited = true;
    const next = TRIALS.findIndex((trial) => !ctx.save.trials.includes(trial.id));
    selectedTrial = next >= 0 ? next : 0;
  }
  const cleared = TRIALS.filter((trial) => ctx.save.trials.includes(trial.id)).length;
  screen.innerHTML = `<div class="shell trials-page">${topbar(t('trial.title'), { eyebrow: t('trial.count', { count: cleared, total: TRIALS.length }) })}<ol class="trial-list">${TRIALS.map(rowHtml).join('')}</ol></div>`;
  bindCommon();
  screen.querySelector('.trial-list').addEventListener('click', (event) => {
    const pick = event.target.closest('[data-trial-select]');
    if (pick) selectTrial(Number(pick.dataset.trialSelect));
  });
  if (selectedTrial !== null) bindDetail(selectedTrial);
}

function openTrialPreparation(index) {
  const trial = TRIALS[index];
  if (!trial) return;
  ctx.selection = {
    ...newSelection('quick'),
    mode: 'trial',
    team: [...ctx.save.lastTeam],
    enemyTeam: [...trial.enemyTeam],
    lead: 0,
    trainerIndex: 0,
    arena: trial.arena,
    difficulty: trial.difficulty,
    trialId: trial.id,
    modifiers: [...trial.modifiers],
  };
  renderTeamSelect('trial');
}

registerRoutes({ renderTrials, openTrialPreparation });
