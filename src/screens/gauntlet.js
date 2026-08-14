import { ctx, registerRoutes, route } from '../app/context.js';

const {
  FEATS,
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
} = ctx;
const { bindCommon, startBattle, renderResults } = route;

function startGauntlet(team, lead) {
  ctx.gauntletRun = { team: [...team], lead, stage: 0, boons: [], condition: null };
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
  if (ctx.gauntletRun.stage >= GAUNTLET_STAGES.length) {
    ctx.save.gauntletWins = Math.min(999, ctx.save.gauntletWins + 1);
    persist();
    renderResults(true);
    return;
  }
  renderGauntletBoons();
}

function performanceHtml(grade, compact = false) {
  if (!grade) return '';
  const parts = ['victory', 'tempo', 'survival']
    .map((key) => `<span>${t(`grade.${key}`)} <b>+${grade.breakdown[key] || 0}</b></span>`)
    .join('');
  return `<div class="performance-grade grade-${grade.letter.toLowerCase()} ${compact ? 'compact' : ''}"><div class="grade-letter"><small>${t('grade.title')}</small><b>${grade.letter}</b><em>${grade.score}/100</em></div><div class="grade-detail">${parts}${grade.bonusXp ? `<strong>★ ${t('grade.bonus', { xp: grade.bonusXp })}</strong>` : ''}</div></div>`;
}

function renderGauntletBoons() {
  disposeArena();
  ctx.previousScreen = 'title';
  screen.dataset.page = 'gauntlet-boon';
  screen.className = 'screen';
  const available = GAUNTLET_BOONS.filter((boon) => !ctx.gauntletRun.boons.includes(boon.id)),
    next = GAUNTLET_STAGES[ctx.gauntletRun.stage],
    mastery =
      ctx.pendingRewards?.mastery
        .map(
          (reward) =>
            `<div class="mastery-reward ${reward.afterRank > reward.beforeRank ? 'rank-up' : ''}"><img src="${sprite(reward.id)}" alt=""><span><b>${creatureName(reward.id)}</b><i><u style="width:${reward.progress.ratio * 100}%"></u></i><small>+${reward.gain} ${t('mastery.xp')}</small></span></div>`
        )
        .join('') || '',
    feats = ctx.pendingRewards?.newFeats.length
      ? `<div class="feat-rewards"><strong>${t('feat.unlocked')}</strong>${ctx.pendingRewards.newFeats.map((id) => `<div><b>${FEATS[id].icon} ${t(`feat.${id}`)}</b><span>${t(`feat.effect.${id}`)}</span></div>`).join('')}</div>`
      : '';
  screen.innerHTML = `<div class="shell">${topbar()}<div class="gauntlet-reward"><section class="glass-panel"><span class="eyebrow">${t('gauntlet.roundClear', { round: ctx.gauntletRun.stage, total: GAUNTLET_STAGES.length })}</span><h1>${t('gauntlet.chooseBoon')}</h1><p>${t('gauntlet.chooseBoonHint')}</p>${performanceHtml(ctx.pendingRewards?.grade, true)}<div class="mastery-rewards">${mastery}</div>${feats}<div class="boon-grid">${available.map((boon) => `<button type="button" class="boon-card" data-boon="${boon.id}"><i>${boon.icon}</i><span><b>${t(`boon.${boon.id}`)}</b><small>${t(`boon.effect.${boon.id}`)}</small></span></button>`).join('')}</div><div class="next-gauntlet"><span>${t('gauntlet.next')}</span><b>${t(next.nameKey)} · ${t(`arena.${next.arena}`)}</b><div>${next.enemyTeam.map((id) => `<img src="${sprite(id)}" alt="${creatureName(id)}">`).join('')}</div></div></section></div></div>`;
  const scoutedLead = bestLeadIndex(ctx.gauntletRun.team, next.enemyTeam),
    camp = `<div class="gauntlet-condition"><div><span class="eyebrow">${t('gauntlet.camp')}</span><small>${t('gauntlet.campHint')}</small></div>${ctx.gauntletRun.team
      .map((id, index) => {
        const ratio = ctx.gauntletRun.condition?.[id] || 1;
        return `<button type="button" class="${ctx.gauntletRun.lead === index ? 'lead' : ''} ${scoutedLead === index ? 'recommended' : ''}" data-gauntlet-lead="${index}" aria-pressed="${ctx.gauntletRun.lead === index}"><img src="${sprite(id)}" alt=""><b>${creatureName(id)}${scoutedLead === index ? `<small>◎ ${t('select.recommendedLead')}</small>` : ''}</b><i><u style="width:${ratio * 100}%"></u></i><em>${Math.round(ratio * 100)}%</em></button>`;
      })
      .join('')}</div>`;
  screen.querySelector('.boon-grid')?.insertAdjacentHTML('beforebegin', camp);
  bindCommon();
  screen.querySelectorAll('[data-gauntlet-lead]').forEach((button) =>
    button.addEventListener('click', () => {
      ctx.gauntletRun.lead = Number(button.dataset.gauntletLead);
      sound.ui();
      renderGauntletBoons();
    })
  );
  screen.querySelectorAll('[data-boon]').forEach((button) =>
    button.addEventListener('click', () => {
      ctx.gauntletRun.boons.push(button.dataset.boon);
      startGauntletStage();
    })
  );
}

registerRoutes({ startGauntlet, startGauntletStage, advanceGauntlet, performanceHtml, renderGauntletBoons });
