import { ctx, registerRoutes, route } from '../app/context.js';

const {
  AFFINITIES,
  CLASSES,
  CREATURES,
  CREATURE_IDS,
  MOVES,
  PASSIVES,
  masteryRank,
  createDraft,
  dailyDraftSeed,
  bestLeadIndex,
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
  affinityIcon,
  classIcon,
  className,
  actionButton,
  persist,
  disposeArena,
  comboRoutesHtml,
  topbar,
  draftInsightHtml,
} = ctx;
const { bindCommon, teamProfileHtml, startBattle, rerenderPreservingFocus } = route;

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
  ctx.draftRun = { ...createDraft(seed), team: [], round: 0, lead: 0 };
  renderDraft();
}

function candidateDraftInsight(id) {
  const generic = draftInsightHtml(id);
  if (!generic.includes(t('draft.flexPick'))) return generic;
  const creature = CREATURES[id],
    moves = creature.moves.map((moveId) => MOVES[moveId]),
    supportWeight = moves.filter((move) => move.kind === 'support' || move.kind === 'heal').length,
    controlWeight = moves.filter(
      (move) => move.targetStatuses?.length || move.selfStatuses?.length || move.kind === 'support'
    ).length,
    archetype = supportWeight >= 2 ? 'support' : controlWeight >= 2 ? 'control' : 'burst';
  return `<div class="draft-insight"><b>${t('draft.insight')}</b><small>${t('draft.kitInsight', { archetype: t(`draft.archetype.${archetype}`), talent: t(`passive.effect.${creature.passive}`) })}</small></div>`;
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
    offer = complete ? [] : ctx.draftRun.offers[ctx.draftRun.round];
  const scoutedDraftLead = complete ? bestLeadIndex(ctx.draftRun.team, ctx.draftRun.enemyTeam) : -1,
    lineup = Array.from({ length: 3 }, (_, index) => {
      const id = ctx.draftRun.team[index];
      return id
        ? `<button type="button" class="draft-slot filled ${ctx.draftRun.lead === index ? 'lead' : ''} ${scoutedDraftLead === index ? 'recommended' : ''}" data-draft-lead="${index}" data-focus-key="draft-lead-${index}" aria-pressed="${ctx.draftRun.lead === index}"><span>${ctx.draftRun.lead === index ? '★' : index + 1}</span><img src="${sprite(id)}" alt=""><b>${creatureName(id)}${complete && scoutedDraftLead === index ? `<small>◎ ${t('select.recommendedLead')}</small>` : ''}</b></button>`
        : `<div class="draft-slot"><span>${index + 1}</span><i>?</i><b>${t('draft.empty')}</b></div>`;
    }).join('');
  const offers = offer
    .map((id, offerIndex) => {
      const c = CREATURES[id],
        a = AFFINITIES[c.affinity],
        passive = PASSIVES[c.passive],
        rank = masteryRank(ctx.save.mastery[id] || 0);
      return `<button type="button" class="draft-card mastery-card-${rank} ${offerIndex === (ctx.draftRun.offerIndex || 0) ? 'mobile-active' : ''}" data-draft-pick="${id}" data-focus-key="draft-pick-${offerIndex}" data-offer-index="${offerIndex}" style="--draft-color:${a.color}">${rank ? `<em>${'★'.repeat(rank)}</em>` : ''}<div class="draft-portrait"><img src="${sprite(id)}" alt=""><i>${affinityIcon(c.affinity)}</i></div><span class="eyebrow">${affinityName(c.affinity)}</span><span class="class-chip" style="--class-color:${CLASSES[c.classId].color}">${classIcon(c.classId)} ${className(c.classId)}</span><h2>${creatureName(id)}</h2><div class="draft-talent"><b>${passive.icon} ${t(`passive.${c.passive}`)}</b><small>${t(`passive.effect.${c.passive}`)}</small></div><ul>${c.moves.map((moveId) => `<li>${MOVES[moveId].signature ? '✦ ' : ''}${t(`move.${moveId}`)}</li>`).join('')}</ul>${candidateDraftInsight(id)}</button>`;
    })
    .join('');
  const reveal = complete
    ? `<section class="draft-final"><div><span class="eyebrow">${t('draft.rival')}</span><h2>${t(`arena.${ctx.draftRun.arena}`)}</h2><div class="draft-rival-team">${ctx.draftRun.enemyTeam.map((id) => `<span><img src="${sprite(id)}" alt=""><b>${creatureName(id)}</b></span>`).join('')}</div><div class="arena-rule"><b>${t('arena.ruleTitle')}</b><span>${t(`arena.rule.${ctx.draftRun.arena}`)}</span></div></div><aside>${teamProfileHtml(ctx.draftRun.team)}<h3>${t('combo.title')}</h3>${comboRoutesHtml(ctx.draftRun.team, true)}${actionButton(t('draft.enter'), 'draft-battle', 'primary-btn wide')}</aside></section>`
    : '';
  const carousel = complete
    ? ''
    : `<nav class="draft-carousel" aria-label="${t('draft.offers')}"><button type="button" data-draft-nav="prev" aria-label="${t('draft.previous')}">‹</button><div class="draft-dots">${offer.map((_, index) => `<button type="button" data-draft-dot="${index}" class="${index === (ctx.draftRun.offerIndex || 0) ? 'active' : ''}" aria-label="${t('draft.position', { position: index + 1, total: offer.length })}" aria-pressed="${index === (ctx.draftRun.offerIndex || 0)}"></button>`).join('')}</div><button type="button" data-draft-nav="next" aria-label="${t('draft.next')}">›</button></nav>`;
  screen.innerHTML = `<div class="shell draft-page">${topbar()}<div class="draft-head"><span class="eyebrow">${t('draft.daily')} · #${ctx.draftRun.seed}</span><h1>${t('draft.title')}</h1><p>${complete ? t('draft.ready') : t('draft.pick', { round: ctx.draftRun.round + 1, total: ctx.draftRun.offers.length })}</p><div class="draft-progress">${ctx.draftRun.offers.map((_, index) => `<i class="${index < ctx.draftRun.round ? 'done' : index === ctx.draftRun.round && !complete ? 'active' : ''}"></i>`).join('')}</div></div><div class="draft-lineup">${lineup}</div>${complete ? reveal : `<div class="draft-offers">${offers}</div>${carousel}`}</div>`;
  bindCommon();
  screen.querySelectorAll('[data-draft-pick]').forEach((button) =>
    button.addEventListener('click', () => {
      ctx.draftRun.team.push(button.dataset.draftPick);
      ctx.draftRun.round++;
      sound.ui();
      rerenderPreservingFocus(() => renderDraft());
    })
  );
  const showOffer = (index) => {
    ctx.draftRun.offerIndex = (index + offer.length) % offer.length;
    screen
      .querySelectorAll('[data-offer-index]')
      .forEach((card) =>
        card.classList.toggle('mobile-active', Number(card.dataset.offerIndex) === ctx.draftRun.offerIndex)
      );
    screen.querySelectorAll('[data-draft-dot]').forEach((dot) => {
      const active = Number(dot.dataset.draftDot) === ctx.draftRun.offerIndex;
      dot.classList.toggle('active', active);
      dot.setAttribute('aria-pressed', String(active));
    });
  };
  screen
    .querySelectorAll('[data-draft-nav]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        showOffer((ctx.draftRun.offerIndex || 0) + (button.dataset.draftNav === 'next' ? 1 : -1))
      )
    );
  screen
    .querySelectorAll('[data-draft-dot]')
    .forEach((button) => button.addEventListener('click', () => showOffer(Number(button.dataset.draftDot))));
  screen.querySelectorAll('[data-draft-lead]').forEach((button) =>
    button.addEventListener('click', () => {
      ctx.draftRun.lead = Number(button.dataset.draftLead);
      sound.ui();
      rerenderPreservingFocus(() => renderDraft());
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
      difficulty: ctx.draftRun.difficulty || 'standard',
      trainerIndex: ctx.draftRun.trainerIndex,
      draftSeed: ctx.draftRun.seed,
    });
  });
}

registerRoutes({ randomDistinct, startDraft, renderDraft });
