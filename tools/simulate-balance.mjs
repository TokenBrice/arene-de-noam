import { CREATURES, CREATURE_IDS } from '../src/data/creatures.js';
import { MOVES } from '../src/data/moves.js';
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
import { CLASS_ORDER } from '../src/data/classes.js';
import { AFFINITY_ORDER } from '../src/data/affinities.js';

const NEW_ENTRANTS = Object.freeze([
  'deuilastre',
  'aubeastre',
  'flambelier',
  'mareclat',
  'xylocorne',
  'pactigon',
]);

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

function simulate(playerTeam, enemyTeam, seed) {
  let state = createBattle({ playerTeam, enemyTeam, seed });
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
      apprentice: [0.65, 1],
      standard: [0.4, 0.6],
      champion: [0.2, 0.45],
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

function median(values) {
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function checkTtkProfile() {
  const buckets = {
      neutral: { ttk: [], oneShots: 0 },
      super: { ttk: [], oneShots: 0 },
      resisted: { ttk: [], oneShots: 0 },
    },
    regularMoves = Object.values(MOVES).filter((move) => move.kind === 'damage' && !move.signature);
  for (const move of regularMoves)
    for (const defenderId of CREATURE_IDS) {
      const playerFillers = CREATURE_IDS.filter((id) => id !== move.owner).slice(0, 2),
        enemyFillers = CREATURE_IDS.filter((id) => id !== defenderId).slice(0, 2),
        state = createBattle({
          playerTeam: [move.owner, ...playerFillers],
          enemyTeam: [defenderId, ...enemyFillers],
        });
      for (const side of ['player', 'enemy'])
        for (const creature of state.sides[side].team) {
          creature.barrier = 0;
          creature.statuses = {};
        }
      const forecast = previewMove(state, 'player', move.id),
        bucket =
          forecast.affinity === 2
            ? buckets.super
            : forecast.affinity === 0.5
              ? buckets.resisted
              : buckets.neutral,
        hp = CREATURES[defenderId].maxHp;
      bucket.ttk.push(Math.ceil(hp / Math.max(1, forecast.raw)));
      if (forecast.raw >= hp) bucket.oneShots++;
    }
  const report = Object.fromEntries(
    Object.entries(buckets).map(([key, bucket]) => [
      key,
      { median: median(bucket.ttk), oneShotRate: bucket.oneShots / bucket.ttk.length },
    ])
  );
  console.log(
    `Regular-move median TTK: neutral ${report.neutral.median} · super-effective ${report.super.median} · resisted ${report.resisted.median}; full-HP one-shots neutral ${percent(report.neutral.oneShotRate, 1)} · super-effective ${percent(report.super.oneShotRate, 1)}.`
  );
  if (
    report.neutral.median < 3.5 ||
    report.neutral.median > 4.5 ||
    report.super.median < 2 ||
    report.super.median > 3 ||
    report.resisted.median < 7 ||
    report.resisted.median > 8 ||
    report.neutral.oneShotRate > 0 ||
    report.super.oneShotRate >= 0.08
  )
    throw new Error('Regular-move TTK or one-shot profile is outside the decisive-fight targets');
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
  classes = emptyRecord(CLASS_ORDER),
  affinities = emptyRecord(AFFINITY_ORDER),
  entrantMetrics = new Map(
    NEW_ENTRANTS.map((id) => [
      id,
      {
        games: 0,
        wins: 0,
        turns: 0,
        kos: 0,
        damage: 0,
        healing: 0,
        barrierCreated: 0,
        barrierBroken: 0,
        signatures: 0,
        moves: new Map(),
      },
    ])
  ),
  definingEvents = {
    baleful_omen: 0,
    benevolent_omen: 0,
    burning_code: 0,
    perfect_ebb: 0,
    heartwood_wedge: 0,
    shared_breath: 0,
    purgeBarrier: 0,
    protectedRelay: 0,
  },
  sustainCompositions = new Map(
    ['healer', 'tank'].flatMap((classId) =>
      [0, 1, 2, 3].map((count) => [`${classId}:${count}`, { games: 0, wins: 0, caps: 0 }])
    )
  ),
  pairwise = new Map(
    CREATURE_IDS.map((row) => [row, emptyRecord(CREATURE_IDS.filter((column) => column !== row))])
  );
let rng = balanceSeed,
  totalTurns = 0,
  turnSamples = [],
  caps = 0,
  signatureUses = 0,
  firstSignatureActions = [];

for (let game = 0; game < samples; game++) {
  const player = drawTeam(rng);
  rng = player.state;
  const enemy = drawTeam(rng);
  rng = enemy.state;
  const result = simulate(player.team, enemy.team, rng),
    playerWon = result.winner === 'player',
    enemyWon = result.winner === 'enemy';
  rng = (rng + 0x9e3779b9) >>> 0 || 1;
  totalTurns += result.turn;
  turnSamples.push(result.turn);
  caps += result.reason === 'turn-cap' ? 1 : 0;
  for (const side of ['player', 'enemy']) {
    const actions = result.history.filter((event) => event.type === 'move-start' && event.side === side),
      firstSignature = actions.findIndex((event) => MOVES[event.moveId]?.signature);
    signatureUses += actions.filter((event) => MOVES[event.moveId]?.signature).length;
    if (firstSignature >= 0) firstSignatureActions.push(firstSignature + 1);
  }
  recordSide(stats, player.team, playerWon);
  recordSide(stats, enemy.team, enemyWon);
  recordSide(classes, player.team.map((id) => CREATURES[id].classId), playerWon);
  recordSide(classes, enemy.team.map((id) => CREATURES[id].classId), enemyWon);
  recordSide(affinities, player.team.map((id) => CREATURES[id].affinity), playerWon);
  recordSide(affinities, enemy.team.map((id) => CREATURES[id].affinity), enemyWon);
  for (const [side, team, won] of [
    ['player', player.team, playerWon],
    ['enemy', enemy.team, enemyWon],
  ])
    for (const id of team) {
      const metric = entrantMetrics.get(id);
      if (!metric) continue;
      metric.games++;
      metric.wins += won ? 1 : 0;
      metric.turns += result.turn;
      metric.kos += result.history.filter(
        (event) => event.type === 'damage' && event.hp === 0 && event.sourceCreatureId === id
      ).length;
      for (const event of result.history.filter(
        (event) => event.type === 'move-start' && event.side === side && event.creatureId === id
      )) {
        metric.moves.set(event.moveId, (metric.moves.get(event.moveId) || 0) + 1);
        if (MOVES[event.moveId].signature) metric.signatures++;
      }
    }
  const currentActor = { player: null, enemy: null };
  for (const event of result.history) {
    if (event.type === 'move-start') currentActor[event.side] = event.creatureId;
    const sourceCreatureId =
        event.type === 'damage'
          ? event.sourceCreatureId
          : event.type === 'barrier-break'
            ? currentActor[event.side === 'player' ? 'enemy' : 'player']
            : ['heal', 'barrier'].includes(event.type)
              ? currentActor[event.side]
              : null,
      sourceMetric = entrantMetrics.get(sourceCreatureId);
    if (sourceMetric && event.amount > 0) {
      if (event.type === 'damage') sourceMetric.damage += event.amount;
      if (event.type === 'heal') sourceMetric.healing += event.amount;
      if (event.type === 'barrier') sourceMetric.barrierCreated += event.amount;
      if (event.type === 'barrier-break') sourceMetric.barrierBroken += event.amount;
    }
    if (event.type === 'passive' && event.passive in definingEvents) definingEvents[event.passive]++;
    if (event.type === 'barrier-break') definingEvents.purgeBarrier += event.amount || 0;
    if (event.type === 'switch' && event.source === 'signature') definingEvents.protectedRelay++;
  }
  for (const [team, won] of [
    [player.team, playerWon],
    [enemy.team, enemyWon],
  ])
    for (const classId of ['healer', 'tank']) {
      const count = team.filter((id) => CREATURES[id].classId === classId).length,
        bucket = sustainCompositions.get(`${classId}:${count}`);
      bucket.games++;
      bucket.wins += won ? 1 : 0;
      bucket.caps += result.reason === 'turn-cap' ? 1 : 0;
    }
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
  high = ranked.filter((item) => item.rate > 0.7),
  low = ranked.filter((item) => item.rate < 0.3),
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
  `Simulated ${samples} champion-vs-champion matchups (seed ${balanceSeed}) across all ${CREATURE_IDS.length} creatures.`
);
console.log(
  `Pacing: average turns ${(totalTurns / samples).toFixed(1)}; p90 ${percentile(turnSamples, 0.9)}; turn-cap decisions ${percent(caps / samples, 1)} (${caps}/${samples}).`
);
console.log(
  `Signature cadence: ${(signatureUses / (samples * 2)).toFixed(2)} uses per side-battle; median first use on that side's action ${median(firstSignatureActions)}; ${percent(firstSignatureActions.length / (samples * 2), 1)} of sides used one.`
);
console.log(`Creature win-rate range: ${percent(ranked.at(-1).rate, 1)}–${percent(ranked[0].rate, 1)}.`);
console.log(
  `Team archetypes: ${PROFILE_AXES.map((axis) => {
    const item = archetypes.get(axis);
    return `${axis} ${percent(rate(item), 1)} (${item.games})`;
  }).join(' · ')}`
);
console.log(
  `Classes: ${CLASS_ORDER.map((id) => `${id} ${percent(rate(classes.get(id)), 1)} (${classes.get(id).games})`).join(' · ')}`
);
console.log(
  `Types: ${AFFINITY_ORDER.map((id) => `${id} ${percent(rate(affinities.get(id)), 1)} (${affinities.get(id).games})`).join(' · ')}`
);
console.log('New entrant cohorts:');
for (const [id, metric] of entrantMetrics)
  console.log(
    `${id}: ${metric.games} appearances · ${percent(metric.wins / Math.max(1, metric.games), 1)} wins · ${(metric.turns / Math.max(1, metric.games)).toFixed(1)} avg turns · ${metric.kos} K.O. · ${metric.damage} damage · ${metric.healing} healing · ${metric.barrierCreated} barrier made · ${metric.barrierBroken} barrier broken · ${metric.signatures} Signatures · ${[...metric.moves].map(([moveId, count]) => `${moveId}:${count}`).join(', ') || 'no moves'}`
  );
console.log(
  `Defining hooks: ${Object.entries(definingEvents)
    .map(([id, count]) => `${id}:${count}`)
    .join(' · ')}`
);
console.log(
  `Sustain compositions: ${[...sustainCompositions]
    .map(
      ([key, item]) =>
        `${key} ${percent(item.wins / Math.max(1, item.games), 1)} wins/${percent(item.caps / Math.max(1, item.games), 1)} caps (${item.games})`
    )
    .join(' · ')}`
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
console.log('New entrant matchup matrix (win rate/observations):');
console.log(['creature', ...CREATURE_IDS].join(','));
for (const row of NEW_ENTRANTS)
  console.log(
    [
      row,
      ...CREATURE_IDS.map((column) => {
        if (row === column) return '—';
        const item = pairwise.get(row).get(column);
        return `${percent(rate(item), 1)}/${item.games}`;
      }),
    ].join(',')
  );

checkNaiveRamp();
checkTtkProfile();

const averageTurns = totalTurns / samples,
  capShare = caps / samples,
  signaturesPerSide = signatureUses / (samples * 2),
  medianFirstSignature = median(firstSignatureActions);
if (averageTurns < 12 || averageTurns > 17 || capShare >= 0.05)
  throw new Error(
    `Pacing outside targets: average turns ${averageTurns.toFixed(1)}, turn-cap share ${percent(capShare, 1)}`
  );

// Stage 3's pre-change reference was one to two Signatures per side and a first
// selectable Signature around the fourth action. The expanded bounds are ±30%.
if (
  signaturesPerSide < 0.7 ||
  signaturesPerSide > 2.6 ||
  medianFirstSignature < 3 ||
  medianFirstSignature > 5
)
  throw new Error(
    `Signature cadence outside Stage 3 reference: ${signaturesPerSide.toFixed(2)} uses per side-battle, median first action ${medianFirstSignature}`
  );

if (high.length || low.length)
  throw new Error(
    `Roster balance outside 30–70%: ${[...high, ...low]
      .map((item) => `${item.id} ${percent(item.rate, 1)}`)
      .join(', ')}`
  );
