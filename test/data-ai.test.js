import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATURES, CREATURE_IDS } from '../src/data/creatures.js';
import { MOVES } from '../src/data/moves.js';
import { PASSIVES, PASSIVE_IDS } from '../src/data/passives.js';
import { BONDS, teamBonds } from '../src/data/synergies.js';
import { TRIALS } from '../src/data/trials.js';
import { GAUNTLET_BOONS, GAUNTLET_STAGES } from '../src/data/gauntlet.js';
import { SQUAD_PRESETS } from '../src/data/squads.js';
import { QUICK_RULES, quickRule } from '../src/data/battle-rules.js';
import { CONTRACTS, contractProgress } from '../src/data/contracts.js';
import { teamComboRoutes } from '../src/data/combos.js';
import { TRAINERS } from '../src/data/trainers.js';
import { CIRCUIT_CONDITIONS, circuitMatch } from '../src/data/circuit.js';
import { PROFILE_AXES, bestLeadIndex, recommendedDoctrine, remixTeam, teamProfile } from '../src/data/team-profile.js';
import { chooseAiAction } from '../src/battle/ai.js';
import { createBattle, getLegalActions, resolveTurn } from '../src/battle/engine.js';

test('twenty-four creatures each reference exactly three authored owner moves',()=>{
  assert.equal(CREATURE_IDS.length,24);assert.equal(Object.keys(MOVES).length,72);
  for(const id of CREATURE_IDS){assert.equal(CREATURES[id].moves.length,3);assert.equal(new Set(CREATURES[id].moves).size,3);for(const move of CREATURES[id].moves){assert.ok(MOVES[move]);assert.equal(MOVES[move].owner,id);}}
});

test('every creature owns one named innate talent',()=>{
  assert.equal(PASSIVE_IDS.length,24);assert.equal(new Set(PASSIVE_IDS).size,24);
  assert.equal(new Set(CREATURE_IDS.map((id)=>CREATURES[id].passive)).size,24);
  for(const id of CREATURE_IDS)assert.ok(PASSIVES[CREATURES[id].passive]);
});

test('team bonds reward distinct composition fantasies',()=>{
  assert.deepEqual(teamBonds(['ferrax','pyrolynx','riptalon']),['harmony','huntpack']);
  assert.ok(teamBonds(['thornox','mossaur','florafae']).includes('convergence'));
  assert.ok(teamBonds(['abyssar','nymbloom','virelia']).includes('bulwark'));
  assert.ok(teamBonds(['orakyn','mnemora','hexalune']).includes('spellweave'));
  for(const ids of [['ferrax','pyrolynx','riptalon'],['thornox','mossaur','florafae']])for(const id of teamBonds(ids))assert.ok(BONDS[id]);
  assert.equal(teamBonds(['orakyn']).includes('convergence'),false);assert.equal(teamBonds(['orakyn','lumivox']).includes('convergence'),false);
});

test('all moves have unique mechanical and visual identities',()=>{
  const mechanics=Object.values(MOVES).map(({id,owner,visual,signature,...rest})=>JSON.stringify(rest));
  assert.equal(new Set(mechanics).size,mechanics.length,'no move may be a renamed mechanical clone');
  assert.equal(new Set(Object.values(MOVES).map((move)=>move.visual)).size,72,'every move owns a visual choreography id');
});

test('every creature owns exactly one mechanically meaningful Signature',()=>{
  for(const id of CREATURE_IDS){const signatures=CREATURES[id].moves.map((moveId)=>MOVES[moveId]).filter((move)=>move.signature);assert.equal(signatures.length,1,`${id} needs one Signature`);const move=signatures[0];assert.ok(move.power>0||move.barrier||move.teamBarrier||move.teamHealRatio||move.selfStatuses?.length,`${move.id} needs a decisive effect`);}
  assert.equal(Object.values(MOVES).filter((move)=>move.signature&&move.kind!=='damage').length,7,'ultimates should include defensive and healing fantasies');
});

test('twelve trainer teams and their badges are authored and legal',()=>{
  assert.equal(TRAINERS.length,12);assert.equal(new Set(TRAINERS.map((x)=>x.id)).size,12);
  assert.equal(new Set(TRAINERS.map((trainer)=>trainer.ace)).size,12,'every rival needs a distinct ace phase');
  for(const trainer of TRAINERS){assert.equal(trainer.team.length,3);assert.equal(new Set(trainer.team).size,3);trainer.team.forEach((id)=>assert.ok(CREATURES[id]));assert.equal(trainer.colors.length,2);assert.ok(trainer.badge);assert.ok(trainer.ace);}
});

test('six mythic trials have legal teams and distinct rule sets',()=>{
  assert.equal(TRIALS.length,6);assert.equal(new Set(TRIALS.map((x)=>x.id)).size,6);
  for(const trial of TRIALS){assert.equal(trial.enemyTeam.length,3);trial.enemyTeam.forEach((id)=>assert.ok(CREATURES[id]));assert.ok(trial.modifiers.length);}
});

test('Champion Circuit rotates six conditions across all twelve rivals',()=>{
  assert.equal(CIRCUIT_CONDITIONS.length,6);assert.equal(new Set(CIRCUIT_CONDITIONS.map((item)=>item.modifiers.join(','))).size,6);
  const firstCycle=Array.from({length:12},(_,wins)=>circuitMatch(wins,TRAINERS.length));assert.equal(new Set(firstCycle.map((match)=>match.trainerIndex)).size,12);assert.equal(firstCycle[0].round,1);assert.equal(firstCycle[11].round,12);
  for(const match of firstCycle){assert.ok(TRAINERS[match.trainerIndex]);assert.ok(match.condition.modifiers.length);}
});

test('the gauntlet escalates through three legal teams and four distinct boons',()=>{
  assert.equal(GAUNTLET_STAGES.length,3);assert.equal(GAUNTLET_BOONS.length,4);assert.equal(new Set(GAUNTLET_BOONS.map((x)=>x.modifier)).size,4);
  GAUNTLET_STAGES.forEach((stage,index)=>{assert.equal(stage.enemyTeam.length,3);stage.enemyTeam.forEach((id)=>assert.ok(CREATURES[id]));if(index)assert.ok(stage.modifiers.length);});
});

test('eight signature squads are legal, distinct, and demonstrate multiple doctrines',()=>{
  assert.equal(SQUAD_PRESETS.length,8);assert.equal(new Set(SQUAD_PRESETS.map((x)=>x.team.join(','))).size,8);assert.ok(new Set(SQUAD_PRESETS.map((x)=>x.doctrine)).size>=4);
  SQUAD_PRESETS.forEach((preset)=>{assert.equal(preset.team.length,3);assert.equal(new Set(preset.team).size,3);preset.team.forEach((id)=>assert.ok(CREATURES[id]));assert.ok(preset.team[preset.lead]);});
});

test('the Team Compass exposes bounded and distinct squad identities',()=>{
  for(const preset of SQUAD_PRESETS){const profile=teamProfile(preset.team);assert.ok(PROFILE_AXES.includes(profile.dominant));for(const axis of PROFILE_AXES)assert.ok(profile[axis]>=0&&profile[axis]<=100,`${preset.id} ${axis} must fit the compass`);}
  assert.equal(teamProfile(['ferrax','pyrolynx','riptalon']).dominant,'tempo');
  assert.equal(teamProfile(['florafae','thornox','mnemora']).dominant,'control');
  assert.equal(teamProfile(['orakyn','abyssar','virelia']).dominant,'sustain');
  assert.deepEqual(teamProfile([]),{pressure:0,control:0,sustain:0,tempo:0,dominant:'pressure'});
  assert.equal(recommendedDoctrine(['ferrax','pyrolynx','riptalon']),'ambush');
});

test('smart remix builds deterministic tactical trios and scouts their lead',()=>{
  const enemy=['kordane','calderoc','farfombre'],first=remixTeam(enemy,101),repeat=remixTeam(enemy,101),alternatives=new Set(Array.from({length:8},(_,seed)=>remixTeam(enemy,seed+200).team.join(',')));
  assert.deepEqual(first,repeat);assert.equal(first.team.length,3);assert.equal(new Set(first.team).size,3);first.team.forEach((id)=>assert.ok(CREATURES[id]));assert.equal(first.lead,bestLeadIndex(first.team,enemy));assert.equal(first.doctrine,recommendedDoctrine(first.team));assert.ok(alternatives.size>=3,'different remix seeds should explore the roster');
});

test('six quick battle rules are symmetric, distinct, and engine-backed',()=>{
  assert.equal(QUICK_RULES.length,6);assert.equal(new Set(QUICK_RULES.map((rule)=>rule.modifiers.join(','))).size,6);assert.equal(quickRule('missing').id,'standard');
  const fortress=createBattle({playerTeam:['orakyn','abyssar','virelia'],enemyTeam:['kordane','calderoc','farfombre'],modifiers:quickRule('fortress_duel').modifiers});
  assert.ok(fortress.sides.player.team.every((creature)=>creature.barrier>=18));assert.ok(fortress.sides.enemy.team.every((creature)=>creature.barrier>=18));
  const storm=createBattle({playerTeam:['orakyn','abyssar','virelia'],enemyTeam:['kordane','calderoc','farfombre'],modifiers:quickRule('starstorm').modifiers});assert.equal(storm.sides.player.surge,100);assert.equal(storm.sides.enemy.surge,100);
  const relay=createBattle({playerTeam:['orakyn','abyssar','virelia'],enemyTeam:['kordane','calderoc','farfombre'],modifiers:quickRule('relay_rush').modifiers}),before=relay.sides.player.surge,switched=resolveTurn(relay,{type:'switch',index:1},{type:'move',moveId:'crystal_strike'});assert.ok(switched.state.sides.player.surge>=before+24);assert.ok(switched.state.sides.player.team[1].statuses.haste);
});

test('five combat contracts track only their intended semantic events',()=>{
  assert.equal(CONTRACTS.length,5);const history=[{type:'damage',sourceSide:'player',amount:60},{type:'damage',sourceSide:'enemy',amount:90},{type:'status',side:'enemy',applied:true},{type:'surge',side:'player',source:'signature'},{type:'heal',side:'player',amount:20},{type:'barrier-hit',side:'player',amount:15},{type:'switch',side:'player'}];
  assert.equal(contractProgress('onslaught',history),60);assert.equal(contractProgress('tactician',history),1);assert.equal(contractProgress('signature',history),1);assert.equal(contractProgress('guardian',history),35);assert.equal(contractProgress('relay',history),1);
});

test('team combo routes expose cross-creature setups and never self-credit',()=>{const routes=teamComboRoutes(['orakyn','pyrolynx','virelia']);assert.ok(routes.some((route)=>route.setterId==='orakyn'&&route.finisherId==='pyrolynx'&&route.statuses.includes('marked')));assert.ok(routes.every((route)=>route.setterId!==route.finisherId));assert.deepEqual(teamComboRoutes(['kordane','monolith','virelia']),[]);});

test('every AI difficulty always chooses legal actions without mutating state',()=>{
  const state=createBattle({playerTeam:['orakyn','abyssar','virelia'],enemyTeam:['kordane','calderoc','farfombre'],seed:91});const before=structuredClone(state);
  for(const difficulty of ['apprentice','challenger','champion'])for(const style of ['direct','speed','endurance','control','pressure','deception','champion']){const action=chooseAiAction(state,'enemy',difficulty,style);assert.ok(getLegalActions(state,'enemy').some((x)=>JSON.stringify(x)===JSON.stringify(action)));}
  assert.deepEqual(state,before);
  assert.equal('playerAction' in state,false);
});

test('Champion AI saves defensive Signatures for genuine team pressure',()=>{
  const state=createBattle({playerTeam:['virelia','abyssar','orakyn'],enemyTeam:['kordane','calderoc','farfombre'],seed:92});state.sides.player.surge=100;state.sides.player.team.forEach((creature)=>creature.hp=Math.round(creature.maxHp*.5));state.sides.player.team[1].statuses.slowed={remaining:2,appliedTurn:state.turn,stacks:1};const before=structuredClone(state),action=chooseAiAction(state,'player','champion','endurance');assert.deepEqual(action,{type:'move',moveId:'leaf_mantle'});assert.deepEqual(state,before);
});

test('Champion AI can pivot into a resistant bench answer to a ready Signature',()=>{
  const state=createBattle({playerTeam:['lumivox','abyssar','virelia'],enemyTeam:['orakyn','prismage','farfombre'],seed:13});state.sides.player.surge=100;const before=structuredClone(state),challenger=chooseAiAction(state,'enemy','challenger','direct'),champion=chooseAiAction(state,'enemy','champion','direct');assert.deepEqual(challenger,{type:'move',moveId:'lucid_arc'});assert.deepEqual(champion,{type:'switch',index:2});assert.equal(state.sides.enemy.team[champion.index].id,'farfombre');assert.deepEqual(state,before);
});

test('Challenger AI recognizes the extra tempo of Relay Rush',()=>{
  const config={playerTeam:['orakyn','abyssar','virelia'],enemyTeam:['kordane','riptalon','solflare'],seed:44},standard=createBattle(config),relay=createBattle({...config,modifiers:['relay_fever']}),before=structuredClone(relay);assert.deepEqual(chooseAiAction(standard,'enemy','challenger','direct'),{type:'move',moveId:'resonant_focus'});assert.deepEqual(chooseAiAction(relay,'enemy','challenger','direct'),{type:'switch',index:1});assert.deepEqual(relay,before);
});

test('Challenger AI rotates its kit to cash out a Flow crescendo',()=>{
  const state=createBattle({playerTeam:['monolith','mossaur','abyssar'],enemyTeam:['orakyn','abyssar','virelia'],seed:51});assert.deepEqual(chooseAiAction(state,'enemy','challenger','direct'),{type:'move',moveId:'lucid_arc'});state.sides.enemy.lastMoveId='lucid_arc';state.sides.enemy.flow=2;const before=structuredClone(state);assert.deepEqual(chooseAiAction(state,'enemy','challenger','direct'),{type:'move',moveId:'slowing_riddle'});assert.deepEqual(state,before);
});
