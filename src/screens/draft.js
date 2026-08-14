import { ctx, registerRoutes, route } from '../app/context.js';

const {
  AFFINITIES,
  CREATURES,
  CREATURE_IDS,
  MOVES,
  PASSIVES,
  masteryRank,
  createDraft,
  dailyDraftSeed,
  bestLeadIndex,
  recommendedDoctrine,
  normalizeSeed,
  randomIndex,
  params,
  t,
  screen,
  sound,
  sprite,
  creatureName,
  affinity,
  affinityName,
  actionButton,
  persist,
  disposeArena,
  bondsHtml,
  comboRoutesHtml,
  topbar,
} = ctx;
const { bindCommon, teamProfileHtml, startBattle } = route;

function randomDistinct(count, seed) {
  const pool = [...CREATURE_IDS],
    out = [];
  let state = normalizeSeed(Number(params.get('seed')) || seed || 1);
  while (out.length < count) {
    const next = randomIndex(state, pool.length);
    state = next.state;
    out.push(...pool.splice(next.index, 1));
  }
  return out;
}

function startDraft() {
  const seed = Number(params.get('seed')) || dailyDraftSeed();
  ctx.draftRun = { ...createDraft(seed), team: [], round: 0, lead: 0, doctrine: 'balanced' };
  renderDraft();
}

function renderDraft() {
  if (!ctx.draftRun) {
    startDraft();
    return;
  }
  disposeArena();
  ctx.battleSession = null;
  ctx.previousScreen = 'title';
  screen.dataset.page = 'draft';
  screen.className = 'screen';
  const complete = ctx.draftRun.round >= ctx.draftRun.offers.length,
    offer = complete ? [] : ctx.draftRun.offers[ctx.draftRun.round],
    recommended = complete ? recommendedDoctrine(ctx.draftRun.team) : null,
    doctrines = ['balanced', 'assault', 'bastion', 'ambush']
      .map(
        (id) =>
          `<button type="button" class="doctrine-card ${ctx.draftRun.doctrine === id ? 'active' : ''} ${recommended === id ? 'recommended' : ''}" data-doctrine="${id}" aria-pressed="${ctx.draftRun.doctrine === id}">${recommended === id ? `<em>${t('profile.recommended')}</em>` : ''}<b>${t(`doctrine.icon.${id}`)} ${t(`doctrine.${id}`)}</b><small>${t(`doctrine.effect.${id}`)}</small></button>`
      )
      .join('');
  const scoutedDraftLead = complete ? bestLeadIndex(ctx.draftRun.team, ctx.draftRun.enemyTeam) : -1,
    lineup = Array.from({ length: 3 }, (_, index) => {
      const id = ctx.draftRun.team[index];
      return id
        ? `<button type="button" class="draft-slot filled ${ctx.draftRun.lead === index ? 'lead' : ''} ${scoutedDraftLead === index ? 'recommended' : ''}" data-draft-lead="${index}" aria-pressed="${ctx.draftRun.lead === index}"><span>${ctx.draftRun.lead === index ? '★' : index + 1}</span><img src="${sprite(id)}" alt=""><b>${creatureName(id)}${complete && scoutedDraftLead === index ? `<small>◎ ${t('select.recommendedLead')}</small>` : ''}</b></button>`
        : `<div class="draft-slot"><span>${index + 1}</span><i>?</i><b>${t('draft.empty')}</b></div>`;
    }).join('');
  const offers = offer
    .map((id) => {
      const c = CREATURES[id],
        a = AFFINITIES[c.affinity],
        passive = PASSIVES[c.passive],
        rank = masteryRank(ctx.save.mastery[id] || 0);
      return `<button type="button" class="draft-card mastery-card-${rank}" data-draft-pick="${id}" style="--draft-color:${a.color}">${rank ? `<em>${'★'.repeat(rank)}</em>` : ''}<div class="draft-portrait"><img src="${sprite(id)}" alt=""><i>${a.icon}</i></div><span class="eyebrow">${affinityName(c.affinity)} · ${t(`role.${c.role}`)}</span><h2>${creatureName(id)}</h2><div class="draft-talent"><b>${passive.icon} ${t(`passive.${c.passive}`)}</b><small>${t(`passive.effect.${c.passive}`)}</small></div><ul>${c.moves.map((moveId) => `<li>${MOVES[moveId].signature ? '✦ ' : ''}${t(`move.${moveId}`)}</li>`).join('')}</ul></button>`;
    })
    .join('');
  const reveal = complete
    ? `<section class="draft-final"><div><span class="eyebrow">${t('draft.rival')}</span><h2>${t(`arena.${ctx.draftRun.arena}`)}</h2><div class="draft-rival-team">${ctx.draftRun.enemyTeam.map((id) => `<span><img src="${sprite(id)}" alt=""><b>${creatureName(id)}</b></span>`).join('')}</div><div class="arena-rule"><b>${t('arena.ruleTitle')}</b><span>${t(`arena.rule.${ctx.draftRun.arena}`)}</span></div></div><aside><h3>${t('doctrine.title')}</h3><div class="doctrine-picker">${doctrines}</div>${teamProfileHtml(ctx.draftRun.team)}<h3>${t('bond.title')}</h3>${bondsHtml(ctx.draftRun.team)}<h3>${t('combo.title')}</h3>${comboRoutesHtml(ctx.draftRun.team, true)}${actionButton(t('draft.enter'), 'draft-battle', 'primary-btn wide')}</aside></section>`
    : '';
  screen.innerHTML = `<div class="shell draft-page">${topbar()}<div class="draft-head"><span class="eyebrow">${t('draft.daily')} · #${ctx.draftRun.seed}</span><h1>${t('draft.title')}</h1><p>${complete ? t('draft.ready') : t('draft.pick', { round: ctx.draftRun.round + 1, total: ctx.draftRun.offers.length })}</p><div class="draft-progress">${ctx.draftRun.offers.map((_, index) => `<i class="${index < ctx.draftRun.round ? 'done' : index === ctx.draftRun.round && !complete ? 'active' : ''}"></i>`).join('')}</div></div><div class="draft-lineup">${lineup}</div>${complete ? reveal : `<div class="draft-offers">${offers}</div>`}</div>`;
  bindCommon();
  screen.querySelectorAll('[data-draft-pick]').forEach((button) =>
    button.addEventListener('click', () => {
      ctx.draftRun.team.push(button.dataset.draftPick);
      ctx.draftRun.round++;
      sound.ui();
      renderDraft();
    })
  );
  screen.querySelectorAll('[data-draft-lead]').forEach((button) =>
    button.addEventListener('click', () => {
      ctx.draftRun.lead = Number(button.dataset.draftLead);
      sound.ui();
      renderDraft();
    })
  );
  screen.querySelectorAll('[data-doctrine]').forEach((button) =>
    button.addEventListener('click', () => {
      ctx.draftRun.doctrine = button.dataset.doctrine;
      renderDraft();
    })
  );
  screen.querySelector('[data-action="draft-battle"]')?.addEventListener('click', () => {
    ctx.save.lastTeam = [...ctx.draftRun.team];
    persist();
    startBattle({
      playerTeam: [...ctx.draftRun.team],
      enemyTeam: [...ctx.draftRun.enemyTeam],
      playerLead: ctx.draftRun.lead,
      enemyLead: 0,
      mode: 'draft',
      arena: ctx.draftRun.arena,
      difficulty: 'challenger',
      trainerIndex: ctx.draftRun.trainerIndex,
      doctrine: ctx.draftRun.doctrine,
      draftSeed: ctx.draftRun.seed,
    });
  });
}

registerRoutes({ randomDistinct, startDraft, renderDraft });
