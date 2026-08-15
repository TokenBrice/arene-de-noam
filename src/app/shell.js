import { ctx, registerRoutes, route } from './context.js';

const {
  AFFINITIES,
  AFFINITY_ORDER,
  CLASSES,
  CLASS_ORDER,
  CREATURES,
  CREATURE_IDS,
  CURRENT_FEAT_IDS,
  previewMove,
  i18n,
  t,
  screen,
  sound,
  sprite,
  creatureName,
  affinity,
  affinityName,
  affinityIcon,
  classIcon,
  className,
  persist,
  testAnimationScale,
} = ctx;
const {
  renderTitle,
  renderAcademy,
  renderLeague,
  renderTeamSelect,
  renderDraft,
  renderGauntletBoons,
  renderTrials,
  refreshBattle,
  renderResults,
  closeMoveTheater,
  openMoveTheater,
  renderBestiary,
  renderSettings,
} = route;

function currentMusicScreen() {
  if (ctx.battleSession && screen.classList.contains('battle-screen'))
    return `battle:${ctx.battleSession.arena}`;
  if (screen.dataset.page === 'results')
    return ctx.battleSession?.state.winner === 'player' ? 'victory' : 'defeat';
  return screen.dataset.page || 'title';
}

function bindCommon() {
  sound.setScreen(currentMusicScreen());
  const settingsBackRoutes = {
    title: renderTitle,
    selection: () => renderTeamSelect(ctx.selection?.mode),
    bestiary: renderBestiary,
    academy: renderAcademy,
    league: renderLeague,
    trials: renderTrials,
    draft: renderDraft,
    'gauntlet-boon': renderGauntletBoons,
    results: () => {
      const session = ctx.settingsBattleSession;
      ctx.settingsBattleSession = null;
      if (!session) {
        renderTitle();
        return;
      }
      ctx.battleSession = session;
      renderResults(session.state.winner === 'player');
    },
  };
  screen.querySelectorAll('.topbar > [data-action]').forEach((button) => {
    if (!button.classList.contains('subtle-btn')) return;
    const handler = settingsBackRoutes[button.dataset.action] || renderTitle;
    button.addEventListener('click', handler);
  });
  screen
    .querySelectorAll('[data-action="settings"]')
    .forEach((b) =>
      b.addEventListener('click', () => {
        ctx.settingsReturn = screen.dataset.page || 'title';
        ctx.settingsBattleSession = ctx.battleSession;
        renderSettings();
      })
    );
  screen.querySelectorAll('[data-action="toggle-mute"]').forEach((b) =>
    b.addEventListener('click', () => {
      ctx.save.muted = !ctx.save.muted;
      persist();
      sound.ui();
      renderCurrent();
    })
  );
  if (screen.dataset.page === 'settings' && !screen.querySelector('#high-contrast')) {
    const motion = screen.querySelector('#motion')?.closest('.toggle-row');
    motion?.insertAdjacentHTML(
      'afterend',
      `<div class="toggle-row contrast-row"><label for="high-contrast"><strong>${t('settings.contrast')}</strong><small>${t('settings.contrastHint')}</small></label><input id="high-contrast" type="checkbox" ${ctx.save.highContrast ? 'checked' : ''}></div>`
    );
    screen.querySelector('#high-contrast')?.addEventListener('change', (event) => {
      ctx.save.highContrast = event.target.checked;
      persist();
    });
  }
  if (screen.dataset.page === 'bestiary' && screen.querySelector('.feat-hall .eyebrow')) {
    const visibleFeatIds = [
        ...CURRENT_FEAT_IDS,
        ...(ctx.save.feats.includes('team_assist') ? ['team_assist'] : []),
      ],
      earnedVisible = visibleFeatIds.filter((id) => ctx.save.feats.includes(id)).length;
    screen.querySelector('.feat-hall .eyebrow').textContent = `${earnedVisible}/${visibleFeatIds.length}`;
  }
  if (screen.dataset.page === 'bestiary') {
    const emptyRecord = { battles: 0, wins: 0, damage: 0, kos: 0, signatures: 0, combos: 0, assists: 0 },
      favorite = CREATURE_IDS.map((id) => ({ id, ...emptyRecord, ...(ctx.save.records?.[id] || {}) })).sort(
        (a, b) =>
          b.battles - a.battles ||
          b.damage - a.damage ||
          CREATURE_IDS.indexOf(a.id) - CREATURE_IDS.indexOf(b.id)
      )[0],
      favoriteAffinity = AFFINITIES[CREATURES[favorite.id].affinity],
      hero = favorite.battles
        ? `<section class="record-hero" style="--record-color:${favoriteAffinity.color}"><div class="record-creature"><img src="${sprite(favorite.id)}" alt=""><span><small>${t('record.favorite')}</small><h2>${creatureName(favorite.id)}</h2><p>${t('record.subtitle')}</p></span></div><div class="record-hero-stats"><span><b>${favorite.battles}</b><small>${t('record.battles')}</small></span><span><b>${favorite.wins}</b><small>${t('record.wins')}</small></span><span><b>${favorite.damage}</b><small>${t('record.damage')}</small></span><span><b>${favorite.kos}</b><small>${t('record.kos')}</small></span></div></section>`
        : `<section class="record-hero empty"><div><span class="eyebrow">${t('record.hall')}</span><h2>${t('record.none')}</h2></div></section>`;
    screen.querySelector('.feat-hall')?.insertAdjacentHTML('beforebegin', hero);
    screen.querySelectorAll('.bestiary-card').forEach((card, creatureIndex) => {
      const id = CREATURE_IDS[creatureIndex],
        record = { ...emptyRecord, ...(ctx.save.records?.[id] || {}) };
      card
        .querySelector('.passive-line')
        ?.insertAdjacentHTML(
          'beforebegin',
          `<div class="creature-record"><span><b>${record.battles}</b>${t('record.battles')}</span><span><b>${record.wins}</b>${t('record.wins')}</span><span><b>${record.damage}</b>${t('record.damage')}</span><span><b>${record.kos}</b>${t('record.kos')}</span><span><b>${record.signatures}</b>${t('record.signatures')}</span><span><b>${record.combos}</b>${t('record.combos')}</span>${record.assists ? `<span class="legacy-record"><b>${record.assists}</b>${t('record.assistsLegacy')}</span>` : ''}</div>`
        );
      card.querySelectorAll('[data-preview-move]').forEach((entry) => {
        const moveId = entry.dataset.previewMove;
        entry.setAttribute('role', 'button');
        entry.addEventListener('click', () => openMoveTheater(moveId));
      });
    });
  }
  if (screen.dataset.page === 'bestiary' && !screen.querySelector('.bestiary-tools'))
    installBestiaryFilters();
}

function installBestiaryFilters() {
  const cards = [...screen.querySelectorAll('.bestiary-card')];
  cards.forEach((card, index) => {
    card.dataset.creature = CREATURE_IDS[index];
    card.dataset.affinity = CREATURES[CREATURE_IDS[index]].affinity;
    card.dataset.class = CREATURES[CREATURE_IDS[index]].classId;
  });
  screen
    .querySelector('.bestiary-grid')
    ?.insertAdjacentHTML(
      'beforebegin',
      `<section class="bestiary-tools"><label><span>⌕</span><input type="search" data-bestiary-search aria-label="${t('bestiary.search')}" placeholder="${t('bestiary.search')}"></label><div class="bestiary-filter-row" aria-label="${t('filter.types')}"><b>${t('filter.types')}</b><button type="button" class="active" data-bestiary-affinity="all" aria-pressed="true">${CREATURE_IDS.length}</button>${AFFINITY_ORDER.map((id) => `<button type="button" data-bestiary-affinity="${id}" aria-pressed="false" style="--filter-color:${AFFINITIES[id].color}">${affinityIcon(id)} ${affinityName(id)}</button>`).join('')}</div><div class="bestiary-filter-row class-filter-row" aria-label="${t('filter.classes')}"><b>${t('filter.classes')}</b><button type="button" class="active" data-bestiary-class="all" aria-pressed="true">${CREATURE_IDS.length}</button>${CLASS_ORDER.map((id) => `<button type="button" data-bestiary-class="${id}" aria-pressed="false" style="--class-color:${CLASSES[id].color}">${classIcon(id)} ${className(id)}</button>`).join('')}</div><b data-bestiary-count>${CREATURE_IDS.length} / ${CREATURE_IDS.length}</b></section>`
    );
  const input = screen.querySelector('[data-bestiary-search]'),
    count = screen.querySelector('[data-bestiary-count]');
  let activeAffinity = 'all',
    activeClass = 'all';
  const apply = () => {
    const query = input.value.trim().toLocaleLowerCase(i18n.lang),
      visible = cards.filter((card) => {
        const show =
          (activeAffinity === 'all' || card.dataset.affinity === activeAffinity) &&
          (activeClass === 'all' || card.dataset.class === activeClass) &&
          creatureName(card.dataset.creature).toLocaleLowerCase(i18n.lang).includes(query);
        card.hidden = !show;
        return show;
      });
    count.textContent = `${visible.length} / ${CREATURE_IDS.length}`;
    if (query && visible.length === 1) {
      const card = visible[0],
        summary = card.querySelector('.bestiary-summary'),
        detail = card.querySelector('.bestiary-detail');
      summary?.setAttribute('aria-expanded', 'true');
      card.classList.add('expanded');
      if (summary?.querySelector('.bestiary-expand'))
        summary.querySelector('.bestiary-expand').textContent = '−';
      if (detail) detail.hidden = false;
    }
  };
  input.addEventListener('input', apply);
  screen.querySelectorAll('[data-bestiary-affinity]').forEach((button) =>
    button.addEventListener('click', () => {
      activeAffinity = button.dataset.bestiaryAffinity;
      screen.querySelectorAll('[data-bestiary-affinity]').forEach((item) => {
        item.classList.toggle('active', item === button);
        item.setAttribute('aria-pressed', String(item === button));
      });
      apply();
    })
  );
  screen.querySelectorAll('[data-bestiary-class]').forEach((button) =>
    button.addEventListener('click', () => {
      activeClass = button.dataset.bestiaryClass;
      screen.querySelectorAll('[data-bestiary-class]').forEach((item) => {
        item.classList.toggle('active', item === button);
        item.setAttribute('aria-pressed', String(item === button));
      });
      apply();
    })
  );
}

function renderCurrent() {
  sound.setScreen(currentMusicScreen());
  if (ctx.battleSession && screen.classList.contains('battle-screen')) refreshBattle();
  else if (screen.dataset.page === 'title') renderTitle();
  else if (screen.dataset.page === 'selection') renderTeamSelect(ctx.selection.mode);
  else if (screen.dataset.page === 'league') renderLeague();
  else if (screen.dataset.page === 'academy') renderAcademy();
  else if (screen.dataset.page === 'bestiary') renderBestiary();
  else if (screen.dataset.page === 'trials') renderTrials();
  else if (screen.dataset.page === 'draft') renderDraft();
  else if (screen.dataset.page === 'gauntlet-boon') renderGauntletBoons();
  else if (screen.dataset.page === 'results') renderResults(ctx.battleSession?.state.winner === 'player');
  else renderSettings();
}

/* Minimal shared route transition. The new screen renders synchronously and
   fades/slides in, while a short full-screen veil supplies the visual handoff.
   Keeping only one semantic DOM tree avoids duplicate headings, labels, and
   live regions during the transition. Skipped for same-page re-renders, the
   boot screen, reduced motion, and ?animations=0. */
const SCREEN_TRANSITION_PAGES = {
  renderTitle: 'title',
  renderAcademy: 'academy',
  renderLeague: 'league',
  renderTeamSelect: 'selection',
  renderDraft: 'draft',
  renderGauntletBoons: 'gauntlet-boon',
  renderTrials: 'trials',
  renderBestiary: 'bestiary',
  renderSettings: 'settings',
  renderBattle: 'battle',
};
function transitionScreen(render, targetPage) {
  const samePage = !screen.dataset.page || screen.dataset.page === targetPage;
  if (testAnimationScale === 0 || ctx.save.reducedMotion || samePage) {
    render();
    return;
  }
  render();
  screen.classList.add('screen-entering');
  const veil = document.createElement('i');
  veil.className = 'screen-transition-veil';
  veil.setAttribute('aria-hidden', 'true');
  document.body.append(veil);
  setTimeout(() => {
    veil.remove();
    screen.classList.remove('screen-entering');
  }, 340);
}
export function installScreenTransitions() {
  for (const [name, page] of Object.entries(SCREEN_TRANSITION_PAGES)) {
    const render = ctx.routes[name];
    if (render) ctx.routes[name] = (...args) => transitionScreen(() => render(...args), page);
  }
}

function handleEscape() {
  const resetDialog = screen.querySelector('.settings-dialog');
  if (resetDialog) {
    resetDialog.querySelector('[data-action="reset-cancel"]')?.click();
    return;
  }
  if (screen.querySelector('.move-theater')) {
    closeMoveTheater();
    return;
  }
  if (screen.querySelector('.replacement') && !ctx.battleSession?.state.sides.player.pendingReplacement) {
    screen.querySelector('#replacement-root').innerHTML = '';
    return;
  }
  if (screen.dataset.page !== 'title' && screen.dataset.page !== 'battle') renderTitle();
}
function trapModalTab(event) {
  const dialog = screen.querySelector('[role="dialog"][aria-modal="true"]');
  if (!dialog || event.key !== 'Tab') return false;
  const items = [
    ...dialog.querySelectorAll(
      'button:not(:disabled),select:not(:disabled),input:not(:disabled),[tabindex="0"]'
    ),
  ].filter((item) => item.getBoundingClientRect().width > 0);
  if (!items.length) {
    event.preventDefault();
    dialog.focus();
    return true;
  }
  const first = items[0],
    last = items.at(-1);
  if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
  return true;
}

registerRoutes({ bindCommon, installBestiaryFilters, renderCurrent, handleEscape, trapModalTab });
