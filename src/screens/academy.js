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
  const statuses = Object.entries(STATUS_DEFINITIONS)
      .map(
        ([id, meta]) =>
          `<article class="academy-status ${meta.positive ? 'boon' : 'penalty'}" style="--status-color:${meta.color}"><i>${meta.icon}</i><span><b>${t(`status.${id}`)}${meta.stackable ? ` <em>×${meta.maxStacks}</em>` : ''}</b><small>${t(`status.effect.${id}`)}</small></span></article>`
      )
      .join('');
  const icons = ['♥', '↺', '◈', '3', '»', '✦', '☿', '◎'],
    core = Array.from({ length: 8 }, (_, index) => {
      const number = index + 1,
        extra =
          number === 3
            ? `<div class="academy-affinity-track">${cycle}</div><p class="academy-core-note">${t('academy.affinityHint')}</p>`
            : number === 7
              ? `<div class="academy-status-grid academy-status-grid-all">${statuses}</div>`
              : '';
      return `<article class="academy-core academy-core-${number}"><header><i>${icons[index]}</i><span><small>${number}/8</small><h2>${t(`academy.core.${number}.title`)}</h2></span></header><p>${t(`academy.core.${number}.desc`)}</p>${extra}</article>`;
    }).join('');
  screen.innerHTML = `<div class="shell academy-page">${topbar()}<div class="page-head academy-head"><div><span class="eyebrow">24 · 72 · 3v3</span><h1>${t('academy.title')}</h1><p>${t('academy.subtitle')}</p></div>${actionButton(t('academy.openBestiary'), 'academy-bestiary', 'primary-btn')}</div><section class="academy-section academy-essentials"><div class="academy-section-title"><span class="eyebrow">✦ ${t('academy.essentials')}</span></div><div class="academy-core-grid">${core}</div></section><section class="academy-section academy-deeper"><h2>${t('academy.affinities')} · ${t('academy.statuses')}</h2><p>${t('academy.surge')}</p><p>${t('academy.command')}</p></section><div class="academy-footer">${actionButton(t('academy.openBestiary'), 'academy-bestiary', 'primary-btn')}</div></div>`;
  bindCommon();
  screen
    .querySelectorAll('[data-action="academy-bestiary"]')
    .forEach((button) => button.addEventListener('click', renderBestiary));
}

registerRoutes({ renderAcademy });
