import { ctx, registerRoutes, route } from '../app/context.js';

const { TRIALS, t, screen, sprite, creatureName, actionButton, disposeArena, topbar } = ctx;
const { bindCommon, newSelection, renderTeamSelect } = route;

function renderTrials() {
  disposeArena();
  ctx.battleSession = null;
  ctx.selection = null;
  ctx.previousScreen = 'title';
  screen.dataset.page = 'trials';
  screen.className = 'screen';
  const squad = ctx.save.lastTeam
    .map((id) => `<span><img src="${sprite(id)}" alt=""><b>${creatureName(id)}</b></span>`)
    .join('');
  screen.innerHTML = `<div class="shell">${topbar()}<div class="page-head"><div><span class="eyebrow">${ctx.save.trials.length}/${TRIALS.length} ${t('trial.cleared')}</span><h1>${t('trial.title')}</h1><p>${t('trial.subtitle')}</p></div><div class="trial-squad"><small>${t('trial.squad')}</small>${squad}</div></div><div class="trial-grid">${TRIALS.map((trial, index) => `<article class="trial-card ${ctx.save.trials.includes(trial.id) ? 'cleared' : ''}" style="--trial-a:${trial.colors[0]};--trial-b:${trial.colors[1]}"><div class="trial-sigil">${trial.icon}</div><span class="eyebrow">${t(`difficulty.${trial.difficulty}`)} · ${t(`arena.${trial.arena}`)}</span><h2>${t(trial.nameKey)}</h2><p>${t(trial.descKey)}</p><div class="trial-enemies">${trial.enemyTeam.map((id) => `<img src="${sprite(id)}" alt="${creatureName(id)}" title="${creatureName(id)}">`).join('')}</div>${ctx.save.trials.includes(trial.id) ? `<strong class="trial-clear">✓ ${t('trial.complete')}</strong>` : ''}${actionButton(t('trial.challenge'), `trial-${index}`, 'primary-btn wide')}</article>`).join('')}</div></div>`;
  bindCommon();
  TRIALS.forEach((trial, index) =>
    screen
      .querySelector(`[data-action="trial-${index}"]`)
      ?.addEventListener('click', () => openTrialPreparation(index))
  );
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
    doctrine: 'balanced',
    trialId: trial.id,
    modifiers: [...trial.modifiers],
  };
  renderTeamSelect('trial');
}

registerRoutes({ renderTrials, openTrialPreparation });
