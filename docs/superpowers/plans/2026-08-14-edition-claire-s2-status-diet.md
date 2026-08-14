# Arène de Noam — Édition claire S2: status diet implementation plan

> **Planning baseline:** repository structure inspected on 2026-08-14. Stage 1 is changing numbers concurrently; the line references and property names below are current, but all pre-existing damage/heal/barrier totals are provisional. Preserve Stage 1's settled numbers and apply only the explicitly described S2 deltas.

**Goal:** Replace the current 21-status vocabulary with eight mechanically distinct statuses, remove late-turn pressure completely, keep preview/live resolution identical, and leave the balance and naive-player gates enforceable.

**In scope:** status definitions and semantics, all status-producing/consuming move data, engine/AI/passive/Ace integrations, combo/profile data, localization, dead-id playback safety, tests, and balance-harness cleanup.

**Out of scope:** S4's visual redesign of HUD/FX/Academy/Bestiary. This plan records those touchpoints. S2 may make the smallest dead-id safety edits needed to prevent runtime errors, but should not redesign presentation.

## 1. Locked status contract

### 1.1 The eight surviving internal ids

Keep existing English internal ids to minimize migration surface. Do not add aliases for deleted ids: stale references must fail through `applyStatus()`'s existing unknown-status error.

| Surviving id | FR / EN label | Polarity | Exact S2 behavior | Definition metadata |
|---|---|---:|---|---|
| `focused` | Concentré / Focused | positive | The next **damaging move** that connects deals ×1.30 damage for the whole move transaction, then consumes Focused. A miss does not consume it. | Existing `◎`, `#ffd66b`; binary. |
| `haste` | Accéléré / Haste | positive | Effective speed ×1.20 while present. Binary: reapplication refreshes duration but never adds a stack. | Existing `»`, `#fff38a`; remove `stackable` and `maxStacks`. |
| `evasive` | Insaisissable / Evasive | positive | The next targeted damaging move misses and consumes Evasive before any setup token is consumed. | Existing `◇`, `#d7c1ff`; binary. |
| `countering` | Riposte / Counter | positive | After the next direct damaging move causes HP damage, its attacker takes 25% of that move's actual HP damage (round, minimum 1); consume Riposte. Do not trigger on DoT, arena damage, recoil, or barrier-only contact. | Existing `↶`, `#ffcf70`; binary. |
| `marked` | Marqué / Marked | negative | The next connected damaging move receives ×1.35 on its **first hit only**, then consumes Marked. A miss does not consume it; a barrier may absorb the amplified hit. Preserve `sourceCreatureId` so allied setup still awards Assist. | Existing `⌖`, `#ff7fb7`; binary. |
| `stunned` | Sonné / Dazed | negative | While present: damage dealt ×0.75 and effective speed ×0.70. It never skips a turn and never blocks support moves. Binary; reapplication refreshes duration. | Existing `★`, `#ffe36e`; binary. |
| `rooted` | Enraciné / Rooted | negative | Prevents voluntary switching. Forced replacement remains legal. A creature with `ancient_roots` cannot receive this status. | Existing `♧`, `#7bd178`; binary. |
| `burning` | Brûlure / Burning | negative | At active-fighter end of turn, lose 5% max HP per stack. It is the only stackable status, maximum two stacks. It can knock out, as current DoT can. Reapplication adds one stack up to two and refreshes duration. | Existing `♨`, `#ff684d`; `stackable: true`, `maxStacks: 2`. |

Why these numbers:

- `marked` uses ×1.35: it preserves the old Soaked setup's 1.35-sized payoff, is less explosive than the old ×1.45 Marked route, and supplies one universal number instead of stacking a global modifier with authored `bonusAgainst`/detonation multipliers.
- `stunned` uses 25% less damage and 30% less speed: it is strong enough to replace Weakened/Slowed/Drowsy/Stunned without inheriting hard silence or turn denial.
- `countering` uses 25%: it lies between recurring Thorns (18%) and one-shot Countering (35%), while the merged result is always one-shot.
- `burning` uses 5% per stack: one fixed, kid-readable tick near current Burning (5.5%), with a hard 10% ceiling instead of three differently tuned DoTs.

### 1.2 Complete old-to-new id mapping

| Old id | New id or numeric effect | Semantic decision |
|---|---|---|
| `focused` | `focused` | Keep; ×1.30 next connected damaging move, whole transaction. |
| `guarded` | no status; +8 barrier | Remove every descriptor. Add eight barrier points to the same recipient at grant time, capped by the existing barrier cap. Apply `+8` relative to Stage 1's final barrier value, not today's provisional total. |
| `haste` | `haste` | Keep; binary ×1.20 speed. Remove all stack counts. |
| `regenerating` | no status; immediate 8% max-HP heal | Remove recurring ticks. At each former grant site, heal immediately for 8% max HP; combine additively with an existing self `healRatio`. |
| `evasive` | `evasive` | Keep unchanged. |
| `countering` | `countering` | Keep id; adopt merged 25% one-shot Riposte semantics. |
| `thorns` | `countering` | Convert every status grant to one Riposte. The separate `bramblehide` passive remains a recurring 6% passive reflect and is not a status. |
| `anchored` | no status | Delete move/Ace grants. `ancient_roots` becomes immunity to Rooted only; it no longer ignores Sonné. |
| `exposed` | `marked` | Self-Exposed becomes self-Marked; target Exposed becomes target Marked. |
| `marked` | `marked` | Keep id, replace persistent 1.12 plus authored ×1.45 routes with the single ×1.35 first-hit token. |
| `soaked` | `marked` | Convert setters to Marked. Remove the water-specific speed penalty and lightning-specific payoff. |
| `charged` | `marked` | Convert setters to Marked. Remove the electrical detonation taxonomy. |
| `slowed` | `stunned` | Convert to Sonné, keeping authored duration. |
| `weakened` | `stunned` | Convert to Sonné, keeping authored duration. |
| `stunned` | `stunned` | Keep id, use unified ×0.75 damage/×0.70 speed and no turn skip. |
| `drowsy` | `stunned` | Convert to Sonné, keeping authored duration. |
| `silenced` | `stunned` | Convert to Sonné, but remove support-move blocking. |
| `rooted` | `rooted` | Keep. |
| `burning` | `burning` | Keep; normalize to 5%, max two. |
| `poisoned` | `burning` | Convert setters/consumers to Burning. |
| `cursed` | `burning` | Convert setters to Burning. The synthetic late-turn Curse is deleted with late pressure. |

### 1.3 Collision and cleanse rules

- When one move currently applies multiple old ids that map to the same new id, author exactly one descriptor using the **longest** old duration. This prevents `forgotten_name` and `midnight_lullaby` from applying Sonné twice and accidentally retaining the last/shorter duration.
- Marked is the only universal setup modifier. Remove move-specific Marked bonuses and Charged/Soaked detonations so it cannot double-dip. A Marked target's `sourceCreatureId` produces one Assist event and +8 Surge when a different ally consumes it.
- `venom_harvest` may continue to detonate `burning`; this is a move mechanic on a surviving DoT, not a ninth status. Its detonation consumes the whole Burning record once, irrespective of stack count, while normal tick damage still uses stacks.
- “Cleanse” means “remove one penalty.” Change every self cleanse of `2`/`'all'` and Ace cleanse of `2`/`'all'` to one. Existing `teamCleanse: 1` remains one per conscious ally. The tidal arena already removes one.
- Opponent boost removal may remain `purge` internally because polarity is cheap there, but never expose the words “purge/cleanse positive/negative” in UI copy. Say “remove one penalty” for self/team cleanup and “remove boosts” for opponent removal. `spectrum_break` can still remove two boosts and `supernova` all boosts unless balance gates demand later tuning.

## 2. File-by-file implementation map

### `src/battle/statuses.js`

Current anchors: `STATUS_DEFINITIONS` lines 1–23; polarity arrays 25–30; `applyStatus` 39–51; cleanse/purge helpers 53–71; `effectiveSpeed` 74–82.

1. Replace the definition object with exactly the eight ids above, in this stable order: four positives (`focused`, `haste`, `evasive`, `countering`) then four penalties (`marked`, `stunned`, `rooted`, `burning`). Only `burning` has `stackable/maxStacks`, set to two.
2. Keep internal polarity arrays and `cleanse`/`purge` helpers; they are implementation details. Add no public “boon purge” vocabulary.
3. Keep `applyStatus`'s unknown-id error. Binary Haste follows the existing non-stackable path (`stacks: 1`). Burning follows the existing capped addition path.
4. Replace speed branches at lines 76–80 with only `stunned ? ×0.70` and `haste ? ×1.20`. Remove Slowed, Anchored, Drowsy, Soaked, and Haste-stack math.
5. Root immunity is best enforced at the engine's descriptor application boundary, where events can also be suppressed; do not silently insert a fake `rooted` record in this module.

### `src/battle/damage.js`

Current structural anchors: status options lines 7–16 and multiplier chain 19–27. Stage 1 owns the base constant at line 30.

- Preserve Stage 1's settled affinity/base-damage numbers.
- Reduce the status options to `focused`, `marked`, `stunned`, and `bonus`.
- Multipliers: Focused ×1.30, Marked ×1.35, Sonné ×0.75. Remove `weakened`, `drowsy`, old `stunned` value, `guarded`, and `exposed` branches.
- The engine decides that `marked` is true only for hit one; `focused` and `stunned` apply to every hit in the move transaction.
- Delete the obsolete Guarded-only `ignoreGuard` option path; the two authored breakers become `ignoreBarrier` moves in data.

### `src/data/moves.js`

Apply these structural transformations. “Barrier +8” means relative to the post-Stage-1 value at execution time.

| Move id (object line; ref line) | Required S2 data |
|---|---|
| `slowing_riddle` (15; 23–25) | `slowed` → one `stunned` for 2 turns; delete its `bonusAgainst: ['marked']` and paired multiplier because Marked is already universal. |
| `oracle_veil` (28; 36–38) | Remove `guarded`, keep Focused/Evasive, barrier +8, `cleanse: 1`. |
| `finale_nova` (66; 74–75) | `bonusAgainst: ['rooted', 'stunned']`; preserve its existing multiplier. |
| `forgotten_name` (91; 99–102) | Collapse Weakened 3 + Silenced 1 into one `stunned`, duration 3. |
| `deja_vu` (105; 114–115) | Keep `countering` (now Riposte); `cleanse: 1`. |
| `refraction_lance` (120; 128) | Guarded no longer exists, so replace obsolete `ignoreGuard: true` with `ignoreBarrier: true`; this preserves the breaker fantasy against the numeric barrier that replaced Guarded. |
| `spectrum_break` (143; 151–152) | `exposed` → `marked`; keep internal two-boost removal. |
| `fault_charge` (169; 177) | Self `exposed` → self `marked`. |
| `tectonic_ram` (193; 202) | Keep id `stunned`; its meaning changes centrally. |
| `iron_resolve` (206; 214–215) | Remove `guarded`; barrier +8. |
| `momentum_claw` (242; 250) | Keep binary Haste duration 3; remove `stacks`. Its copy must no longer promise a stack per hit. |
| `gravity_fist` (268; 276) | `slowed` → `stunned`, duration 3. |
| `fortress_protocol` (279; 287–288) | Delete `anchored`; leave its barrier as the entire effect. |
| `continental_divide` (291; 299–301) | Replace obsolete `ignoreGuard` with `ignoreBarrier`; set `bonusAgainst: ['stunned']` and preserve its multiplier. |
| `undertow` (317; 325–328) | `slowed` → `stunned` duration 3; keep Rooted duration 1. |
| `shell_bastion` (331; 339–342) | Remove Guarded/Anchored, barrier +8, `cleanse: 1`, keep `teamCleanse: 1`. |
| `foam_blitz` (347; 355) | `soaked` → `marked`, duration 2. |
| `rip_current` (358; 366–367) | `exposed` → `marked`; keep binary Haste. |
| `maw_of_maelstrom` (370; 378–379) | Change Slowed to `stunned`, keep `rooted`, remove Soaked/Marked from `bonusAgainst`; preserve the multiplier for Sonné/Rooted only. Marked still amplifies hit one centrally. |
| `bubble_burst` (395; 403) | `soaked` → `marked`, duration 3. |
| `static_wake` (421; 429) | `charged` → `marked`, duration 3. |
| `storm_chain` (432; 441) | `weakened` → `stunned`, duration 2. |
| `thunder_deluge` (444; 452–454) | Delete Charged/Soaked `detonate` and `detonatePower`; keep/apply `stunned` duration 1. A pre-existing Mark is consumed by the universal hit path. |
| `caldera_roar` (470; 478) | Self `exposed` → self `marked`. |
| `furnace_heart` (482; 490) | Remove Regenerating; keep Focused and add immediate `healRatio: 0.08`. |
| `ninefold_inferno` (520; 529–530) | Delete Marked `bonusAgainst` and multiplier; universal Marked boosts only hit one. |
| `ember_armor` (535; 543) | Remove Guarded, barrier +8, `thorns` → `countering` with duration 2. |
| `seed_bloom` (620; 628–629) | Remove Regenerating; add 0.08 to Stage 1's settled immediate `healRatio` (today this structurally yields 0.23 from 0.15). |
| `leaf_mantle` (632; 640–643) | Remove Guarded; add caster-only `barrier: 8` alongside existing team barrier/heal; keep `teamCleanse: 1`. |
| `ancient_bark` (659; 667–668) | `thorns` → `countering`, duration 4; existing barrier remains. |
| `forest_quake` (671; 679–680) | Self `slowed` → self `stunned`, duration 2; keep target Rooted. |
| `pollen_dream` (685; 693) | `drowsy` → `stunned`, duration 3. |
| `toxic_spines` (722; 730) | `poisoned` → `burning`, duration 4. |
| `bramble_trap` (733; 741–742) | Keep Rooted; `thorns` → self `countering`, duration 2. |
| `venom_harvest` (745; 753–754) | `detonate: ['burning']`; preserve detonation power and drain. |
| `crooked_glimmer` (771; 779–780) | `weakened` → `stunned`, duration 2; keep Evasive. |
| `shadow_shed` (783; 791–793) | Remove Guarded, barrier +8, keep Evasive/binary Haste, `cleanse: 1`. |
| `sonic_gloom` (798; 807) | `drowsy` → `stunned`, duration 3. |
| `midnight_lullaby` (810; 818–821) | Collapse Stunned 1 + Weakened 2 into one `stunned`, duration 2. |
| `nightmare_dive` (824; 832–833) | Deduplicate Drowsy/Stunned to `bonusAgainst: ['stunned']`; preserve multiplier. |
| `hex_bolt` (875; 883) | `cursed` → `burning`, duration 4. |
| `moonless_omen` (898; 907–910) | Keep Marked duration 4; Weakened → `stunned`, duration 3. |

Also normalize all remaining cleanse fields: `oracle_veil` 38, `deja_vu` 115, `shell_bastion` 341, `tide_reversal` 416, `ash_rebirth` 567, and `shadow_shed` 793 become `1`; team cleanses at 342/643/705 stay `1`. Keep `spectrum_break` 151 and `supernova` 604 as internal boost removal. Run a data-level assertion that no descriptor/list contains a deleted id and no non-Burning status carries `stacks`.

### `src/battle/engine.js`

#### Battle state and late-pressure deletion

- Delete exported `LATE_TURN_PRESSURE` lines 17–23.
- Delete `lateTurnPressure` from `createBattle` input line 89 and state line 107. The battle-state `version` need not change because battle state is ephemeral, but there must be no ignored compatibility flag.
- Delete `applyLateTurnPressure` lines 950–974 and its call at 1010. Do not replace it with another attrition mechanic.

#### Opening, legal-action, passive, command, and Ace branches

- Doctrine Assault line 180: apply self `marked` instead of Exposed.
- Legal actions lines 221–224: delete Silenced support blocking and Anchored bypass. Rooted alone blocks voluntary switching; additionally allow `ancient_roots` as a defensive fallback if a manually constructed test state contains Rooted.
- `enterTalent` 254–255: delete Anchored grant. Ancient Roots immunity is implemented in `applyStatuses`: skip a `rooted` descriptor when `creature.passive === 'ancient_roots'`, emit no applied-status event, and leave the record absent.
- Ace packages 333–383:
  - `second_wind`: remove one penalty, not two.
  - `redline`: binary Haste duration 4; remove `stacks: 2`.
  - `overgrowth`: immediate 8% heal, one `countering` duration 3, existing barrier.
  - `mindlock`: one `stunned` duration 2 plus `marked` duration 3.
  - `high_tide`: remove one penalty, preserve its heal/barrier.
  - `citadel`: no Anchored/Guarded; add eight to its existing barrier grant (cap still applies).
  - `wildfire`: existing Focused plus two-stack Burning remains valid under max two.
  - `vanishing_act`: existing Evasive + Countering now means Evasive + Riposte.
  - `stormfront`: binary Haste + Focused; foe `marked` duration 3, no Charged.
  - `dark_fate`: Marked 4 + Sonné 2 + Burning 3.
- Trainer commands 499–520: Balanced already removes one penalty; Assault applies self Marked; Bastion adds eight more barrier instead of Guarded; Ambush keeps binary Haste/Focused.

#### Damage/status resolution branches (list of every old-id search hit)

- Lines 545–548 (`charged`/`soaked` Conductor and detonation power): remove both old checks. Recast Conductor as “gain +8 Surge when this creature consumes Marked,” emitted once per move transaction; this preserves its setup-conversion identity without changing Marked's ×1.35 number.
- Lines 578–614: replace the local flags `weakened`, `drowsy`, old `stunned`, `guarded`, `exposed`, persistent `marked` with:
  - `focused = consume(attacker.statuses, 'focused')` after Evasive has been checked;
  - `stunned = hasStatus(attacker, 'stunned')`;
  - `marked = consume(defender.statuses, 'marked')` after Evasive, with a removal event and source captured for Assist;
  - pass `marked: marked && hit === 1` into `calculateDamage`.
- Line 582's `move.ignoreGuard` branch disappears entirely. Barrier bypass continues through the existing `move.ignoreBarrier` branch at lines 619–624.
- `scaledPower` lines 526–556: retain surviving `bonusAgainst`/Burning detonation logic. Do not include Marked in matches/detonations. Instead, add Marked to `combo` and derive its helper from the consumed record's `sourceCreatureId`, so preview/live events and Assist remain intact.
- Lines 679–685: remove the Drowsy-only Night Terror condition; extend duration when `spec.id === 'stunned'`. Keep Living Furnace's Burning stack increment, now naturally capped at two.
- Lines 767–795: replace the two status reflect branches with one `countering` branch at 25%, consuming once after direct HP damage. Keep `bramblehide` as an independent 6% recurring passive reflect; give its recoil source `bramblehide` rather than the deleted string `thorns`. If both passive and Riposte apply, emit two clearly sourced recoil events or one event with an additive ratio, but consume Riposte exactly once and test the chosen event shape.
- Lines 799–805: Deep Pressure applies `marked` duration 2 to the first attacker each turn.
- Line 809: make `healRatio` execute for any non-damage move, not only `kind === 'heal'`, so support-kind Furnace Heart can perform its immediate former-Regeneration heal. Alternatively change Furnace Heart to `kind: 'heal'`, but do not do both; keeping its authored `support` kind plus a generic self-heal field causes less data churn. Preserve the existing heal event path.
- End tick lines 980–999: replace the three-entry DoT array with only `['burning', 0.05]`; delete Regenerating healing.
- Other current old-id branches covered by the edits above: Exposed 180/506/583; Silenced 221/351; Anchored 224/254–255/360; Regenerating 344/998; Thorns 345/767–781; Countering 367/784–795; Charged 370/545; Weakened 381/579; Cursed 382/966/983; Guarded 510/582; Drowsy 580/683; Soaked 545/805; Poisoned 982. A final exact-id search must return none.

### `src/battle/ai.js`

Current anchors: late-pressure import line 8 and score 40–45; status/style scores 30–60; support score 78–125; candidate detonation read 166–168; Champion defense score 260–269.

- Remove the `LATE_TURN_PRESSURE` import and all special late-turn aggression scoring.
- A damaging move that self-applies `marked` gets the former Exposed drawback penalty.
- Pressure style rewards only `burning`, not the three old DoTs.
- Deception style keeps Evasive/Countering. Former Thorns move data now arrives as Countering automatically.
- Remove the special Guarded support value; converted barrier points are already scored by `barrierValue`.
- Include a support move's immediate `healRatio` in effective-healing score, so Furnace Heart is not undervalued merely because it remains `kind: 'support'`.
- Negative counts may continue using internal polarity.
- Candidate “primed” switching at 166–168 now only sees authored detonation statuses (Burning for Venom Harvest). Rewrite the test fixture accordingly.
- Champion defensive status list becomes Evasive/Countering; control list becomes only Stunned (Rooted can remain separately weighted if desired, but no old ids).
- Marked's universal preview multiplier makes damaging-move score account for it automatically. Do not add another combo bonus beyond the existing single `forecast.combo` reward.

### `src/data/passives.js`, `src/data/trainers.js`, and passive engine packages

- `passives.js` is metadata only. At lines 13/16/22/26, keep passive ids but update icons if desired: `deep_pressure` should use Marked's `⌖`; `conductor` may keep `ϟ`; `ancient_roots` keeps its root icon; `night_terror` should use Sonné's `★`. No passive id/save migration.
- `trainers.js` lines 1–146 contains no status literals; its Ace ids route into `triggerAce`. Do not edit trainer compositions. Verify all 12 packages through the engine mapping above: Overgrowth, Mindlock, Citadel, Stormfront, Dark Fate, plus Redline's binary Haste.
- Passive semantic rewrites:
  - `deep_pressure`: first direct attacker each turn becomes Marked for 2 turns.
  - `conductor`: +8 Surge when Voltide consumes Marked, once per move.
  - `ancient_roots`: cannot be Rooted; no slow/Sonné immunity.
  - `night_terror`: Sonné inflicted by Nocturnyx lasts one extra turn.
  - `living_furnace`: Burning starts with one extra stack, capped at two.
  - `bramblehide`: remains passive recurring 6% reflection, never creates a status.

### `src/data/combos.js`

Current route extraction is lines 4–36 and only understands `bonusAgainst`/`detonate` triggers.

- Deduplicate setup status ids per move.
- Treat `marked` as a trigger for every damaging finisher because every hit can consume it; keep explicit `bonusAgainst` and `detonate` triggers for Stunned/Rooted/Burning routes.
- Avoid route explosion in displayed team plans: for each `(setterId, setupMoveId, finisherId, status)` keep the finisher's strongest route, preferring Signature, then detonation, then highest `power * hits`. This still proves cross-creature setup without listing every basic attack.
- `detonation` remains true only for authored `finish.detonate`, which after S2 means Burning/Venom Harvest. A universal Marked conversion is an Assist, not a detonation.
- Ensure returned `statuses` contains only the eight survivors and no duplicate `marked` entry.

### `src/data/team-profile.js`

Current scoring is lines 11–49, especially control 22–26 and sustain/tempo 27–39.

- Count unique target status ids, not raw descriptor length, so merged data cannot inflate Control.
- Preserve broad weighting shape but score concrete survivors: Stunned/Rooted as full control, Marked as setup, Burning as pressure; authored Burning detonation still contributes. Converted Guarded barriers and Regeneration heals flow through `barrier`/`healRatio` automatically.
- Keep binary Haste/Evasive tempo checks. There must be no Haste-stack bonus.
- Recalculate only the expected dominant-profile fixtures in `data-ai.test.js`; do not tune status numbers to preserve old compass outputs. If the profile scales at lines 41–43 need adjustment, make that a final data-only calibration after all mappings are in place.

### `tools/simulate-balance.mjs`

Current late-pressure comparison sites: `simulate` parameter lines 26–27; paired before/after accumulators and calls 220–245; comparison output 283–285; gate 314–319.

- Remove the `lateTurnPressure` parameter. Simulate each seeded matchup once.
- Delete `turnsBefore`, `turnSamplesBefore`, `capsBefore`, the second paired simulation, and “before → after” output. Report average turns, p90, and turn-cap decisions for the one real ruleset.
- Change the enforced pacing gate from current 16–20 / `<10%` to **12–16 average turns inclusive** and **strictly below 5% turn-cap share** (`capShare >= 0.05` fails).
- Keep the existing roster 30–70%, TTK, and naive bands unchanged. `--naive` remains a fast independent gate.

### Minimal S2 playback safety

`src/battle-ui/playback.js` has two hardcoded deleted ids even though most status rendering is data-driven:

- Line 189 sends fake `guarded` into barrier FX. Send a status-neutral barrier event or a dedicated barrier token that does not consult `STATUS_DEFINITIONS`.
- Line 209 maps recoil to `thorns`/`exposed`. Map Riposte recoil to `countering`; map passive reflect to `countering` for color only or teach `statusTickFx` to accept an explicit color. No call may index metadata for a deleted id.

`src/sound.js:1051` defaults `detonate(status = 'charged')`; change the fallback to `burning`. This is a dead-id safety fix, not an audio redesign.

## 3. Localization plan

### 3.1 Status keys: exact keep/delete/rewrite set

Status definitions are split across the base FR/EN objects (`src/i18n.js` 486–511 and 1051–1082) and later name assignments (1165–1180 and 1550–1565). Keep dictionaries key-identical.

Delete both `status.*` and `status.effect.*` keys for:

`guarded`, `regenerating`, `thorns`, `anchored`, `exposed`, `slowed`, `weakened`, `silenced`, `poisoned`, `soaked`, `charged`, `drowsy`, `cursed`.

Keep/rewrite exactly these eight pairs. Every explanation is six words or fewer in both languages.

| Key | French | English |
|---|---|---|
| `status.focused` | `Concentré` | `Focused` |
| `status.effect.focused` | `Prochaine attaque : +30 % dégâts.` | `Next attack deals 30% more.` |
| `status.haste` | `Accéléré` | `Haste` |
| `status.effect.haste` | `Vitesse augmentée de 20 %.` | `Speed increases by 20%.` |
| `status.evasive` | `Insaisissable` | `Evasive` |
| `status.effect.evasive` | `La prochaine attaque ciblée échoue.` | `Next targeted attack misses.` |
| `status.countering` | `Riposte` | `Counter` |
| `status.effect.countering` | `Renvoie 25 % du prochain coup.` | `Returns 25% of next hit.` |
| `status.marked` | `Marqué` | `Marked` |
| `status.effect.marked` | `Prochain coup reçu : +35 % dégâts.` | `Next hit deals 35% more.` |
| `status.stunned` | `Sonné` | `Dazed` |
| `status.effect.stunned` | `Dégâts −25 %, vitesse −30 %.` | `Damage −25%; Speed −30%.` |
| `status.rooted` | `Enraciné` | `Rooted` |
| `status.effect.rooted` | `Impossible de changer de combattant.` | `Cannot switch fighters.` |
| `status.burning` | `Brûlure` | `Burning` |
| `status.effect.burning` | `Perd 5 % PV par charge.` | `Loses 5% HP per stack.` |

### 3.2 Move-effect keys that must be rewritten

The expanded runtime descriptions live at FR 1451–1524 and EN 1832–1903; five Signature descriptions are overridden again at FR 1946–1953 / EN 2016–2020. The small early descriptions at FR 554–571 / EN 1120-era entries must also agree where duplicated. Use Stage 1's settled numeric totals in place of “barrière renforcée” when the product wants exact tooltips.

| `move.effect.*` key | Proposed French meaning | Proposed English meaning |
|---|---|---|
| `slowing_riddle` | `Sonne pendant 2 tours.` | `Dazes for 2 turns.` |
| `oracle_veil` | `Barrière renforcée, esquive, concentration ; retire un malus.` | `Stronger barrier, dodge, focus; removes one penalty.` |
| `finale_nova` | `Renforcé contre Sonné ou Enraciné.` | `Stronger against Dazed or Rooted.` |
| `forgotten_name` | `Sonne pendant 3 tours.` | `Dazes for 3 turns.` |
| `deja_vu` | `Barrière, esquive, Riposte, concentration ; retire un malus.` | `Barrier, dodge, Counter, focus; removes one penalty.` |
| `refraction_lance` | `Traverse entièrement les barrières.` | `Bypasses barriers completely.` |
| `spectrum_break` | `Retire deux avantages puis marque.` | `Removes two boosts, then Marks.` |
| `fault_charge` | `Impact colossal ; te marque ensuite.` | `Colossal impact; Marks you afterward.` |
| `tectonic_ram` | `Sonne pendant 1 tour.` | `Dazes for 1 turn.` |
| `iron_resolve` | `Barrière renforcée et prioritaire.` | `Stronger priority barrier.` |
| `momentum_claw` | `Accélère pendant 3 tours.` | `Grants Haste for 3 turns.` |
| `gravity_fist` | `Sonne pendant 3 tours.` | `Dazes for 3 turns.` |
| `fortress_protocol` | `Forme une grande barrière.` | `Forms a large barrier.` |
| `continental_divide` | `Traverse les barrières ; renforcé contre Sonné.` | `Bypasses barriers; stronger against Dazed.` |
| `undertow` | `Sonne 3 tours, enracine 1.` | `Dazes 3 turns, Roots 1.` |
| `shell_bastion` | `Grande barrière ; retire un malus à chacun.` | `Large barrier; removes one penalty each.` |
| `foam_blitz` | `Très prioritaire ; marque la cible.` | `High priority; Marks the target.` |
| `rip_current` | `Marque la cible et t’accélère.` | `Marks the target and grants Haste.` |
| `maw_of_maelstrom` | `Renforcé contre Sonné ou Enraciné.` | `Stronger against Dazed or Rooted.` |
| `bubble_burst` | `Marque la cible et forme une barrière.` | `Marks target and forms a barrier.` |
| `static_wake` | `Prioritaire ; marque la cible.` | `Priority hit; Marks the target.` |
| `storm_chain` | `Trois éclairs qui sonnent 2 tours.` | `Three hits that Daze 2 turns.` |
| `thunder_deluge` | `Consomme Marqué puis sonne 1 tour.` | `Consumes Marked, then Dazes 1 turn.` |
| `caldera_roar` | `Puissance extrême, mais te marque.` | `Extreme power, but Marks you.` |
| `furnace_heart` | `Soigne 8 % et concentre.` | `Heals 8% and grants Focus.` |
| `ninefold_inferno` | `Cinq frappes successives.` | `Five successive hits.` |
| `ember_armor` | `Barrière renforcée et Riposte.` | `Stronger barrier and Counter.` |
| `seed_bloom` | `Soin immédiat renforcé de 8 %.` | `Immediate healing increased by 8%.` |
| `leaf_mantle` | `Protège l’équipe ; retire un malus.` | `Protects team; removes one penalty.` |
| `ancient_bark` | `Grande barrière et Riposte.` | `Large barrier and Counter.` |
| `forest_quake` | `Enracine l’ennemi mais te sonne.` | `Roots the foe but Dazes you.` |
| `pollen_dream` | `Prioritaire ; sonne pendant 3 tours.` | `Priority; Dazes for 3 turns.` |
| `toxic_spines` | `Brûlure cumulable pendant 4 tours.` | `Stackable Burning for 4 turns.` |
| `bramble_trap` | `Enracine 3 tours et donne Riposte.` | `Roots 3 turns and grants Counter.` |
| `venom_harvest` | `Fait exploser Brûlure et draine.` | `Detonates Burning and drains.` |
| `crooked_glimmer` | `Sonne et garantit une esquive.` | `Dazes and guarantees a dodge.` |
| `shadow_shed` | `Barrière, esquive, accélération ; retire un malus.` | `Barrier, dodge, Haste; removes one penalty.` |
| `sonic_gloom` | `Deux ondes qui sonnent 3 tours.` | `Two waves that Daze 3 turns.` |
| `midnight_lullaby` | `Sonne 2 tours sans dégâts.` | `Dazes 2 turns without damage.` |
| `nightmare_dive` | `Renforcé contre une cible Sonnée.` | `Stronger against a Dazed target.` |
| `hex_bolt` | `Brûlure cumulable pendant 4 tours.` | `Stackable Burning for 4 turns.` |
| `moonless_omen` | `Barrière ; marque et sonne la cible.` | `Barrier; Marks and Dazes target.` |

Cleanse/boost-removal descriptions also need semantic repair even without a dead id: `tide_reversal`, `ash_rebirth`, `nectar_circle` say one penalty (per ally for team cleanse); `supernova` says “removes all enemy boosts,” never “purges”; all final Signature overrides at 1946–1953/2016–2020 must match the expanded entries. Do not leave an earlier duplicate saying full cleanse or old barrier totals.

### 3.3 Other effective localization keys mentioning deleted concepts

Rewrite both languages for these runtime keys (current effective-key search):

- `command.effect.assault`: self becomes Marked; `command.effect.bastion`: existing barrier plus eight, no Guarded.
- `doctrine.effect.assault`: lead starts Marked.
- `ace.effect.second_wind` / `high_tide`: “removes one penalty.”
- `ace.effect.overgrowth`: immediate 8% heal + Counter + barrier.
- `ace.effect.mindlock`: Dazed + Marked.
- `ace.effect.citadel`: barrier only, including the +8 conversion.
- `ace.effect.redline`: binary Haste; remove “2 stacks.”
- `ace.effect.stormfront`: Focus/Haste; opposing fighter Marked.
- `ace.effect.dark_fate`: Marked, Dazed, Burning.
- `passive.effect.deep_pressure`, `conductor`, `ancient_roots`, `night_terror`: use the passive semantics in section 2.
- `squad.effect.storm_circuit`: universal Marked setup, no Soaked/Charged language.
- `squad.effect.dream_garden`: Burning/control/recovery, no Poison.
- `squad.effect.mind_palace` and `advice.barrier`: replace “purge” with “remove boosts.”
- `advice.cleanse`: say “remove one penalty,” not “purification/cleanse taxonomy.”
- Haste strings such as `battle.relayRushLine`, `quickRule.relay_rush`, `battle.switchBonusFever`, bond copy remain, but none may claim stacks. `ace.effect.redline` is the known stack claim.
- Lore and move names (`lore.thornox`, `lore.abyssar`, `move.toxic_spines`, `move.hex_bolt`) are flavor/proper names, not status vocabulary; retain them unless S4's copy review chooses otherwise.

After edits, import `DICTIONARIES` and search **values** as well as source text. No effective gameplay copy may mention Guarded/Exposed/Slowed/Weakened/Regeneration/Thorns/Anchored/Silenced/Soaked/Charged/Drowsy/Poisoned/Cursed or their French gameplay equivalents.

## 4. UI reconnaissance for S4 (do not redesign in S2)

Most presentation is already keyed dynamically from `STATUS_DEFINITIONS`; shrinking that table gives the correct eight icons automatically. Record these repair sites for S4:

- `src/battle-ui/hud.js` lines 112–148 builds compact status icons from id/icon/color and lines 162–166 builds detail cards and effects. It assumes every combatant id exists in definitions. It will show only Burning stacks after S2, which is correct. S4 should verify four positive/four negative colors and overflow with eight possible effects.
- `src/app/context.js` lines 181–190 builds arena orbs by id; CSS has custom animation only for `burning`, `rooted`, `stunned`, and obsolete `poisoned` at `styles/screens/progression.css` 271–284. S4 should delete Poisoned styling and decide whether Marked/Counter/Riposte need distinct motion.
- `src/battle-ui/fx.js` lines 145–174 hardcodes only Focused versus a generic cyan/shield tactical glyph; lines 177–191 and 362–370 correctly lookup status metadata for detonation/ticks. S4 should make all eight effects metadata-driven. S2 only ensures no deleted id reaches those lookup paths.
- `styles/screens/battle-fx.css` lines 522/552 still key visuals to `.tactical-guarded`; retire or rename during S4 after the neutral barrier event is introduced.
- `src/screens/academy.js` lines 30–37 derives glossary entries from definitions and line 52 splits by polarity. Expected post-S2 count is **8 total: 4 advantages, 4 penalties**; Burning alone shows `×2`.
- `src/battle-ui/controller.js` lines 249–265 (battle codex), 513–521 (polarity classes), and 654–657 (switch icons) are dynamic but assume known ids.
- `src/screens/bestiary.js` lines 51–57 previews a support move using its first self status or a fake Focused fallback. Former Guarded/Anchored/Regenerating-only moves may now have no self status, so S4 should select heal/barrier FX from move fields rather than pretend they grant Focused. Lines 75/100 onward show `move.effect.*`; all dead-status mentions disappear through i18n in S2.
- E2E Academy and Move Theater coverage listed below acts as the handoff contract for S4.

## 5. Test repair map

### `test/affinities-damage.test.js`

Case at line 17 currently asserts Focus, Guard, Exposure, Weakness. Replace with exact multiplier tests for Focused ×1.30, Marked ×1.35, and Sonné ×0.75, plus minimum damage. Add an engine-level multi-hit assertion rather than assuming Marked applies to all hits. Do not pin Stage 1's base damage constant.

### `test/engine.test.js`

- Import list line 14: remove `LATE_TURN_PRESSURE`.
- `cooldowns...statuses refresh/consume` line 138: Fault Charge self-Marks and the next connected enemy damaging move consumes it; use `stunned` instead of manually seeded `slowed` and assert duration refreshes to the authored maximum.
- `innate talents...` line 347: add Ancient Roots coverage—attempt to Root Mossaur, assert no record/event and switching remains legal. Existing Focus assertion stays.
- `battle doctrines...` line 432: Assault lead is Marked, not Exposed.
- `each doctrine...Trainer Command` line 453: Bastion asserts numeric barrier conversion and no `guarded`; Balanced removes exactly one of two seeded penalties.
- `multi-hit...DoT` line 503: keep Burning but assert two stacks tick exactly 10% and no third stack can be created.
- `a drain move cannot resurrect...` line 580: seed `countering` instead of Thorns, update reflect to 25%, still prove drain cannot resurrect. Add separate Bramblehide passive reflect coverage so merging statuses does not delete the passive.
- `prepared finishers...` line 613: seed two-stack `burning`; Venom Harvest preview/event combo and detonation id are `burning`.
- `a teammate converting...` line 631: retain Marked source attribution, but assert Marked is consumed, only hit one is amplified on Ninefold Inferno, exactly one Assist/+8 event occurs.
- `damage previews...` line 663: keep Evasive. Add a Marked scenario proving preview immutability and first-hit behavior.
- `support control...` line 701: expect `stunned`; assert damage and effective move order are reduced without a move skip or support lock. Keep Rooted; add Ancient Roots immunity separately.
- `defensive Signatures...` line 752: seed `stunned` instead of Slowed, assert one team-cleanse removal and the new barrier totals.
- Add focused unit cases near these sections for binary Haste reapplication (`stacks === 1`), Riposte one-shot 25%, former Thorns grants now Riposte, and immediate 8% former-Regeneration healing.
- Delete all three late-pressure cases at lines 886–959. Replace them with one static contract assertion: reaching turns 29–40 causes no synthetic status/damage events; turn cap behavior remains covered by the case at line 852.

### `test/preview-parity.test.js`

At lines 11–18 replace the `guarded` scenario with a `marked` scenario. Keep Evasive. The seeded sweep must continue asserting preview/live damage, lethality, and immutability across all roster moves; ensure its checked-count floor still matches the same number of scenarios.

### `test/data-ai.test.js`

- `all moves...identities` line 61: keep; merged move descriptors must not create clones.
- `move sustain...budget` line 73: update exact barrier map for every former Guarded grant (+8 relative to post-S1 values), add Furnace Heart 0.08 and Seed Bloom's +0.08 immediate heal, and keep Evasive/barrier constraints appropriate to the new totals.
- `Team Compass...` line 209: recompute expected dominant profiles after unique-status scoring; retain boundedness/distinctness assertions.
- `team combo routes...` line 287: retain cross-creature Marked route, assert route ids are among the eight survivors, Marked routes are not detonations, Burning/Venom is a detonation, and results are deduplicated.
- `Champion AI saves defensive Signatures...` line 342: seed `stunned`, not Slowed; update expected action only if authoritative scoring changes.
- `Champion switch scoring reads detonation setup...` line 375: rename to Burning setup; seed `burning` on the candidate for an opposing Venom Harvest user instead of Charged/Thunder Deluge. Preserve the candidate-vs-active and Champion-vs-Standard information-boundary assertions.
- Delete `Champion AI converts late-turn pressure...` lines 519–539. Replace with a test that Champion scoring has no hidden turn-29 branch: identical visible states differing only in `turn` choose under ordinary cooldown/arena rules, or simply cover legal deterministic finishing aggression without a pressure flag.
- Add a schema sweep over all move status fields (`targetStatuses`, `selfStatuses`, `bonusAgainst`, `detonate`, `consume`) asserting no deleted id, only Burning stack descriptors, and `STATUS_DEFINITIONS` has 8 ids with 4/4 polarity.

### `test/i18n-save.test.js`

- Localization completeness line 17 stays and must cover identical delete/add keys.
- Signature tooltip test lines 144–152 must use the final post-Stage-1 + S2 barrier/heal totals. Prefer deriving expected numeric strings from `MOVES` rather than duplicating stale constants.
- Add a dictionary contract iterating the eight definitions: every `status.<id>` and `status.effect.<id>` exists in FR/EN, explanation word count ≤6, and no `status.*` key exists for a deleted id.
- Save tests require no migration changes (see section 6).

### E2E cases

- `e2e/progression-responsive.spec.js` Academy case 149–163: change counts 21/8/13 to **8/4/4** and assert only Brûlure/Burning shows `×2`.
- `e2e/battle-layout.spec.js` line 39: Assault doctrine HUD contains Marqué/Marked, not Exposé/Exposed.
- `e2e/gameplay.spec.js` detonation case 334–351: use Thornox's Toxic Spines → Venom Harvest (or another deterministic Burning setup/consumer), and expect Brûlure/Burning instead of Chargé. Keep the dedicated detonation beat assertion.
- `e2e/gameplay.spec.js` Assist case 462–485: rewrite to an explicit cross-creature Marked setter/finisher and assert one visible Assist from the setter; do not rely on old Poison/Slowed coincidence.
- `e2e/progression-responsive.spec.js` Move Theater case 165 onward: keep the 72-technique sweep; add a no-placeholder assertion for deleted `status.*` keys if the theater exposes any status copy.

### Gate commands for the executor

Run after implementation, not during this planning task:

1. `npm test` — all unit/data/i18n/preview-parity tests green.
2. `npm run test:balance` — average 12–16 turns, turn-cap share `<5%`, roster/TTK bands green.
3. `node tools/simulate-balance.mjs --naive` — existing Apprentice 65–100%, Standard 40–60%, Champion 20–40% bands hold.
4. `npm run test:e2e` — Academy 8/4/4, Marked HUD, Burning detonation, Assist, and Move Theater green.

## 6. Save impact analysis

Expected impact: **none; no save migration and no `SAVE_VERSION` bump.**

Verified in `src/save.js`:

- `DEFAULT_SAVE` lines 7–38 persists progression, settings, squads, records, and last-team choice only.
- `validateSave` lines 116–223 has no battle, combatant, status, cooldown, history, or late-pressure field.
- Battle combatants and `statuses: {}` are created transiently in `src/battle/engine.js` lines 54–68; the live `ctx.battleSession` is in memory and is not passed to `persistSave`.
- Results persist aggregates/records, not semantic status ids. Existing history dies with the session.

Therefore deleting ids and the `lateTurnPressure` battle-state property cannot invalidate a stored user save. Do not add a migration “just in case.” Tests in `i18n-save.test.js` should remain unchanged except localization contracts/tooltips.

## 7. Ordered execution checklist (one Sol-high session)

1. **Lock contracts with tests (45–60 min).** Add the eight-id schema/polarity/word-count tests, direct damage multipliers, binary Haste, max-two Burning, Root immunity, one-penalty cleanse, one-shot Riposte, and no-late-pressure assertions. Verification point: new tests fail for the intended old behavior only.
2. **Replace the status core (45 min).** Edit `statuses.js`, structural status options in `damage.js`, and engine speed/damage/tick consumption. Preserve Stage 1's base numbers. Verification point: focused status tests and preview parity targeted cases pass.
3. **Migrate all 72-move data safely (60–90 min).** Apply the enumerated 39 dead-status edits plus cleanse/Haste normalization. Use a programmatic schema sweep to catch omissions and duplicate merged descriptors. Verification point: zero deleted ids in move fields; unique-move and sustain-budget tests pass after expected fixtures update.
4. **Migrate engine integrations (60 min).** Openings, commands, all 12 Ace routes, passives, Assist provenance, Riposte/Bramblehide, Ancient Roots, and immediate former-Regeneration heals. Delete late pressure. Verification point: focused engine cases green; exact-id search has no engine hit.
5. **Repair AI and derived data (45–60 min).** Remove turn-29 branch; update scoring, combo route dedupe, team profile, Conductor behavior, and balance harness single-ruleset reporting/gates. Verification point: data/AI suite green on deterministic fixtures.
6. **Rewrite localization (60–90 min).** Delete 13 status key pairs per language, install the eight ≤6-word contracts, update every listed move/passive/Ace/doctrine/squad/advice string and duplicate override. Verification point: dictionary equality, no placeholders, and effective-value dead-term search green.
7. **Apply minimal dead-id presentation safety and E2E fixture repairs (30–45 min).** Playback barrier/recoil tokens, sound detonation fallback, Academy counts, Marked HUD case, Burning detonation, Marked Assist. Do not undertake S4 visual redesign. Verification point: targeted E2E cases green.
8. **Static completeness audit (15 min).** Search source/tests/tools for exact deleted ids and late-pressure symbols. Expected remaining matches are only this plan or explicitly approved flavor words—not code/data/i18n keys. Confirm `Object.keys(STATUS_DEFINITIONS).length === 8`, four positive/four negative, only Burning stackable max two.
9. **Run all gates (balance time dominates).** `npm test`, `npm run test:balance`, `node tools/simulate-balance.mjs --naive`, `npm run test:e2e`. If pacing misses, tune move/status-adjacent numbers only after checking the status contract; never reintroduce a ninth status, Haste stacks, recurring regeneration, or late pressure. Re-run all four after any tuning.

### Completion definition

- Exactly eight runtime status ids; no compatibility aliases.
- No old status id or late-pressure branch in executable/data/test code.
- One universal Marked number, one Sonné rule, one Riposte rule, one fixed Burning tick.
- All four verification gates green, including preview parity.
- Balance reports 12–16 average turns and `<5%` turn-cap decisions; naive bands hold.
- No save migration; S4 UI reconnaissance is preserved as follow-up, not expanded into this implementation.
