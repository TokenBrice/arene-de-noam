import { ctx, registerRoutes, route } from '../app/context.js';

const {
  TRAINERS,
  AFFINITIES,
  ARENA_WEATHER,
  t,
  screen,
  sound,
  LADDER_COUNT,
  sprite,
  creatureName,
  affinityIcon,
  affinityName,
  escapeHtml,
  disposeArena,
  topbar,
  mainAffinity,
  badgeArt,
} = ctx;
const { bindCommon, icon, newSelection, renderTeamSelect, startSelectionBattle } = route;

// The rival shown in the card. It follows the current rival until the player
// picks another node, and snaps back when the League advances.
let selectedRival = null;
let selectedForProgress = null;

// A League duel against rival `index`, with the saved team (lead first).
function leagueSelection(index) {
  const trainer = TRAINERS[index],
    selection = newSelection('ladder');
  selection.trainerIndex = index;
  selection.enemyTeam = [...trainer.team];
  selection.arena = trainer.arena;
  selection.difficulty = trainer.difficulty;
  return selection;
}

function rivalState(index, progress) {
  if (index < progress || progress >= LADDER_COUNT) return 'cleared';
  return index === progress ? 'current' : 'locked';
}

// Arena name plus its weather as type chips ("+20 %" / "−20 %"), or calm.
// Shared by the League, Trials and Expédition cards.
function arenaWeatherHtml(arena) {
  const effects = Object.entries(ARENA_WEATHER[arena]).sort(([, a], [, b]) => b - a);
  const chips = effects.length
    ? effects
        .map(([affinity, multiplier]) => {
          const up = multiplier > 1,
            percent = Math.round(Math.abs(multiplier - 1) * 100),
            label = t(up ? 'battle.weatherUp' : 'battle.weatherDown', {
              type: affinityName(affinity),
              percent,
            }),
            value = t('battle.weatherTag', { value: `${up ? '+' : '−'}${percent}` });
          return `<span class="weather-chip ${up ? 'up' : 'down'}" style="--chip-color:${AFFINITIES[affinity].color}"><span class="visually-hidden">${escapeHtml(label)}</span>${affinityIcon(affinity)}<b class="num" aria-hidden="true">${value}</b></span>`;
        })
        .join('')
    : `<span class="weather-chip calm">${t('arena.calm')}</span>`;
  return `<span class="league-fact weather-fact"><span class="league-fact-label">${icon('mountain')}${t(`arena.${arena}`)}</span><span class="weather-chips">${chips}</span></span>`;
}

// Each node is the rival's badge: won, open (the next duel) or still locked.
const NODE_BADGE = Object.freeze({ cleared: 'earned', current: 'open', locked: 'locked' });
function nodeHtml(trainer, index, state, selected) {
  const label =
      state === 'locked'
        ? t('league.nodeLabelLocked', { number: index + 1 })
        : t('league.nodeLabel', {
            number: index + 1,
            name: t(trainer.nameKey),
            status: t(`league.${state}`),
          }),
    mark =
      state === 'cleared'
        ? `<i class="league-node-check">${icon('check')}</i>`
        : state === 'locked'
          ? `<i class="league-node-lock">${icon('lock')}</i>`
          : '';
  return `<li><button type="button" class="league-node ${state}${selected ? ' selected' : ''}" data-league-node="${index}" aria-pressed="${selected}" aria-label="${escapeHtml(label)}"><span class="league-node-badge">${badgeArt(index, NODE_BADGE[state])}${mark}</span><b class="num">${index + 1}</b></button></li>`;
}

function cardHtml(index, progress) {
  const trainer = TRAINERS[index],
    state = rivalState(index, progress),
    colors = `--rival-a:${trainer.colors[0]};--rival-b:${trainer.colors[1]}`,
    head = `<header class="league-card-head"><span class="eyebrow">${t(`league.${state}`)} · ${t('league.rivalNumber', { number: index + 1, total: LADDER_COUNT })}</span><h2>${state === 'locked' ? '???' : t(trainer.nameKey)}</h2></header>`;
  if (state === 'locked') {
    const silhouettes = trainer.team
      .map(() => `<span class="league-silhouette">${icon('lock')}</span>`)
      .join('');
    return `<section class="league-card locked" style="${colors}">${head}<div class="league-card-team" aria-hidden="true">${silhouettes}</div><p class="league-locked-hint">${t('league.lockedHint')}</p></section>`;
  }
  const type = mainAffinity(trainer.team),
    team = trainer.team
      .map(
        (id, slot) =>
          `<figure class="${slot === 0 ? 'lead' : ''}"><img src="${sprite(id, 'normal')}" alt="" width="128" height="128"><figcaption>${creatureName(id)}</figcaption></figure>`
      )
      .join(''),
    typeFact = `<span class="league-fact type-fact" style="--chip-color:${AFFINITIES[type].color}"><span class="league-fact-label">${affinityIcon(type)}${affinityName(type)}</span><small>${t('league.mainType')}</small></span>`,
    ace = `<p class="league-ace">${icon('crown')}<span><b>${t(`ace.${trainer.ace}`)}</b><span>${t(`ace.effect.${trainer.ace}`)}</span></span></p>`,
    // Like JOUER: the gold button fights with the saved team; team select is the second way in.
    cta = `<button type="button" class="primary-btn wide" data-action="league-fight">${state === 'cleared' ? t('league.replay') : t('league.fight')}</button><button type="button" class="subtle-btn wide" data-action="league-team">${icon('team')}<span>${t('league.changeTeam')}</span></button>`;
  return `<section class="league-card ${state}" style="${colors};--type-color:${AFFINITIES[type].color}">${head}<div class="league-card-team">${team}</div><div class="league-facts">${typeFact}${arenaWeatherHtml(trainer.arena)}</div>${ace}${cta}</section>`;
}

function bindCard(index) {
  screen.querySelector('[data-action="league-fight"]')?.addEventListener('click', () => {
    ctx.selection = leagueSelection(index);
    startSelectionBattle(ctx.selection);
  });
  screen.querySelector('[data-action="league-team"]')?.addEventListener('click', () => {
    ctx.selection = leagueSelection(index);
    renderTeamSelect('ladder');
  });
}

// Picking a node patches the card in place: focus and the route's scroll stay.
function selectRival(index) {
  if (index === selectedRival) return;
  selectedRival = index;
  sound.ui();
  screen.querySelectorAll('[data-league-node]').forEach((node) => {
    const selected = Number(node.dataset.leagueNode) === index;
    node.classList.toggle('selected', selected);
    node.setAttribute('aria-pressed', String(selected));
  });
  screen.querySelector('.league-card').outerHTML = cardHtml(index, ctx.save.ladderVictories);
  bindCard(index);
}

function renderLeague() {
  disposeArena();
  ctx.battleSession = null;
  ctx.selection = null;
  screen.dataset.page = 'league';
  screen.className = 'screen';
  const progress = ctx.save.ladderVictories,
    badges = Math.min(progress, LADDER_COUNT);
  if (selectedRival === null || selectedForProgress !== progress) {
    selectedRival = Math.min(progress, LADDER_COUNT - 1);
    selectedForProgress = progress;
  }
  const nodes = TRAINERS.map((trainer, index) =>
    nodeHtml(trainer, index, rivalState(index, progress), index === selectedRival)
  ).join('');
  screen.innerHTML = `<div class="shell league-page">${topbar(t('league.title'), { eyebrow: t('league.badges', { count: badges, total: LADDER_COUNT }) })}<nav class="league-route" aria-label="${t('league.route')}"><ol style="--cleared:${badges}">${nodes}</ol></nav><div aria-live="polite">${cardHtml(selectedRival, progress)}</div></div>`;
  bindCommon();
  const strip = screen.querySelector('.league-route'),
    selected = strip.querySelector('.league-node.selected');
  strip.scrollLeft = selected.offsetLeft - (strip.clientWidth - selected.offsetWidth) / 2;
  strip.addEventListener('click', (event) => {
    const node = event.target.closest('[data-league-node]');
    if (node) selectRival(Number(node.dataset.leagueNode));
  });
  bindCard(selectedRival);
}

registerRoutes({ arenaWeatherHtml, renderLeague });
