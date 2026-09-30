import { ctx, registerRoutes, route } from '../app/context.js';
import { ARENA_WEATHER } from '../data/affinities.js';
import { CIRCUIT_CONDITIONS } from '../data/circuit.js';

const {
  AFFINITIES,
  AFFINITY_ORDER,
  CLASSES,
  affinityMultiplier,
  CREATURES,
  CREATURE_IDS,
  MOVES,
  masteryRank,
  SQUAD_PRESETS,
  QUICK_RULES,
  quickRule,
  TRAINERS,
  ARENAS,
  TRIALS,
  GAUNTLET_STAGES,
  circuitMatch,
  bestLeadIndex,
  remixTeam,
  params,
  t,
  screen,
  sound,
  LADDER_COUNT,
  sprite,
  creatureName,
  affinityName,
  classIcon,
  className,
  persist,
  notify,
  escapeHtml,
  disposeArena,
  ensureBattleStyles,
  topbar,
} = ctx;
const { randomDistinct, startGauntlet, startBattle, openSheet, icon } = route;

const DIFFICULTIES = ['apprentice', 'standard', 'champion'];
const LONG_PRESS_MS = 450;
const CRY_COOLDOWN_MS = 300;
// Tall desktop two-column layout: the creature sheet sits inline under the bar
// (styles/screens/selection.css uses the same query).
const INLINE_DETAIL = matchMedia('(min-width: 1100px) and (min-height: 820px)');
const STAT_KEYS = [
  ['maxHp', 'select.statHp'],
  ['attack', 'select.statAttack'],
  ['guard', 'select.statGuard'],
  ['speed', 'select.statSpeed'],
];
const STAT_MAX = Object.fromEntries(
  STAT_KEYS.map(([stat]) => [stat, Math.max(...CREATURE_IDS.map((id) => CREATURES[id][stat]))])
);

/* Type badges (`<i class="type-dot" data-type="flame">`) draw the authored type
   icon from src/data/affinities.js as a CSS mask, so a badge is one element
   instead of an inline SVG; styles/screens/selection.css styles `.type-dot`.
   The per-type rules are generated once from the data. */
function installTypeDots() {
  if (document.getElementById('type-dot-rules')) return;
  const rules = Object.entries(AFFINITIES).map(([id, meta]) => {
    const stroke = meta.iconStrokePath
      ? `<path d="${meta.iconStrokePath}" fill="none" stroke="#000" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`
      : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${meta.iconPath}" fill-rule="evenodd" clip-rule="evenodd"/>${stroke}</svg>`;
    return `.type-dot[data-type='${id}']{--type-color:${meta.color};--type-icon:url("data:image/svg+xml,${encodeURIComponent(svg)}")}`;
  });
  const style = document.createElement('style');
  style.id = 'type-dot-rules';
  style.textContent = rules.join('\n');
  document.head.append(style);
}
installTypeDots();

const typeDot = (affinityId) => `<i class="type-dot" data-type="${affinityId}" aria-hidden="true"></i>`;

/* Matchup marker: a green up arrow or a red down arrow (the same SVG turned
   over), drawn from the `data-matchup` of its parent cell or slot; the legend
   passes the direction itself. The sentence lives in the parent's label. */
const matchupMark = (direction = '') =>
  `<i class="matchup-mark${direction ? ` is-${direction}` : ''}" aria-hidden="true">${icon('arrow-up')}</i>`;

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
    quickRule: 'standard',
    circuitCondition: mode === 'circuit' ? circuit.condition.id : null,
  };
}

// My type against the rival team: `good` foes my type hits super-effectively,
// `risk` foes whose type hits mine super-effectively.
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

const matchupDirection = ({ edge }) => (edge > 0 ? 'up' : edge < 0 ? 'down' : 'even');

function matchupText({ good, risk }) {
  const parts = [];
  if (good) parts.push(t('select.scoutGood', { count: good }));
  if (risk) parts.push(t('select.scoutRisk', { count: risk }));
  return parts.length ? parts.join(' · ') : t('select.scoutNeutral');
}

// Modifiers a selection's battle starts with (the gauntlet adds its stage's own).
function selectionModifiers(selection) {
  if (selection.mode === 'quick') return [...quickRule(selection.quickRule).modifiers];
  if (selection.mode === 'circuit')
    return [
      ...(CIRCUIT_CONDITIONS.find((condition) => condition.id === selection.circuitCondition)?.modifiers ||
        []),
    ];
  if (selection.mode === 'trial') return [...(selection.modifiers || [])];
  if (selection.mode === 'gauntlet') return [...GAUNTLET_STAGES[0].modifiers];
  return [];
}

// Arena weather as the engine applies it (`fierce_weather` doubles each effect).
function weatherRows(arena, modifiers) {
  const fierce = modifiers.includes('fierce_weather');
  return Object.entries(ARENA_WEATHER[arena] || {})
    .map(([affinity, multiplier]) => ({
      affinity,
      multiplier: fierce ? 1 + 2 * (multiplier - 1) : multiplier,
    }))
    .sort((a, b) => b.multiplier - a.multiplier)
    .map(({ affinity, multiplier }) => ({
      affinity,
      up: multiplier > 1,
      percent: Math.round(Math.abs(multiplier - 1) * 100),
      text: t(multiplier > 1 ? 'battle.weatherUp' : 'battle.weatherDown', {
        type: affinityName(affinity),
        percent: Math.round(Math.abs(multiplier - 1) * 100),
      }),
    }));
}

function weatherLine(arena, modifiers) {
  const rows = weatherRows(arena, modifiers);
  return rows.length ? rows.map((row) => row.text).join(' · ') : t(`arena.rule.${arena}`);
}

// The rival's most frequent type (ties go to the rival lead's type); null when all differ.
function dominantType(enemy, enemyLead = 0) {
  const counts = new Map();
  for (const id of enemy) counts.set(CREATURES[id].affinity, (counts.get(CREATURES[id].affinity) || 0) + 1);
  const best = Math.max(0, ...counts.values());
  if (best < 2) return null;
  const leadType = CREATURES[enemy[enemyLead]]?.affinity;
  return counts.get(leadType) === best ? leadType : [...counts].find(([, count]) => count === best)[0];
}

/* ------------------------------------------------------------ creature sheet */

// "Fort contre 1 rival · Faible contre 2 rivaux" (this creature against the rival trio) with its
// arrow, green, red or plain.
function matchupChipHtml(matchup, tag = 'p') {
  const direction = matchupDirection(matchup);
  return `<${tag} class="sheet-chip creature-sheet-matchup is-${direction}">${direction === 'even' ? '' : icon(`arrow-${direction}`)}${escapeHtml(matchupText(matchup))}</${tag}>`;
}

/* Sheet body shared with the bestiary (4D): portrait, type/class chips, stat
   bars, talent and the three moves in plain words. With `headingId` the name
   is an <h2> in the body (open with labelledBy); without it the caller gives
   openSheet the name as its title. `extra` lands after the head;
   `movesAsButtons` renders move rows as Move Theater triggers; `rivalTeam`
   adds the matchup chip. */
function creatureSheetHtml(id, { headingId, extra = '', movesAsButtons = false, rivalTeam = null } = {}) {
  const creature = CREATURES[id],
    rank = masteryRank(ctx.save.mastery[id] || 0);
  const stats = STAT_KEYS.map(
    ([stat, key]) =>
      `<div><dt>${t(key)}</dt><dd><i><u style="--fill:${(creature[stat] / STAT_MAX[stat]).toFixed(3)}"></u></i><b class="num">${creature[stat]}</b></dd></div>`
  ).join('');
  const moves = creature.moves
    .map((moveId) => {
      const move = MOVES[moveId],
        tag = movesAsButtons ? 'button' : 'div',
        attrs = movesAsButtons ? ` type="button" data-preview-move="${moveId}"` : '',
        badge = move.signature
          ? `<i class="creature-sheet-signature" aria-hidden="true">${icon('sparkle')}</i>`
          : typeDot(move.affinity);
      return `<li><${tag} class="creature-sheet-move${move.signature ? ' is-signature' : ''}"${attrs} style="--move-color:${AFFINITIES[move.affinity]?.color || AFFINITIES.neutral.color}">${badge}<span><b>${escapeHtml(t(`move.${moveId}`))}</b><small>${escapeHtml(t(`move.effect.${moveId}`))}</small></span></${tag}></li>`;
    })
    .join('');
  return `<div class="creature-sheet" style="--type-color:${AFFINITIES[creature.affinity].color}"><div class="creature-sheet-head"><span class="creature-sheet-portrait"><img src="${sprite(id)}" alt="" width="128" height="128" decoding="async"></span><div>${headingId ? `<h2 class="creature-sheet-name" id="${headingId}">${escapeHtml(creatureName(id))}</h2>` : ''}<div class="creature-sheet-chips"><span class="sheet-chip">${typeDot(creature.affinity)}${escapeHtml(affinityName(creature.affinity))}</span><span class="sheet-chip" style="--class-color:${CLASSES[creature.classId].color}">${classIcon(creature.classId)}${escapeHtml(className(creature.classId))}</span>${rank ? `<span class="sheet-chip is-mastery">${icon('star')}${escapeHtml(t('mastery.rank', { rank }))}</span>` : ''}</div>${rivalTeam?.length ? matchupChipHtml(creatureMatchup(id, rivalTeam)) : ''}</div></div>${extra}<dl class="creature-sheet-stats">${stats}</dl><div class="creature-sheet-talent"><small>${escapeHtml(t('select.talent'))}</small><b>${escapeHtml(t(`passive.${creature.passive}`))}</b><p>${escapeHtml(t(`passive.effect.${creature.passive}`))}</p></div><ul class="creature-sheet-moves">${moves}</ul></div>`;
}

/* --------------------------------------------------------------- team select */

let cryAt = 0;

// A picked creature calls out (owner decision #26), after the patch has painted.
function cry(id) {
  const now = performance.now();
  if (now - cryAt < CRY_COOLDOWN_MS) return;
  cryAt = now;
  requestAnimationFrame(() => setTimeout(() => sound.call(id), 0));
}

function rivalHtml(selection) {
  const { mode } = selection,
    modifiers = selectionModifiers(selection),
    weather = weatherRows(selection.arena, modifiers),
    boosted = weather.find((row) => row.up),
    dominant =
      selection.enemyTeam.length === 3 ? dominantType(selection.enemyTeam, selection.enemyLead) : null;
  const eyebrow =
      mode === 'ladder'
        ? `${t('app.league')} · ${selection.trainerIndex + 1}/${LADDER_COUNT}`
        : mode === 'circuit'
          ? t('circuit.round', { round: circuitMatch(ctx.save.circuitWins, LADDER_COUNT).round })
          : mode === 'gauntlet'
            ? t('gauntlet.title')
            : mode === 'trial'
              ? t('trial.title')
              : t('app.quick'),
    name = rivalName(selection),
    rule =
      mode === 'circuit'
        ? t(`circuit.${selection.circuitCondition}`)
        : mode === 'quick' && selection.quickRule !== 'standard'
          ? t(`quickRule.${selection.quickRule}`)
          : '',
    foes = Array.from({ length: 3 }, (_, index) => {
      const id = selection.enemyTeam[index];
      return id
        ? `<span class="ts-foe" data-foe="${id}"><img src="${sprite(id, 'normal')}" alt="${escapeHtml(creatureName(id))}" width="64" height="64" decoding="async">${typeDot(CREATURES[id].affinity)}</span>`
        : '<span class="ts-foe is-empty"></span>';
    }).join('');
  const chips = `${dominant ? `<span class="ts-chip">${typeDot(dominant)}${escapeHtml(t('select.rivalMostly', { type: affinityName(dominant) }))}</span>` : ''}${boosted ? `<span class="ts-chip ts-weather"><span aria-hidden="true">${escapeHtml(t('select.weather'))}</span>${typeDot(boosted.affinity)}<b class="num" aria-hidden="true">${escapeHtml(t('battle.weatherBadge', { percent: boosted.percent }))}</b><span class="visually-hidden">${escapeHtml(`${t('arena.ruleTitle')}. ${weather.map((row) => row.text).join(', ')}`)}</span></span>` : ''}${rule ? `<span class="ts-chip rule-chip">${escapeHtml(rule)}</span>` : ''}`;
  const quick = mode === 'quick';
  return `<div class="ts-rival-text"><span class="ts-eyebrow">${escapeHtml(eyebrow)}</span><h2 id="ts-rival-name">${escapeHtml(name)}</h2></div><div class="ts-rival-team">${foes}</div>${chips ? `<div class="ts-rival-chips">${chips}</div>` : ''}<button type="button" class="ts-rival-open" data-action="${quick ? 'open-options' : 'open-rival'}" aria-label="${escapeHtml(quick ? t('select.plan') : t('select.rivalOpen'))}">${icon(quick ? 'settings' : 'info')}</button>`;
}

/* A filled slot: its body opens the slot's action sheet (lead, card, remove),
   the × removes it at once, and the crown plate under it sends it in first.
   Its portrait is a shared creature: the route transition (shell.js) moves it
   from or to the title's trio. */
function slotsHtml(selection, fresh = -1) {
  const suggested = selection.team.length === 3 ? bestLeadIndex(selection.team, selection.enemyTeam) : -1;
  return Array.from({ length: 3 }, (_, index) => {
    const id = selection.team[index];
    if (!id)
      return `<div class="ts-slot is-empty"><span class="ts-slot-empty">${icon('sparkle')}<span>${escapeHtml(t('select.pickHint'))}</span></span></div>`;
    const name = creatureName(id),
      lead = selection.lead === index,
      crownLabel = lead ? t('select.lead') : index === suggested ? t('select.suggested') : '';
    return `<div class="ts-slot${lead ? ' is-lead' : ''}${index === suggested ? ' is-suggested' : ''}${index === fresh ? ' is-new' : ''}" style="--type-color:${AFFINITIES[CREATURES[id].affinity].color}"><button type="button" class="ts-slot-main" data-slot-open="${index}" aria-haspopup="dialog" aria-label="${escapeHtml(name)}"><img src="${sprite(id)}" alt="" width="64" height="64" data-shared-creature="${id}"><span class="ts-slot-name">${escapeHtml(name)}</span></button>${typeDot(CREATURES[id].affinity)}<button type="button" class="ts-slot-remove" data-slot-remove="${index}" aria-label="${escapeHtml(t('select.remove', { name }))}">${icon('close')}</button><button type="button" class="ts-crown" data-lead-index="${index}" aria-pressed="${lead}" aria-label="${escapeHtml(`${name}, ${lead ? t('select.lead') : t('select.chooseLead')}`)}">${icon('crown')}${crownLabel ? `<span aria-hidden="true">${escapeHtml(crownLabel)}</span>` : ''}</button></div>`;
  }).join('');
}

function trioHtml(selection) {
  return Array.from({ length: 3 }, (_, index) => {
    const id = selection.team[index];
    return id
      ? `<img class="${selection.lead === index ? 'is-lead' : ''}" src="${sprite(id)}" alt="" width="64" height="64">`
      : '<i></i>';
  }).join('');
}

const cellLabel = (id, matchup) =>
  `${creatureName(id)}, ${affinityName(CREATURES[id].affinity)}, ${matchupText(matchup)}`;

/* A grid card: the portrait button picks (long-press, right-click or the i key
   open the sheet) and the (i) corner button opens the sheet. */
function cellHtml(id, selection) {
  const creature = CREATURES[id],
    picked = selection.team.includes(id),
    matchup = creatureMatchup(id, selection.enemyTeam);
  return `<div class="ts-card"${selection.filterAffinity === 'all' || selection.filterAffinity === creature.affinity ? '' : ' hidden'}><button type="button" class="ts-cell${picked ? ' is-picked' : ''}" data-creature="${id}" data-matchup="${matchupDirection(matchup)}" aria-pressed="${picked}" aria-label="${escapeHtml(cellLabel(id, matchup))}"><img src="${sprite(id)}" alt="" width="64" height="64" decoding="async"><span class="ts-cell-name">${escapeHtml(creatureName(id))}</span>${typeDot(creature.affinity)}${matchupMark()}</button><button type="button" class="ts-cell-info" data-creature-info="${id}" aria-haspopup="dialog" aria-label="${escapeHtml(t('select.info', { name: creatureName(id) }))}">${icon('info')}</button></div>`;
}

function renderTeamSelect(mode = 'ladder') {
  disposeArena();
  ctx.battleSession = null;
  ctx.previousScreen = 'title';
  screen.dataset.page = 'selection';
  screen.className = 'screen';
  void ensureBattleStyles();
  if (!ctx.selection || ctx.selection.mode !== mode) ctx.selection = newSelection(mode);
  const selection = ctx.selection,
    // One-time "here is your team" hint after the tutorial (results.js sets it): "Bravo !" only
    // after a won tutorial, a plain welcome after a skip.
    guide = { tutorial: 'select.guide', skipped: 'select.guideSkipped' }[ctx.selectionGuide];
  ctx.selectionGuide = null;
  const filters = AFFINITY_ORDER.map(
    (id) =>
      `<button type="button" class="ts-filter type-dot" data-type="${id}" data-affinity-filter="${id}" aria-pressed="${selection.filterAffinity === id}" aria-label="${escapeHtml(affinityName(id))}"></button>`
  ).join('');
  const teams = `<button type="button" class="icon-btn ts-teams-btn" data-action="open-teams" aria-label="${escapeHtml(t('select.teams'))}">${icon('team')}<span aria-hidden="true">${escapeHtml(t('select.teams'))}</span></button>`,
    legend = `<p class="ts-legend">${matchupMark('up')}<span>${escapeHtml(t('select.legendUp'))}</span>${matchupMark('down')}<span>${escapeHtml(t('select.legendDown'))}</span></p>`;
  screen.innerHTML = `<div class="ts${guide ? ' has-guide' : ''}" data-mode="${mode}">${topbar(t('select.team'), { actions: teams })}${guide ? `<p class="ts-guide" role="status">${icon('sparkle')}<span>${escapeHtml(t(guide))}</span></p>` : ''}<section class="ts-rival" aria-labelledby="ts-rival-name">${rivalHtml(selection)}</section><div class="ts-slots" role="group" aria-label="${escapeHtml(t('select.team'))}">${slotsHtml(selection)}</div><div class="ts-filters" role="group" aria-label="${escapeHtml(t('filter.types'))}">${filters}</div><div class="ts-grid">${legend}${CREATURE_IDS.map((id) => cellHtml(id, selection)).join('')}</div><div class="ts-bar"><span class="ts-trio" role="img" aria-label="${escapeHtml(t('select.selected', { count: selection.team.length }))}">${trioHtml(selection)}</span><button type="button" class="primary-btn ts-fight" data-action="start-battle"${canStart(selection) ? '' : ' disabled'}>${escapeHtml(t('select.ready'))}</button></div><aside class="ts-detail" aria-labelledby="ts-detail-name"></aside></div>`;
  route.bindCommon();
  bindTeamSelect(selection);
}

const canStart = (selection) => selection.team.length === 3 && selection.enemyTeam.length === 3;

function bindTeamSelect(selection) {
  const root = screen.querySelector('.ts'),
    grid = root.querySelector('.ts-grid'),
    slots = root.querySelector('.ts-slots'),
    detail = root.querySelector('.ts-detail'),
    cells = new Map([...grid.querySelectorAll('.ts-cell')].map((cell) => [cell.dataset.creature, cell]));
  let guide = root.querySelector('.ts-guide');

  const setAttr = (element, name, value) => {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  };
  const firstCell = () => grid.querySelector('.ts-card:not([hidden]) .ts-cell');

  /* Tall desktop: the inspected creature's sheet sits inline under the bar. A
     hover, keyboard focus, a pick and the (i) button show a creature there;
     elsewhere nothing renders into the (hidden) panel. */
  let inspected = null;
  const inspect = (id, { focus = false } = {}) => {
    if (!INLINE_DETAIL.matches) return false;
    if (id !== inspected) {
      inspected = id;
      detail.innerHTML = creatureSheetHtml(id, {
        headingId: 'ts-detail-name',
        rivalTeam: selection.enemyTeam,
      });
      detail.scrollTop = 0;
    }
    if (focus) {
      const heading = detail.querySelector('#ts-detail-name');
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    return true;
  };
  const inspectLead = () => inspect(selection.team[selection.lead] || selection.team[0] || CREATURE_IDS[0]);
  const onLayoutChange = () => {
    if (!root.isConnected) INLINE_DETAIL.removeEventListener('change', onLayoutChange);
    else if (!inspectLead()) {
      inspected = null;
      detail.replaceChildren();
    }
  };
  INLINE_DETAIL.addEventListener('change', onLayoutChange);
  inspectLead();

  // Picks only patch what changed: the touched cells, the three slots and the bar.
  const SLOT_CONTROLS = {
    slotRemove: 'data-slot-remove',
    slotOpen: 'data-slot-open',
    leadIndex: 'data-lead-index',
  };
  const patchTeam = (fresh = -1) => {
    for (const [id, cell] of cells) {
      const picked = selection.team.includes(id);
      cell.classList.toggle('is-picked', picked);
      setAttr(cell, 'aria-pressed', String(picked));
    }
    // A slot control that had focus hands it to the same control of the new slots.
    const active = slots.contains(document.activeElement) ? document.activeElement.dataset : null,
      key = active && Object.keys(SLOT_CONTROLS).find((name) => active[name] !== undefined);
    slots.innerHTML = slotsHtml(selection, fresh);
    if (key) {
      const attr = SLOT_CONTROLS[key];
      (
        slots.querySelector(`[${attr}="${active[key]}"]`) ||
        [...slots.querySelectorAll(`[${attr}]`)].at(-1) ||
        firstCell()
      )?.focus({ preventScroll: true });
    }
    const trio = root.querySelector('.ts-trio');
    trio.innerHTML = trioHtml(selection);
    trio.setAttribute('aria-label', t('select.selected', { count: selection.team.length }));
    root.querySelector('.ts-fight').disabled = !canStart(selection);
    if (guide) {
      guide.remove();
      root.classList.remove('has-guide');
      guide = null;
    }
  };
  const patchMatchups = () => {
    for (const [id, cell] of cells) {
      const matchup = creatureMatchup(id, selection.enemyTeam);
      setAttr(cell, 'data-matchup', matchupDirection(matchup));
      setAttr(cell, 'aria-label', cellLabel(id, matchup));
    }
    if (inspected) {
      const id = inspected;
      inspected = null;
      inspect(id);
    }
  };
  const patchRival = () => {
    root.querySelector('.ts-rival').innerHTML = rivalHtml(selection);
    bindRival();
  };
  const patchFilter = () => {
    for (const button of root.querySelectorAll('[data-affinity-filter]'))
      setAttr(button, 'aria-pressed', String(selection.filterAffinity === button.dataset.affinityFilter));
    for (const [id, cell] of cells)
      cell.parentElement.hidden =
        selection.filterAffinity !== 'all' && CREATURES[id].affinity !== selection.filterAffinity;
  };
  const setTeam = (team, lead) => {
    selection.team = [...team];
    selection.lead = lead;
    selection.filterAffinity = 'all';
    patchFilter();
    patchTeam();
    sound.ui();
  };

  const removeAt = (index) => {
    selection.team.splice(index, 1);
    if (selection.lead === index) selection.lead = 0;
    else if (selection.lead > index) selection.lead--;
  };
  const removeSlot = (index) => {
    removeAt(index);
    patchTeam();
    sound.ui();
  };
  const bumpSlots = () => {
    slots.classList.remove('is-full');
    void slots.offsetWidth;
    slots.classList.add('is-full');
  };
  const togglePick = (id) => {
    const index = selection.team.indexOf(id);
    if (index >= 0) {
      removeSlot(index);
      inspect(id);
      return;
    }
    if (selection.team.length >= 3) {
      notify(t('select.full'));
      bumpSlots();
      return;
    }
    selection.team.push(id);
    patchTeam(selection.team.length - 1);
    inspect(id);
    cry(id);
  };
  const makeLead = (index) => {
    if (!selection.team[index] || selection.lead === index) return;
    selection.lead = index;
    patchTeam();
    sound.ui();
  };

  const openCreature = (id) => {
    const inTeam = selection.team.includes(id),
      index = selection.team.indexOf(id),
      full = selection.team.length >= 3;
    const actions = inTeam
      ? [
          {
            label: t('select.removeShort'),
            variant: 'subtle',
            action: 'sheet-remove',
            onSelect: () => togglePick(id),
          },
          ...(selection.lead === index
            ? []
            : [
                {
                  label: t('select.chooseLead'),
                  variant: 'subtle',
                  icon: 'crown',
                  action: 'sheet-lead',
                  onSelect: () => makeLead(index),
                },
              ]),
        ]
      : full
        ? []
        : [
            {
              label: t('select.add'),
              variant: 'primary',
              action: 'sheet-add',
              onSelect: () => togglePick(id),
            },
          ];
    openSheet({
      title: creatureName(id),
      body: creatureSheetHtml(id, {
        rivalTeam: selection.enemyTeam,
        extra:
          !inTeam && full ? `<p class="creature-sheet-note">${escapeHtml(t('select.fullNote'))}</p>` : '',
      }),
      actions,
    });
  };
  // The (i) button, long-press, right-click and the i key: the inline panel on
  // a tall desktop, the creature sheet everywhere else.
  const showInfo = (id) => {
    if (!inspect(id, { focus: true })) openCreature(id);
  };

  // A slot's body: a small sheet to send it in first, read its card or remove
  // it (a tap on a picked creature never drops it silently).
  const openSlot = (index) => {
    const id = selection.team[index],
      affinity = CREATURES[id].affinity,
      lead = selection.lead === index,
      // Gold only when the scout also suggests this creature as the lead.
      suggested = selection.team.length === 3 && bestLeadIndex(selection.team, selection.enemyTeam) === index;
    openSheet({
      title: creatureName(id),
      body: `<div class="slot-sheet" style="--type-color:${AFFINITIES[affinity].color}"><span class="slot-sheet-portrait"><img src="${sprite(id)}" alt="" width="64" height="64"></span><div class="creature-sheet-chips"><span class="sheet-chip">${typeDot(affinity)}${escapeHtml(affinityName(affinity))}</span>${lead ? `<span class="sheet-chip is-lead">${icon('crown')}${escapeHtml(t('select.lead'))}</span>` : suggested ? `<span class="sheet-chip is-suggested">${icon('crown')}${escapeHtml(t('select.suggested'))}</span>` : ''}${matchupChipHtml(creatureMatchup(id, selection.enemyTeam), 'span')}</div></div>`,
      actions: [
        ...(lead
          ? []
          : [
              {
                label: t('select.chooseLead'),
                variant: suggested ? 'primary' : 'subtle',
                icon: 'crown',
                action: 'slot-lead',
                onSelect: () => makeLead(index),
              },
            ]),
        {
          label: t('select.infoShort'),
          variant: 'subtle',
          icon: 'info',
          action: 'slot-info',
          onSelect: (close) => {
            close();
            showInfo(id);
          },
        },
        {
          label: t('select.removeShort'),
          variant: 'subtle',
          icon: 'close',
          action: 'slot-remove',
          onSelect: () => removeSlot(index),
        },
      ],
      // Lead and remove rebuild the slots, so focus goes to the new slot.
      onClose: () => {
        const active = document.activeElement;
        if (!root.isConnected || (active && active !== document.body && active.isConnected)) return;
        (
          slots.querySelector(`[data-slot-open="${index}"]`) ||
          slots.querySelector('[data-slot-open]') ||
          firstCell()
        )?.focus({ preventScroll: true });
      },
    });
  };

  // Long-press (touch or mouse), right-click and the i / context-menu keys open
  // a card's info; the click that ends a long-press is swallowed.
  let pressTimer = 0,
    pressStart = null,
    swallowClickUntil = 0;
  const cancelPress = () => {
    clearTimeout(pressTimer);
    pressTimer = 0;
  };
  const longPressTarget = (event) => event.target.closest?.('[data-creature]');
  const onLongPress = (target) => {
    swallowClickUntil = performance.now() + 700;
    showInfo(target.dataset.creature);
  };
  grid.addEventListener('pointerdown', (event) => {
    const target = longPressTarget(event);
    if (!target || event.button !== 0) return;
    pressStart = [event.clientX, event.clientY];
    cancelPress();
    pressTimer = setTimeout(() => {
      pressTimer = 0;
      onLongPress(target);
    }, LONG_PRESS_MS);
  });
  grid.addEventListener('pointermove', (event) => {
    if (pressTimer && Math.hypot(event.clientX - pressStart[0], event.clientY - pressStart[1]) > 10)
      cancelPress();
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) grid.addEventListener(type, cancelPress);
  grid.addEventListener('contextmenu', (event) => {
    const target = longPressTarget(event);
    if (!target) return;
    event.preventDefault();
    cancelPress();
    if (performance.now() >= swallowClickUntil) onLongPress(target);
  });
  grid.addEventListener('keydown', (event) => {
    const cell = event.target.closest('[data-creature]');
    if (
      !cell ||
      !(event.key === 'i' || event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))
    )
      return;
    event.preventDefault();
    showInfo(cell.dataset.creature);
  });
  // Tall desktop: keyboard focus (and the focus a tap gives) shows a card inline.
  grid.addEventListener('focusin', (event) => {
    const card = event.target.closest('.ts-card');
    if (card) inspect(card.firstElementChild.dataset.creature);
  });

  grid.addEventListener('click', (event) => {
    const info = event.target.closest('[data-creature-info]');
    if (info) {
      showInfo(info.dataset.creatureInfo);
      return;
    }
    const cell = event.target.closest('[data-creature]');
    if (!cell || performance.now() < swallowClickUntil) return;
    togglePick(cell.dataset.creature);
  });
  slots.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const { leadIndex, slotRemove, slotOpen } = button.dataset;
    if (leadIndex !== undefined) makeLead(Number(leadIndex));
    else if (slotRemove !== undefined) removeSlot(Number(slotRemove));
    else if (slotOpen !== undefined) openSlot(Number(slotOpen));
  });
  slots.addEventListener('animationend', () => slots.classList.remove('is-full'));
  root.querySelector('.ts-filters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-affinity-filter]');
    if (!button) return;
    const type = button.dataset.affinityFilter;
    selection.filterAffinity = selection.filterAffinity === type ? 'all' : type;
    patchFilter();
    grid.scrollTop = 0;
    sound.ui();
  });

  root.querySelector('[data-action="open-teams"]').addEventListener('click', () => openTeams());
  root
    .querySelector('[data-action="start-battle"]')
    .addEventListener('click', () => startSelectionBattle(selection));

  function bindRival() {
    root.querySelector('[data-action="open-rival"]')?.addEventListener('click', openRival);
    root.querySelector('[data-action="open-options"]')?.addEventListener('click', openOptions);
  }
  bindRival();

  function openRival() {
    const { mode } = selection,
      trainer = TRAINERS[selection.trainerIndex],
      trial = mode === 'trial' ? TRIALS.find((entry) => entry.id === selection.trialId) : null,
      row = (cls, title, text) =>
        `<div class="sheet-row ${cls}"><b>${escapeHtml(title)}</b><p>${escapeHtml(text)}</p></div>`;
    const team = selection.enemyTeam
      .map(
        (id) =>
          `<li style="--type-color:${AFFINITIES[CREATURES[id].affinity].color}"><img src="${sprite(id, 'normal')}" alt="" width="64" height="64"><span><b>${escapeHtml(creatureName(id))}</b><small>${typeDot(CREATURES[id].affinity)}${escapeHtml(`${affinityName(CREATURES[id].affinity)} · ${className(CREATURES[id].classId)}`)}</small></span></li>`
      )
      .join('');
    const body = `<div class="rival-sheet"><ul class="rival-sheet-team">${team}</ul>${
      ['ladder', 'circuit'].includes(mode)
        ? row(
            'rival-style',
            `${t('trainer.strategy')} · ${t(`style.${trainer.style}`)}`,
            t(`style.effect.${trainer.style}`)
          ) +
          row('rival-ace', `${t('ace.title')} · ${t(`ace.${trainer.ace}`)}`, t(`ace.effect.${trainer.ace}`))
        : ''
    }${
      mode === 'circuit'
        ? row(
            'rival-condition',
            `${t('circuit.condition')} · ${t(`circuit.${selection.circuitCondition}`)}`,
            t(`circuit.effect.${selection.circuitCondition}`)
          )
        : ''
    }${trial ? row('rival-trial', t(trial.nameKey), t(trial.descKey)) : ''}${
      mode === 'gauntlet'
        ? row('rival-gauntlet', t(GAUNTLET_STAGES[0].nameKey), t('gauntlet.persistence'))
        : ''
    }${row('rival-weather', `${t('arena.ruleTitle')} · ${t(`arena.${selection.arena}`)}`, weatherLine(selection.arena, selectionModifiers(selection)))}${row(
      'rival-difficulty',
      `${t('select.difficulty')} · ${t(`difficulty.${selection.difficulty}`)}`,
      t(`difficulty.effect.${selection.difficulty}`)
    )}</div>`;
    openSheet({ title: rivalName(selection), body });
  }

  // Combat libre options: design-system chips for difficulty, arena (with its
  // weather type) and rule, then the labelled rival picker.
  function openOptions() {
    const body = document.createElement('div');
    body.className = 'options-sheet';
    const chip = (attr, id, on, content) =>
      `<button type="button" class="subtle-btn ts-choice${on ? ' active' : ''}" ${attr}="${id}" aria-pressed="${on}">${content}</button>`;
    const difficulties = DIFFICULTIES.map((id) =>
        chip('data-difficulty', id, selection.difficulty === id, escapeHtml(t(`difficulty.${id}`)))
      ).join(''),
      arenas = ARENAS.map((id) => {
        const boosted = weatherRows(id, []).find((row) => row.up);
        return chip(
          'data-arena-pick',
          id,
          selection.arena === id,
          `${boosted ? typeDot(boosted.affinity) : '<i class="ts-choice-calm" aria-hidden="true"></i>'}<span>${escapeHtml(t(`arena.${id}`))}</span>`
        );
      }).join(''),
      rules = QUICK_RULES.map((rule) =>
        chip(
          'data-rule-pick',
          rule.id,
          selection.quickRule === rule.id,
          `<span>${escapeHtml(t(`quickRule.${rule.id}`))}</span>`
        )
      ).join(''),
      foes = CREATURE_IDS.map((id) => {
        const affinity = CREATURES[id].affinity,
          on = selection.enemyTeam.includes(id);
        return `<button type="button" class="enemy-pick${on ? ' active' : ''}" data-enemy-pick="${id}" aria-pressed="${on}" aria-label="${escapeHtml(`${creatureName(id)}, ${affinityName(affinity)}`)}"><img src="${sprite(id, 'normal')}" alt="" width="64" height="64" loading="lazy">${typeDot(affinity)}<b class="enemy-pick-name">${escapeHtml(creatureName(id))}</b></button>`;
      }).join('');
    body.innerHTML = `<fieldset class="sheet-field"><legend>${escapeHtml(t('select.difficulty'))}</legend><div class="ts-segmented">${difficulties}</div><p class="sheet-hint ts-difficulty-note">${escapeHtml(t(`difficulty.effect.${selection.difficulty}`))}</p></fieldset><fieldset class="sheet-field"><legend>${escapeHtml(t('select.arena'))}</legend><div class="ts-choices">${arenas}</div><p class="sheet-hint ts-weather-note">${escapeHtml(weatherLine(selection.arena, selectionModifiers(selection)))}</p></fieldset><fieldset class="sheet-field"><legend>${escapeHtml(t('quickRule.title'))}</legend><div class="ts-choices">${rules}</div><p class="sheet-hint ts-rule-note">${escapeHtml(t(`quickRule.effect.${selection.quickRule}`))}</p></fieldset><fieldset class="sheet-field"><legend>${escapeHtml(t('select.enemy'))}</legend><button type="button" class="subtle-btn sheet-wide" data-action="random-enemy">${icon('refresh')}<span>${escapeHtml(t('app.random'))}</span></button><div class="enemy-picker">${foes}</div></fieldset>`;
    const press = (button, on) => {
      button.classList.toggle('active', on);
      setAttr(button, 'aria-pressed', String(on));
    };
    const patchOptions = () => {
      const current = {
        'data-difficulty': selection.difficulty,
        'data-arena-pick': selection.arena,
        'data-rule-pick': selection.quickRule,
      };
      for (const [attr, value] of Object.entries(current))
        for (const button of body.querySelectorAll(`[${attr}]`))
          press(button, button.getAttribute(attr) === value);
      for (const button of body.querySelectorAll('[data-enemy-pick]'))
        press(button, selection.enemyTeam.includes(button.dataset.enemyPick));
      body.querySelector('.ts-difficulty-note').textContent = t(`difficulty.effect.${selection.difficulty}`);
      body.querySelector('.ts-weather-note').textContent = weatherLine(
        selection.arena,
        selectionModifiers(selection)
      );
      body.querySelector('.ts-rule-note').textContent = t(`quickRule.effect.${selection.quickRule}`);
    };
    const enemyChanged = () => {
      patchOptions();
      patchRival();
      patchMatchups();
      patchTeam();
    };
    body.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      const { difficulty, arenaPick, rulePick, enemyPick, action } = button.dataset;
      if (difficulty) selection.difficulty = difficulty;
      else if (arenaPick) selection.arena = arenaPick;
      else if (rulePick) selection.quickRule = rulePick;
      else if (enemyPick) {
        const index = selection.enemyTeam.indexOf(enemyPick);
        if (index >= 0) selection.enemyTeam.splice(index, 1);
        else if (selection.enemyTeam.length < 3) selection.enemyTeam.push(enemyPick);
        else {
          notify(t('select.full'));
          return;
        }
      } else if (action === 'random-enemy')
        selection.enemyTeam = randomDistinct(3, selection.enemyTeam.join('').length + Date.now());
      else return;
      sound.ui();
      if (enemyPick || action) enemyChanged();
      else {
        patchOptions();
        patchRival();
      }
    });
    openSheet({ title: t('select.plan'), body });
  }

  function openTeams() {
    const body = document.createElement('div');
    body.className = 'teams-sheet';
    const customHtml = (slot) => {
      const squad = ctx.save.customSquads?.[slot];
      const trio = squad
        ? squad.team
            .map(
              (id, index) =>
                `<img class="${index === squad.lead ? 'is-lead' : ''}" src="${sprite(id)}" alt="${escapeHtml(creatureName(id))}" width="64" height="64">`
            )
            .join('')
        : `<small>${escapeHtml(t('loadout.empty'))}</small>`;
      const actions = squad
        ? `<button type="button" class="subtle-btn" data-custom-load="${slot}">${escapeHtml(t('loadout.load'))}</button><button type="button" class="subtle-btn" data-custom-save="${slot}">${escapeHtml(t('loadout.replace'))}</button><button type="button" class="icon-btn" data-custom-clear="${slot}" aria-label="${escapeHtml(t('loadout.clear'))}">${icon('close')}</button>`
        : `<button type="button" class="subtle-btn" data-custom-save="${slot}"${selection.team.length === 3 ? '' : ' disabled'}>${escapeHtml(t('loadout.save'))}</button>`;
      return `<article class="custom-squad${squad ? ' is-filled' : ''}" data-custom-slot="${slot}"><b>${escapeHtml(t('loadout.slot', { slot: slot + 1 }))}</b><span class="team-trio">${trio}</span><div class="custom-squad-actions">${actions}</div></article>`;
    };
    const presetHtml = (preset) => {
      const active = preset.team.every((id, index) => selection.team[index] === id);
      return `<button type="button" class="team-row" data-squad="${preset.id}" aria-pressed="${active}"><span class="team-trio">${preset.team.map((id, index) => `<img class="${index === preset.lead ? 'is-lead' : ''}" src="${sprite(id)}" alt="" width="64" height="64" loading="lazy">`).join('')}</span><span class="team-row-text"><b>${escapeHtml(t(`squad.${preset.id}`))}</b><small>${escapeHtml(t(`squad.effect.${preset.id}`))}</small></span></button>`;
    };
    body.innerHTML = `<section class="teams-section"><h3>${escapeHtml(t('loadout.title'))}</h3><p class="sheet-hint">${escapeHtml(t('loadout.hint'))}</p>${[0, 1, 2].map(customHtml).join('')}</section><section class="teams-section"><div class="teams-section-head"><h3>${escapeHtml(t('squad.title'))}</h3><button type="button" class="subtle-btn" data-action="remix-team">${icon('refresh')}<span>${escapeHtml(t('squad.remix'))}</span></button></div>${SQUAD_PRESETS.map(presetHtml).join('')}</section>`;
    const patchCustom = (slot, focusSelector) => {
      body.querySelector(`[data-custom-slot="${slot}"]`).outerHTML = customHtml(slot);
      body.querySelector(focusSelector)?.focus({ preventScroll: true });
    };
    const writeSquads = (slot, squad) => {
      ctx.save.customSquads = Array.from({ length: 3 }, (_, index) =>
        index === slot ? squad : ctx.save.customSquads?.[index] || null
      );
      persist();
    };
    let close = null;
    body.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      const { squad: presetId, customLoad, customSave, customClear, action } = button.dataset;
      if (presetId) {
        const preset = SQUAD_PRESETS.find((entry) => entry.id === presetId);
        setTeam(preset.team, preset.lead);
        close();
      } else if (customLoad !== undefined) {
        const squad = ctx.save.customSquads?.[Number(customLoad)];
        if (!squad) return;
        setTeam(squad.team, squad.lead);
        close();
      } else if (customSave !== undefined) {
        if (selection.team.length !== 3) return;
        const slot = Number(customSave);
        writeSquads(slot, { team: [...selection.team], lead: selection.lead });
        notify(t('loadout.saved'));
        patchCustom(slot, `[data-custom-save="${slot}"]`);
      } else if (customClear !== undefined) {
        const slot = Number(customClear);
        writeSquads(slot, null);
        patchCustom(slot, `[data-custom-save="${slot}"]`);
      } else if (action === 'remix-team') {
        const before = selection.team.join(','),
          seed = Date.now();
        let remix = remixTeam(selection.enemyTeam, seed),
          attempt = 1;
        while (remix.team.join(',') === before && attempt < 8)
          remix = remixTeam(selection.enemyTeam, seed + attempt++);
        setTeam(remix.team, remix.lead);
        notify(t('squad.remixed'));
        close();
      }
    });
    close = openSheet({ title: t('select.teams'), body });
  }
}

function rivalName(selection) {
  const trial = selection.mode === 'trial' ? TRIALS.find((entry) => entry.id === selection.trialId) : null;
  return ['ladder', 'circuit'].includes(selection.mode)
    ? t(TRAINERS[selection.trainerIndex].nameKey)
    : selection.mode === 'gauntlet'
      ? t(GAUNTLET_STAGES[0].nameKey)
      : trial
        ? t(trial.nameKey)
        : t('select.opponent');
}

/* The one start path for a prepared selection (team select's Combattre ! and
   the title's JOUER). The lead is stored first in lastTeam, so the next
   newSelection() (lead 0) opens with the same lead. */
function startSelectionBattle(selection = ctx.selection) {
  const { mode, team, lead } = selection;
  ctx.save.lastTeam = [team[lead], ...team.filter((_, index) => index !== lead)];
  if (mode === 'quick') ctx.save.difficulty = selection.difficulty;
  persist();
  if (mode === 'gauntlet') {
    startGauntlet(team, lead);
    return;
  }
  startBattle({
    playerTeam: team,
    enemyTeam: selection.enemyTeam,
    playerLead: lead,
    enemyLead: selection.enemyLead || 0,
    mode,
    arena: selection.arena,
    difficulty: selection.difficulty,
    trainerIndex: selection.trainerIndex,
    quickRuleId: mode === 'quick' ? selection.quickRule : null,
    circuitCondition: selection.circuitCondition,
    trialId: selection.trialId,
    modifiers: selectionModifiers(selection),
  });
}

registerRoutes({
  newSelection,
  creatureMatchup,
  matchupMark,
  creatureSheetHtml,
  weatherRows,
  renderTeamSelect,
  startSelectionBattle,
});
