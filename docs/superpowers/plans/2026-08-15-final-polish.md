# Final Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One comprehensive polish pass — UX, UI, copy, accessibility, performance — that irons out every rough edge found by the 2026-08-15 eight-agent audit, without adding features.

**Architecture:** All changes stay within the existing boundaries: engine stays pure/DOM-free, authored values stay in `src/data/`, presentation stays in `src/battle-ui/`+`styles/`, every string lives in both `fr` and `en` in `src/i18n.js`, persisted-shape changes go through `SAVE_VERSION` migrations.

**Tech Stack:** Vanilla browser ES modules, Three.js (vendored), layered CSS, `node --test`, Playwright.

**Spec:** `docs/superpowers/plans/2026-08-15-final-polish-findings.md` (finding IDs like B1/C5/S12 below refer to it). Audit evidence: `agents/polish-audit/` (gitignored scratch — screenshots and raw reports).

## Global Constraints

- No new features, modes, content, or gamepad support. Polish only.
- Combat uses seeded RNG only; engine modules stay side-effect-free and DOM-free.
- Preview parity: forecasts must use engine preview functions and match live resolution exactly.
- Every user-facing string changes in **both** `fr` and `en`; verify with `?lang=en`.
- Any persisted-shape change bumps `SAVE_VERSION` and adds exactly one migration.
- Reduced motion, `?animations=0`, ×2 battle speed, and 320px–1440px layouts keep working for every touched surface.
- All temp scripts/screenshots go in gitignored `agents/`.
- Verification matrix (from `docs/README.md`): combat/data → `npm test && npm run test:balance`; screen/CSS → `npm test` + focused Playwright spec; save/i18n → `node --test test/i18n-save.test.js` then `npm test`; before final handoff → all three suites.
- Commit after every task (`git add <files> && git commit`), message prefix `polish:`.

---

## Phase A — Ship blockers

### Task 1: Un-clip the tutorial coach card (B1)

**Files:**
- Modify: `styles/screens/battle-layout.css:755-766` (`.tutorial-tip` battle override)
- Modify: `styles/components.css:369-382` only if the base rule needs a variable hook

**Steps:**

- [ ] **Step 1: Reproduce.** `npm run serve`, open `http://127.0.0.1:8178` in a fresh profile (DevTools → clear localStorage → reload), click *Jouer*. Confirm the coach card is clipped at the left edge (measured `x ≈ −154` desktop, `−159` at 375×667).
- [ ] **Step 2: Fix the override.** The battle rule sets `position: static` but inherits `transform: translateX(-50%)` from the base component. In the battle-layout rule add:

```css
.battle-screen .tutorial-tip {
  position: static;
  transform: none;
  width: 100%;
  max-width: min(420px, calc(100vw - 24px));
}
```

Keep existing declarations in that block; only `transform`/width bounds are new. Ensure `#tutorial-root` places the tip above (not overlapping) the action dock at both breakpoints — if the root uses absolute positioning, give it `inset-inline: 12px; bottom: <dock height + 8px>` instead of a transform.
- [ ] **Step 3: Verify at 3 sizes.** Desktop 1440×900, 768×1024, 375×667: full sentence, the enabled move, and *Passer le tutoriel* all visible and clickable on tutorial steps 1 and 2. Screenshot each to `agents/polish-audit/after/`.
- [ ] **Step 4: Run the layout spec.** `npx playwright test e2e/battle-layout.spec.js` — expect pass.
- [ ] **Step 5: Commit.**

### Task 2: Close the battle input race (B2)

**Files:**
- Modify: `src/battle-ui/controller.js:675-763` (`handleTrainerCommand`, `handlePlayerAction`, `handleReplacement`)

**Interfaces:**
- Produces: `claimBattleLock(): boolean` — synchronous; used by all three handlers. Later tasks assume actions can never double-submit.

**Steps:**

- [ ] **Step 1: Add the synchronous claim.**

```js
function claimBattleLock() {
  if (ctx.locked) return false;
  ctx.locked = true;
  return true;
}
```

- [ ] **Step 2: Restructure all three handlers** to the same shape — claim before any `await`, unlock on error:

```js
async function handlePlayerAction(action) {
  if (!claimBattleLock()) return;
  const session = ctx.battleSession;
  try {
    refreshBattle(); // disables controls immediately
    await sound.unlock();
    if (!sessionIsActive(session)) return;
    /* …existing body from tutorialStep bookkeeping through resolvePendingReplacements,
       minus the old `ctx.locked = true` / initial locked check… */
  } catch (error) {
    if (sessionIsActive(session)) ctx.locked = false;
    throw error;
  }
}
```

Apply identically to `handleTrainerCommand` (keep its `canUseTrainerCommand` pre-check before claiming) and `handleReplacement` (which today has **no** guard — add `if (!claimBattleLock()) return;`). Do not change where the existing success paths set `ctx.locked = false`.
- [ ] **Step 3: Chaos-test.** In the browser: double-click moves rapidly, double-tap the Coach flag, double-click a replacement card after a KO, spam `1`/`2`/`3` during playback. Exactly one action resolves each turn; battle never sticks locked.
- [ ] **Step 4: Run suites.** `npm test` and `npx playwright test e2e/gameplay.spec.js` — pass.
- [ ] **Step 5: Commit.**

### Task 3: Gate battle shortcuts behind open dialogs (B3)

**Files:**
- Modify: `src/input/keyboard.js:19-26`

**Steps:**

- [ ] **Step 1: Identify the modal surfaces.** Read `src/battle-ui/controller.js:258-347` (`openBattleCodex`, `openBattleLog`, `openPlateDetails`) and note the container each renders into (they mount inside `#replacement-root` / a dialog element).
- [ ] **Step 2: Add the boundary** at the top of the battle-shortcut branch:

```js
const modalOpen =
  ctx.screen.querySelector('[role="dialog"][aria-modal="true"]') ||
  ctx.screen.querySelector('#replacement-root')?.childElementCount > 0;
if (modalOpen) return;
```

- [ ] **Step 3: Verify.** In battle, open the Codex, press `1`/`2`/`3`/`C` — nothing fires underneath; Escape still closes; shortcuts work again after close. Repeat with the Battle Log and the switch overlay.
- [ ] **Step 4: Commit.**

### Task 4: Surface save-write failures (D6)

**Files:**
- Modify: `src/app/context.js:150-156` (`persist`)
- Modify: `src/i18n.js` (new key, both locales)

**Steps:**

- [ ] **Step 1: Write the failing test** in `test/i18n-save.test.js`: assert both dictionaries contain `app.saveFailed` (follow the file's existing key-presence pattern). Run: `node --test test/i18n-save.test.js` → FAIL.
- [ ] **Step 2: Add keys.** FR: `Impossible d'enregistrer ta progression sur cet appareil. Le jeu reste jouable !` EN: `Your progress could not be saved on this device. You can keep playing!`
- [ ] **Step 3: Wire the notice** — notify once per session so a broken localStorage doesn't spam:

```js
persist: () => {
  const ok = persistSave(ctx.save);
  if (!ok && !ctx.saveFailureNotified) {
    ctx.saveFailureNotified = true;
    ctx.notify(t('app.saveFailed'));
  }
  return ok;
},
```

- [ ] **Step 4: Verify.** `node --test test/i18n-save.test.js` → PASS. Manual: DevTools → override `localStorage.setItem` to throw → change a setting → toast appears once, game keeps running.
- [ ] **Step 5: Commit.**

---

## Phase B — Battle feel

### Task 5: Cut dead air from turn playback (B5)

**Files:**
- Modify: `src/battle-ui/playback.js:52-83` (`eventPresentationDelay`)

**Steps:**

- [ ] **Step 1: Zero-out invisible events.** Add at the top of the type chain (after the reduced-motion branch):

```js
if (event.type === 'status' && event.consumed && event.source === 'combo')
  return 60 / ctx.save.battleSpeed; // suppressed — no visuals render for it
if (event.type === 'move-skip') return 120 / ctx.save.battleSpeed;
```

- [ ] **Step 2: Trim routine beats.** Starting values (tune by feel in Step 3): `move-start` non-signature ≥46-power `580 → 500`, standard `430 → 360`; `damage` standard `430 → 380`; the `heal/status/barrier/…` family `460 → 340`; `surge` non-ready `100 → 60`; default `300 → 240`. Leave signature (780), KO (900/700), ace (1050), `trainer-command`/`arena-pulse` (760) untouched — those are the emotional beats.
- [ ] **Step 3: Measure.** Play 3 ordinary turns (2 damaging moves + statuses) at ×1 with a stopwatch or `performance.now()` logging in DevTools: confirmation → controls returned must land ≤ 2.5 s; KO turns may exceed. Adjust Step 2 numbers until true, keeping each hit readable.
- [ ] **Step 4: Regression.** `npm test` (preview-parity untouched) and `npx playwright test e2e/gameplay.spec.js e2e/simple-mode.spec.js` — pass. Check ×2 speed and reduced-motion still feel right.
- [ ] **Step 5: Commit.**

### Task 6: Narrate consumed statuses correctly (B6)

**Files:**
- Modify: `src/battle-ui/playback.js:143-155`
- Modify: `src/i18n.js` (new key `battle.action.consumed`)
- Test: `test/i18n-save.test.js` key-presence pattern

**Steps:**

- [ ] **Step 1: Add keys.** FR: `{actor} utilise son bonus {status} !` EN: `{actor} uses up its {status} boost!`
- [ ] **Step 2: Branch on `consumed` before `applied`:**

```js
session.lastLine = event.consumed
  ? t('battle.action.consumed', { actor: creatureName(event.creatureId), status: t(`status.${event.status}`) })
  : event.applied
    ? t('battle.action.status', { … })
    : t('battle.action.cleanse', { … });
```

Keep the existing combo-suppression condition on the enclosing `if`.
- [ ] **Step 3: Verify in play.** Trigger a Focused attack (e.g. tutorial's Marked → Combo turn): the line reads as spending a bonus, not "breaks free". Check `?lang=en`.
- [ ] **Step 4: `npm test`; commit.**

### Task 7: Complete the battle log (B12)

**Files:**
- Modify: `src/app/context.js:68-87` (`LOG_EVENT_TYPES`), `src/battle-ui/playback.js:256-264`, `src/battle-ui/controller.js:321-337` (log rendering)
- Modify: `src/i18n.js` (keys below)

**Steps:**

- [ ] **Step 1: Add keys** (both locales): `battle.action.skip` — FR `{name} ne peut pas agir : K.O. !` / EN `{name} cannot act — K.O.!`; `battle.logEnd.win` FR `Victoire !` EN `Victory!`; `battle.logEnd.loss` FR `Défaite — belle bataille.` EN `Defeat — good battle.`; `battle.logEnd.cap` FR `Fin du combat : limite de tours.` EN `Battle over: turn limit.`; `battle.logSide.player` FR `Ton {name}` EN `Your {name}`; `battle.logSide.enemy` FR `{name} rival` EN `Rival {name}`.
- [ ] **Step 2: Emit lines.** In `playEvents`, set `session.lastLine` for `move-skip` (using the skipping creature) and for `battle-end` map `reason`/winner to the three end keys. Add `'move-skip'` and `'battle-end'` to `LOG_EVENT_TYPES`.
- [ ] **Step 3: Side-label timeline entries.** Where timeline entries render in the Chronicle (`controller.js:321-337`), wrap creature names via the `battle.logSide.*` keys (the entry already carries `side`). Keep the ◆/◇ glyphs as secondary cues.
- [ ] **Step 4: Verify.** Finish one battle; open Chronicle: KO-skip line present, final line present, mirror-match lines disambiguated. `?lang=en` too. `npm test`; commit.

### Task 8: Make Coach discoverable (B7 + C6)

**Files:**
- Modify: `styles/screens/battle-layout.css:139-166`, `styles/overrides/battle-command.css`
- Modify: `src/battle-ui/controller.js:545-551`
- Modify: `src/i18n.js:497-503` + `academy.command`

**Steps:**

- [ ] **Step 1: Unify the name.** Apply the canonical copy: `battle.command` FR `Coup de pouce` / EN `Coach Boost`; `battle.commandUsed` FR `Coup de pouce utilisé` / EN `Coach Boost used`; `battle.commandLine` FR `⚑ COUP DE POUCE · {command} !` / EN `⚑ COACH BOOST · {command}!`; prepend `Le `/keep EN in `academy.command` (findings §2c).
- [ ] **Step 2: Show the label.** Remove `small { display: none; }` and the `max-width: 44px` clamp from the command tile; let it render icon + short caption at ≥44px height. Verify the dock still fits at 320px (wrap the caption under the icon at the narrow breakpoint rather than hiding it).
- [ ] **Step 3: Explain unavailability.** In `refreshBattle`, when the button is disabled and unused, set a localized `title`/`aria-label` reason — new key `command.unavailable`: FR `Utilisable quand ta créature a un malus.` EN `Usable when your creature has a penalty.` (Verify the actual gating in `canUseTrainerCommand` first and word the reason to match it.)
- [ ] **Step 4: Verify** dock at 320/375/768/1440, both locales, tutorial included. `npx playwright test e2e/battle-layout.spec.js`. Commit.

### Task 9: Readable decision copy on mobile (B9) + speed/mute chips (B10)

**Files:**
- Modify: `styles/overrides/battle-preview.css:38-53`, `styles/screens/battle-layout.css:932-989, 1062-1085, 1369-1395`, `styles/screens/battle-presentation.css:136-142`

**Steps:**

- [ ] **Step 1: Type floors.** Replace the `6px` exchange-forecast size with `10px` and let it wrap to two lines (stacked `you`/`rival` rows). Raise portrait move descriptions `9px → 11px` and switch-overlay forecast/passive text `9px → 11px`; reclaim space by shrinking decorative badges/margins, not tactical copy.
- [ ] **Step 2: Restore comfort controls.** Remove the portrait `display: none` on mute and ×-speed buttons; render both as compact 44×44 chips in the battle top row (overflow into a second row is acceptable at 320px).
- [ ] **Step 3: Verify.** 375×667 and 320×568: forecast legible at arm's length, no dock/stage overlap, no horizontal scroll. `npx playwright test e2e/battle-layout.spec.js e2e/progression-responsive.spec.js`. Commit.

### Task 10: Simple-mode preview affordance (B8)

**Files:**
- Modify: `src/battle-ui/hud.js:276-306`, `src/battle-ui/controller.js:371-407`
- Modify: `src/i18n.js` (key `battle.previewShort`)

**Steps:**

- [ ] **Step 1: Add key.** FR `≈ {damage} dégâts` / EN `≈ {damage} damage`.
- [ ] **Step 2: Show it.** In the simple-mode `moveButton` branch, append the same engine-preview damage already computed for expert mode as a small `battle.previewShort` row on damaging moves (support moves keep their effect line). Reuse the existing preview call — do **not** recompute damage in the UI.
- [ ] **Step 3: Parity check.** `node --test test/preview-parity.test.js` → pass (the value shown is the engine preview). Visual check both modes, both locales, mobile + desktop.
- [ ] **Step 4: `npm run test:e2e` simple-mode spec; commit.**

### Task 11: Tutorial outro (B11)

**Files:**
- Modify: `src/screens/results.js:170-174`

**Steps:**

- [ ] **Step 1:** In the tutorial branch of `finishBattle()`, `await battleOutroFx(win)` (same call the normal path uses at `results.js:199-206`) before scheduling `completeTutorial()`; keep the fast route under reduced motion / `testAnimationScale === 0`.
- [ ] **Step 2: Verify** the tutorial's final KO now lands with the short victory pose before team select appears; `?animations=0` still skips it (e2e tutorial flow in `gameplay.spec.js` stays green). Commit.

### Task 12: Stage HP/status changes with their events (B4) — flagship

**Files:**
- Modify: `src/battle/engine.js` (event payload enrichment only — no behavior change)
- Modify: `src/battle-ui/playback.js`, `src/battle-ui/controller.js:440-555` (`refreshBattle`)
- Test: `test/engine.test.js` (payload assertions)

**Interfaces:**
- Produces: `session.displayState` — a presentation clone advanced per event; `refreshBattle()` renders `session.displayState ?? session.state`. Cleared (set `null`) when playback finishes or the session cancels.

**Steps:**

- [ ] **Step 1: Enumerate event payloads.** Read every `events.push(…)` in `src/battle/engine.js` and list, per type, which *resulting* values it already carries (e.g. `damage` carries `hp`; `barrier-hit` carries `total`). For any type whose resulting value is missing (candidates: `heal` resulting hp, `status` remaining turns, `surge` resulting meter, `switch/replace` incoming index), extend the event with that field. Engine stays deterministic; events grow, mechanics don't change.
- [ ] **Step 2: Write failing engine tests** asserting the new payload fields on a scripted turn (follow existing `resolveTurn` test patterns in `test/engine.test.js`). Run → FAIL, implement Step 1, run → PASS. `npm run test:balance` → unchanged output.
- [ ] **Step 3: Build the projection.** In `playback.js`:

```js
function beginPresentation(session, preTurnState) {
  session.displayState = structuredClone(preTurnState);
}
function advancePresentation(session, event) {
  const state = session.displayState;
  if (!state) return;
  /* per event.type, copy the event's resulting values onto the matching
     creature/side in state: hp, barrier total, status add/remove/remaining,
     surge, activeIndex for switch/replace, ko (hp 0) */
}
```

`handlePlayerAction`/`handleTrainerCommand`/`handleReplacement` capture `preTurnState` (the state *before* `resolveTurn`) and call `beginPresentation` before `playEvents`; `playEvents` calls `advancePresentation(session, event)` immediately before each event's FX, and sets `session.displayState = null` after the loop (and in every early `return` path — do it in `sessionIsActive` failure exits and `clearBattleFx`).
- [ ] **Step 4: Render the projection.** In `refreshBattle()` replace reads of `session.state` for HUD/fighter/status/moves with `const view = session.displayState ?? session.state;`. Keep legality checks (`getLegalActions`, switch button, forecasts) on the **real** `session.state` — only visuals read the projection.
- [ ] **Step 5: Verify causality.** Play turns and confirm: HP bars drop *at* the hit, statuses appear *at* their beat, a switched-in creature is not visible during the outgoing recall, multi-KO turns sequence correctly. Chaos-check: Escape/exit mid-playback leaves no stale projection (next battle renders real state).
- [ ] **Step 6: Full battle suites.** `npm test && npm run test:balance && npx playwright test e2e/gameplay.spec.js e2e/battle-layout.spec.js` → pass. Commit.

---

## Phase C — Copy & contract truth

### Task 13: P1 copy fixes (C1–C4)

**Files:** Modify `src/i18n.js` only.

**Steps:**

- [ ] **Step 1:** Apply the twelve rows of findings §2a verbatim (switch forecast family, tutorial 1/2/4, `kindred_halo`, `eclipse_coven`, `style.effect.control`).
- [ ] **Step 2:** `node --test test/i18n-save.test.js test/advice.test.js && npm test` → pass (dictionaries stay parallel).
- [ ] **Step 3:** In-battle check: switch overlay forecast reads "Dégâts prévus", tutorial steps read as full sentences, `?lang=en` equivalents. Commit.

### Task 14: Fix Night Terror support-path bypass (D2)

**Files:**
- Modify: `src/battle/engine.js:637-643, 799-802`
- Test: `test/engine.test.js`

**Steps:**

- [ ] **Step 1: Failing test.** Scripted battle: Nocturnyx uses `midnight_lullaby`; assert target's `stunned.remaining === 3` (2 base + 1 from `night_terror`). Run → FAIL (currently 2).
- [ ] **Step 2: Extract one helper** `applyTargetStatus(state, side, descriptor, attacker)` containing the passive duration adjustment currently only in `resolveDamageTransaction` (engine.js:637-643), and call it from both the damage path and the support path (`executeMove` ~800). No other behavior change.
- [ ] **Step 3:** `npm test` (all engine + preview-parity) and `npm run test:balance` — confirm the win-rate table shifts only marginally for nocturnyx; record before/after numbers in the commit message.
- [ ] **Step 4: Commit.**

### Task 15: Shell Bastion single self-cleanse (D4)

**Files:**
- Modify: `src/battle/engine.js:817-821`
- Test: `test/engine.test.js`

**Steps:**

- [ ] **Step 1: Failing test.** Caster with 3 penalties uses `shell_bastion`; assert exactly 1 caster penalty removed (currently 2) and each living teammate loses 1.
- [ ] **Step 2:** Exclude the caster from the `teamCleanse` loop when the move also declares `cleanse` (matches the copy "one each").
- [ ] **Step 3:** `npm test && npm run test:balance`; note delta. Commit.

### Task 16: Copy-side contract fixes (D3, D5, D10)

**Files:** Modify `src/i18n.js` only (safe, no balance change).

**Steps:**

- [ ] **Step 1: Falling Rings** (`move.effect.falling_rings`, both locales): "penalties" → FR `Grandit avec chaque effet actif sur la cible.` EN `Grows with every effect on the target.`
- [ ] **Step 2: Shared Breath** (`passive.effect.shared_breath`): FR `Soigner deux membres de l'équipe (elle-même comprise) donne une barrière de 4 au plus blessé.` EN `Healing two team members (itself included) grants a barrier of 4 to the most wounded.`
- [ ] **Step 3: Near-duplicate differentiation (D10).** For the three barrier-bypass attacks (`refraction_lance`, `sun_spear`, `heartwood_breach`), the support twins (`iron_resolve`/`fortress_protocol`), the heal twins (`nectar_circle`/`dawn_dew`), and the Burning twins (`toxic_spines`/`hex_bolt`): extend each effect string with its visible differentiator (its power tier, barrier amount, or heal %) so twin moves stop reading identically. Pull exact numbers from `src/data/moves.js`; both locales.
- [ ] **Step 4:** `npm test`; bestiary spot-check both locales. Commit.

### Task 17: Status-vocabulary normalization (C5, C9)

**Files:** Modify `src/i18n.js` only.

**Steps:**

- [ ] **Step 1: Apply the rule** (findings §2b): canonical capitalized status names whenever a status is applied; `une barrière de N` / `a barrier of N` for barriers.
- [ ] **Step 2: Apply these rewrites** (from the CopyI18n audit; both locales):

| Key | New FR | New EN |
|---|---|---|
| `status.effect.focused` | `La prochaine attaque inflige 30 % de dégâts en plus.` | `The next attack deals 30% more damage.` |
| `status.effect.countering` | `Renvoie 25 % des dégâts du prochain coup.` | `Reflects 25% of the next hit's damage.` |
| `status.effect.marked` | `Un Combo consomme Marqué et inflige 40 % de dégâts en plus.` | `A Combo consumes Marked and deals 40% more damage.` |
| `status.effect.burning` | `Perd 5 % de ses PV max par charge.` | `Loses 5% of max HP per stack.` |
| `battle.switchBonusFever` | `Relais incandescent : +24 Éclat et Accéléré.` | `Relay Rush: +24 Surge and Haste.` |
| `move.effect.foam_foil` | `Prioritaire. Devient Insaisissable ; recharge en 2 tours.` | `Priority. Gains Elusive; cooldown is 2 turns.` |
| `move.effect.ember_feint` | `Prioritaire. Gagne Riposte pendant 2 tours.` | `Priority. Gains Counter for 2 turns.` |
| `passive.effect.perfect_ebb` | `Quand Insaisissable est consommé, gagne Accéléré une fois par tour.` | `When Elusive is consumed, gain Haste once per turn.` |
| `arena.rule.astral` | `Tous les 4 tours : devient Concentré, ou gagne +15 Éclat si déjà Concentré.` | `Every 4 turns: becomes Focused, or gains +15 Surge if already Focused.` |
| `move.effect.oracle_veil` | `Signature : donne une barrière de 18, rend Concentré et Insaisissable, et retire un malus.` | `Signature: grants a barrier of 18, Focus and Elusive, and removes one penalty.` |
| `move.effect.abyssal_surge` | `Inflige des dégâts et donne une barrière de 4.` | `Deals damage and grants a barrier of 4.` |
| `move.effect.bubble_burst` | `Marque la cible et donne une barrière de 3.` | `Marks the target and grants a barrier of 3.` |
| `move.effect.petal_ray` | `Inflige des dégâts et rend 3 % des PV à l'équipe.` | `Deals damage and restores 3% of the team's HP.` |
| `move.effect.leaf_mantle` | `Signature : donne des barrières de 8 et 7, soigne 4 % des PV et retire un malus à tous.` | `Signature: grants barriers of 8 and 7, heals 4% HP, and removes one penalty from each ally.` |
| `move.effect.tide_reversal` | `Récupère 25 % des dégâts infligés et retire un malus.` | `Recovers 25% of damage dealt and removes one penalty.` |
| `move.effect.fate_exchange` | `Récupère 25 % des dégâts infligés, puis subit 12 % de dégâts de recul.` | `Recovers 25% of damage dealt, then takes 12% recoil damage.` |
| `move.effect.immaculate_relay` | `Signature : l'allié choisi entre Purifié et Concentré après les attaques ennemies.` | `Signature: the chosen ally enters Cleansed and Focused after enemy attacks.` |
| `move.effect.last_spark_duel` | `Signature : plus puissante quand tu es blessé ; retire un malus.` | `Signature: stronger while you are hurt; removes one penalty.` |
| `move.effect.pulse_punch` | `Inflige des dégâts et soigne chaque allié de 2 %.` | `Deals damage and heals every ally by 2%.` |
| `move.effect.unbroken_circle` | `Signature : soigne 7 % des PV, donne une barrière de 6 et retire tous les malus.` | `Signature: heals 7% HP, grants a barrier of 6, and removes every penalty.` |
| `passive.effect.foresight` | `À sa première entrée, devient Concentré.` | `On first entry, becomes Focused.` |
| `passive.effect.memory_silk` | `Quand elle inflige un malus, elle récupère 5 PV.` | `When it applies a penalty, it restores 5 HP.` |
| `passive.effect.duel_oath` | `Si les deux combattants ont plus de 50 % de leurs PV, les dégâts augmentent de 12 %.` | `Damage increases by 12% while both fighters are above half HP.` |
| `passive.effect.last_bastion` | `Sous 50 % de PV, gagne une barrière de 16 une fois.` | `Below 50% HP, gains a barrier of 16 once.` |
| `passive.effect.foundation` | `À sa première entrée, gagne une barrière de 14.` | `On first entry, gains a barrier of 14.` |
| `passive.effect.nine_lives` | `Survit à 1 PV une fois par combat au lieu d'être K.O.` | `Survives at 1 HP once per battle instead of being knocked out.` |
| `passive.effect.ember_cocoon` | `Sous 50 % de PV, gagne une barrière de 10 une fois.` | `Below 50% HP, gains a barrier of 10 once.` |
| `passive.effect.conductor` | `À sa première entrée, devient Accéléré pendant 2 tours.` | `On first entry, gains Haste for 2 turns.` |
| `passive.effect.ill_omen` | `À chaque entrée, marque l'adversaire pendant 2 tours.` | `On every entry, Marks the enemy for 2 turns.` |
| `passive.effect.burning_code` | `Une Riposte réussie inflige Brûlure à l'attaquant survivant une fois par tour.` | `A successful Counter applies Burning to the surviving attacker once per turn.` |
| `passive.effect.shared_breath` | *(from Task 16 — keep that wording)* | *(idem)* |

Before applying `conductor`/`ill_omen` durations, verify the numbers against `src/battle/passives.js` — if a duration differs, use the real one.
- [ ] **Step 3: Capitalization sweep** over `move.effect.deja_vu`, `mirror_maze`, `iron_resolve`, `fortress_protocol`, `ember_armor`, `ancient_bark`, `linked_guard`, `spectrum_break`: canonical capitalized status nouns per the rule; no other wording change.
- [ ] **Step 4:** `npm test` (includes signature-tooltip sync test in `data-ai.test.js` — if it pins any of these strings, update the pinned copy). Bestiary + battle tooltips spot-check, both locales. Commit.

### Task 18: Intent, advice, academy, plural cleanup (C7, C8, C10)

**Files:** Modify `src/i18n.js` only.

**Steps:**

- [ ] **Step 1: Intent/forecast keys:** `battle.switchForecast` FR `ACTION PRÉVUE` EN `PREDICTED ACTION`; `battle.intent` FR `ACTION PRÉVUE` EN `PLANNED ACTION`; `battle.intentHidden` FR `Cachée` EN `Hidden`; `battle.intentSwitchTo` FR `Changement : {name}` EN `Switch to {name}`; `battle.switchRecommended` FR `Changement conseillé` EN `Recommended switch`; `battle.switchHint` FR `Le nouvel allié prendra l'attaque ennemie de ce tour.` EN `The incoming ally takes this turn's enemy attack.`; `battle.replacementHint` FR `Choisis un allié encore debout pour continuer.` EN `Choose an ally who can still fight.`
- [ ] **Step 2: Advice keys** (`advice.title/ace/affinity/switch/cleanse/barrier/surge/tempo`): apply the concrete-next-step rewrites from the findings §2c source table (CopyI18n P2-6) verbatim — e.g. `advice.title` FR `Conseils de l'entraîneur` EN `Coach Tips`; `advice.affinity` FR `Tes attaques ont souvent été peu efficaces. Change de créature pour prendre l'avantage de type.` EN `Your attacks were often weak. Switch creatures to gain a type advantage.` — and the remaining six rows as specified there.
- [ ] **Step 3: Academy keys** (`academy.affinityHint`, `academy.mechanics` → FR `Astuces de combat` EN `Battle tips`, `academy.surge`, `academy.core.1/2/4/8.desc`): full-sentence rewrites per CopyI18n P2-7 table.
- [ ] **Step 4: Plural scaffolding:** EN drops all `(s)` (`{count} favorable targets`, `{count} threats`, `{count} new Combo routes`, `{count} wins`, `{turns} turns left`, `{count} active boons`, `{count} total wins`, `{count} Champion Circuit wins`); FR keeps `(s)` only where genuinely unavoidable, otherwise plural (`Encore {turns} tours`, `Record : {count} victoires`, `{count} victoires au total`, `{count} victoires dans le Circuit`, `Draft remporté · {count} victoires`).
- [ ] **Step 5:** `node --test test/advice.test.js test/i18n-save.test.js && npm test`; results + academy screens spot-check both locales. Commit.

### Task 19: Terminology + mode/log/error copy (C11, C12, C13, part of I6)

**Files:** Modify `src/i18n.js`; `src/screens/title.js:57` (branding); check `styles/screens/battle-layout.css:619-630` fit.

**Steps:**

- [ ] **Step 1: Team terminology:** `loadout.title` FR `Mes équipes` EN `My Teams`; `loadout.hint` FR `Enregistre jusqu'à trois équipes de trois avec leur meneur.` EN `Save up to three teams of three with their lead.`; `loadout.slot` FR `Équipe {slot}` EN `Team {slot}`; `loadout.clear` FR `Effacer cette équipe` EN `Clear this team`; `squad.title` FR `Équipes recommandées` EN `Recommended teams`; `squad.hint` FR `Un clic choisit l'équipe et son meneur.` EN `One click selects the team and its lead.`; `trial.squad` EN `Current team`; `league.squad` FR `ÉQUIPE` EN `TEAM`.
- [ ] **Step 2: Mode descriptions:** apply CopyI18n P2-12 rewrites for `league.subtitle`, `league.hidden`, `gauntlet.select`, `trial.subtitle`, `trial.challenge` (FR `Jouer cette épreuve` / EN `Play this trial`), `circuit.subtitle`.
- [ ] **Step 3: Log/error/misc:** `battle.log` FR `Journal du combat` EN `Battle Log`; `battle.logHint` FR `Le journal conserve les 40 derniers événements du combat.` EN `The log keeps the last 40 battle events.`; `error.webgl` FR `Cette arène ne peut pas s'afficher. Essaie un navigateur récent ou active les graphismes accélérés.` EN `This arena cannot be displayed. Try a recent browser or enable graphics acceleration.`; `error.context` FR `L'affichage de l'arène s'est arrêté. Recharge la page pour continuer.` EN `The arena display stopped. Reload the page to continue.`; `draft.kitInsight` FR `Profil {archetype} · effet clé : {talent}.` EN `{archetype} profile · key effect: {talent}.`; `draft.archetype.burst` FR `attaque` EN `damage`; `battle.action.tick` EN: replace "removes HP" phrasing with `{actor} loses {amount} HP from {status}.`; `move.last_spark_duel` FR `Dernière étincelle` EN `Last Spark`; bestiary empty-record copy (`i18n.js:74, 527`) → FR `Tes combats enregistrés apparaîtront ici.` EN `Your recorded battles will appear here.`; `app.tagline` FR `…Une équipe à créer.` EN `…One team to build.`; `record.kos` EN `KOs`.
- [ ] **Step 4: Title branding via dictionary (I3):** add `title.brandPrefix`/`title.brandName` keys (FR `Arène de`/`Noam`; EN `Noam's`/`Arena`) and render both through `t()` in `title.js:57` instead of the `i18n.lang` conditional.
- [ ] **Step 5:** `npm test`; verify the shortened move name fits un-ellipsized in a move button; tour League/Trials/Gauntlet/Draft in both locales. Commit.

---

## Phase D — Screen flow

### Task 20: Results action hierarchy (S3, S4, S5, S6)

**Files:**
- Modify: `src/screens/results.js:313-345`, `src/screens/gauntlet.js:60-65`
- Modify: `src/i18n.js` (`result.nextTrial` key)
- Modify: `styles/components.css` / `styles/screens/results.css` (action row placement)

**Steps:**

- [ ] **Step 1: Move actions up.** In the results template, render the `.result-actions` row immediately after the grade block (before streak/team/MVP/reports); keep analytics below. Verify the reveal animation classes still sequence sensibly (actions may join `results-reveal--1`).
- [ ] **Step 2: Primary retry on defeat.** When `!win`, build the Rematch button with `primary-btn`; keep Review/Back subtle. When `win`, the existing `next-battle`/`next-circuit` primary stays.
- [ ] **Step 3: Trial follow-up.** For `mode === 'trial'`, add a subtle `next-trial` action (`result.nextTrial` FR `Voir les épreuves` EN `View trials`) that clears `ctx.selection` and calls `renderTrials()`.
- [ ] **Step 4: Defeat analytics tone.** In the performance breakdown, omit the `victory` bonus row on defeat; in `results.js:210-217`, when every contribution is zero, omit the MVP block entirely.
- [ ] **Step 5: Verify.** Win and lose one battle each: actions visible without scrolling at 1440×900 **and** 375×667; defeat shows a single obvious primary Rematch; trial victory offers the trials route. `npx playwright test e2e/gameplay.spec.js e2e/progression-responsive.spec.js`. Commit.

### Task 21: Settings polish (S7, V1, V2 + slider value)

**Files:**
- Modify: `src/screens/settings.js`, `src/app/shell.js:53-55` (topbar binding)
- Modify: `styles/components.css:432-452`, `styles/base.css:581-588`

**Steps:**

- [ ] **Step 1: Return to origin.** Record the invoking page when settings opens: in the shared topbar binding, capture `screen.dataset.page` into `ctx.settingsReturn` before `renderSettings()`; `renderSettings` passes that page to `topbar(...)`, and `bindCommon`'s back action routes through a small map `{selection: renderTeamSelect, bestiary: renderBestiary, academy: renderAcademy, …}` falling back to title. Preserve `ctx.selection` when returning to selection.
- [ ] **Step 2: Real sliders.** Scope the 24×24 rule to checkboxes (`.toggle-row input[type="checkbox"]`), then style ranges: full-width track using `::-webkit-slider-runnable-track` / `::-moz-range-track` with `var(--line)` background, accent thumb, `min-inline-size: 140px`.
- [ ] **Step 3: Value readout.** Add `<output>` next to each slider showing `Math.round(value*100)%`; update on `input` (no full rerender while dragging); set `aria-valuetext` to the same string.
- [ ] **Step 4: Grid alignment.** `settings-grid { align-items: start; }` so the help card stops stretching into an empty patterned rectangle.
- [ ] **Step 5: Verify.** Open settings from team select → back returns to team select with selection intact; sliders show track + live %; desktop/mobile screenshots to `agents/polish-audit/after/`. `npm run test:e2e` smoke. Commit.

### Task 22: Navigation hygiene (S8, A1, S11)

**Files:**
- Modify: `src/app/shell.js:210-232`
- Modify: `src/screens/team-select.js:352-437`, `src/screens/draft.js:103-139`, `src/screens/gauntlet.js:95-105`, `src/screens/settings.js` rerender paths

**Steps:**

- [ ] **Step 1: Scroll + focus on page change.** In `transitionScreen`, when `targetPage !== screen.dataset.page`: after `render()`, run `screen.scrollTo(0, 0)` and focus the new heading — `screen.querySelector('h1')?.setAttribute('tabindex','-1'); screen.querySelector('h1')?.focus({ preventScroll: true });`. Same-page rerenders keep scroll.
- [ ] **Step 2: Focus-restore helper** for same-screen rerenders:

```js
export function rerenderPreservingFocus(render) {
  const active = document.activeElement;
  const key = active?.dataset?.focusKey ?? null;
  render();
  if (key) ctx.screen.querySelector(`[data-focus-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}
```

Give stable `data-focus-key` values to preset/remix/custom/difficulty/arena/rule/enemy controls in team-select, draft pick/lead buttons, gauntlet lead buttons, and settings toggles; route their rerenders through the helper. (Cards/filters that already restore focus keep their existing logic.)
- [ ] **Step 3: Verify with keyboard only:** tab to a difficulty button, activate, focus stays on it; navigate title → bestiary while scrolled → lands at top with heading focused. `npx playwright test e2e/progression-responsive.spec.js`. Commit.

### Task 23: Team-select flow (S12, S13, W1, A7)

**Files:**
- Modify: `src/screens/team-select.js:278-311`, `styles/overrides/selection.css:533-610, 719-727`, `styles/screens/selection.css:84-94`, `styles/screens/progression.css:77-81, 916-936`, `styles/components.css:963-982`

**Steps:**

- [ ] **Step 1: Desktop CTA.** Pin the ready action inside the sticky `.select-aside` next to the 3/3 summary (independent of the long plan contents) so a valid trio always sees its confirm button; keep the end-of-page button too.
- [ ] **Step 2: Mobile safe area.** Measure the fixed CTA + dock combined height and set the selection shell's bottom padding to it plus `env(safe-area-inset-bottom)` (currently 86px vs ~120px actual); confirm the last roster card scrolls fully clear.
- [ ] **Step 3: Plan shortcut target.** `team-select.js:306-311`: after opening `.battle-plan`, scroll/focus `.battle-plan > summary` (offset for the fixed bars), not `.select-aside`.
- [ ] **Step 4: Enemy picker targets.** At ≤600px drop the forced 8 columns to `repeat(auto-fill, minmax(44px, 1fr))` and restore ≥44px hit areas on `.enemy-picker .icon-btn`; keep a non-opacity selected cue (existing outline pattern).
- [ ] **Step 5: Squad track overflow (W1).** `grid-template-columns: 160px minmax(0, 1fr)` and `.squad-preset-track { min-width: 0; max-width: 100%; }`.
- [ ] **Step 6: Custom-squad buttons (A7).** Raise `min-height` back to 44px (visual compactness via padding, not hit area).
- [ ] **Step 7: Verify** at 1440/768/375/320: CTA reachable with 0 scrolling once 3/3 selected (desktop), nothing hidden under fixed bars, plan button lands on the plan. `npx playwright test e2e/progression-responsive.spec.js`. Commit.

### Task 24: Bestiary flow (S9, S10, S14, W3, S15-expanded)

**Files:**
- Modify: `src/screens/bestiary.js:53-160`, `src/app/shell.js:83-145`
- Modify: `styles/overrides/selection.css:351-403`, `styles/screens/bestiary.css:157-224`, `styles/screens/progression.css:696-711`
- Modify: `src/i18n.js` (`bestiary.noResults`, `bestiary.clearFilters`)

**Steps:**

- [ ] **Step 1: Empty state.** Keys: FR `Aucune créature trouvée.` / EN `No creatures found.`; FR `Effacer les filtres` / EN `Clear filters`. In `installBestiaryFilters().apply()`, when 0 visible, show a card with that copy + a clear button that resets search/chips and refocuses the search field.
- [ ] **Step 2: Theater dedup + focus (S10, A3).** Serialize `openMoveTheater` with a token (`const req = ++theaterRequest; …await ensureBattleStyles(); if (req !== theaterRequest) return;`), remove any existing `.move-theater` before mounting, save the `[data-preview-move]` trigger and focus it in every close path.
- [ ] **Step 3: Mobile order.** Below the compact breakpoint, render search/filter tools directly under the page heading and collapse the Hall of Records + feat hall into closed `<details>` disclosures; desktop order unchanged.
- [ ] **Step 4: Sticky trim.** Keep only the search row sticky (≤52px); filter chips expand on demand and un-stick.
- [ ] **Step 5: Feature-hall narrow layout (W3).** Move the existing `max-width:900px` hall override out of the battle-only `battle-presentation.css` into `progression.css` so it applies on first render.
- [ ] **Step 6: Desktop expanded card.** Give `.bestiary-card.expanded` `grid-column: span 2` at wide widths (single column stays on mobile).
- [ ] **Step 7: Verify:** mobile bestiary shows search within the first viewport; misspelled search shows the empty state; rapid double-click on a move opens exactly one theater and closing restores focus. `npm run test:e2e` full (bestiary paths live in gameplay/progression specs). Commit.

### Task 25: Battle dialog semantics (A2, A5, A6, W2, B13)

**Files:**
- Modify: `src/battle-ui/controller.js:190, 539-541, 654-672`, `src/battle-ui/hud.js:160-190, 189`
- Modify: `src/app/shell.js:244-247`
- Modify: `styles/screens/battle-layout.css:958-975`

**Steps:**

- [ ] **Step 1: Replacement dialog.** Add `role="dialog" aria-modal="true" aria-labelledby="<h2 id>"` to `.replacement-card`; store the opener element in `openSwitch()`; route Escape (shell.js:244) and cancel through one `closeSwitch()` that clears the root and restores opener focus (skip restore when a forced replacement re-opens).
- [ ] **Step 2: Speed button name (A5).** Localized `aria-label` on refresh: key `battle.speedLabel` FR `Vitesse du combat : ×{speed}` EN `Battle speed: ×{speed}`.
- [ ] **Step 3: HUD plate summary (A6).** Compose the accessible name from creature + HP + statuses + team readiness (the pip labels already exist) instead of the flat "open details" label; keep a short visible label.
- [ ] **Step 4: Status overflow (B13).** Make the `+N` chip a button opening `openPlateDetails(side)`; its `aria-label` lists hidden status names.
- [ ] **Step 5: Mobile rule wrap (W2).** Allow the arena rule two lines on mobile (`white-space: normal; -webkit-line-clamp: 2` pattern) instead of single-line ellipsis.
- [ ] **Step 6: Verify** with keyboard + VoiceOver spot-check: tab-trap inside the switch overlay, Escape restores focus, plate button announces HP/statuses. `npx playwright test e2e/battle-layout.spec.js`. Commit.

---

## Phase E — Visual & accessibility

### Task 26: Reduced-motion and `?animations=0` correctness (V7, V8, R1–R3)

**Files:**
- Modify: `src/battle-ui/fx.js:39` (entry guards), `styles/screens/battle-fx.css:2250-2295`, `src/presentation/arena.js:473-505, 563-577`, `index.html:35` + tiny inline bootstrap

**Steps:**

- [ ] **Step 1: FX kill-switch.** At the top of `beginMoveFx`, `tacticalFx`, `statusTickFx`, `trainerCommandFx`, and the reaction FX entries: `if (testAnimationScale === 0) return;` (playback already compresses delays; FX nodes simply stop being built).
- [ ] **Step 2: Reduced-motion CSS.** Remove `idle … infinite` from the two `fxReduced` shorthands and the `.reduced-motion` body path — keep only the short state-change animation.
- [ ] **Step 3: Reduced-motion bursts.** In `arena.js`, when `this.reducedMotion`: skip the moving burst (`burst()` returns after the light flash) and render a single static glow decay instead; render loop skips `burstLife` advancement.
- [ ] **Step 4: Pre-render preference classes (V8/S1).** Inline `<script>` in `index.html` before the stylesheet paint: read the save key, add `reduced-motion`/`high-contrast` classes to `<html>`; `context.js` reconciles later. Also set `document.documentElement.lang` there from the saved/URL language (covers I1 and half of I5).
- [ ] **Step 5: Verify:** `?animations=0` battle shows no FX nodes (DOM inspect) and e2e stays green (`npm run test:e2e` — the whole suite runs with animations off, so this is the real regression gate); reduced-motion battle has no infinite idle; cold reload with saved high-contrast shows no unstyled flash.
- [ ] **Step 6: Commit.**

### Task 27: High-contrast + visual details (V4, V5, V6, S15, V9, V10, I2)

**Files:**
- Modify: `styles/screens/accessibility.css:17-28, 91-93`, `styles/screens/progression.css:715-759, 1365-1367`, `styles/components.css:525-527`, `styles/base.css:332-390`, `styles/overrides/selection.css:108-119`, `src/screens/title.js:60`, `src/screens/draft.js:95-96`, `src/screens/trials.js:16`

**Steps:**

- [ ] **Step 1: HC surface contract (V5).** Define `.high-contrast :is(.feat-hall, .record-hero, .league-rival, .draft-card, .boon-card, .academy-card) { background: var(--panel-strong, #10132e); border: 2px solid var(--line-strong, #cfd4ff); }` (reuse existing HC token values from the current shared-card rule) and suppress the background pattern under `.high-contrast`.
- [ ] **Step 2: HC disabled moves.** Replace opacity/grayscale dimming with full-contrast text + a `▦`/lock corner marker and dashed border for unavailable moves under `.high-contrast`.
- [ ] **Step 3: Locked feats (V4).** Text at full opacity, `saturate(.6)` on artwork only, visible lock glyph, 1px stronger border.
- [ ] **Step 4: Defeat sprites (V6).** `filter: grayscale(.45) brightness(.8)` so identity survives the fallen state.
- [ ] **Step 5: Small-screen details.** Localized LAST badge (I2): render from a `data-last-label` attribute set in the battle template (`t('battle.lastBadge')`, new key FR `DERNIÈRE` EN `LAST`) with `content: attr(data-last-label)`. Draft empty combo heading: render the existing no-routes empty copy in compact mode or drop the heading (draft.js:95-96). Title records: visible short labels next to the ♛/↟ values (`title.js:60`, reuse existing record keys). Trials squad strip: 44px portrait chips (trials.js:16). Squad-rail scroll cue (V10): right-edge mask fade + `scroll-snap-type: x proximity`. Title fan dead zone (V9): reduce reserved height to ~140px.
- [ ] **Step 6: Verify:** high-contrast pass over title/selection/battle/bestiary/results at both breakpoints (screenshots to `agents/polish-audit/after/`); `npm test` (presentation contract) still green. Commit.

### Task 28: CSS/token cleanup (V3, V11, D1, I6 remainder)

**Files:**
- Modify: `styles/tokens.css`, `styles/base.css:28-47`, `styles/components.css:220-230, 697-723`, `styles/overrides/academy.css:2-4`, `styles/screens/accessibility.css:348-351`, `index.html:6`, `src/i18n.js` (delete unused keys)

**Steps:**

- [ ] **Step 1: Pattern scrim (V3).** Give dense utility panels (settings cards, bestiary tools, selection filter/kit strips) an opaque background token instead of `#ffffff07/08`; keep the motif visible in open layout areas.
- [ ] **Step 2: Token debt.** Add `--radius-s/m/l` (map the 3 most common of the current 18–26px values) and use them in the shared card/button rules touched by this plan; remove the dead `--panel` token or use it as the scrim from Step 1. Add named z-index tokens for veil/theater/toast and point the current literals (base.css:54, components.css:233/344/618, accessibility.css:165) at them. Do **not** restyle unrelated screens.
- [ ] **Step 3: Dedupe.** Merge the two `.team-dot` blocks (components.css:220-230 + 697-723) into one and drop the `!important`s; scope the academy `.menu` gap to `.academy-page .menu`; delete the unreachable `.difficulty-preview.difficulty-challenger` rule.
- [ ] **Step 4: Theme color.** Set `<meta name="theme-color">` to the actual boot surface value from `tokens.css`.
- [ ] **Step 5: Unused i18n keys (I6).** Delete the confirmed-unused cluster (`app.next`, `app.loading`, `title.new`, `select.randomTeam`, `battle.power/speed/mute/help/thinking`, `bestiary.loreUnlock`) **except** any key a previous task started using (`settings.logKey` is superseded by Task 19's rewrite — keep it only if the settings/help screen actually renders it; verify with a grep first).
- [ ] **Step 6:** `npm test && npx playwright test e2e/smoke.spec.js`; visual diff spot-check on title/settings/bestiary. Commit.

---

## Phase F — Performance

### Task 29: Cheap wins bundle (F2, F4, F5, F7, F8, F9)

**Files:**
- Modify: `src/battle-ui/fx.js:28-35, 322-326, 408-493`, `src/presentation/arena.js:97, 500-505`, `index.html:21-31`, `src/app/context.js:176-203`, `src/screens/bestiary.js:148`, `src/screens/team-select.js:156`

**Steps:**

- [ ] **Step 1: Animation-sync guard (F2).** Track `lastAppliedSpeed`; `syncBattleAnimationSpeed()` returns immediately when speed unchanged; full `getAnimations({subtree:true})` traversal only on actual change.
- [ ] **Step 2: Layout flush (F4).** Replace `void canvas.offsetWidth` with a double-`requestAnimationFrame` class re-add (remove class → rAF → add class), preserving animation restart semantics.
- [ ] **Step 3: CSS preloads (F5).** Remove the 8 battle-sheet `rel=preload` links from `index.html`; instead call `ctx.ensureBattleStyles()` (or a prefetch variant) when team selection renders, so first battle entry still finds warm styles. Measure: battle entry from selection shows no flash of unstyled battle UI.
- [ ] **Step 4: DPR cap (F7).** In `arena.js`, compute the cap from canvas area: `const cap = canvas.clientWidth * canvas.clientHeight > 500000 ? 1.5 : 2; renderer.setPixelRatio(Math.min(devicePixelRatio, cap));` — keep 2 for small/desktop-window canvases.
- [ ] **Step 5: Image hints (F8).** Add `loading="lazy" decoding="async" width="128" height="128"` to bestiary/team-select roster `<img>`s (keep the battle/hero sprites eager).
- [ ] **Step 6: FX timer registry (F9).** Collect FX `setTimeout` ids in a session-scoped set; `clearBattleFx()`/session cancel clears them; every callback removes its node unconditionally.
- [ ] **Step 7: Verify:** `npm test && npm run test:e2e` full; play at ×2 toggling speed mid-battle (F2 correctness); battle on a DPR-2 window renders crisply at cap 1.5. Commit.

### Task 30: Battle DOM churn (F1, F3)

**Files:**
- Modify: `src/battle-ui/controller.js:440-555`, `src/battle-ui/fx.js:39-107, 198-212, 347-354`

**Steps:**

- [ ] **Step 1: Skip locked rebuilds (F1).** In `refreshBattle()`, when `ctx.locked` and the active creature + legal action set are unchanged since the last render (cache a small key: active ids + hp buckets + cooldown states), update only HUD text/HP/status nodes and skip the `#moves` innerHTML rebuild + listener rebinding. Note: coordinate with Task 12's `displayState` — the cache key must come from the same view the HUD renders.
- [ ] **Step 2: Delegate move clicks.** Bind one click/pointer handler on `#moves` (event delegation on `[data-move]`) installed once per battle instead of per-refresh per-button listeners; long-press logic moves to the container too.
- [ ] **Step 3: FX node budget (F3).** Cache the static portions of the FX markup (template strings built once per archetype) and halve particle counts when `matchMedia('(pointer: coarse)')` matches and DPR ≥ 2. Full node pooling is **not** required — stop at measurable reduction.
- [ ] **Step 4: Verify:** DevTools performance recording of 3 turns before/after shows reduced scripting/GC during attacks; all battle e2e specs green; double-click chaos test from Task 2 still holds (delegation must respect `ctx.locked`). Commit.

### Task 31: Web Audio lifecycle (F6)

**Files:**
- Modify: `src/sound.js:397-465, 555-666, 692-705`

**Steps:**

- [ ] **Step 1:** For every scheduled note/SFX chain, keep the node list and `disconnect()` all nodes in the source's `ended` handler (extend `trackSource` to accept the chain).
- [ ] **Step 2:** After a theme crossfade completes, `disconnect()` and drop the previous `themeBus`/`tensionThemeBus`.
- [ ] **Step 3: Probe.** Dev-only counter (`sound._nodeCount`, incremented on create / decremented on disconnect, behind a `?audiodebug=1` flag or temporary script in `agents/`): play 10 minutes of navigation + 3 battles; count must plateau, not climb.
- [ ] **Step 4:** `node --test test/audio.test.js && npm test`; listen for regressions (theme switch, tension ramp, victory stinger). Commit.

---

## Phase G — Cleanup & final verification

### Task 32: Save schema v16 + validation (D7, D8, D9)

**Files:**
- Modify: `src/save.js`, `src/screens/results.js:182-185`, `src/screens/settings.js:69-78` (reset-save object)
- Test: `test/i18n-save.test.js`

**Steps:**

- [ ] **Step 1: Failing migration test.** A v15 save containing `emblems`, `cosmetics`, `volume`, and `wins > battlesPlayed` migrates to v16 with those fields gone and counters clamped (`wins ≤ battlesPlayed`, record wins ≤ record battles, streak ≤ wins).
- [ ] **Step 2:** Bump `SAVE_VERSION` to 16; add `migrateV16` dropping `emblems`/`cosmetics`/`volume` and clamping counters; remove the fields from `DEFAULT_SAVE`, `validateSave`, the results-screen writes, the settings reset object, and the `sound.js` master-volume read (music/SFX channels remain).
- [ ] **Step 3:** `node --test test/i18n-save.test.js && npm test`; manual: load with an existing pre-change save → progression intact, no console errors. Commit.

### Task 33: Dead code sweep (B14, D1 leftovers, unreferenced assets)

**Files:**
- Modify: `src/battle-ui/controller.js`, `src/battle-ui/fx.js`, `src/battle-ui/playback.js`, `src/battle-ui/hud.js`
- Delete: `assets/monsters/{abyssar,calderoc,farfombre,kordane,virelia}/battle-large.png`

**Steps:**

- [ ] **Step 1:** Remove the unused destructured bindings (`ARENAS`, `affinity`, `affinityName`, `quickRule`) and the dead `label`/`cls` assignments in `hud.js:218-229` — verify each with a project-wide reference search before deleting.
- [ ] **Step 2:** Delete the five unreferenced `battle-large.png` files (4.4 MB; runtime always resolves `battle.png`); confirm `asset-manifest.json` doesn't list them.
- [ ] **Step 3:** `npm test && npx playwright test e2e/smoke.spec.js`. Commit.

### Task 34: Release verification

**Steps:**

- [ ] **Step 1: Format.** `npm run format` (only now — end of plan), commit any diffs as `polish: format`.
- [ ] **Step 2: Full suites.** `npm test && npm run test:balance && npm run test:e2e` — all green; balance table compared against the pre-plan baseline (only D2/D4 deltas expected; paste both tables in the commit message).
- [ ] **Step 3: Manual sweep** (the release gate — mirror the audit's play-through): fresh profile → tutorial fully visible → complete it; one Quick Battle at ×1 and ×2; one defeat → primary Rematch above the fold; settings from team select and back; bestiary search with a typo; mobile 375×667 pass over title/selection/battle/results; `?lang=en` pass over the same; reduced-motion + high-contrast battle. Screenshot set to `agents/polish-audit/after/`.
- [ ] **Step 4: Docs.** Update `README.md`/`docs/` only if a stable contract changed (Coach naming appears in `README.md` game rules — check and update the FR/EN naming there). Commit.

---

## Self-review notes

- **Spec coverage:** every P0/P1/P2 finding in the register maps to a task; P3s are folded into Tasks 19/27/28/33. Explicitly deferred (findings §7): balance retune, browser history, code-splitting (F10), new-content visual-plan leftovers.
- **Order rationale:** Phase A unblocks a child immediately; Task 12 (state staging) lands **after** pacing (Task 5) so timing tuning isn't redone; Task 30 explicitly coordinates with Task 12's `displayState`; copy phases precede screen-flow tasks that reference new keys (Task 25 uses Task 18's forecast keys only for placement, not content).
- **Type consistency:** `claimBattleLock` (Task 2) is assumed by Tasks 12 and 30; `session.displayState` (Task 12) is consumed by Task 30's cache key; `ctx.persist()` return (Task 4) is not consumed elsewhere; save v16 (Task 32) runs after all feature-facing tasks so no earlier task reads removed fields.
