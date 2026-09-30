import {
  AFFINITIES,
  AFFINITY_ORDER,
  AFFINITY_TRIANGLES,
  ARENA_WEATHER,
  affinityMultiplier,
} from '../data/affinities.js';
import { CREATURES, CREATURE_IDS } from '../data/creatures.js';
import { CLASSES, CLASS_IDS, CLASS_ORDER, classIcon } from '../data/classes.js';
import { MOVES } from '../data/moves.js';
import { PASSIVES } from '../data/passives.js';
import {
  FEATS,
  CURRENT_FEAT_IDS,
  PERFORMANCE_GRADES,
  CHROMATIQUE_RANK,
  battleAchievementSignals,
  chromatiqueUnlocked,
  isChromatiqueShown,
  masteryProgress,
  masteryRank,
  performanceGrade,
  unlockedModes,
} from '../data/progression.js';
import { SQUAD_PRESETS } from '../data/squads.js';
import { QUICK_RULES, difficultyModifiers, quickRule } from '../data/battle-rules.js';
import { battleAdviceKeys } from '../data/advice.js';
import { TRAINERS, ARENAS, mainAffinity } from '../data/trainers.js';
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
  previewAllySwitch,
} from '../battle/engine.js';
import { chooseAiAction } from '../battle/ai.js';
import { normalizeSeed, randomIndex } from '../battle/rng.js';
import {
  effectiveSpeed,
  STATUS_DEFINITIONS,
  STATUS_DISPLAY_ORDER,
  sortStatusIds,
  statusBadgeHtml,
  statusIcon,
} from '../battle/statuses.js';
import { createI18n, validateDictionaries } from '../i18n.js';
import { DEFAULT_SAVE, SAVE_KEY, freshDefaultSave, loadSave, persistSave } from '../save.js';
import { SoundSystem } from '../sound.js';
import { BATTLE_STYLESHEETS } from './battle-stylesheets.js';

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
  'move-skip',
  'trainer-command',
  'perfect-relay',
  'damage',
  'heal',
  'status',
  'barrier',
  'barrier-hit',
  'barrier-break',
  'miss',
  'recoil',
  'status-tick',
  'ace',
  'passive',
  'switch',
  'replace',
  'ko',
  'battle-end',
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
  'barrier-break': 'defense',
  miss: 'dodge',
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
  battleStylesReady: null,
  toastTimer: null,
  saveFailureNotified: false,
  locked: false,
  currentFxMove: null,
  pendingRewards: null,
  gauntletRun: null,
  draftRun: null,
  leaveGuard: null,
  selectionGuide: null,
  routes: {},
};

// The single creature-image helper: DOM screens and the WebGL fighter show the same file, the
// baked Chromatique (`battle-shiny.png`) when the save shows it. The Chromatique is the player's
// own: rivals always pass 'normal'.
const spriteVariant = (id) => (isChromatiqueShown(id, ctx.save) ? 'chromatique' : 'normal');
const sprite = (id, variant = spriteVariant(id)) =>
  `./assets/monsters/${id}/${variant === 'chromatique' ? 'battle-shiny' : 'battle'}.png`;
const creatureName = (id) => t(`creature.${id}`);
const affinity = (id) => AFFINITIES[CREATURES[id].affinity];
const affinityName = (id) => t(AFFINITIES[id].nameKey);
const className = (id) => t(`class.${id}`);
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
  const ok = persistSave(ctx.save);
  if (!ok && !ctx.saveFailureNotified) {
    ctx.saveFailureNotified = true;
    notify(t('app.saveFailed'));
  }
  sound.update(ctx.save);
  syncPreferenceClasses();
  return ok;
}

// Chromatique display preference (save v18); unknown creature ids are ignored. Every creature
// image comes from sprite(id), so swapping this creature's images refreshes whatever currently
// shows it (screen and open sheets) without losing scroll, filters or an open sheet. Images
// pinned to one look (`data-variant`, e.g. a before/after reveal) are left alone. Returns
// whether the preference is now on.
function setChromatique(id, shown) {
  if (!CREATURE_IDS.includes(id)) return false;
  const chromatiques = { ...ctx.save.chromatiques };
  if (shown) chromatiques[id] = true;
  else delete chromatiques[id];
  ctx.save.chromatiques = chromatiques;
  persist();
  const url = sprite(id);
  for (const img of document.querySelectorAll(`img[src*="/monsters/${id}/"]:not([data-variant])`))
    if (img.getAttribute('src') !== url) img.src = url;
  return Boolean(chromatiques[id]);
}

function syncPreferenceClasses() {
  const { reducedMotion, highContrast } = ctx.save;
  document.documentElement.classList.toggle('reduced-motion', reducedMotion);
  document.documentElement.classList.toggle('high-contrast', highContrast);
  document.body.classList.toggle('reduced-motion', reducedMotion);
  document.body.classList.toggle('high-contrast', highContrast);
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

/* Source path → deployed file. tools/build.mjs defines __ASSET_MAP__ (a JSON
   string, which esbuild inlines instead of splitting it into a shared chunk)
   for the bundled dist/ build; in development the sources are served as-is,
   so the map is the identity. */
const ASSET_MAP = typeof __ASSET_MAP__ === 'string' ? JSON.parse(__ASSET_MAP__) : {};
const assetUrl = (path) => ASSET_MAP[path] ?? path;

/* Battle-only stylesheets are promoted to real stylesheets before the first
   battle or move theater is shown, each inserted before its anchor so the
   cascade order matches eager loading. In dist several sheets share one file;
   it is inserted once. */
function ensureBattleStyles() {
  if (!ctx.battleStylesReady) {
    const inserted = new Set();
    ctx.battleStylesReady = Promise.all(
      BATTLE_STYLESHEETS.map(([sheet, anchor]) => {
        const href = assetUrl(sheet);
        if (inserted.has(href)) return null;
        inserted.add(href);
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        const before = anchor
          ? document.head.querySelector(`link[rel="stylesheet"][href="${assetUrl(anchor)}"]`)
          : null;
        document.head.insertBefore(link, before);
        return new Promise((resolve) => {
          link.onload = resolve;
          link.onerror = resolve;
        });
      })
    );
  }
  return ctx.battleStylesReady;
}

/* Three.js and the arena form a lazy chunk: the title never waits on them.
   main.js prefetches it once the title is idle; renderBattle awaits it. A
   failed load stays failed for this page (browsers keep failed module loads),
   so renderBattle asks for a reload. */
let arenaModule = null;
function loadArena() {
  arenaModule ??= import('../presentation/arena.js');
  return arenaModule;
}

function disposeArena() {
  ctx.arenaScene?.dispose();
  ctx.arenaScene = null;
}

/* League badge art, one design for the hub strip, the League map, the results badge moment
   and the recap: a pointy-top hex with a gold rim, a gem in the rival's main type colour and
   the rival's own motif (TRAINERS[i].badge, a stroke path on the 24-unit grid). States:
   'earned' (won), 'open' (revealed, not won yet: dark face, motif in the type colour) and
   'locked' (bare dark hex). Colours live in components.css (.badge-art). */
const BADGE_RIM = '20,1 38.2,11.5 38.2,32.5 20,43 1.8,32.5 1.8,11.5',
  BADGE_FACE = '20,5.5 34.3,13.75 34.3,30.25 20,38.5 5.7,30.25 5.7,13.75',
  BADGE_CROWN = '5.7,13.75 20,5.5 34.3,13.75 20,22',
  BADGE_BASE = '5.7,30.25 20,38.5 34.3,30.25 20,22';
function badgeArt(index, state = 'earned', { label = '' } = {}) {
  const trainer = TRAINERS[index],
    gem = AFFINITIES[mainAffinity(trainer.team)].color,
    facets =
      state === 'earned'
        ? `<polygon class="badge-crown" points="${BADGE_CROWN}"/><polygon class="badge-base" points="${BADGE_BASE}"/>`
        : '',
    motif =
      state === 'locked'
        ? ''
        : `<g class="badge-motif" transform="translate(9.2 11.2) scale(.9)"><path class="badge-motif-shade" d="${trainer.badge}"/><path d="${trainer.badge}"/></g>`;
  return `<svg class="badge-art badge-art--${state}" viewBox="0 0 40 44" style="--gem:${gem}" focusable="false" ${label ? `role="img" aria-label="${escapeHtml(label)}"` : 'aria-hidden="true"'}><polygon class="badge-rim" points="${BADGE_RIM}"/><polygon class="badge-face" points="${BADGE_FACE}"/>${facets}${motif}</svg>`;
}

function draftInsightHtml(candidateId) {
  const before = [...(ctx.draftRun?.team || [])],
    newAffinity = !before.some((id) => CREATURES[id].affinity === CREATURES[candidateId].affinity);
  const tags =
    newAffinity && before.length
      ? [
          `${affinityIcon(CREATURES[candidateId].affinity)} ${t('draft.newAffinity', { affinity: affinityName(CREATURES[candidateId].affinity) })}`,
        ]
      : [];
  return `<div class="draft-insight"><b>${t('draft.insight')}</b>${tags.length ? tags.map((tag) => `<span>${tag}</span>`).join('') : `<small>${t('draft.flexPick')}</small>`}</div>`;
}

// Mute and settings, the chrome every screen but a battle carries (hub and topbar).
function chromeActions({ settings = true } = {}) {
  const { icon } = route;
  return `<button type="button" class="icon-btn" data-action="toggle-mute" aria-label="${t('settings.mute')}" aria-pressed="${ctx.save.muted}">${icon(ctx.save.muted ? 'sound-off' : 'sound-on')}</button>${settings ? `<button type="button" class="icon-btn" data-action="settings" aria-label="${t('app.settings')}">${icon('settings')}</button>` : ''}`;
}

/* The one page header of every screen but the hub and battle: a 48 px chevron back
   (`data-action="back"`: shell.js goes up a level, or asks the leave guard first), the page's
   h1 with an optional eyebrow line, the screen's own `actions` (HTML of .icon-btn or compact
   .subtle-btn buttons), then mute and settings (`settings: false` on Réglages itself).
   `title` and `eyebrow` are plain text. */
function topbar(title, { eyebrow = '', actions = '', settings = true } = {}) {
  const { icon } = route;
  return `<header class="topbar"><button type="button" class="icon-btn topbar-back" data-action="back" aria-label="${escapeHtml(t('app.back'))}">${icon('chevron-left')}</button><div class="topbar-title">${eyebrow ? `<span class="eyebrow">${escapeHtml(eyebrow)}</span>` : ''}<h1>${escapeHtml(title)}</h1></div><div class="icon-actions">${actions}${chromeActions({ settings })}</div></header>`;
}

/* Leave guard: a screen holding progress that one tap could drop (an Expédition run between
   stages) sets { message, detail?, confirm, cancel, onLeave? } (strings already translated).
   While it is set on the showing page, shell.js turns back (gesture, Escape, [data-action=
   "back"]) and home ([data-action="title"]) into a confirm sheet; confirming clears it, runs
   onLeave, then leaves. Showing another page clears it. */
function setLeaveGuard(guard) {
  ctx.leaveGuard = guard ? { ...guard, page: screen.dataset.page } : null;
}

Object.assign(ctx, {
  AFFINITIES,
  AFFINITY_ORDER,
  AFFINITY_TRIANGLES,
  ARENA_WEATHER,
  affinityMultiplier,
  CREATURES,
  CREATURE_IDS,
  CLASSES,
  CLASS_IDS,
  CLASS_ORDER,
  classIcon,
  className,
  MOVES,
  PASSIVES,
  FEATS,
  CURRENT_FEAT_IDS,
  PERFORMANCE_GRADES,
  masteryProgress,
  masteryRank,
  performanceGrade,
  battleAchievementSignals,
  CHROMATIQUE_RANK,
  chromatiqueUnlocked,
  isChromatiqueShown,
  unlockedModes,
  SQUAD_PRESETS,
  QUICK_RULES,
  quickRule,
  difficultyModifiers,
  battleAdviceKeys,
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
  previewAllySwitch,
  chooseAiAction,
  normalizeSeed,
  randomIndex,
  effectiveSpeed,
  STATUS_DEFINITIONS,
  STATUS_DISPLAY_ORDER,
  sortStatusIds,
  statusBadgeHtml,
  statusIcon,
  DEFAULT_SAVE,
  freshDefaultSave,
  SAVE_KEY,
  persistSave,
  loadArena,
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
  spriteVariant,
  creatureName,
  affinity,
  affinityName,
  actionButton,
  wait,
  persist,
  setChromatique,
  notify,
  escapeHtml,
  affinityIcon,
  disposeArena,
  ensureBattleStyles,
  mainAffinity,
  badgeArt,
  draftInsightHtml,
  chromeActions,
  topbar,
  setLeaveGuard,
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

syncPreferenceClasses();
persistSave(ctx.save);
