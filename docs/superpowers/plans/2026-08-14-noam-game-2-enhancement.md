# Arène de Noam — Comprehensive Enhancement Plan

> **For agentic workers:** This is a roadmap-level plan. Each phase below should be expanded into a full task-by-task implementation plan (superpowers:writing-plans) before execution, then executed with superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Take a mechanically deep, feature-complete game from "impressive prototype" to "polished product": non-intrusive battle UI, real music and layered sound, correct engine behavior, and a maintainable codebase.

**Date:** 2026-08-14
**Inputs:** Hands-on play-through with screenshot matrix (desktop 1440×900 + mobile 390×844), three independent code reviews (UI/UX, audio, gameplay/engine), `npm test` baseline (65/65 pass), balance simulation (39–65% band, passing).

---

## Executive assessment

The game underneath is genuinely good: a deterministic engine with 24 creatures and 72 authored moves, six modes, full FR/EN localization, save migration, and a test suite that actually passes. The menu, draft, and dialog screens show the intended aesthetic works — the switch dialog ("Qui prend sa place ?") is close to shippable quality already.

Three things hold it back:

1. **The battle screen — the heart of the game — is architecturally broken.** HUD cards, sprites, and move cards are positioned with independent absolute coordinates that know nothing about each other. On desktop the plates overlap both sprites; on mobile (390px) the battle is barely usable: the enemy plate fully covers the enemy sprite, the player plate collides with three crushed move columns of 8px text. This is not a tweak-the-offsets problem; the layout needs re-architecting into exclusive zones.
2. **Audio is debug-beep tier.** Bare oscillators wired straight to `destination` — no busses, no compression, no reverb, no envelopes, and zero background music anywhere in the game. Defeat is literally silent.
3. **The engine has real bugs and the code style blocks fixing them safely.** Damage previews disagree with actual multi-hit resolution, lifesteal can resurrect dead creatures, exiting a battle races async playback, and `main.js` packs 148KB into 638 lines (max line ~2,800 chars).

Recommended order: **format the code first (Phase 0), then fix the battle UI (Phase 1) and audio (Phase 2) — the user-facing wins — then correctness (Phase 3), polish (Phase 4), art (Phase 5), and balance (Phase 6).**

---

## Phase 0 — Make the code editable (prerequisite, ~½ day)

Editing 2,800-character lines is how regressions happen. This phase changes zero behavior and is fully verified by the existing suite.

- Add Prettier (dev-only, no build step for the game itself) + a `npm run format` script; format `src/`, `test/`, `e2e/`, `tools/`.
- Add ESLint with a minimal config (no-undef, no-unused-vars, eqeqeq).
- Split `styles/game.css` (144KB) and `styles/scout.css` into layered sheets, still plain CSS loaded from `index.html` (no build): `tokens.css`, `base.css`, `components.css`, `screens/*.css` (title, selection, bestiary, draft, battle-layout, battle-controls, battle-fx), `accessibility.css`. `scout.css` today is a patch-layer over `game.css` and redefines the same selectors (`.hud-card`, `.creature-grid`, `.arena-nameplate`…) — merge those into single definitions.
- Split `src/main.js` mechanically (no logic changes yet): app shell/routing, per-screen render modules, battle controller, battle presentation/FX, input (keyboard/gamepad). ES modules already; imports stay relative.
- **Verify:** `npm test` (65 pass), `npm run test:e2e` (49 scenarios), `npm run test:balance` — all must match the current baseline exactly.

## Phase 1 — Battle screen re-architecture (P0, the marquee fix, ~2–3 days)

Root cause (confirmed by inspection and review): `.battlefield` is `absolute; inset:64px 3% 200px` at `z-index:2`; `.hud-card` plates are separately absolute at `z-index:4` on the same side as their sprite with dynamic height (talent, bonds, statuses, intent all expand it); move cards are a 132–155px-tall dock. Nothing reserves space for anything else, and battle animations scale `.battlefield` up to 1.12×, so even "tuned" offsets would still collide.

### 1a. Three exclusive zones
Make `.battle-screen` a real grid: `auto / minmax(0,1fr) / auto` (info bar / stage / command dock). The Three.js canvas stays full-bleed behind; all interactive UI lives in the rows. Contract: **no descendant of the UI layer may overlap the stage row**. Introduce `--battle-top-h`, `--battle-controls-h`, `--z-stage/hud/controls/modal/toast` tokens. Camera-shake/zoom animations move to an inner `.battle-stage-camera` wrapper with `overflow:clip` so scale never escapes the stage.

### 1b. Compact status plates
Replace the floating `.hud-card`s with two docked plates (target 54–68px tall, desktop: under the top bar left/right; mobile: two slim stacked bands):
- Line 1: name, affinity glyph, numeric HP, three team dots.
- Line 2: HP bar + micro Éclat bar.
- Right edge: max 3 status icons then `+N`.
- The whole plate is a button → expands an overlay with talent, bonds, full status durations, and enemy intent detail.
- Enemy intent becomes a single truncated line under the enemy plate ("⚔ Frappe cristalline · 24–31"), never inflating plate height.

### 1c. Slim command dock
Move buttons drop from 132–155px to 76–92px: name on one line, damage/role figure dominant, at most two badges (recharge, Éclat cost). The full description, order preview, and synergy tags move to a shared context strip that appears on hover/focus/long-press. `À toi de jouer` (action line) becomes a log line docked to the top edge of the command dock — today it floats over and covers move-card titles. Mobile: 3 equal move buttons + compact switch button, no permanent descriptions, ≥44px touch targets.

### 1d. Keep the cosmic aesthetic, lower the volume
Persistent chrome gets lower opacity/shadow; saturated gradients, glows, and big type are reserved for rare events (Signature, Ace, KO, Final Duel). This is the difference between "arena with instruments" and "dashboard with a game behind it".

### 1e. Regression protection
Playwright bounding-box assertions: plates ∩ stage = ∅, dock ∩ stage = ∅, at 320×568, 375×667, 390×844, 768×1024, 1024×768, 1440×900, with long French strings, 3+ simultaneous statuses, barrier + Flow + intent + contract all active.

## Phase 2 — Music & sound overhaul (P0, ~2–3 days, all runtime-synthesized, no asset files)

### 2a. Mixer graph (foundation)
`master → compressor → destination`; `musicLevel → musicDuck → master`; `tensionLevel → musicDuck`; `sfxBus → master`; synthesized-impulse convolution reverb as a send (`reverbIn → convolver → reverbReturn → master`). All voices route through busses — today every oscillator multiplies `settings.volume` at creation and connects straight to `destination`, which is why volume changes don't affect playing sounds and dense moments clip. Bus gains update live via `setTargetAtTime`.

### 2b. Generative background music
Look-ahead scheduler (25ms interval, 100ms horizon — the standard Web Audio pattern; never bare `setTimeout` notes). Themes: title, selection/league, draft, bestiary/academy, one per arena (crystal, grove, tidal, volcano, astral, eclipse — same framework, different scale/root/timbre/tempo), victory/defeat motifs. A tension layer gains up from battle state (min HP ratio, turn count, signature ready, Final Duel) and music ducks under Signatures, Ace reveals, KO finishers. Theme transitions must be idempotent (stop old scheduler, fade voices) so screens never stack music.

### 2c. SFX redesign
Reusable patch model per sound: body + transient + noise texture + reverb send, with attack/release envelopes and filter sweeps (concrete `impactPatch` sketch exists in the audio review). Distinct identities for statuses, barriers, switches, misses; fix semantic wrongs: **defeat is currently silent** and **rally plays the victory fanfare**. Add missing coverage: battle-start sting, turn-start cue, low-HP tension cue, menu transitions, feat/contract unlocks.

### 2d. Settings & save
Add `musicVolume` (default 0.45) and `sfxVolume` (0.8) to the save (bump to v13 with an explicit migration step, see Phase 3), two real sliders in Settings (the current single volume control renders like a toggle), keep `volume` as master. `M` continues to mute all.

### 2e. Audio lifecycle bugs (from review, all confirmed in `src/sound.js`)
- `unlock()` never retries if `resume()` failed after ctx creation; `enabled()` ignores `ctx.state`.
- No `visibilitychange`/focus recovery (iOS suspends the context).
- Scheduled enemy-call audio still fires after leaving battle (`battleEntrance` unconditional timeout).
- Battle speed ×2 doesn't scale SFX durations → overlap harshness (compressor in 2a mitigates; also shorten patches at ×2).

## Phase 3 — Engine & lifecycle correctness (P1, ~2 days)

Confirmed bugs, each needs a failing test first:

1. **Preview ≠ resolution for multi-hit moves** (`engine.js` `previewMove`): multiplies one hit by hit-count and applies barrier once; real resolution applies barriers/reactive passives (Last Bastion, Nine Lives) per hit. Fix by extracting one authoritative resolution transaction used by actual turns, previews, AI forecasts, and exchange forecasts; property-test parity across multi-hit, barrier, Nine Lives, recoil, thorns, drain.
2. **Lifesteal resurrection** (`engine.js` `healCreature`): drain heals a creature already at 0 HP from thorns/counter before KO detection. Gate healing on `hp > 0` (or process KO before drain).
3. **Battle exit races async playback** (`main.js`): exit doesn't respect `locked`; `playEvents()` dereferences `battleSession` after `await`. Introduce a battle-session token / `AbortController`; every async step re-checks it. Also covers stale FX bleeding into the next screen.
4. **Champion AI `scoreSwitch` checks the wrong combatant** (`ai.js`): `primed` reads statuses from the active creature, not the switch candidate.
5. **`persistSave()` lies** (`save.js`): optional chaining returns `true` with no storage. Return actual success; surface a toast when persistence is unavailable.
6. **Settings "Back" dead-ends after battle** (`main.js`): `data-action="selection"` isn't bound in `bindCommon()`.
7. **Save migration is not versioned** (`save.js`): v2–v11 are all spread into the latest schema. Replace with explicit `migrateV1…migrateV12` chain + strict version validation (null/negative/string versions currently pass). Needed anyway for v13 (audio settings).
8. **i18n missing keys render `⟦key⟧`** with no cross-language fallback — fall back to the other locale before the bracket marker.

## Phase 4 — Global UI polish & accessibility (P1, ~2 days)

- **Typography floor:** the codebase is full of 5–10px fixed sizes (bestiary filters 7px, stats 6px, recommendations 5px). Establish `--text-xs…xl` with a 12px floor for metadata, 14px functional, 16px actions; mobile must stop being a shrunken desktop.
- **Team select:** split the dashboard into two phases — pick 3 + leader first, then a "Plan de combat" drawer (doctrine, arena, contract, compass/analysis). Reserve bottom padding equal to `.mobile-selection-dock` height so it can't cover content.
- **Bestiary:** compact card grid → per-creature detail panel; real `<button>`s for move previews; filter buttons to ≥44px.
- **Draft:** one offer at a time on mobile (swipe/tabs); fix the "Apport au trio" insight showing the identical placeholder sentence on all three cards of pick 1 — either say something specific per creature or hide the block.
- **Dialogs & a11y:** remove `maximum-scale=1` from the viewport meta; drop `aria-live` from `#game` (whole-screen swaps get announced) and keep one polite region for action lines; give the switch overlay `role="dialog"`/`aria-modal`/label; replace browser `confirm()` (quit, erase save) with the in-game dialog; add `aria-pressed` to filter/language toggles.
- **Menu & league:** trim the career strip to 2–3 meaningful metrics with a "Tous les records" expander; League cards currently have a large dead zone right of the squad — balance emblem/squad/CTA into the space; settle the serif/sans pairing (serif rival names are a nice flourish — commit to it as a display face with consistent usage, or drop it).

## Phase 5 — Art & presentation consistency (P2, ~1–2 days + generation time)

- **Sprite fidelity is inconsistent in the same battle:** all creatures ship 128×128 `battle.png`, but some sources are genuine pixel art (Orakyn — chunky at 5× scale) and others are downscaled painterly art (Virelia — reads smooth). Five creatures have unused 1254×1254 `battle-large.png` (abyssar, calderoc, farfombre, kordane, virelia) that the game never references. Decide the direction: **(a)** commit to crisp pixel art — regenerate outliers in the anchor style (`asset-manifest.json` names Orakyn as style anchor) — or **(b)** go high-res for battle (generate `battle-large` for all 24 via the existing `tools/generate-pixellab.mjs` pipeline, keep 128px for thumbnails). Either way, stop mixing.
- Victory/defeat screens deserve a moment: results currently appear as another card stack; add a short sequence (creature spotlight, grade reveal, music motif from Phase 2).
- Arena renderer touches: pause rendering when `document.hidden`; use `ResizeObserver` on the canvas instead of window `resize` only; time-scale the `float` animation (currently frame-dependent additive drift).

## Phase 6 — Balance & design tuning (P2, ongoing)

- **Turn-cap attrition:** wins at the 40-turn cap resolve by conscious count then HP ratio, so defensive cycling can beat decisive play under Champion AI. Consider escalating pressure (e.g. mounting arena damage or Éclat inflation after turn ~30) so stalling has a cost.
- **Champion AI reply model** ignores barriers, statuses, evasion, guard — baitable by defensive stances. Reuse the Phase-3 unified resolution transaction for its forecasts.
- **AI tie-breaking** discards the RNG state returned by `randomIndex()` → tied decisions repeat predictably.
- **Smart Remix** adds up to 38 random points per team — larger than the synergy/matchup terms it's supposed to weigh. Shrink to a small dither (≤5).
- **"Stunned" naming:** it reduces speed/damage but never skips a turn (a good design rule) — rename/re-ice the status so it doesn't promise hard control.
- Extend `tools/simulate-balance.mjs` with a pairwise matchup matrix and per-team (not just per-creature) stats; keep the 2,400-battle band check.

---

## Verification strategy

Every phase ends green on: `npm test`, `npm run test:e2e`, `npm run test:balance`. New coverage added along the way: preview/resolution parity property tests (Phase 3), battle-layout bounding-box matrix (Phase 1), audio lifecycle smoke (unlock → theme → duck → mute) (Phase 2), navigation/teardown tests (Phase 3). Manual pass on a real phone for Phase 1 and 2 — the mobile battle is where the game currently fails hardest.

## Suggested sequencing & effort

| Phase | What | Effort | Priority |
|---|---|---|---|
| 0 | Format, lint, split CSS/JS | ~½ day | Prerequisite |
| 1 | Battle screen re-architecture | 2–3 days | P0 |
| 2 | Music & sound overhaul | 2–3 days | P0 |
| 3 | Engine & lifecycle correctness | ~2 days | P1 |
| 4 | Global UI polish & a11y | ~2 days | P1 |
| 5 | Art consistency & presentation | 1–2 days | P2 |
| 6 | Balance & design tuning | ongoing | P2 |

Phases 1 and 2 are independent after Phase 0 and can run in parallel (disjoint files). Phase 3's unified resolution transaction should land before Phase 6's AI work builds on it.
