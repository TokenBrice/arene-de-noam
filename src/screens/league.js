import { ctx, registerRoutes, route } from '../app/context.js';

const {
  TRAINERS,
  t,
  screen,
  LADDER_COUNT,
  sprite,
  creatureName,
  actionButton,
  disposeArena,
  emblemHtml,
  topbar,
} = ctx;
const { bindCommon, newSelection, renderTeamSelect } = route;

function openLeagueRival(index) {
  const trainer = TRAINERS[index];
  ctx.selection = newSelection('ladder');
  ctx.selection.trainerIndex = index;
  ctx.selection.enemyTeam = [...trainer.team];
  ctx.selection.arena = trainer.arena;
  ctx.selection.difficulty = index >= 9 ? 'champion' : index >= 4 ? 'challenger' : ctx.save.difficulty;
  renderTeamSelect('ladder');
}

function renderLeague() {
  disposeArena();
  ctx.battleSession = null;
  ctx.selection = null;
  ctx.previousScreen = 'title';
  screen.dataset.page = 'league';
  screen.className = 'screen';
  const progress = ctx.save.ladderVictories;
  const cards = TRAINERS.map((trainer, index) => {
    const cleared = index < progress,
      current = index === progress && progress < LADDER_COUNT,
      revealed = cleared || current || progress >= LADDER_COUNT,
      status = cleared ? t('league.cleared') : current ? t('league.current') : t('league.locked');
    return `<article class="league-rival ${cleared ? 'cleared' : current ? 'current' : 'locked'}" style="--rival-a:${trainer.colors[0]};--rival-b:${trainer.colors[1]}"><div class="league-step"><span>${String(index + 1).padStart(2, '0')}</span><i></i></div><div class="league-emblem">${emblemHtml(index, revealed)}</div><div class="league-dossier"><span class="eyebrow">${status}</span><h2>${revealed ? t(trainer.nameKey) : '???'}</h2>${revealed ? `<div class="league-meta"><span>✦ ${t(`arena.${trainer.arena}`)}</span><span>⌁ ${t(`style.${trainer.style}`)}</span></div><small>${t('league.squad')}</small><div class="league-team">${trainer.team.map((id) => `<span><img src="${sprite(id)}" alt="${creatureName(id)}"><b>${creatureName(id)}</b></span>`).join('')}</div><div class="league-ace"><b>♛ ${t(`ace.${trainer.ace}`)}</b><span>${t(`ace.effect.${trainer.ace}`)}</span></div>${actionButton(cleared ? t('league.replay') : t('league.challenge'), `league-${index}`, current ? 'primary-btn wide' : 'subtle-btn wide')}` : `<p class="league-hidden">◇ ${t('league.hidden')}</p>`}</div></article>`;
  }).join('');
  screen.innerHTML = `<div class="shell league-page">${topbar()}<div class="page-head league-head"><div><span class="eyebrow">${t('league.route')}</span><h1>${t('league.title')}</h1><p>${t('league.subtitle')}</p></div><strong>${t('league.record', { count: progress, total: LADDER_COUNT })}</strong></div><div class="league-route">${cards}</div></div>`;
  screen.querySelectorAll('.league-rival').forEach((card) => {
    const emblemColumn = document.createElement('div'),
      dossier = card.querySelector('.league-dossier'),
      ctaButton = dossier?.querySelector('[data-action^="league-"]');
    emblemColumn.className = 'league-emblem-column';
    emblemColumn.append(card.querySelector('.league-step'), card.querySelector('.league-emblem'));
    card.prepend(emblemColumn);
    if (ctaButton) {
      const cta = document.createElement('div');
      cta.className = 'league-cta';
      cta.append(ctaButton);
      card.append(cta);
    }
  });
  bindCommon();
  TRAINERS.forEach((_, index) =>
    screen
      .querySelector(`[data-action="league-${index}"]`)
      ?.addEventListener('click', () => openLeagueRival(index))
  );
}

registerRoutes({ openLeagueRival, renderLeague });
