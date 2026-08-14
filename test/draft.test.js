import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraft, dailyDraftSeed } from '../src/data/draft.js';
import { CREATURE_IDS } from '../src/data/creatures.js';

test('daily draft is deterministic, legal, and offers twelve distinct creatures',()=>{
  const first=createDraft(20260814),again=createDraft(20260814),other=createDraft(20260815);assert.deepEqual(first,again);assert.notDeepEqual(first,other);
  const ids=[...first.offers.flat(),...first.enemyTeam];assert.equal(ids.length,12);assert.equal(new Set(ids).size,12);assert.ok(ids.every((id)=>CREATURE_IDS.includes(id)));assert.equal(first.offers.length,3);assert.ok(first.offers.every((offer)=>offer.length===3));
});

test('daily seed changes only at UTC day boundaries',()=>{assert.equal(dailyDraftSeed(Date.UTC(2026,7,14,3)),dailyDraftSeed(Date.UTC(2026,7,14,23)));assert.equal(dailyDraftSeed(Date.UTC(2026,7,15)),dailyDraftSeed(Date.UTC(2026,7,14))+1);});
