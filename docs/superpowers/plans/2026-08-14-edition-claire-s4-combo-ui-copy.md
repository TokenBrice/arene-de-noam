# Édition claire — Stage 4: Combo, UI repair, and kid-clear copy

**Date:** 2026-08-14  
**Scope:** implementation plan only  
**Repository:** `/Users/ahirice/Documents/claude-bordel/noam-game-2`

## Working assumptions and landing contract

Stages 1–3 may land while this work is in progress. The line references below describe the audited pre-Stage-4 tree on 2026-08-14; rebase by symbol/function, not by copying line numbers blindly. Stage 4 starts only from a green S1–S3 baseline with the 2×/0.5× affinity cycle, the eight-status diet, removed contracts/doctrines/bonds/Flow/resonance/mastery combat perks/rally/final-duel bonuses, save v15, simple grades, and one universal Trainer Command.

Stage 4 has one player-facing vocabulary:

- **Marqué / Marked** is the only setup token.
- **Combo** is the only setup-to-finisher payoff.
- **+40% damage** is the only Combo reward.
- A different ally who applied Marqué receives the existing portrait cut-in as credit, but the Combo grants no extra Éclat and has no second “assist” or “detonation” economy.
- `records.assists` and the `team_assist` feat remain readable legacy history. New play counts `combos`, never `assists`.

The implementation must not revive an S1–S3 system merely to preserve an old selector, CSS class, copy key, or E2E assertion.

## 1. Combo unification specification

### 1.1 Player rule and balance number

The complete rule shown to players is:

> **Combo : une technique Combo consomme Marqué et inflige +40 % de dégâts.**  
> **Combo: a Combo move consumes Marked and deals 40% more damage.**

Use one exported constant, `COMBO_DAMAGE_MULTIPLIER = 1.4`. Apply it once to the move's power for the whole damage transaction. It affects every hit of a multi-hit finisher, but creates one Combo occurrence per action.

Why 40% after S1:

- It is large enough for a 12-year-old to see and remember, and `×1.4` is a single mental model.
- It replaces legacy bonuses ranging from +18% to +55%, flat +16/+22 detonations, Marqué's generic +12%, and the cross-ally +8 Éclat. It is not added on top of them.
- With S1's effective affinity the ceiling is `2 × 1.4 = 2.8` before other authored move modifiers. Concentré can still make a deliberately prepared burst, but no hidden detonation value or Éclat refund compounds it.
- The single constant gives the balance simulation one knob. If S1's final power pass makes 40% too lethal, tune the one constant only; do not restore per-move multipliers.

Acceptance balance checks for the implementation session: compare neutral and effective setup→finisher KO rates before/after, make sure an ordinary neutral non-Signature Combo does not routinely erase a full-health equal-stat target, and keep whole-roster Champion win rates inside the post-S1 gate.

### 1.2 `src/data/moves.js` data model

Current anchors: `bonusAgainst` at lines 24, 74, 300, 378, 529, and 832; `detonate`/`detonatePower` at lines 452–453 and 753–754.

Replace all three legacy fields with one boolean on finishers:

```js
combo: true
```

Do not store `comboMultiplier` on individual moves. The multiplier is a battle rule, not authored move data. A setup is represented only by the existing `targetStatuses: [{ id: 'marked', ... }]`; do not add `setup`, `prime`, `detonation`, or affinity-specific trigger fields.

The eight legacy finishers to audit and tag are:

1. `slowing_riddle`
2. `finale_nova`
3. `continental_divide`
4. `maw_of_maelstrom`
5. `thunder_deluge`
6. `ninefold_inferno`
7. `venom_harvest`
8. `nightmare_dive`

Delete every `bonusAgainst`, `bonusMultiplier`, `detonate`, and `detonatePower` occurrence after the conversion. Add a data invariant in `test/data-ai.test.js`: every Combo finisher has positive damage, no move has a legacy field, and no Combo finisher also applies `marked`. That last rule prevents a finisher from consuming and immediately recreating its own setup token.

The post-S2 setup audit should cover the legacy setters below. Each should either apply `marked` in the landed status-diet design or have an explicit S2 note explaining why its old setup role was intentionally removed:

`lucid_arc`, `crescendo_lock`, `gravity_fist`, `undertow`, `forest_quake`, `bramble_trap`, `foam_blitz`, `bubble_burst`, `static_wake`, `scorch_mark`, `toxic_spines`, `shade_spark`, `pollen_dream`, `sonic_gloom`, `midnight_lullaby`, `moonless_omen`, and `tectonic_ram`.

Do not automatically translate every surviving control effect into Marqué. Marqué must be authored visibly on a move, and a move that applies it must say so in `move.effect.*`.

### 1.3 `src/data/combos.js` route generation

Current lines 4–36 infer routes by intersecting all target statuses with `bonusAgainst` and `detonate`, then expose `statuses` and `detonation` fields.

Rewrite `teamComboRoutes(team)` around two predicates:

```js
const appliesMarked = (move) => move.targetStatuses?.some(({ id }) => id === 'marked');
const isComboFinisher = (move) => move.kind === 'damage' && move.combo === true;
```

For team-building UI, return only cross-creature routes so the list communicates cooperation:

```js
{
  setterId,
  setupMoveId,
  finisherId,
  finishMoveId,
  signature: Boolean(finisher.signature)
}
```

Remove `statuses` and `detonation`. Sort Signature finishers first, then setter/finisher move IDs for deterministic UI and tests. De-duplicate the Cartesian product. Add a small `moveCanCombo(move)` export only if both engine/AI and UI need it; otherwise keep predicates local and avoid a new abstraction.

Update `src/app/context.js:201–204` so route cards always show `⌖ → COMBO`, not a list of status icons or a detonation glyph. Update `src/app/context.js:210–218` so draft insights say “nouvelle route de Combo / new Combo route”; remove bond deltas at the same time if S3 has not already done so.

### 1.4 Engine transaction and preview parity

Current anchors are `scaledPower()` at `src/battle/engine.js:526–557`, `resolveDamageTransaction()` at 559–702, and move execution at 732–863. Current code stacks generic Marqué damage, `bonusAgainst`, flat detonations, helper detection, and +8 Éclat.

Refactor in this order:

1. In `resolveDamageTransaction`, resolve Insaisissable/miss first. A missed finisher does **not** consume Marqué.
2. Snapshot `defender.statuses.marked` before damage. A Combo is active iff `move.combo === true` and that snapshot exists.
3. If active, delete `marked` and emit the existing `status` removal event with `{ consumed: true, source: 'combo' }` before the impact.
4. Read `sourceCreatureId` from the consumed record. If it exists and differs from `attacker.id`, emit the existing `assist` event solely as an animation-credit event. Do not call `adjustSurge`.
5. Multiply move power by `COMBO_DAMAGE_MULTIPLIER` once. Remove matches, detonated arrays, flat detonation power, conductor detonation boosts, and Marqué's generic multiplier from `calculateDamage()` (`src/battle/damage.js:12,26`).
6. Resolve all hits, barriers, recoil, drain, and later status application normally. Only the first `damage` event carries the Combo object so results count one action rather than every hit.
7. `previewMove()` continues to clone and run the same transaction. It must report the exact same damage, consumption eligibility, and helper credit without mutating source state.

Target event/return shapes:

```js
// Existing status event type, emitted on consumption.
{
  type: 'status',
  side: targetSide,
  creatureId: defender.id,
  status: 'marked',
  applied: false,
  consumed: true,
  source: 'combo'
}

// Existing assist event type, emitted only for a different helper.
{
  type: 'assist',
  side,
  creatureId: helperId,
  attackerId: attacker.id,
  combo: true
}

// First damage event only.
{
  ...damageEvent,
  combo: {
    status: 'marked',
    multiplier: 1.4,
    helperId: helperId || null
  }
}
```

Later hits use `combo: null`. The transaction/preview returns the same `combo` object and `helperId`; replace the current `combo: []` and `assists: []` return API rather than keeping two concepts. The compatibility `assist` event is chronology/presentation only and must not be used for rewards, records, grades, or AI value.

Engine tests to replace around `test/engine.test.js:613–660`:

- one Marked target + one Combo finisher = exactly ×1.4 power and one consumption event;
- unmarked target or untagged move = no bonus and no consumption;
- miss preserves Marqué;
- multi-hit finisher gets the multiplier on all hits but exposes one Combo occurrence;
- same-creature setter has no helper event;
- different ally emits one compatibility `assist` event, credits the helper, and emits no `surge(source:'assist')`;
- barrier-only impact still consumes/counts the Combo;
- preview equals resolution and mutates neither source statuses nor history.

### 1.5 AI scoring

Current anchors: `src/battle/ai.js:17–62` values status count/detonation; 130–183 reads candidate detonation setup; 186–218 adds Flow scoring.

After S3 removes Flow/resonance scoring, make Combo decisions explicit:

- Damage forecast already contains the ×1.4 result, so do not add another large damage bonus. Add only a tie-breaker for spending the token: +3 Apprentice, +8 Standard, +10 Champion when `forecast.combo` exists.
- When a move applies Marqué, add +8 setup value and another +6 if the active creature or any conscious teammate owns a legal/soon-legal Combo finisher. Score −6 instead when Marqué already exists with at least as much remaining duration.
- In `scoreSwitch`, if the enemy is Marqué and a candidate has an available Combo finisher, add +12 Standard / +20 Champion. Replace the current `primed` detonation scan at lines 166–179; read the candidate, not the outgoing active creature.
- Remove style bonuses tied to `detonate`, poison/curse/soak/charge, or raw status count. Control style may value Marqué once, never once per old trigger.
- Preserve deterministic tie-breaking and source-state immutability.

Add AI cases for taking a lethal Combo, preferring a Combo-capable switch on Champion, not switching to a finisher whose move is on cooldown, and not overvaluing an already-refreshed Marqué.

### 1.6 FX, sound, chronology, records, and feats

Reuse rather than duplicate:

- Keep the existing damage `combo-impact` treatment in `src/battle-ui/fx.js:95–109` and the corresponding impact sound layer in `src/sound.js:1016`.
- Rename/refactor `assistFx` (`fx.js:194–206`) to `comboCreditFx`, reusing the portrait slide, affinity color, and `sound.assist()` timbre. Player copy becomes `COMBO · préparé par {helper}` / `COMBO · set up by {helper}`. Remove the `+8 Éclat` line.
- Remove `detonationFx` (`fx.js:177–191`), `sound.detonate()` (`sound.js:1051–1070`), and their playback branch. There is no detonation callout.
- Keep the internal event type `assist` only to avoid inventing a second timing event. In `playback.js:110–115`, require `event.combo === true`, call `comboCreditFx`, and use Combo copy. It is not called an assist in UI or logs.
- Log the canonical occurrence from the first `damage.combo` event as type “Combo”. Do not log a second reward line for the helper cut-in.

Persistence and progression:

- In save v15 validation, preserve bounded `records[id].assists` exactly as legacy data and add bounded `records[id].combos`, default 0.
- New result processing increments `records[attackerId].combos` from first `damage.combo` events. It never increments `assists`.
- Bestiary shows `combos` as the current stat. If legacy `assists > 0`, show a subdued “assistances (héritage) / assists (legacy)” stat or tooltip; do not merge the values.
- `team_assist` remains in `FEATS`/`FEAT_IDS`, save validation, and the hall for owners who already earned it. Mark its description as legacy and stop awarding it in `results.js:170`. Do not silently convert it into a Combo feat.
- Results use `result.combos` everywhere, including each creature's contribution row. Remove `result.assists` from current-battle reporting.

## 2. UI repair inventory

### 2.1 Battle UI files

| Current file:line | Current drift | Target state |
|---|---|---|
| `src/battle-ui/controller.js:8–12,94–137` | Imports/configures mastery combat ranks, bonds, contracts, doctrines. | Consume the S3-clean battle config. No contract selection/resolution, no doctrine-specific state, no mastery rank passed to combat. Keep only the universal command state. |
| `controller.js:154–198` | Expert/simple class, resonance and contract top chips, doctrine-labelled command. | Keep `expert-mode`/`simple-mode`; arena name/rule always remains. Remove resonance/contract nodes. Command button always uses the universal command name/effect. |
| `controller.js:249–333` | Codex renders doctrines, Flow, bonds, resonance, mastery perks, final duel, contracts, and old routes. | Rebuild as a short field guide: arena rule, universal command used/ready, affinity cycle, switching, turn-order explanation, active eight-status details, quick/circuit rule, and `Marqué → Combo +40%`. Expert mode adds exact durations/source/helper and deeper forecast details, not removed systems. |
| `controller.js:449–451` | Versus intro presents contract. | Plain teams/rival quote/arena intro; no empty mission space. |
| `controller.js:475–587` | Resonance countdown annotation, mastery fighter aura, Flow chip, contract progress, doctrine command labels. | Keep turn/arena pulse countdown; expert may show exact pulse timing. Remove all dead chips. Update universal command once. Status rendering handles exactly eight IDs. |
| `controller.js:593–600,708–713` | Four-step tutorial gates damage → Signature → switch. | Implement the five-beat core tutorial in section 5; no dead-system hints. |
| `controller.js:654–657` | Switch cards concatenate every status icon and always include detailed forecasts. | Simple mode: affinity/readability and short incoming category. Expert: exact damage, barrier absorption, action order, all status icons/durations. |
| `src/battle-ui/hud.js:8,111,169` | Mastery ranks and bond panel appear in combat detail. | Remove combat perk/rank dependencies and bonds. Keep talent, HP/barrier, eight statuses, and intent. Meta mastery remains collection/results progress only. |
| `hud.js:31–82` | Intent forecast currently uses expert mode inconsistently. | Define one policy: Apprentice always shows the action category; expert additionally shows exact move, order, damage, absorption, and lethal marker. Standard/Champion hiding rules remain difficulty rules. |
| `hud.js:112–171` | Status limit and helper source are mixed with old 21-status UI. | Simple shows up to two icons plus `+N`; expert shows up to four plus full expandable details. Marqué detail names its setter and says a Combo consumes it. |
| `hud.js:205–253` | Move cards carry Flow route/reset, assist badge, old array Combo preview, and archetype gates. | Always show move name, affinity effectiveness, cooldown/Signature readiness. Expert adds exact damage/order, full effect sentence, priority/multi-hit/drain tags. Replace assist badge with one `Combo +40%` badge; if cross-ally, add `par {name}` only in expert detail. |
| `src/battle-ui/playback.js:24–34,64–76` | Timing table/imports include detonation, Flow, resonance, rally, final duel, assist. | Remove dead handlers/timings. Keep the compatibility `assist` timing renamed conceptually to Combo credit. |
| `playback.js:110–178` | Assist grants separate copy; detonation is inferred from status removal. | `assist && combo` plays helper credit only. First `damage.combo` owns the “COMBO” action line/impact. Consumed Marqué removal is silent except for the Combo line. |
| `playback.js:228–260,293–311` | Mastery spark/resonance/rally/final-duel cleanup remains. | Delete dead branches/classes after S3 and ensure queue grouping still releases input after Combo credit + damage. |
| `src/battle-ui/fx.js:95–109` | Existing generic Combo impact is useful. | Keep and adapt to structured `event.combo`. Announce once on first hit. |
| `fx.js:177–206` | Separate detonation and assist cinematics. | Delete detonation; rename/reuse assist portrait cut-in as Combo helper credit with no Éclat. |
| `fx.js:245–270,322–344,451–489` | Flow, final duel, resonance FX and exported cleanup classes. | Remove dead functions/exports/classes after S3; preserve move-authored animations whose names contain “crescendo” or “resonant” but are just technique names. |

### 2.2 Screens and shared render helpers

| Current file:line | Current drift | Target state |
|---|---|---|
| `src/screens/team-select.js:10–41,82–84` | Imports mastery perk, contracts, doctrine recommendation, bonds; selection stores doctrine/contract. | Remove those dependencies/state. Selection is team, lead, difficulty, arena, and optional surviving quick rule. |
| `team-select.js:138–151` | Cards show mastery perk text. | Keep a small cosmetic mastery rank as collection progress; remove perk sentence and any suggestion of combat power. |
| `team-select.js:179–233` | Contract recommendation/control and four-doctrine picker. | Delete. Use the space for a short matchup panel and universal Trainer Command reminder. |
| `team-select.js:246,290–303` | Saved squads store/show doctrine; plan summary includes doctrine/contracts/bonds. | v15 squad cards store/show trio + lead only. Plan summary is difficulty · arena. Keep affinity matchup and universal Combo route cards. Mobile dock shows lead/arena, not doctrine. |
| `team-select.js:349–462` | Doctrine/contract listeners and battle config. | Delete listeners/fields; start modes with the universal command implicit. |
| `src/screens/draft.js:9–28,48,77–101,146–164` | Draft carries doctrine, bonds, combat mastery, and old assistance insights. | Draft remains three picks + lead + rival/arena. Show affinity coverage and up to two universal Combo routes. No doctrine choice. Rank badge remains cosmetic; no perk promise. |
| `src/screens/results.js:14–15,54–225` | Contracts influence grade/XP; assists award feat/records; crescendos/style inflate grade. | Use S3 simple grade only. Remove contract/crescendo inputs. Count one Combo per first `damage.combo`; increment `records.combos`; do not award `team_assist`. |
| `results.js:248–349` | Contribution report says assists, recap includes Crescendos, contract reward, mastery perk unlock copy, rematch carries doctrine/contract. | Contribution and recap say Combos. Remove Crescendo/contract cards and dead rematch config. If meta mastery survives, reward row shows XP/rank only, never a combat perk. |
| `src/screens/academy.js:17–52` | Seven “master plays,” 21 effects, separate boon/malus columns; includes Flow, doctrine command, assist, contract, final duel. | Replace with eight “L’essentiel / Essentials” concept cards plus the six-affinity strip and one eight-effect grid; see section 5. |
| `src/screens/bestiary.js:105–108` | Detail presents mastery perk as a combat unlock. | Keep collection progress; remove perk line. Every move uses rewritten short effect copy. Record card promotes Combos and labels nonzero assists legacy. |
| `src/screens/settings.js:11,40–41` | “Mode expert” claims vague tactical depth. | Keep persisted `expertMode`, relabel “Détails tactiques / Tactical details,” and state exactly what appears. See section 2.4. |
| `src/screens/tutorial.js:6–34` | Battle setup supports current four-step script. | Keep deterministic 2v2 setup; adjust enemy script for five steps and only the core concepts. |
| `src/screens/gauntlet.js:19–39,77–90` | Run carries doctrine; between-round UI can show contract reward/perk implication. | Remove doctrine/contract. Keep boon, lead, wounds, simple grade, and cosmetic mastery reward only. |
| `src/screens/trials.js:37` | Hard-codes balanced doctrine. | Remove the field. |
| `src/screens/title.js:43,50–53` | Career strip includes contract completions and may imply mastery power. | Remove contract counter. Keep concise wins/grade/emblems/collection mastery; label mastery as collection progress, not combat perks. |
| `src/screens/league.js:39–40` | Ace presentation remains valid. | Keep; only recheck copy against the eight statuses and removed rally/final-duel vocabulary. |
| `src/app/context.js:8–37,68–107` | Shared imports/log taxonomy expose dead systems. | Remove S3-dead exports/types. Map helper-credit `assist` events to `combo` in the log, or suppress the duplicate and log `damage.combo` once. |
| `src/app/context.js:193–218` | `bondsHtml`, status-specific/detonation route cards, bond/assist draft deltas. | Delete bonds helper. Simplify route helper to `Marqué → Combo`; draft insight says Combo. |
| `src/app/shell.js:77–96` | Bestiary record schema/render only knows assists. | Add `combos`; show legacy assists only when nonzero and clearly marked. |
| `src/i18n.js` | Duplicate early/late assignments contain live and shadowed old copy. | Update the final effective FR/EN values, then remove duplicate shadowed declarations for touched keys so later `Object.assign` calls cannot silently restore old terminology. |

### 2.3 Styles inventory

Do not delete a whole stylesheet merely because its filename is historical; remove dead selector blocks and keep unrelated Ace/log/quick-rule styling.

| Current file:line | Action |
|---|---|
| `styles/screens/battle-combos.css:1–108` | Rename `.team-assist-ready`, `.assist-call`, `.assist-mode`, and `assistCutin` to Combo equivalents while preserving layout, responsive sizing, and reduced-motion behavior. Remove the Éclat-colored reward subline. |
| `battle-combos.css:110–203` | Delete arena resonance chip/note/sigil/mode/keyframes. |
| `battle-combos.css:205–268` | Keep route layout, simplify center to a fixed Marqué icon and “+40%”, and support the empty state. Lines 270–394 are camera/quick-rule styling and stay. |
| `styles/screens/battle-layout.css:119–155,833–902` | Remove resonance/contract nameplate branches. Keep a single arena nameplate layout at all viewports. |
| `battle-layout.css:674–684,1013–1017` | Rename assist badge selectors to Combo/helper badge. |
| `battle-layout.css:815–819` | Remove Flow chip layout. |
| `battle-layout.css:1201–1308` | Keep two density modes, but make them “core” vs “tactical details”: exact-number/order/context selectors belong to expert; all actionable controls, affinities, status identity, cooldown readiness, and Combo availability remain in both. |
| `styles/screens/contracts.css:1–65` | Delete contract form/preview. Keep lines 67 onward that style Ace, chronicle, and other surviving UI. |
| `contracts.css:345–413` | Delete Flow chip/route/reset/flash blocks and keyframes. |
| `styles/screens/battle-final.css:1–250` | Delete the entire dead Flow/final-duel stylesheet content; then remove its `<link>` from `index.html` if the file becomes empty. |
| `styles/screens/league.css:509–625` | Delete Flow Crescendo callout/keyframes; retain League styling above. |
| `styles/screens/progression.css:513–533` | Keep cosmetic rank card styling; delete fighter mastery aura/combat implication. |
| `progression.css:656–726` | Keep collection/results mastery progress; no perk styling. |
| `progression.css:755–832` | Delete bond and doctrine blocks. |
| `progression.css:1187–1193` | Keep/rename universal Combo-ready tag. |
| `progression.css:1194–1206` | Delete detonation-prime treatment. |
| `progression.css:1222–1273` | Delete rally and contract chip/reward blocks. |
| `styles/overrides/selection.css:310–331,850` | Delete doctrine recommendation/layout overrides. |
| `overrides/selection.css:461–468` | Delete contract preview recommendation overrides. |
| `overrides/selection.css:618–748` | Delete detonation callout and reduced-motion blocks. |
| `styles/screens/accessibility.css:37,68,83,367–412` | Remove doctrine/Flow/contract rules; rename high-contrast assist rule to Combo credit. |
| `styles/components.css:540–551` | Remove Crescendo recap tile styling. |
| `styles/screens/battle-presentation.css:970,976,1096,1130,1218–1237,1452–1483` | Remove dead rally keyframe, bond/contract/mastery-perk combat rules; retain generic result progress styles only if still used. Do not remove `.move-crescendo_lock` or authored move FX selectors. |
| `styles/screens/battle-fx.css:916,922,1143` | Keep: these belong to the authored move `resonant_focus`, not the deleted arena resonance system. |
| `styles/screens/results.css:1–90` | Keep the reveal/reduced-motion animation layer. Recheck that removing reward/recap children leaves no delayed empty block. |
| `styles/screens/bestiary.css:1–268` | No dead selector by name; adapt record wrapping for current Combos plus optional legacy assists and remove any empty perk gap. |
| `styles/screens/draft.css:1–355` | No dead selector by name; collapse the final panel cleanly after doctrine/bond markup disappears and keep Combo routes readable at 390px. |
| `styles/screens/gauntlet.css:1–222` | No dead selector by name; remove empty reward spacing left by contracts/perks and preserve boon/lead cards. |
| `styles/screens/selection.css:1–121` | No dead selector by name; retain shell/mobile scrolling and verify the shorter plan. |
| `styles/overrides/academy.css:1–460` | Replace the old mechanic/status-column layout with eight `.academy-core` cards and an eight-status grid; preserve 320px scrolling and focus visibility. |
| `styles/overrides/battle-command.css:1–323` | Keep the cinematic/button treatment for the one universal command; remove any doctrine-dependent modifier if discovered after the S3 rebase. |
| `styles/overrides/battle-moves.css:1–93` | Keep move silhouettes, but scope archetype/secondary decoration to tactical details and preserve compact simple cards. |
| `styles/overrides/battle-preview.css:1–54` | Scope exact exchange numbers to tactical details; provide no hidden placeholder in core mode. |
| `styles/base.css:1–431`, `styles/tokens.css:1–43` | No dead-system selectors. Keep foundations/tokens unchanged except for a shared Combo color token if it replaces duplicated literals. |
| `index.html:8–29` | Remove links only for stylesheets made empty (`battle-final.css`); retain historical filenames such as `contracts.css` while they still contain surviving Ace/chronicle rules. |

### 2.4 Expert-mode decision

Keep the saved boolean key `expertMode` for migration compatibility, but rename the setting:

- FR title: **Détails tactiques**
- FR hint: **Affiche les dégâts exacts, l’ordre prévu et tous les détails des effets.**
- EN title: **Tactical details**
- EN hint: **Shows exact damage, predicted order, and full effect details.**

Expert mode is information density only. It never gates a mechanic, legal action, status, Combo, command, talent, or arena rule.

Always visible:

- HP/barrier and Éclat/Signature readiness;
- affinity icon and effective/resisted direction;
- three moves, cooldown ready/not-ready, switching, universal command;
- status names/icons and whether Marqué enables a Combo;
- short enemy intent allowed by difficulty.

Expert-only:

- exact damage, absorption, lethal forecast, and exchange numbers;
- predicted first/second/tie order and exact priority/speed context;
- full move effect sentence and secondary tags;
- all status durations/stacks/source setter instead of the compact icon cap;
- exact arena pulse countdown and the deeper context-strip/codex explanation.

Default remains off for new v15 saves. Existing `expertMode` values migrate unchanged.

## 3. E2E triage — all 51 current cases

### `e2e/battle-layout.spec.js`

| Case | Decision | Change |
|---|---|---|
| `:15` battle plates/dock never enter stage | **Update** | Remove doctrine click and Exposé assertions; seed a surviving status such as Marqué/Enraciné through a test move or retained rule. Keep all four viewport geometry and overflow assertions. Add both tactical-details states if inexpensive. |

### `e2e/gameplay.spec.js`

| Case | Decision | Change |
|---|---|---|
| `:9` visible tutorial | **Update** | Follow Lucid Arc → Slowing Riddle Combo → Oracle Veil Signature → switch → free finish. Assert only core copy, Marqué consumption, and completion. |
| `:27` full seeded quick battle | **Update** | Remove contract chip, Crescendo, and combat-perk expectations. Keep arena, simple grade, team art, recap, report, chronicle, save counters, and cosmetic mastery XP/rank. Assert a Combos recap tile. |
| `:67` six quick battle rules/codex | **Keep** | Reword only if S1 values changed; quick rules and codex remain. |
| `:86` Relay Rush switch | **Update** | Keep the surviving quick rule; assert Accéléré and its direct rule effect, not Flow/assist language. |
| `:104` Champion Circuit unlock | **Keep** | No Stage-4 concept change; update only landed S1 numeric strings. |
| `:135` move silhouettes | **Update** | Run with tactical details on. Keep damage/support/archetype, exchange, team-dot assertions; separately assert simple mode still exposes actionable affinity/cooldown state. |
| `:152` affinity impact | **Keep** | Copy stays “efficace/effective”; expected engine multiplier belongs in unit tests. |
| `:167` multi-hit chain | **Keep** | No concept drift. |
| `:182` doctrine command | **Update** | Rename to universal Trainer Command; remove doctrine selection and doctrine-specific status. Assert one free use, its single canonical effect, FX, disabled state, and codex used state. |
| `:201` restorative command number | **Update** | Invoke the universal command directly in a damaged deterministic setup; keep the in-world heal-number assertion. |
| `:218` Signature-ready cut-in | **Update** | Remove assault doctrine/+25 setup. Use the surviving `starstorm`/trial or a deterministic Éclat seed to reach full gauge, then assert the creature-specific cut-in. |
| `:233` chosen contract | **Delete** | Contracts were removed in S3; no replacement interaction exists. |
| `:247` roster scouting | **Keep** | No dead concept; update multipliers/copy only. |
| `:259` rival Ace | **Keep** | Ace survives. Verify its effect uses only surviving statuses. |
| `:273` keyboard moves/switch | **Keep/Update** | Keep keyboard coverage; exact incoming/order assertions run with tactical details on. |
| `:292` gamepad help | **Keep** | No drift. |
| `:301` Perfect Relay | **Update** | Keep it as an advanced switch read. Assert tactical-details forecast and relay FX; use the landed S1 resistance multiplier/copy. |
| `:320` Final Duel stinger | **Delete** | Final Duel bonus/state was removed in S3. |
| `:334` detonation beat | **Replace** | Rename case to same-creature Combo. Setup Marqué, use `thunder_deluge` or another tagged finisher, assert one `.combo-impact`, `COMBO`, +40% copy, and absence of detonation/chain-reaction UI. |
| `:353` battle codex live rules | **Update** | Remove Flow, contracts, doctrine, bonds, resonance, final duel. Assert arena rule, affinity cycle, turn-order help, universal command, active eight-status details, and `Marqué → Combo +40%`; Escape still closes. |
| `:372` versus contract intro | **Delete** | Contract intro has no successor. Intro coverage remains in full-battle smoke. |
| `:382` chronicle semantic events | **Update** | Keep keyboard/open/close. Force one Combo and assert exactly one log item labelled Combo, not assist + detonation duplicates. |
| `:398` visible Battle Flow | **Delete** | Flow removed in S3. |
| `:417` Flow Crescendo | **Delete** | Flow/Crescendo removed in S3. |
| `:444` Signature clash | **Keep** | Independent surviving presentation. |
| `:462` switched teammate assist | **Update** | Rename to cross-ally Combo. Assert ready badge says Combo, portrait cut-in credits Thornox/helper, damage gets one Combo, and neither HUD nor line grants +8 Éclat. |
| `:489` tablet touch controls | **Keep** | No dead concept; run against simplified team-select markup. |
| `:507` K.O. replacement | **Keep** | Core switching behavior. |
| `:519` defeat analysis | **Update** | Remove `.contract-preview.chosen`; keep evidence-based advice and same-rival team adjustment. Combo advice must say Marqué/Combo only. |

### `e2e/progression-responsive.spec.js`

| Case | Decision | Change |
|---|---|---|
| `:9` ladder victory/save records | **Keep/Update** | Keep progression assertions; record schema now includes `combos` and legacy `assists` defaults. |
| `:30` League map | **Keep** | No Stage-4 drift beyond copy. |
| `:45` six arenas | **Keep** | Arena powers survive; no resonance sigil expected. |
| `:58` 24-creature roster/kits | **Update** | Remove contract/doctrine/bond/perk expectations. Assert trio/lead, affinity profile, Combo routes, filtering, and Bestiary handoff. |
| `:82` smart remix | **Update** | Remix produces a fresh legal trio + lead using affinity/role/Combo coverage. Remove matching-doctrine assertion. |
| `:99` personal squad slots | **Update** | v15 slots persist only `{team, lead}`; reload and clear remain. No doctrine text/field. |
| `:117` Bestiary career records | **Update** | Seed `combos` and legacy `assists`; assert Combos as current stat and nonzero assists labelled “héritage/legacy.” |
| `:136` feat hall | **Update** | Seed surviving feats plus `team_assist`; assert the latter remains earned and visibly legacy. Do not assert obsolete fixed 12/5 counts or removed contract/final-duel feats. |
| `:149` Academy rules/statuses | **Update** | Assert eight `.academy-core` cards, six affinities, eight statuses (4 positive/4 negative), Combo +40% under Marqué, and no dead vocabulary. |
| `:165` Bestiary Move Theater | **Keep/Update** | Keep 72 triggers, filters, focus trap, replay, Escape. Rewritten short move copy must appear; no mastery perk block. |
| `:195` mythic trials | **Keep** | No doctrine interaction in this case; update S1 numbers only. |
| `:213` battle doctrines | **Delete** | Doctrines removed in S3; universal command is covered in gameplay. |
| `:224` gauntlet boon carry | **Update** | Remove bastion doctrine click; keep rounds, lead, boon, wounds, and resulting state. |
| `:246` daily draft | **Update** | Remove recommended doctrine and doctrine click/opening bonus. Assert picks, rival, lead, affinity profile, Combo insight, and battle launch. |
| `:274` required viewports | **Update** | Remove contract-chip assertion; keep mobile plan, control hit areas, no clipping, and rotation. Add no-empty-gap assertion for simplified plan. |

### `e2e/simple-mode.spec.js`

| Case | Decision | Change |
|---|---|---|
| `:21` simple mode vs expert depth | **Rewrite** | Seed v15. Simple/core: no exact damage/order/full context, but affinity, cooldown/Signature, statuses, and Combo readiness remain. Toggle “Détails tactiques,” persist it, then assert exact damage, order, full effect/context and setter credit. Never assert removed resonance/contract/Flow/assist elements. |

### `e2e/smoke.spec.js`

| Case | Decision | Change |
|---|---|---|
| `:4` FR/EN boot and clean console | **Keep** | Add one short rewritten move/status string parity assertion if stable. |
| `:23` settings persist | **Keep/Update** | Include tactical-details persistence or leave that exclusively in simple-mode; keep language/audio/motion/contrast/speed. |
| `:48` corrupt save recovery | **Keep** | No drift. |
| `:55` WebGL failure | **Keep** | No drift. |
| `:64` lost context recovery | **Keep** | No drift. |

### `e2e/helpers.js` and seeded v15 shape

At `e2e/helpers.js:16–57`, change the literal version from 14 to 15 and match the S3 validator exactly. Remove `contractsCompleted`. Keep meta `mastery` as collection progress. Keep `records`, with seeded records accepting both `combos` and legacy `assists`. Custom squads use `{ team, lead }` only. The expected base fixture is:

```js
{
  version: 15,
  tutorialComplete: true,
  ladderVictories: 0,
  emblems: [],
  cosmetics: ['crystal'],
  mastery: {},
  records: {},
  customSquads: [null, null, null],
  feats: [],
  trials: [],
  gauntletWins: 0,
  draftWins: 0,
  circuitWins: 0,
  bestGrade: null,
  battlesPlayed: 0,
  wins: 0,
  winStreak: 0,
  bestStreak: 0,
  lastTeam: ['orakyn', 'abyssar', 'virelia'],
  difficulty: 'apprentice',
  language: 'fr',
  muted: true,
  volume: 0.7,
  musicVolume: 0.45,
  sfxVolume: 0.8,
  reducedMotion: true,
  highContrast: false,
  expertMode: true,
  battleSpeed: 2
}
```

Also change `installPreExpertSave()` in `simple-mode.spec.js:3–19` from v13 to a minimal valid v15 save with `expertMode: false`; the migration itself should be covered in unit tests, not incidentally in this UI-density case.

## 4. Kid-clear copy inventory

### 4.1 Copy rules and counts

Apply these rules to both locales:

- Put the verb/result first; one idea per sentence.
- Address the player directly in FR (`tu`) and EN (`you`) only when needed.
- Prefer 12 words or fewer for move/status/action copy; allow a second short sentence instead of semicolons.
- Use the visible terms exactly: PV/HP, Éclat/Surge, Signature, Marqué/Marked, Combo.
- Use `+40 %` in FR and `40% more` in EN. Do not alternate between amplification, conversion, detonation, chain, or assist.
- Simple mode uses qualitative/actionable text. Exact numbers beyond HP, gauge, cooldown, and Combo's universal +40% belong to tactical details/Bestiary.

Inventory totals:

- **32 status entries:** 8 names + 8 descriptions in each of 2 locales.
- **72 move-effect keys per locale:** 53 mandatory mechanics rewrites + 19 number/register reviews; 144 localized values total.
- **12 core battle action keys per locale:** move, damage, heal, switch, status apply/remove, barrier, absorb, miss, recoil, tick, Combo.
- **9 Combo/record UI keys per locale:** ready, helper credit, setter detail, route title/empty, log type, result count, record count, legacy assist label.
- **8 Academy concept titles + 8 descriptions per locale**, plus headings/hints.
- Remove or leave unreachable only temporarily all live copy for Flow/Crescendo, doctrine variants, contracts, bonds, resonance, rally/final duel, detonation, and current assist rewards. Before release, `rg` must find no live renderer reference to those keys.

### 4.2 The eight statuses — proposed final FR/EN

Use the existing stable IDs so saves/events/CSS stay simple: `focused`, `haste`, `evasive`, `countering`, `marked`, `rooted`, `stunned`, `burning`.

| ID | FR name | FR description | EN name | EN description |
|---|---|---|---|---|
| `focused` | Concentré | **Ta prochaine attaque inflige +30 % de dégâts.** | Focused | **Your next attack deals 30% more damage.** |
| `haste` | Accéléré | **Ta Vitesse augmente de 25 %.** | Haste | **Your Speed increases by 25%.** |
| `evasive` | Insaisissable | **La prochaine attaque contre toi échoue.** | Elusive | **The next attack against you misses.** |
| `countering` | Riposte | **Renvoie 35 % des dégâts du prochain coup.** | Counter | **Returns 35% of the next hit's damage.** |
| `marked` | Marqué | **Un Combo le consomme pour +40 % de dégâts.** | Marked | **A Combo consumes it for 40% more damage.** |
| `rooted` | Enraciné | **Tu ne peux pas changer de créature.** | Rooted | **You cannot switch creatures.** |
| `stunned` | Sonné | **Tes dégâts et ta Vitesse baissent de 30 %.** | Dazed | **Your damage and Speed drop by 30%.** |
| `burning` | Brûlure | **Tu perds 6 % de tes PV en fin de tour.** | Burning | **You lose 6% HP at the end of each turn.** |

These numbers are the proposed copy contract. Confirm them with the S2 owner before implementation; if S2 has already frozen different constants, update this copy table to those constants rather than changing S2 mechanics during Stage 4. Never ship text that approximates the engine.

### 4.3 Battle action and Combo key list

Rewrite the final effective values for:

`battle.action.move`, `battle.action.damage`, `battle.action.heal`, `battle.action.switch`, `battle.action.status`, `battle.action.cleanse`, `battle.action.barrier`, `battle.action.absorb`, `battle.action.miss`, `battle.action.recoil`, `battle.action.tick`, `battle.combo`.

Combo/record UI keys to create or normalize:

`battle.comboReady`, `battle.comboCredit`, `battle.preparedBy`, `combo.title`, `combo.none`, `battle.logType.combo`, `result.combos`, `record.combos`, `record.assistsLegacy`.

Delete live usage of `battle.teamAssist`, `battle.assist`, `battle.assistReady`, `battle.chainReaction`, `battle.detonation`, `battle.detonate`, and `battle.logType.assist`. The compatibility event name is not player copy.

Suggested concise action register:

- FR `battle.action.move`: **{actor} lance {move}.**
- EN: **{actor} uses {move}.**
- FR `battle.combo`: **COMBO ! +40 % de dégâts.**
- EN: **COMBO! 40% more damage.**
- FR `battle.comboCredit`: **Combo préparé par {helper}.**
- EN: **Combo set up by {helper}.**
- FR `battle.action.status`: **{actor} devient {status}.**
- EN: **{actor} is now {status}.**

### 4.4 Move-effect inventory

All 72 final effective `move.effect.*` values get a length/number review. The **53 mandatory mechanics rewrites** are:

`move.effect.lucid_arc`, `move.effect.slowing_riddle`, `move.effect.oracle_veil`, `move.effect.crescendo_lock`, `move.effect.finale_nova`, `move.effect.forgotten_name`, `move.effect.deja_vu`, `move.effect.mirror_maze`, `move.effect.spectrum_break`, `move.effect.fault_charge`, `move.effect.resonant_focus`, `move.effect.tectonic_ram`, `move.effect.iron_resolve`, `move.effect.momentum_claw`, `move.effect.terminal_velocity`, `move.effect.gravity_fist`, `move.effect.fortress_protocol`, `move.effect.continental_divide`, `move.effect.undertow`, `move.effect.shell_bastion`, `move.effect.foam_blitz`, `move.effect.rip_current`, `move.effect.maw_of_maelstrom`, `move.effect.bubble_burst`, `move.effect.static_wake`, `move.effect.storm_chain`, `move.effect.thunder_deluge`, `move.effect.cinder_burst`, `move.effect.caldera_roar`, `move.effect.furnace_heart`, `move.effect.scorch_mark`, `move.effect.ninefold_inferno`, `move.effect.ember_armor`, `move.effect.smoldering_charge`, `move.effect.ash_rebirth`, `move.effect.solar_wings`, `move.effect.seed_bloom`, `move.effect.leaf_mantle`, `move.effect.ancient_bark`, `move.effect.forest_quake`, `move.effect.pollen_dream`, `move.effect.toxic_spines`, `move.effect.bramble_trap`, `move.effect.venom_harvest`, `move.effect.shade_spark`, `move.effect.crooked_glimmer`, `move.effect.shadow_shed`, `move.effect.sonic_gloom`, `move.effect.midnight_lullaby`, `move.effect.nightmare_dive`, `move.effect.smoke_step`, `move.effect.hex_bolt`, `move.effect.moonless_omen`.

They mention a removed/changed status, old setup bonus/detonation, or a compound support package whose S1/S2 values have changed.

The **19 number/register reviews** are still rewritten if they exceed the register, but have no direct status-schema dependency:

`move.effect.echo_chorus`, `move.effect.memory_leech`, `move.effect.refraction_lance`, `move.effect.crystal_strike`, `move.effect.seismic_reversal`, `move.effect.razor_rush`, `move.effect.abyssal_surge`, `move.effect.healing_rain`, `move.effect.tide_reversal`, `move.effect.flash_pounce`, `move.effect.sun_spear`, `move.effect.supernova`, `move.effect.petal_ray`, `move.effect.mossy_crush`, `move.effect.nectar_circle`, `move.effect.wild_bloom`, `move.effect.ambush_claw`, `move.effect.eclipse_execution`, `move.effect.fate_exchange`.

Six target examples, with the same register in both locales:

| Key | FR | EN |
|---|---|---|
| `move.effect.lucid_arc` | **Marque la cible pour un Combo.** | **Marks the target for a Combo.** |
| `move.effect.slowing_riddle` | **Combo : consomme Marqué pour +40 % de dégâts.** | **Combo: consumes Marked for 40% more damage.** |
| `move.effect.oracle_veil` | **Signature : barrière, Concentré, Insaisissable et retire tes malus.** | **Signature: barrier, Focused, Elusive, and remove your penalties.** |
| `move.effect.thunder_deluge` | **Combo : +40 % de dégâts, puis applique Sonné.** | **Combo: deal 40% more damage, then apply Dazed.** |
| `move.effect.venom_harvest` | **Combo : +40 % de dégâts et récupère des PV.** | **Combo: deal 40% more damage and recover HP.** |
| `move.effect.smoke_step` | **Devient Insaisissable et Accéléré.** | **Become Elusive and gain Haste.** |

Generate no description from fields at runtime; authored strings remain necessary for natural language. Add a localization test that every creature move has FR and EN name/effect values and no final effect string contains old status/system vocabulary.

## 5. Academy, tutorial, and README restructure

### 5.1 Academy: “L'essentiel / Essentials”

Replace the current “Gestes de maître” list with exactly eight numbered cards in this order:

1. **Ton équipe et les PV / Your team and HP** — three creatures; win by putting all three rivals K.O.; barrier is temporary HP protection.
2. **Changer / Switching** — switch to improve the matchup; the incoming ally receives the planned enemy action; K.O. replacement is free.
3. **Les affinités / Affinities** — show the six-node cycle and the landed S1 `×2`/`×0.5` values with icon + text, never color alone.
4. **Trois techniques / Three moves** — each creature has exactly three; one may be a Signature; cooldown means wait, not unavailable forever.
5. **L'ordre du tour / Turn order** — priority first, then Speed; tactical details reveals the exact forecast.
6. **Éclat et Signature / Surge and Signatures** — actions fill the shared gauge; at the canonical cost, choose a creature's Signature.
7. **Les 8 effets / The 8 effects** — render the 4 positive + 4 negative status cards from the table above. Marqué explicitly teaches `Combo +40%`.
8. **Talents et arènes / Talents and arenas** — one readable innate talent per creature; each arena has one visible rule/pulse. No resonance.

Below the cards, retain the Bestiary CTA. Remove separate contract/Flow/assist/final-duel/doctrine lessons. Keep the page useful in simple mode; exact numeric status text is acceptable here because the Academy is an intentional reference.

### 5.2 Tutorial verification and revised script

Use Orakyn's three moves to teach the core without opening extra panels:

1. **Affinity + setup:** “Force craint Esprit. Lance Arc lucide : il marque Kordane.” The allowed move is `lucid_arc`.
2. **Combo:** “Kordane est Marqué. Lance Énigme lente : le Combo gagne +40 %.” Allow only `slowing_riddle`; assert Marqué is consumed.
3. **Éclat + Signature/defense:** fill the gauge deterministically, explain that a Signature is one of the three moves, and allow only `oracle_veil`.
4. **Switching:** enemy switches as scripted; ask the player to bring Abyssar for the affinity. Do not mention Perfect Relay, assist, Flow, doctrine, contract, or exact expert forecast.
5. **Free finish:** “À toi. Observe les PV et l'ordre, puis termine le combat.” Unlock legal moves/switches and complete into team select.

Update `hud.js:205–209`, `controller.js:598–600,708–713`, `tutorialEnemyAction()` at `screens/tutorial.js:21–34`, and `tutorial.1`…`tutorial.5`/`tutorial.done` in both locales. E2E must verify the forced move sequence, Combo consumption, switch, completion, and absence of dead words in `.tutorial-tip`.

### 5.3 README rewrite outline

Rewrite `README.md` rather than patching individual obsolete claims:

1. **What the game is** — local bilingual deterministic 3v3, 24 creatures/72 moves/six arenas, no backend.
2. **Play locally** — current serve command and URL.
3. **The essentials** — compact version of the eight Academy concepts.
4. **Combo in one example** — apply Marqué, use a Combo move, consume it for +40%; helper cut-in is credit only.
5. **Modes** — list only surviving modes/options; Quick Battle has team/lead/difficulty/arena/rule, Draft has picks/lead, no contracts/doctrines/bonds.
6. **Controls and accessibility** — mouse/touch/keyboard/gamepad, reduced motion/high contrast, and the exact “Tactical details” meaning.
7. **Saving** — save v15, surviving progress/preferences, `records.assists` compatibility note only if useful to contributors.
8. **Architecture** — current modular paths; name `moves.js`, `combos.js`, engine/AI, battle UI, screens, i18n/save/sound.
9. **Verification** — commands, broad coverage, and generated/current counts only. Remove stale hard-coded test/balance totals unless the implementation verifies them.
10. **Static deployment** — unchanged local/static constraints.

Remove all claims about contracts, doctrines, bonds, Flow/Crescendo, resonance, mastery combat perks, rally/final-duel bonuses, assist rewards, detonations, 21 statuses, and save v12.

## 6. Ordered execution checklist and green session split

### Session 1 — Combo/data/engine/AI with minimal compatible presentation

1. Start from the green S1–S3 branch; resolve its final eight status IDs and save v15 shape before editing.
2. Add `COMBO_DAMAGE_MULTIPLIER`, convert the eight finishers, audit explicit Marqué setters, and rewrite `combos.js` routes.
3. Refactor damage/preview transaction and remove generic Marqué, bonus, detonation, and +8 assist reward paths.
4. Update AI setup/spend/switch scoring.
5. Update save validation/results record accounting for `combos` while retaining legacy `assists` and `team_assist` data.
6. Adapt HUD preview, playback, helper cut-in, action log, result Combo count, and sound just enough for the new structured event; remove detonation presentation.
7. Replace focused unit/integration tests in `engine.test.js`, `data-ai.test.js`, `preview-parity.test.js`, `i18n-save.test.js`, `audio.test.js`, and presentation-contract tests.
8. Update the two Combo E2E cases (`gameplay.spec.js:334` and `:462`) and helper v15 fixture.
9. Green state: lint/format if present, all unit tests, balance simulation, and the two targeted E2E Combo cases pass; no `bonusAgainst`, `bonusMultiplier`, `detonate`, or `detonatePower` remains.

### Session 2 — UI repair, expert density, copy, onboarding, and full E2E

1. Remove all S1–S3-dead battle codex/topbar/intro/HUD markup and shared context exports.
2. Simplify team select, custom squads, draft, results, gauntlet, trials, title, Bestiary, and universal command surfaces file by file.
3. Apply the expert-mode information-density contract in settings/HUD/controller/CSS.
4. Delete/rename the style blocks in section 2.3; check 320×568, 390×844, 768×1024, 1024×768, and 1440×900 in both density modes.
5. Land all FR/EN status, battle, Combo, move, result, record, and settings copy; remove shadowing duplicate i18n assignments.
6. Rebuild Academy and the five-step tutorial.
7. Rewrite README from the outline.
8. Apply the 51-case E2E triage exactly, deleting only the six cases marked Delete and replacing the detonation case rather than dropping Combo coverage.
9. Add static searches for dead UI selectors/keys and old status names, allowing only migration/legacy record/feat comments explicitly documented.
10. Green state: localization parity, unit/integration, balance, all Playwright scenarios, responsive screenshots/geometry, keyboard/touch/gamepad, focus traps, reduced motion, high contrast, corrupt/future save, and WebGL recovery all pass. The UI contains no assist/detonation/Flow/doctrine/contract/bond/resonance/final-duel promise, and every visible rule is true in both density modes.

## Definition of done

- There is one setup token, one Combo bonus, one Combo count, and no hidden secondary payout.
- Cross-ally credit is visibly delightful but mechanically neutral.
- Every battle/team/results/Academy/Bestiary surface matches the post-S3 game.
- Tactical details changes information, never rules or available actions.
- The tutorial and README teach only the simplified game.
- FR/EN terminology is parallel, short, and mechanically exact.
- Save v15 preserves legacy assists/team-assist without creating new ones.
- All surviving tests describe current player value rather than deleted systems.
