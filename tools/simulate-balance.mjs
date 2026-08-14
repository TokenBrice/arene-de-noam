import { CREATURE_IDS } from '../src/data/creatures.js';
import { createBattle,resolveTurn,applyReplacement } from '../src/battle/engine.js';
import { chooseAiAction } from '../src/battle/ai.js';
import { normalizeSeed,randomIndex } from '../src/battle/rng.js';

function drawTeam(seed){const pool=[...CREATURE_IDS],team=[];let state=seed;while(team.length<3){const next=randomIndex(state,pool.length);state=next.state;team.push(...pool.splice(next.index,1));}return{team,state};}
function simulate(playerTeam,enemyTeam,seed){let state=createBattle({playerTeam,enemyTeam,seed});for(let guard=0;guard<140&&state.phase!=='ended';guard++){
  if(state.sides.player.pendingReplacement)state=applyReplacement(state,'player',chooseAiAction(state,'player','champion','champion')).state;
  if(state.sides.enemy.pendingReplacement)state=applyReplacement(state,'enemy',chooseAiAction(state,'enemy','champion','champion')).state;
  if(state.phase==='choice')state=resolveTurn(state,chooseAiAction(state,'player','champion','champion'),chooseAiAction(state,'enemy','champion','champion')).state;
}if(state.phase!=='ended')throw new Error('Simulation did not terminate');return state;}

const samples=Math.max(100,Math.min(10000,Math.round(Number(process.env.ARENA_BALANCE_SAMPLES)||2400))),balanceSeed=normalizeSeed(Number(process.env.ARENA_BALANCE_SEED)||0xC0FFEE),stats=new Map(CREATURE_IDS.map((id)=>[id,{wins:0,games:0}]));let rng=balanceSeed,turns=0;
for(let game=0;game<samples;game++){
  const player=drawTeam(rng);rng=player.state;const enemy=drawTeam(rng);rng=enemy.state;
  const result=simulate(player.team,enemy.team,rng);rng=(rng+0x9e3779b9)>>>0||1;turns+=result.turn;
  for(const id of player.team){const s=stats.get(id);s.games++;if(result.winner==='player')s.wins++;}
  for(const id of enemy.team){const s=stats.get(id);s.games++;if(result.winner==='enemy')s.wins++;}
}
const ranked=[...stats].map(([id,s])=>({id,rate:s.wins/s.games,...s})).sort((a,b)=>b.rate-a.rate);
const high=ranked.filter((x)=>x.rate>.68),low=ranked.filter((x)=>x.rate<.35);
console.log(ranked.map((x)=>`${x.id}:${Math.round(x.rate*100)}%`).join(' · '));
if(high.length||low.length)throw new Error(`Roster balance outside 35–68%: ${[...high,...low].map((x)=>`${x.id} ${Math.round(x.rate*100)}%`).join(', ')}`);
console.log(`Simulated ${samples} champion-vs-champion battles (seed ${balanceSeed}) across all ${CREATURE_IDS.length} creatures; average ${Math.round(turns/samples*10)/10} turns.`);
console.log(`Creature win-rate range: ${Math.round(ranked.at(-1).rate*100)}%–${Math.round(ranked[0].rate*100)}%.`);
