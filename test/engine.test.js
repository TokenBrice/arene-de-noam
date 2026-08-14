import test from 'node:test';
import assert from 'node:assert/strict';
import { activeOf, applyReplacement, applyTrainerCommand, createBattle, getLegalActions, previewIncomingAfterSwitch, previewMove, previewMoveOrder, resolveTurn, signatureCostFor, TURN_CAP } from '../src/battle/engine.js';
import { CREATURES } from '../src/data/creatures.js';

const make=()=>createBattle({playerTeam:['orakyn','abyssar','virelia'],enemyTeam:['kordane','calderoc','farfombre'],seed:17});

test('rejects illegal moves and validates from the shared start state',()=>{
  const state=make();
  assert.throws(()=>resolveTurn(state,{type:'move',moveId:'caldera_roar'},{type:'move',moveId:'crystal_strike'}),/Illegal/);
  const next=resolveTurn(state,{type:'switch',index:1},{type:'move',moveId:'crystal_strike'});
  assert.equal(next.state.sides.player.active,1);
  assert.ok(next.state.sides.player.team[1].hp<next.state.sides.player.team[1].maxHp,'incoming switch receives the aimed attack');
  assert.equal(next.state.sides.player.team[0].hp,next.state.sides.player.team[0].maxHp);
});

test('priority beats speed, speed beats ordinary moves, and seeded ties are reproducible',()=>{
  let state=make();
  state.sides.player.surge=100;
  let result=resolveTurn(state,{type:'move',moveId:'oracle_veil'},{type:'move',moveId:'crystal_strike'});
  assert.equal(result.events[0].moveId,'oracle_veil');
  const a=createBattle({playerTeam:['orakyn','virelia','abyssar'],enemyTeam:['virelia','calderoc','kordane'],seed:55});
  const b=structuredClone(a);
  assert.deepEqual(resolveTurn(a,{type:'move',moveId:'lucid_arc'},{type:'move',moveId:'petal_ray'}).events,resolveTurn(b,{type:'move',moveId:'lucid_arc'},{type:'move',moveId:'petal_ray'}).events);
});

test('semantic battle events retain the exact turn that produced them',()=>{
  let state=createBattle({playerTeam:['orakyn','abyssar','virelia'],enemyTeam:['kordane','calderoc','farfombre'],seed:73});let result=resolveTurn(state,{type:'move',moveId:'lucid_arc'},{type:'move',moveId:'crystal_strike'});assert.ok(result.events.length>0);assert.ok(result.events.every((event)=>event.turn===1));state=result.state;result=resolveTurn(state,{type:'move',moveId:'slowing_riddle'},{type:'move',moveId:'crystal_strike'});assert.ok(result.events.every((event)=>event.turn===2));assert.ok(result.state.history.slice(-result.events.length).every((event)=>event.turn===2));
});

test('move-order forecasts use priority before effective speed',()=>{
  const state=make();assert.equal(previewMoveOrder(state,'player','oracle_veil','crystal_strike'),'first');assert.equal(previewMoveOrder(state,'player','lucid_arc','crystal_strike'),'second');
  state.sides.player.team[0].speed=state.sides.enemy.team[0].speed;assert.equal(previewMoveOrder(state,'player','lucid_arc','crystal_strike'),'tie');
});

test('switch forecasts include entry talents and exactly match the incoming hit',()=>{
  const state=createBattle({playerTeam:['orakyn','monolith','virelia'],enemyTeam:['kordane','calderoc','farfombre'],seed:33}),before=structuredClone(state),forecast=previewIncomingAfterSwitch(state,'player',1,'crystal_strike');assert.deepEqual(state,before);const result=resolveTurn(state,{type:'switch',index:1},{type:'move',moveId:'crystal_strike'}),hit=result.events.find((event)=>event.type==='damage'&&event.side==='player');assert.equal(forecast.damage,hit.amount);assert.equal(forecast.absorbed,hit.absorbed);assert.ok(result.events.some((event)=>event.type==='passive'&&event.passive==='foundation'));
});

test('a resisted predicted attack rewards a symmetric Perfect Relay',()=>{
  const state=createBattle({playerTeam:['abyssar','orakyn','virelia'],enemyTeam:['kordane','calderoc','farfombre'],seed:34}),before=state.sides.player.surge,forecast=previewIncomingAfterSwitch(state,'player',1,'crystal_strike');assert.equal(forecast.affinity,.75);assert.equal(forecast.perfectRelay,true);const result=resolveTurn(state,{type:'switch',index:1},{type:'move',moveId:'crystal_strike'});assert.ok(result.events.some((event)=>event.type==='perfect-relay'&&event.side==='player'));assert.ok(result.events.some((event)=>event.type==='surge'&&event.side==='player'&&event.source==='perfect-relay'&&event.amount===6));assert.ok(result.state.sides.player.surge>=before+16);
});

test('cooldowns last exact future selection phases and statuses refresh/consume',()=>{
  let state=createBattle({playerTeam:['kordane','orakyn','virelia'],enemyTeam:['abyssar','calderoc','farfombre'],seed:2});
  state.sides.player.surge=100;state.sides.enemy.surge=100;
  let result=resolveTurn(state,{type:'move',moveId:'fault_charge'},{type:'move',moveId:'shell_bastion'});state=result.state;
  assert.ok(!getLegalActions(state,'player').some((a)=>a.moveId==='fault_charge'));
  assert.ok(state.sides.player.team[0].statuses.exposed);
  result=resolveTurn(state,{type:'move',moveId:'crystal_strike'},{type:'move',moveId:'abyssal_surge'});state=result.state;
  assert.equal(state.sides.player.team[0].cooldowns.fault_charge,undefined);
  state.sides.player.surge=100;
  assert.ok(getLegalActions(state,'player').some((a)=>a.moveId==='fault_charge'));
  assert.equal(state.sides.player.team[0].statuses.exposed,undefined,'exposure is consumed by a damaging hit');
  state.sides.player.team[0].statuses.slowed={remaining:2,appliedTurn:state.turn};
  result=resolveTurn(state,{type:'move',moveId:'crystal_strike'},{type:'move',moveId:'undertow'});state=result.state;
  assert.equal(state.sides.player.team[0].statuses.slowed.remaining,3,'same status is refreshed and not immediately ticked');
});

test('team Surge locks signatures until earned, then spends on a cinematic move',()=>{
  let state=createBattle({playerTeam:['lumivox','orakyn','virelia'],enemyTeam:['monolith','abyssar','mossaur'],seed:18});
  assert.ok(!getLegalActions(state,'player').some((a)=>a.moveId==='finale_nova'));
  state.sides.player.surge=99;
  let result=resolveTurn(state,{type:'move',moveId:'echo_chorus'},{type:'move',moveId:'gravity_fist'});state=result.state;
  assert.equal(state.sides.player.surge,100);
  assert.ok(result.events.some((e)=>e.type==='surge'&&e.side==='player'&&e.ready));
  assert.ok(getLegalActions(state,'player').some((a)=>a.moveId==='finale_nova'));
  result=resolveTurn(state,{type:'move',moveId:'finale_nova'},{type:'move',moveId:'gravity_fist'});
  assert.ok(result.events.some((e)=>e.type==='surge'&&e.side==='player'&&e.amount===-100));
  assert.ok(result.state.sides.player.surge<20,'the enemy reply may rebuild only a sliver of Surge');
});

test('alternating techniques builds Battle Flow while repetition breaks it',()=>{
  let state=createBattle({playerTeam:['orakyn','abyssar','virelia'],enemyTeam:['kordane','calderoc','farfombre'],seed:83});let result=resolveTurn(state,{type:'move',moveId:'lucid_arc'},{type:'move',moveId:'crystal_strike'});state=result.state;const before=state.sides.player.surge;result=resolveTurn(state,{type:'move',moveId:'slowing_riddle'},{type:'move',moveId:'crystal_strike'});state=result.state;const flow=result.events.find((event)=>event.type==='flow'&&event.side==='player');assert.equal(flow.count,1);assert.equal(flow.surge,2);assert.ok(state.sides.player.surge>=before+2);result=resolveTurn(state,{type:'move',moveId:'slowing_riddle'},{type:'move',moveId:'crystal_strike'});assert.equal(result.state.sides.player.flow,0);assert.equal(result.events.some((event)=>event.type==='flow'&&event.side==='player'),false);
});

test('Battle Flow crescendo trims active cooldowns and reports the refreshed kit',()=>{
  const state=createBattle({playerTeam:['orakyn','abyssar','virelia'],enemyTeam:['kordane','calderoc','farfombre'],seed:183});state.sides.player.surge=100;state.sides.player.lastMoveId='lucid_arc';state.sides.player.flow=2;state.sides.player.team[0].cooldowns.lucid_arc={remaining:2,appliedTurn:state.turn};const result=resolveTurn(state,{type:'move',moveId:'oracle_veil'},{type:'move',moveId:'crystal_strike'}),flow=result.events.find((event)=>event.type==='flow'&&event.side==='player');assert.equal(flow.count,3);assert.deepEqual(flow.refreshed,['lucid_arc','oracle_veil']);assert.equal(result.state.sides.player.team[0].cooldowns.lucid_arc.remaining,1);assert.equal(result.state.sides.player.team[0].cooldowns.oracle_veil.remaining,1);assert.equal(state.sides.player.team[0].cooldowns.lucid_arc.remaining,2);
});

test('veteran mastery grants explicit player-only rank perks',()=>{
  let state=createBattle({playerTeam:['orakyn','solflare','virelia'],enemyTeam:['kordane','calderoc','farfombre'],seed:19,masteryRanks:{orakyn:5,solflare:5,virelia:2}});
  assert.equal(state.sides.player.team[0].barrier,6);assert.equal(state.sides.player.team[2].barrier,6);assert.ok(state.sides.player.team[0].maxHp>CREATURES.orakyn.maxHp);assert.equal(state.sides.enemy.team[0].masteryRank,0);
  assert.equal(state.sides.player.surge,50,'rank 4 lead adds five Surge after the harmony bond');assert.equal(signatureCostFor(state.sides.player.team[0]),90);assert.equal(signatureCostFor(state.sides.player.team[1]),70);
  const result=resolveTurn(state,{type:'switch',index:1},{type:'move',moveId:'resonant_focus'});state=result.state;assert.ok(result.events.some((event)=>event.type==='surge'&&event.source==='mastery'&&event.amount===5));assert.equal(state.sides.player.surge,65,'switch and first-entry mastery bonuses both apply');
});

test('arena powers awaken every fourth turn and remain deterministic',()=>{
  for(const arena of ['crystal','grove','tidal','volcano','astral','eclipse']){
    const state=createBattle({playerTeam:['orakyn','virelia','abyssar'],enemyTeam:['kordane','calderoc','farfombre'],seed:23,arena});
    state.turn=4;state.sides.player.surge=100;state.sides.player.team[0].hp-=20;state.sides.enemy.team[0].hp-=20;
    const result=resolveTurn(state,{type:'move',moveId:'oracle_veil'},{type:'move',moveId:'resonant_focus'});
    assert.ok(result.events.some((e)=>e.type==='arena-pulse'&&e.arena===arena),`${arena} pulse is emitted`);
  }
});

test('arena resonance rewards a matching active creature at a telegraphed pulse',()=>{
  const state=createBattle({playerTeam:['kordane','orakyn','virelia'],enemyTeam:['monolith','calderoc','farfombre'],seed:24,arena:'crystal'});state.turn=4;state.sides.player.surge=40;state.sides.enemy.surge=40;
  const result=resolveTurn(state,{type:'move',moveId:'crystal_strike'},{type:'move',moveId:'gravity_fist'});assert.ok(result.events.some((event)=>event.type==='resonance'&&event.side==='player'&&event.affinity==='force'));assert.ok(result.events.some((event)=>event.type==='resonance'&&event.side==='enemy'&&event.affinity==='force'));assert.ok(result.events.some((event)=>event.type==='surge'&&event.source==='resonance'&&event.amount===10));
});

test('innate talents create creature-specific opening, survival, and signature rules',()=>{
  let state=createBattle({playerTeam:['orakyn','solflare','prismage'],enemyTeam:['monolith','pyrolynx','mossaur'],seed:29});
  assert.ok(state.sides.player.team[0].statuses.focused,'Orakyn foresees its opening');
  assert.equal(state.sides.enemy.team[0].barrier,20,'Monolith combines its foundation with the team bulwark');
  state.sides.player.active=1;state.sides.player.surge=80;
  assert.ok(getLegalActions(state,'player').some((a)=>a.moveId==='supernova'),'Sunborn discounts Solflare’s signature');
  state=createBattle({playerTeam:['kordane','orakyn','virelia'],enemyTeam:['pyrolynx','abyssar','mossaur'],seed:31});state.sides.enemy.team[0].hp=1;
  const result=resolveTurn(state,{type:'move',moveId:'crystal_strike'},{type:'move',moveId:'flash_pounce'});
  assert.equal(result.state.sides.enemy.team[0].hp,1);assert.ok(result.events.some((e)=>e.type==='passive'&&e.passive==='nine_lives'));assert.ok(!result.events.some((e)=>e.type==='ko'&&e.side==='enemy'));
});

test('team bonds alter openings without adding hidden randomness',()=>{
  const hunters=createBattle({playerTeam:['ferrax','pyrolynx','riptalon'],enemyTeam:['orakyn','kordane','virelia'],seed:44});
  assert.equal(hunters.sides.player.surge,45);assert.ok(hunters.sides.player.team[0].statuses.haste);assert.deepEqual(hunters.sides.player.bonds,['harmony','huntpack']);
  const grove=createBattle({playerTeam:['thornox','mossaur','florafae'],enemyTeam:['orakyn','kordane','virelia'],seed:44});
  assert.equal(grove.sides.player.surge,40);assert.ok(grove.sides.player.team[0].statuses.focused);assert.ok(grove.sides.enemy.team[0].statuses.marked);
  const bulwark=createBattle({playerTeam:['abyssar','nymbloom','virelia'],enemyTeam:['orakyn','kordane','farfombre'],seed:44});assert.ok(bulwark.sides.player.team.every((c)=>c.barrier===6));
});

test('trial modifiers produce explicit high-stakes battle variants',()=>{
  let state=createBattle({playerTeam:['orakyn','abyssar','virelia'],enemyTeam:['solflare','lumivox','voltide'],seed:51,modifiers:['overdrive']});assert.equal(state.sides.player.surge,100);assert.equal(state.sides.enemy.surge,100);
  state=createBattle({playerTeam:['orakyn','abyssar','virelia'],enemyTeam:['prismage','monolith','calderoc'],seed:51,modifiers:['ascendant','player_wounded']});assert.ok(state.sides.enemy.team[0].maxHp>84);assert.ok(state.sides.player.team.every((c)=>c.hp<c.maxHp));
  state=createBattle({playerTeam:['orakyn','abyssar','virelia'],enemyTeam:['abyssar','monolith','mossaur'],seed:51,modifiers:['enemy_aegis']});assert.ok(state.sides.enemy.team.every((c)=>c.barrier>=18));
});

test('battle doctrines trade opening safety for tempo without affecting the enemy',()=>{
  const base={playerTeam:['orakyn','abyssar','virelia'],enemyTeam:['kordane','calderoc','farfombre'],seed:58};
  let state=createBattle({...base,doctrine:'assault'});assert.equal(state.sides.player.surge,65);assert.ok(state.sides.player.team[0].statuses.exposed);assert.equal(state.sides.enemy.surge,45);
  state=createBattle({...base,doctrine:'bastion'});assert.equal(state.sides.player.surge,35);assert.ok(state.sides.player.team.every((c)=>c.barrier>=10));
  state=createBattle({...base,doctrine:'ambush'});assert.ok(state.sides.player.team[0].statuses.focused);assert.ok(state.sides.player.team[0].statuses.haste);assert.ok(state.sides.player.team.slice(1).every((c)=>c.hp<c.maxHp));
  state=createBattle({...base,doctrine:'unknown'});assert.equal(state.doctrine,'balanced');
});

test('each doctrine grants one immutable once-per-battle Trainer Command',()=>{
  const base={playerTeam:['orakyn','abyssar','virelia'],enemyTeam:['kordane','calderoc','farfombre'],seed:58};
  for(const doctrine of ['balanced','assault','bastion','ambush']){const state=createBattle({...base,doctrine}),before=structuredClone(state);if(doctrine==='balanced')activeOf(state,'player').hp-=20;const result=applyTrainerCommand(state);assert.deepEqual(state,doctrine==='balanced'?{...before,sides:{...before.sides,player:{...before.sides.player,team:before.sides.player.team.map((c,i)=>i?c:{...c,hp:c.hp-20})}}}:before);assert.equal(result.state.sides.player.commandUsed,true);assert.ok(result.events.some((event)=>event.type==='trainer-command'&&event.command===doctrine));if(doctrine==='assault')assert.ok(result.state.sides.player.surge>state.sides.player.surge);if(doctrine==='bastion')assert.ok(activeOf(result.state,'player').barrier>=20);if(doctrine==='ambush')assert.ok(activeOf(result.state,'player').statuses.focused);assert.throws(()=>applyTrainerCommand(result.state),/not available/);}
});

test('gauntlet boons accumulate explicit player-only advantages',()=>{
  const state=createBattle({playerTeam:['orakyn','abyssar','virelia'],enemyTeam:['kordane','calderoc','farfombre'],seed:59,modifiers:['player_surge','player_aegis','player_vitality','player_focus']});
  assert.equal(state.sides.player.surge,70);assert.ok(state.sides.player.team.every((c)=>c.barrier>=12));assert.ok(state.sides.player.team.every((c)=>c.maxHp>CREATURES[c.id].maxHp));assert.ok(state.sides.player.team[0].statuses.focused);assert.ok(state.sides.enemy.team[0].statuses.marked);assert.equal(state.sides.enemy.surge,45);
});

test('multi-hit, barriers, drains, recoil, and damage-over-time emit semantic events',()=>{
  let state=createBattle({playerTeam:['lumivox','mnemora','magmoth'],enemyTeam:['monolith','thornox','virelia'],seed:8});
  let result=resolveTurn(state,{type:'move',moveId:'echo_chorus'},{type:'move',moveId:'fortress_protocol'});state=result.state;
  assert.equal(result.events.filter((e)=>e.type==='damage').length,3);
  assert.ok(state.sides.enemy.team[0].barrier<26,'the multi-hit attack chips through the new barrier');
  assert.ok(result.events.some((e)=>e.type==='barrier-hit'));
  result=resolveTurn(state,{type:'move',moveId:'crescendo_lock'},{type:'move',moveId:'gravity_fist'});state=result.state;
  state.sides.player.team[0].statuses.burning={remaining:2,appliedTurn:0,stacks:2};
  result=resolveTurn(state,{type:'move',moveId:'echo_chorus'},{type:'move',moveId:'gravity_fist'});
  assert.ok(result.events.some((e)=>e.type==='status-tick'&&e.status==='burning'));
});

test('prepared finishers expose combo and detonation semantics',()=>{
  const state=createBattle({playerTeam:['thornox','mossaur','florafae'],enemyTeam:['monolith','kordane','brontusk'],seed:67});state.sides.player.surge=100;state.sides.enemy.team[0].statuses.poisoned={remaining:3,appliedTurn:0,stacks:2};
  assert.ok(previewMove(state,'player','venom_harvest').combo.includes('poisoned'));
  const result=resolveTurn(state,{type:'move',moveId:'venom_harvest'},{type:'move',moveId:'gravity_fist'});
  assert.ok(result.events.some((e)=>e.type==='status'&&e.status==='poisoned'&&e.detonated));assert.ok(result.events.some((e)=>e.type==='damage'&&e.combo.includes('poisoned')));
});

test('a teammate converting an authored setup triggers an assist and Surge',()=>{
  const state=createBattle({playerTeam:['pyrolynx','orakyn','virelia'],enemyTeam:['monolith','kordane','brontusk'],seed:68});state.sides.player.surge=80;state.sides.enemy.team[0].statuses.marked={remaining:2,appliedTurn:0,stacks:1,sourceCreatureId:'orakyn'};
  const preview=previewMove(state,'player','ninefold_inferno');assert.deepEqual(preview.assists,['orakyn']);assert.ok(preview.combo.includes('marked'));
  state.sides.player.surge=100;const result=resolveTurn(state,{type:'move',moveId:'ninefold_inferno'},{type:'move',moveId:'gravity_fist'});assert.ok(result.events.some((event)=>event.type==='assist'&&event.creatureId==='orakyn'&&event.attackerId==='pyrolynx'));assert.ok(result.events.some((event)=>event.type==='surge'&&event.source==='assist'&&event.amount===8));
});

test('damage previews are exact, barrier-aware, immutable, and honest about guaranteed survival',()=>{
  const state=createBattle({playerTeam:['kordane','orakyn','virelia'],enemyTeam:['monolith','pyrolynx','farfombre'],seed:71});
  state.sides.enemy.team[0].barrier=11;const before=structuredClone(state),preview=previewMove(state,'player','crystal_strike');
  assert.ok(preview.damage>0);assert.equal(preview.absorbed,11);assert.deepEqual(state,before,'preview never mutates the battle');
  const result=resolveTurn(state,{type:'move',moveId:'crystal_strike'},{type:'move',moveId:'gravity_fist'});
  const actual=result.events.find((e)=>e.type==='damage'&&e.sourceSide==='player');assert.equal(actual.amount,preview.damage);
  const evasive=createBattle({playerTeam:['kordane','orakyn'],enemyTeam:['farfombre','pyrolynx'],seed:72});
  assert.equal(previewMove(evasive,'player','crystal_strike').miss,true);
  const survivor=createBattle({playerTeam:['kordane','orakyn'],enemyTeam:['pyrolynx','farfombre'],seed:73});survivor.sides.enemy.team[0].hp=1;
  assert.equal(previewMove(survivor,'player','crystal_strike').lethal,false,'Nine Lives is included in the forecast');
});

test('support control, evasion, counters, roots, and team healing alter legal play',()=>{
  let state=createBattle({playerTeam:['mnemora','nymbloom','orakyn'],enemyTeam:['nocturnyx','ferrax','calderoc'],seed:12});
  state.sides.player.surge=100;
  let result=resolveTurn(state,{type:'move',moveId:'deja_vu'},{type:'move',moveId:'sonic_gloom'});state=result.state;
  assert.ok(result.events.some((e)=>e.type==='miss'),'Deja Vu guarantees a dodge');
  result=resolveTurn(state,{type:'move',moveId:'memory_leech'},{type:'move',moveId:'midnight_lullaby'});state=result.state;
  assert.ok(result.events.some((e)=>e.type==='status'&&e.status==='stunned'&&e.applied),'support move applies target control');
  assert.ok(!result.events.some((e)=>e.type==='move-skip'&&e.reason==='stunned'),'daze never removes the player’s turn');
  state.sides.player.team[0].statuses.rooted={remaining:2,appliedTurn:state.turn,stacks:1};
  assert.ok(!getLegalActions(state,'player').some((a)=>a.type==='switch'),'root prevents voluntary switching');
  state.sides.player.team[1].hp-=30;state.sides.player.team[2].hp-=20;state.sides.player.active=1;delete state.sides.player.team[1].statuses.rooted;
  result=resolveTurn(state,{type:'move',moveId:'healing_rain'},{type:'move',moveId:'sonic_gloom'});
  assert.ok(result.events.filter((e)=>e.type==='heal').length>=2,'team healing reaches conscious allies');
});

test('defensive Signatures spend Surge on distinct team-saving effects',()=>{
  const state=createBattle({playerTeam:['virelia','orakyn','abyssar'],enemyTeam:['kordane','calderoc','farfombre'],seed:15});state.sides.player.surge=100;state.sides.player.team.forEach((creature)=>creature.hp-=20);state.sides.player.team[1].statuses.slowed={remaining:2,appliedTurn:state.turn,stacks:1};
  const result=resolveTurn(state,{type:'move',moveId:'leaf_mantle'},{type:'move',moveId:'crystal_strike'});assert.equal(result.events.filter((event)=>event.type==='barrier'&&event.side==='player').length,3);assert.ok(result.events.filter((event)=>event.type==='heal'&&event.side==='player').length>=3);assert.equal(result.state.sides.player.team[1].statuses.slowed,undefined);assert.ok(result.events.some((event)=>event.type==='surge'&&event.amount===-100));
});

test('knockout skips the second move and requires a free replacement',()=>{
  const state=createBattle({playerTeam:['farfombre','abyssar','virelia'],enemyTeam:['kordane','calderoc','orakyn'],seed:17});state.sides.enemy.team[0].hp=1;
  const result=resolveTurn(state,{type:'move',moveId:'shade_spark'},{type:'move',moveId:'crystal_strike'});
  assert.ok(result.events.some((e)=>e.type==='ko'));
  assert.ok(result.events.some((e)=>e.type==='move-skip'));
  assert.equal(result.state.sides.enemy.pendingReplacement,true);
  const replacement=getLegalActions(result.state,'enemy')[0];assert.equal(replacement.type,'replace');
  const beforeSurge=result.state.sides.enemy.surge,replaced=applyReplacement(result.state,'enemy',replacement);assert.equal(replaced.state.phase,'choice');assert.equal(replaced.state.sides.enemy.surge,Math.min(100,beforeSurge+18));assert.ok(activeOf(replaced.state,'enemy').statuses.focused);assert.ok(replaced.events.some((e)=>e.type==='rally'));
});

test('trainer ace powers trigger exactly once when the final enemy enters',()=>{
  const state=createBattle({playerTeam:['orakyn','abyssar','virelia'],enemyTeam:['kordane','calderoc','farfombre'],enemyAce:'royal_ascension',seed:19});state.sides.enemy.team[0].hp=0;state.sides.enemy.team[1].hp=0;state.sides.enemy.active=0;state.sides.enemy.pendingReplacement=true;state.phase='replacement';
  const result=applyReplacement(state,'enemy',{type:'replace',index:2}),aceEvents=result.events.filter((event)=>event.type==='ace');assert.equal(aceEvents.length,1);assert.equal(aceEvents[0].ace,'royal_ascension');assert.equal(result.state.aceTriggered,true);assert.equal(result.state.sides.enemy.surge,100);assert.ok(activeOf(result.state,'enemy').barrier>=16);
});

test('the last fighters enter one symmetric Final Duel exactly once',()=>{
  const state=make();state.sides.player.surge=100;state.sides.player.team[1].hp=0;state.sides.player.team[2].hp=0;state.sides.enemy.team[1].hp=0;state.sides.enemy.team[2].hp=0;const result=resolveTurn(state,{type:'move',moveId:'oracle_veil'},{type:'move',moveId:'resonant_focus'});assert.equal(result.events.filter((event)=>event.type==='final-duel').length,1);assert.equal(result.state.finalDuelTriggered,true);assert.equal(result.events.filter((event)=>event.type==='surge'&&event.source==='final-duel'&&event.amount===12).length,2);const again=resolveTurn(result.state,{type:'move',moveId:'lucid_arc'},{type:'move',moveId:'crystal_strike'});assert.equal(again.events.some((event)=>event.type==='final-duel'),false);
});

test('battle end and turn-cap conscious-count/HP/tie rules',()=>{
  let state=make();state.sides.enemy.team.forEach((c)=>c.hp=0);state.sides.enemy.team[0].hp=1;
  let result=resolveTurn(state,{type:'move',moveId:'lucid_arc'},{type:'move',moveId:'crystal_strike'});
  assert.equal(result.state.winner,'player');assert.equal(result.state.reason,'knockout');
  state=make();state.turn=TURN_CAP;state.sides.player.surge=100;state.sides.enemy.team[2].hp=0;
  result=resolveTurn(state,{type:'move',moveId:'oracle_veil'},{type:'move',moveId:'resonant_focus'});
  assert.equal(result.state.winner,'player');assert.equal(result.state.reason,'turn-cap');
  const tieA=make();tieA.turn=TURN_CAP;tieA.sides.player.surge=100;const tieB=structuredClone(tieA);
  assert.equal(resolveTurn(tieA,{type:'move',moveId:'oracle_veil'},{type:'move',moveId:'resonant_focus'}).state.winner,resolveTurn(tieB,{type:'move',moveId:'oracle_veil'},{type:'move',moveId:'resonant_focus'}).state.winner);
});
