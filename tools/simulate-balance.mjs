import { CREATURE_IDS } from '../src/data/creatures.js';
import { chooseAiAction } from '../src/battle/ai.js';
import {
  applyReplacement,
  createBattle,
  getLegalActions,
  previewMove,
  resolveTurn,
} from '../src/battle/engine.js';
import { normalizeSeed, randomIndex } from '../src/battle/rng.js';
import { PROFILE_AXES, teamProfile } from '../src/data/team-profile.js';

function drawTeam(seed) {
  const pool = [...CREATURE_IDS],
    team = [];
  let state = seed;
  while (team.length < 3) {
    const next = randomIndex(state, pool.length);
    state = next.state;
    team.push(...pool.splice(next.index, 1));
  }
  return { team, state };
}

function simulate(playerTeam, enemyTeam, seed, lateTurnPressure) {
  let state = createBattle({ playerTeam, enemyTeam, seed, lateTurnPressure });
  for (let guard = 0; guard < 140 && state.phase !== 'ended'; guard++) {
    if (state.sides.player.pendingReplacement)
      state = applyReplacement(
        state,
        'player',
        chooseAiAction(state, 'player', 'champion', 'champion')
      ).state;
    if (state.sides.enemy.pendingReplacement)
      state = applyReplacement(state, 'enemy', chooseAiAction(state, 'enemy', 'champion', 'champion')).state;
    if (state.phase === 'choice')
      state = resolveTurn(
        state,
        chooseAiAction(state, 'player', 'champion', 'champion'),
        chooseAiAction(state, 'enemy', 'champion', 'champion')
      ).state;
  }
  if (state.phase !== 'ended') throw new Error('Simulation did not terminate');
  return state;
}

function chooseNaiveAction(state) {
  const legal = getLegalActions(state, 'player');
  if (legal[0]?.type === 'replace') return legal[0];
  let choice = legal[0],
    highestDamage = -1;
  for (const action of legal) {
    const damage = action.type === 'move' ? previewMove(state, 'player', action.moveId)?.damage || 0 : -1;
    if (damage > highestDamage) {
      choice = action;
      highestDamage = damage;
    }
  }
  return choice;
}

function simulateNaive(playerTeam, enemyTeam, seed, difficulty) {
  let state = createBattle({ playerTeam, enemyTeam, seed });
  for (let guard = 0; guard < 140 && state.phase !== 'ended'; guard++) {
    if (state.sides.player.pendingReplacement)
      state = applyReplacement(state, 'player', chooseNaiveAction(state)).state;
    if (state.sides.enemy.pendingReplacement)
      state = applyReplacement(state, 'enemy', chooseAiAction(state, 'enemy', difficulty, 'direct')).state;
    if (state.phase === 'choice')
      state = resolveTurn(
        state,
        chooseNaiveAction(state),
        chooseAiAction(state, 'enemy', difficulty, 'direct')
      ).state;
  }
  if (state.phase !== 'ended') throw new Error('Naive-policy simulation did not terminate');
  return state;
}

function checkNaiveRamp() {
  const sampleCount = Math.max(
      100,
      Math.min(10000, Math.round(Number(process.env.ARENA_NAIVE_SAMPLES) || 300))
    ),
    seed = normalizeSeed(Number(process.env.ARENA_NAIVE_SEED) || 0x51a1ced),
    targets = {
      apprentice: [0.65, 0.8],
      standard: [0.45, 0.6],
      champion: [0.25, 0.4],
    },
    results = {};
  for (const difficulty of Object.keys(targets)) {
    let rngState = seed,
      wins = 0;
    for (let game = 0; game < sampleCount; game++) {
      const player = drawTeam(rngState);
      rngState = player.state;
      const enemy = drawTeam(rngState);
      rngState = enemy.state;
      if (simulateNaive(player.team, enemy.team, rngState, difficulty).winner === 'player') wins++;
      rngState = (rngState + 0x9e3779b9) >>> 0 || 1;
    }
    results[difficulty] = wins / sampleCount;
  }
  console.log(
    `Naive policy (${sampleCount} seeded random-team battles per tier, seed ${seed}): ${Object.entries(
      results
    )
      .map(([difficulty, winRate]) => `${difficulty} ${percent(winRate, 1)}`)
      .join(' · ')}`
  );
  const outside = Object.entries(results).filter(
    ([difficulty, winRate]) => winRate < targets[difficulty][0] || winRate > targets[difficulty][1]
  );
  if (outside.length)
    throw new Error(
      `Naive-player ramp outside target bands: ${outside
        .map(([difficulty, winRate]) => `${difficulty} ${percent(winRate, 1)}`)
        .join(', ')}`
    );
}

function emptyRecord(keys) {
  return new Map(keys.map((key) => [key, { wins: 0, games: 0 }]));
}

function recordSide(stats, keys, won) {
  for (const key of keys) {
    const item = stats.get(key);
    item.games++;
    if (won) item.wins++;
  }
}

function rate(item) {
  return item.games ? item.wins / item.games : 0;
}

function percent(value, digits = 0) {
  return `${(value * 100).toFixed(digits)}%`;
}

if (process.argv.includes('--naive')) {
  checkNaiveRamp();
  process.exit(0);
}

const samples = Math.max(100, Math.min(10000, Math.round(Number(process.env.ARENA_BALANCE_SAMPLES) || 2400))),
  balanceSeed = normalizeSeed(Number(process.env.ARENA_BALANCE_SEED) || 0xc0ffee),
  stats = emptyRecord(CREATURE_IDS),
  archetypes = emptyRecord(PROFILE_AXES),
  pairwise = new Map(
    CREATURE_IDS.map((row) => [row, emptyRecord(CREATURE_IDS.filter((column) => column !== row))])
  );
let rng = balanceSeed,
  turnsBefore = 0,
  turnsAfter = 0,
  capsBefore = 0,
  capsAfter = 0;

for (let game = 0; game < samples; game++) {
  const player = drawTeam(rng);
  rng = player.state;
  const enemy = drawTeam(rng);
  rng = enemy.state;
  const battleSeed = rng,
    before = simulate(player.team, enemy.team, battleSeed, false),
    result = simulate(player.team, enemy.team, battleSeed, true),
    playerWon = result.winner === 'player',
    enemyWon = result.winner === 'enemy';
  rng = (rng + 0x9e3779b9) >>> 0 || 1;
  turnsBefore += before.turn;
  turnsAfter += result.turn;
  capsBefore += before.reason === 'turn-cap' ? 1 : 0;
  capsAfter += result.reason === 'turn-cap' ? 1 : 0;
  recordSide(stats, player.team, playerWon);
  recordSide(stats, enemy.team, enemyWon);
  recordSide(archetypes, [teamProfile(player.team).dominant], playerWon);
  recordSide(archetypes, [teamProfile(enemy.team).dominant], enemyWon);
  for (const playerId of player.team)
    for (const enemyId of enemy.team) {
      if (playerId === enemyId) continue;
      recordSide(pairwise.get(playerId), [enemyId], playerWon);
      recordSide(pairwise.get(enemyId), [playerId], enemyWon);
    }
}

const ranked = [...stats]
    .map(([id, item]) => ({ id, rate: rate(item), ...item }))
    .sort((a, b) => b.rate - a.rate),
  high = ranked.filter((item) => item.rate > 0.68),
  low = ranked.filter((item) => item.rate < 0.35),
  lopsided = [];

for (let a = 0; a < CREATURE_IDS.length - 1; a++)
  for (let b = a + 1; b < CREATURE_IDS.length; b++) {
    const first = CREATURE_IDS[a],
      second = CREATURE_IDS[b],
      matchup = pairwise.get(first).get(second),
      matchupRate = rate(matchup);
    lopsided.push({
      winner: matchupRate >= 0.5 ? first : second,
      loser: matchupRate >= 0.5 ? second : first,
      rate: Math.max(matchupRate, 1 - matchupRate),
      games: matchup.games,
    });
  }
lopsided.sort((a, b) => b.rate - a.rate || b.games - a.games);

console.log(ranked.map((item) => `${item.id}:${percent(item.rate)}`).join(' · '));
console.log(
  `Simulated ${samples} paired champion-vs-champion matchups (seed ${balanceSeed}) across all ${CREATURE_IDS.length} creatures.`
);
console.log(
  `Late-turn pressure comparison: average turns ${(turnsBefore / samples).toFixed(1)} before → ${(turnsAfter / samples).toFixed(1)} after; turn-cap decisions ${percent(capsBefore / samples, 1)} (${capsBefore}/${samples}) before → ${percent(capsAfter / samples, 1)} (${capsAfter}/${samples}) after.`
);
console.log(`Creature win-rate range: ${percent(ranked.at(-1).rate)}–${percent(ranked[0].rate)}.`);
console.log(
  `Team archetypes: ${PROFILE_AXES.map((axis) => {
    const item = archetypes.get(axis);
    return `${axis} ${percent(rate(item), 1)} (${item.games})`;
  }).join(' · ')}`
);
console.log(
  `Five most lopsided pairs: ${lopsided
    .slice(0, 5)
    .map((item) => `${item.winner} over ${item.loser} ${percent(item.rate, 1)} (${item.games})`)
    .join(' · ')}`
);
console.log('Pairwise creature matchup matrix (row win rate vs column; — = same creature):');
console.log(['creature', ...CREATURE_IDS].join(','));
for (const row of CREATURE_IDS)
  console.log(
    [
      row,
      ...CREATURE_IDS.map((column) =>
        row === column ? '—' : percent(rate(pairwise.get(row).get(column)), 1)
      ),
    ].join(',')
  );

checkNaiveRamp();

if (high.length || low.length)
  throw new Error(
    `Roster balance outside 35–68%: ${[...high, ...low]
      .map((item) => `${item.id} ${percent(item.rate)}`)
      .join(', ')}`
  );
