# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Arène de Noam** — a local, deterministic 3v3 creature-battle browser game for a ~10-year-old child, French-first with full English localization. 30 creatures, 90 moves, 6 classes, 6 arenas. No build step, no backend, no runtime AI/API calls; Three.js is vendored in `vendor/`. `AUTONOMOUS_GAME_BUILD_BRIEF.md` is the binding product brief (pillars, scope, acceptance criteria); `README.md` describes the shipped game rules. Past implementation plans live in `docs/superpowers/plans/`.

Agent implementation documentation starts at `docs/README.md`, with focused runtime architecture and battle/content contracts linked from there.

## Scratch area

Use the repo-root `agents/` folder (gitignored) for all agent working files: plans, test outputs, screenshots, generated artifacts, notes, throwaway scripts. Never commit scratch material or leave it elsewhere in the tree.

## Commands

```sh
npm run serve          # python3 http server on http://127.0.0.1:8178 (file:// unsupported — native ES modules)
npm test               # unit tests: node --test test/*.test.js
node --test test/engine.test.js                      # single test file
node --test --test-name-pattern="<pattern>" test/*.test.js   # single test by name
npm run test:e2e       # Playwright (chromium/swiftshader); starts its own server on port 8179
npx playwright test e2e/smoke.spec.js                # single e2e spec
npm run test:balance   # deterministic balance simulation (tools/simulate-balance.mjs)
npm run format         # prettier over src, test, e2e, tools, styles, index.html
```

There is no build, lint, or type-check step. Verification = unit tests + e2e + (for combat/data changes) balance sim.

## Architecture

Everything loads from `index.html` as browser-native ES modules; `src/main.js` imports each screen/module **for its side effects** — modules self-register at import time.

- **`src/app/context.js`** — the `ctx` object, the app's shared registry (data tables, i18n helpers, sound, sprites, persistence, screen switching). Screens call `registerRoutes()` to expose their render functions; everything cross-module flows through `ctx`, not direct imports between screens.
- **`src/battle/`** — the pure, deterministic battle engine: `engine.js` (createBattle / getLegalActions / previewMove / resolveTurn), `rng.js` (seeded RNG — never `Math.random` in combat), `damage.js`, `statuses.js`, `ai.js`. No DOM access. `resolveTurn` returns an event list.
- **`src/battle-ui/`** — consumes engine events: `controller.js` (command flow), `playback.js` (event → animation sequencing), `hud.js`, `fx.js`.
- **`src/data/`** — all authored content (creatures, moves, affinities, classes, passives, trainers, modes). Balance and content changes happen here, not in the engine.
- **`src/presentation/arena.js`** — Three.js arena rendering.
- **`src/i18n.js`** — every string keyed in both `fr` and `en`, key-parallel. Any user-facing text change touches both languages. Test with `?lang=en`.
- **`src/save.js`** — versioned localStorage save (`SAVE_VERSION`) with a chain of `migrateVN` functions. Any change to persisted shape must bump the version and add a migration; never break existing saves.
- **`styles/`** — layered CSS: `tokens.css` (design tokens) → `base.css`/`components.css` → `screens/` → `overrides/`.

## Invariants the tests enforce

- **Determinism**: same seed → same battle. The engine stays side-effect-free and DOM-free; the balance sim and engine tests depend on this.
- **Presentation contract** (`test/presentation-contract.test.js`): types, classes, and statuses each have unique authored SVG geometry and non-overlapping color palettes. Adding/recoloring content must keep these disjoint.
- **Preview parity** (`test/preview-parity.test.js`): what the UI previews (damage, affinity, order) must match what the engine resolves.

## Product constraints

- The player is a child: pillars are fast battle entry, readable choices before confirmation, friendly defeat (no lost progress), concise spectacle, and full mouse/touch/keyboard/gamepad support. Reduced-motion must stay supported.
- All content is original — no names, wording, or artwork referencing existing monster franchises.
- No runtime network calls or API keys. `tools/generate-pixellab.mjs` (sprite generation) is dev-only and reads its key from env.
