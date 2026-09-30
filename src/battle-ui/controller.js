import { ctx, registerRoutes, route } from '../app/context.js';

const {
  MOVES,
  difficultyModifiers,
  TRAINERS,
  createBattle,
  activeOf,
  resolveTurn,
  applyReplacement,
  applyTrainerCommand,
  canUseTrainerCommand,
  getLegalActions,
  chooseAiAction,
  params,
  testAnimationScale,
  t,
  screen,
  sound,
  sprite,
  creatureName,
  actionButton,
  persist,
  escapeHtml,
  disposeArena,
  ensureBattleStyles,
} = ctx;
const {
  bindCommon,
  renderTitle,
  openSheet,
  icon,
  plannedEnemyAction,
  tutorialAllows,
  plateHtml,
  topRowHtml,
  patchHud,
  patchTopRow,
  openNarration,
  narrate,
  renderCommands,
  moveInfoHtml,
  switchSheetHtml,
  plateDetailHtml,
  weatherSheetHtml,
  pauseSheetHtml,
  codexHtml,
  battleLogHtml,
  resetHud,
  prepareTutorial,
  advanceTutorial,
  tutorialAfterTurn,
  clearBattleFx,
  playEvents,
  playIntro,
  beginPresentation,
  completeTutorial,
  finishBattle,
} = route;

let battleSessionSequence = 0,
  battleStartPending = false,
  // The command the player last activated from a focused dock button; focus
  // returns to it when the dock is rebuilt after the turn.
  commandFocusKey = null,
  wakeLock = null;

function sessionIsActive(session) {
  return Boolean(
    session &&
    ctx.battleSession === session &&
    !session.cancelled &&
    screen.classList.contains('battle-screen')
  );
}
function cancelBattleSession(session) {
  if (session) {
    session.cancelled = true;
    session.displayState = null;
  }
  ctx.locked = false;
  releaseWakeLock();
  clearBattleFx();
}

/* Screen Wake Lock: the phone stays awake while a battle is on screen. The
   browser drops the lock when the page is hidden; it is asked again on return
   and released when the battle ends or is left. */
async function requestWakeLock() {
  if (wakeLock || document.hidden || !navigator.wakeLock || !sessionIsActive(ctx.battleSession)) return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (!sessionIsActive(ctx.battleSession)) {
      void lock.release();
      return;
    }
    wakeLock = lock;
    lock.addEventListener('release', () => {
      if (wakeLock === lock) wakeLock = null;
    });
  } catch {
    // Refused (power saver, permissions policy): the battle simply runs without it.
    wakeLock = null;
  }
}
function releaseWakeLock() {
  const lock = wakeLock;
  wakeLock = null;
  if (lock) void lock.release();
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void requestWakeLock();
});

// Every covering battle sheet lives in #replacement-root: while one is open the
// arena stops rendering and the turn's clock is held, so a sheet opened
// mid-turn freezes the turn exactly (§11.5).
function syncArenaPause() {
  const covered = screen.querySelector('#replacement-root')?.childElementCount > 0;
  ctx.arenaScene?.setPaused(covered);
  ctx.battleSession?.clock?.[covered ? 'pause' : 'resume']('sheet');
}
function openBattleSheet({ title, body, actions = [], variant, onClose }) {
  const root = screen.querySelector('#replacement-root');
  if (!root) return null;
  const content =
    typeof body === 'string' ? Object.assign(document.createElement('div'), { innerHTML: body }) : body;
  const close = openSheet({
    title,
    body: content,
    actions,
    root,
    onClose: (reason) => {
      syncArenaPause();
      onClose?.(reason);
    },
  });
  root.lastElementChild.classList.add('battle-sheet', `battle-sheet-${variant}`);
  syncArenaPause();
  return close;
}

// Only the player's own creatures show their Chromatique; the rival's copy of a
// creature always keeps its normal look.
const fighterVariant = (side, id) => (side === 'player' ? ctx.spriteVariant(id) : 'normal');

// Visually hidden stand-ins for the WebGL fighters: names for assistive tech and
// e2e hooks (docs/battle-presentation.md §8.3). FighterLayer writes data-phase.
function fighterProxyHtml(side, creature) {
  return `<div class="fighter-proxy visually-hidden ${side}" id="fighter-${side}" data-creature="${creature.id}" data-affinity="${creature.affinity}" data-phase="idle"><img src="${sprite(creature.id, fighterVariant(side, creature.id))}" alt="${escapeHtml(creatureName(creature.id))}" width="128" height="128"></div>`;
}
// Idempotent sync of both fighters to `view` (§8.4): the proxy is written at the
// swap, then the scene places the sprite. A K.O.'d active creature is shown
// fainted without animation; outside playback a living one is shown at rest.
async function patchFighters(view) {
  if (!screen.classList.contains('battle-screen')) return;
  const fighters = ctx.arenaScene?.fighters;
  await Promise.all(
    ['player', 'enemy'].map(async (side) => {
      const creature = activeOf(view, side),
        variant = fighterVariant(side, creature.id),
        proxy = screen.querySelector(`#fighter-${side}`),
        img = proxy?.querySelector('img');
      if (!img) return;
      if (proxy.dataset.creature !== creature.id) {
        proxy.dataset.creature = creature.id;
        proxy.dataset.affinity = creature.affinity;
        img.src = sprite(creature.id, variant);
      }
      img.alt = creatureName(creature.id);
      if (!fighters || !(await fighters.setCreature(side, creature.id, { variant }))) return;
      const phase = fighters.phase(side);
      if (creature.hp <= 0) {
        if (phase !== 'fainted') await fighters.react(side, 'faint', { instant: true });
      } else if (!ctx.locked && phase !== 'idle') await fighters.react(side, 'enter', { instant: true });
    })
  );
}

function startBattle(config) {
  if (battleStartPending) return;
  battleStartPending = true;
  ctx.previousScreen = 'selection';
  const seed = Number(params.get('seed')) || Math.floor(Date.now() / 1000);
  const state = createBattle({
    playerTeam: config.playerTeam,
    enemyTeam: config.enemyTeam,
    playerLead: config.playerLead,
    enemyLead: config.enemyLead,
    seed,
    mode: config.mode,
    arena: config.arena,
    modifiers: [...(config.modifiers || []), ...difficultyModifiers(config.difficulty)],
    enemyAce: ['ladder', 'gauntlet', 'circuit'].includes(config.mode)
      ? TRAINERS[config.trainerIndex]?.ace
      : null,
  });
  if (config.mode === 'tutorial') prepareTutorial(state);
  if (config.playerCondition)
    state.sides.player.team.forEach((creature) => {
      const ratio = config.playerCondition[creature.id];
      if (Number.isFinite(ratio))
        creature.hp = Math.max(1, Math.min(creature.maxHp, Math.round(creature.maxHp * ratio)));
    });
  const testHp = Number(params.get('playerHp'));
  if (Number.isFinite(testHp) && testHp > 0)
    activeOf(state, 'player').hp = Math.min(activeOf(state, 'player').maxHp, Math.round(testHp));
  const testEnemyHp = Number(params.get('enemyHp'));
  if (Number.isFinite(testEnemyHp) && testEnemyHp > 0)
    state.sides.enemy.team.forEach((creature) => {
      creature.hp = Math.min(creature.maxHp, Math.round(testEnemyHp));
    });
  const testTeamHp = Number(params.get('teamHp'));
  if (Number.isFinite(testTeamHp) && testTeamHp > 0)
    state.sides.player.team.forEach((creature) => {
      creature.hp = Math.min(creature.maxHp, Math.round(testTeamHp));
    });
  ctx.battleSession = {
    ...config,
    state,
    style: ['ladder', 'gauntlet', 'circuit'].includes(config.mode)
      ? TRAINERS[config.trainerIndex]?.style || 'direct'
      : 'direct',
    lastLine: '',
    timeline: [],
    tutorialStep: config.tutorialStep ?? null,
    sessionToken: ++battleSessionSequence,
    cancelled: false,
    displayState: null,
    fxTimers: new Set(),
  };
  void route.renderBattle(ctx.battleSession, screen.dataset.page);
}

async function renderBattle(session = ctx.battleSession, originPage = null) {
  if (
    !session ||
    ctx.battleSession !== session ||
    session.cancelled ||
    (originPage && screen.dataset.page !== originPage)
  ) {
    battleStartPending = false;
    return;
  }
  // Style promotion and the arena chunk are normally ready after the prefetch,
  // but replace the still-interactive selection DOM while they settle. This
  // avoids duplicate starts and stale headings/live regions leaking into the
  // battle. A failed arena load takes the friendly WebGL error path.
  screen.dataset.page = 'battle-loading';
  screen.className = 'screen boot-screen';
  screen.innerHTML = `<div class="brand-glyph" aria-hidden="true">${icon('sparkle')}</div>`;
  const [, arena] = await Promise.all([
    ensureBattleStyles(),
    ctx.loadArena().catch((error) => {
      console.error(error);
      return null;
    }),
  ]);
  if (ctx.battleSession !== session || session.cancelled || screen.dataset.page !== 'battle-loading') {
    if (ctx.battleSession === session) {
      cancelBattleSession(session);
      ctx.battleSession = null;
    }
    battleStartPending = false;
    return;
  }
  battleStartPending = false;
  disposeArena();
  resetHud();
  commandFocusKey = null;
  const state = session.state;
  screen.dataset.page = 'battle';
  screen.className = `screen battle-screen ${ctx.save.expertMode ? 'expert-mode' : 'simple-mode'}${session.mode === 'tutorial' ? ' tutorial-mode' : ''}`;
  screen.innerHTML = `<div class="battle-layout"><section class="battle-info-zone" data-battle-zone="info">${topRowHtml(state)}<div class="battle-plate-slot enemy" id="hud-enemy">${plateHtml('enemy', state)}</div><div class="battle-plate-slot player" id="hud-player">${plateHtml('player', state)}</div></section><section class="battle-stage" data-battle-zone="stage"><canvas id="arena" class="arena-canvas" aria-hidden="true"></canvas>${fighterProxyHtml('enemy', activeOf(state, 'enemy'))}${fighterProxyHtml('player', activeOf(state, 'player'))}<div id="fx-text" class="fx-text" aria-hidden="true"></div></section><section class="battle-command-dock" data-battle-zone="controls"><div class="dock-head" id="dock-head"><div class="action-line" id="action-line" role="status" aria-live="polite"></div></div><div class="battle-controls"><div class="move-grid" id="moves"></div></div></section></div><div id="replacement-root"></div>`;
  try {
    if (!arena) throw new Error('ARENA_LOAD_FAILED');
    if (params.get('failWebgl') === '1') throw new Error('WEBGL_UNAVAILABLE');
    ctx.arenaScene = new arena.ArenaScene(screen.querySelector('#arena'), session.arena, {
      reducedMotion: ctx.save.reducedMotion,
      testAnimationScale,
      quality: ctx.quality,
      governor: ctx.qualityGovernor,
      highContrast: ctx.save.highContrast,
    });
  } catch (error) {
    cancelBattleSession(session);
    ctx.battleSession = null;
    // Browsers keep a failed module load for the page's lifetime, so a failed
    // arena chunk asks for a reload rather than blaming the graphics.
    screen.innerHTML = `<div class="shell"><section class="boot-card error-card"><h1>Oups !</h1><p>${t(arena ? 'error.webgl' : 'error.arenaLoad')}</p>${actionButton(t('app.back'), 'title', 'primary-btn')}</section></div>`;
    bindCommon();
    return;
  }
  // Arena battle theme (setScreen is a no-op when that theme already plays,
  // so rematches and re-renders of the same arena keep the music going).
  sound.setScreen(`battle:${session.arena}`);
  screen.querySelector('#arena').addEventListener('arena-context-lost', () => {
    if (!sessionIsActive(session)) return;
    cancelBattleSession(session);
    ctx.battleSession = null;
    disposeArena();
    screen.innerHTML = `<div class="shell"><section class="boot-card error-card"><h1>Oups !</h1><p>${t('error.context')}</p>${actionButton(t('app.back'), 'title', 'primary-btn')}</section></div>`;
    bindCommon();
  });
  bindInfoZone(session);
  bindCommandDock(session);
  refreshBattle();
  sound.unlock();
  void requestWakeLock();
  // Both fighters are on the GPU before the programs compile and the intro plays.
  await patchFighters(state);
  if (!sessionIsActive(session)) return;
  void ctx.arenaScene.warmUp();
  battleEntrance(session);
}

/* ------------------------------------------------------------------ sheets */

// Pause sheet (§11.5): opens from the top-row button, Escape and (Phase 4) the
// back gesture, including while a turn plays; the covering sheet freezes it.
function openBattlePause() {
  const session = ctx.battleSession,
    root = screen.querySelector('#replacement-root');
  if (!sessionIsActive(session) || root.querySelector('.pause-sheet')) return;
  const body = Object.assign(document.createElement('div'), {
      innerHTML: pauseSheetHtml(session),
    }).firstElementChild,
    confirmBox = body.querySelector('.abandon-confirm'),
    abandon = body.querySelector('[data-action="battle-abandon"]'),
    press = (selector, value) =>
      body
        .querySelectorAll(selector)
        .forEach((button) => button.setAttribute('aria-pressed', String(button.matches(value))));
  const close = openBattleSheet({
    title: t('battle.pause'),
    body,
    variant: 'pause',
    actions: [{ label: t('battle.resume'), variant: 'primary', icon: 'play', action: 'battle-resume' }],
  });
  body.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!button || !sessionIsActive(session)) return;
    const action = button.dataset.action;
    if (action === 'battle-help') openBattleCodex();
    else if (action === 'battle-log') openBattleLog();
    else if (button.dataset.speed) {
      setBattleSpeed(Number(button.dataset.speed));
      press('[data-speed]', `[data-speed="${ctx.save.battleSpeed}"]`);
    } else if (button.dataset.sound) setBattleMuted(button.dataset.sound === 'off');
    else if (action === 'battle-abandon') {
      const open = confirmBox.hidden;
      confirmBox.hidden = !open;
      abandon.setAttribute('aria-expanded', String(open));
      if (open) confirmBox.querySelector('[data-action="battle-abandon-cancel"]').focus();
    } else if (action === 'battle-abandon-cancel') {
      confirmBox.hidden = true;
      abandon.setAttribute('aria-expanded', 'false');
      abandon.focus();
    } else if (action === 'battle-abandon-confirm') {
      close();
      cancelBattleSession(session);
      renderTitle();
    }
  });
}

// ×1 / ×2: persisted, and live on the running turn's clock (§11.5).
function setBattleSpeed(speed) {
  ctx.save.battleSpeed = speed === 2 ? 2 : 1;
  persist();
  ctx.battleSession?.clock?.setSpeed(ctx.save.battleSpeed);
  patchTopRow();
}

// Sound on/off from the pause sheet or the M key; an open pause sheet follows.
function setBattleMuted(muted) {
  ctx.save.muted = muted;
  persist();
  const toggle = screen
    .querySelector('#replacement-root .pause-sheet [data-sound]')
    ?.closest('.pause-toggle');
  if (!toggle) return;
  toggle
    .querySelectorAll('[data-sound]')
    .forEach((segment) =>
      segment.setAttribute('aria-pressed', String((segment.dataset.sound === 'off') === muted))
    );
  toggle
    .querySelector('.ico')
    .replaceWith(
      Object.assign(document.createElement('template'), { innerHTML: icon(muted ? 'sound-off' : 'sound-on') })
        .content
    );
}

function openBattleCodex() {
  const session = ctx.battleSession;
  if (!session) return;
  openBattleSheet({ title: t('battle.codex'), body: codexHtml(session), variant: 'codex' });
}

// Also opened from the results screen (its own #replacement-root).
function openBattleLog() {
  const session = ctx.battleSession;
  if (!session) return;
  openBattleSheet({ title: t('battle.log'), body: battleLogHtml(session), variant: 'log' });
}

function openPlateDetails(side) {
  const session = ctx.battleSession;
  if (!sessionIsActive(session)) return;
  const view = session.displayState ?? session.state,
    trigger = screen.querySelector(`[data-plate-side="${side}"]`);
  trigger?.setAttribute('aria-expanded', 'true');
  openBattleSheet({
    title: t('battle.plateTitle', { name: creatureName(activeOf(view, side).id) }),
    body: plateDetailHtml(side, view),
    variant: 'plate',
    onClose: () => trigger?.setAttribute('aria-expanded', 'false'),
  });
}

function openWeatherSheet() {
  const session = ctx.battleSession;
  if (!sessionIsActive(session)) return;
  openBattleSheet({ title: t('arena.ruleTitle'), body: weatherSheetHtml(session.state), variant: 'weather' });
}

// The tutorial's skip chip asks first (the arena and the turn hold meanwhile):
// a stray tap must not end the lessons.
function confirmSkipTutorial() {
  if (screen.querySelector('#replacement-root .battle-sheet-skip')) return;
  openBattleSheet({
    title: t('tutorial.skipTitle'),
    body: `<p class="sheet-lead">${escapeHtml(t('tutorial.skipBody'))}</p>`,
    variant: 'skip',
    actions: [
      { label: t('tutorial.skipCancel'), variant: 'subtle', action: 'skip-cancel' },
      {
        label: t('tutorial.skip'),
        variant: 'danger',
        action: 'skip-confirm',
        onSelect: (close) => {
          close();
          completeTutorial();
        },
      },
    ],
  });
}

function moveIsLaunchable(session, moveId) {
  return (
    !ctx.locked &&
    tutorialAllows(session, { type: 'move', moveId }) &&
    getLegalActions(session.state, 'player').some(
      (action) => action.type === 'move' && action.moveId === moveId
    )
  );
}

// Long-press / right-click / I key: the move's plain-language sheet.
function openMoveInfo(moveId) {
  const session = ctx.battleSession;
  if (!sessionIsActive(session) || ctx.locked || screen.querySelector('#replacement-root .move-info')) return;
  openBattleSheet({
    title: t(`move.${moveId}`),
    body: moveInfoHtml(moveId),
    variant: 'move',
    actions: [
      { label: t('app.close'), variant: 'subtle', action: 'move-info-close' },
      ...(moveIsLaunchable(session, moveId)
        ? [
            {
              label: t('battle.moveLaunch'),
              variant: 'primary',
              action: 'move-launch',
              onSelect: (close) => {
                close();
                chooseMove(moveId);
              },
            },
          ]
        : []),
    ],
  });
}

function chooseMove(moveId) {
  const move = MOVES[moveId];
  if (!move) return;
  if (move.allySwitch) openSwitch(move.id);
  else handlePlayerAction({ type: 'move', moveId: move.id });
}

// Switch, replacement and Immaculate Relay picks share one bottom sheet.
function openSwitch(relayMoveId = null) {
  const session = ctx.battleSession;
  if (!sessionIsActive(session) || ctx.locked) return;
  const replacement = Boolean(session.state.sides.player.pendingReplacement),
    sheet = switchSheetHtml(relayMoveId);
  if (!sheet.count) return;
  closeSwitch();
  const body = Object.assign(document.createElement('div'), { innerHTML: sheet.html });
  const close = openBattleSheet({
    title: sheet.title,
    body,
    variant: 'switch',
    actions: replacement ? [] : [{ label: t('battle.cancel'), variant: 'subtle', action: 'cancel-switch' }],
  });
  body.addEventListener('click', (event) => {
    const option = event.target instanceof Element ? event.target.closest('[data-switch-index]') : null;
    if (!option || !sessionIsActive(session)) return;
    const index = Number(option.dataset.switchIndex),
      layer = body.closest('.sheet-layer');
    // One pick per sheet: the options are dead from the first tap, and the turn (recall, drop)
    // starts once the sheet has left the stage.
    for (const button of body.querySelectorAll('[data-switch-index]')) button.disabled = true;
    close();
    const closed = sheetExit(layer);
    if (relayMoveId) handlePlayerAction({ type: 'move', moveId: relayMoveId, allyIndex: index }, closed);
    else if (replacement) handleReplacement(index, closed);
    else handlePlayerAction({ type: 'switch', index }, closed);
  });
  body.querySelector('[data-switch-index]')?.focus();
}
// A dismissed sheet plays its exit from <body> and leaves at its animationend (shell openSheet).
function sheetExit(layer) {
  if (!layer?.isConnected) return Promise.resolve();
  return Promise.all(
    layer.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {}))
  );
}
function closeSwitch() {
  screen
    .querySelector('#replacement-root .switch-options')
    ?.closest('.sheet')
    ?.querySelector('.sheet-close')
    ?.click();
}

/* ------------------------------------------------------------------ wiring */

function bindInfoZone(session) {
  screen.querySelector('.battle-info-zone').addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (!target || !sessionIsActive(session)) return;
    const action = target.dataset.action;
    if (action === 'battle-pause') openBattlePause();
    else if (action === 'battle-speed') setBattleSpeed(ctx.save.battleSpeed === 2 ? 1 : 2);
    else if (action === 'battle-weather') openWeatherSheet();
    else if (target.dataset.plateSide) openPlateDetails(target.dataset.plateSide);
  });
}

// A long-press (420 ms, touch) opens the move sheet; the click the release
// produces must not also play the move or hit the new sheet's scrim.
function swallowNextClick() {
  const until = performance.now() + 700,
    swallow = (event) => {
      document.removeEventListener('click', swallow, true);
      if (performance.now() > until) return;
      event.preventDefault();
      event.stopPropagation();
    };
  document.addEventListener('click', swallow, true);
  setTimeout(() => document.removeEventListener('click', swallow, true), 700);
}

function bindCommandDock(session) {
  const grid = screen.querySelector('#moves');
  let pressTimer = 0;
  const tileFor = (target) => (target instanceof Element ? target.closest('[data-move]') : null),
    endPress = () => {
      clearTimeout(pressTimer);
      pressTimer = 0;
    };
  // The coach chip (or, in the tutorial, the skip chip) lives in the dock's head row, next to the prompt.
  screen.querySelector('#dock-head').addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!button || !sessionIsActive(session)) return;
    if (button.dataset.action === 'trainer-command') handleTrainerCommand();
    else if (button.dataset.action === 'skip-tutorial') confirmSkipTutorial();
  });
  grid.addEventListener('pointerdown', (event) => {
    const tile = tileFor(event.target);
    endPress();
    if (!tile || event.pointerType === 'mouse') return;
    pressTimer = setTimeout(() => {
      pressTimer = 0;
      if (!sessionIsActive(session) || ctx.locked) return;
      // The finger is still down: the click its release makes lands on the
      // new sheet, so only that one click is swallowed.
      const release = (up) => {
        if (up.pointerId !== event.pointerId) return;
        document.removeEventListener('pointerup', release, true);
        document.removeEventListener('pointercancel', release, true);
        if (up.type === 'pointerup') swallowNextClick();
      };
      document.addEventListener('pointerup', release, true);
      document.addEventListener('pointercancel', release, true);
      openMoveInfo(tile.dataset.move);
    }, 420);
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) grid.addEventListener(type, endPress);
  grid.addEventListener('contextmenu', (event) => {
    const tile = tileFor(event.target);
    if (!tile) return;
    event.preventDefault();
    openMoveInfo(tile.dataset.move);
  });
  grid.addEventListener('keydown', (event) => {
    const tile = tileFor(event.target);
    if (!tile || event.key.toLowerCase() !== 'i' || event.repeat) return;
    event.preventDefault();
    openMoveInfo(tile.dataset.move);
  });
  grid.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!button || ctx.locked || !sessionIsActive(session)) return;
    commandFocusKey =
      document.activeElement === button
        ? button.dataset.move
          ? `[data-move="${button.dataset.move}"]`
          : `[data-action="${button.dataset.action}"]`
        : null;
    if (button.dataset.action === 'open-switch') openSwitch();
    else chooseMove(button.dataset.move);
  });
}

function restoreCommandFocus() {
  if (!commandFocusKey || ctx.locked) return;
  if (document.activeElement && document.activeElement !== document.body) return;
  const target = screen.querySelector(`#moves ${commandFocusKey}`);
  commandFocusKey = null;
  if (target && !target.disabled) target.focus({ preventScroll: true });
}

// The intro (§6.6) plays with the dock locked and the plates tucked away: the
// narration box announces the rival while the VS stack owns the stage.
async function battleEntrance(session = ctx.battleSession) {
  if (!sessionIsActive(session)) return;
  ctx.locked = true;
  refreshBattle();
  const trainer = ['ladder', 'circuit', 'gauntlet'].includes(session.mode)
    ? TRAINERS[session.trainerIndex]
    : null;
  narrate(trainer ? t('battle.introChallenge', { rival: t(trainer.nameKey) }) : t('battle.introFree'));
  screen.classList.add('battle-intro');
  const alive = await playIntro(session);
  screen.classList.remove('battle-intro');
  if (!alive || !sessionIsActive(session)) return;
  ctx.locked = false;
  if (session.state.phase === 'choice') refreshBattle();
}

/* refreshBattle is a composition (§11.3). Unlocked: both plates, the fighters,
   the dock and the top row. Locked (playback): plates and top row only, so
   any caller during a turn stays cheap and never rebuilds the dock. */
function refreshBattle() {
  const session = ctx.battleSession;
  if (!session || !screen.classList.contains('battle-screen')) return;
  const view = session.displayState ?? session.state;
  screen.classList.toggle('locked', ctx.locked);
  patchHud('player', view);
  patchHud('enemy', view);
  if (ctx.locked) {
    openNarration();
    return;
  }
  void patchFighters(view);
  renderCommands();
  restoreCommandFocus();
}

/* ------------------------------------------------------------------- turns */

function claimBattleLock() {
  if (ctx.locked) return false;
  ctx.locked = true;
  return true;
}

async function handleTrainerCommand() {
  if (!canUseTrainerCommand(ctx.battleSession.state, 'player')) return;
  if (!claimBattleLock()) return;
  const session = ctx.battleSession;
  try {
    refreshBattle();
    await sound.unlock();
    if (!sessionIsActive(session)) return;
    const preTurnState = structuredClone(session.state),
      result = applyTrainerCommand(session.state, 'player');
    session.state = result.state;
    beginPresentation(session, preTurnState);
    await playEvents(result.events);
    if (!sessionIsActive(session)) return;
    ctx.locked = false;
    refreshBattle();
  } catch (error) {
    if (sessionIsActive(session)) ctx.locked = false;
    throw error;
  }
}

// `sheetClosed`: the exit of the sheet the action was picked from; the lock is claimed at once, the
// turn plays once the sheet has left the stage.
async function handlePlayerAction(action, sheetClosed = null) {
  if (!claimBattleLock()) return;
  const session = ctx.battleSession;
  try {
    refreshBattle();
    await Promise.all([sound.unlock(), sheetClosed]);
    if (!sessionIsActive(session)) return;
    const preTurnState = structuredClone(session.state),
      enemyAction = plannedEnemyAction();
    advanceTutorial(session, action);
    const result = resolveTurn(session.state, action, enemyAction);
    session.state = result.state;
    beginPresentation(session, preTurnState);
    await playEvents(result.events);
    if (!sessionIsActive(session)) return;
    if (session.state.phase === 'ended') {
      ctx.locked = false;
      releaseWakeLock();
      finishBattle();
      return;
    }
    tutorialAfterTurn(session);
    await resolvePendingReplacements(session);
    if (!sessionIsActive(session)) return;
    if (session.state.phase !== 'ended') refreshBattle();
  } catch (error) {
    if (sessionIsActive(session)) ctx.locked = false;
    throw error;
  }
}

async function resolvePendingReplacements(session = ctx.battleSession) {
  if (!sessionIsActive(session)) return;
  let state = session.state;
  if (state.sides.enemy.pendingReplacement) {
    const action = chooseAiAction(state, 'enemy', session.difficulty, session.style),
      preTurnState = structuredClone(state),
      result = applyReplacement(state, 'enemy', action);
    session.state = result.state;
    beginPresentation(session, preTurnState);
    await playEvents(result.events);
    if (!sessionIsActive(session)) return;
    state = session.state;
  }
  if (state.sides.player.pendingReplacement) {
    ctx.locked = false;
    refreshBattle();
    openSwitch();
    return;
  }
  ctx.locked = false;
}

async function handleReplacement(index, sheetClosed = null) {
  if (!claimBattleLock()) return;
  const session = ctx.battleSession;
  try {
    refreshBattle();
    await sheetClosed;
    if (!sessionIsActive(session)) return;
    const preTurnState = structuredClone(session.state),
      result = applyReplacement(session.state, 'player', { type: 'replace', index });
    session.state = result.state;
    beginPresentation(session, preTurnState);
    await playEvents(result.events);
    if (!sessionIsActive(session)) return;
    await resolvePendingReplacements(session);
    if (!sessionIsActive(session)) return;
    refreshBattle();
  } catch (error) {
    if (sessionIsActive(session)) ctx.locked = false;
    throw error;
  }
}

registerRoutes({
  startBattle,
  renderBattle,
  openBattlePause,
  setBattleMuted,
  openBattleCodex,
  openBattleLog,
  openPlateDetails,
  battleEntrance,
  refreshBattle,
  patchFighters,
  openSwitch,
  handleTrainerCommand,
  handlePlayerAction,
  resolvePendingReplacements,
  handleReplacement,
});
