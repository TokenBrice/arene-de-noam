import { ctx, registerRoutes, route } from '../app/context.js';

const { MOVES, activeOf, getLegalActions, signatureCostFor, t, creatureName } = ctx;
const { startBattle } = route;

/* The first battle (GAME-04) teaches in the order a monster-battle player expects, one decision
   per lesson, and is won on the fourth: Psy beats Combat; the rival sends a Fire creature and the
   Water one resists it; the full Signature ✦ gauge; Water beats Fire. The rival follows a script:
   Kordane attacks, Calderoc opens with its Fire Signature (which Abyssar resists), then only
   attacks. It is a young rival: the Apprentice (`rookie`) handicap plus half HP, so every lesson's
   hit is decisive. */
const LESSONS = Object.freeze([
  { type: 'move', moveId: 'lucid_arc', key: 'tutorial.super' },
  { type: 'switch', key: 'tutorial.switch' },
  { type: 'move', moveId: 'shell_bastion', key: 'tutorial.signature' },
  { type: 'move', moveId: 'abyssal_surge', key: 'tutorial.finish', finisher: true },
]);
const SIGNATURE_LESSON = 2;
const RIVAL_OPENER = Object.freeze({ lesson: 1, moveId: 'caldera_roar' });
const RIVAL_HP_RATIO = 0.5;

function startTutorial() {
  startBattle({
    playerTeam: ['orakyn', 'abyssar'],
    enemyTeam: ['kordane', 'calderoc'],
    playerLead: 0,
    enemyLead: 0,
    mode: 'tutorial',
    arena: 'crystal',
    difficulty: 'apprentice',
    trainerIndex: 0,
    tutorialStep: 0,
  });
}

// Called by startBattle on the new state, before the first render.
function prepareTutorial(state) {
  for (const creature of state.sides.enemy.team) {
    creature.maxHp = Math.round(creature.maxHp * RIVAL_HP_RATIO);
    creature.hp = creature.maxHp;
  }
}

// The lesson the player is on; null outside the tutorial or once the lessons are done.
function tutorialLesson(session) {
  return session?.mode === 'tutorial' ? (LESSONS[session.tutorialStep] ?? null) : null;
}

// Only the lesson's action is playable; a forced replacement never blocks the battle.
function tutorialAllows(session, action) {
  const lesson = tutorialLesson(session);
  if (!lesson || action.type === 'replace') return true;
  return lesson.type === action.type && (lesson.type === 'switch' || lesson.moveId === action.moveId);
}

// The action about to resolve completes its lesson.
function advanceTutorial(session, action) {
  if (tutorialLesson(session) && tutorialAllows(session, action)) session.tutorialStep += 1;
}

// After a turn: the Signature lesson finds the gauge full (the only time it is pre-filled).
function tutorialAfterTurn(session) {
  if (session?.mode !== 'tutorial' || session.tutorialStep !== SIGNATURE_LESSON) return;
  const owner = session.state.sides.player;
  owner.surge = Math.max(owner.surge, signatureCostFor(activeOf(session.state, 'player')));
}

// The prompt-line tip for the current lesson: `{ text, lesson }`, or null.
function tutorialTip(session) {
  const lesson = tutorialLesson(session);
  if (!lesson) return null;
  const { player } = session.state.sides;
  return {
    text: t(lesson.key, {
      move: lesson.moveId ? t(`move.${lesson.moveId}`) : '',
      name: creatureName(activeOf(session.state, 'enemy').id),
      ally: creatureName(player.team.find((_, index) => index !== player.active).id),
    }),
    lesson: t('tutorial.lesson', { step: session.tutorialStep + 1, total: LESSONS.length }),
  };
}

function tutorialEnemyAction(step) {
  const state = ctx.battleSession.state;
  if (step === RIVAL_OPENER.lesson) {
    const enemy = state.sides.enemy;
    enemy.surge = Math.max(enemy.surge, signatureCostFor(activeOf(state, 'enemy')));
  }
  const legal = getLegalActions(state, 'enemy');
  return (
    (step === RIVAL_OPENER.lesson &&
      legal.find((action) => action.type === 'move' && action.moveId === RIVAL_OPENER.moveId)) ||
    legal.find(
      (action) =>
        action.type === 'move' &&
        MOVES[action.moveId].kind === 'damage' &&
        MOVES[action.moveId].cooldown === 0
    ) ||
    legal[0]
  );
}

registerRoutes({
  startTutorial,
  prepareTutorial,
  tutorialLesson,
  tutorialAllows,
  advanceTutorial,
  tutorialAfterTurn,
  tutorialTip,
  tutorialEnemyAction,
});
