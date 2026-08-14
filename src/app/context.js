import {
  AFFINITIES,
  AFFINITY_ORDER,
  AFFINITY_TRIANGLES,
  affinityMultiplier,
} from '../data/affinities.js';
import { CREATURES, CREATURE_IDS } from '../data/creatures.js';
import { MOVES } from '../data/moves.js';
import { PASSIVES } from '../data/passives.js';
import {
  FEATS,
  CURRENT_FEAT_IDS,
  PERFORMANCE_GRADES,
  battleAchievementSignals,
  masteryProgress,
  masteryRank,
  performanceGrade,
} from '../data/progression.js';
import { SQUAD_PRESETS } from '../data/squads.js';
import { QUICK_RULES, quickRule } from '../data/battle-rules.js';
import { battleAdviceKeys } from '../data/advice.js';
import { teamComboRoutes } from '../data/combos.js';
import { TRAINERS, ARENAS } from '../data/trainers.js';
import { TRIALS } from '../data/trials.js';
import { GAUNTLET_BOONS, GAUNTLET_STAGES } from '../data/gauntlet.js';
import { createDraft, dailyDraftSeed } from '../data/draft.js';
import { circuitMatch } from '../data/circuit.js';
import { PROFILE_AXES, bestLeadIndex, remixTeam, teamProfile } from '../data/team-profile.js';
import {
  createBattle,
  activeOf,
  resolveTurn,
  applyReplacement,
  applyTrainerCommand,
  canUseTrainerCommand,
  getLegalActions,
  SIGNATURE_COST,
  signatureCostFor,
  previewMove,
  previewMoveOrder,
  previewIncomingAfterSwitch,
} from '../battle/engine.js';
import { chooseAiAction } from '../battle/ai.js';
import { normalizeSeed, randomIndex } from '../battle/rng.js';
import { effectiveSpeed, STATUS_DEFINITIONS } from '../battle/statuses.js';
import { createI18n, validateDictionaries } from '../i18n.js';
import { DEFAULT_SAVE, SAVE_KEY, loadSave, persistSave } from '../save.js';
import { ArenaScene } from '../presentation/arena.js';
import { SoundSystem } from '../sound.js';

if (!validateDictionaries()) throw new Error('Localization dictionaries are incomplete');

const params = new URLSearchParams(location.search);
const testAnimationScale = params.get('animations') === '0' ? 0 : 1;
const loaded = loadSave();
const initialSave = loaded.save;
const urlLang = params.get('lang');
if (urlLang === 'en' || urlLang === 'fr') initialSave.language = urlLang;
const i18n = createI18n(initialSave.language);
const { t } = i18n;
const screen = document.querySelector('#screen');
const toast = document.querySelector('#toast');
const LADDER_COUNT = TRAINERS.length;
const LOG_EVENT_TYPES = new Set([
  'move-start',
  'trainer-command',
  'perfect-relay',
  'damage',
  'heal',
  'status',
  'barrier',
  'barrier-hit',
  'miss',
  'recoil',
  'status-tick',
  'arena-pulse',
  'ace',
  'passive',
  'switch',
  'replace',
  'ko',
]);
const LOG_TYPE_GROUPS = {
  'move-start': 'move',
  'trainer-command': 'talent',
  'perfect-relay': 'switch',
  damage: 'damage',
  combo: 'combo',
  recoil: 'damage',
  'status-tick': 'damage',
  heal: 'recovery',
  status: 'effect',
  barrier: 'defense',
  'barrier-hit': 'defense',
  miss: 'dodge',
  'arena-pulse': 'arena',
  ace: 'ace',
  passive: 'talent',
  switch: 'switch',
  replace: 'switch',
  ko: 'ko',
};

export const ctx = {
  save: initialSave,
  previousScreen: 'title',
  selection: null,
  battleSession: null,
  arenaScene: null,
  toastTimer: null,
  locked: false,
  currentFxMove: null,
  pendingRewards: null,
  gauntletRun: null,
  draftRun: null,
  theaterTimers: [],
  gamepadButtons: [],
  gamepadAxisLatch: false,
  gamepadLoop: 0,
  routes: {},
};

const sprite = (id) => `./assets/monsters/${id}/battle.png`;
const creatureName = (id) => t(`creature.${id}`);
const affinity = (id) => AFFINITIES[CREATURES[id].affinity];
const affinityName = (id) => t(AFFINITIES[id].nameKey);
const actionButton = (label, action, cls = 'subtle-btn', extra = '') =>
  `<button type="button" class="${cls}" data-action="${action}" ${extra}>${label}</button>`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function notify(message) {
  clearTimeout(ctx.toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  ctx.toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

const sound = new SoundSystem(ctx.save, () => notify(t('error.audio')));
sound.setScreen('title');
const unlockSound = () => void sound.unlock();
document.addEventListener('pointerdown', unlockSound, { capture: true });
document.addEventListener('keydown', unlockSound, { capture: true });
document.addEventListener('visibilitychange', () => sound.handleVisibility(document.hidden));

function persist() {
  ctx.save.language = i18n.lang;
  persistSave(ctx.save);
  sound.update(ctx.save);
  document.body.classList.toggle('reduced-motion', ctx.save.reducedMotion);
  document.body.classList.toggle('high-contrast', ctx.save.highContrast);
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>'"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]
  );
}

function affinityIcon(id, { title = '', className = '' } = {}) {
  const meta = AFFINITIES[id];
  if (!meta) throw new Error(`Unknown affinity icon: ${id}`);
  const accessible = Boolean(title),
    titleMarkup = accessible ? `<title>${escapeHtml(title)}</title>` : '',
    strokeMarkup = meta.iconStrokePath
      ? `<path class="affinity-icon-stroke" d="${meta.iconStrokePath}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`
      : '';
  return `<svg class="affinity-icon${className ? ` ${escapeHtml(className)}` : ''}" viewBox="0 0 24 24" focusable="false" ${accessible ? `role="img" aria-label="${escapeHtml(title)}"` : 'aria-hidden="true"'}>${titleMarkup}<path d="${meta.iconPath}" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"/>${strokeMarkup}</svg>`;
}

function disposeArena() {
  ctx.arenaScene?.dispose();
  ctx.arenaScene = null;
}

function emblemHtml(index, earned = false) {
  const trainer = TRAINERS[index],
    label = t(trainer.badgeNameKey);
  return `<span class="emblem ornate ${earned ? 'earned' : ''}" style="--badge-a:${trainer.colors[0]};--badge-b:${trainer.colors[1]}" title="${earned ? label : '???'}"><i></i><b>${earned ? trainer.badge : '·'}</b><small>${earned ? label : ''}</small></span>`;
}

function statusVisuals(creature) {
  const entries = Object.keys(creature.statuses).map((id) => {
    const meta = STATUS_DEFINITIONS[id];
    return `<i class="status-orb status-${id}" style="--status-color:${meta.color}" title="${t(`status.${id}`)}"><b>${meta.icon}</b></i>`;
  });
  if (creature.barrier > 0)
    entries.unshift(
      `<i class="status-orb status-barrier" style="--status-color:#73eaff" title="${t('battle.barrier', { amount: creature.barrier })}"><b>⬡</b></i>`
    );
  return entries.join('');
}

function comboRoutesHtml(ids, compact = false) {
  const routes = teamComboRoutes(ids).slice(0, compact ? 2 : 4);
  if (!routes.length) return compact ? '' : `<div class="combo-routes empty">${t('combo.none')}</div>`;
  return `<div class="combo-routes ${compact ? 'compact' : ''}">${routes.map((route) => `<div class="combo-route"><span><img src="${sprite(route.setterId)}" alt=""><small>${creatureName(route.setterId)}</small><b>${t(`move.${route.setupMoveId}`)}</b></span><i>⌖ → COMBO<br><small>+40%</small></i><span><img src="${sprite(route.finisherId)}" alt=""><small>${creatureName(route.finisherId)}</small><b>${route.signature ? '✦ ' : ''}${t(`move.${route.finishMoveId}`)}</b></span></div>`).join('')}</div>`;
}

function draftInsightHtml(candidateId) {
  const before = [...(ctx.draftRun?.team || [])],
    after = [...before, candidateId],
    routeKey = (routeItem) =>
      `${routeItem.setterId}:${routeItem.setupMoveId}:${routeItem.finisherId}:${routeItem.finishMoveId}`,
    oldRoutes = new Set(teamComboRoutes(before).map(routeKey)),
    newRoutes = teamComboRoutes(after).filter((routeItem) => !oldRoutes.has(routeKey(routeItem))),
    newAffinity = !before.some((id) => CREATURES[id].affinity === CREATURES[candidateId].affinity);
  const tags = [
    ...(newRoutes.length ? [`↗ ${t('draft.newRoutes', { count: newRoutes.length })}`] : []),
    ...(newAffinity && before.length
      ? [
          `${affinityIcon(CREATURES[candidateId].affinity)} ${t('draft.newAffinity', { affinity: affinityName(CREATURES[candidateId].affinity) })}`,
        ]
      : []),
  ];
  return `<div class="draft-insight"><b>${t('draft.insight')}</b>${tags.length ? tags.map((tag) => `<span>${tag}</span>`).join('') : `<small>${t('draft.flexPick')}</small>`}</div>`;
}

function topbar(backAction = 'title') {
  return `<header class="topbar"><button type="button" class="subtle-btn" data-action="${backAction}">← ${t('app.back')}</button><div class="brand-small">✦ ${t('app.title')}</div><div class="icon-actions"><button class="icon-btn" data-action="toggle-mute" aria-label="${t('settings.mute')}" aria-pressed="${ctx.save.muted}">${ctx.save.muted ? '🔇' : '🔊'}</button><button class="icon-btn" data-action="settings" aria-label="${t('app.settings')}">⚙</button></div></header>`;
}

Object.assign(ctx, {
  AFFINITIES,
  AFFINITY_ORDER,
  AFFINITY_TRIANGLES,
  affinityMultiplier,
  CREATURES,
  CREATURE_IDS,
  MOVES,
  PASSIVES,
  FEATS,
  CURRENT_FEAT_IDS,
  PERFORMANCE_GRADES,
  masteryProgress,
  masteryRank,
  performanceGrade,
  battleAchievementSignals,
  SQUAD_PRESETS,
  QUICK_RULES,
  quickRule,
  battleAdviceKeys,
  teamComboRoutes,
  TRAINERS,
  ARENAS,
  TRIALS,
  GAUNTLET_BOONS,
  GAUNTLET_STAGES,
  createDraft,
  dailyDraftSeed,
  circuitMatch,
  PROFILE_AXES,
  bestLeadIndex,
  remixTeam,
  teamProfile,
  createBattle,
  activeOf,
  resolveTurn,
  applyReplacement,
  applyTrainerCommand,
  canUseTrainerCommand,
  getLegalActions,
  SIGNATURE_COST,
  signatureCostFor,
  previewMove,
  previewMoveOrder,
  previewIncomingAfterSwitch,
  chooseAiAction,
  normalizeSeed,
  randomIndex,
  effectiveSpeed,
  STATUS_DEFINITIONS,
  DEFAULT_SAVE,
  SAVE_KEY,
  persistSave,
  ArenaScene,
  params,
  testAnimationScale,
  loaded,
  i18n,
  t,
  screen,
  toast,
  sound,
  LADDER_COUNT,
  LOG_EVENT_TYPES,
  LOG_TYPE_GROUPS,
  sprite,
  creatureName,
  affinity,
  affinityName,
  actionButton,
  wait,
  persist,
  notify,
  escapeHtml,
  affinityIcon,
  disposeArena,
  emblemHtml,
  statusVisuals,
  comboRoutesHtml,
  draftInsightHtml,
  topbar,
});

export const route = new Proxy(
  {},
  {
    get(_target, property) {
      return function (...args) {
        const handler = ctx.routes[property];
        if (!handler) throw new Error(`Route is not registered: ${String(property)}`);
        return Reflect.apply(handler, this, args);
      };
    },
  }
);

export function registerRoutes(routes) {
  Object.assign(ctx.routes, routes);
}

document.body.classList.toggle('reduced-motion', ctx.save.reducedMotion);
document.body.classList.toggle('high-contrast', ctx.save.highContrast);
persistSave(ctx.save);
