import { CREATURES } from './creatures.js';

export const BONDS=Object.freeze({
  harmony:{icon:'◇'}, convergence:{icon:'◎'}, bulwark:{icon:'⬡'}, huntpack:{icon:'»'}, spellweave:{icon:'☿'},
});

const BULWARK_ROLES=new Set(['tank','vanguard','sentinel','healer','support']);
const HUNTER_ROLES=new Set(['assassin','duelist','berserker']);
const WEAVER_ROLES=new Set(['controller','mystic','disruptor','maestro']);

export function teamBonds(ids){
  const team=ids.map((id)=>CREATURES[id]),affinities=new Set(team.map((c)=>c.affinity)),roles=team.map((c)=>c.role),bonds=[];
  if(team.length===3&&affinities.size===3)bonds.push('harmony');
  if(team.length===3&&affinities.size===1)bonds.push('convergence');
  if(roles.filter((role)=>BULWARK_ROLES.has(role)).length>=2)bonds.push('bulwark');
  if(roles.filter((role)=>HUNTER_ROLES.has(role)).length>=2)bonds.push('huntpack');
  if(roles.filter((role)=>WEAVER_ROLES.has(role)).length>=2)bonds.push('spellweave');
  return bonds;
}
