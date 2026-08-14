import { CREATURE_IDS } from './data/creatures.js';
import { FEAT_IDS } from './data/progression.js';
import { TRIAL_IDS } from './data/trials.js';

export const SAVE_KEY = 'arene-de-noam-save';
export const SAVE_VERSION = 12;
export const DEFAULT_SAVE = Object.freeze({ version:SAVE_VERSION, tutorialComplete:false, ladderVictories:0, emblems:[], cosmetics:['crystal'], mastery:{}, records:{}, customSquads:[null,null,null], feats:[], trials:[], gauntletWins:0, draftWins:0, circuitWins:0, contractsCompleted:0, bestGrade:null, battlesPlayed:0, wins:0, winStreak:0, bestStreak:0, lastTeam:['orakyn','abyssar','virelia'], difficulty:'apprentice', language:'fr', muted:false, volume:0.7, reducedMotion:false, highContrast:false, battleSpeed:1 });

function validTeam(team) { return Array.isArray(team) && team.length===3 && new Set(team).size===3 && team.every((id)=>CREATURE_IDS.includes(id)); }
export function validateSave(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.version > SAVE_VERSION) return null;
  const migrated = value.version === 1 ? { ...value, version:SAVE_VERSION, cosmetics:value.cosmetics || ['crystal'] } : { ...value, version:SAVE_VERSION };
  const mastery={};if(migrated.mastery&&typeof migrated.mastery==='object')for(const id of CREATURE_IDS){const xp=migrated.mastery[id];if(Number.isInteger(xp)&&xp>0)mastery[id]=Math.min(999,xp);}
  const records={};if(migrated.records&&typeof migrated.records==='object')for(const id of CREATURE_IDS){const source=migrated.records[id];if(!source||typeof source!=='object')continue;const bounded=(key,max)=>Number.isInteger(source[key])?Math.min(max,Math.max(0,source[key])):0;const record={battles:bounded('battles',99999),wins:bounded('wins',99999),damage:bounded('damage',9999999),kos:bounded('kos',99999),signatures:bounded('signatures',99999),assists:bounded('assists',99999)};if(Object.values(record).some(Boolean))records[id]=record;}
  const customSquads=Array.from({length:3},(_,index)=>{const squad=Array.isArray(migrated.customSquads)?migrated.customSquads[index]:null;if(!squad||!validTeam(squad.team))return null;return{team:[...squad.team],lead:Number.isInteger(squad.lead)&&squad.lead>=0&&squad.lead<3?squad.lead:0,doctrine:['balanced','assault','bastion','ambush'].includes(squad.doctrine)?squad.doctrine:'balanced'};});
  const winStreak=Number.isInteger(migrated.winStreak)?Math.min(9999,Math.max(0,migrated.winStreak)):0,bestStreak=Math.max(winStreak,Number.isInteger(migrated.bestStreak)?Math.min(9999,Math.max(0,migrated.bestStreak)):0);
  return {
    ...DEFAULT_SAVE,
    version:SAVE_VERSION,
    tutorialComplete:Boolean(migrated.tutorialComplete),
    ladderVictories:Number.isInteger(migrated.ladderVictories) ? Math.min(12,Math.max(0,migrated.ladderVictories)) : 0,
    emblems:Array.isArray(migrated.emblems) ? [...new Set(migrated.emblems.filter((x)=>typeof x==='string'))].slice(0,12) : [],
    cosmetics:Array.isArray(migrated.cosmetics) ? [...new Set(migrated.cosmetics.filter((x)=>['crystal','grove','tidal','volcano','astral','eclipse'].includes(x)))] : ['crystal'],
    mastery,
    records,
    customSquads,
    feats:Array.isArray(migrated.feats) ? [...new Set(migrated.feats.filter((x)=>FEAT_IDS.includes(x)))] : [],
    trials:Array.isArray(migrated.trials) ? [...new Set(migrated.trials.filter((x)=>TRIAL_IDS.includes(x)))] : [],
    gauntletWins:Number.isInteger(migrated.gauntletWins)?Math.min(999,Math.max(0,migrated.gauntletWins)):0,
    draftWins:Number.isInteger(migrated.draftWins)?Math.min(9999,Math.max(0,migrated.draftWins)):0,
    circuitWins:Number.isInteger(migrated.circuitWins)?Math.min(9999,Math.max(0,migrated.circuitWins)):0,
    contractsCompleted:Number.isInteger(migrated.contractsCompleted)?Math.min(9999,Math.max(0,migrated.contractsCompleted)):0,
    bestGrade:['D','C','B','A','S'].includes(migrated.bestGrade)?migrated.bestGrade:null,
    battlesPlayed:Number.isInteger(migrated.battlesPlayed)?Math.min(9999,Math.max(0,migrated.battlesPlayed)):0,
    wins:Number.isInteger(migrated.wins)?Math.min(9999,Math.max(0,migrated.wins)):0,
    winStreak,bestStreak,
    lastTeam:validTeam(migrated.lastTeam) ? [...migrated.lastTeam] : [...DEFAULT_SAVE.lastTeam],
    difficulty:['apprentice','challenger','champion'].includes(migrated.difficulty) ? migrated.difficulty : 'apprentice',
    language:migrated.language === 'en' ? 'en' : 'fr',
    muted:Boolean(migrated.muted), volume:Number.isFinite(migrated.volume) ? Math.min(1,Math.max(0,migrated.volume)) : .7,
    reducedMotion:Boolean(migrated.reducedMotion), highContrast:Boolean(migrated.highContrast), battleSpeed:migrated.battleSpeed === 2 ? 2 : 1,
  };
}

export function loadSave(storage=globalThis.localStorage) {
  try {
    const raw=storage?.getItem(SAVE_KEY); if (!raw) return { save:{...DEFAULT_SAVE,lastTeam:[...DEFAULT_SAVE.lastTeam],emblems:[],cosmetics:['crystal'],mastery:{},records:{},feats:[],trials:[]}, notice:null };
    const parsed=JSON.parse(raw); const save=validateSave(parsed);
    if (!save) return { save:{...DEFAULT_SAVE,lastTeam:[...DEFAULT_SAVE.lastTeam],emblems:[],cosmetics:['crystal'],mastery:{},records:{},feats:[],trials:[]}, notice:parsed?.version>SAVE_VERSION?'future':'corrupt' };
    return { save, notice:null };
  } catch { return { save:{...DEFAULT_SAVE,lastTeam:[...DEFAULT_SAVE.lastTeam],emblems:[],cosmetics:['crystal'],mastery:{},records:{},feats:[],trials:[]}, notice:'corrupt' }; }
}

export function persistSave(save, storage=globalThis.localStorage) { const safe=validateSave(save); if (!safe) return false; try { storage?.setItem(SAVE_KEY,JSON.stringify(safe)); return true; } catch { return false; } }
