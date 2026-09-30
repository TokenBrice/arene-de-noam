import { ctx, registerRoutes, route, wrapRoutes } from './context.js';
import { icon, installIconSprite } from './icons.js';

const { t, screen, sound, persist, escapeHtml, testAnimationScale } = ctx;
const {
  renderTitle,
  renderAcademy,
  renderLeague,
  renderTeamSelect,
  renderDraft,
  renderGauntletBoons,
  renderTrials,
  refreshBattle,
  renderResults,
  closeMoveTheater,
  renderBestiary,
  renderSettings,
  openBattlePause,
} = route;

installIconSprite();

function currentMusicScreen() {
  if (ctx.battleSession && screen.classList.contains('battle-screen'))
    return `battle:${ctx.battleSession.arena}`;
  if (screen.dataset.page === 'results')
    return ctx.battleSession?.state.winner === 'player' ? 'victory' : 'defeat';
  return screen.dataset.page || 'title';
}

// Shared chrome wiring after every render: music, and the topbar/home buttons
// every screen shares. Screen-specific DOM belongs to the owning screen.
function bindCommon() {
  sound.setScreen(currentMusicScreen());
  screen
    .querySelectorAll('[data-action="title"]')
    .forEach((b) => b.addEventListener('click', () => guardedLeave(renderTitle)));
  screen
    .querySelectorAll('[data-action="back"]')
    .forEach((b) => b.addEventListener('click', () => navigateUp()));
  screen.querySelectorAll('[data-action="settings"]').forEach((b) =>
    b.addEventListener('click', () => {
      ctx.settingsReturn = screen.dataset.page || 'title';
      renderSettings();
    })
  );
  screen.querySelectorAll('[data-action="toggle-mute"]').forEach((b) =>
    b.addEventListener('click', () => {
      ctx.save.muted = !ctx.save.muted;
      persist();
      sound.ui();
      renderCurrent();
    })
  );
}

// Every page that can be re-rendered from app state alone (battle pages
// cannot: they belong to their session).
const PAGE_RENDERERS = {
  title: () => renderTitle(),
  selection: () => renderTeamSelect(ctx.selection?.mode),
  league: () => renderLeague(),
  academy: () => renderAcademy(),
  bestiary: () => renderBestiary(),
  trials: () => renderTrials(),
  draft: () => renderDraft(),
  'gauntlet-boon': () => renderGauntletBoons(),
  results: () => renderResults(ctx.battleSession?.state.winner === 'player'),
  settings: () => renderSettings(),
};

function renderCurrent() {
  sound.setScreen(currentMusicScreen());
  if (ctx.battleSession && screen.classList.contains('battle-screen')) refreshBattle();
  else (PAGE_RENDERERS[screen.dataset.page] ?? renderSettings)();
}

/* Route transitions (View Transitions API, UI-14). Forward (deeper in the hub trail, see
   pageDepth) pushes the new screen in from the right, back reverses it. A creature marked
   `data-shared-creature="<id>"` on both screens (the title's trio, team select's slots) travels
   from its old place to its new one; on one screen only, it moves with the page. Only transform
   and opacity animate, on the compositor, for TRANSITION_MS (styles/base.css). One semantic DOM
   tree exists throughout: the old screen is only a snapshot.

   The render runs in the transition's update callback, one frame later: the route call returns
   a promise that resolves once the new screen is in the DOM, and a caller that touches the new
   screen right away awaits it. Instant swap (render now, its result returned) for same-page
   re-renders, the boot screen, anything into or out of a battle (it has its own intro and
   outro), reduced motion, ?animations=0, a browser without the API, and a back gesture the
   browser already animates. Every quality tier, Low included, gets them: at 6x CPU they add no
   long task and only a few ms of main-thread work per frame while they play (measurements in
   docs/architecture.md, "Route transitions"). */
const SCREEN_TRANSITION_PAGES = {
  renderTitle: 'title',
  renderAcademy: 'academy',
  renderLeague: 'league',
  renderTeamSelect: 'selection',
  renderDraft: 'draft',
  renderGauntletBoons: 'gauntlet-boon',
  renderTrials: 'trials',
  renderBestiary: 'bestiary',
  renderSettings: 'settings',
  renderBattle: 'battle',
};
const INSTANT_PAGES = new Set(['boot', 'battle-loading', 'battle']);
const TRANSITION_MS = 240;
const root = document.documentElement;
let activeTransition = null;
// The page a pending transition is about to show, for history sync before its render runs.
let pendingPage = null;
// Set while popstate handles a back gesture the browser animated itself.
let browserAnimatesBack = false;

function animatesTransitions(from, to) {
  return (
    typeof document.startViewTransition === 'function' &&
    testAnimationScale !== 0 &&
    !ctx.save.reducedMotion &&
    !reducedMotionQuery.matches &&
    !browserAnimatesBack &&
    !INSTANT_PAGES.has(from) &&
    !INSTANT_PAGES.has(to)
  );
}

// A hub the player came through sits at its trail index, Settings one level above the screen
// that opened them, any other screen one level above the current hub.
function pageDepth(page) {
  const hub = hubTrail.indexOf(page);
  if (hub >= 0) return hub;
  if (page === 'settings') return pageDepth(ctx.settingsReturn) + 1;
  return hubTrail.length;
}

// The shared creatures in view, one element per creature id, with their viewport boxes.
function sharedCreatures() {
  const view = screen.getBoundingClientRect(),
    found = new Map();
  for (const element of screen.querySelectorAll('[data-shared-creature]')) {
    const id = element.dataset.sharedCreature,
      box = element.getBoundingClientRect();
    if (found.has(id) || !box.width || box.bottom <= view.top || box.top >= view.bottom) continue;
    found.set(id, { element, box });
  }
  return found;
}

function settleNewPage() {
  screen.scrollTo(0, 0);
  const heading = screen.querySelector('h1');
  heading?.setAttribute('tabindex', '-1');
  heading?.focus({ preventScroll: true });
}

function transitionScreen(render, targetPage) {
  const from = screen.dataset.page,
    pageChanged = Boolean(from) && targetPage !== from;
  if (!pageChanged || !animatesTransitions(from, targetPage)) {
    const result = render();
    if (pageChanged) settleNewPage();
    return result;
  }
  const before = sharedCreatures(),
    travels = [];
  for (const [id, shared] of before) {
    shared.element.style.viewTransitionName = `creature-${id}`;
    shared.transform = getComputedStyle(shared.element).transform;
  }
  root.dataset.navigation = pageDepth(targetPage) < pageDepth(from) ? 'back' : 'forward';
  pendingPage = targetPage;
  const transition = document.startViewTransition(() => {
    pendingPage = null;
    render();
    settleNewPage();
    for (const [id, { element }] of sharedCreatures()) {
      if (!before.has(id)) continue;
      element.style.viewTransitionName = `creature-${id}`;
      travels.push({ name: `creature-${id}`, ...before.get(id) });
    }
  });
  activeTransition = transition;
  // A shared creature's group moves by transform alone, from its old box to the place the
  // browser gave it: the group is sized like the new element and transformed about its centre,
  // so the first frame centres it on the old box, scaled, with the old element's own transform
  // (the title's flipped hero turns around on the way).
  transition.ready.then(
    () => {
      for (const { name, box, transform } of travels) {
        const pseudoElement = `::view-transition-group(${name})`,
          group = getComputedStyle(root, pseudoElement),
          width = parseFloat(group.width),
          height = parseFloat(group.height),
          x = box.left + (box.width - width) / 2,
          y = box.top + (box.height - height) / 2,
          own = transform === 'none' ? '' : transform;
        root.animate(
          {
            transform: [
              `translate(${x}px, ${y}px) scale(${box.width / width}, ${box.height / height}) ${own}`,
              group.transform,
            ],
          },
          { duration: TRANSITION_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', pseudoElement }
        );
      }
    },
    () => {}
  );
  const finish = () => {
    if (activeTransition !== transition) return;
    activeTransition = null;
    delete root.dataset.navigation;
    for (const element of screen.querySelectorAll('[data-shared-creature]'))
      element.style.viewTransitionName = '';
  };
  transition.finished.then(finish, finish);
  return transition.updateCallbackDone;
}
export function rerenderPreservingFocus(render) {
  const active = document.activeElement;
  const key = active?.dataset?.focusKey ?? null;
  render();
  if (key) ctx.screen.querySelector(`[data-focus-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}
export function installScreenTransitions() {
  wrapRoutes((name, render) => {
    const page = SCREEN_TRANSITION_PAGES[name];
    return page ? (...args) => transitionScreen(() => render(...args), page) : render;
  });
}

/* Bottom sheet: the one overlay primitive for switch, replacement, move info,
   pause, team picks and recaps. It mounts inside `root` (the screen by
   default, so a screen re-render removes it; battle overlays pass
   #replacement-root and call the controller's arena-pause sync after opening
   and in onClose), traps Tab via trapModalTab, closes on Escape, a tap on the
   opaque scrim or its close button, and gives focus back to whatever opened
   it.

   title       plain text heading (or pass labelledBy for a heading in body)
   body        HTML string or a DOM node the caller has already wired
   actions     [{ label, variant: 'primary' | 'subtle' | 'danger', icon,
                 action, onSelect(close), keepOpen }]; a pick closes the sheet
                 unless keepOpen; `action` becomes data-action for selectors
   onClose     called once, after the sheet has left `root`, with
               'escape' | 'scrim' | 'close' | 'action' | 'api'
   Returns close(). */
const openSheets = [];
const SHEET_ACTION_CLASSES = { primary: 'primary-btn', subtle: 'subtle-btn', danger: 'danger-btn' };
const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
let sheetCount = 0;

function topSheet() {
  while (openSheets.length && !openSheets.at(-1).layer.isConnected) openSheets.pop();
  return openSheets.at(-1) ?? null;
}
function openSheet({ title = '', body = '', actions = [], onClose, labelledBy = '', root = screen } = {}) {
  if (!title && !labelledBy) throw new Error('openSheet needs a title or labelledBy');
  const id = `sheet-${++sheetCount}`,
    opener = document.activeElement !== document.body ? document.activeElement : null,
    instant = testAnimationScale === 0 || ctx.save.reducedMotion || reducedMotionQuery.matches,
    layer = document.createElement('div');
  layer.className = `sheet-layer${instant ? ' sheet-instant' : ''}`;
  layer.innerHTML = `<div class="sheet-scrim" aria-hidden="true"></div><section class="sheet" role="dialog" aria-modal="true" aria-labelledby="${escapeHtml(labelledBy || `${id}-title`)}" tabindex="-1"><div class="sheet-grab" aria-hidden="true"></div><header class="sheet-head">${title ? `<h2 class="sheet-title" id="${id}-title">${escapeHtml(title)}</h2>` : ''}<button type="button" class="icon-btn sheet-close" aria-label="${escapeHtml(t('app.close'))}">${icon('close')}</button></header><div class="sheet-body"></div>${actions.length ? '<div class="sheet-actions"></div>' : ''}</section>`;
  const sheet = layer.querySelector('.sheet'),
    content = layer.querySelector('.sheet-body');
  if (typeof body === 'string') content.innerHTML = body;
  else if (body) content.append(body);
  let closed = false;
  const dismiss = (reason) => {
    if (closed) return;
    closed = true;
    const index = openSheets.indexOf(entry);
    if (index >= 0) openSheets.splice(index, 1);
    // Out of the modal set and out of `root` at once, so focus trap, battle
    // shortcuts and the caller's onClose (e.g. the arena pause, computed from
    // #replacement-root) already see it gone; the exit plays from <body>.
    layer.inert = true;
    sheet.removeAttribute('aria-modal');
    if (instant || !layer.isConnected) layer.remove();
    else {
      const finish = () => {
        clearTimeout(fallback);
        layer.remove();
      };
      const fallback = setTimeout(finish, 600);
      sheet.addEventListener('animationend', (event) => event.target === sheet && finish());
      layer.classList.add('is-closing');
      document.body.append(layer);
    }
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    onClose?.(reason);
    syncHistory();
  };
  const entry = { layer, dismiss };
  const actionRow = layer.querySelector('.sheet-actions');
  for (const { label, variant = 'subtle', icon: iconName, action, onSelect, keepOpen = false } of actions) {
    const className = SHEET_ACTION_CLASSES[variant];
    if (!className) throw new Error(`Unknown sheet action variant: ${variant}`);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    if (action) button.dataset.action = action;
    button.innerHTML = `${iconName ? icon(iconName) : ''}<span>${escapeHtml(label)}</span>`;
    button.addEventListener('click', () => {
      onSelect?.(() => dismiss('action'));
      if (!keepOpen) dismiss('action');
    });
    actionRow.append(button);
  }
  layer.querySelector('.sheet-scrim').addEventListener('click', () => dismiss('scrim'));
  layer.querySelector('.sheet-close').addEventListener('click', () => dismiss('close'));
  openSheets.push(entry);
  root.append(layer);
  sheet.focus({ preventScroll: true });
  syncHistory();
  return () => dismiss('api');
}

/* Navigation. The Android back gesture, the browser's back button and Escape
   share goBack(): it closes the Move Theater or the top sheet first; in battle
   it opens the pause sheet; elsewhere it goes one level up (navigateUp, also
   behind every [data-action="back"] button).

   One level up is the nearest hub the player came through (title, League,
   Trials, Academy): team select opened from the League returns to the League,
   the Bestiary opened from the Academy returns to the Academy, results return
   to the hub their battle started from. Settings return to the screen that
   opened them. While the page holds a leave guard (ctx.setLeaveGuard, e.g. an
   Expédition run between stages), going up or home asks in a sheet first.

   History: whenever a screen other than the title shows (or a sheet is open on
   the title), one "inside" entry sits above the entry the app booted on, so a
   back gesture pops it instead of leaving the app; goBack() then runs and the
   entry is re-armed. Returning to the bare title in-app pops the entry again,
   so back on the title leaves the app as usual. Keeping a single entry means
   the browser history never drifts from the screen and forward navigation
   can never replay a battle. */
const HUB_PAGES = ['title', 'league', 'trials', 'academy'];
const INSIDE_KEY = 'areneInside';
let hubTrail = ['title'];
let rewinding = false;

const onInsideEntry = () => history.state?.[INSIDE_KEY] === true;

function syncHistory() {
  const page = pendingPage ?? screen.dataset.page;
  if (!page || page === 'boot') return;
  const inside = page !== 'title' || topSheet() !== null;
  if (inside && !onInsideEntry()) history.pushState({ [INSIDE_KEY]: true }, '');
  else if (!inside && onInsideEntry() && !rewinding) {
    rewinding = true;
    history.back();
  }
}

function recordPage(page) {
  if (!HUB_PAGES.includes(page)) return;
  const index = hubTrail.indexOf(page);
  hubTrail = index >= 0 ? hubTrail.slice(0, index + 1) : [...hubTrail, page];
}

// Asks the page's leave guard (ctx.setLeaveGuard) first, if one is set; otherwise leaves.
function guardedLeave(leave) {
  const guard = ctx.leaveGuard;
  if (!guard || guard.page !== screen.dataset.page) {
    leave();
    return;
  }
  openSheet({
    title: guard.message,
    body: guard.detail ? `<p class="leave-detail">${escapeHtml(guard.detail)}</p>` : '',
    actions: [
      { label: guard.cancel, variant: 'subtle', action: 'leave-cancel' },
      {
        label: guard.confirm,
        variant: 'danger',
        action: 'leave-confirm',
        onSelect: () => {
          ctx.leaveGuard = null;
          guard.onLeave?.();
          leave();
        },
      },
    ],
  });
}

function navigateUp() {
  const page = screen.dataset.page;
  if (page === 'settings') {
    (PAGE_RENDERERS[ctx.settingsReturn] ?? renderTitle)();
    return;
  }
  const index = hubTrail.indexOf(page),
    target = index >= 0 ? hubTrail[index - 1] : hubTrail.at(-1);
  if (target) guardedLeave(PAGE_RENDERERS[target]);
}

function goBack() {
  if (screen.querySelector('.move-theater')) {
    closeMoveTheater();
    return;
  }
  const sheet = topSheet();
  if (sheet) {
    sheet.dismiss('escape');
    return;
  }
  const page = screen.dataset.page;
  if (page === 'battle') {
    // A running battle pauses; a battle that failed to start (error card) leaves.
    if (ctx.battleSession && !ctx.battleSession.cancelled) openBattlePause();
    else renderTitle();
    return;
  }
  if (page === 'battle-loading') return;
  navigateUp();
}

function installHistoryNavigation() {
  history.scrollRestoration = 'manual';
  // A reload keeps the old entry's state; start from a plain entry so the
  // title does not try to pop into the previous document.
  if (onInsideEntry()) history.replaceState(null, '');
  new MutationObserver(() => {
    recordPage(screen.dataset.page);
    if (ctx.leaveGuard && ctx.leaveGuard.page !== screen.dataset.page) ctx.leaveGuard = null;
    syncHistory();
  }).observe(screen, { attributes: true, attributeFilter: ['data-page'] });
  addEventListener('popstate', (event) => {
    if (rewinding) rewinding = false;
    else {
      // A back swipe the browser already animated gets no second, in-page transition.
      browserAnimatesBack = event.hasUAVisualTransition === true;
      goBack();
      browserAnimatesBack = false;
    }
    syncHistory();
  });
}
installHistoryNavigation();

function trapModalTab(event) {
  const dialog =
    screen.querySelector('.move-theater') ??
    topSheet()?.layer.querySelector('.sheet') ??
    screen.querySelector('[role="dialog"][aria-modal="true"]');
  if (!dialog || event.key !== 'Tab') return false;
  const items = [
    ...dialog.querySelectorAll(
      'button:not(:disabled),select:not(:disabled),input:not(:disabled),[tabindex="0"]'
    ),
  ].filter((item) => item.getBoundingClientRect().width > 0);
  if (!items.length) {
    event.preventDefault();
    dialog.focus();
    return true;
  }
  const first = items[0],
    last = items.at(-1),
    active = document.activeElement;
  if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
    event.preventDefault();
    first.focus();
  }
  return true;
}
registerRoutes({
  bindCommon,
  renderCurrent,
  goBack,
  navigateUp,
  trapModalTab,
  rerenderPreservingFocus,
  openSheet,
  icon,
});
