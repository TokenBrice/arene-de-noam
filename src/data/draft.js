import { CREATURE_IDS } from './creatures.js';
import { normalizeSeed, randomIndex } from '../battle/rng.js';

const DRAFT_ARENAS = Object.freeze(['crystal', 'grove', 'tidal', 'volcano', 'astral', 'eclipse']);

export function createDraft(seed = 1) {
  let state = normalizeSeed(seed),
    pool = [...CREATURE_IDS],
    order = [];
  while (pool.length) {
    const pick = randomIndex(state, pool.length);
    state = pick.state;
    order.push(...pool.splice(pick.index, 1));
  }
  const offers = [order.slice(0, 3), order.slice(3, 6), order.slice(6, 9)];
  return Object.freeze({
    seed: normalizeSeed(seed),
    offers: Object.freeze(offers.map((offer) => Object.freeze(offer))),
    enemyTeam: Object.freeze(order.slice(9, 12)),
    arena: DRAFT_ARENAS[state % DRAFT_ARENAS.length],
    trainerIndex: 6 + (state % 5),
  });
}

export function dailyDraftSeed(now = Date.now()) {
  return Math.floor(Number(now) / 86400000) >>> 0;
}
