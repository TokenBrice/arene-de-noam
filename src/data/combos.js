import { CREATURES } from './creatures.js';
import { MOVES } from './moves.js';

export function teamComboRoutes(team=[]){
  const routes=[];
  for(const setterId of team){
    for(const setupMoveId of CREATURES[setterId]?.moves||[]){
      const setup=MOVES[setupMoveId],statuses=(setup.targetStatuses||[]).map((status)=>status.id);if(!statuses.length)continue;
      for(const finisherId of team){if(finisherId===setterId)continue;
        for(const finishMoveId of CREATURES[finisherId]?.moves||[]){
          const finish=MOVES[finishMoveId],triggers=[...(finish.bonusAgainst||[]),...(finish.detonate||[])],links=statuses.filter((status)=>triggers.includes(status));if(!links.length)continue;
          routes.push({setterId,setupMoveId,finisherId,finishMoveId,statuses:links,detonation:Boolean(finish.detonate?.some((status)=>links.includes(status))),signature:Boolean(finish.signature)});
        }
      }
    }
  }
  return routes.sort((a,b)=>Number(b.detonation)-Number(a.detonation)||Number(b.signature)-Number(a.signature)||a.setupMoveId.localeCompare(b.setupMoveId));
}
