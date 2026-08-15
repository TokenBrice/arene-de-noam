# Battle and authored-content contract

This document describes the executable contract in [`src/battle/`](../src/battle) and the data it consumes. Player-facing summaries remain in the root [`README.md`](../README.md).

## Public engine API

The main API in [`engine.js`](../src/battle/engine.js) is:

| Function | Contract |
| --- | --- |
| `createBattle(config)` | Validates distinct 2- or 3-creature teams and returns initial state. Shipped modes use 3v3. |
| `getLegalActions(state, side)` | Returns complete action objects for the current phase. It is the authority for UI and AI. |
| `resolveTurn(state, playerAction, enemyAction)` | Validates both actions, clones input, resolves one turn, and returns `{ state, events }`. |
| `applyReplacement(state, side, action)` | Applies one free required replacement without normal switch rewards. |
| `canUseTrainerCommand` / `applyTrainerCommand` | Checks/applies the once-per-battle Coach command without consuming the turn action. |
| `previewMove(...)` | Runs the real damage transaction against a clone; returns exact damage/barrier/combo/lethality data. |
| `previewIncomingAfterSwitch(...)` | Applies the switch and entry talent to a clone before previewing the incoming move. |
| `previewAllySwitch(...)` | Describes the target/value of an ally-switch move. |
| `previewMoveOrder(...)` | Compares priority, then effective Speed; reports a tie without consuming RNG. |
| `activeOf`, `consciousIndices`, `signatureCostFor` | Shared state queries used by engine, AI, and UI. |

Do not mutate an input state or create an approximate UI-only calculator. Preview/live parity is a tested product guarantee.

## Battle state

Stable state shape, omitting authored creature fields copied into each combatant:

```js
{
  version: 7,
  mode, arena, modifiers, enemyAce, aceTriggered,
  turn: 1,
  phase: 'choice' | 'replacement' | 'ended',
  winner: null | 'player' | 'enemy',
  reason: null | 'knockout' | 'turn-cap',
  rngState,
  sides: {
    player: Side,
    enemy: Side
  },
  history: Event[],
  queuedRelays: {}
}

Side = {
  team: Combatant[],
  active: number,
  pendingReplacement: boolean,
  surge: number,
  commandUsed: boolean
}

Combatant = {
  ...CREATURES[id],
  hp, barrier,
  statuses: { [statusId]: { appliedTurn, stacks, remaining?, sourceCreatureId? } },
  cooldowns: { [moveId]: { appliedTurn, remaining } },
  talent: {} // per-battle passive trigger bookkeeping
}
```

`history` is the canonical audit log used for playback, results, records, and feat signals. Each emitted event is stamped with the turn that produced it before being appended.

## Action shapes and legality

```js
{ type: 'move', moveId }
{ type: 'move', moveId, allyIndex } // only for allySwitch moves
{ type: 'switch', index }
{ type: 'replace', index }
```

During `choice`, an active conscious creature may use a move when its cooldown is zero and, for a Signature, shared team Surge meets `signatureCostFor(active)`. Voluntary switching and ally-switch moves are unavailable while Rooted, except for the `ancient_roots` passive. Targets must be conscious bench allies.

During `replacement`, only `replace` actions to conscious bench members are legal for a side whose `pendingReplacement` flag is set. During `ended` or non-owning phases there are no legal actions.

Always pass the full action returned by `getLegalActions`; ally-targeted moves are distinguished by `allyIndex`.

## One-turn resolution order

`resolveTurn` performs these steps in order:

1. Reject non-`choice` state or either illegal action.
2. Clone the input state.
3. Resolve both voluntary switches before any move. A normal switch grants `+10` Surge, triggers entry talents, and can receive the opponent's already chosen move.
4. Sort move actions by higher `priority`, then higher effective Speed, then a seeded RNG tie-break.
5. If a damage move targets a creature that just switched in and the final matchup is resisted (`0.5x`), emit Perfect Relay and grant that defender `+6` Surge.
6. Execute moves in order. A user that was K.O.'d before acting emits `move-skip`; it does not act.
7. After both actions, resolve queued ally-switch moves. These protected relays occur after actions and do not grant normal switch rewards.
8. Tick end-of-turn effects, timed statuses, and cooldowns; then apply the arena pulse when due.
9. End on total K.O.; otherwise end at turn 40 using conscious count, then summed HP ratios, then seeded RNG.
10. If continuing, increment the turn and enter `replacement` when either active creature is K.O.'d, otherwise `choice`.

A K.O. replacement is free: no voluntary-switch Surge or other switch reward. Enemy replacement is chosen before the player replacement UI in the controller.

## Damage and affinity

Base damage in [`damage.js`](../src/battle/damage.js) is:

```text
round((move power * attacker Attack / defender Guard)
      * 0.89
      * affinity
      * status/bonus multipliers)
```

The result is at least `1`. Focused multiplies damage by `1.3`; Stunned multiplies outgoing damage by `0.75`. Move-specific scaling and passives are applied to power in `engine.js` before this formula. Multi-hit moves repeat the same transaction while allowing between-hit barriers/survival passives to trigger.

Types are two independent directed triangles:

```text
tide -> flame -> grove -> tide
mind -> force -> shadow -> mind
```

Following an arrow is `2x`, reversing it is `0.5x`, and same-type/cross-triangle/neutral attacks are `1x`. Legacy ids (`tide`, `flame`, `grove`, `mind`, `force`, `shadow`) are persistent code and asset identifiers; do not rename them for display terminology.

Barriers absorb incoming damage before HP up to a global cap of `35`. Only direct HP loss feeds defensive Surge. `ignoreBarrier` bypasses the barrier without consuming it; purge mechanics can explicitly remove positive statuses and/or barriers.

## Surge, Signatures, Coach, and switching

- Both teams normally start at `30` Surge; the gauge is clamped to `0..100`.
- Non-Signature damage action: `+20`, including a miss. Non-Signature support/heal action: `+25`.
- Taking direct HP damage: `25%` of HP lost, rounded per adjustment. Barrier absorption does not count.
- Voluntary switch: `+10`; Relay Fever changes this to `+24` and gives Haste.
- Perfect Relay: `+6` to the side that switched into a resisted predicted hit.
- Coach: `+15`, removes all active-creature penalties, once per side/battle, only when a penalty exists, and consumes no move/switch action.
- A Signature spends `100` by default. The `sunborn` passive lowers its owner's cost to `80`.
- Signatures do not also earn the normal move gain.

Surge belongs to the side, not an individual creature. Mastery, class, team composition, and switching in a different creature do not silently change combat stats or opening Surge.

## Status contract

The only statuses are defined in [`statuses.js`](../src/battle/statuses.js):

| Id | Polarity | Engine effect |
| --- | --- | --- |
| `focused` | Positive | Next landed damage action is `1.3x`; preserved if Evasive causes a miss |
| `haste` | Positive | Effective Speed is `1.2x` |
| `evasive` | Positive | Consumed to make one incoming damage action miss |
| `countering` | Positive | Consumed after direct HP damage to reflect `25%` of that damage |
| `marked` | Negative | Setup consumed by a normal Combo damage action |
| `stunned` | Negative | Effective Speed is `0.7x`; outgoing damage is `0.75x` |
| `rooted` | Negative | Blocks voluntary and ally-move switching unless `ancient_roots` |
| `burning` | Negative | Active creature loses `5%` max HP per stack at turn end; max 2 stacks |

Applying a non-stackable status refreshes to the longer remaining duration. Timed records do not decrement on their application turn. End-of-turn duration/cooldown ticking covers the whole team, while Burning damage applies only to the active creature. Cleansing removes negative statuses in the defined order; purging removes positive statuses in the defined order.

## Combo contract

[`data/combos.js`](../src/data/combos.js) is the shared definition:

- Only a damage move with `combo: true` can finish a Combo.
- The setup is `marked`, except `venom_harvest`, which consumes `burning`.
- A valid setup is consumed once at transaction start and multiplies every hit in that action by exactly `1.4`.
- Evasive misses preserve the setup because miss resolution occurs before consumption.
- Barriers do not preserve the setup.
- If another ally applied the setup, an `assist` event credits that helper. It adds no damage or Surge; saved legacy assist counts are not newly awarded.
- `teamComboRoutes(team)` reports cross-creature setup/finisher routes for selection and Draft UI; it intentionally excludes self-routes.

## Arenas, modifiers, and Ace phases

An authored arena pulses every 4 turns; `rapid_arena` changes cadence to 2:

| Arena | Symmetric pulse |
| --- | --- |
| `crystal` | Active creatures gain 5 barrier |
| `grove` | Heal active creatures for 5% max HP |
| `tidal` | Remove one penalty and add 3 barrier |
| `volcano` | Deal 5% max HP but never reduce below 1 |
| `astral` | Grant Focused, or `+15` Surge if already Focused |
| `eclipse` | Apply Marked for 3 turns if absent |

Modes pass explicit ids from `BATTLE_MODIFIERS` into `createBattle`. Modifiers change initial state, damage, arena cadence, or voluntary-switch reward; avoid mode-name conditionals inside generic mechanics.

League, Gauntlet, and Circuit battles may pass `enemyAce`. It triggers exactly once when the enemy is reduced to one conscious creature, normally as the final replacement enters. Ace effects are authored engine branches and emit an `ace` event before their semantic effect events.

## AI and determinism

[`ai.js`](../src/battle/ai.js) starts from `getLegalActions` and scores a safe clone. It supports `apprentice`, `standard`, and `champion`; legacy `challenger` maps to `standard`.

- Apprentice often selects a seeded random legal action and exposes intent.
- Standard uses tactical scoring with intentional imperfection and no hypothetical opponent-response forecast.
- Champion evaluates reply damage and stronger switch/signature counterplay.
- Trainer `style` adjusts scoring, not legality or engine rules.

AI must not mutate supplied state except advancing its deterministic `rngState` cursor. Replaying the same state/seed and decision sequence must produce the same actions and battle.

The UI caches a planned enemy action against the exact state object so every intent/forecast consumer and `resolveTurn` use the same commitment. Do not independently ask the AI for multiple versions of one turn's action.

## Events are the presentation/progression protocol

The engine emits semantic events such as:

```text
move-start, damage, heal, status, barrier, barrier-hit, barrier-break,
miss, recoil, status-tick, surge, assist, passive, trainer-command,
perfect-relay, switch, replace, move-skip, ko, arena-pulse, ace, battle-end
```

Payloads carry causal ids/sides and the resulting values needed by consumers: for example damage contains source/target, HP, raw and absorbed damage, hit count, affinity, and Combo metadata. Playback, the 40-entry visible chronicle, result records, advice, and feat signals all depend on these events.

When adding a mechanic:

1. Emit enough semantic information at the exact resolution point.
2. Stamp it through the normal engine return path and retain it in `state.history`.
3. Teach playback/logging/results only what they need; do not reverse-engineer cause from final state.
4. Add engine assertions for state and event ordering.

## Authored data schemas and invariants

Creature entries in [`data/creatures.js`](../src/data/creatures.js) use:

```js
{ id, affinity, classId, passive, maxHp, attack, guard, speed, moves: [id, id, id] }
```

Move entries in [`data/moves.js`](../src/data/moves.js) always carry:

```js
{ id, owner, affinity, kind: 'damage' | 'support' | 'heal', power,
  priority, cooldown, visual }
```

Optional mechanics include `hits`, `signature`, `combo`, status descriptor arrays, barrier/heal/team effects, cleanse/purge, drain/recoil, barrier bypass, execute thresholds, one of the supported `scaling` values, and `allySwitch`. Status descriptors use `{ id, duration? }`; Burning may also use `stacks` at runtime. `allySwitch` configuration owns its timing, cleanse, and incoming statuses.

Tests enforce these content laws:

- Exactly 30 creatures, balanced five per affinity, and 90 moves.
- Exactly three distinct owner moves and one distinct passive per creature.
- Exactly one meaningful Signature per creature.
- Six descriptive classes; classes never modify combat.
- Every move has a unique mechanical fingerprint, unique `visual`, and move-specific CSS selector.
- Only the eight defined statuses appear in move data.
- Trainer/mode teams, modifiers, arenas, and difficulty ids are legal and complete.
- Sustain values, presentation colors/SVGs, translations, and animation coverage stay within authored contracts.

Adding or changing combat content normally requires coordinated edits to creature/move/passive data, French and English name/effect/lore keys, move FX/CSS, data/engine tests, presentation-contract expectations, and the deterministic balance simulation.
