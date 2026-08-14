// The post-League endgame remixes authored rivals through escalating arena
// conditions. Rival and condition cycles are coprime, so all combinations
// rotate before the schedule repeats.
export const CIRCUIT_CONDITIONS=Object.freeze([
  {id:'starstorm',icon:'✦',modifiers:['overdrive']},
  {id:'razorline',icon:'ϟ',modifiers:['high_voltage']},
  {id:'citadel',icon:'⬢',modifiers:['enemy_aegis']},
  {id:'awakening',icon:'◎',modifiers:['rapid_arena']},
  {id:'lastlight',icon:'☾',modifiers:['player_wounded']},
  {id:'ascension',icon:'♛',modifiers:['ascendant']},
]);

export function circuitMatch(wins=0,trainerCount=12){
  const round=Math.max(0,Math.floor(Number(wins)||0));
  return{round:round+1,trainerIndex:(round*5+2)%trainerCount,condition:CIRCUIT_CONDITIONS[round%CIRCUIT_CONDITIONS.length]};
}
