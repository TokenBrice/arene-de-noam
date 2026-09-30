import { ctx, registerRoutes, route } from '../app/context.js';
import { ROOKIE_STAT_RATIO } from '../battle/engine.js';

/* Battle HUD (docs/battle-presentation.md §11): the top row, both plates, the
   command dock, the narration box and the HTML of every battle sheet. The
   controller owns the flow and the event wiring; this module renders and
   patches. Plates are rendered once per battle screen and then patched in
   place (patchHud, drainHp); the dock is rebuilt only while unlocked
   (renderCommands). Previews are read-only engine calls (preview parity). */

const {
  AFFINITIES,
  CLASSES,
  affinityMultiplier,
  MOVES,
  PASSIVES,
  activeOf,
  resolveTurn,
  getLegalActions,
  canUseTrainerCommand,
  signatureCostFor,
  previewMove,
  previewMoveOrder,
  previewIncomingAfterSwitch,
  previewAllySwitch,
  chooseAiAction,
  effectiveSpeed,
  STATUS_DEFINITIONS,
  sortStatusIds,
  statusBadgeHtml,
  statusIcon,
  quickRule,
  circuitMatch,
  TRIALS,
  GAUNTLET_STAGES,
  LADDER_COUNT,
  LOG_TYPE_GROUPS,
  testAnimationScale,
  t,
  screen,
  sprite,
  creatureName,
  affinityName,
  className,
  classIcon,
  affinityIcon,
  escapeHtml,
} = ctx;
const { icon, tutorialAllows, tutorialLesson, tutorialTip, tutorialEnemyAction } = route;

// Creatures fight at a nominal level; Apprentice-tier (rookie) rivals show
// their ×0.85 stat handicap as a lower "Niv." on the enemy plate, next to the
// player's own nominal "Niv." so the gap reads at a glance.
const NOMINAL_LEVEL = 50;
const ROOKIE_LEVEL = Math.round(NOMINAL_LEVEL * ROOKIE_STAT_RATIO);
const PLATE_STATUS_LIMIT = { simple: 3, expert: 4 };

const currentView = (session = ctx.battleSession) =>
  session ? (session.displayState ?? session.state) : null;
const ratioOf = (value, max) => (max > 0 ? Math.max(0, Math.min(1, value / max)) : 0);

// Only the player's side shows a Chromatique: every rival image pins the normal look, and
// `data-variant` keeps a Chromatique toggle from repainting it (ctx.setChromatique).
function spriteAttrs(side, id) {
  return side === 'player' ? `src="${sprite(id)}"` : `src="${sprite(id, 'normal')}" data-variant="normal"`;
}
const scaleX = (ratio) => `scaleX(${ratio.toFixed(4)})`;
const isRookie = (view) => Boolean(view?.modifiers?.includes('rookie'));
const coarsePointer = matchMedia('(pointer: coarse)');
// Landscape puts the stage beside the dock: the rival's intent chip leaves the
// enemy plate (it would sit on the player creature's head) for the dock head.
const dockIntentQuery = matchMedia('(orientation: landscape)');

// Plate HP colour: > 50 % high (green), 20–50 % mid (yellow), < 20 % low (red).
function hpState(hp, maxHp) {
  const ratio = ratioOf(hp, maxHp);
  return ratio > 0.5 ? 'high' : ratio >= 0.2 ? 'mid' : 'low';
}

/* ---------------------------------------------------------------- enemy plan */

function plannedEnemyAction() {
  const session = ctx.battleSession,
    state = session?.state;
  if (!session || !state || state.phase !== 'choice') return null;
  if (session.enemyPlanCache?.state === state) return session.enemyPlanCache.action;
  // The tutorial rival plays its script, announced like any Apprentice plan.
  if (session.mode === 'tutorial') {
    session.enemyPlanCache = { state, action: tutorialEnemyAction(session.tutorialStep) };
    return session.enemyPlanCache.action;
  }
  // Test-only hook: force one move, or a comma-separated move sequence.
  const forcedMoves = (ctx.params.get('enemyMove') || '').split(',').filter(Boolean),
    forcedIndex = session.forcedEnemyMoveCount || 0,
    forcedMove = forcedMoves[forcedIndex];
  if (forcedMove) {
    const legal = getLegalActions(state, 'enemy').find(
      (option) => option.type === 'move' && option.moveId === forcedMove
    );
    if (legal) {
      session.forcedEnemyMoveCount = forcedIndex + 1;
      session.enemyPlanCache = { state, action: legal };
      return legal;
    }
  }
  // Non-champion battles historically spend one seeded scouting choice while
  // presenting the forecast. Keep that cadence, then lock the committed plan
  // so every HUD consumer and resolveTurn see the exact same action.
  if (session.difficulty !== 'champion')
    chooseAiAction(state, 'enemy', session.difficulty || 'apprentice', session.style);
  const action = chooseAiAction(state, 'enemy', session.difficulty || 'apprentice', session.style);
  session.enemyPlanCache = { state, action };
  return action;
}

// The rival's committed action, shown only to Apprentice players at choice time.
function enemyPlan() {
  const session = ctx.battleSession;
  if (!session || ctx.locked || session.state.phase !== 'choice' || session.difficulty !== 'apprentice')
    return null;
  return plannedEnemyAction();
}

// `portrait`: the dock copy (landscape) names the rival with its face, since it
// no longer hangs from the rival's plate.
function intentChipHtml(state, { portrait = false } = {}) {
  const action = enemyPlan();
  if (!action) return '';
  const expert = Boolean(ctx.save.expertMode);
  let iconName = 'swap',
    text = t('battle.intentSwitch'),
    tone = 'switch';
  if (action.type === 'move') {
    const move = MOVES[action.moveId];
    iconName = move.signature ? 'sparkle' : move.kind === 'damage' ? 'sword' : 'shield';
    tone = move.signature ? 'signature' : move.kind === 'damage' ? 'attack' : 'tactic';
    if (expert) {
      const forecast = move.kind === 'damage' ? previewMove(state, 'enemy', action.moveId) : null,
        ally =
          move.allySwitch && Number.isInteger(action.allyIndex)
            ? ` → ${creatureName(state.sides.enemy.team[action.allyIndex].id)}`
            : '';
      text = `${t(`move.${action.moveId}`)}${ally}${forecast ? ` · ${forecast.miss ? t('battle.previewMiss') : t('battle.intentDamage', { damage: forecast.damage })}` : ''}`;
    } else
      text = move.signature
        ? t('battle.intentSignature')
        : move.kind === 'damage'
          ? t('battle.intentAttack')
          : t('battle.intentTactic');
  } else if (action.type === 'switch' && expert)
    text = t('battle.intentSwitchTo', { name: creatureName(state.sides.enemy.team[action.index].id) });
  const rival = activeOf(state, 'enemy').id,
    face = portrait
      ? `<img class="intent-portrait" ${spriteAttrs('enemy', rival)} alt="${escapeHtml(creatureName(rival))}">`
      : '';
  return `<div class="intent-read intent-${tone}" role="note"><span class="visually-hidden">${escapeHtml(t('battle.intentLabel'))}</span>${face}${icon(iconName)}<b>${escapeHtml(text)}</b></div>`;
}

/* ------------------------------------------------------------------- plates */

// Plate skeleton: rendered once per battle screen; patchHud fills every value.
function plateHtml(side, view = currentView()) {
  const owner = view.sides[side],
    expert = Boolean(ctx.save.expertMode),
    surge =
      side === 'player' || expert
        ? `<span class="surge-row"><span class="visually-hidden surge-caption">${escapeHtml(t(expert ? 'battle.surge' : 'battle.sigGauge'))}</span>${icon('sparkle')}<span class="surge-track"><i class="surge-fill"></i></span><b class="plate-surge-number num"></b></span>`
        : '';
  return `<button type="button" class="battle-plate ${side}" data-plate-side="${side}" aria-haspopup="dialog"><span class="plate-head"><strong class="plate-name"></strong><i class="plate-type"></i><span class="team-dots">${owner.team.map(() => '<i class="team-dot"></i>').join('')}<span class="visually-hidden team-dots-label"></span></span></span><span class="plate-hp" data-hp-state="high"><i class="plate-hp-ghost"></i><i class="plate-hp-fill"></i><i class="plate-barrier"></i></span><span class="plate-sub"><span class="plate-level" hidden></span><span class="plate-type-name"></span><span class="plate-statuses"></span><span class="plate-hp-value"><b class="plate-hp-number num"></b>${side === 'player' ? `<small class="plate-hp-unit">${escapeHtml(t('battle.hpUnit'))}</small>` : ''}</span></span>${surge}</button>`;
}

const plates = { player: null, enemy: null };

// A plate's second row changes width with the viewport (orientation, desktop resize): its
// status chips refit their slot.
const plateRows = new ResizeObserver((entries) => {
  for (const { target } of entries) {
    const refs = Object.values(plates).find((plate) => plate?.sub === target);
    if (refs) fitStatuses(refs);
  }
});

function plateRefs(side) {
  const root = screen.querySelector(`#hud-${side} .battle-plate`);
  if (!root) return null;
  let refs = plates[side];
  if (refs?.root === root) return refs;
  if (refs) forgetPlate(refs);
  refs = plates[side] = {
    root,
    name: root.querySelector('.plate-name'),
    level: root.querySelector('.plate-level'),
    type: root.querySelector('.plate-type'),
    typeName: root.querySelector('.plate-type-name'),
    sub: root.querySelector('.plate-sub'),
    statuses: root.querySelector('.plate-statuses'),
    statusEntries: [],
    statusLimit: PLATE_STATUS_LIMIT.simple,
    balls: [...root.querySelectorAll('.team-dot')],
    ballsLabel: root.querySelector('.team-dots-label'),
    bar: root.querySelector('.plate-hp'),
    fill: root.querySelector('.plate-hp-fill'),
    ghost: root.querySelector('.plate-hp-ghost'),
    barrier: root.querySelector('.plate-barrier'),
    number: root.querySelector('.plate-hp-number'),
    surgeRow: root.querySelector('.surge-row'),
    surgeFill: root.querySelector('.surge-fill'),
    surgeNumber: root.querySelector('.plate-surge-number'),
    written: new Map(),
    creatureId: null,
    hp: 0,
    maxHp: 1,
    viewHp: null,
    drain: null,
  };
  plateRows.observe(refs.sub);
  return refs;
}

function forgetPlate(refs) {
  stopDrain(refs);
  plateRows.unobserve(refs.sub);
}

// Writes a property only when its value changed since the last patch.
function put(refs, key, value, apply) {
  if (refs.written.get(key) === value) return;
  refs.written.set(key, value);
  apply(value);
}

function plateStatusEntries(c) {
  return [
    ...(c.barrier > 0
      ? [
          `<i class="plate-status status-barrier" data-status="barrier">${icon('shield')}<b class="num">${c.barrier}</b><span class="visually-hidden">${escapeHtml(t('battle.barrier', { amount: c.barrier }))}</span></i>`,
        ]
      : []),
    ...sortStatusIds(Object.keys(c.statuses)).map((id) => {
      const meta = STATUS_DEFINITIONS[id],
        stacks = c.statuses[id].stacks || 1,
        polarity = meta.positive ? 'positive' : 'negative';
      return `<i class="plate-status status-${id} ${polarity}${meta.lightInk ? ' light-ink' : ''}" data-status="${id}" data-icon="${meta.iconKey}" data-polarity="${polarity}" style="--status-color:${meta.color}">${statusIcon(id)}${stacks > 1 ? `<b class="num">${stacks}</b>` : ''}<span class="visually-hidden">${escapeHtml(`${t(`status.${id}`)}${stacks > 1 ? ` ×${stacks}` : ''}`)}</span></i>`;
    }),
  ];
}

// Status chips have their own slot in the plate's second row, between the level tag and the HP
// number, and never paint over either: at most the mode's cap of tokens, fewer when the slot is
// narrower, the rest folded into a "+N" chip (the plate opens the sheet that lists them all).
function fitStatuses(refs) {
  const entries = refs.statusEntries,
    slot = refs.statuses,
    html = (shown) => {
      const folded = entries.length - shown;
      return `${entries.slice(0, shown).join('')}${folded ? `<i class="plate-status-more num">+${folded}</i>` : ''}`;
    };
  let shown = entries.length > refs.statusLimit ? refs.statusLimit - 1 : entries.length;
  slot.innerHTML = html(shown);
  // A plate not laid out yet (0 px slot) keeps the cap; its row refits once it has a width.
  while (shown > 0 && slot.clientWidth > 0 && slot.scrollWidth > slot.clientWidth)
    slot.innerHTML = html(--shown);
}

// Unchanged text and state are not rewritten: a same-value textContent write still replaces the
// text node, so every patch (each beat, the lock and the unlock) would repaint and re-raster the
// plate.
function writeHp(refs, hp) {
  refs.hp = hp;
  const ratio = ratioOf(hp, refs.maxHp),
    text = `${Math.max(0, Math.round(hp))}/${refs.maxHp}`,
    state = hpState(hp, refs.maxHp);
  refs.fill.style.transform = scaleX(ratio);
  refs.ghost.style.transform = scaleX(ratio);
  if (refs.number.textContent !== text) refs.number.textContent = text;
  if (refs.bar.dataset.hpState !== state) refs.bar.dataset.hpState = state;
}

function patchPlate(refs, side, view) {
  const owner = view.sides[side],
    c = activeOf(view, side),
    expert = Boolean(ctx.save.expertMode);
  const swapped = refs.creatureId !== c.id;
  if (swapped) {
    stopDrain(refs);
    refs.creatureId = c.id;
    refs.name.textContent = creatureName(c.id);
    refs.type.innerHTML = affinityIcon(c.affinity);
    refs.typeName.textContent = affinityName(c.affinity);
    refs.root.style.setProperty('--plate-type', AFFINITIES[c.affinity].color);
    // The fill's colour transition eases drains only: a newcomer's bar takes
    // its own colour on its first frame (never the fainted one's red).
    refs.fill.style.transition = 'none';
  }
  refs.maxHp = c.maxHp;
  refs.viewHp = c.hp;
  if (!refs.drain) writeHp(refs, c.hp);
  if (swapped) {
    void getComputedStyle(refs.fill).backgroundColor;
    refs.fill.style.transition = '';
  }
  put(refs, 'barrier', c.barrier > 0 ? scaleX(ratioOf(c.barrier, c.maxHp)) : '', (value) => {
    refs.barrier.style.transform = value || 'scaleX(0)';
    refs.bar.classList.toggle('has-barrier', Boolean(value));
  });
  const level = isRookie(view)
    ? t('battle.level', { level: side === 'enemy' ? ROOKIE_LEVEL : NOMINAL_LEVEL })
    : '';
  put(refs, 'level', level, (value) => {
    refs.level.textContent = value;
    refs.level.hidden = !value;
  });
  const statusKey = `${expert}|${c.barrier}|${sortStatusIds(Object.keys(c.statuses))
    .map((id) => `${id}:${c.statuses[id].stacks || 1}`)
    .join(',')}`;
  put(refs, 'statuses', statusKey, () => {
    refs.statusEntries = plateStatusEntries(c);
    refs.statusLimit = PLATE_STATUS_LIMIT[expert ? 'expert' : 'simple'];
    fitStatuses(refs);
  });
  if (refs.surgeRow) {
    const cost = signatureCostFor(c),
      ready = owner.surge >= cost && c.moves.some((id) => MOVES[id].signature);
    put(refs, 'surge', `${owner.surge}/${cost}|${ready}`, () => {
      refs.surgeFill.style.transform = scaleX(ratioOf(owner.surge, cost));
      refs.surgeNumber.textContent = `${owner.surge}/${cost}`;
      refs.surgeRow.classList.toggle('ready', ready);
    });
  }
  let standing = 0;
  owner.team.forEach((member, index) => {
    const ball = refs.balls[index];
    if (!ball) return;
    const ko = member.hp <= 0,
      ready =
        !ko && owner.surge >= signatureCostFor(member) && member.moves.some((id) => MOVES[id].signature);
    if (!ko) standing++;
    put(refs, `ball${index}`, `${index === owner.active}|${ko}|${ready}`, () => {
      ball.classList.toggle('active', index === owner.active);
      ball.classList.toggle('ko', ko);
      ball.classList.toggle('signature-ready', ready);
    });
  });
  put(refs, 'standing', standing, (count) => {
    refs.ballsLabel.textContent = t('battle.teamStanding', { count, total: owner.team.length });
  });
}

// Mood forwarding (arena tension grade, music) from the presented view,
// change-gated so a per-event patch stays cheap.
const mood = { arena: '', sound: '' };

function syncBattleMood(view) {
  const sideRatio = (side) =>
      view.sides[side].team.reduce((sum, c) => sum + Math.max(0, c.hp), 0) /
      view.sides[side].team.reduce((sum, c) => sum + c.maxHp, 1),
    standing = (side) => view.sides[side].team.filter((c) => c.hp > 0).length,
    lastStand = standing('player') === 1 || standing('enemy') === 1,
    showdown = standing('player') === 1 && standing('enemy') === 1,
    tension = Math.min(
      1,
      (view.turn - 1) / 25 +
        (1 - Math.min(sideRatio('player'), sideRatio('enemy'))) * 0.58 +
        (lastStand ? 0.3 : 0)
    ),
    arenaKey = `${tension.toFixed(2)}|${showdown}`;
  if (arenaKey !== mood.arena) {
    mood.arena = arenaKey;
    ctx.arenaScene?.setBattleState({ tension, showdown });
  }
  const player = activeOf(view, 'player'),
    enemy = activeOf(view, 'enemy'),
    soundKey = `${player.id}:${player.hp}|${enemy.id}:${enemy.hp}|${view.turn}|${view.sides.player.surge}`;
  if (soundKey !== mood.sound) {
    mood.sound = soundKey;
    ctx.sound.setBattleState(view);
  }
}

function patchTopRow(view = currentView()) {
  const turn = screen.querySelector('#turn-chip .turn-label');
  if (turn) {
    const text = t('battle.turn', { turn: view.turn });
    if (turn.textContent !== text) turn.textContent = text;
  }
  const speed = screen.querySelector('.battle-top [data-action="battle-speed"]');
  if (speed && speed.dataset.speed !== String(ctx.save.battleSpeed)) {
    speed.dataset.speed = String(ctx.save.battleSpeed);
    speed.querySelector('.speed-label').textContent = `×${ctx.save.battleSpeed}`;
    speed.setAttribute('aria-pressed', String(ctx.save.battleSpeed === 2));
    speed.setAttribute('aria-label', t('battle.speedLabel', { speed: ctx.save.battleSpeed }));
  }
}

function patchHud(side, view = currentView()) {
  if (!view || !ctx.battleSession) return;
  const refs = plateRefs(side);
  if (refs) patchPlate(refs, side, view);
  patchTopRow(view);
  syncBattleMood(view);
}

/* ---------------------------------------------------------------- HP drain */

function stopDrain(refs) {
  const drain = refs.drain;
  if (!drain) return;
  refs.drain = null;
  cancelAnimationFrame(drain.frame);
  drain.animations.forEach((animation) => animation.cancel());
  refs.bar.classList.remove('is-healing');
  drain.resolve();
}

const easeOut = (x) => 1 - (1 - x) ** 3;

// On-screen scaleX of a bar layer, including a running animation.
function liveScale(element) {
  const matrix = getComputedStyle(element).transform;
  if (!matrix || matrix === 'none') return 1;
  return Number(matrix.slice(7, -1).split(',')[0]) || 0;
}

function drainHp(side, fromHp, toHp, ms) {
  const refs = plateRefs(side);
  if (!refs) return Promise.resolve();
  // A new drain restarts from what the plate shows right now; the lost chunk
  // of a drain still in flight keeps its height (multi-hits pile up on it).
  const inFlight = refs.drain,
    start = inFlight ? inFlight.value : fromHp,
    ghostFrom = inFlight ? liveScale(refs.ghost) : 0;
  stopDrain(refs);
  const to = Math.max(0, toHp),
    heal = to > start;
  refs.viewHp = null;
  if (ms <= 0 || testAnimationScale === 0) {
    writeHp(refs, to);
    return Promise.resolve();
  }
  const fromRatio = ratioOf(start, refs.maxHp),
    toRatio = ratioOf(to, refs.maxHp),
    ghostStart = Math.max(ghostFrom, fromRatio);
  writeHp(refs, to);
  refs.ghost.style.transform = scaleX(heal ? fromRatio : ghostStart);
  return new Promise((resolve) => {
    const drain = { resolve, animations: [], frame: 0, value: start };
    refs.drain = drain;
    const finish = () => {
      if (refs.drain !== drain) return;
      refs.drain = null;
      cancelAnimationFrame(drain.frame);
      refs.bar.classList.remove('is-healing');
      drain.animations.forEach((animation) => animation.cancel());
      writeHp(refs, refs.viewHp ?? to);
      resolve();
    };
    if (ctx.save.reducedMotion) {
      // Instant fill; the lost chunk fades in place instead of shrinking.
      drain.value = to;
      if (heal) {
        finish();
        return;
      }
      const fade = refs.ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
      drain.animations.push(fade);
      fade.finished.then(finish, () => {});
      return;
    }
    refs.bar.classList.toggle('is-healing', heal);
    drain.animations.push(
      refs.fill.animate([{ transform: scaleX(fromRatio) }, { transform: scaleX(toRatio) }], {
        duration: ms,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      })
    );
    if (!heal)
      drain.animations.push(
        refs.ghost.animate([{ transform: scaleX(ghostStart) }, { transform: scaleX(toRatio) }], {
          delay: Math.min(250, ms / 2),
          duration: ms,
          easing: 'cubic-bezier(0.4, 0, 0.6, 1)',
          fill: 'both',
        })
      );
    // The number ticks with the fill; the bar colour follows the ticking value.
    const began = performance.now(),
      tick = (now) => {
        if (refs.drain !== drain) return;
        const progress = Math.min(1, (now - began) / ms);
        drain.value = Math.round(start + (to - start) * easeOut(progress));
        const text = `${drain.value}/${refs.maxHp}`,
          state = hpState(drain.value, refs.maxHp);
        if (refs.number.textContent !== text) refs.number.textContent = text;
        if (refs.bar.dataset.hpState !== state) refs.bar.dataset.hpState = state;
        if (progress < 1) drain.frame = requestAnimationFrame(tick);
      };
    refs.number.textContent = `${start}/${refs.maxHp}`;
    refs.bar.dataset.hpState = hpState(start, refs.maxHp);
    drain.frame = requestAnimationFrame(tick);
    Promise.all(drain.animations.map((animation) => animation.finished)).then(finish, () => {});
  });
}

/* ---------------------------------------------------------- narration box */

// #action-line is the choice prompt while unlocked and the narration box
// while locked (§11.4). A line keeps the box for its own minMs; newer lines
// queue behind it in order, none is ever skipped, and while two or more wait
// each keeps the box for NARRATION_COMPRESSED_MS at most, so the text catches
// up with the stage instead of dropping the line that matters (a K.O.).
const NARRATION_COMPRESSED_MS = 250;
const narration = { current: null, queue: [], timer: 0 };
let nameHighlighter = { session: null, lang: '', pattern: null, kinds: null };

function resetNarration() {
  clearTimeout(narration.timer);
  narration.current = null;
  narration.queue = [];
  narration.timer = 0;
}

function highlightNames(text) {
  const session = ctx.battleSession,
    view = currentView(session),
    html = escapeHtml(text);
  if (!view) return html;
  if (nameHighlighter.session !== session || nameHighlighter.lang !== ctx.i18n.lang) {
    const kinds = new Map();
    for (const side of ['player', 'enemy'])
      for (const creature of view.sides[side].team) {
        kinds.set(escapeHtml(creatureName(creature.id)), 'nw-creature');
        for (const moveId of creature.moves) kinds.set(escapeHtml(t(`move.${moveId}`)), 'nw-move');
      }
    const pattern = [...kinds.keys()]
      .sort((a, b) => b.length - a.length)
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    nameHighlighter = { session, lang: ctx.i18n.lang, pattern: new RegExp(pattern, 'g'), kinds };
  }
  return html.replace(
    nameHighlighter.pattern,
    (match) => `<em class="${nameHighlighter.kinds.get(match)}">${match}</em>`
  );
}

const EMPHASIS_TONES = {
  good: 'battle.hitEffective',
  weak: 'battle.hitWeak',
  crit: 'battle.critical',
  miss: 'battle.missCallout',
  block: 'battle.blocked',
};

function emphasisTone(emphasis) {
  for (const [tone, key] of Object.entries(EMPHASIS_TONES)) if (t(key) === emphasis) return tone;
  return 'neutral';
}

// A leading space keeps the inline emphasis apart from its sentence.
function emphasisHtml(emphasis) {
  return `<span class="narration-emphasis" data-tone="${emphasisTone(emphasis)}"> ${escapeHtml(emphasis)}</span>`;
}

// The slim bar holds two lines: a line that needs more takes its tighter size (16 px). The bar
// never grows, so a long line never re-fits the stage.
function fitNarration(line) {
  delete line.dataset.fit;
  if (line.scrollHeight > line.clientHeight + 1) line.dataset.fit = 'tight';
}

function showNarration(entry) {
  const line = screen.querySelector('#action-line');
  if (!line) return;
  entry.shownAt = performance.now();
  narration.current = entry;
  line.innerHTML = `<span class="narration-line">${highlightNames(entry.text)}${entry.emphasis ? emphasisHtml(entry.emphasis) : ''}</span>`;
  fitNarration(line);
}

// The showing line hands over once its hold is over and a line waits.
function scheduleNarration() {
  clearTimeout(narration.timer);
  narration.timer = 0;
  if (!narration.queue.length) return;
  const current = narration.current,
    hold = current
      ? narration.queue.length > 1
        ? Math.min(current.minMs, NARRATION_COMPRESSED_MS)
        : current.minMs
      : 0,
    remaining = current ? current.shownAt + hold - performance.now() : 0;
  if (remaining > 0) narration.timer = setTimeout(advanceNarration, remaining);
  else advanceNarration();
}

function advanceNarration() {
  narration.timer = 0;
  // The dock is back: waiting lines are stale.
  if (!ctx.locked) {
    narration.queue = [];
    return;
  }
  showNarration(narration.queue.shift());
  scheduleNarration();
}

// Returns the line's handle for emphasizeNarration (null while unlocked).
function narrate(text, { emphasis = null, minMs = 0 } = {}) {
  if (!ctx.locked || !screen.querySelector('#action-line')) return null;
  const entry = { text, emphasis, minMs: testAnimationScale === 0 ? 0 : minMs, shownAt: 0 };
  narration.queue.push(entry);
  scheduleNarration();
  return entry;
}

// A beat's stamp joins its line at contact (§6.3): added to the showing line
// in place (only the emphasis is announced), or carried by the waiting one;
// `null` takes it back.
function emphasizeNarration(entry, emphasis) {
  if (!entry || entry.emphasis === emphasis) return;
  entry.emphasis = emphasis;
  const line = narration.current === entry ? screen.querySelector('#action-line') : null,
    text = line?.querySelector('.narration-line');
  if (!text) return;
  text.querySelector('.narration-emphasis')?.remove();
  if (emphasis) text.insertAdjacentHTML('beforeend', emphasisHtml(emphasis));
  fitNarration(line);
}

// The narration box while a turn plays: empty until the first beat narrates.
function openNarration() {
  const line = screen.querySelector('#action-line');
  if (!line || line.querySelector('.narration-line')) return;
  resetNarration();
  line.textContent = '';
  delete line.dataset.fit;
}

/* ------------------------------------------------------------- stage room */

// The stage takes the room the rest of the screen leaves it (§11.2): the command dock while the
// player chooses ('choice'), the slim narration bar while a turn plays or a K.O.'d creature's
// replacement is picked ('turn'; landscape folds the dock column away), the whole screen for the
// outro ('full'). A mode change lays the screen out once and re-fits the arena once,
// synchronously (its ResizeObserver then finds the rect unchanged). The canvas, the plates, the
// dock and the pause button then glide from where they were (compositor-only FLIP), so nothing
// re-lays out per frame.
const RESTAGE = { id: 'restage', ms: 300, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };
let restageToken = 0;

const clampTo = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));

// Screen-space centre of both fighters' rest feet and heads, and their summed visible heights.
function fighterFrame(anchors, rect) {
  const points = ['player', 'enemy'].flatMap((side) =>
    ['feet', 'head'].map((key) => [rect.left + anchors[side][key].x, rect.top + anchors[side][key].y])
  );
  return {
    x: points.reduce((sum, [x]) => sum + x, 0) / points.length,
    y: points.reduce((sum, [, y]) => sum + y, 0) / points.length,
    size: anchors.player.sizePx + anchors.enemy.sizePx,
  };
}

function restage(mode, update = null) {
  const stage = screen.querySelector('.battle-stage'),
    arena = ctx.arenaScene;
  if (screen.dataset.stage === mode || !stage || !arena || arena.disposed) {
    screen.dataset.stage = mode;
    update?.();
    return;
  }
  for (const animation of screen.getAnimations({ subtree: true }))
    if (animation.id === RESTAGE.id) animation.finish();
  const canvas = stage.querySelector('.arena-canvas'),
    dock = screen.querySelector('.battle-command-dock'),
    movers = [dock, ...screen.querySelectorAll('.battle-plate-slot, [data-action="battle-pause"]')]
      .filter(Boolean)
      .map((node) => [node, node.getBoundingClientRect()]),
    from = stage.getBoundingClientRect(),
    fromFrame = fighterFrame(arena.anchors(), from),
    dockFrom = dock?.getBoundingClientRect();
  screen.dataset.stage = mode;
  update?.();
  const to = stage.getBoundingClientRect();
  if (Math.round(to.width) === Math.round(from.width) && Math.round(to.height) === Math.round(from.height))
    return;
  const toFrame = fighterFrame(arena.fitToStage(to), to);
  if (testAnimationScale === 0 || ctx.save.reducedMotion || !canvas) return;
  // What the screen showed of the old stage above the dock stays covered from the first frame:
  // the canvas scales (never below 1) and moves so the re-fitted fighters stand where they stood,
  // as far as covering that room allows, then relaxes to its new rest. Only a dock under the stage
  // (portrait) bounds that room; in landscape a curtain covers the folded column instead.
  const keep = {
      left: Math.max(from.left, to.left) - to.left,
      right: Math.min(from.right, to.right) - to.left,
      top: from.top - to.top,
      bottom:
        Math.min(
          from.bottom,
          dockFrom && dockFrom.top > from.top + from.height / 2 ? dockFrom.top : from.bottom
        ) - to.top,
    },
    scale = Math.max(
      1,
      fromFrame.size / toFrame.size,
      (keep.right - keep.left) / to.width,
      (keep.bottom - keep.top) / to.height
    ),
    x = clampTo(
      fromFrame.x - to.left - scale * (toFrame.x - to.left),
      keep.right - scale * to.width,
      keep.left
    ),
    y = clampTo(
      fromFrame.y - to.top - scale * (toFrame.y - to.top),
      keep.bottom - scale * to.height,
      keep.top
    ),
    glide = (node, transform) =>
      node.animate([{ transform }, { transform: 'none' }], {
        duration: RESTAGE.ms,
        easing: RESTAGE.easing,
        id: RESTAGE.id,
      }),
    token = ++restageToken;
  // The stage paints below its new edge while it shrinks, down to the rising dock.
  screen.classList.add('restaging');
  glide(canvas, `translate(${x}px, ${y}px) scale(${scale})`).finished.then(
    () => token === restageToken && screen.classList.remove('restaging'),
    () => token === restageToken && screen.classList.remove('restaging')
  );
  for (const [node, rect] of movers) {
    const now = node.getBoundingClientRect(),
      dx = node === dock ? 0 : rect.left - now.left,
      dy = rect.top - now.top;
    // The dock glides as one panel (portrait); one that changes shape (landscape: the column and
    // the bar) lands in its new place, the bar fading in there.
    if (node === dock && Math.round(rect.width) !== Math.round(now.width)) continue;
    if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) glide(node, `translate(${dx}px, ${dy}px)`);
  }
}

/* ------------------------------------------------------------- command dock */

function commandContext(state) {
  const session = ctx.battleSession,
    legal = getLegalActions(state, 'player');
  return {
    session,
    state,
    legalMoves: new Set(legal.filter((action) => action.type === 'move').map((action) => action.moveId)),
    canSwitch: legal.some((action) => action.type === 'switch' || action.type === 'replace'),
    plan: enemyPlan(),
    expert: Boolean(ctx.save.expertMode),
  };
}

// When the move acts, from the committed rival plan (Apprentice) or speed.
function moveOrder(state, moveId, plan) {
  if (plan?.type === 'move') return previewMoveOrder(state, 'player', moveId, plan.moveId);
  if (MOVES[moveId].priority > 0) return 'priority';
  const own = effectiveSpeed(activeOf(state, 'player')),
    foe = effectiveSpeed(activeOf(state, 'enemy'));
  return own === foe ? 'tie' : own > foe ? 'faster' : 'slower';
}
const ORDER_KEYS = {
  first: 'battle.infoFirst',
  second: 'battle.infoSecond',
  tie: 'battle.infoTie',
  priority: 'battle.infoPriority',
  faster: 'battle.infoFaster',
  slower: 'battle.infoSlower',
};
const ORDER_ICONS = {
  first: 'arrow-up',
  priority: 'arrow-up',
  faster: 'arrow-up',
  second: 'arrow-down',
  slower: 'arrow-down',
  tie: null,
};

function moveStatusIds(move) {
  return [
    ...new Set(
      sortStatusIds([
        ...(move.selfStatuses || []).map(({ id }) => id),
        ...(move.targetStatuses || []).map(({ id }) => id),
      ])
    ),
  ];
}

// Expert density: order, hits, declared cooldown and applied statuses. The row
// is there even when empty, so the tile keeps its height from turn to turn.
function tileDetailHtml(move, order) {
  const parts = [
    ORDER_ICONS[order] ? `<span class="tile-chip">${icon(ORDER_ICONS[order])}</span>` : '',
    move.hits > 1 ? `<span class="tile-chip num">×${move.hits}</span>` : '',
    move.cooldown ? `<span class="tile-chip num">${icon('clock')}${move.cooldown}</span>` : '',
    ...moveStatusIds(move)
      .slice(0, 2)
      .map((id) => `<span class="tile-chip tile-status">${statusBadgeHtml(id, { compact: true })}</span>`),
  ];
  return `<span class="tile-detail" aria-hidden="true">${parts.join('')}</span>`;
}

function moveTileHtml(moveId, index, info) {
  const { state, session, expert } = info,
    move = MOVES[moveId],
    owner = state.sides.player,
    c = activeOf(state, 'player'),
    foe = activeOf(state, 'enemy'),
    cooldown = c.cooldowns[moveId]?.remaining || 0,
    legal = info.legalMoves.has(moveId),
    allowed = tutorialAllows(session, { type: 'move', moveId }),
    lesson = tutorialLesson(session),
    enabled = legal && !ctx.locked && allowed,
    damage = move.kind === 'damage',
    preview = damage ? previewMove(state, 'player', moveId) : null,
    mult = damage ? affinityMultiplier(move.affinity, foe.affinity) : 1,
    cost = move.signature ? signatureCostFor(c) : 0,
    sigReady = move.signature && owner.surge >= cost,
    showStats = !move.signature || sigReady,
    name = t(`move.${moveId}`),
    label = [name, affinityName(move.affinity)];
  let pill = '';
  // In the tutorial only the finishing blow announces its K.O.; the other lessons show the type.
  if (preview?.miss) {
    pill = `<span class="move-effectiveness miss">${escapeHtml(t('battle.previewMiss'))}</span>`;
    label.push(t('battle.previewMiss'));
  } else if (preview?.lethal && (!lesson || (lesson.finisher && allowed))) {
    pill = `<span class="move-effectiveness lethal">${escapeHtml(t('battle.koStamp'))}</span>`;
    label.push('K.O.');
  } else if (mult > 1) {
    pill = `<span class="move-effectiveness effective">${escapeHtml(t('battle.effective'))}</span>`;
    label.push(t('battle.effective'));
  } else if (mult < 1) {
    pill = `<span class="move-effectiveness not-effective">${escapeHtml(t('battle.tileWeak'))}</span>`;
    label.push(t('battle.notEffective'));
  }
  let figure = '';
  if (damage && preview && !preview.miss) {
    figure = `<span class="tile-damage num">${icon('sword')}${preview.damage}</span>`;
    label.push(t('battle.preview', { damage: preview.damage }));
  } else if (!damage) {
    const role = t(move.kind === 'heal' ? 'battle.moveRoleHeal' : 'battle.moveRoleTactic');
    figure = `<span class="move-role">${icon(move.kind === 'heal' ? 'heart' : 'shield')}${escapeHtml(role)}</span>`;
    label.push(role);
  }
  const meta = showStats
    ? `<span class="tile-meta">${pill}${figure}</span>`
    : `<span class="tile-meta tile-sig-state">${escapeHtml(t('battle.sigProgress', { surge: owner.surge, cost }))}</span>`;
  if (move.signature)
    label.push(
      sigReady ? t('battle.sigReadyShort') : t('battle.signatureCost', { cost: cost - owner.surge })
    );
  // The tutorial teaches one decision per lesson: no COMBO tag on its tiles.
  const combo = session?.mode === 'tutorial' ? null : preview?.combo;
  if (combo) label.push(t('battle.comboReady', { percent: Math.round((combo.multiplier - 1) * 100) }));
  if (cooldown) label.push(t('battle.cooldownLeft', { count: cooldown }));
  const ribbon = combo
      ? `<span class="tile-ribbon move-combo-badge">${escapeHtml(t('battle.comboRibbon'))}</span>`
      : sigReady
        ? `<span class="tile-ribbon tile-ready">${icon('sparkle')}${escapeHtml(t('battle.sigReadyShort'))}</span>`
        : '',
    classes = [
      'move-btn',
      'move-tile',
      `kind-${move.kind}`,
      move.signature ? 'signature-move' : '',
      sigReady ? 'signature-ready' : '',
      move.signature && !legal ? 'signature-locked' : '',
      cooldown ? 'is-cooldown' : '',
      lesson && allowed ? 'tutorial-target' : '',
    ].filter(Boolean);
  return `<button type="button" class="${classes.join(' ')}" data-move="${moveId}" style="--move-color:${AFFINITIES[move.affinity].color}" aria-label="${escapeHtml(label.join(' · '))}" aria-keyshortcuts="${index + 1}"${enabled ? '' : ' disabled'}><span class="tile-disc" aria-hidden="true">${move.signature ? icon('sparkle') : affinityIcon(move.affinity)}</span><span class="move-name"><span class="move-label">${escapeHtml(name)}</span></span>${meta}${expert ? tileDetailHtml(move, moveOrder(state, moveId, info.plan)) : ''}${move.signature ? `<span class="tile-sig-fill" aria-hidden="true"><i style="transform:${scaleX(ratioOf(owner.surge, cost))}"></i></span>` : ''}${ribbon}${cooldown ? `<span class="tile-cooldown" aria-hidden="true">${icon('clock')}<b class="num">${cooldown}</b></span>` : ''}<kbd class="move-key" aria-hidden="true">${index + 1}</kbd></button>`;
}

function switchTileHtml(info) {
  const { state, session } = info,
    owner = state.sides.player,
    enabled = info.canSwitch && !ctx.locked && tutorialAllows(session, { type: 'switch' }),
    target = enabled && tutorialLesson(session)?.type === 'switch',
    bench = owner.team.filter((_, index) => index !== owner.active);
  return `<button type="button" class="move-tile switch-tile${target ? ' tutorial-target' : ''}" data-action="open-switch" aria-keyshortcuts="C"${enabled ? '' : ' disabled'}><span class="bench" aria-hidden="true">${bench.map((c) => `<span class="bench-mon" data-hp-state="${c.hp > 0 ? hpState(c.hp, c.maxHp) : 'ko'}"><img src="${sprite(c.id)}" alt="" decoding="async"></span>`).join('')}</span><span class="switch-label">${icon('swap')}<b>${escapeHtml(t('battle.switch'))}</b></span><kbd class="move-key" aria-hidden="true">C</kbd></button>`;
}

// Marqué's first real appearance (GAME-04): until a Marqué-boosted hit of the player's is on
// record, the first choice of a battle with a Marqué creature on the field names the bonus.
function markedTip(session, state) {
  if (!session || session.mode === 'tutorial') return null;
  if (session.markedTip === undefined) {
    const marked = ['enemy', 'player']
      .map((side) => activeOf(state, side))
      .find((creature) => creature.statuses.marked);
    if (!marked) return null;
    const known = Object.values(ctx.save.records).some((record) => record.combos > 0);
    session.markedTip = known ? null : { turn: state.turn, name: creatureName(marked.id) };
  }
  return session.markedTip?.turn === state.turn
    ? t('tutorial.marked', { name: session.markedTip.name })
    : null;
}

// The choice prompt. In the tutorial it carries the lesson (the targeted tile glows); in a
// battle, one choice may carry the Marqué tip.
function renderPrompt(state) {
  const line = screen.querySelector('#action-line');
  if (!line) return;
  resetNarration();
  const session = ctx.battleSession,
    replacement = state.sides.player.pendingReplacement,
    lesson = replacement ? null : tutorialTip(session),
    tip = replacement || lesson ? null : markedTip(session, state);
  if (lesson) {
    line.innerHTML = `<span class="prompt-main prompt-lesson"><small class="lesson-step">${icon('school')}${escapeHtml(lesson.lesson)}</small><span class="lesson-text">${highlightNames(lesson.text)}</span></span>`;
    return;
  }
  if (tip) {
    line.innerHTML = `<span class="prompt-main prompt-tip">${statusBadgeHtml('marked', { compact: true })}<span>${highlightNames(tip)}</span></span>`;
    return;
  }
  const text = replacement
    ? t('battle.chooseReplacement')
    : t('battle.promptTurn', { name: creatureName(activeOf(state, 'player').id) });
  line.innerHTML = `<span class="prompt-main">${escapeHtml(text)}</span>${replacement ? '' : `<small class="prompt-hint">${escapeHtml(t(coarsePointer.matches ? 'battle.hintTouch' : 'battle.hintPointer'))}</small>`}`;
}

// Portrait: a speech tab under the rival's plate. Landscape: the dock head.
function renderIntent(state) {
  const docked = dockIntentQuery.matches,
    slot = screen.querySelector(docked ? '#dock-head' : '#hud-enemy');
  if (!slot) return;
  screen
    .querySelectorAll('#hud-enemy > .intent-read, #dock-head > .intent-read')
    .forEach((chip) => chip.remove());
  const html = intentChipHtml(state, { portrait: docked });
  if (html) slot.insertAdjacentHTML('beforeend', html);
}
dockIntentQuery.addEventListener('change', () => {
  const session = ctx.battleSession;
  if (session && !ctx.locked && screen.querySelector('#dock-head')) renderIntent(session.state);
});

// The coach chip exists only while Coup de pouce is usable; it sits in the dock
// head beside the prompt, never on the stage over the player creature. The
// tutorial has no Coup de pouce: its slot holds the skip chip during the lessons.
function renderCoach(state) {
  const slot = screen.querySelector('#dock-head');
  if (!slot) return;
  const session = ctx.battleSession,
    lesson = !ctx.locked && Boolean(tutorialLesson(session)),
    usable = !ctx.locked && session?.mode !== 'tutorial' && canUseTrainerCommand(state, 'player'),
    chip = slot.querySelector('.coach-chip'),
    skip = slot.querySelector('.skip-chip');
  if (!lesson) skip?.remove();
  else if (!skip)
    slot.insertAdjacentHTML(
      'beforeend',
      `<button type="button" class="skip-chip" data-action="skip-tutorial" aria-label="${escapeHtml(t('app.skip'))}">${escapeHtml(t('tutorial.skip'))}</button>`
    );
  if (!usable) chip?.remove();
  else if (!chip)
    slot.insertAdjacentHTML(
      'beforeend',
      `<button type="button" class="coach-chip" data-action="trainer-command" title="${escapeHtml(t('command.effect.coach'))}">${icon('flag')}<span>${escapeHtml(t('command.coach'))}</span></button>`
    );
}

// Rebuilds the dock from session.state; only while unlocked (§11.3).
function renderCommands() {
  const session = ctx.battleSession,
    grid = screen.querySelector('#moves');
  if (!session || !grid || ctx.locked) return;
  const state = session.state,
    info = commandContext(state);
  grid.innerHTML =
    activeOf(state, 'player')
      .moves.map((moveId, index) => moveTileHtml(moveId, index, info))
      .join('') + switchTileHtml(info);
  renderPrompt(state);
  renderIntent(state);
  renderCoach(state);
}

/* ---------------------------------------------------------------- top row */

function weatherRows(state) {
  return Object.entries(state.weather || {})
    .sort(([, a], [, b]) => b - a)
    .map(([affinity, multiplier]) => ({
      affinity,
      up: multiplier > 1,
      text: t(multiplier > 1 ? 'battle.weatherUp' : 'battle.weatherDown', {
        type: affinityName(affinity),
        percent: Math.round(Math.abs(multiplier - 1) * 100),
      }),
    }));
}

// Boosted type icon + "+20 %"; calm arenas (Crystal) have no badge.
function weatherBadgeHtml(state) {
  const rows = weatherRows(state),
    boosted = rows.find((row) => row.up);
  if (!boosted) return '';
  const percent = Math.round((state.weather[boosted.affinity] - 1) * 100);
  return `<button type="button" class="weather-badge" data-action="battle-weather" style="--weather-color:${AFFINITIES[boosted.affinity].color}" aria-label="${escapeHtml(t('battle.weatherOpen', { rule: rows.map((row) => row.text).join(', ') }))}"><span class="weather-pill">${affinityIcon(boosted.affinity)}<span class="num">${escapeHtml(t('battle.weatherBadge', { percent }))}</span></span></button>`;
}

function topRowHtml(state) {
  return `<div class="battle-top"><button type="button" class="icon-btn battle-top-btn" data-action="battle-pause" aria-label="${escapeHtml(t('battle.pauseOpen'))}">${icon('pause')}</button><div class="battle-turn" id="turn-chip"><b class="turn-label">${escapeHtml(t('battle.turn', { turn: state.turn }))}</b>${weatherBadgeHtml(state)}</div><button type="button" class="icon-btn battle-top-btn speed-btn" data-action="battle-speed" data-speed="${ctx.save.battleSpeed}" aria-pressed="${ctx.save.battleSpeed === 2}" aria-label="${escapeHtml(t('battle.speedLabel', { speed: ctx.save.battleSpeed }))}">${icon('speed')}<span class="speed-label num">×${ctx.save.battleSpeed}</span></button></div>`;
}

/* ------------------------------------------------------------ sheet bodies */

function factHtml(label, value, tone = '') {
  return `<div class="move-fact${tone ? ` ${tone}` : ''}"><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></div>`;
}

function exchangeForecastHtml(moveId, enemyAction) {
  const state = ctx.battleSession.state,
    legal = getLegalActions(state, 'player').some(
      (action) => action.type === 'move' && action.moveId === moveId
    );
  if (!enemyAction || !legal) return '';
  const sum = (owner) => owner.team.reduce((total, c) => total + c.hp, 0),
    outcome = resolveTurn(state, { type: 'move', moveId }, enemyAction, { forecast: true }).state,
    playerChange = sum(outcome.sides.player) - sum(state.sides.player),
    enemyChange = sum(outcome.sides.enemy) - sum(state.sides.enemy),
    format = (change) => (change > 0 ? `+${change}` : String(change).replace('-', '−')),
    playerKo = outcome.sides.player.team.every((c) => c.hp <= 0),
    enemyKo = outcome.sides.enemy.team.every((c) => c.hp <= 0);
  return `<div class="exchange-preview${playerKo ? ' self-ko' : ''}${enemyKo ? ' rival-ko' : ''}" data-self-change="${playerChange}" data-rival-change="${enemyChange}">${icon('swap')}<small>${escapeHtml(t('battle.exchange'))}</small><span class="num">${escapeHtml(t('battle.exchangeYou', { change: format(playerChange) }))}</span><span class="num">${escapeHtml(t('battle.exchangeRival', { change: format(enemyChange) }))}</span></div>`;
}

// Long-press / keyboard info sheet body for one move (read-only previews).
function moveInfoHtml(moveId) {
  const state = ctx.battleSession.state,
    move = MOVES[moveId],
    owner = state.sides.player,
    c = activeOf(state, 'player'),
    foe = activeOf(state, 'enemy'),
    expert = Boolean(ctx.save.expertMode),
    plan = enemyPlan(),
    damage = move.kind === 'damage',
    preview = damage ? previewMove(state, 'player', moveId) : null,
    mult = damage ? affinityMultiplier(move.affinity, foe.affinity) : 1,
    cooldown = c.cooldowns[moveId]?.remaining || 0,
    cost = signatureCostFor(c),
    facts = [];
  if (damage) {
    facts.push(
      factHtml(
        t('battle.infoAgainst', { name: creatureName(foe.id) }),
        t(mult > 1 ? 'battle.infoEffective' : mult < 1 ? 'battle.infoWeak' : 'battle.infoNeutral'),
        mult > 1 ? 'good' : mult < 1 ? 'bad' : ''
      ),
      factHtml(
        t('battle.infoDamage'),
        preview.miss
          ? t('battle.previewMiss')
          : `≈ ${preview.damage}${preview.lethal ? ` · ${t('battle.koStamp')}` : ''}`,
        preview.lethal ? 'gold' : ''
      )
    );
  } else
    facts.push(
      factHtml(
        t('battle.infoRole'),
        t(move.kind === 'heal' ? 'battle.moveRoleHeal' : 'battle.moveRoleTactic')
      ),
      factHtml(t('battle.infoType'), affinityName(move.affinity))
    );
  facts.push(
    factHtml(t('battle.infoActs'), t(ORDER_KEYS[moveOrder(state, moveId, plan)])),
    factHtml(
      t('battle.infoCooldown'),
      cooldown
        ? t('battle.cooldownLeft', { count: cooldown })
        : move.cooldown
          ? t('battle.infoTurns', { count: move.cooldown })
          : t('battle.infoNone')
    )
  );
  const notes = [
    move.signature
      ? `<p class="move-note signature">${icon('sparkle')}<span>${escapeHtml(owner.surge >= cost ? t('battle.sigReadyShort') : t('battle.signatureCost', { cost: cost - owner.surge }))}</span></p>`
      : '',
    preview?.combo
      ? `<p class="move-note combo"><b>${escapeHtml(t('battle.comboReady', { percent: Math.round((preview.combo.multiplier - 1) * 100) }))}</b>${preview.helperId ? `<span>${escapeHtml(t('battle.preparedBy', { helper: creatureName(preview.helperId) }))}</span>` : ''}</p>`
      : '',
    preview && preview.weather !== 1
      ? `<p class="move-note weather ${preview.weather > 1 ? 'up' : 'down'}">${affinityIcon(move.affinity)}<span>${escapeHtml(t('battle.infoWeather', { bonus: `${preview.weather > 1 ? '+' : '−'}${Math.round(Math.abs(preview.weather - 1) * 100)}` }))}</span></p>`
      : '',
    preview?.absorbed
      ? `<p class="move-note barrier">${icon('shield')}<span>${escapeHtml(t('battle.action.absorb', { amount: preview.absorbed }))}</span></p>`
      : '',
    expert && move.hits > 1
      ? `<p class="move-note">${escapeHtml(t('battle.infoHits', { count: move.hits }))}</p>`
      : '',
    expert && moveStatusIds(move).length
      ? `<p class="move-note statuses">${moveStatusIds(move)
          .map((id) => statusBadgeHtml(id, { label: escapeHtml(t(`status.${id}`)), compact: true }))
          .join('')}</p>`
      : '',
    expert && plan && damage !== null ? exchangeForecastHtml(moveId, plan) : '',
  ].join('');
  return `<div class="move-info" style="--move-color:${AFFINITIES[move.affinity].color}"><div class="move-info-head"><span class="tile-disc" aria-hidden="true">${affinityIcon(move.affinity)}</span><b>${escapeHtml(affinityName(move.affinity))}</b>${move.signature ? `<span class="move-info-signature">${icon('sparkle')}${escapeHtml(t('battle.sigGauge'))}</span>` : ''}</div><p class="move-info-effect">${escapeHtml(t(`${expert ? 'move.effectDetail' : 'move.effect'}.${moveId}`))}</p><div class="move-facts">${facts.join('')}</div>${notes}</div>`;
}

/* Switch / replacement / relay rows: HP bar, class, and a defensive verdict
   against the rival's committed attack type (Apprentice) or its creature type. */
function switchSheetHtml(relayMoveId = null) {
  const state = ctx.battleSession.state,
    session = ctx.battleSession,
    owner = state.sides.player,
    expert = Boolean(ctx.save.expertMode),
    foe = activeOf(state, 'enemy'),
    replacement = Boolean(owner.pendingReplacement),
    options = getLegalActions(state, 'player')
      .filter((action) =>
        relayMoveId
          ? action.type === 'move' && action.moveId === relayMoveId
          : action.type === 'switch' || action.type === 'replace'
      )
      .map((action) => {
        const index = relayMoveId ? action.allyIndex : action.index;
        return { c: owner.team[index], index };
      }),
    plan = !relayMoveId && !replacement && session.difficulty === 'apprentice' ? enemyPlan() : null,
    threat =
      plan?.type === 'move' && MOVES[plan.moveId]?.kind === 'damage'
        ? MOVES[plan.moveId].affinity
        : foe.affinity;
  const forecastFor = (index) => {
    if (relayMoveId)
      return { text: t('battle.relayProtected'), ...previewAllySwitch(state, 'player', index, relayMoveId) };
    if (!plan || plan.type !== 'move' || MOVES[plan.moveId]?.kind !== 'damage') return null;
    const incoming = previewIncomingAfterSwitch(state, 'player', index, plan.moveId);
    if (!incoming) return null;
    return {
      read: incoming.perfectRelay,
      lethal: incoming.lethal,
      damage: incoming.damage,
      text: incoming.miss
        ? t('battle.switchIncomingMiss')
        : incoming.lethal
          ? t('battle.switchIncomingKo')
          : incoming.absorbed
            ? t('battle.switchIncomingShield', { damage: incoming.damage, shield: incoming.absorbed })
            : t('battle.switchIncoming', { damage: incoming.damage }),
    };
  };
  const scouted = options.map(({ c, index }) => {
      const offense = affinityMultiplier(c.affinity, foe.affinity),
        defense = affinityMultiplier(threat, c.affinity),
        forecast = forecastFor(index),
        score =
          (offense > 1 ? 24 : offense < 1 ? -8 : 0) +
          (defense < 1 ? 18 : defense > 1 ? -20 : 0) +
          (c.hp / c.maxHp) * 12 +
          c.barrier * 0.18 +
          (forecast?.read ? 38 : 0) -
          (forecast?.lethal ? 90 : ((forecast?.damage || 0) / c.maxHp) * 36);
      return { c, index, offense, defense, forecast, score };
    }),
    recommended =
      scouted.length > 1
        ? scouted.slice().sort((a, b) => b.score - a.score || a.index - b.index)[0].index
        : null;
  const rows = scouted
    .map(({ c, index, offense, defense, forecast }) => {
      const verdict = defense < 1 ? 'good' : defense > 1 ? 'bad' : 'neutral',
        verdictText = t(
          verdict === 'good'
            ? 'battle.verdictResists'
            : verdict === 'bad'
              ? 'battle.verdictRisky'
              : 'battle.verdictNeutral'
        ),
        match = offense > 1 ? 'good' : offense < 1 ? 'risky' : 'neutral',
        statusIds = expert ? sortStatusIds(Object.keys(c.statuses)) : [],
        classes = [
          'switch-option',
          `matchup-${match}`,
          `verdict-${verdict}`,
          forecast?.read ? 'perfect-read' : '',
          relayMoveId ? 'protected-relay' : '',
          index === recommended ? 'recommended' : '',
        ].filter(Boolean);
      return `<button type="button" class="${classes.join(' ')}" data-switch-index="${index}">${index === recommended ? `<span class="switch-recommended">${icon('star')}${escapeHtml(t('battle.switchRecommended'))}</span>` : ''}<span class="switch-portrait" style="--switch-color:${AFFINITIES[c.affinity].color}"><img src="${sprite(c.id)}" alt=""></span><span class="switch-info"><span class="switch-name"><strong>${escapeHtml(creatureName(c.id))}</strong><i class="plate-type" style="--plate-type:${AFFINITIES[c.affinity].color}">${affinityIcon(c.affinity, { title: affinityName(c.affinity) })}</i></span><span class="plate-hp switch-hp" data-hp-state="${hpState(c.hp, c.maxHp)}"><i class="plate-hp-fill" style="transform:${scaleX(ratioOf(c.hp, c.maxHp))}"></i>${c.barrier ? `<i class="plate-barrier" style="transform:${scaleX(ratioOf(c.barrier, c.maxHp))}"></i>` : ''}</span><span class="switch-meta"><span class="num">${c.hp}/${c.maxHp} ${escapeHtml(t('battle.hpUnit'))}</span><span class="switch-class" style="--class-color:${CLASSES[c.classId].color}">${classIcon(c.classId)}${escapeHtml(className(c.classId))}</span></span>${forecast && (expert || relayMoveId) ? `<em class="switch-incoming${forecast.lethal ? ' lethal' : ''}">${escapeHtml(forecast.text)}</em>` : ''}${forecast?.read ? `<em class="perfect-read-bonus">${icon('refresh')}${escapeHtml(t('battle.switchRead'))}</em>` : ''}${expert ? `<small class="switch-passive">${icon('sparkle')}${escapeHtml(t(`passive.${c.passive}`))}</small>` : ''}${statusIds.length ? `<span class="switch-statuses">${statusIds.map((id) => statusBadgeHtml(id, { compact: true, label: escapeHtml(t(`status.${id}`)) })).join('')}</span>` : ''}</span><span class="switch-verdict ${verdict}">${icon(verdict === 'bad' ? 'warning' : 'shield')}<b>${escapeHtml(verdictText)}</b></span></button>`;
    })
    .join('');
  // The tutorial's switch lesson leads with the lesson itself: the one ✦ number it shows is the
  // good switch's (on the resisting ally's row), not the generic switch bonus as well.
  const lesson = !relayMoveId && !replacement ? tutorialTip(session) : null,
    bonus = !relayMoveId && !replacement && !lesson,
    lead = relayMoveId
      ? t('battle.relayHint')
      : replacement
        ? t('battle.replacementHint')
        : lesson
          ? lesson.text
          : t(state.modifiers?.includes('relay_fever') ? 'battle.switchBonusFever' : 'battle.switchBonus'),
    title = relayMoveId
      ? t('battle.relayChoose')
      : replacement
        ? t('battle.chooseReplacement')
        : t('battle.switchTitle');
  return {
    title,
    count: scouted.length,
    html: `<p class="sheet-lead${bonus ? ' switch-bonus' : ''}">${bonus ? icon('sparkle') : ''}${escapeHtml(lead)}</p><div class="switch-options${relayMoveId ? ' signature-relay' : ''}">${rows}</div>`,
  };
}

function polarityHtml(meta) {
  return `<em class="status-polarity-label">${icon(meta.positive ? 'arrow-up' : 'arrow-down')}${escapeHtml(t(meta.positive ? 'status.polarity.positive' : 'status.polarity.negative'))}</em>`;
}

function plateDetailHtml(side, view = currentView()) {
  const owner = view.sides[side],
    c = activeOf(view, side),
    passive = c.passive,
    expert = Boolean(ctx.save.expertMode),
    statuses = [
      ...(c.barrier
        ? [
            `<div class="plate-detail-status barrier">${icon('shield')}<span><b>${escapeHtml(expert ? t('battle.barrier', { amount: c.barrier }) : t('battle.barrierName'))}</b></span></div>`,
          ]
        : []),
      ...sortStatusIds(Object.keys(c.statuses)).map((id) => {
        const meta = STATUS_DEFINITIONS[id],
          status = c.statuses[id],
          helper = status.sourceCreatureId,
          polarity = meta.positive ? 'positive' : 'negative';
        return `<div class="plate-detail-status ${polarity}${meta.lightInk ? ' light-ink' : ''}" data-status="${id}" data-icon="${meta.iconKey}" data-polarity="${polarity}" style="--status-color:${meta.color}"><i>${statusIcon(id)}</i><span>${polarityHtml(meta)}<b>${escapeHtml(`${t(`status.${id}`)}${status.stacks > 1 ? ` ×${status.stacks}` : ''}${expert && status.remaining ? ` · ${status.remaining}` : ''}`)}</b>${expert ? `<small>${escapeHtml(`${t(`status.effect.${id}`)}${helper ? ` · ${t('battle.preparedBy', { helper: creatureName(helper) })}` : ''}`)}</small>` : ''}</span></div>`;
      }),
    ],
    team = owner.team
      .map(
        (member, index) =>
          `<li class="${index === owner.active ? 'active' : ''}${member.hp <= 0 ? ' ko' : ''}"><img ${spriteAttrs(side, member.id)} alt=""><span><b>${escapeHtml(creatureName(member.id))}</b><span class="plate-hp switch-hp" data-hp-state="${member.hp > 0 ? hpState(member.hp, member.maxHp) : 'low'}"><i class="plate-hp-fill" style="transform:${scaleX(ratioOf(member.hp, member.maxHp))}"></i></span></span><small class="num">${member.hp}/${member.maxHp}</small></li>`
      )
      .join('');
  return `<div class="plate-detail" style="--plate-type:${AFFINITIES[c.affinity].color}"><div class="plate-detail-head"><i class="plate-type">${affinityIcon(c.affinity)}</i><b>${escapeHtml(affinityName(c.affinity))}</b><span class="num">${c.hp}/${c.maxHp} ${escapeHtml(t('battle.hpUnit'))}</span></div>${side === 'enemy' && isRookie(view) ? `<p class="plate-detail-rookie">${icon('info')}<span><b>${escapeHtml(t('battle.level', { level: ROOKIE_LEVEL }))}</b> ${escapeHtml(t('battle.rookie'))}</span></p>` : ''}<article class="plate-detail-talent">${icon('sparkle')}<div><small>${escapeHtml(t('battle.talent'))}</small><b>${escapeHtml(t(`passive.${passive}`))}</b>${expert ? `<p>${escapeHtml(t(`passive.effect.${passive}`))}</p>` : ''}</div></article><div class="plate-detail-statuses">${statuses.join('') || `<p>${escapeHtml(t('battle.noStatuses'))}</p>`}</div><ol class="plate-detail-team" aria-label="${escapeHtml(t('battle.plateTeam'))}">${team}</ol>${side === 'enemy' ? `<div class="plate-detail-intent">${intentChipHtml(ctx.battleSession.state)}</div>` : ''}</div>`;
}

function weatherSheetHtml(state) {
  const rows = weatherRows(state);
  return `<div class="weather-sheet"><p class="sheet-lead">${escapeHtml(t(`arena.${state.arena}`))}</p>${
    rows.length
      ? `<ul class="weather-rows">${rows.map((row) => `<li class="${row.up ? 'up' : 'down'}" style="--weather-color:${AFFINITIES[row.affinity].color}">${affinityIcon(row.affinity)}<b>${escapeHtml(row.text)}</b></li>`).join('')}</ul><p>${escapeHtml(t('battle.weatherBoth'))}</p>`
      : `<p>${escapeHtml(t('arena.rule.crystal'))}</p>`
  }</div>`;
}

// Mode heading and rule for the pause sheet (trial, gauntlet, circuit, arena).
function battleContextHtml(session) {
  const state = session.state,
    trial = session.mode === 'trial' ? TRIALS.find((entry) => entry.id === session.trialId) : null,
    gauntlet = session.mode === 'gauntlet' ? GAUNTLET_STAGES[session.gauntletStage] : null,
    circuit = session.mode === 'circuit' ? circuitMatch(ctx.save.circuitWins, LADDER_COUNT) : null,
    rule = session.quickRuleId && session.quickRuleId !== 'standard' ? quickRule(session.quickRuleId) : null,
    heading = trial
      ? t(trial.nameKey)
      : gauntlet
        ? `${t(gauntlet.nameKey)} · ${session.gauntletStage + 1}/${GAUNTLET_STAGES.length}`
        : circuit
          ? t('circuit.round', { round: circuit.round })
          : t(`arena.${state.arena}`),
    detail = trial
      ? t(trial.descKey)
      : gauntlet
        ? t('gauntlet.battleRule', { boons: ctx.gauntletRun?.boons.length || 0 })
        : circuit
          ? t(`circuit.effect.${circuit.condition.id}`)
          : '',
    weather =
      weatherRows(state)
        .map((row) => row.text)
        .join(' · ') || t('arena.rule.crystal');
  return `<section class="pause-context">${icon(trial || gauntlet || circuit ? 'flag' : 'map')}<div><b>${escapeHtml(heading)}</b>${detail ? `<p>${escapeHtml(detail)}</p>` : ''}${rule ? `<p class="quick-rule-line"><b>${escapeHtml(t(`quickRule.${rule.id}`))}</b> · ${escapeHtml(t(`quickRule.effect.${rule.id}`))}</p>` : ''}<p class="pause-weather">${trial || gauntlet || circuit ? `${escapeHtml(t(`arena.${state.arena}`))} · ` : ''}${escapeHtml(weather)}</p></div></section>`;
}

function pauseSheetHtml(session) {
  const speed = ctx.save.battleSpeed,
    muted = ctx.save.muted,
    segment = (attr, value, label, pressed) =>
      `<button type="button" data-${attr}="${value}" aria-pressed="${pressed}">${escapeHtml(label)}</button>`;
  return `<div class="pause-sheet">${battleContextHtml(session)}<div class="pause-rows"><button type="button" class="pause-row" data-action="battle-help">${icon('info')}<span>${escapeHtml(t('battle.pauseHelp'))}</span>${icon('chevron-right')}</button><button type="button" class="pause-row" data-action="battle-log">${icon('scroll')}<span>${escapeHtml(t('battle.log'))}</span>${icon('chevron-right')}</button><div class="pause-row pause-toggle" role="group" aria-labelledby="battle-pause-speed">${icon('speed')}<span id="battle-pause-speed">${escapeHtml(t('battle.pauseSpeed'))}</span><span class="segmented">${segment('speed', 1, '×1', speed === 1)}${segment('speed', 2, '×2', speed === 2)}</span></div><div class="pause-row pause-toggle" role="group" aria-labelledby="battle-pause-sound">${icon(muted ? 'sound-off' : 'sound-on')}<span id="battle-pause-sound">${escapeHtml(t('battle.pauseSound'))}</span><span class="segmented">${segment('sound', 'on', t('battle.soundOn'), !muted)}${segment('sound', 'off', t('battle.soundOff'), muted)}</span></div><div class="pause-abandon"><button type="button" class="pause-row danger" data-action="battle-abandon" aria-expanded="false" aria-controls="battle-abandon-confirm">${icon('flag')}<span>${escapeHtml(t('battle.abandon'))}</span></button><div class="abandon-confirm" id="battle-abandon-confirm" hidden><p><b>${escapeHtml(t('battle.exitConfirm'))}</b> ${escapeHtml(t('battle.abandonHint'))}</p><div class="abandon-actions"><button type="button" class="subtle-btn" data-action="battle-abandon-cancel">${escapeHtml(t('battle.abandonNo'))}</button><button type="button" class="danger-btn" data-action="battle-abandon-confirm">${escapeHtml(t('battle.abandonYes'))}</button></div></div></div></div></div>`;
}

function codexHtml(session) {
  const state = session.state,
    statusIds = sortStatusIds([
      ...new Set(['player', 'enemy'].flatMap((side) => Object.keys(activeOf(state, side).statuses))),
    ]),
    boons = ctx.gauntletRun?.boons || [],
    rule = session.quickRuleId && session.quickRuleId !== 'standard' ? quickRule(session.quickRuleId) : null,
    circuit = session.mode === 'circuit' ? circuitMatch(ctx.save.circuitWins, LADDER_COUNT) : null,
    ace = state.enemyAce,
    commandUsed = state.sides.player.commandUsed,
    article = (className, iconName, title, body) =>
      `<article class="${className}"><h3>${icon(iconName)}<span>${escapeHtml(title)}</span></h3>${body}</article>`,
    activeStatuses = statusIds.length
      ? statusIds
          .map((id) => {
            const meta = STATUS_DEFINITIONS[id],
              polarity = meta.positive ? 'positive' : 'negative';
            return `<div class="codex-status ${polarity}${meta.lightInk ? ' light-ink' : ''}" data-status="${id}" data-icon="${meta.iconKey}" data-polarity="${polarity}" style="--status-color:${meta.color}"><i>${statusIcon(id)}</i><span>${polarityHtml(meta)}<b>${escapeHtml(t(`status.${id}`))}</b><small>${escapeHtml(t(`status.effect.${id}`))}</small></span></div>`;
          })
          .join('')
      : `<p>${escapeHtml(t('battle.codexNoStatus'))}</p>`;
  return `<div class="codex-grid">${[
    ace
      ? article(
          `codex-wide ace-codex${state.aceTriggered ? ' triggered' : ''}`,
          'crown',
          t('ace.title'),
          `<b>${escapeHtml(t(`ace.${ace}`))}</b><p>${escapeHtml(t(`ace.effect.${ace}`))}</p>`
        )
      : '',
    circuit
      ? article(
          'codex-wide circuit-codex',
          'trophy',
          t('circuit.condition'),
          `<b>${escapeHtml(t(`circuit.${circuit.condition.id}`))}</b><p>${escapeHtml(t(`circuit.effect.${circuit.condition.id}`))}</p>`
        )
      : '',
    rule
      ? article(
          'codex-wide quick-rule-codex',
          'flag',
          t('quickRule.title'),
          `<b>${escapeHtml(t(`quickRule.${rule.id}`))}</b><p>${escapeHtml(t(`quickRule.effect.${rule.id}`))}</p>`
        )
      : '',
    article(
      `codex-wide trainer-command-codex command-coach${commandUsed ? ' used' : ''}`,
      'flag',
      t('command.coach'),
      `<p>${escapeHtml(t('command.effect.coach'))}</p>${commandUsed ? `<strong>${icon('check')}${escapeHtml(t('battle.commandUsed'))}</strong>` : ''}`
    ),
    article(
      'codex-weather',
      'map',
      t('arena.ruleTitle'),
      `<b>${escapeHtml(t(`arena.${state.arena}`))}</b><p>${escapeHtml(
        weatherRows(state)
          .map((row) => row.text)
          .join(' · ') || t('arena.rule.crystal')
      )}</p>`
    ),
    article(
      'codex-surge',
      'sparkle',
      t('battle.surge'),
      `<p>${escapeHtml(t('academy.surge'))}</p>${ctx.save.expertMode ? `<p>${escapeHtml(t('academy.surgeDetail'))}</p>` : ''}`
    ),
    article(
      'codex-wide',
      'swap',
      t('battle.switchRead'),
      `<p>${escapeHtml(t('battle.perfectRelayHint'))}</p>`
    ),
    boons.length
      ? article(
          'codex-wide',
          'mountain',
          t('gauntlet.boons'),
          `<ul>${boons.map((id) => `<li><b>${escapeHtml(t(`boon.${id}`))}</b> — ${escapeHtml(t(`boon.effect.${id}`))}</li>`).join('')}</ul>`
        )
      : '',
    article(
      'codex-wide',
      'info',
      t('battle.activeStatuses'),
      `<div class="codex-statuses">${activeStatuses}</div>`
    ),
    article(
      'codex-wide affinity-reminder',
      'refresh',
      t('battle.affinityCycle'),
      `<p>${escapeHtml(t('settings.affinities'))}</p>`
    ),
  ].join('')}</div>`;
}

// The battle journal (§6.3): newest first, one row per semantic event. The entry's sentence names
// its creatures with their side (bold, director.js journalEntry); a hit's qualifiers sit on a
// sub-line under it.
function battleLogHtml(session) {
  const entries = [...(session.timeline || [])].reverse();
  return `<p class="sheet-lead">${escapeHtml(t('battle.logHint'))}</p><ol class="battle-log">${
    entries.length
      ? entries
          .map((entry, index) => {
            const turn = entry.turn || 1,
              turnStart = index === 0 || entries[index - 1].turn !== turn,
              notes = entry.notes.length
                ? `<em class="log-notes">${escapeHtml(entry.notes.join(' · '))}</em>`
                : '';
            return `<li class="log-${entry.side || 'field'}${index === 0 ? ' latest' : ''}${turnStart ? ' turn-start' : ''}" data-turn="${escapeHtml(t('battle.turn', { turn }))}"><i aria-hidden="true"></i><span><small>${escapeHtml(t(`battle.logType.${LOG_TYPE_GROUPS[entry.type] || 'effect'}`))}</small>${entry.html}${notes}</span></li>`;
          })
          .join('')
      : `<li class="empty">${escapeHtml(t('battle.logEmpty'))}</li>`
  }</ol>`;
}

// Fresh battle screen: forget per-screen plate, mood and narration state.
function resetHud() {
  for (const side of ['player', 'enemy']) {
    if (plates[side]) forgetPlate(plates[side]);
    plates[side] = null;
  }
  mood.arena = '';
  mood.sound = '';
  resetNarration();
  nameHighlighter = { session: null, lang: '', pattern: null, kinds: null };
}

registerRoutes({
  plannedEnemyAction,
  enemyPlan,
  plateHtml,
  topRowHtml,
  patchHud,
  patchTopRow,
  drainHp,
  narrate,
  emphasizeNarration,
  openNarration,
  restage,
  renderCommands,
  moveInfoHtml,
  switchSheetHtml,
  plateDetailHtml,
  weatherSheetHtml,
  pauseSheetHtml,
  codexHtml,
  battleLogHtml,
  resetHud,
});
