// Result-screen coaching is derived only from semantic battle history. Keeping
// it deterministic makes the advice testable and prevents vague canned tips.
export function battleAdviceKeys(state,win=false){
  if(win||!state?.history)return[];const history=state.history,playerMoves=history.filter((event)=>event.type==='move-start'&&event.side==='player'),damage=history.filter((event)=>event.type==='damage'&&event.sourceSide==='player'),tips=[];
  const add=(key)=>{if(!tips.includes(key))tips.push(key);};
  if(state.aceTriggered)add('ace');
  if(damage.length&&damage.filter((event)=>event.affinity===.75).length/damage.length>=.25)add('affinity');
  if(state.turn>=5&&!history.some((event)=>event.type==='switch'&&event.side==='player'))add('switch');
  if(history.filter((event)=>event.type==='status'&&event.side==='player'&&event.applied).length>=4)add('cleanse');
  if(history.filter((event)=>event.type==='barrier-hit'&&event.side==='enemy').reduce((sum,event)=>sum+event.amount,0)>=24)add('barrier');
  if(damage.length>=4&&!damage.some((event)=>event.combo?.length))add('combo');
  if(state.turn>=8&&!playerMoves.some((event)=>event.moveId&&event.moveId.includes('signature'))&&!history.some((event)=>event.type==='surge'&&event.side==='player'&&event.source==='signature'))add('surge');
  if(!tips.length)add('tempo');return tips.slice(0,2);
}
