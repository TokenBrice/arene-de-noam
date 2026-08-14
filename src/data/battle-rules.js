// Optional, symmetric Quick Battle rules. They reuse the same modifier
// pipeline as Trials so sandbox battles remain fully deterministic.
export const QUICK_RULES=Object.freeze([
  {id:'standard',icon:'◇',modifiers:[]},
  {id:'starstorm',icon:'✦',modifiers:['overdrive']},
  {id:'high_voltage',icon:'ϟ',modifiers:['high_voltage']},
  {id:'pulse_rush',icon:'◎',modifiers:['rapid_arena']},
  {id:'fortress_duel',icon:'⬡',modifiers:['dual_aegis']},
  {id:'relay_rush',icon:'↺',modifiers:['relay_fever']},
]);

export function quickRule(id){return QUICK_RULES.find((rule)=>rule.id===id)||QUICK_RULES[0];}
