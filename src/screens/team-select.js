import { ctx, registerRoutes, route } from '../app/context.js';

const {
  AFFINITIES,
  AFFINITY_ORDER,
  CLASSES,
  CLASS_ORDER,
  affinityMultiplier,
  CREATURES,
  CREATURE_IDS,
  MOVES,
  PASSIVES,
  masteryRank,
  SQUAD_PRESETS,
  QUICK_RULES,
  quickRule,
  TRAINERS,
  ARENAS,
  TRIALS,
  GAUNTLET_STAGES,
  circuitMatch,
  PROFILE_AXES,
  bestLeadIndex,
  remixTeam,
  teamProfile,
  params,
  t,
  screen,
  sound,
  LADDER_COUNT,
  sprite,
  creatureName,
  affinity,
  affinityName,
  affinityIcon,
  classIcon,
  className,
  actionButton,
  persist,
  notify,
  escapeHtml,
  disposeArena,
  emblemHtml,
  comboRoutesHtml,
  topbar,
} = ctx;
const { bindCommon, randomDistinct, startGauntlet, startBattle, rerenderPreservingFocus } = route;

function newSelection(mode) {
  const circuit = circuitMatch(ctx.save.circuitWins, LADDER_COUNT),
    index =
      mode === 'ladder'
        ? Math.min(ctx.save.ladderVictories, LADDER_COUNT - 1)
        : mode === 'circuit'
          ? circuit.trainerIndex
          : mode === 'gauntlet'
            ? GAUNTLET_STAGES[0].trainerIndex
            : 0;
  const queryTeam = (name, fallback) => {
    const ids = (params.get(name) || '').split(',').filter((id) => CREATURE_IDS.includes(id));
    return ids.length === 3 && new Set(ids).size === 3 ? ids : [...fallback];
  };
  const stage = GAUNTLET_STAGES[0];
  const trainer = TRAINERS[index],
    authoredEnemy = mode === 'circuit' && trainer.circuitTeam ? trainer.circuitTeam : trainer.team;
  return {
    mode,
    team: queryTeam('player', ctx.save.lastTeam),
    lead: 0,
    enemyTeam: mode === 'gauntlet' ? [...stage.enemyTeam] : queryTeam('enemy', authoredEnemy),
    enemyLead: mode === 'circuit' ? trainer.circuitLead || 0 : 0,
    trainerIndex: index,
    arena:
      mode === 'gauntlet'
        ? stage.arena
        : ['ladder', 'circuit'].includes(mode)
          ? TRAINERS[index].arena
          : 'crystal',
    difficulty:
      mode === 'circuit'
        ? 'champion'
        : mode === 'gauntlet'
          ? stage.difficulty
          : mode === 'ladder'
            ? TRAINERS[index].difficulty
            : ctx.save.difficulty,
    filterAffinity: 'all',
    filterClass: 'all',
    quickRule: 'standard',
    circuitCondition: mode === 'circuit' ? circuit.condition.id : null,
  };
}

function teamMatchup(team, enemy) {
  let good = 0,
    risky = 0;
  for (const a of team)
    for (const b of enemy) {
      const m = affinityMultiplier(CREATURES[a].affinity, CREATURES[b].affinity);
      if (m > 1) good++;
      if (m < 1) risky++;
    }
  return { good, risky };
}

function teamProfileHtml(ids) {
  const profile = teamProfile(ids);
  return `<section class="team-profile"><div><span>${t('profile.title')}</span><b>${t(`profile.${profile.dominant}`)}</b></div><div class="profile-bars">${PROFILE_AXES.map((axis) => `<span class="${axis} ${axis === profile.dominant ? 'dominant' : ''}"><small>${t(`profile.${axis}`)}</small><i><u style="width:${profile[axis]}%"></u></i><b>${profile[axis]}</b></span>`).join('')}</div></section>`;
}

function creatureMatchup(id, enemy) {
  const own = CREATURES[id].affinity;
  let good = 0,
    risk = 0;
  for (const foeId of enemy) {
    const foe = CREATURES[foeId].affinity;
    if (affinityMultiplier(own, foe) > 1) good++;
    if (affinityMultiplier(foe, own) > 1) risk++;
  }
  return { good, risk, edge: good - risk };
}

function moveArchetype(move) {
  return move.signature
    ? '☄'
    : move.kind === 'heal'
      ? '✚'
      : move.kind === 'support'
        ? '⬡'
        : (move.hits || 1) > 1
          ? `×${move.hits}`
          : move.drain
            ? '↟'
            : move.priority > 0
              ? '»'
              : '⚔';
}

function creatureCard(id, selected, lead, enemy = ctx.selection?.enemyTeam || []) {
  const c = CREATURES[id],
    a = affinity(id),
    passive = PASSIVES[c.passive],
    rank = masteryRank(ctx.save.mastery[id] || 0),
    scout = creatureMatchup(id, enemy),
    scoutLabel =
      scout.good || scout.risk
        ? `${scout.good ? `<span class="good">↑ ${t('select.scoutGood', { count: scout.good })}</span>` : ''}${scout.risk ? `<span class="risky">↓ ${t('select.scoutRisk', { count: scout.risk })}</span>` : ''}`
        : `<span class="neutral">◆ ${t('select.scoutNeutral')}</span>`,
    kit = c.moves
      .map((moveId) => {
        const move = MOVES[moveId],
          color = AFFINITIES[move.affinity]?.color || '#d8d9ea';
        return `<span class="kit-move kind-${move.kind} ${move.signature ? 'signature' : ''}" style="--kit-color:${color}" title="${escapeHtml(`${t(`move.${moveId}`)} — ${t(`move.effect.${moveId}`)}`)}"><i>${moveArchetype(move)}</i><small>${t(`move.${moveId}`)}</small></span>`;
      })
      .join('');
  return `<button type="button" class="creature-card ${selected ? 'selected' : ''} ${lead ? 'lead' : ''} ${scout.edge > 0 ? 'scout-strong' : scout.edge < 0 ? 'scout-danger' : ''} mastery-card-${rank}" data-creature="${id}" data-lead="${t('select.lead')}" aria-label="${escapeHtml(`${creatureName(id)}, ${affinityName(c.affinity)}, ${className(c.classId)}`)}">${rank ? `<span class="card-rank" title="${t('mastery.rank', { rank })}">${'★'.repeat(rank)}</span>` : ''}<img src="${sprite(id)}" alt=""><h3>${creatureName(id)} <i class="card-talent" title="${escapeHtml(t(`passive.effect.${c.passive}`))}">${passive.icon}</i></h3><div class="meta-row"><span class="affinity-chip" style="--chip-color:${a.color}">${affinityIcon(c.affinity)} ${affinityName(c.affinity)}</span><span class="class-chip" style="--class-color:${CLASSES[c.classId].color}">${classIcon(c.classId)} ${className(c.classId)}</span></div><div class="mini-stats">${t('bestiary.stats', { hp: c.maxHp, attack: c.attack, guard: c.guard, speed: c.speed })}</div><div class="kit-strip" aria-label="${t('bestiary.moves')}">${kit}</div><div class="scout-read" aria-label="${t('select.scout')}">${scoutLabel}</div></button>`;
}

function kitShowcaseHtml(id) {
  const creature = CREATURES[id];
  if (!creature) return '';
  return `<section class="kit-showcase"><div class="kit-showcase-creature"><img src="${sprite(id)}" alt=""><span><small>${t('select.leadKit')}</small><b>${creatureName(id)}</b><em class="class-chip" style="--class-color:${CLASSES[creature.classId].color}">${classIcon(creature.classId)} ${className(creature.classId)}</em></span></div><div class="kit-showcase-moves">${creature.moves
    .map((moveId) => {
      const move = MOVES[moveId],
        color = AFFINITIES[move.affinity]?.color || '#d8d9ea';
      return `<article class="${move.signature ? 'signature' : ''}" style="--kit-color:${color}"><i>${moveArchetype(move)}</i><span><b>${move.signature ? '✦ ' : ''}${t(`move.${moveId}`)}</b><small>${t(`move.effect.${moveId}`)}</small></span></article>`;
    })
    .join('')}</div></section>`;
}

function renderTeamSelect(mode = 'ladder') {
  disposeArena();
  ctx.battleSession = null;
  ctx.previousScreen = 'title';
  screen.dataset.page = 'selection';
  screen.className = 'screen';
  if (!ctx.selection || ctx.selection.mode !== mode) ctx.selection = newSelection(mode);
  const trainer = TRAINERS[ctx.selection.trainerIndex],
    circuit = mode === 'circuit' ? circuitMatch(ctx.save.circuitWins, LADDER_COUNT) : null,
    activeTrial = mode === 'trial' ? TRIALS.find((trial) => trial.id === ctx.selection.trialId) : null,
    ranked = ['ladder', 'circuit'].includes(mode);
  const matchup = teamMatchup(ctx.selection.team, ctx.selection.enemyTeam);
  const visibleIds = CREATURE_IDS.filter(
    (id) =>
      (ctx.selection.filterAffinity === 'all' || CREATURES[id].affinity === ctx.selection.filterAffinity) &&
      (ctx.selection.filterClass === 'all' || CREATURES[id].classId === ctx.selection.filterClass)
  );
  const affinityTabs = `<section class="selection-filters"><div class="filter-row" aria-label="${t('filter.types')}"><b>${t('filter.types')}</b><div class="affinity-tabs"><button class="affinity-tab ${ctx.selection.filterAffinity === 'all' ? 'active' : ''}" data-affinity-filter="all" aria-label="${t('filter.allTypes')}" aria-pressed="${ctx.selection.filterAffinity === 'all'}">${CREATURE_IDS.length}</button>${AFFINITY_ORDER.map(
    (id) => [id, AFFINITIES[id]]
  )
    .map(
      ([id, a]) =>
        `<button class="affinity-tab ${ctx.selection.filterAffinity === id ? 'active' : ''}" data-affinity-filter="${id}" aria-pressed="${ctx.selection.filterAffinity === id}" style="--tab-color:${a.color}">${affinityIcon(id)} ${affinityName(id)}</button>`
    )
    .join(
      ''
    )}</div></div><div class="filter-row class-filter-row" aria-label="${t('filter.classes')}"><b>${t('filter.classes')}</b><div class="class-tabs"><button class="class-tab ${ctx.selection.filterClass === 'all' ? 'active' : ''}" data-class-filter="all" aria-label="${t('filter.allClasses')}" aria-pressed="${ctx.selection.filterClass === 'all'}">${CREATURE_IDS.length}</button>${CLASS_ORDER.map((id) => `<button class="class-tab ${ctx.selection.filterClass === id ? 'active' : ''}" data-class-filter="${id}" aria-pressed="${ctx.selection.filterClass === id}" style="--class-color:${CLASSES[id].color}">${classIcon(id)} ${className(id)}</button>`).join('')}</div></div></section>`;
  const quickEnemyControls =
    mode === 'quick'
      ? `<div class="enemy-picker" aria-label="${t('select.enemy')}">${CREATURE_IDS.map((id) => `<button type="button" class="icon-btn ${ctx.selection.enemyTeam.includes(id) ? 'active' : ''}" data-enemy-pick="${id}" data-focus-key="enemy-${id}" aria-label="${creatureName(id)}" aria-pressed="${ctx.selection.enemyTeam.includes(id)}"><img src="${sprite(id)}" alt=""></button>`).join('')}</div>${actionButton(t('app.random'), 'random-enemy', 'subtle-btn wide', 'data-focus-key="enemy-random"')}`
      : '';
  const arenaControl =
    mode === 'quick'
      ? `<div class="field"><label for="arena-select">${t('select.arena')}</label><select id="arena-select" data-focus-key="arena">${ARENAS.map((id) => `<option value="${id}" ${ctx.selection.arena === id ? 'selected' : ''}>${t(`arena.${id}`)}</option>`).join('')}</select></div><div class="field"><label for="quick-rule">${t('quickRule.title')}</label><select id="quick-rule" data-focus-key="rule">${QUICK_RULES.map((rule) => `<option value="${rule.id}" ${ctx.selection.quickRule === rule.id ? 'selected' : ''}>${rule.icon} ${t(`quickRule.${rule.id}`)}</option>`).join('')}</select></div><div class="battle-rule-preview"><b>${quickRule(ctx.selection.quickRule).icon} ${t(`quickRule.${ctx.selection.quickRule}`)}</b><span>${t(`quickRule.effect.${ctx.selection.quickRule}`)}</span></div>`
      : '';
  const enemyRows =
    `<p class="meta-row">✦ ${t(`arena.${ctx.selection.arena}`)}</p>` +
    ctx.selection.enemyTeam
      .map(
        (id) =>
          `<div class="selected-row"><img src="${sprite(id)}" alt=""><span>${creatureName(id)}<small class="meta-row">${affinityName(CREATURES[id].affinity)} · ${classIcon(CREATURES[id].classId)} ${className(CREATURES[id].classId)}</small></span></div>`
      )
      .join('') +
    (ranked
      ? `<div class="trainer-strategy"><b>${t('trainer.strategy')} · ${t(`style.${trainer.style}`)}</b><span>${t(`style.effect.${trainer.style}`)}</span></div><div class="trainer-ace"><b>♛ ${t('ace.title')} · ${t(`ace.${trainer.ace}`)}</b><span>${t(`ace.effect.${trainer.ace}`)}</span></div>`
      : '');
  const scoutedLead = bestLeadIndex(ctx.selection.team, ctx.selection.enemyTeam),
    selectedRows = ctx.selection.team
      .map(
        (id, index) =>
          `<div class="selected-row ${index === scoutedLead ? 'recommended-lead' : ''}"><img src="${sprite(id)}" alt=""><span>${creatureName(id)}${index === scoutedLead ? `<small>◎ ${t('select.recommendedLead')}</small>` : ''}</span><button class="icon-btn" data-lead-index="${index}" data-focus-key="lead-${index}" aria-label="${t('select.chooseLead')}">${ctx.selection.lead === index ? '★' : '☆'}</button></div>`
      )
      .join('');
  const presets = `<section class="squad-presets"><div class="squad-presets-head"><span><b class="eyebrow">${t('squad.title')}</b><small>${t('squad.hint')}</small></span>${actionButton(`⟳ ${t('squad.remix')}`, 'remix-team', 'subtle-btn remix-team-btn', 'data-focus-key="remix"')}</div><div class="squad-preset-track">${SQUAD_PRESETS.map(
    (preset) => {
      const active = preset.team.every((id, i) => ctx.selection.team[i] === id);
      return `<button type="button" class="squad-preset ${active ? 'active' : ''}" data-squad="${preset.id}" data-focus-key="preset-${preset.id}" aria-pressed="${active}"><i>${preset.icon}</i><span><b>${t(`squad.${preset.id}`)}</b><small>${t(`squad.effect.${preset.id}`)}</small></span><div>${preset.team.map((id) => `<img src="${sprite(id)}" alt="">`).join('')}</div></button>`;
    }
  ).join('')}</div></section>`;
  const customSquads = `<section class="custom-squads"><div><span class="eyebrow">${t('loadout.title')}</span><small>${t('loadout.hint')}</small></div><div class="custom-squad-track">${Array.from(
    { length: 3 },
    (_, slot) => {
      const squad = ctx.save.customSquads?.[slot];
      return `<article class="custom-squad ${squad ? 'filled' : 'empty'}"><span><b>${t('loadout.slot', { slot: slot + 1 })}</b><small>${squad ? t('select.lead') : t('loadout.empty')}</small></span><div class="custom-squad-team">${squad ? squad.team.map((id, index) => `<i class="${index === squad.lead ? 'lead' : ''}"><img src="${sprite(id)}" alt="${creatureName(id)}"></i>`).join('') : '◇ ◇ ◇'}</div><div class="custom-squad-actions">${squad ? `<button type="button" data-custom-load="${slot}" data-focus-key="custom-load-${slot}">${t('loadout.load')}</button><button type="button" data-custom-save="${slot}" data-focus-key="custom-save-${slot}">${t('loadout.replace')}</button><button type="button" data-custom-clear="${slot}" data-focus-key="custom-clear-${slot}" aria-label="${t('loadout.clear')}">×</button>` : `<button type="button" data-custom-save="${slot}" data-focus-key="custom-save-${slot}" ${ctx.selection.team.length === 3 ? '' : 'disabled'}>${t('loadout.save')}</button>`}</div></article>`;
    }
  ).join('')}</div></section>`;
  const circuitBanner = circuit
    ? `<div class="circuit-condition circuit-brief"><i>${circuit.condition.icon}</i><span><small>${t('circuit.condition')} · ${t('difficulty.champion')}</small><b>${t(`circuit.${circuit.condition.id}`)}</b><em>${t(`circuit.effect.${circuit.condition.id}`)}</em></span></div>`
    : '';
  const selectionEyebrow =
      mode === 'circuit'
        ? t('circuit.round', { round: circuit.round })
        : mode === 'ladder'
          ? `${t(trainer.nameKey)} · ${ctx.save.ladderVictories + 1}/${LADDER_COUNT}`
          : mode === 'gauntlet'
            ? t('gauntlet.subtitle')
            : activeTrial
              ? `${activeTrial.icon} ${t(`difficulty.${activeTrial.difficulty}`)} · ${t(`arena.${activeTrial.arena}`)}`
              : t('app.quick'),
    selectionTitle =
      mode === 'circuit'
        ? t('circuit.title')
        : mode === 'gauntlet'
          ? t('gauntlet.title')
          : activeTrial
            ? t(activeTrial.nameKey)
            : t('select.title'),
    selectionSubtitle =
      mode === 'circuit'
        ? t('circuit.subtitle')
        : mode === 'gauntlet'
          ? t('gauntlet.select')
          : activeTrial
            ? t(activeTrial.descKey)
            : t('select.subtitle'),
    opponentTitle = ranked
      ? t(trainer.nameKey)
      : mode === 'gauntlet'
        ? t(GAUNTLET_STAGES[0].nameKey)
        : activeTrial
          ? t(activeTrial.nameKey)
          : t('select.opponent'),
    readyLabel =
      mode === 'gauntlet' ? t('gauntlet.begin') : activeTrial ? t('trial.challenge') : t('select.ready');
  const difficultyControl = !['gauntlet', 'circuit', 'trial'].includes(mode)
      ? `<div class="field"><label for="difficulty">${t('select.difficulty')}</label><select id="difficulty" data-focus-key="difficulty">${['apprentice', 'standard', 'champion'].map((id) => `<option value="${id}" ${ctx.selection.difficulty === id ? 'selected' : ''}>${t(`difficulty.${id}`)}</option>`).join('')}</select></div>`
      : '',
    planControls = `<details class="battle-plan"><summary><span><b>${t('select.combatPlan')}</b><small>${t(`arena.${ctx.selection.arena}`)}</small></span><i aria-hidden="true">⌄</i></summary><div class="battle-plan-body">${difficultyControl}${arenaControl}<div class="arena-rule"><b>${t('arena.ruleTitle')}</b><span>${t(`arena.rule.${ctx.selection.arena}`)}</span></div>${teamProfileHtml(ctx.selection.team)}<h3>${t('combo.title')}</h3>${comboRoutesHtml(ctx.selection.team)}<h3>${t('select.matchup')}</h3><div class="matchup-line"><span class="match-pill good">↑ ${t('select.good')} ${matchup.good}</span><span class="match-pill risky">↓ ${t('select.risky')} ${matchup.risky}</span></div></div></details>`,
    ready = actionButton(
      readyLabel,
      'start-battle',
      'primary-btn wide',
      ctx.selection.team.length === 3 && ctx.selection.enemyTeam.length === 3 ? '' : 'disabled'
    );
  screen.innerHTML = `<div class="shell">${topbar()}<div class="page-head"><div><span class="eyebrow">${selectionEyebrow}</span><h1>${selectionTitle}</h1><p>${selectionSubtitle}</p></div><strong>${t('select.selected', { count: ctx.selection.team.length })}</strong></div>${circuitBanner}${customSquads}${presets}${affinityTabs}${kitShowcaseHtml(ctx.selection.team[ctx.selection.lead])}<div class="selection-layout"><div class="creature-grid">${visibleIds.map((id) => creatureCard(id, ctx.selection.team.includes(id), ctx.selection.team[ctx.selection.lead] === id)).join('')}</div><aside class="glass-panel select-aside">${ranked ? `<div class="trainer-badge">${emblemHtml(ctx.selection.trainerIndex, true)}</div>` : ''}<section class="selection-primary"><h2>${opponentTitle}</h2><div class="enemy-list">${enemyRows}</div>${quickEnemyControls}<h3>${t('select.team')}</h3><div class="selected-list">${selectedRows}</div></section>${planControls}${ready}</aside></div></div>`;
  screen.querySelector('.battle-plan').open = !matchMedia('(max-width: 700px)').matches;
  screen
    .querySelector('.selection-layout')
    ?.insertAdjacentHTML(
      'afterend',
      `<nav class="mobile-selection-dock" aria-label="${t('select.plan')}"><div>${ctx.selection.team.map((id, index) => `<i class="${ctx.selection.lead === index ? 'lead' : ''}"><img src="${sprite(id)}" alt="${creatureName(id)}"></i>`).join('')}</div><span><b>${t('select.selected', { count: ctx.selection.team.length })}</b><small>${t(`arena.${ctx.selection.arena}`)}</small></span><button type="button" data-action="open-plan">${t('select.plan')} ↑</button></nav>`
    );
  const difficultyField = screen.querySelector('#difficulty')?.closest('.field');
  difficultyField?.insertAdjacentHTML(
    'afterend',
    `<div class="difficulty-preview difficulty-${ctx.selection.difficulty}"><b>${t(`difficulty.${ctx.selection.difficulty}`)}</b><span>${t(`difficulty.effect.${ctx.selection.difficulty}`)}</span></div>`
  );
  if (mode === 'gauntlet')
    screen
      .querySelector('.arena-rule')
      ?.insertAdjacentHTML(
        'afterend',
        `<div class="gauntlet-persistence">♥ ${t('gauntlet.persistence')}</div>`
      );
  bindCommon();
  screen.querySelector('[data-action="open-plan"]')?.addEventListener('click', () => {
    const plan = screen.querySelector('.battle-plan');
    if (plan) plan.open = true;
    screen
      .querySelector('.select-aside')
      ?.scrollIntoView({ behavior: ctx.save.reducedMotion ? 'auto' : 'smooth', block: 'start' });
  });
  screen.querySelectorAll('[data-creature]').forEach((card) =>
    card.addEventListener('click', () => {
      const id = card.dataset.creature,
        index = ctx.selection.team.indexOf(id);
      if (index >= 0) {
        ctx.selection.team.splice(index, 1);
        if (ctx.selection.lead >= ctx.selection.team.length) ctx.selection.lead = 0;
      } else if (ctx.selection.team.length < 3) ctx.selection.team.push(id);
      else notify(t('select.selected', { count: 3 }));
      renderTeamSelect(mode);
      // Full re-render drops DOM focus; hand it back to the just-picked card.
      screen.querySelector(`[data-creature="${id}"]`)?.focus({ preventScroll: true });
    })
  );
  screen.querySelectorAll('[data-affinity-filter]').forEach((button) =>
    button.addEventListener('click', () => {
      ctx.selection.filterAffinity = button.dataset.affinityFilter;
      renderTeamSelect(mode);
      screen
        .querySelector(`[data-affinity-filter="${button.dataset.affinityFilter}"]`)
        ?.focus({ preventScroll: true });
    })
  );
  screen.querySelectorAll('[data-class-filter]').forEach((button) =>
    button.addEventListener('click', () => {
      ctx.selection.filterClass = button.dataset.classFilter;
      renderTeamSelect(mode);
      screen
        .querySelector(`[data-class-filter="${button.dataset.classFilter}"]`)
        ?.focus({ preventScroll: true });
    })
  );
  screen.querySelectorAll('[data-lead-index]').forEach((button) =>
    button.addEventListener('click', () => {
      ctx.selection.lead = Number(button.dataset.leadIndex);
      renderTeamSelect(mode);
      screen.querySelector(`[data-lead-index="${button.dataset.leadIndex}"]`)?.focus({ preventScroll: true });
    })
  );
  screen.querySelectorAll('[data-squad]').forEach((button) =>
    button.addEventListener('click', () => {
      const preset = SQUAD_PRESETS.find((x) => x.id === button.dataset.squad);
      ctx.selection.team = [...preset.team];
      ctx.selection.lead = preset.lead;
      ctx.selection.filterAffinity = 'all';
      ctx.selection.filterClass = 'all';
      rerenderPreservingFocus(() => renderTeamSelect(mode));
    })
  );
  screen.querySelector('[data-action="remix-team"]')?.addEventListener('click', () => {
    const before = ctx.selection.team.join(','),
      seed = Date.now();
    let remix = remixTeam(ctx.selection.enemyTeam, seed),
      attempt = 1;
    while (remix.team.join(',') === before && attempt < 8)
      remix = remixTeam(ctx.selection.enemyTeam, seed + attempt++);
    ctx.selection.team = remix.team;
    ctx.selection.lead = remix.lead;
    ctx.selection.filterAffinity = 'all';
    ctx.selection.filterClass = 'all';
    sound.ui();
    rerenderPreservingFocus(() => renderTeamSelect(mode));
    notify(t('squad.remixed'));
  });
  screen.querySelectorAll('[data-custom-load]').forEach((button) =>
    button.addEventListener('click', () => {
      const squad = ctx.save.customSquads?.[Number(button.dataset.customLoad)];
      if (!squad) return;
      ctx.selection.team = [...squad.team];
      ctx.selection.lead = squad.lead;
      ctx.selection.filterAffinity = 'all';
      ctx.selection.filterClass = 'all';
      sound.ui();
      rerenderPreservingFocus(() => renderTeamSelect(mode));
    })
  );
  screen.querySelectorAll('[data-custom-save]').forEach((button) =>
    button.addEventListener('click', () => {
      if (ctx.selection.team.length !== 3) return;
      const slot = Number(button.dataset.customSave);
      ctx.save.customSquads = Array.from({ length: 3 }, (_, index) =>
        index === slot
          ? { team: [...ctx.selection.team], lead: ctx.selection.lead }
          : ctx.save.customSquads?.[index] || null
      );
      persist();
      notify(t('loadout.saved'));
      rerenderPreservingFocus(() => renderTeamSelect(mode));
    })
  );
  screen.querySelectorAll('[data-custom-clear]').forEach((button) =>
    button.addEventListener('click', () => {
      const slot = Number(button.dataset.customClear);
      ctx.save.customSquads = Array.from({ length: 3 }, (_, index) =>
        index === slot ? null : ctx.save.customSquads?.[index] || null
      );
      persist();
      rerenderPreservingFocus(() => renderTeamSelect(mode));
      screen.querySelector(`[data-focus-key="custom-save-${slot}"]`)?.focus({ preventScroll: true });
    })
  );
  screen.querySelectorAll('[data-enemy-pick]').forEach((button) =>
    button.addEventListener('click', () => {
      const id = button.dataset.enemyPick,
        index = ctx.selection.enemyTeam.indexOf(id);
      if (index >= 0) ctx.selection.enemyTeam.splice(index, 1);
      else if (ctx.selection.enemyTeam.length < 3) ctx.selection.enemyTeam.push(id);
      else notify(t('select.selected', { count: 3 }));
      rerenderPreservingFocus(() => renderTeamSelect(mode));
    })
  );
  screen.querySelector('#difficulty')?.addEventListener('change', (e) => {
    ctx.selection.difficulty = e.target.value;
    rerenderPreservingFocus(() => renderTeamSelect(mode));
  });
  screen.querySelector('#arena-select')?.addEventListener('change', (e) => {
    ctx.selection.arena = e.target.value;
    rerenderPreservingFocus(() => renderTeamSelect(mode));
  });
  screen.querySelector('#quick-rule')?.addEventListener('change', (e) => {
    ctx.selection.quickRule = e.target.value;
    rerenderPreservingFocus(() => renderTeamSelect(mode));
  });
  screen.querySelector('[data-action="random-enemy"]')?.addEventListener('click', () => {
    ctx.selection.enemyTeam = randomDistinct(3, ctx.selection.enemyTeam.join('').length + Date.now());
    rerenderPreservingFocus(() => renderTeamSelect(mode));
  });
  screen.querySelector('[data-action="start-battle"]')?.addEventListener('click', () => {
    ctx.save.lastTeam = [...ctx.selection.team];
    if (['quick', 'ladder'].includes(mode)) ctx.save.difficulty = ctx.selection.difficulty;
    persist();
    if (mode === 'gauntlet') startGauntlet(ctx.selection.team, ctx.selection.lead);
    else
      startBattle({
        playerTeam: ctx.selection.team,
        enemyTeam: ctx.selection.enemyTeam,
        playerLead: ctx.selection.lead,
        enemyLead: ctx.selection.enemyLead || 0,
        mode,
        arena: ctx.selection.arena,
        difficulty: ctx.selection.difficulty,
        trainerIndex: ctx.selection.trainerIndex,
        quickRuleId: mode === 'quick' ? ctx.selection.quickRule : null,
        circuitCondition: ctx.selection.circuitCondition,
        trialId: ctx.selection.trialId,
        modifiers:
          mode === 'quick'
            ? [...quickRule(ctx.selection.quickRule).modifiers]
            : mode === 'circuit'
              ? [...circuit.condition.modifiers]
              : mode === 'trial'
                ? [...(ctx.selection.modifiers || [])]
                : [],
      });
  });
}

registerRoutes({
  newSelection,
  teamMatchup,
  teamProfileHtml,
  creatureMatchup,
  moveArchetype,
  creatureCard,
  kitShowcaseHtml,
  renderTeamSelect,
});
