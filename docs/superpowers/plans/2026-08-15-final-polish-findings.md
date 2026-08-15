# Final Polish — Consolidated Findings Register

Spec for `2026-08-15-final-polish.md`. Synthesized from an 8-agent audit (2026-08-15): status verification of prior artifacts, battle UX, out-of-battle UX, copy/i18n, visual/CSS, performance, data/save robustness, and a live browser play-through (screenshots in `agents/polish-audit/screenshots-live/`).

Baseline at audit time: `npm test` 99/99 pass; `npm run test:e2e` 49 pass + 2 flaky (pass on retry); `npm run test:balance` exit 0.

Severity: **P0** = bug a child hits in the first session · **P1** = repeated visible friction on a core loop · **P2** = quality/polish with visible impact · **P3** = cosmetic/maintenance.

Prior artifacts: all 23 findings in `agents/polish-audit/reports/code-polish.md` verified **still open** at HEAD; they are folded into this register with their original IDs (A1–A7, R1–R3, I1–I6, W1–W3, D1, P1, S1–S2).

---

## 1. Battle experience

| ID | Sev | Finding | Refs | Fix direction |
|---|---|---|---|---|
| B1 | P0 | Tutorial coach card rendered half off-screen (x = −154 desktop, −159 mobile); covers the only enabled move on mobile; hides skip link. Blocks the first-run path. | `styles/components.css:369-382` sets `transform: translateX(-50%)`; `styles/screens/battle-layout.css:755-766` sets `position: static` without resetting the transform | Reset `transform: none` in the battle override; bound `#tutorial-root` width; keep tip clear of the action dock at 375px |
| B2 | P0 | Action-submission race: `handlePlayerAction`/`handleTrainerCommand` check `ctx.locked` then `await sound.unlock()` before locking — a second click in the gap double-resolves. `handleReplacement` has **no** lock guard. No `try/finally`, so an exception leaves the battle locked forever. | `src/battle-ui/controller.js:675-687, 691-731, 751-763` | Claim lock synchronously before any `await`; guard `handleReplacement`; wrap in `try/finally` |
| B3 | P0 | Global shortcuts `1/2/3/C/L` fire behind open Codex/Log dialogs (they don't set `ctx.locked`), starting turns while the child reads. | `src/input/keyboard.js:19-26`; `src/battle-ui/controller.js:258-347` | Bail out of shortcuts when `screen.querySelector('#replacement-root [role="dialog"], .replacement, .battle-dialog')` is present |
| B4 | P1 | HUD reveals the turn's **final** state before events play: `session.state` is assigned then `playEvents()` calls `refreshBattle()` immediately — HP bars, statuses, KO, and switched-in sprites spoil the sequence they're meant to explain. | `src/battle-ui/controller.js:716-718`; `src/battle-ui/playback.js:88, 277` | Presentation snapshot advanced per event (see plan Task 12) |
| B5 | P1 | Serial playback delay: representative 10-event turn ≈ 3.2–3.6 s at ×1 vs the brief's 1.5–2.5 s target. Suppressed combo-consumed status events still wait 460 ms; `move-skip` has no visuals but waits 300 ms. | `src/battle-ui/playback.js:52-83, 280` | Zero-delay suppressed events; trim per-type delays; keep KO/signature/ace beats long |
| B6 | P1 | Consumed statuses narrated as cleanses: `applied:false` always uses `battle.action.cleanse`, so spending Focused reads as "breaks free" — the +40 % Combo payoff is mis-explained. | `src/battle-ui/playback.js:143-155` | Branch on `event.consumed` first with new `battle.action.consumed` key |
| B7 | P1 | Coach command is a 44px icon-only tile: layout CSS hides its `<small>` label; disabled state gives no reason. Undiscoverable once-per-battle recovery tool. | `styles/screens/battle-layout.css:139-166`; `src/battle-ui/controller.js:545-551` | Show caption; add localized disabled reason as visible helper/`title` |
| B8 | P1 | Simple mode hides exact damage preview behind an undocumented 420 ms long-press; mouse and touch players get materially different information. | `src/battle-ui/hud.js:276-306`; `src/battle-ui/controller.js:371-407` | Visible predicted-damage row or "hold for details" cue in simple mode |
| B9 | P1 | Mobile exchange forecast rendered at **6px**; mobile move descriptions 9px; switch overlay forecast/passive text 9px. Core "read before confirming" copy below legibility. | `styles/overrides/battle-preview.css:38-53`; `styles/screens/battle-layout.css:1062-1085`; `styles/screens/battle-presentation.css:136-142` | ≥10-11px floors, allow second line, trim decoration first |
| B10 | P1 | Portrait battle hides mute and ×2 speed (`display:none`) — the two comfort controls a child most needs mid-battle. | `styles/screens/battle-layout.css:932-989` | Keep both visible as compact 44px chips |
| B11 | P2 | Tutorial end bypasses `battleOutroFx()`; 500 ms timeout jumps straight to team select — no closure moment. | `src/screens/results.js:170-174` | Run the short outro (reduced-motion aware) before `completeTutorial()` |
| B12 | P2 | Battle log omits `move-skip` and `battle-end`; child can't see why a KO'd fighter didn't act or how the battle ended. Chronicle side identity in mirror matches is a bare ◆/◇ glyph. | `src/app/context.js:68-87`; `src/battle-ui/controller.js:321-337` | Add log entries + "Your X / Rival X" prefixes (localized) |
| B13 | P2 | Simple-mode status overflow is a bare `+N` with no way to learn what's hidden. | `src/battle-ui/hud.js:160-190` | Overflow opens plate details; accessible label lists hidden statuses |
| B14 | P3 | Unused imports in battle modules (`ARENAS`, `affinity`, `affinityName`, `quickRule`; `hud.js` dead `label`/`cls` assignments). | `controller.js:4-52`, `fx.js:6-19`, `playback.js:7-16`, `hud.js:218-229` | Delete |

## 2. Copy & i18n (both locales; child-first French)

| ID | Sev | Finding | Refs | Fix direction |
|---|---|---|---|---|
| C1 | P1 | Switch forecast labels predicted damage as "PV/HP" — at the exact decision point it reads as the incoming creature's health. | `src/i18n.js:457-466` | `battle.switchIncoming*` rewrite (table §2a) |
| C2 | P1 | Tutorial steps 1/2/4 use compressed jargon ("Combo, +40 %"). | `src/i18n.js:1980-1984` | Full-sentence rewrites (table §2a) |
| C3 | P1 | `move.effect.kindred_halo` mistranslated in both locales ("concentre, presse" / "Focuses, hastens"); hides real effect. | `src/i18n.js:2239` | Rewrite (table §2a) |
| C4 | P1 | `squad.effect.eclipse_coven` promises "sommeil/sleep" — no sleep status exists. `style.effect.control` FR mistranslated. | `src/i18n.js:739-746` | Rewrite (table §2a) |
| C5 | P2 | Status vocabulary drift: tooltips use loose verbs vs canonical chip names (Concentré/Accéléré/Insaisissable/Riposte/Marqué/Brûlure); EN uses stale "Countering". | `src/i18n.js:842-849, 1941-1946, 2013-2025, 2247-2249` | Normalization rule + table (§2b) |
| C6 | P2 | Coach system named 3 ways: Ordre du dresseur / Ordre donné / Coup de pouce (FR), Trainer Command / Coach Boost (EN). | `src/i18n.js:497-503` | Canonical "Coup de pouce"/"Coach Boost" everywhere |
| C7 | P2 | Literal `(s)`/`(e)` plural scaffolding visible in 9+ strings. | `src/i18n.js:473-475, 627, 714, 719, 754, 1723, 1913` | Neutral plural wording (table §2c) |
| C8 | P2 | Intent/forecast jargon: "LECTURE DU TERRAIN", "Illisible", "Relève". | `src/i18n.js:675-691` | "ACTION PRÉVUE", "Cachée", "Changement" (table §2c) |
| C9 | P2 | Move/passive effect fragments: missing nouns ("barrier 17"), imperative EN ("become Focused"), vague thresholds ("sous moitié"). ~25 keys. | `src/i18n.js:1987-2010, 2013-2265` | Full-sentence rewrites (tables §2b) |
| C10 | P2 | Post-battle advice too abstract ("réveil de l'arène", "réponse défensive"); Academy fragments; mode descriptions formal ("ascension", "dossier", "telle quelle"). | `src/i18n.js:505-514, 597-604, 1451-1454, 1954-1979` | Concrete next-step rewrites (table §2c) |
| C11 | P2 | Team/squad/trio terminology drift across selection/loadout/league surfaces. | `src/i18n.js:605-615, 729-730` | Standardize équipe/team (table §2c) |
| C12 | P2 | `draft.kitInsight` labels a passive-effect sentence as "talent clé". Log/error copy technical ("Chronique", "WebGL"). | `src/i18n.js:1685-1688, 535-551, 832-834` | Rewrites (table §2c) |
| C13 | P3 | `move.last_spark_duel` 29 chars FR, ellipsized in move buttons; post-tutorial bestiary empty copy contradicts play history; misc taglines. | `src/i18n.js:2246, 74, 527` | "Dernière étincelle"; timeline-neutral empty copy |
| I1 | P2 | *(prior)* `html[lang]` stays `fr` for saved-EN sessions until first `setLang`. | `index.html:2`; `src/i18n.js:2286-2293` | Set `documentElement.lang` in `createI18n()` |
| I2 | P2 | *(prior)* CSS `content:'LAST'` badge untranslated. | `styles/screens/progression.css:1365-1367` | Localized `data-` attribute content |
| I3 | P3 | *(prior)* Title branding bypasses dictionary. | `src/screens/title.js:57` | Brand keys via `t()` |
| I4 | P3 | *(prior)* Interpolation is `String()`-only; no locale number formatting. | `src/i18n.js:2296-2299` | `Intl.NumberFormat` for numeric vars |
| I5 | P2 | *(prior)* Bootstrap/fatal-error HTML copy permanently French. | `index.html:7, 38-39, 52-53` | Pre-i18n language pick from URL/save |
| I6 | P3 | *(prior)* Unused legacy key cluster (`settings.logKey`, `app.next`, `battle.power`…). | `src/i18n.js:87, 192-213, 300-320, 359` | Remove (or wire where a task above adopts one) |

### 2a. P1 copy tables (apply verbatim)

| Key | New FR | New EN |
|---|---|---|
| `battle.switchIncoming` | `Dégâts prévus : {damage}` | `Predicted damage: {damage}` |
| `battle.switchIncomingShield` | `Dégâts prévus : {damage} · la barrière absorbe {shield}` | `Predicted damage: {damage} · barrier absorbs {shield}` |
| `battle.switchIncomingKo` | `Dégâts prévus : K.O.` | `Predicted damage: K.O.` |
| `battle.switchIncomingMiss` | `Dégâts prévus : esquive garantie` | `Predicted damage: guaranteed dodge` |
| `battle.switchIncomingTactic` | `Aucun dégât · tactique ennemie` | `No damage · enemy tactic` |
| `battle.switchIncomingSwitch` | `Aucun dégât · changement ennemi` | `No damage · enemy switch` |
| `tutorial.1` | `Le type Combat est faible face au type Psy. Lance Arc lucide pour marquer Kordane.` | `Fighting is weak to Psychic. Use Lucid Arc to Mark Kordane.` |
| `tutorial.2` | `Kordane est Marqué. Lance Énigme lente pour déclencher un Combo (+40 % de dégâts).` | `Kordane is Marked. Use Slowing Riddle to trigger a Combo (+40% damage).` |
| `tutorial.4` | `Calderoc est de type Feu : les attaques Eau sont super efficaces. Fais entrer Abyssar.` | `Calderoc is Fire type: Water attacks are super effective. Bring in Abyssar.` |
| `move.effect.kindred_halo` | `Soigne 12 % des PV, rend tous les alliés Concentrés et Accélérés, et leur donne une barrière de 17.` | `Restores 12% HP, gives all allies Focus and Haste, and grants them a barrier of 17.` |
| `squad.effect.eclipse_coven` | `Marques, contrôle, embuscades.` | `Marks, control, ambushes.` |
| `style.effect.control` | `Utilise Marqué, Enraciné et des malus pour limiter les choix.` | `Uses Marked, Rooted, and penalties to limit choices.` |

### 2b. Status-vocabulary normalization rule + key tables

Rule: whenever an effect applies a status, use the canonical chip label capitalized — FR `Marqué, Brûlure, Concentré, Accéléré, Insaisissable, Riposte, Enraciné, Sonné`; EN `Marked, Burning, Focus/Focused, Haste, Elusive, Counter, Rooted, Dazed`. Barrier is an ordinary noun: FR `une barrière de N`, EN `a barrier of N`. Full replacement tables for `status.effect.*` (focused, countering, marked, stunned, burning), `move.effect.*` (foam_foil, ember_feint, oracle_veil, abyssal_surge, bubble_burst, petal_ray, leaf_mantle, tide_reversal, fate_exchange, immaculate_relay, last_spark_duel, pulse_punch, unbroken_circle + capitalization sweep of deja_vu, mirror_maze, iron_resolve, fortress_protocol, ember_armor, ancient_bark, linked_guard, spectrum_break), `passive.effect.*` (foresight, memory_silk, duel_oath, last_bastion, foundation, nine_lives, ember_cocoon, conductor, ill_omen, burning_code, shared_breath, perfect_ebb), and `arena.rule.astral` are in the CopyI18n audit report — reproduced in plan Task 17 as the authoritative worklist with per-key proposed text.

### 2c. Secondary copy tables

Plural cleanup (`select.scoutGood/Risk`, `draft.newRoutes/won`, `gauntlet.battleRule/conquered`, `battle.cooldownLeft`, `streak.best`, `circuit.won`), intent/forecast keys (`battle.switchForecast/switchHint/intent/intentHidden/intentSwitchTo/switchRecommended/replacementHint`), Coach keys (`battle.command/commandUsed/commandLine`, `academy.command`), advice keys (`advice.title/ace/affinity/switch/cleanse/barrier/surge/tempo`), academy keys (`academy.affinityHint/mechanics/surge/core.1/2/4/8.desc`), mode keys (`league.subtitle/hidden`, `gauntlet.select`, `trial.subtitle/challenge`, `circuit.subtitle`), team terminology (`loadout.title/hint/slot/clear`, `squad.title/hint`, `trial.squad`, `league.squad`), log/error keys (`battle.log/logHint`, `error.webgl/context`), misc (`draft.kitInsight`, `draft.archetype.burst`, `app.tagline`, `title.rosterLine`, `record.kos`, `move.last_spark_duel`): proposed fr/en text per key is embedded in plan Tasks 18–19.

## 3. Data / engine contract mismatches

| ID | Sev | Finding | Refs | Fix direction |
|---|---|---|---|---|
| D2 | P1 | **Night Terror** passive promises +1 Daze turn but support-move statuses bypass the passive adjustment (`midnight_lullaby` applies remaining=2, not 3). Reproduced deterministically. | `src/battle/engine.js:637-643` (damage path only) vs `:799-802` (support path) | Route all target-status application through one passive-aware helper |
| D3 | P1 | **Falling Rings** copy says "grows with penalties" but engine scales with ALL statuses incl. buffs. | `src/battle/engine.js:491`; `src/i18n.js:2161-2162` | Copy fix (safe): "grandit avec les effets actifs" / "grows with active effects" — no balance change |
| D4 | P1 | **Shell Bastion** `cleanse:1` + `teamCleanse:1` double-cleanses the caster; copy says one each. | `src/data/moves.js:327-339`; `src/battle/engine.js:817-821` | Exclude caster from team pass (matches copy); balance-sim verify |
| D5 | P2 | **Shared Breath** counts the caster as an "ally" healed; triggers with only 1 real ally. | `src/battle/engine.js:794-805`; `src/i18n.js:2130-2132` | Copy fix (safe): "deux membres de l'équipe, elle-même comprise" / "two team members, including itself" |
| D6 | P1 | Save-write failures silently discarded: `persistSave()` returns `false` on quota/security, `ctx.persist()` ignores it. Progress can vanish with zero feedback. | `src/save.js:270-281`; `src/app/context.js:150-156` | Notify once per session on failure via existing `notify()` |
| D7 | P2 | `save.emblems` + `save.cosmetics` are written on victories but never read anywhere — dead reward state implying rewards that don't exist. | `src/save.js:10-12,175-185`; `src/screens/results.js:182-185` | Remove fields + writes; SAVE_VERSION 16 migration |
| D8 | P3 | `save.volume` persisted/consumed as master level but no UI exposes it. | `src/save.js:29-32`; `src/sound.js:220-225` | Remove field; fold into v16 migration |
| D9 | P3 | Save validation allows impossible cross-field counters (wins > battles) and arbitrary emblem strings. | `src/save.js:175-177, 195-217` | Clamp relations in `validateSave` |
| D10 | P3 | Near-duplicate move designs (3 barrier-bypass attacks; 2 identical priority-barrier supports; 2 identical team heal+cleanse; 2 identical Burning attacks) present identical effect sentences — differentiator invisible. | `src/data/moves.js:119-129, 205-215, 277-287, 567-576, 689-699, 715-724, 863-872, 944-954, 1064-1073` | Surface the differentiator (power/affinity/amount) in effect copy; no data change |
| D11 | — | Balance outliers (win-rate 31–64 %; 5 pairs ≥83 %; aubeastre 31 %, mareclat 64 %) | `npm run test:balance` output | **Out of scope for polish** — recorded for a separate balance-owned pass |

## 4. Screens & navigation

| ID | Sev | Finding | Refs | Fix direction |
|---|---|---|---|---|
| S3 | P1 | Results actions (Rematch/Adjust/Title) render below the full analytics stack: 207px extra scroll desktop, **799px mobile**. Breaks the friendly-retry loop. Confirmed by 3 agents + screenshots. | `src/screens/results.js:323-331` | Action row directly after outcome intro + grade; analytics below |
| S4 | P1 | Defeat has no primary retry: all actions are `subtle-btn`. | `src/screens/results.js:326-331`; `src/app/context.js:124-125` | `primary-btn` on Rematch when `!win` |
| S5 | P2 | Trial victory offers no return-to-trials route (title detour required). | `src/screens/results.js:326-327, 375-381` | Add `next-trial` action for `mode==='trial'` |
| S6 | P2 | Defeat analytics tone: "Victory +0" row and "MVP — 0 damage dealt" after a wipe. | `src/screens/gauntlet.js:60-65`; `src/screens/results.js:210-217` | Hide victory row on loss; suppress MVP when all-zero |
| S7 | P1 | Settings always returns to title: every renderer hardcodes `ctx.previousScreen='title'`. | `src/screens/settings.js:6-11`; `src/app/shell.js:53-55` | Record real originating page; back returns there |
| S8 | P2 | No scroll reset on page transitions — next screen can open mid-scroll. | `src/app/shell.js:210-226` | `screen.scrollTo(0,0)` when page actually changes |
| S9 | P2 | Bestiary no-match filter → blank grid, only "0/30". | `src/app/shell.js:126-145` | Localized empty state + clear-filters button |
| S10 | P2 | Move Theater double-open race during `ensureBattleStyles()` await → stacked dialogs. | `src/screens/bestiary.js:90-119` | Request token; remove existing theater before mount |
| S11 | P2 | Same-screen rerenders drop keyboard focus (presets, remix, enemy picks, difficulty, draft picks, gauntlet lead, settings toggles). | `src/screens/team-select.js:352-437`; `draft.js:103-139`; `gauntlet.js:95-105`; `settings.js:13-49` | Shared focus-restore helper keyed by `data-` identity |
| S12 | P1 | Desktop team-select: with 3/3 selected, the confirm CTA sits below ~3400px of content. Mobile: two fixed bars reserve only 86px padding and cover roster; "Battle plan ↑" scrolls to the wrong target. | `src/screens/team-select.js:278-311`; `styles/overrides/selection.css:533-610, 719-727` | Sticky/aside CTA on desktop; correct bottom padding; scroll to `.battle-plan > summary` |
| S13 | P2 | Quick-battle enemy picker buttons 34px wide on mobile (8 forced columns). | `styles/screens/progression.css:77-81`; `styles/components.css:963-982` | Fewer columns / 44px targets at ≤600px |
| S14 | P2 | Mobile bestiary: 1188px of records/feats before search; sticky filter panel eats 341px of a 667px viewport. | `src/screens/bestiary.js:150-151`; `src/app/shell.js:83-127`; `styles/overrides/selection.css:351-403` | Mobile order: tools first, records/feats as disclosures; one-row sticky bar |
| S15 | P3 | Bestiary expanded card stays in one narrow column on desktop; title records icon-only (`♛ 0/6`); emblem strip unlabeled; trials squad strip tiny; league locked-rival wall; draft "Combo routes" empty heading; quick-battle rule text fused. | various (see plan Task 27) | Small per-screen adjustments |
| A1 | P1 | *(prior)* Route transitions never move keyboard focus to the new screen. | `src/app/shell.js:210-226` | Focus `h1`/`#screen` after route render |
| A2 | P1 | *(prior)* Replacement/switch overlay lacks `role="dialog"`/`aria-modal`/label; Escape doesn't restore opener focus. | `src/battle-ui/controller.js:654-672` | Dialog semantics + single close path |
| A3 | P2 | *(prior)* Move-theater close drops focus. | `src/screens/bestiary.js:53-59` | Save/restore trigger focus |
| A4 | P2 | *(prior)* Creature cards expose no `aria-pressed` selected state. | `src/screens/team-select.js:156` | Add state |
| A5 | P2 | *(prior)* Battle-speed button has no accessible name. | `src/battle-ui/controller.js:539-541` | Localized `aria-label` |
| A6 | P2 | *(prior)* HUD plate `aria-label` hides HP/status/team summary. | `src/battle-ui/hud.js:189` | Compose summary into accessible name |
| A7 | P2 | *(prior)* Custom-squad buttons 25px tall. | `styles/screens/selection.css:84-94` | 44px hit area |
| S16 | P3 | Filter rows use `aria-label` on generic divs (no `role="group"`); topbar not a nav landmark; browser Back leaves the app (no history integration — **deferred**, feature-adjacent). | `src/screens/team-select.js:188-197`; `src/app/shell.js:127` | `fieldset/legend` or `role="group"` |

## 5. Visual & theming

| ID | Sev | Finding | Refs | Fix direction |
|---|---|---|---|---|
| V1 | P1 | Settings volume sliders render as floating 24×24 knobs — generic `.toggle-row input` sizes ranges like checkboxes; no track/value. | `styles/components.css:443-452`; `styles/base.css:581-588` | Scope 24px to checkboxes; style track/thumb; value readout (pairs with S-row settings fixes) |
| V2 | P2 | Settings grid stretches an empty translucent help card (`align-items` default). | `styles/components.css:432-441` | `align-items:start` |
| V3 | P2 | Fixed diagonal background pattern shows through near-transparent text panels (settings, bestiary, selection) — muddy, noisy. | `styles/base.css:28-47`; panels `#ffffff07/08` | Opaque scrim on dense utility panels; keep motif in open space |
| V4 | P2 | Locked feat cards nearly invisible (`opacity:.58` + `saturate(.25)`). | `styles/screens/progression.css:715-759` | Full-opacity text, lock icon, stronger border |
| V5 | P2 | High contrast still dims disabled moves (opacity .68 + grayscale .7) and covers only shared cards — route-specific panels (feat-hall, record-hero, league-rival, draft-card, boon/academy) keep alpha gradients. | `styles/screens/accessibility.css:17-28, 91-93` | HC surface contract: opaque bg, 2px border, full-contrast text, non-opacity unavailable marker |
| V6 | P2 | Defeat team sprites `grayscale(.8) brightness(.55)` — identity erased, fights the friendly-defeat tone. | `styles/components.css:525-527` | Lighter treatment retaining affinity color |
| V7 | P2 | *(prior R1–R3)* `?animations=0` doesn't gate FX entry points; reduced-motion keeps infinite idle animation; reduced-motion Three.js bursts still move. | `src/battle-ui/fx.js:39`; `styles/screens/battle-fx.css:2250-2295`; `src/presentation/arena.js:473-505, 563-577` | Short-circuit FX at scale 0; drop `idle` from reduced shorthands; static burst under reduced motion |
| V8 | P2 | *(prior S1)* Saved reduced-motion/high-contrast classes applied only after module eval — flash of default theme. | `index.html:35`; `src/app/context.js:381-383` | Inline pre-render bootstrap reading the save |
| V9 | P3 | Title progress card 220px dead zone between emblems and roster fan. | `styles/base.css:332-390` | Reduce reserved fan height |
| V10 | P3 | Horizontal squad rails clip cards with no scroll cue. | `styles/overrides/selection.css:108-119`; `progression.css:932-946` | Edge fade/chevron |
| V11 | P3 | Token debt: dead `--panel`, no radius tokens (18–26px ad hoc), z-index literals bypass ladder (40/100/80…), duplicate `.team-dot` blocks with `!important`, unscoped `.menu` gap in `academy.css` leaks globally, `theme-color` mismatched, breakpoints scattered (600/700/760/900). | `styles/tokens.css`; `styles/components.css:220-230, 697-723`; `styles/overrides/academy.css:2-4`; `index.html:6` | Cleanup pass (plan Task 28) |
| W1–W3, D1 | P2/P3 | *(prior)* squad-track overflow (`160px 1fr` без `min-width:0`), mobile battle rule ellipsized to 1 line, bestiary feature hall narrow-screen override lives in a battle-only lazy sheet, dead challenger selector. | see code-polish.md | Fold into plan Tasks 25/27/28 |

## 6. Performance (mid-range tablet focus)

| ID | Sev | Finding | Refs | Fix direction |
|---|---|---|---|---|
| F1 | P2 | `refreshBattle()` rebuilds both HUD trees + all move buttons + rebinds listeners around **every** playback event, while locked. | `src/battle-ui/controller.js:476-555`; `playback.js:88, 277` | Skip choice rebuild while `ctx.locked` unless active creature/legal actions changed; delegate listeners |
| F2 | P2 | `syncBattleAnimationSpeed()` runs `getAnimations({subtree:true})` over the whole battle DOM after nearly every event even when speed unchanged. | `src/battle-ui/fx.js:28-35` | Early-return when speed unchanged since last apply |
| F3 | P2 | Every move FX rebuilds 51–89 DOM nodes via `innerHTML` (plus 32/28 for tactical/status). | `src/battle-ui/fx.js:39-107, 198-212, 347-354` | Cache static markup; cap particles on coarse/low-DPR; (full pooling optional) |
| F4 | P2 | `flash()` forces sync layout via `void canvas.offsetWidth` per hit. | `src/presentation/arena.js:500-505` | rAF class toggle / WAAPI restart |
| F5 | P2 | 8 battle-only CSS files (~176KB) preloaded on title. | `index.html:21-31` | Drop preloads; promote on selection entry |
| F6 | P2 | Web Audio: theme buses recreated per theme switch, never disconnected; note/SFX chains (7–10 nodes each) never call `disconnect()` — unbounded graph growth on long sessions. | `src/sound.js:397-465, 555-666, 692-705` | Disconnect chains on source `ended`; release old theme buses after fade |
| F7 | P2 | DPR capped at 2 → 4× pixels on DPR-2 tablets with AA + ACES. | `src/presentation/arena.js:97` | Area-based cap ~1.5 for tablet-size canvases |
| F8 | P3 | *(prior P1)* Roster `<img>`s lack `loading="lazy" decoding="async"` + dimensions. | `src/screens/bestiary.js:148`; `team-select.js:156` | Add attributes |
| F9 | P3 | FX timers survive battle exit holding detached DOM (0.6–1.5s). | `src/battle-ui/fx.js:322-326, 408-493` | Session-scoped timer registry cleared on cancel |
| F10 | — | Full lazy-load/code-split of Three.js + battle modules (L, restructures module graph) — **deferred**: high risk vs. local-file payoff; revisit only if title interactivity measurably lags on target hardware. | `src/main.js`; `src/app/context.js:1-44` | Deferred |

## 7. Deferred / out of scope (explicit)

- Balance retuning (D11) — separate balance-owned effort.
- Browser history/popstate routing (S16 tail) — feature, not polish.
- Visual-plan leftovers that are new content: per-move hand-tuned FX upgrades (4.1 remainder), arena weather one-shots (5.2), sprite style re-render (7.1), tension-scaled sprite auras (4.4 remainder).
- `assets/monsters/*/battle-large.png` (4.4MB, unreferenced): delete in cleanup (kept out of runtime already).
- E2E flaky specs (`gameplay.spec.js:300, 397`) — stabilize only if a plan task touches their surface; both pass on retry.
