import { ctx, registerRoutes, route } from '../app/context.js';

const {
  TRAINERS,
  GAUNTLET_BOONS,
  GAUNTLET_STAGES,
  bestLeadIndex,
  t,
  screen,
  sound,
  sprite,
  creatureName,
  persist,
  disposeArena,
  topbar,
  setLeaveGuard,
} = ctx;
const { arenaWeatherHtml, bindCommon, icon, startBattle, renderResults } = route;

// Chrome icon per boon (the data keeps its glyph).
const BOON_ICONS = Object.freeze({ surge: 'sparkle', aegis: 'shield', vitality: 'heart', focus: 'star' });

/* A run lives in memory only (ctx.gauntletRun, never persisted). Between stages (stage
   results, the faveur screen) leaving asks first and confirming drops the run. A run left
   through the battle pause stays live: once a stage is cleared, the Défis sheet offers to
   resume it at the faveur screen. */
function guardGauntletRun() {
  setLeaveGuard({
    message: t('gauntlet.leaveTitle'),
    detail: t('gauntlet.leaveDetail'),
    confirm: t('gauntlet.leaveConfirm'),
    cancel: t('gauntlet.leaveCancel'),
    onLeave: () => {
      ctx.gauntletRun = null;
    },
  });
}

// A live run with at least one cleared stage still to finish: the Défis sheet resumes it.
function resumableGauntlet() {
  const run = ctx.gauntletRun;
  return run && run.stage > 0 && run.stage < GAUNTLET_STAGES.length ? run : null;
}

function startGauntlet(team, lead) {
  ctx.gauntletRun = { team: [...team], lead, stage: 0, boons: [], condition: null, pendingBoon: null };
  startGauntletStage();
}
function startGauntletStage() {
  const stage = GAUNTLET_STAGES[ctx.gauntletRun.stage],
    boonModifiers = ctx.gauntletRun.boons
      .map((id) => GAUNTLET_BOONS.find((x) => x.id === id)?.modifier)
      .filter(Boolean);
  startBattle({
    playerTeam: [...ctx.gauntletRun.team],
    enemyTeam: [...stage.enemyTeam],
    playerLead: ctx.gauntletRun.lead,
    enemyLead: 0,
    mode: 'gauntlet',
    arena: stage.arena,
    difficulty: stage.difficulty,
    trainerIndex: stage.trainerIndex,
    gauntletStage: ctx.gauntletRun.stage,
    modifiers: [...stage.modifiers, ...boonModifiers],
    playerCondition: ctx.gauntletRun.condition,
  });
}

function advanceGauntlet() {
  ctx.gauntletRun.condition = Object.fromEntries(
    ctx.battleSession.state.sides.player.team.map((creature) => [
      creature.id,
      creature.hp > 0 ? Math.min(1, creature.hp / creature.maxHp + 0.24) : 0.4,
    ])
  );
  ctx.gauntletRun.stage++;
  ctx.gauntletRun.pendingBoon = null;
  if (ctx.gauntletRun.stage >= GAUNTLET_STAGES.length) {
    ctx.save.gauntletWins = Math.min(999, ctx.save.gauntletWins + 1);
    persist();
    renderResults(true);
    return;
  }
  // "Qui commence ?" opens on the Conseillé creature for the next stage.
  ctx.gauntletRun.lead = bestLeadIndex(
    ctx.gauntletRun.team,
    GAUNTLET_STAGES[ctx.gauntletRun.stage].enemyTeam
  );
  renderGauntletBoons();
}

const hpTone = (ratio) => (ratio > 0.5 ? 'high' : ratio >= 0.2 ? 'mid' : 'low');

function leadButtonHtml(id, index, recommended) {
  const run = ctx.gauntletRun,
    ratio = run.condition?.[id] ?? 1,
    percent = Math.round(ratio * 100),
    lead = run.lead === index,
    tag = recommended ? `<small class="gauntlet-tip">${icon('star')}${t('gauntlet.bestLead')}</small>` : '';
  return `<button type="button" class="gauntlet-lead${lead ? ' lead' : ''}${recommended ? ' recommended' : ''}" data-gauntlet-lead="${index}" aria-pressed="${lead}"><img src="${sprite(id)}" alt="" width="128" height="128"><b>${creatureName(id)}</b>${tag}<span class="gauntlet-hp hp-${hpTone(ratio)}" aria-hidden="true"><i style="transform:scaleX(${ratio})"></i></span><em class="num">${t('app.percent', { value: percent })}</em></button>`;
}

function boonHtml(boon) {
  const picked = ctx.gauntletRun.pendingBoon === boon.id;
  return `<button type="button" class="boon-card${picked ? ' picked' : ''}" data-boon="${boon.id}" aria-pressed="${picked}"><i>${icon(BOON_ICONS[boon.id])}</i><b>${t(`boon.${boon.id}`)}</b><small>${t(`boon.effect.${boon.id}`)}</small></button>`;
}

// A resumed run already took this stage's faveur: it lists the ones it holds instead.
function heldBoonHtml(id) {
  return `<li class="boon-card held"><i>${icon(BOON_ICONS[id])}</i><b>${t(`boon.${id}`)}</b><small>${t(`boon.effect.${id}`)}</small></li>`;
}

function renderGauntletBoons() {
  disposeArena();
  screen.dataset.page = 'gauntlet-boon';
  screen.className = 'screen';
  const run = ctx.gauntletRun,
    boonTaken = run.boons.length >= run.stage,
    available = GAUNTLET_BOONS.filter((boon) => !run.boons.includes(boon.id)),
    next = GAUNTLET_STAGES[run.stage],
    scoutedLead = bestLeadIndex(run.team, next.enemyTeam),
    colors = TRAINERS[next.trainerIndex].colors,
    rivals = next.enemyTeam
      .map((id) => `<img src="${sprite(id, 'normal')}" alt="${creatureName(id)}" width="128" height="128">`)
      .join(''),
    nextCard = `<section class="gauntlet-next league-card current" aria-labelledby="gauntlet-next-title" style="--rival-a:${colors[0]};--rival-b:${colors[1]}"><header class="league-card-head"><span class="eyebrow">${t('gauntlet.next')} · ${run.stage + 1}/${GAUNTLET_STAGES.length}</span><h2 id="gauntlet-next-title">${t(next.nameKey)}</h2></header><div class="league-card-team">${rivals}</div><div class="league-facts">${arenaWeatherHtml(next.arena)}</div></section>`,
    leadButtons = run.team.map((id, index) => leadButtonHtml(id, index, index === scoutedLead)).join(''),
    leads = `<section class="gauntlet-leads" aria-labelledby="gauntlet-lead-title"><h2 id="gauntlet-lead-title">${t('gauntlet.leadTitle')}</h2><p class="gauntlet-camp">${icon('heart')}<span>${t('gauntlet.campHint')}</span></p><div class="gauntlet-lead-row">${leadButtons}</div></section>`,
    boons = boonTaken
      ? `<section class="gauntlet-boons" aria-labelledby="gauntlet-boon-title"><h2 id="gauntlet-boon-title">${t('gauntlet.boons')}</h2><ul class="boon-grid">${run.boons.map(heldBoonHtml).join('')}</ul></section>`
      : `<section class="gauntlet-boons" aria-labelledby="gauntlet-boon-title"><h2 id="gauntlet-boon-title">${t('gauntlet.chooseBoon')}</h2><p>${t('gauntlet.chooseBoonHint')}</p><div class="boon-grid">${available.map(boonHtml).join('')}</div></section>`,
    ready = boonTaken || run.pendingBoon;
  screen.innerHTML = `<div class="shell gauntlet-page">${topbar(t('gauntlet.title'), { eyebrow: t('gauntlet.roundClear', { round: run.stage, total: GAUNTLET_STAGES.length }) })}${nextCard}${leads}${boons}<div class="sticky-cta"><button type="button" class="primary-btn wide" data-action="gauntlet-continue"${ready ? '' : ' disabled'}>${t('app.continue')}${icon('chevron-right')}</button></div></div>`;
  bindCommon();
  guardGauntletRun();
  screen.querySelector('.gauntlet-lead-row').addEventListener('click', (event) => {
    const button = event.target.closest('[data-gauntlet-lead]');
    if (!button) return;
    run.lead = Number(button.dataset.gauntletLead);
    sound.ui();
    screen.querySelectorAll('[data-gauntlet-lead]').forEach((item) => {
      const lead = item === button;
      item.classList.toggle('lead', lead);
      item.setAttribute('aria-pressed', String(lead));
    });
  });
  const cta = screen.querySelector('[data-action="gauntlet-continue"]');
  screen.querySelector('.boon-grid').addEventListener('click', (event) => {
    const button = event.target.closest('[data-boon]');
    if (!button) return;
    run.pendingBoon = button.dataset.boon;
    sound.ui();
    screen.querySelectorAll('[data-boon]').forEach((item) => {
      const picked = item === button;
      item.classList.toggle('picked', picked);
      item.setAttribute('aria-pressed', String(picked));
    });
    cta.disabled = false;
  });
  cta.addEventListener('click', () => {
    if (!boonTaken) {
      if (!run.pendingBoon) return;
      run.boons.push(run.pendingBoon);
      run.pendingBoon = null;
    }
    startGauntletStage();
  });
}

registerRoutes({
  startGauntlet,
  startGauntletStage,
  advanceGauntlet,
  renderGauntletBoons,
  guardGauntletRun,
  resumableGauntlet,
});
