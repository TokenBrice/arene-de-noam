import { ctx, registerRoutes } from '../app/context.js';
import { playBeats, playIntro } from './director.js';

const { screen } = ctx;

// Event presentation (docs/battle-presentation.md §6.1): the engine resolves a turn at once; the
// director (director.js) replays it beat by beat and advances this display-state projection as
// each event is presented, so the HUD shows the battle as the player sees it.

function sessionIsActive(session) {
  return Boolean(
    session &&
    ctx.battleSession === session &&
    !session.cancelled &&
    screen.classList.contains('battle-screen')
  );
}

function beginPresentation(session, preTurnState) {
  if (!session || !preTurnState) return;
  session.displayState = structuredClone(preTurnState);
}

function presentationCreature(state, event) {
  if (!state?.sides?.[event.side] || !event.creatureId) return null;
  return state.sides[event.side].team.find((creature) => creature.id === event.creatureId) || null;
}

function applyProjectedStatus(creature, event, state) {
  if (!creature || !event.status) return;
  if (event.applied === false) {
    delete creature.statuses[event.status];
    return;
  }
  const previous = creature.statuses[event.status] || {},
    next = {
      ...previous,
      appliedTurn: event.turn ?? state.turn,
      stacks: event.stacks ?? previous.stacks ?? 1,
    };
  if (event.remaining == null) delete next.remaining;
  else next.remaining = event.remaining;
  if (event.sourceCreatureId) next.sourceCreatureId = event.sourceCreatureId;
  creature.statuses[event.status] = next;
}

function advancePresentation(session, event) {
  const state = session?.displayState;
  if (!state) return;
  const creature = presentationCreature(state, event);
  if (
    ['damage', 'heal', 'recoil', 'status-tick'].includes(event.type) &&
    creature &&
    Number.isFinite(event.hp)
  )
    creature.hp = Math.max(0, event.hp);
  if (event.type === 'ko' && creature) creature.hp = Number.isFinite(event.hp) ? Math.max(0, event.hp) : 0;
  if (event.type === 'ace' && creature) {
    if (Number.isFinite(event.maxHp)) creature.maxHp = Math.max(0, event.maxHp);
    if (Number.isFinite(event.hp)) creature.hp = Math.max(0, event.hp);
  }
  if (
    ['barrier', 'barrier-hit', 'barrier-break'].includes(event.type) &&
    creature &&
    Number.isFinite(event.total)
  )
    creature.barrier = Math.max(0, event.total);
  if (event.type === 'surge' && state.sides[event.side] && Number.isFinite(event.total))
    state.sides[event.side].surge = Math.max(0, event.total);
  if (event.type === 'status') applyProjectedStatus(creature, event, state);
  if (event.type === 'passive' && event.status) {
    const target = presentationCreature(state, {
      side: event.targetSide || event.side,
      creatureId: event.targetCreatureId || event.creatureId,
    });
    applyProjectedStatus(target, { ...event, applied: true }, state);
  }
  if (event.type === 'status-tick' && creature && event.remaining != null) {
    if (event.remaining <= 0) delete creature.statuses[event.status];
    else if (creature.statuses[event.status]) creature.statuses[event.status].remaining = event.remaining;
  }
  if ((event.type === 'switch' || event.type === 'replace') && state.sides[event.side]) {
    const activeIndex = Number.isInteger(event.activeIndex) ? event.activeIndex : event.to;
    if (Number.isInteger(activeIndex)) state.sides[event.side].active = activeIndex;
  }
}

// Plays one engine result (resolveTurn, applyReplacement or applyTrainerCommand) through the
// director, then hands the HUD back to the resolved state.
async function playEvents(events) {
  const session = ctx.battleSession;
  try {
    if (sessionIsActive(session)) await playBeats(session, events);
  } finally {
    if (session) session.displayState = null;
  }
}

registerRoutes({
  playEvents,
  playIntro,
  beginPresentation,
  advancePresentation,
});
