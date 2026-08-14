# Édition claire — Stage 3: system removals

Date: 2026-08-14  
Scope: planning only; implementation follows Stage 1 pacing and Stage 2 status/late-pressure changes.  
Target save version: v15.

## Outcome and guardrails

Stage 3 removes tactical Contracts, doctrine variants, mechanical Bonds, Battle Flow/Crescendo, arena resonance, mastery combat perks, and hidden Rally/Final Duel bonuses. It retains one situational universal Trainer Command, cosmetic mastery ranks, Rally and Final Duel cinematics, existing progression, and legacy `contractsCompleted`/`contract_hero` data.

All references below describe the current pre-Stage-3 tree. Stage 1 and Stage 2 are concurrent prerequisites, so line numbers and pacing constants must be rebased after those branches land. In particular, Stage 2 is expected to remove `LATE_PRESSURE_*` and related engine/AI branches; Stage 3 must neither restore nor recalibrate them.

Non-goals:

- Do not rename move `crescendo_lock`, trainer/badge name `resonance`, or move `resonant_focus`; these are content names, not the removed systems.
- Do not remove mastery XP, mastery ranks, collection displays, mastery rewards, or mastery save data. Only their battle perks disappear.
- Do not revoke `contract_hero`, reduce feat totals, or rewrite historical `contractsCompleted` values.
- Do not remove named, surfaced Éclat exceptions such as Assist, Perfect Relay, Encore, Astral pulse, Ace, or explicit gauntlet/trial modifiers.

## 1. Removal specifications

### 1.1 Tactical Contracts become silent post-battle achievement signals

Current implementation:

- `src/data/contracts.js:1-26` defines the five selectable contracts and `contractProgress()`:
  - `onslaught`: 150 direct player damage.
  - `tactician`: five non-arena enemy status applications.
  - `signature`: one player Signature spend.
  - `guardian`: 55 combined player healing and barrier gain.
  - `relay`: two voluntary switches.
- `src/app/context.js:16,252-253` imports and exports `CONTRACTS`/`contractProgress`.
- `src/screens/team-select.js:14,82-84,177-184,206-210,290,303,438-441,461-462` selects, recommends, displays, and passes a contract into battle.
- `src/battle-ui/controller.js:11-12,126-137,161-177,252-282,327-335,449-451,580-588` randomizes/stores a contract, renders its nameplate/intro/codex/progress, and refreshes its chip.
- `src/screens/results.js:14-15,54-83,95,150-172,188,201-219,331-333` scores contract completion, grants XP, increments `contractsCompleted`, and awards `contract_hero`.
- `src/screens/gauntlet.js:87-90` exposes a contract-related reward.
- `src/screens/title.js:50,53` displays completed-contract count in the career strip.
- `src/styles/contracts.css:1-65` styles contracts; the same file also contains unrelated live Ace and battle-log styles at `:67-343` and Flow styles at `:345-413`.

Implementation:

1. Delete `src/data/contracts.js` after moving the five neutral history predicates into `src/data/progression.js` as `battleAchievementSignals(history)`. This helper returns booleans named after the former conditions; it has no selection, progress, or UI concept.
2. Evaluate the signals once, silently, after battle. Feed existing feats only where the meaning is honest:
   - `signature` unlocks `first_signature`.
   - `tactician` unlocks `tactician`.
   - `onslaught`, on a victory, may unlock `blitz` as an alternate aggressive-play route.
   - `guardian`, on a victory, may unlock `survivor` as an alternate resilience route.
   - `relay` has no semantically exact existing feat. Compute and test the signal for future analytics, but do not persist or display it and do not weaken `perfect_relay`, which must still require a `perfect-relay` event.
3. Remove every contract selector, recommendation, battle config field, intro card, HUD chip, codex section, progress refresh, completion reward, XP bonus, and gauntlet reward listed above.
4. Stop incrementing `save.contractsCompleted`; retain and validate it as frozen legacy history. Remove it only from the title career strip.
5. Remove new `contract_hero` award logic at `src/screens/results.js:171`, but retain its definition at `src/data/progression.js:59`, both localized name/effect keys, and validation through `FEAT_IDS`. Change its description to explicitly say it is a legacy feat. Never revoke it.
6. Before deleting `src/styles/contracts.css`, relocate its live Ace styles (`:67-232`) and battle-log styles (`:234-343`) to their owning battle presentation/log stylesheet. Flow styles (`:345-413`) live only until the Flow removal in Session B and should be relocated temporarily if the file is deleted in Session A. Remove the stylesheet link at `index.html:16` only after relocation.

### 1.2 Doctrines become one universal Trainer Command

Current implementation:

- `src/battle/engine.js:48` defines the doctrine list; `:77-98` accepts and stores a doctrine; `:178-192` applies doctrine openings; `:484-524` implements four doctrine-specific commands.
- `src/data/team-profile.js:52-56,103` recommends and returns a doctrine.
- `src/data/squads.js:1-10` stores a doctrine on every preset.
- `src/app/context.js:26,265` imports/exports `recommendedDoctrine`.
- `src/screens/team-select.js:22,40,82,229-246,290,303,349-398,450-462` owns doctrine selection, preset/remix/custom-squad doctrine state, plan-drawer content, and battle config.
- `src/screens/draft.js:13,48,77-83,101,146-164` recommends, confirms, and passes a draft doctrine.
- `src/screens/gauntlet.js:19-20,39`, `src/screens/trials.js:37`, and `src/screens/results.js:286-288` pass or preserve a doctrine.
- `src/battle-ui/controller.js:94,198,234,252,282,304,572-579,680-699` sends doctrine/mastery config, renders doctrine command UI/codex, and invokes the command.
- `src/battle-ui/fx.js:276-289` already supplies the reusable Trainer Command cinematic.
- `src/styles/progression.css:796-831`, `src/styles/overrides/selection.css:310-334,850-852`, and doctrine selectors in `src/styles/accessibility.css:37` become dead. `src/styles/battle-command.css:1-191` is mostly generic and remains.

Implementation:

1. Delete `BATTLE_DOCTRINES`, the battle/config/state `doctrine` field, every doctrine opening modifier, `recommendedDoctrine`, all selector/recommendation UI, doctrine preset fields, and doctrine codex content.
2. Convert preset, remix, draft, gauntlet, trial, rematch, and quick-battle payloads to `{ team, lead }` only.
3. Retain `commandUsed` in each side’s battle state and retain `applyTrainerCommand`, but make it universal and independent of configuration.
4. Add/export `canUseTrainerCommand(state, side)` from `src/battle/engine.js`; expose it through `src/app/context.js`. The controller must use the same helper as the engine, so availability and execution cannot disagree.
5. Keep the generic button/codex/FX CSS in `battle-command.css`; replace variant icon/class maps with one neutral `command-coach` presentation and delete only doctrine-specific selectors or copy.

#### Exact universal command design

Name/button:

- French: **Coup de pouce**
- English: **Coach Boost**

Effect: remove **all negative statuses** from the active creature and grant **+15 Éclat**.

Rules:

- Costs no Éclat and does not consume the player’s move/switch action.
- Available once per battle, only during `choice`, while the active creature is alive, no replacement is pending, the command is unused, and the active creature currently has at least one status in `NEGATIVE_STATUSES`.
- It is deliberately unavailable with nothing to cleanse. That makes it an obvious rescue tool rather than a mandatory free turn-one optimization.
- `applyTrainerCommand` must independently enforce the rule, set `commandUsed`, emit `trainer-command { side, creatureId, command: 'coach' }`, remove every negative status through normal status-removal events, then call `adjustSurge(..., 15, 'command')`.
- Stage 2 may change the final eight-status set; import the canonical `NEGATIVE_STATUSES` rather than duplicating names.

Presentation reuse:

- Reuse `trainerCommandFx` from `src/battle-ui/fx.js:276-289`, `sound.clash()` from `src/audio/sound.js:1103+`, the existing arena flash/burst, and the command stripe.
- Use one neutral coach icon (recommended `⚑`) and one `command-coach` class. Do not add a sound or cinematic.
- Keep the existing `trainer-command` playback event and generic battle-log line.

### 1.3 Remove all five mechanical Bonds

Current implementation:

- `src/data/synergies.js:1-26` declares the five composition recipes and `teamBonds()`.
- `src/battle/engine.js:3,94-97,108-126,162-173` imports/stores Bonds and applies opening Éclat, barrier, Haste, Focus, and Mark effects.
- `src/data/team-profile.js:4,96` imports Bonds and gives Smart Remix a `teamBonds(team).length * 15` score bonus.
- `src/app/context.js:12,193-199,207-227,246-247,312` imports/exports Bonds, renders `bondsHtml`, and highlights new/lost Bonds in draft insights.
- `src/screens/team-select.js:40,290`, `src/screens/draft.js:27,101`, and `src/battle-ui/hud.js:24,169-171` render Bond summaries.
- Bond codex/current-team content is assembled in `src/battle-ui/controller.js:252-282`.

Implementation:

1. Delete `src/data/synergies.js`; remove `BONDS`, `teamBonds`, `bondsHtml`, and all `state.sides.*.bonds` data.
2. Delete every opening Bond branch at `src/battle/engine.js:162-173`. All ordinary sides begin at the neutral 30 Éclat baseline unless an explicit mode modifier says otherwise.
3. Remove the Bond term from Smart Remix. Keep its remaining affinity, role, coverage, and lead heuristics; return only `{ team, lead }`.
4. Team Compass, the team plan drawer, draft insights/final reveal, HUD details, and codex must discuss axes, matchup, affinity, combo routes, and lead only. Remove `oldBonds`, `newBonds`, and `newBond` tags at `src/app/context.js:207-227`.
5. Remove dead styles at `src/styles/progression.css:755-795` and `src/styles/battle-presentation.css:1130-1132`.

### 1.4 Remove Battle Flow and Crescendo; flatten baseline Éclat gain

Current implementation:

- `src/battle/engine.js:98-137` stores `lastMoveId` and `flow` for each side.
- `src/battle/engine.js:743-759` detects alternation, grants `+2/+4/+6`, emits `flow`, and applies Crescendo cooldown reduction.
- `src/battle/engine.js:853-863` contains the Crescendo-specific cooldown branch.
- `src/battle/ai.js:186-194,217` scores Flow tempo.
- `src/app/context.js:68,92` recognizes/groups `flow` log events.
- `src/battle-ui/controller.js:283-293,531-537` renders Flow codex/live chips.
- `src/battle-ui/fx.js:245-274,455,483` implements/clears/exports the Flow/Crescendo FX.
- `src/battle-ui/playback.js:28,72,125-141` imports, delays, and handles `flow`.
- Dead Flow CSS is in `src/styles/contracts.css:345-413`, `src/styles/accessibility.css:83-85`, `src/styles/league.css:509-627`, `src/styles/battle-final.css:2-8,195-250`, and `src/styles/battle-layout.css:815-822`.
- `src/styles/components.css:540-554` styles the Crescendo result statistic.
- `src/screens/results.js:266,349` counts/renders Crescendos.

Implementation:

1. Remove `lastMoveId`, `flow`, alternation detection, `flow` events, Crescendo cooldown manipulation, all AI Flow terms, playback/FX/log handling, codex/chips, result recap count, CSS, and localization.
2. Ordinary cooldown behavior remains the single behavior already covered by the cooldown tests; no replacement acceleration mechanic is added.
3. Apply the following baseline Éclat table. Fixed move gain occurs for a non-Signature action even when it misses, matching today’s timing; taking-damage gain uses actual direct HP lost after barrier.

| Source | Current | Stage 3 |
|---|---:|---:|
| Battle start | 30 | 30 |
| Damaging non-Signature move | 14 | **20 fixed** |
| Heal/support non-Signature move | 22 | **25 fixed** |
| Attacker direct-damage bonus | 12% of damage | **remove** |
| Defender direct-HP-damage gain | 30% of damage | **25% of actual HP lost, rounded** |
| Flow alternation | +2 / +4 / +6 | **remove** |
| Signature action | spends its cost; no base gain | unchanged |

Direct-damage gain excludes barrier absorption, damage-over-time, recoil, and self-cost, matching the current direct-hit scope. Implement one named helper/constant path so player, AI, preview, and tests cannot grow separate formulas.

Keep these explicit, surfaced exceptions: voluntary switch `+10`, Relay Fever switch `+24`, Assist `+8`, Encore `+8`, Perfect Relay `+6`, Astral pulse `+15`, gauntlet/trial modifiers, Ace `+20/+100`, and the universal command `+15`. They are named feedback moments rather than silent composition/collection modifiers.

Cadence sanity check, using a representative 25-damage hit:

- Current baseline is roughly `14 + 3 attacker + 7.5 defender`, with Flow adding `0`, then `2`, then `4` across alternating actions. From 30, a side normally reaches a selectable Signature around its fourth action.
- Stage 3 is roughly `20 + 6.25` per damaging exchange: `30 → 56 → 83 → 100`, again making a Signature selectable around the fourth action.
- A support action rises from 22 plus later Flow to a clear 25.
- Expected outcome remains about one to two Signatures per side in a seven-to-ten-turn battle. Re-run simulations after Stage 1 lands because its exact turn/pacing values are provisional; adjust only the `20/25/25%` constants if median first-Signature timing moves by more than one action.

### 1.5 Remove remaining silent combat modifiers

#### Arena resonance

- Delete `ARENA_RESONANCE` from `src/battle/engine.js:26-33` and its matching-pulse `+10` branch/event at `:939-947`.
- Remove the import/export and log grouping in `src/app/context.js:37,81,105,274`.
- Remove AI anticipation/scoring at `src/battle/ai.js:3-13,147-153,178`.
- Remove controller metadata/nameplate/codex/turn-chip references at `src/battle-ui/controller.js:161-177,252-282,473-500`.
- Delete `resonanceFx` and cleanup/export paths at `src/battle-ui/fx.js:333-345,458,487`; remove playback imports/delays/handler at `src/battle-ui/playback.js:32,73,242-248`.
- Delete `sound.resonance()` at `src/audio/sound.js:1081-1101`.
- Delete resonance styles in `src/styles/battle-combos.css:110-203` and prune selectors at `src/styles/battle-layout.css:117-158,833-836` and `src/styles/accessibility.css:367-415`.
- Keep arena pulse effects themselves. In particular, Astral’s visible `+15` when Focus was already present at `src/battle/engine.js:928-933` remains.

#### Mastery combat perks

- Remove rank-based Signature discount from `signatureCostFor()` at `src/battle/engine.js:49-52`; retain only innate/passive cost differences such as Sunborn’s 80 cost.
- Remove `masteryRank` combatant state and rank-2 barrier/rank-3 HP in `makeCombatant()` at `:54-68`, plus rank entry Éclat at `:247-253`.
- Remove `masteryRanks` from `createBattle()` and its controller construction at `src/battle-ui/controller.js:98-100`.
- Remove the mastery-surge playback branch at `src/battle-ui/playback.js:228-232`.
- Keep mastery XP/rank calculations, save validation, rank stars, title/results progress, and cosmetic auras. Remove perk prose from creature cards at `src/screens/team-select.js:151`, result rank-up text at `src/screens/results.js:325`, bestiary perk lines at `src/screens/bestiary.js:105-108`, and codex/perk styles at `src/styles/battle-presentation.css:1464-1486`.

#### Rally and Final Duel

- At `src/battle/engine.js:391-421`, retain automatic-replacement Rally timing/event/cinematic but remove the `+18` Éclat and Focus application. The event no longer carries `surge: 18`.
- At `src/battle/engine.js:311-323`, retain one-shot Final Duel detection/event/cinematic but remove `+12` Éclat to both sides.
- Update Rally playback at `src/battle-ui/playback.js:256-260` to show only the rally presentation; remove the fake Focus tactical FX. Keep the Rally sound at `src/audio/sound.js:868-883`.
- Remove the `+12` subtitle from Final Duel FX at `src/battle-ui/fx.js:317-331` and its now-dead `.duel-center small` styles in `src/styles/battle-final.css:107-112,191-193`. Keep the Final Duel sound/cinematic and event cleanup.

### 1.6 Simplify performance grades

Current `gradeBattle()` at `src/data/progression.js:21-45` scores win/loss, turns, survivors, contract, combos, Signatures, contributors, and Crescendos. `src/screens/results.js:54-75` supplies all those inputs.

Replace it with exactly three factors:

```js
const victory = win ? 50 : 0;
const tempo = !win ? 0
  : turns <= 10 ? 20
  : turns <= 16 ? 15
  : turns <= 24 ? 10
  : turns <= 32 ? 5
  : 0;
const survival = Math.min(30, survivors * 10);
const score = Math.min(100, victory + tempo + survival);
```

Keep grade bands `S >= 88`, `A >= 74`, `B >= 58`, `C >= 40`, else `D`, and keep bonus mastery XP `S +3`, `A +2`, `B +1`. Breakdown becomes `{ victory, tempo, survival }` only. This guarantees losses are D, a slow one-survivor win is B (60), a ≤24-turn two-survivor win is A (80), and a ≤16-turn three-survivor win is S (95). Add `grade.victory`; remove style/contract keys. Generic result and gauntlet breakdown rendering may remain if it iterates entries, but its inputs and assertions must be reduced.

## 2. File-by-file UI and context repair

### Data and application context

- Delete `src/data/contracts.js` and `src/data/synergies.js` after relocating the silent achievement predicates.
- `src/data/team-profile.js:4,52-56,96,103`: remove Bonds and doctrine recommendation; Smart Remix returns `{ team, lead }`.
- `src/data/squads.js:1-10`: remove `doctrine` from every preset.
- `src/app/context.js:12,16,26,37`: remove deleted imports; add the engine’s `canUseTrainerCommand` import.
- `src/app/context.js:68,81,92,105`: remove `flow` and `resonance` from log types/groups.
- `src/app/context.js:193-199,207-227`: delete `bondsHtml`; simplify draft insight to combo routes/affinity without Bond comparisons.
- `src/app/context.js:246-274,312`: remove Bonds, Contracts, doctrine recommendation, resonance, and bond-render exports; export `canUseTrainerCommand`.

### Screens

- `src/screens/team-select.js:14,22,40,82-84`: remove contract/doctrine/Bond dependencies and selection state.
- `src/screens/team-select.js:151`: retain mastery stars/rank, remove perk text.
- `src/screens/team-select.js:177-210,229-246`: remove recommended contract, contract controls, doctrines, and doctrine text in saved squads.
- `src/screens/team-select.js:290-303`: plan drawer retains difficulty, arena rule/quick rule, team profile, combo routes, and matchup; mobile secondary label becomes arena, not doctrine. No contract/doctrine/Bond content.
- `src/screens/team-select.js:349-398,438-462`: remove doctrine/contract handlers and payloads; presets/remix/custom save/load/gauntlet/battle use `{ team, lead }`.
- `src/screens/draft.js:13,27,48,77-83,101,146-164`: remove doctrine/Bond state, reveal, handler, and config. Keep team profile, combo routes, and lead.
- `src/screens/gauntlet.js:19-20,39,87-90`: remove doctrine and contract reward paths.
- `src/screens/results.js:14-15,54-95,150-219,266,286-288,325,331-349`: reduce grading, use silent achievement signals, remove contract completion/reward/XP and Crescendo recap, strip doctrine from rematch, and remove mastery perk prose.
- `src/screens/title.js:50,53`: remove completed-contract count; retain best grade and other career stats.
- `src/screens/academy.js:38-46`: replace the seven mechanics with five: Éclat, Coach, Perfect Relay, Assist, Final Duel. Remove Flow and Contracts.
- `src/screens/trials.js:37`: remove doctrine from battle config.
- `src/screens/bestiary.js:105-108`: retain mastery rank/collection treatment, remove perk line.

### Battle UI

- `src/battle-ui/controller.js:9-24,94-100,126-137`: remove Bond/Contract/resonance imports and doctrine/mastery/contract battle setup.
- `src/battle-ui/controller.js:161-177`: nameplate shows arena identity/rule only; remove resonance and contract pieces.
- `src/battle-ui/controller.js:198,234`: retain the button/listener but label it Coach.
- `src/battle-ui/controller.js:252-335`: rebuild codex without doctrine, contract, Bonds, Flow, resonance, or mastery perks. Retain arena, flat Éclat, universal Coach, Perfect Relay, combo routes, boons/statuses/affinity, and Final Duel.
- `src/battle-ui/controller.js:449-451`: remove the contract intro card.
- `src/battle-ui/controller.js:473-500,531-537,580-588`: remove resonance metadata/preview, Flow chip, and contract progress chip; keep arena cadence and the Éclat gauge.
- `src/battle-ui/controller.js:572-579,680-699`: drive button disabled/title state through `canUseTrainerCommand`; continue dispatching the universal engine command.
- `src/battle-ui/hud.js:24,169-171,221-239`: remove Bond detail, Flow preview, and Flow context classes/tags. Keep cosmetic mastery rank.
- `src/battle-ui/fx.js:245-289,317-345,455-487`: delete Flow/resonance FX and exports, simplify command variant mapping, remove Final Duel bonus text, and retain command/Rally/Final Duel cinematics.
- `src/battle-ui/playback.js:28-32,72-73,96-141,228-260,305-308`: remove Flow/resonance/mastery-perk handlers and delays; retain one Coach handler; simplify Rally; preserve Final Duel cleanup.

### CSS cleanup

- `index.html:16`: remove `contracts.css` after relocating its unrelated live blocks.
- `src/styles/contracts.css:1-65,345-413`: delete contract and Flow styles; relocate `:67-343` before deleting the file.
- `src/styles/progression.css:755-831,1228-1273`: delete team-Bond, doctrine, contract-chip, and contract-reward sections. Keep Rally at `:1222-1227` and general mastery collection styling.
- `src/styles/overrides/selection.css:310-334,461-471,850-852`: delete doctrine recommendation, contract preview, and doctrine responsive rules.
- `src/styles/accessibility.css:37,83-85,367-415`: prune doctrine selector and delete Flow/intro-contract/codex rules.
- `src/styles/battle-combos.css:110-203`: delete resonance blocks/keyframes; keep combo styles from `:205` onward.
- `src/styles/league.css:509-627`: delete Flow/Crescendo styles.
- `src/styles/battle-final.css:2-8,107-112,191-250`: delete Flow codex/live and obsolete duel bonus subtitle; retain Final Duel presentation.
- `src/styles/battle-layout.css:117-158,815-822,833-836,879-905`: prune resonance/contract selectors, remove Flow hiding and mobile contract layout, and restore the arena nameplate on mobile instead of hiding it with the former contract layout.
- `src/styles/battle-presentation.css:1130-1132,1215-1240,1459,1464-1486`: delete Bond, mobile contract, contract selector, and mastery-perk/codex rules. Keep cosmetic mastery aura/reward styling.
- `src/styles/components.css:540-554`: delete Crescendo recap styling.
- `src/styles/battle-command.css:1-191`: retain generic button/codex/FX styles; collapse any doctrine assumptions to `command-coach`.

## 3. Localization inventory

Delete **80 unique keys / 160 FR+EN dictionary entries**:

- `contract.*` — 19 keys: `contract.mission`, `contract.progress`, `contract.choose`, `contract.random`, `contract.chooseHint`, `contract.randomHint`, `contract.onslaught`, `contract.tactician`, `contract.signature`, `contract.guardian`, `contract.relay`, `contract.effect.onslaught`, `contract.effect.tactician`, `contract.effect.signature`, `contract.effect.guardian`, `contract.effect.relay`, `contract.complete`, `contract.masteryBonus`, `contract.suggested`.
- `doctrine.*` — 13 keys: `doctrine.title`, four doctrine names (`balanced`, `assault`, `bastion`, `ambush`), four `doctrine.icon.*`, and four `doctrine.effect.*`.
- Old `command.*` variants — 8 keys: `command.balanced`, `command.assault`, `command.bastion`, `command.ambush`, and the matching four `command.effect.*`.
- `bond.*` — 12 keys: `bond.title`, `bond.none`, five Bond IDs, and their five `bond.effect.*` keys.
- Battle Flow — 12 keys: `battle.flow`, `battle.flowLine`, `battle.flowCrescendoLine`, `battle.flowCrescendoCappedLine`, `battle.flowPeakLine`, `battle.flowPeakCappedLine`, `battle.flowCrescendo`, `battle.flowRefresh`, `battle.flowPeak`, `battle.flowGain`, `battle.flowReset`, `battle.flowHint`.
- Resonance — 4 keys: both `arena.resonance*` keys and both `battle.resonance*` keys.
- Mastery combat perks — 7 keys: `mastery.perks`, `mastery.perk.1` through `mastery.perk.5`, and `battle.masterySpark`.
- Singletons — 5 keys: `academy.contract`, `grade.style`, `grade.contract`, `result.crescendos`, `draft.newBond`.

Add **3 unique keys / 6 FR+EN entries**:

| Key | French | English |
|---|---|---|
| `command.coach` | `Coup de pouce` | `Coach Boost` |
| `command.effect.coach` | `Si ta créature active a un malus : retire tous ses malus et gagne +15 Éclat. Une fois par combat, sans utiliser ton action.` | `If your active creature has a penalty: remove all its penalties and gain +15 Surge. Once per battle, without using your action.` |
| `grade.victory` | `Victoire` | `Victory` |

Update, rather than delete, the existing copy for `academy.surge`, `academy.command`, `battle.command`, `battle.commandUsed`, `battle.commandLine`, `battle.finalDuelLine`, `battle.finalDuelHint`, `battle.rally`, `grade.title`, `grade.bonus`, `loadout.hint`, `draft.ready`, `squad.hint`, `mastery.xp`, `battle.plateHint`, `trial.effect.unbroken`, and `feat.effect.contract_hero`. Remove promises of Flow, Bonds, doctrines, perk effects, contract selection, or hidden Rally/Final Duel Éclat.

Keep localized content whose words are merely names: `trainer.resonance`, `badge.resonance`, `move.resonant_focus`, and `move.crescendo_lock`. Run the existing FR/EN key-parity assertion after the edit.

## 4. Save v15 migration

### Migration behavior

- Bump `SAVE_VERSION` at `src/data/save.js:6` from 14 to 15.
- Append `migrateV14` after the existing migrations at `src/data/save.js:40-78` and add it to the migration array at `:80-94`.
- Migrate `customSquads: { team, lead, doctrine }[]` to `{ team, lead }[]`.
- Preserve all other fields byte-for-byte through migration. Validation may continue normal sanitization, but must retain mastery, records, feats including `contract_hero`, trials/mode wins, streaks, settings, `contractsCompleted`, and `bestGrade`.
- There is no other persisted doctrine or contract choice: current draft, gauntlet, and battle selection are in-memory. No additional save-field deletion is needed.
- Keep `contractsCompleted` in the default object and numeric validator at `src/data/save.js:195-197`; it becomes frozen legacy data.

Exact body sketch:

```js
export const migrateV14 = save => ({
  ...save,
  version: 15,
  customSquads: Array.isArray(save.customSquads)
    ? save.customSquads.map(squad => (
        squad && typeof squad === 'object'
          ? { team: squad.team, lead: squad.lead }
          : squad
      ))
    : save.customSquads,
});
```

At `src/data/save.js:142-152`, remove doctrine whitelist validation and emit only `{ team: [...], lead }` for each valid squad. Fresh saves retain all current progression fields and simply start at v15.

### Save and localization tests

- `test/i18n-save.test.js:34` — **rewrite** “personal squad slots preserve only legal teams and leads”: supply v14 `{team,lead,doctrine}` objects, assert doctrine is stripped, invalid teams are rejected, and invalid leads are normalized.
- `test/i18n-save.test.js:59` — **rewrite** older-save migration expectation to v15; explicitly assert preservation of `contractsCompleted`, `bestGrade`, mastery, and `contract_hero`.
- `test/i18n-save.test.js:112` — **rewrite** performance-grade cases for the new three-factor formula and D–S thresholds.
- The existing feat-count assertion — **keep** at 12; `contract_hero` remains a legal legacy feat.
- `test/audio.test.js:80` “migration chain ... v14” — **rewrite/rename** for v15: expect `SAVE_VERSION === 15`, 14 migrations, every intermediate version, v12→v15 traversal, and a v14 legacy custom-squad case.
- The v13 simple-mode migration test — **keep**, now expecting traversal through v15.
- `e2e/helpers.js` save fixture/version — **rewrite** from 14 to 15. Keep any deliberate v13 fixture in `e2e/simple-mode.spec.js` to preserve migration coverage.

## 5. Unit-test repair map

Exact displayed test names should be preserved where still meaningful; names below use their current wording/snippets where the suite’s full sentence is longer.

### `test/engine.test.js`

- “team Surge locks signatures...” — **rewrite** for `+20/+25`, proportional 25% damage intake, and passive-only Signature cost.
- “alternating techniques...” — **replace** with a flat-gain table test covering damaging, support, miss, direct HP damage, and barrier absorption.
- “Battle Flow crescendo...” — **delete**; ordinary cooldown is already covered by the earlier cooldown test.
- “veteran mastery...” — **replace** with a regression proving mastery rank does not change HP, barrier, entry Éclat, or Signature cost.
- “arena powers awaken...” — **keep**, adding an assertion that no `resonance` event occurs.
- “arena resonance...” — **replace** with an assertion that matching affinity grants no extra Éclat.
- “innate talents...” — **rewrite** Monolith’s expected opening barrier from the Bond-inflated value to its innate Foundation value (14); Sunborn’s innate cost remains.
- “team bonds...” — **replace** with neutral composition openings: 30 Éclat and no recipe status/barrier effects.
- “battle doctrines...” — **replace** with absence/ignoring of doctrine input and neutral openings.
- “each doctrine ... Trainer Command” — **rewrite** as one Coach test matrix: unavailable without a penalty, removes all penalties, grants exactly 15, emits `command:'coach'`, consumes no action, is once-per-battle, and does not mutate rejected states.
- “gauntlet boons...” — **rebaseline** neutral player start to 55 for the explicit `+25` boon and enemy start to 30; retain boon assertions.
- “knockout ... replacement” — **rewrite** to assert Rally event/cinematic with unchanged Éclat and no Focus.
- “last fighters ... Final Duel” — **keep/rewrite** to assert one event and no Éclat change/event.
- “multi-hit ... `crescendo_lock`” — **keep**; this is a move ID, not Battle Flow.
- Assist and Perfect Relay tests — **keep** their explicit `+8`/`+6` behavior.
- Preview parity tests — **keep** as broad regression coverage after rebaselining.
- Late-pressure tests — owned by Stage 2; remove/rebase there and ensure Stage 3 does not reintroduce them.

### `test/data-ai.test.js`

- “team bonds...” — **delete/replace** with no composition-mechanics data/export.
- “eight signature squads...” — **rewrite** to remove doctrine assertions while retaining roster/lead validity.
- Team Compass recommendation test — **rewrite** without `recommendedDoctrine`; keep axes/coverage.
- Smart Remix test — **rewrite** for `{team,lead}`, no Bond score, and no doctrine.
- Contracts/progress test — **replace** with exact tests for all five `battleAchievementSignals` predicates and their non-UI nature.
- “Standard AI ... Flow...” — **delete**.
- “every AI difficulty...” — **keep**.
- “successive tied...” — **keep**.
- “Champion ... pivot ready Signature” — **keep**, rebaseline only if removed score terms change the fixture.
- “Champion switch scoring...” — **audit/rewrite**: remove the `state.turn = 4` resonance artifact and recompute exact expected choice.
- “Champion reply forecasts...” — **keep/audit** exact scores.
- “Standard and Champion second-ranked...” — **recompute** deterministic counts if ordering changes.
- Other AI legality/determinism tests — **keep**; only update fixtures containing `flow`, `lastMoveId`, `bonds`, `doctrine`, `masteryRank`, or resonance expectations.
- Late-pressure AI test — Stage 2 ownership; delete there.

### Other unit suites

- `test/i18n-save.test.js` — apply the save/grade rewrites above; keep FR/EN parity and feat count.
- `test/audio.test.js` — apply the v15 migration rewrite above; delete any direct `sound.resonance` expectation, retain Rally/Final Duel/Clash coverage.
- `test/draft.test.js` — **keep/rebaseline** generated run objects to `{team,lead}` and remove Bond/doctrine insights if asserted.
- `test/advice.test.js` — **keep**; Signature/spend advice remains, but remove deleted state fields from fixtures.
- `test/preview.test.js` — **keep/rebaseline** Éclat values and deleted state fields.
- `test/presentation.test.js` — **keep/rewrite** snapshots/selectors for removed chips/codex/FX; retain coach/Rally/Final Duel.
- `tools/simulate-balance.mjs` — after Stage 2 removes its late-pressure arguments, run it against flat Éclat and update only documented baselines, not its model to emulate removed systems.

## 6. E2E repair map

### `e2e/gameplay.spec.js`

- “configures ... quick battle” — **rewrite** without contract/Crescendo expectations; keep grade, mastery reward, recap, and save assertions; grade breakdown has exactly victory/tempo/survival.
- “quick rules...” — **keep/rebaseline** opening barrier to 18 where a former Bond inflated it.
- “Relay Rush...” — **keep**; it is an explicit named mode rule.
- Doctrine Trainer Command scenario — **rewrite**: induce a real penalty, press `Coup de pouce`, assert full cleanse, `+15`, used state, unchanged action opportunity, and universal codex copy.
- “restorative techniques...” — **rewrite** to use an actual restorative move instead of Balanced doctrine healing.
- “reaching full Surge...” — **rewrite** without Assault/doctrine command; use controlled moves to reach 100 and retain ready/cut-in assertions.
- “chosen contract...” — **replace** with a negative-surface test: prep, battle, codex, and results expose no contract selector/chip/reward.
- Final Duel scenario — **keep/rewrite** to assert cinematic once and no `+12` copy or Éclat grant.
- Codex scenario — **rewrite** for flat Éclat and Coach; explicitly omit Flow, contract, doctrine, Bond, mastery-perk, and resonance sections.
- Versus intro contract scenario — **replace** with absence of the intro contract card.
- “Flow is visible...” — **replace** with deterministic flat Éclat progression.
- “Flow crescendo...” — **delete**.
- Switched-assist scenario — **remove doctrine setup/rebaseline**, retain Assist behavior.
- Defeat advice/adjust scenario — **remove contract preview**, retain rematch adjustment.
- Battle chronicle scenario — **keep**, optionally assert no `flow` or `resonance` log event.
- Full seeded battle / `playVisibleBattle` scenarios — **audit/rebaseline** for changed Signature timing, without weakening completion assertions.

### `e2e/progression.spec.js`

- “expanded roster...” — **rewrite** without contract/doctrine/recommendation assertions; retain profile, scouting, and presets.
- Smart Remix scenario — **rename/rewrite** to assert team+lead only and no Bond/doctrine output.
- Personal squad scenario — **rename/rewrite** to assert team+lead persistence and v15 storage shape.
- Feat Hall scenario — **keep** and explicitly prove legacy `contract_hero` remains visible/valid; feat count remains 12.
- Academy scenario — **rewrite** seven mechanics to five and update flat Éclat/Coach copy.
- Doctrines scenario — **replace** with absence of doctrine choices and neutral battle opening.
- Gauntlet scenario — **remove doctrine selection**; expect 30 neutral initial Éclat and 55 only when the explicit +25 boon applies, subject to Stage 1 rebase.
- Daily draft scenario — **remove doctrine controls/assertions and old 65 opening expectation**; retain team profile, routes, and lead.
- Required-viewports scenario — **remove contract-chip expectation**; retain responsive battle controls.
- Trial expectation `100/80` for Sunborn — **keep** if it derives from the innate passive, not mastery.

### `e2e/battle-layout.spec.js`

- Remove doctrine selection and its Exposed opening expectation.
- Rebaseline fortress/opening barrier where Bonds formerly contributed; retain layout and interaction coverage.
- Add/retain Coach button placement coverage in both desktop and mobile layouts.

### `e2e/simple-mode.spec.js`

- Rewrite assertions that currently expose arena resonance, contracts, or Flow.
- Simple and expert modes must both omit the removed systems; expert mode may still show richer move/status detail, but cannot restore them.
- Keep the deliberate v13 save fixture and assert successful migration to v15.

### `e2e/helpers.js`

- Update generated save version and custom-squad shape.
- Remove helpers that select doctrines/contracts or wait for Flow/Crescendo chips.
- Rebaseline battle-driving heuristics for the new Signature cadence rather than adding hard-coded extra turns.

## 7. README and documentation repair

Update all Stage-3-facing sections in `README.md`:

- Feature/system overview: remove Contracts, Doctrines, Bonds, Battle Flow/Crescendo, arena resonance, and mastery battle perks.
- Battle loop and Éclat explanation: document the `20 damaging / 25 support / 25% direct HP damage` baseline and named visible exceptions.
- Controls: document one conditional, once-per-battle Coach button.
- Team building/draft/Smart Remix: describe profile, affinity, coverage, routes, and lead without composition recipes or doctrine recommendation.
- Progression: mastery ranks are cosmetic collection progression; `contract_hero` and `contractsCompleted` are legacy-preserved only.
- Performance grades: victory + turns + survivors, D–S.
- Save schema/migration history: v15 strips `customSquads[].doctrine` and preserves all progression.
- Testing/balance notes: remove Flow/Crescendo and contract examples; update expected initial Éclat and Signature cadence.

Also search documentation for the literal/system terms `contract`, `doctrine`, `bond`, `Battle Flow`, `Crescendo`, `resonance`, `mastery perk`, `Rally`, and `Final Duel`. Do not blindly replace lexical content names identified in the non-goals.

## 8. Ordered implementation checklist

This is too broad for one reliable Sol high session: it crosses the engine, AI, save schema, every major screen, battle playback, localization, CSS ownership, and four E2E files. Split after the visible loadout systems and v15 migration, with a genuinely green intermediate state.

### Session A — loadout-system removals, Coach, and v15

1. Rebase onto completed Stage 1/2; inventory changed lines and confirm the canonical eight negative statuses.
2. Add `battleAchievementSignals` and result feat mapping; freeze legacy contract fields/feat behavior.
3. Remove Contracts and Bonds from data/context/engine setup; remove their screen, controller, HUD, codex, and result surfaces.
4. Remove doctrines and implement `canUseTrainerCommand` plus universal Coach in the engine and controller.
5. Convert presets, remix, draft, gauntlet, trials, rematch, and custom squads to `{team,lead}`.
6. Implement v15 migration/validation and update save fixtures/tests.
7. Relocate Ace/battle-log/temporary Flow CSS out of `contracts.css`, then delete contract/doctrine/Bond CSS and the stylesheet link.
8. Apply the Contract/Doctrine/Bond/Coach localization additions, deletions, and copy updates.
9. Rewrite directly affected engine/data/save/audio unit tests and the loadout/Coach/legacy-feat E2E scenarios.
10. Run formatter/lint, all unit tests, and all E2E tests; finish Session A only with a neutral 30-Éclat opening and still-functional pre-Session-B Flow/resonance/mastery/Rally/Final Duel behavior.

Safe intermediate state: no contracts, doctrines, or Bonds exist in play or UI; saves are v15; Coach works; every remaining Flow/resonance/mastery modifier is internally unchanged and tested. This state is releasable even though the second simplification half is pending.

### Session B — battle-math removals, grades, and final cleanup

1. Introduce the flat Éclat constants/helper and update engine gain sites.
2. Remove Flow/Crescendo state, events, cooldown logic, AI score, log/playback/FX/UI/CSS, and result stat.
3. Remove arena resonance from engine, AI, context, controller, sound, playback, FX, CSS, and localization.
4. Remove mastery combat fields/perks while retaining all cosmetic/progression data and displays.
5. Strip Rally Focus/`+18` and Final Duel `+12`; retain and verify both cinematics.
6. Simplify `gradeBattle` and result inputs/breakdown to victory, turns, survivors.
7. Complete localization deletion/key parity and academy/codex copy.
8. Rewrite/rebaseline the remaining unit and E2E scenarios listed above.
9. Update README and save-schema notes; run targeted searches proving removed event types, fields, exports, keys, and selectors have no live references.
10. Run formatter/lint, unit suite, balance simulation, and full E2E suite. Check median first-Signature timing and adjust only the three flat baseline constants if the one-action tolerance is missed.

### Final verification searches

Use scoped searches, reviewing lexical-name exceptions rather than demanding zero raw matches:

```sh
rg "contractProgress|CONTRACTS|contractId|contractComplete|recommendedDoctrine|BATTLE_DOCTRINES|\.doctrine|teamBonds|BONDS|bondsHtml" src test e2e
rg "type: 'flow'|case 'flow'|\.flow\b|lastMoveId|flowCrescendo|flowPeak" src test e2e
rg "ARENA_RESONANCE|type: 'resonance'|resonanceFx|sound\.resonance" src test e2e
rg "masteryRank|mastery\.perk|masterySpark" src test e2e
rg "surge: 18|source: 'rally'|source: 'final-duel'|\+12" src test e2e
rg "grade\.style|grade\.contract|result\.crescendos|draft\.newBond" src test e2e
```

Acceptance criteria:

- No pre-battle Contract or doctrine choice, no Bond recipe effect/reference, and no Flow/resonance HUD or event exists.
- Coach is conditional, free, once per battle, authoritative in the engine, fully cleansing, and worth exactly +15.
- Mastery rank never affects combat math; Rally and Final Duel remain cinematic-only.
- Grade input and breakdown contain only victory, turns, and survivors.
- v14 custom squads migrate to team+lead; all progression and legacy Contract history/feat survive v15.
- FR/EN keys are symmetric, no removed key is referenced, all unit/E2E suites are green, and Signature cadence remains within one action of the current median after Stage 1 rebase.

## Implementation deviations (2026-08-14)

- The flat Éclat table was implemented unchanged; no calibration adjustment was needed. The balance simulator now reports and gates the plan's Signature reference explicitly: 0.7–2.6 uses per side-battle and a median first use between actions 3 and 5 (the stated 1–2 uses / fourth-action baseline expanded by ±30%).
- Champion resistant-switch scoring was raised from 24 to 44 after the hidden opening bonuses disappeared. This preserves the surviving behavior that a Champion pivots into a resistant bench answer against a ready Signature; it adds no new mechanic or information advantage.
- The repository's progression E2E file is `e2e/progression-responsive.spec.js`, not `e2e/progression.spec.js`; the planned rewrites were applied to the existing file.
- Playwright execution remains delegated to the orchestrator because it is sandbox-blocked here. All edited E2E files pass static JavaScript parsing, and their positive selectors were checked against the generated DOM/templates.
