import { ctx, registerRoutes, route } from '../app/context.js';

const {
  AFFINITIES,
  CLASSES,
  CREATURES,
  CREATURE_IDS,
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
  affinityName,
  classIcon,
  className,
  persist,
  escapeHtml,
  disposeArena,
  topbar,
} = ctx;
const {
  bindCommon,
  startBattle,
  openSheet,
  icon,
  creatureMatchup,
  matchupMark,
  creatureSheetHtml,
  weatherRows,
} = route;

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

const typeDot = (affinityId) => `<i class="type-dot" data-type="${affinityId}" aria-hidden="true"></i>`;

// One line on what the candidate brings: a type the trio lacks, else its class's role (the same
// line as the class chip beside it, so the two never disagree).
function offerInsight(id) {
  const creature = CREATURES[id],
    team = ctx.draftRun.team;
  if (team.length && !team.some((member) => CREATURES[member].affinity === creature.affinity))
    return `<span class="draft-offer-insight is-new-type">${typeDot(creature.affinity)}${escapeHtml(t('draft.newAffinity', { affinity: affinityName(creature.affinity) }))}</span>`;
  return `<span class="draft-offer-insight">${escapeHtml(t(`class.effect.${creature.classId}`))}</span>`;
}

function slotHtml(index, complete, suggested) {
  const run = ctx.draftRun,
    id = run.team[index];
  if (!id)
    return `<div class="draft-slot"><span class="draft-slot-empty">${index + 1}</span><b>${escapeHtml(t('draft.empty'))}</b></div>`;
  const creature = CREATURES[id],
    lead = complete && run.lead === index,
    label = `<img src="${sprite(id)}" alt="" width="64" height="64"><b>${escapeHtml(creatureName(id))}</b>${typeDot(creature.affinity)}`;
  if (!complete)
    return `<div class="draft-slot filled" style="--type-color:${AFFINITIES[creature.affinity].color}">${label}</div>`;
  const matchup = creatureMatchup(id, run.enemyTeam),
    direction = matchup.edge > 0 ? 'up' : matchup.edge < 0 ? 'down' : 'even',
    crown = lead ? t('select.lead') : index === suggested ? t('select.suggested') : '';
  return `<button type="button" class="draft-slot filled${lead ? ' lead' : ''}${index === suggested ? ' recommended' : ''}" data-draft-lead="${index}" data-focus-key="draft-lead-${index}" data-matchup="${direction}" aria-pressed="${lead}" style="--type-color:${AFFINITIES[creature.affinity].color}" aria-label="${escapeHtml(`${creatureName(id)}, ${lead ? t('select.lead') : t('select.chooseLead')}`)}">${label}${matchupMark()}<span class="draft-crown" aria-hidden="true">${icon('crown')}${crown ? `<span>${escapeHtml(crown)}</span>` : ''}</span></button>`;
}

function offerHtml(id) {
  const creature = CREATURES[id];
  return `<article class="draft-offer" style="--type-color:${AFFINITIES[creature.affinity].color}"><button type="button" class="draft-offer-pick" data-draft-pick="${id}" aria-label="${escapeHtml(t('draft.take', { name: creatureName(id) }))}"><span class="draft-offer-portrait"><img src="${sprite(id)}" alt="" width="128" height="128" decoding="async"></span><span class="draft-offer-text"><b class="draft-offer-name">${escapeHtml(creatureName(id))}</b><span class="draft-offer-chips"><span class="sheet-chip">${typeDot(creature.affinity)}${escapeHtml(affinityName(creature.affinity))}</span><span class="sheet-chip" style="--class-color:${CLASSES[creature.classId].color}">${classIcon(creature.classId)}${escapeHtml(className(creature.classId))}</span></span>${offerInsight(id)}</span></button><button type="button" class="icon-btn draft-offer-info" data-draft-info="${id}" aria-label="${escapeHtml(t('select.info', { name: creatureName(id) }))}">${icon('info')}</button></article>`;
}

/* Reveal: the rival trio as rows (portrait, name, type and class; its lead
   marked), then the arena and its weather. Rivals never show a Chromatique. */
function revealHtml() {
  const run = ctx.draftRun,
    weather = weatherRows(run.arena, []),
    boosted = weather.find((row) => row.up);
  const rivals = run.enemyTeam
    .map((id, index) => {
      const creature = CREATURES[id];
      return `<li class="draft-rival${index === 0 ? ' is-lead' : ''}" style="--type-color:${AFFINITIES[creature.affinity].color}"><img src="${sprite(id, 'normal')}" alt="" width="64" height="64"><span class="draft-rival-text"><b>${escapeHtml(creatureName(id))}</b><small>${typeDot(creature.affinity)}<span>${escapeHtml(`${affinityName(creature.affinity)} · ${className(creature.classId)}`)}</span></small>${index === 0 ? `<span class="draft-rival-lead">${icon('crown')}<span>${escapeHtml(t('select.lead'))}</span></span>` : ''}</span></li>`;
    })
    .join('');
  return `<section class="draft-final" aria-labelledby="draft-rival-title"><h2 id="draft-rival-title">${escapeHtml(t('draft.rival'))}</h2><ul class="draft-rival-team">${rivals}</ul><div class="draft-arena"><span class="ts-chip">${icon('map')}${escapeHtml(t(`arena.${run.arena}`))}</span>${boosted ? `<span class="ts-chip ts-weather"><span aria-hidden="true">${escapeHtml(t('select.weather'))}</span>${typeDot(boosted.affinity)}<b class="num" aria-hidden="true">${escapeHtml(t('battle.weatherBadge', { percent: boosted.percent }))}</b><span class="visually-hidden">${escapeHtml(`${t('arena.ruleTitle')}. ${weather.map((row) => row.text).join(', ')}`)}</span></span>` : ''}</div></section>`;
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
  const run = ctx.draftRun,
    complete = run.round >= run.offers.length,
    suggested = complete ? bestLeadIndex(run.team, run.enemyTeam) : -1;
  const lineup = [0, 1, 2].map((index) => slotHtml(index, complete, suggested)).join('');
  screen.innerHTML = `<div class="draft${complete ? ' is-complete' : ''}">${topbar(t('draft.title'))}<p class="draft-lede">${escapeHtml(complete ? t('draft.ready') : t('draft.pick', { round: run.round + 1, total: run.offers.length }))}</p><div class="draft-lineup">${lineup}</div>${
    complete
      ? `${revealHtml()}<div class="ts-bar draft-bar"><button type="button" class="primary-btn ts-fight" data-action="draft-battle">${escapeHtml(t('select.ready'))}</button></div>`
      : `<div class="draft-offers" role="group" aria-label="${escapeHtml(t('draft.offers'))}">${run.offers[run.round].map(offerHtml).join('')}</div>`
  }</div>`;
  bindCommon();
  const root = screen.querySelector('.draft');
  const take = (id) => {
    const index = run.team.length;
    run.team.push(id);
    run.round++;
    sound.call(id);
    renderDraft();
    const focus =
      run.round >= run.offers.length
        ? screen.querySelector(`[data-focus-key="draft-lead-${index}"]`)
        : screen.querySelector('[data-draft-pick]');
    focus?.focus({ preventScroll: true });
  };
  root.querySelector('.draft-offers')?.addEventListener('click', (event) => {
    const info = event.target.closest('[data-draft-info]');
    if (info) {
      const id = info.dataset.draftInfo;
      openSheet({
        title: creatureName(id),
        body: creatureSheetHtml(id),
        actions: [
          {
            label: t('draft.take', { name: creatureName(id) }),
            variant: 'primary',
            action: 'sheet-take',
            onSelect: () => take(id),
          },
        ],
      });
      return;
    }
    const pick = event.target.closest('[data-draft-pick]');
    if (pick) take(pick.dataset.draftPick);
  });
  root.querySelector('.draft-lineup').addEventListener('click', (event) => {
    const slot = event.target.closest('[data-draft-lead]');
    if (!slot) return;
    run.lead = Number(slot.dataset.draftLead);
    sound.ui();
    root.querySelector('.draft-lineup').innerHTML = [0, 1, 2]
      .map((index) => slotHtml(index, true, suggested))
      .join('');
    root.querySelector(`[data-draft-lead="${run.lead}"]`)?.focus({ preventScroll: true });
  });
  root.querySelector('[data-action="draft-battle"]')?.addEventListener('click', () => {
    ctx.save.lastTeam = [run.team[run.lead], ...run.team.filter((_, index) => index !== run.lead)];
    persist();
    startBattle({
      playerTeam: [...run.team],
      enemyTeam: [...run.enemyTeam],
      playerLead: run.lead,
      enemyLead: 0,
      mode: 'draft',
      arena: run.arena,
      difficulty: run.difficulty || 'standard',
      trainerIndex: run.trainerIndex,
      draftSeed: run.seed,
    });
  });
}

registerRoutes({ randomDistinct, startDraft, renderDraft });
