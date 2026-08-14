import { ctx, registerRoutes, route } from '../app/context.js';

const {
  AFFINITIES,
  AFFINITY_ORDER,
  STATUS_DEFINITIONS,
  t,
  screen,
  affinity,
  affinityName,
  actionButton,
  disposeArena,
  topbar,
} = ctx;
const { bindCommon, renderBestiary } = route;

function renderAcademy() {
  disposeArena();
  ctx.battleSession = null;
  ctx.selection = null;
  ctx.previousScreen = 'title';
  screen.dataset.page = 'academy';
  screen.className = 'screen';
  const cycle = AFFINITY_ORDER.map((id, index) => {
    const next = AFFINITY_ORDER[(index + 1) % AFFINITY_ORDER.length],
      a = AFFINITIES[id],
      target = AFFINITIES[next];
    return `<div class="academy-affinity" style="--academy-color:${a.color};--target-color:${target.color}"><i>${a.icon}</i><span><b>${affinityName(id)}</b><small>${t('academy.beats')}</small></span><em>→</em><u title="${affinityName(next)}" aria-label="${affinityName(next)}">${target.icon}</u></div>`;
  }).join('');
  const statusGroup = (positive) =>
    Object.entries(STATUS_DEFINITIONS)
      .filter(([, meta]) => meta.positive === positive)
      .map(
        ([id, meta]) =>
          `<article class="academy-status ${positive ? 'boon' : 'penalty'}" style="--status-color:${meta.color}"><i>${meta.icon}</i><span><b>${t(`status.${id}`)}${meta.stackable ? ` <em>×${meta.maxStacks}</em>` : ''}</b><small>${t(`status.effect.${id}`)}</small></span></article>`
      )
      .join('');
  const mechanics = [
    ['✦', t('battle.surge'), t('academy.surge')],
    ['⚑', t('battle.command'), t('academy.command')],
    ['↺', t('battle.switchRead'), t('battle.perfectRelayHint')],
    ['↗', t('battle.teamAssist'), t('academy.assist')],
    ['⚔', t('battle.finalDuel'), t('battle.finalDuelHint')],
  ]
    .map(
      ([icon, title, copy]) =>
        `<article class="academy-mechanic"><i>${icon}</i><span><b>${title}</b><small>${copy}</small></span></article>`
    )
    .join('');
  screen.innerHTML = `<div class="shell academy-page">${topbar()}<div class="page-head academy-head"><div><span class="eyebrow">24 · 72 · 3v3</span><h1>${t('academy.title')}</h1><p>${t('academy.subtitle')}</p></div>${actionButton(t('academy.openBestiary'), 'academy-bestiary', 'primary-btn')}</div><section class="academy-cycle"><div><span class="eyebrow">◈ ${t('academy.affinities')}</span><p>${t('academy.affinityHint')}</p></div><div class="academy-affinity-track">${cycle}</div></section><section class="academy-section"><div class="academy-section-title"><span class="eyebrow">✦ ${t('academy.mechanics')}</span></div><div class="academy-mechanics">${mechanics}</div></section><section class="academy-section"><div class="academy-section-title"><span class="eyebrow">☿ ${t('academy.statuses')}</span></div><div class="academy-status-columns"><div><h2>✦ ${t('academy.boons')}</h2><div class="academy-status-grid">${statusGroup(true)}</div></div><div><h2>☾ ${t('academy.penalties')}</h2><div class="academy-status-grid">${statusGroup(false)}</div></div></div></section></div>`;
  bindCommon();
  screen.querySelector('[data-action="academy-bestiary"]')?.addEventListener('click', renderBestiary);
}

registerRoutes({ renderAcademy });
