import { ctx, registerRoutes, route } from '../app/context.js';
import { groupBeats } from '../battle-ui/beats.js';

const {
  AFFINITIES,
  ARENA_WEATHER,
  AFFINITY_ORDER,
  CLASSES,
  CLASS_ORDER,
  CREATURES,
  CREATURE_IDS,
  MOVES,
  CURRENT_FEAT_IDS,
  CHROMATIQUE_RANK,
  chromatiqueUnlocked,
  affinityMultiplier,
  activeOf,
  createBattle,
  getLegalActions,
  resolveTurn,
  signatureCostFor,
  isChromatiqueShown,
  masteryRank,
  sortStatusIds,
  statusBadgeHtml,
  i18n,
  t,
  screen,
  sound,
  sprite,
  spriteVariant,
  creatureName,
  affinityName,
  classIcon,
  className,
  escapeHtml,
  disposeArena,
  ensureBattleStyles,
  loadArena,
  params,
  testAnimationScale,
  setChromatique,
  topbar,
} = ctx;
const {
  bindCommon,
  creatureSheetHtml,
  icon,
  openSheet,
  beginPresentation,
  advancePresentation,
  playEvents,
  clearBattleFx,
} = route;

const EMPTY_RECORD = Object.freeze({
  battles: 0,
  wins: 0,
  damage: 0,
  kos: 0,
  signatures: 0,
  combos: 0,
  assists: 0,
});
const recordOf = (id) => ({ ...EMPTY_RECORD, ...(ctx.save.records?.[id] || {}) });
// Same markup as the team-select type badges (styled in styles/screens/selection.css).
const typeDot = (affinityId) => `<i class="type-dot" data-type="${affinityId}" aria-hidden="true"></i>`;

function displayedStatusIds(move) {
  return [
    ...new Set(
      sortStatusIds([
        ...(move.selfStatuses || []).map(({ id }) => id),
        ...(move.targetStatuses || []).map(({ id }) => id),
      ])
    ),
  ];
}

function moveStatusBadgesHtml(move, className = '') {
  const ids = displayedStatusIds(move);
  return ids.length
    ? `<span class="move-status-badges${className ? ` ${className}` : ''}">${ids.map((id) => statusBadgeHtml(id, { label: escapeHtml(t(`status.${id}`)), compact: true })).join('')}</span>`
    : '';
}

/* ------------------------------------------------------------ move theater */

// The Move Theater (docs/battle-presentation.md §8.5) plays one move on the battle's own Stade
// Lumière stack: the WebGL arena and fighters, the director's choreography (Signature cut-in, hit
// reaction, readouts) and the cue-bus sound. The turn is real engine output from a sandbox battle,
// so the stage shows exactly what the move does in a battle.

// A creature's home arena is the one whose weather favours its type (Crystal for the others). It is
// scenery only: the sandbox battle has no weather.
const HOME_ARENA = Object.fromEntries(
  Object.entries(ARENA_WEATHER).flatMap(([arena, weather]) =>
    Object.entries(weather)
      .filter(([, multiplier]) => multiplier > 1)
      .map(([affinity]) => [affinity, arena])
  )
);
// A move that heals starts from a wounded team, so its numbers show; the sparring partner cannot
// be knocked out.
const THEATER_WOUND = 0.55;
const THEATER_PARTNER_HP = 999;

let theaterRequest = 0;
let theaterTrigger = null;
// The open theater: { overlay, script, arena, ready, session }.
let theater = null;

// The sandbox turn, deterministic: the move's owner (with an ally, for relays and team effects)
// against a sparring partner that takes the move's type at ×1, with no talent, status or barrier
// on either side. The rival only switches the partner in, so it never acts, and `forecast` rolls no
// critical hit. `lead` holds that switch's events, `events` the move's one action beat.
function theaterScript(moveId) {
  const move = MOVES[moveId],
    ownerIndex = CREATURE_IDS.indexOf(move.owner),
    others = CREATURE_IDS.map((_, i) => CREATURE_IDS[(ownerIndex + 7 + i) % CREATURE_IDS.length]).filter(
      (id) => id !== move.owner
    ),
    partner = others.find((id) => affinityMultiplier(move.affinity, CREATURES[id].affinity) === 1),
    [ally, decoy] = others.filter((id) => id !== partner),
    before = createBattle({ playerTeam: [move.owner, ally], enemyTeam: [decoy, partner] });
  for (const side of ['player', 'enemy'])
    for (const creature of before.sides[side].team)
      Object.assign(creature, { passive: null, talent: {}, statuses: {}, barrier: 0 });
  Object.assign(before.sides.enemy.team[1], { hp: THEATER_PARTNER_HP, maxHp: THEATER_PARTNER_HP });
  if (move.healRatio || move.teamHealRatio || move.drain)
    for (const creature of before.sides.player.team) creature.hp = Math.round(creature.maxHp * THEATER_WOUND);
  before.sides.player.surge = move.signature ? signatureCostFor(activeOf(before, 'player')) : 0;
  before.sides.enemy.surge = 0;
  const action = getLegalActions(before, 'player').find((candidate) => candidate.moveId === moveId),
    { state, events } = resolveTurn(before, action, { type: 'switch', index: 1 }, { forecast: true }),
    beats = groupBeats(events),
    index = beats.findIndex((beat) => beat.kind === 'action' && beat.side === 'player');
  return {
    partner,
    before,
    state,
    lead: beats.slice(0, index).flatMap((beat) => beat.events),
    events: beats[index].events,
  };
}

// Named, visually hidden stand-ins for the WebGL fighters (§8.3), as in battle.
function theaterProxyHtml(side, id, variant) {
  return `<div class="fighter-proxy visually-hidden ${side}" id="fighter-${side}" data-creature="${id}" data-affinity="${CREATURES[id].affinity}" data-phase="idle"><img src="${sprite(id, variant)}" alt="${escapeHtml(creatureName(id))}" width="128" height="128"></div>`;
}

function theaterHtml(move, script) {
  return `<div class="move-theater" role="dialog" aria-modal="true" aria-labelledby="theater-title" data-move="${move.id}" data-state="loading"><header class="theater-head"><div class="theater-title"><span>${t('bestiary.theaterHint')}</span><h2 id="theater-title">${t('bestiary.theater')}</h2></div><button type="button" class="icon-btn" data-action="close-theater" aria-label="${t('app.close')}">${icon('close')}</button><div class="theater-move"><b>${creatureName(move.owner)} · ${t(`move.${move.id}`)}</b><small>${t(`move.effect.${move.id}`)}</small>${moveStatusBadgesHtml(move, 'theater-status-badges')}</div></header><section class="theater-stage"><canvas id="arena" class="arena-canvas" aria-hidden="true"></canvas>${theaterProxyHtml('enemy', script.partner, 'normal')}${theaterProxyHtml('player', move.owner, spriteVariant(move.owner))}<div id="fx-text" class="fx-text" aria-hidden="true"></div></section><div class="theater-actions"><button type="button" class="subtle-btn" data-action="replay-theater">${icon('refresh')}<span>${t('bestiary.replay')}</span></button></div></div>`;
}

// The stage cannot show: its reason in place of the arena, and nothing to replay.
function theaterFailure(current, key) {
  const { overlay } = current,
    actions = overlay.querySelector('.theater-actions');
  overlay.dataset.state = 'error';
  if (actions?.contains(document.activeElement))
    overlay.querySelector('[data-action="close-theater"]').focus();
  actions?.remove();
  overlay
    .querySelector('.theater-stage')
    .insertAdjacentHTML('beforeend', `<p class="theater-error" role="status">${t(key)}</p>`);
}

// Cancels the running presentation session: its clock and cue bus stop, its readouts, banners and
// FX quads go.
function endTheaterRun(current) {
  const session = current.session;
  current.session = null;
  if (!session) return;
  session.cancelled = true;
  clearBattleFx(session);
  session.clock?.dispose();
  session.cues?.dispose();
}

function disposeTheaterArena(current) {
  if (!current.arena) return;
  if (ctx.arenaScene === current.arena) disposeArena();
  else current.arena.dispose();
  current.arena = null;
}

// One run of the move: a fresh presentation session (clock, cue bus) on a reset stage, played by
// the director. Rejouer cancels a running one.
function playMoveTheater(current) {
  if (theater !== current || !current.ready || !current.arena) return;
  endTheaterRun(current);
  const { arena, overlay, script } = current,
    session = {
      state: script.state,
      displayState: null,
      timeline: [],
      lastLine: '',
      cancelled: false,
      // A non-battle session brings its own liveness rule to the director.
      alive: () => theater === current && current.session === session && overlay.isConnected,
    };
  for (const side of ['player', 'enemy']) {
    arena.fighters.react(side, 'idle');
    arena.fighters.react(side, 'tint', { status: null });
  }
  arena.setGrade({});
  void arena.shot('cut');
  current.session = session;
  beginPresentation(session, script.before);
  for (const event of script.lead) advancePresentation(session, event);
  overlay.dataset.state = 'playing';
  void playEvents(script.events, session).then(() => {
    if (session.alive()) overlay.dataset.state = 'done';
  });
}

function removeMoveTheater() {
  const current = theater;
  theater = null;
  ctx.currentFxMove = null;
  if (!current) return;
  // Removed first, so clearing the run also drops the director's readout layer bound to it.
  current.overlay.remove();
  endTheaterRun(current);
  disposeTheaterArena(current);
}

function closeMoveTheater() {
  theaterRequest += 1;
  removeMoveTheater();
  const trigger = theaterTrigger;
  theaterTrigger = null;
  if (trigger?.isConnected) trigger.focus();
}

// Full-screen dialog above the creature sheet. The stage is the battle's: an ArenaScene in the
// owner's home arena (quality tier, DPR cap and frame governor as in battle), both fighters on the
// GPU and every program compiled before the move plays.
async function openMoveTheater(moveId, trigger = null) {
  const req = ++theaterRequest;
  theaterTrigger = trigger?.isConnected
    ? trigger
    : document.activeElement?.matches?.('[data-preview-move]')
      ? document.activeElement
      : null;
  removeMoveTheater();
  const move = MOVES[moveId];
  if (!move) return;
  const [, arenaModule] = await Promise.all([
    ensureBattleStyles(),
    loadArena().catch((error) => {
      console.error(error);
      return null;
    }),
  ]);
  if (req !== theaterRequest || screen.dataset.page !== 'bestiary') return;
  const script = theaterScript(moveId);
  screen.insertAdjacentHTML('beforeend', theaterHtml(move, script));
  const overlay = screen.querySelector('.move-theater'),
    current = (theater = { overlay, script, arena: null, ready: false, session: null }),
    close = overlay.querySelector('[data-action="close-theater"]'),
    canvas = overlay.querySelector('#arena');
  close.addEventListener('click', closeMoveTheater);
  overlay
    .querySelector('[data-action="replay-theater"]')
    .addEventListener('click', () => playMoveTheater(current));
  close.focus();
  disposeArena();
  try {
    // Browsers keep a failed module load for the page's lifetime: that asks for a reload.
    if (!arenaModule) throw new Error('ARENA_LOAD_FAILED');
    if (params.get('failWebgl') === '1') throw new Error('WEBGL_UNAVAILABLE');
    current.arena = ctx.arenaScene = new arenaModule.ArenaScene(
      canvas,
      HOME_ARENA[CREATURES[move.owner].affinity] ?? 'crystal',
      {
        quality: ctx.quality,
        governor: ctx.qualityGovernor,
        reducedMotion: ctx.save.reducedMotion,
        highContrast: ctx.save.highContrast,
        testAnimationScale,
      }
    );
  } catch {
    theaterFailure(current, arenaModule ? 'error.webgl' : 'error.arenaLoad');
    return;
  }
  canvas.addEventListener('arena-context-lost', () => {
    if (theater !== current) return;
    endTheaterRun(current);
    disposeTheaterArena(current);
    theaterFailure(current, 'error.context');
  });
  const { arena } = current;
  await Promise.all([
    arena.fighters.setCreature('player', move.owner, { variant: spriteVariant(move.owner) }),
    arena.fighters.setCreature('enemy', script.partner),
    sound.unlock(),
  ]);
  // warmUp resolves false once the arena is disposed (closed, context lost).
  if (theater !== current || !(await arena.warmUp()) || theater !== current) return;
  current.ready = true;
  playMoveTheater(current);
}

/* ---------------------------------------------------------- creature sheet */

function chromatiqueHtml(id) {
  if (!chromatiqueUnlocked(id, ctx.save))
    return `<p class="chroma-row locked">${icon('lock')}<span>${t('bestiary.chromaLocked', { rank: CHROMATIQUE_RANK })}</span></p>`;
  const shown = isChromatiqueShown(id, ctx.save);
  return `<button type="button" class="chroma-row chroma-switch" role="switch" aria-checked="${shown}" data-chromatique="${id}"><span class="chroma-preview" aria-hidden="true"><img src="${sprite(id, 'chromatique')}" data-variant="chromatique" alt="" width="128" height="128"></span><span class="chroma-label">${icon('sparkle')}<b>${t('bestiary.chroma')}</b></span><i class="chroma-track" aria-hidden="true"></i></button>`;
}

function recordHtml(id) {
  const record = recordOf(id);
  if (!record.battles && !record.assists) return '';
  const stat = (value, key) => `<span><b class="num">${value}</b>${t(key)}</span>`;
  return `<div class="creature-record">${stat(record.battles, 'record.battles')}${stat(record.wins, 'record.wins')}${stat(record.kos, 'record.kos')}${stat(record.damage, 'record.damage')}${stat(record.signatures, 'record.signatures')}${stat(record.combos, 'record.combos')}${record.assists ? `<span class="legacy-record"><b class="num">${record.assists}</b>${t('record.assistsLegacy')}</span>` : ''}</div>`;
}

function openCreatureSheet(id) {
  const headingId = `bestiary-sheet-${id}`,
    loreUnlocked = CREATURE_IDS.indexOf(id) < 6 + ctx.save.ladderVictories * 2,
    lore = loreUnlocked
      ? `<p class="bestiary-lore">${t(`lore.${id}`)}</p>`
      : `<p class="bestiary-lore locked">${icon('lock')}<span>${t('bestiary.loreLocked')}</span></p>`,
    body = document.createElement('div');
  body.className = 'bestiary-sheet';
  body.innerHTML = `${creatureSheetHtml(id, { headingId, movesAsButtons: true })}${recordHtml(id)}${lore}`;
  // The Chromatique row spans the sheet under the portrait, whose image it swaps.
  body.querySelector('.creature-sheet-head').insertAdjacentHTML('afterend', chromatiqueHtml(id));
  body.querySelectorAll('[data-preview-move]').forEach((entry) => {
    entry.setAttribute('aria-label', t('bestiary.preview', { move: t(`move.${entry.dataset.previewMove}`) }));
    entry.addEventListener('click', () => openMoveTheater(entry.dataset.previewMove, entry));
  });
  body.querySelector('[data-chromatique]')?.addEventListener('click', (event) => {
    const toggle = event.currentTarget,
      shown = setChromatique(id, toggle.getAttribute('aria-checked') !== 'true');
    toggle.setAttribute('aria-checked', String(shown));
    sound.ui();
  });
  const signature = CREATURES[id].moves.find((moveId) => MOVES[moveId].signature);
  openSheet({
    labelledBy: headingId,
    body,
    actions: [
      {
        label: t('bestiary.watch'),
        variant: 'primary',
        icon: 'play',
        action: 'bestiary-watch',
        keepOpen: true,
        onSelect: () => openMoveTheater(signature, document.activeElement),
      },
    ],
  });
}

/* --------------------------------------------------------------- my stats */

// The feat hall lists every current feat, plus the legacy assist feat for the
// saves that earned it.
function featProgress() {
  const ids = [...CURRENT_FEAT_IDS, ...(ctx.save.feats.includes('team_assist') ? ['team_assist'] : [])];
  return { ids, earned: ids.filter((id) => ctx.save.feats.includes(id)).length };
}

function openStatsSheet() {
  const { ids: visibleFeatIds, earned } = featProgress(),
    favorite = CREATURE_IDS.map((id) => ({ id, ...recordOf(id) })).sort(
      (a, b) =>
        b.battles - a.battles ||
        b.damage - a.damage ||
        CREATURE_IDS.indexOf(a.id) - CREATURE_IDS.indexOf(b.id)
    )[0],
    stat = (value, key) => `<span><b class="num">${value}</b><small>${t(key)}</small></span>`,
    hero = favorite.battles
      ? `<section class="record-hero" style="--record-color:${AFFINITIES[CREATURES[favorite.id].affinity].color}"><div class="record-creature"><img src="${sprite(favorite.id)}" alt="" width="128" height="128"><span><small>${t('record.favorite')}</small><h3>${creatureName(favorite.id)}</h3></span></div><div class="record-hero-stats">${stat(favorite.battles, 'record.battles')}${stat(favorite.wins, 'record.wins')}${stat(favorite.damage, 'record.damage')}${stat(favorite.kos, 'record.kos')}</div></section>`
      : `<section class="record-hero empty"><p>${t('record.none')}</p></section>`,
    feats = visibleFeatIds
      .map((id) => {
        const got = ctx.save.feats.includes(id);
        return got
          ? `<li class="feat-card earned"><i>${icon('trophy')}</i><span><b>${t(`feat.${id}`)}</b><small>${t(`feat.effect.${id}`)}</small></span></li>`
          : `<li class="feat-card locked"><i>${icon('lock')}</i><span><b>${t(`feat.hint.${id}`)}</b></span></li>`;
      })
      .join('');
  openSheet({
    title: t('bestiary.myStats'),
    body: `${hero}<section class="feat-hall"><h3>${t('feat.gallery')} <span class="eyebrow num">${earned}/${visibleFeatIds.length}</span></h3><ul class="feat-gallery">${feats}</ul></section>`,
  });
}

/* ------------------------------------------------------------------ grid */

function cardHtml(id) {
  const creature = CREATURES[id],
    rank = masteryRank(ctx.save.mastery[id] || 0),
    chroma = chromatiqueUnlocked(id, ctx.save)
      ? `<i class="bestiary-chroma">${icon('sparkle', { label: t('bestiary.chroma') })}</i>`
      : '',
    mastery = rank ? `<i class="bestiary-rank">${icon('star')}<b class="num">${rank}</b></i>` : '';
  return `<button type="button" class="bestiary-card" data-bestiary-open="${id}" data-creature="${id}" data-affinity="${creature.affinity}" data-class="${creature.classId}" aria-haspopup="dialog" style="--type-color:${AFFINITIES[creature.affinity].color}"><img src="${sprite(id)}" alt="" width="128" height="128" loading="lazy" decoding="async"><b>${creatureName(id)}</b>${typeDot(creature.affinity)}${mastery}${chroma}</button>`;
}

function chipHtml(kind, id, label, glyph, active) {
  return `<button type="button" class="bestiary-chip${active ? ' active' : ''}" data-bestiary-${kind}="${id}" aria-pressed="${active}">${glyph}<span>${label}</span></button>`;
}

function renderBestiary() {
  disposeArena();
  ctx.battleSession = null;
  screen.dataset.page = 'bestiary';
  screen.className = 'screen';
  const total = CREATURE_IDS.length,
    typeChips = [
      chipHtml('affinity', 'all', t('filter.allTypes'), '', true),
      ...AFFINITY_ORDER.map((id) => chipHtml('affinity', id, affinityName(id), typeDot(id), false)),
    ].join(''),
    classChips = [
      chipHtml('class', 'all', t('filter.allClasses'), '', true),
      ...CLASS_ORDER.map((id) =>
        chipHtml(
          'class',
          id,
          className(id),
          `<i style="--class-color:${CLASSES[id].color}">${classIcon(id)}</i>`,
          false
        )
      ),
    ].join(''),
    tools = `<section class="bestiary-tools"><div class="bestiary-search-row"><label class="bestiary-search">${icon('search')}<input type="search" data-bestiary-search aria-label="${t('bestiary.search')}" placeholder="${t('bestiary.searchPlaceholder')}" autocomplete="off" enterkeyhint="search"></label><button type="button" class="icon-btn bestiary-filter-toggle" data-bestiary-toggle aria-expanded="false" aria-controls="bestiary-filter-chips" aria-label="${t('bestiary.filters')}">${icon('filter')}</button><b class="bestiary-count num" data-bestiary-count aria-live="polite">${total}/${total}</b></div><div id="bestiary-filter-chips" class="bestiary-filter-chips" hidden><div class="bestiary-filter-row" role="group" aria-label="${t('filter.types')}">${typeChips}</div><div class="bestiary-filter-row" role="group" aria-label="${t('filter.classes')}">${classChips}</div></div></section>`;
  const feats = featProgress(),
    statsButton = `<button type="button" class="subtle-btn bestiary-stats-btn" data-action="bestiary-stats">${icon('trophy')}<span>${t('bestiary.myStats')}</span><b class="num">${t('feat.total', { count: feats.earned, total: feats.ids.length })}</b>${icon('chevron-right')}</button>`;
  screen.innerHTML = `<div class="shell bestiary-page">${topbar(t('bestiary.title'))}${statsButton}${tools}<div class="bestiary-grid">${CREATURE_IDS.map(cardHtml).join('')}</div><div class="bestiary-empty" role="status" hidden><p>${t('bestiary.noResults')}</p><button type="button" class="subtle-btn" data-bestiary-clear>${t('bestiary.clearFilters')}</button></div></div>`;
  bindCommon();
  bindBestiary();
}

function bindBestiary() {
  const input = screen.querySelector('[data-bestiary-search]'),
    count = screen.querySelector('[data-bestiary-count]'),
    cards = [...screen.querySelectorAll('.bestiary-card')],
    empty = screen.querySelector('.bestiary-empty'),
    toggle = screen.querySelector('[data-bestiary-toggle]'),
    chips = screen.querySelector('#bestiary-filter-chips'),
    filters = { affinity: 'all', class: 'all' };
  const press = (kind) =>
    screen.querySelectorAll(`[data-bestiary-${kind}]`).forEach((chip) => {
      const active =
        chip.dataset[kind === 'affinity' ? 'bestiaryAffinity' : 'bestiaryClass'] === filters[kind];
      chip.classList.toggle('active', active);
      chip.setAttribute('aria-pressed', String(active));
    });
  const apply = () => {
    const query = input.value.trim().toLocaleLowerCase(i18n.lang);
    let visible = 0;
    for (const card of cards) {
      const show =
        (filters.affinity === 'all' || card.dataset.affinity === filters.affinity) &&
        (filters.class === 'all' || card.dataset.class === filters.class) &&
        creatureName(card.dataset.creature).toLocaleLowerCase(i18n.lang).includes(query);
      card.hidden = !show;
      if (show) visible += 1;
    }
    count.textContent = `${visible}/${CREATURE_IDS.length}`;
    empty.hidden = visible > 0;
    toggle.classList.toggle('filtered', filters.affinity !== 'all' || filters.class !== 'all');
  };
  input.addEventListener('input', apply);
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    chips.hidden = !open;
  });
  chips.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-bestiary-affinity], [data-bestiary-class]');
    if (!chip) return;
    const kind = chip.dataset.bestiaryAffinity ? 'affinity' : 'class';
    filters[kind] = chip.dataset.bestiaryAffinity ?? chip.dataset.bestiaryClass;
    press(kind);
    apply();
  });
  screen.querySelector('[data-bestiary-clear]').addEventListener('click', () => {
    input.value = '';
    filters.affinity = 'all';
    filters.class = 'all';
    press('affinity');
    press('class');
    apply();
    input.focus();
  });
  screen.querySelector('.bestiary-grid').addEventListener('click', (event) => {
    const card = event.target.closest('[data-bestiary-open]');
    if (!card) return;
    sound.ui();
    openCreatureSheet(card.dataset.bestiaryOpen);
  });
  screen.querySelector('[data-action="bestiary-stats"]').addEventListener('click', openStatsSheet);
}

registerRoutes({ closeMoveTheater, renderBestiary });
