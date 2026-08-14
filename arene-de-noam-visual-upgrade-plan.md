# Arène de Noam — Visual Upgrade Plan

> Preparation-only document. No code has been changed.
> Goal: make the game feel more epic and spectacular for a ~10-year-old player, on both mobile and desktop, while respecting the project's existing architecture, performance budget, and accessibility guarantees.

---

## 1. Current state — what already exists

The game is further along visually than a typical indie project. Before listing upgrades, here is the foundation that any work must build on (not replace):

**Battle rendering stack (2.5D composite)**
- Three.js r180 (vendored) renders one of six themed arenas (`src/presentation/arena.js`): crystal, grove, tidal, volcano, astral, eclipse. Spinning dais rings, breathing architecture, 170-particle ambient dust, a pooled 180-particle impact `burst()`, camera `punch()`, and a `setBattleState()` tension system that lerps exposure/lights/camera as the battle heats up.
- Creature fighters are 2D pixel-art `<img>` sprites (128×128, `image-rendering: pixelated`) overlaid on the WebGL canvas (`src/battle-ui/controller.js:158`).
- A DOM/CSS effects layer (`src/battle-ui/fx.js` + `styles/screens/battle-fx.css`, 1434 lines, 39 keyframes) renders every attack: curtain, sky sigil, aura rings, trail, projectile, 24–42 impact particles, damage numbers, hit-stop freeze, camera grammar classes (`camera-strike/rush/heavy/wide/ultimate`), finisher mode, signature clash cut-ins, ace reveals, combo credits.

**Choreography pipeline**
- Engine (`src/battle/engine.js`) is pure logic emitting semantic events; `src/battle-ui/playback.js` (`playEvents`) is the single funnel mapping each event → CSS FX + 3D scene reaction + synthesized SFX. This is exactly the right seam to enrich: one place, already co-triggering visuals/3D/audio.

**Audio** (`src/sound.js`, 100% synthesized Web Audio)
- 11 generative music themes, per-affinity hit synths, creature cries, victory/defeat stingers, adaptive tension bus.

**Guarantees already in place**
- Reduced-motion support (halved particles, no camera punch, CSS kill-switch), ×2 battle speed, `?animations=0` test hook, pixel-ratio cap at 2, rAF pause on hidden tab, WebGL-context-loss fallback, `presentation-contract.test.js` enforcing one `.move-<id>` CSS rule per move, `preview-parity.test.js` enforcing presentation never mutates state.

**Verdict:** the skeleton for spectacle exists. The gaps are (a) several emotionally important moments that are unanimated or broken, (b) 54 of 72 moves sharing one generic grammar, and (c) UI polish/consistency issues.

---

## 2. Hard constraints for all work below

Every item must respect these, or it should not ship:

1. **Presentation purity** — engine stays a pure event emitter; all visuals consume events only (`preview-parity.test.js`).
2. **Presentation contract** — every move keeps a `.move-<id>` rule; new FX go through `fx.js` class toggles (`presentation-contract.test.js`).
3. **Reduced motion** — every new animation needs a reduced-motion variant (existing pattern: `battle-fx.css:830-876`).
4. **Battle speed ×2** — all delays divide by `battleSpeed` (`playback.js:45-71`).
5. **Mobile performance** — pooled particles only, no per-frame allocation, pixel ratio cap stays at 2, 60 FPS desktop / 30+ FPS tablet (brief §10-11). Current FX rebuilds ~60–90 DOM nodes per attack via innerHTML — new FX should not push this much higher; consider pre-built/reused node pools for repeated effects.
6. **E2E layout guarantees** — dock/plates never overlap the stage at 320×568 → 1440×900 (`e2e/battle-layout.spec.js`); no horizontal scroll (`e2e/progression-responsive.spec.js`).
7. **Kid-friendly tone** — spectacular but readable; no gore, no visual noise that obscures what happened mechanically.

---

## 3. Priority 0 — Fix emotionally broken moments (the "blank screen" class of problems)

These are defects, not enhancements. They undercut everything else.

### 3.1 Fainted creature pops back to life
**Problem:** The KO fade plays (`ko` class, 0.55s, `components.css:96-97`), but after the 700 ms presentation delay, `playback.js:235` strips the `ko` class and `clearBattleFx()` resets the fighter's className (`fx.js:397-400`). The creature at 0 HP returns to full-opacity idle float. Worst cases:
- **Player KO:** the dead creature visibly idles behind the `openSwitch()` overlay (`controller.js:682-686`) until the player picks a replacement.
- **Battle-ending KO:** 450 ms before results, the loser stands back up (`results.js:199`).

**Fix:**
- `refreshBattle()` (`controller.js:442-472`) should apply a persistent `fainted` class when the active fighter's `hp <= 0` (distinct from the transient `ko` animation class).
- CSS: persistent fainted pose — grayscale, flattened/toppled (rotate 70–90° or squash), reduced opacity, no idle float. Keep it visible during the switch overlay so the kid sees *why* they must choose.
- Exclude `fainted` from the className reset in `clearBattleFx()` / the strip list in `playback.js:235`.

### 3.2 Faint deserves a moment, not just a fade
**Enhancement on top of 3.1:** on `ko` event, add a short faint cinematic (respecting reduced motion and ×2 speed):
- Brief white shock + desaturation already exists (`ko-shock`, finisher mode) — extend with the creature's cry pitch-dropping (audio hook already exists: `sound.ko()`), a slow topple instead of a plain fade, and a small soul-wisp/particle puff rising from the fainted sprite.
- During the player-replacement window, dim the fainted sprite to ~40% so the switch overlay reads as the focus.

### 3.3 Switch-in / switch-out is an instant sprite pop
**Problem:** `playback.js:212-215` handles `switch`/`replace` with a text line and a UI tick sound only. The new sprite appears via `img.src` swap in `refreshBattle` (`controller.js:448`). Only `relay_fever`/perfect-relay switches get FX.

**Fix:**
- Baseline switch choreography for all switches: outgoing slide-down-and-fade (or recall-beam effect — a vertical light pillar swallowing the sprite), incoming creature enters with its cry (`sound.call` exists per creature), a small spawn burst (reuse the pooled `burst()` in `arena.js:470`), and a 1-bounce landing squash.
- Keep `relayRushFx`/`perfectRelayFx` as upgraded variants layered on the baseline, not as special cases.
- Effort: small (CSS + ~30 lines in `fx.js`/`playback.js`); impact: high — switches happen every battle.

### 3.4 No battle-end cinematic; arena vanishes instantly
**Problem:** after `battle-end`, `finishBattle` waits 450 ms, then `renderResults` disposes the arena and hard-swaps `screen.innerHTML` (`results.js:265-269`, `context.js:173-176`). The 3D scene blinks out of existence.

**Fix:**
- Victory sequence: winning creature plays a victory pose (scale-up bounce + sparkle burst + its cry), loser stays toppled (per 3.1), camera does a slow celebratory dolly (extend `setBattleState` tension lerps in `arena.js:516-521`), then a coordinated exit: arena canvas fades/blurs out over ~400 ms while the results screen fades in — no hard swap.
- Defeat variant: muted palette, slower tempo, defeat stinger already exists (`sound.defeat`).
- Also covers the **turn-cap/draw ending** (`engine.js:764-780`), which currently ends with only a text line — give it the same exit transition with a neutral "time's up" banner.

### 3.5 No screen transitions anywhere else
Every route change is a hard DOM rebuild. Only results/intro have entrance keyframes; nothing exits.
- Add a minimal shared transition: fade/slide-out (~200 ms) + fade-in on route change in `src/app/shell.js:165-195` (`renderCurrent`). One CSS class pair on the screen container; skip entirely under reduced motion and `?animations=0`.
- Selection → battle is the most important transition (build-up to the fight): consider a quick iris/wipe into the existing 1.38 s `battleEntrance` curtain (`controller.js:377-406`) rather than a bare fade.

---

## 4. Priority 1 — Make attacks more spectacular

### 4.1 Give the 54 generic moves real identity
**Problem:** 18 signature moves have bespoke CSS (`battle-fx.css:914-1434`); the other 54 share one projectile/impact grammar differing only by hue. Worse, the identity layer is half-wired: `fx.js:84` adds `attack-${move.affinity}` and `fx.js:57` adds `visual-${move.visual}` classes that **no CSS rule consumes** — dead hooks waiting to be used.

**Fix (cheap, high leverage):**
- Wire the existing dead classes: write per-`visual-*` choreography variants (the data already categorizes moves by visual type). Aim for 6–10 distinct visual archetypes (beam, lob, multi-slash, eruption, vortex, charge, storm, pulse…) instead of one generic projectile. This alone triples perceived variety without touching the contract test (it keys on `.move-<id>`, which stays).
- Remove or repurpose the unused `attack-*` class.
- Then hand-upgrade the ~10 most-used regular moves (by usage frequency from `tools/simulate-balance.mjs`) to near-signature quality.

### 4.2 Escalate spectacle with stakes
The tension system (`arena.js:466`, HUD classes `tension-rising/high`, `last-stand`) exists but FX intensity is flat per move. Scale effects:
- Low-HP attacker or `last-stand`: bigger particle counts, screen-edge vignette pulse, camera grammar upgraded one tier (`strike`→`heavy`).
- Lethal hits already get finisher mode (`fx.js:114-120`) — extend finisher to non-lethal signature hits with a shorter version.
- Keep counts within the pooled budget; on reduced motion keep current behavior.

### 4.3 Fix thin reactions
- **Miss/dodge** (`playback.js:158-162`): currently the attack plays its normal flight path into the dodging target. Add a whiff: projectile sails past / dissipates, dodging sprite does a quick sidestep blur, "Esquivé !" callout pops where the hit would have landed.
- **Barrier break** (`playback.js:152-157`): barrier at 0 gets no shatter. Add a glass-shatter: hex/ring fragments flying outward + a cracking SFX layer on `sound.guard`.
- **Arena pulse** (`fx.js:314-335`): same rune card for both sides and for damaging vs beneficial pulses. Differentiate per side (left/right origin) and per effect (volcano/eclipse damage pulses should look hostile — red/orange, jagged).

### 4.4 Sprite-level punch
Fighter animations are pure CSS transforms on a static 128×128 PNG. Cheap wins without new art:
- **Anticipation + follow-through** on `lunge` (currently a simple translate): windup pull-back 100 ms → fast lunge → overshoot → settle. This single change makes every attack feel 2× stronger.
- **Impact squash** on the defender combined with the existing `recoil`.
- **Dynamic sprite scale with tension**: ace/last-stand creature subtly larger with an aura.
- The 5 unused `battle-large.png` (1254×1254) files (`assets/monsters/{abyssar,calderoc,farfombre,kordane,virelia}/`) could power a **signature-move cut-in portrait** (like the existing ace reveal at `fx.js:277-290`) — big art flash when a signature fires. Very "epic anime" for near-zero cost, though only 5 creatures have the large art; either generate the rest via the existing PixelLab pipeline (`tools/generate-pixellab.mjs`) or skip this item.

---

## 5. Priority 2 — Arena/environment life

- **Arena reacts to battle phase**: dais ring spin speed and particle density already scale with tension; add arena-damage states (cracks/scorch decals as the battle progresses) and a "final showdown" state when both sides are on their last creature (lighting shift + music tension bus already supports it via `calculateTension`, `sound.js:229-241`).
- **Weather-ish ambient one-shots per theme**: volcano ember drift, tidal splash crests, eclipse corona flares — small pooled `THREE.Points` additions in the existing per-theme builders (`arena.js:204-403`).
- **Creature-projected ground shadows/blobs** under fighters to anchor them to the 3D dais (currently DOM sprites float over the canvas with no grounding).

---

## 6. Priority 2 — UI refinement (mobile + desktop)

### 6.1 Design-token consolidation
`styles/tokens.css` is 43 lines; ~900 hardcoded hexes exist across CSS (`progression.css` alone has 199), with near-duplicate off-whites (`#fff0a0/a2/a4`, `#ffe879`…). Consolidate into tokens. This is the enabler for any future theming and makes the 598-line high-contrast override maintainable. Mechanical but wide-ranging — do it as its own pass with visual regression via the existing e2e suite.

### 6.2 Breakpoint normalization
Breakpoints are scattered (600/650/700/760/900/1000/1100px across ~15 files). Pick 2–3 canonical values (e.g. 600 / 900 / 1200) and migrate. Some screens (bestiary 650px, selection 760px) will misbehave at intermediate widths their neighbors handle.

### 6.3 Mobile-specific fixes
- **Sub-44px touch targets**: `overrides/selection.css:326` (34px) and `:400` (29px) chips, draft carousel dots (`draft.js:97`) — bring to the 44px standard the battle UI is tested to.
- **Team-select**: the primary CTA is not visible without scrolling on mobile (`team-select.js:295-301` relies on scrollIntoView). Make the mobile dock (already injected at `:276-281`) carry the validate button persistently.
- **Focus loss on re-render**: team-select re-renders on every pick (`team-select.js:311`), losing keyboard/focus position — restore focus to the just-picked card after render.
- Landscape phone battle layout exists (`battle-layout.css:1167`) — verify visually; consider collapsing the top bar into a single row.

### 6.4 Screen-level polish
- **Title screen** (`src/screens/title.js`): 8 menu buttons is heavy for a kid. Promote "Continue/Play" as a hero CTA, group the 5 battle modes under one "Modes" entry or a 2-tier layout. Fix the hardcoded-French eyebrow flash (`title.js:57-58` — static FR string rendered before `t()` overwrites it). Add subtle animated background (slow particle drift / animated gradient) — first impression of "epic".
- **Results screen**: already has staged reveals (`results-reveal--1..4`) and confetti; with the battle-end cinematic (3.4) it becomes a proper finale. Consider a grade-stamp animation with a satisfying thunk SFX.
- **Contrast**: `.mini-stats` `#8f91ad` at 12px (`base.css:360-365`) and `#72738c` emblems are borderline on translucent panels over the crosshatch background (`base.css:38-48`). Bump muted text one step lighter.
- **Font**: `Inter` is declared (`tokens.css:38`) but never loaded — either self-host it or drop it from the stack. Decide; don't leave the ambiguity.
- **Cleanup**: dead `src/ui/` directory; the 692-line `overrides/selection.css` overriding a 121-line base file — merge to reduce specificity roulette. Lazy-load battle-only CSS (~1434 lines of FX currently load on the title screen).

---

## 7. Asset strategy

- **Sprite style inconsistency** is a known open decision (`docs/superpowers/plans/2026-08-14-noam-game-2-enhancement.md:104`): some sprites are true pixel art, others downscaled painterly art. This must be resolved before heavy sprite-level FX investment — mixed styles become more visible as animation quality rises. Options: re-render the painterly ones via the existing PixelLab pipeline using the Orakyn style anchor (`art/monsters/orakyn/`), or accept a hybrid with a unifying outline/palette pass.
- The 5 unreferenced `battle-large.png` files: either use them (signature cut-ins, 4.4) or remove from the shipped bundle.
- No new art is strictly required for Priorities 0–2 except optionally completing the large-portrait set.

---

## 8. Suggested execution order

| Phase | Items | Why first |
|---|---|---|
| 1 | 3.1 faint persistence, 3.3 switch animation, 3.4 battle-end cinematic, 3.5 basic transitions | Fixes broken/empty moments; every play session hits them |
| 2 | 4.1 wire `visual-*` archetypes + kill dead classes, 4.4 sprite punch (anticipation/squash) | Biggest spectacle-per-effort; covers all 72 moves |
| 3 | 4.2 stakes scaling, 4.3 miss/barrier/arena-pulse fixes, 5 arena life | Depth and polish |
| 4 | 6.3 mobile fixes, 6.4 title/results polish | UX correctness + first impression |
| 5 | 6.1 tokens, 6.2 breakpoints, 6.4 cleanup, 7 sprite-style decision | Structural health; enables future theming |

**Testing notes per phase:** Phase 1 touches `playback.js`/`controller.js` timing — run `test/engine.test.js`, `test/presentation-contract.test.js`, and the full e2e suite (which uses `?animations=0`, so it should be immune to timing changes). Phase 2 is CSS-only + `fx.js` classes — the presentation-contract test is the guard. Any DOM-restructure in battle must recheck `e2e/battle-layout.spec.js` at all five viewports.

**Out of scope (per brief):** rigged 3D characters, frame-by-frame sprite animation sets, runtime asset generation.

---

## Appendix — key file reference

| Area | Files |
|---|---|
| Battle engine (events) | `src/battle/engine.js` |
| FX sequencer | `src/battle-ui/playback.js` |
| FX builders | `src/battle-ui/fx.js`, `styles/screens/battle-fx.css` |
| Battle screen/HUD | `src/battle-ui/controller.js`, `src/battle-ui/hud.js` |
| 3D arena | `src/presentation/arena.js` |
| Sprite animations | `styles/components.css:75-98`, `styles/screens/battle-presentation.css` |
| Results/exit | `src/screens/results.js:199,265-269`, `src/app/context.js:173-176` |
| Screen shell/transitions | `src/app/shell.js:165-195` |
| Audio | `src/sound.js` |
| Tokens/base styles | `styles/tokens.css`, `styles/base.css`, `styles/components.css` |
| Tests guarding presentation | `test/presentation-contract.test.js`, `test/preview-parity.test.js`, `e2e/battle-layout.spec.js`, `e2e/progression-responsive.spec.js` |
| Art pipeline | `tools/generate-pixellab.mjs`, `art/briefs/`, `assets/asset-manifest.json` |
