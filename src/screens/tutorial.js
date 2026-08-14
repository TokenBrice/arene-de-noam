import { ctx, registerRoutes, route } from '../app/context.js';

const { MOVES, getLegalActions } = ctx;
const { startBattle } = route;

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
    modifiers: ['overdrive'],
  });
}

function tutorialEnemyAction(step) {
  const legal = getLegalActions(ctx.battleSession.state, 'enemy');
  if (step === 2) {
    const switchToCalderoc = legal.find(
      (action) =>
        action.type === 'switch' && ctx.battleSession.state.sides.enemy.team[action.index].id === 'calderoc'
    );
    if (switchToCalderoc) return switchToCalderoc;
  }
  const reliable = legal.find(
    (action) =>
      action.type === 'move' && MOVES[action.moveId].kind === 'damage' && MOVES[action.moveId].cooldown === 0
  );
  return reliable || legal[0];
}

registerRoutes({ startTutorial, tutorialEnemyAction });
