# Agent documentation

This directory is the implementation map for coding agents. It is intentionally compact and source-oriented.

## Authority and reading order

1. [`AUTONOMOUS_GAME_BUILD_BRIEF.md`](../AUTONOMOUS_GAME_BUILD_BRIEF.md) defines the binding product intent, pillars, scope, and acceptance criteria.
2. [`README.md`](../README.md) describes the currently shipped player-facing rules and commands.
3. [`architecture.md`](architecture.md) explains runtime composition, ownership, and cross-module flow.
4. [`battle-system.md`](battle-system.md) defines the battle state machine, data contracts, and core mechanics.
5. Source and tests are the executable specification. If they disagree with product intent, investigate the discrepancy instead of silently choosing one.

## Amendments to the brief

The owner approved these amendments on 2026-09-29, in the "Stade Lumière" upgrade plan (`docs/superpowers/plans/2026-09-29-state-of-the-art-upgrade.md` §5). Where they conflict with [`AUTONOMOUS_GAME_BUILD_BRIEF.md`](../AUTONOMOUS_GAME_BUILD_BRIEF.md), the amendment wins. Every other part of the brief still binds.

| Brief clause | Amendment | Where it lives |
| --- | --- | --- |
| §11 "No production build step" | Development still runs the unbundled ES modules. CI (`.github/workflows/pages.yml`) builds `dist/` with esbuild (`tools/build.mjs`): hashed bundles, lazy screens, one dictionary per language, and an offline service worker (`sw.js`). The phone only ever sees a static web app. | `tools/build.mjs`, `sw.js`, `src/app/screens.js`, [`architecture.md`](architecture.md) |
| §10 "dynamic lighting … shadows" | Lighting is baked into the stadium, with no point lights and no PBR. Each arena ships a painted backdrop plate and court, baked offline, with the procedural painter as the fallback. A frame governor and quality tiers (Low/Mid/High plus the "Graphismes" setting) keep the Mali-class GPU budget. | `src/presentation/arena.js`, `stage/*`, `assets/arenas/`, `src/app/quality.js` |
| §10 "sprites on planes" and procedural effects | Fighters, effects and readouts follow the presentation contract: WebGL fighters with DOM proxies for input and accessibility, a pixel-grid FX atlas painted by a tool, and beat-timed choreography. | [`battle-presentation.md`](battle-presentation.md), `src/data/choreo.js`, `tools/paint-fx-atlas.mjs` |
| §10 "Music … generated in-browser" | The original score (`tools/music/score.js`) is rendered and mastered offline to looping Ogg Opus stems (`tools/bake-music.mjs`), then played from buffers as a base stem plus a tension stem. UI sounds, battle cues and the 30 authored creature cries stay synthesised at runtime. | `assets/music/`, `src/sound.js`, `src/sound-cries.js` |
| §5 "no … critical hits, levels" | Each landed attack has a seeded 1/16 critical hit (×1.5); previews show the non-critical value. The "Niv. 43" shown for Apprentice rivals marks a visible handicap (×0.85 HP and Attack), not a levelling system. Mastery XP stays cosmetic. | `src/battle/damage.js`, `src/battle/engine.js`, `src/data/trainers.js` |
| §7 "Difficulty changes decision quality, not … stats" | Apprentice is deliberately easier: it only picks moves, carries the visible level handicap, and never lands a critical hit on the player. Standard and Champion keep equal stats. | `src/battle/ai.js`, `src/battle/engine.js` |
| §5 rules scope | Added rules: arena weather (one type +20 %, another −20 %, Crystal Dome neutral), a universal Marqué ×1.3 Combo, and coverage moves (off-type moves on some creatures). Each creature still owns exactly three moves. Paralysis and bring-6-pick-3 are out of scope. | `ARENA_WEATHER` in `src/data/affinities.js`, `src/data/combos.js`, `src/data/moves.js`, [`battle-system.md`](battle-system.md) |
| §3 scope (optional features) | Added: Chromatiques (alternate palettes unlocked at mastery rank 5, shown only on the player's own creatures), League badges that unlock Expédition, Épreuves and Pioche du jour at 2, 4 and 6 badges, opt-in haptics, and directional View Transitions. | `src/data/progression.js`, `src/app/haptics.js`, `src/app/shell.js`, save v18 |
| §8 copy | Vocabulary follows [`glossary.md`](glossary.md) (Signature ✦, Pioche du jour, Expédition, Défenseur/Rapide/Soutien/Stratège/Attaquant/Polyvalent), with names familiar to young monster-battler fans. No name, move, ability or item may reuse a franchise term. | `src/i18n/fr.js`, `src/i18n/en.js` |

## Sixty-second orientation

- Static browser app: no backend, account, analytics, or runtime network calls; development runs the sources unbundled (the deployed `dist/` is a CI-only build).
- `index.html` loads `src/main.js` as native ES modules and maps `three` to the vendored copy.
- `src/app/context.js` constructs the shared `ctx` registry. Screens and battle UI register callable routes as import-time side effects; `src/main.js` loads the title, and `src/app/screens.js` is the lazy chunk with every other screen.
- `src/battle/` is the deterministic, DOM-free engine. It clones input state and returns `{ state, events }`.
- `src/battle-ui/` owns battle sessions, intent/preview UI, input locking, event playback, effects, and the results handoff.
- `src/data/` contains authored gameplay content and mode configuration. Classes are descriptive; mastery is cosmetic/progression-only.
- `src/save.js` is the strict, versioned localStorage boundary. `src/i18n/fr.js` and `src/i18n/en.js` are the parallel dictionaries, one module per language; `src/i18n.js` loads the shown one.
- `styles/` is an ordered CSS cascade. Battle-only sheets are preloaded by `index.html` and promoted on demand by `ctx.ensureBattleStyles()`.

## Where a change belongs

| Change | Primary files | Required companion work |
| --- | --- | --- |
| Damage, turns, Surge, statuses, switching, legality | `src/battle/engine.js`, `damage.js`, `statuses.js` | Engine tests, preview parity, balance simulation |
| AI choice/scoring | `src/battle/ai.js` | Legality, immutability, seeded-replay tests; balance simulation |
| Creature, move, type, class, passive | `src/data/` | Both locales, presentation contracts, data tests, balance simulation; a `MOVE_FX` entry in `src/data/choreo.js` for new moves |
| Mode setup or progression | Relevant `src/data/` and `src/screens/` module | Save work if persisted; e2e flow coverage |
| Battle controls/readouts | `src/battle-ui/controller.js`, `hud.js` | Keyboard/touch and simple/expert mode checks |
| Event animation/audio | `src/battle-ui/director.js` (beats → cue timelines on `fx-clock.js`), `src/presentation/{fighters,fx-layer}.js`, `src/data/choreo.js`, `src/battle-ui/banners.js`, `src/sound.js` | `docs/battle-presentation.md`; reduced-motion, ×2, hurry and `?animations=0` behavior |
| Music | `tools/music/score.js` (score, mix) and `render.js` (voices) → `node tools/bake-music.mjs --report agents/<dir>` → `assets/music/*.ogg`; runtime playback in `src/sound.js` (`MUSIC_TRACKS`) | Never hand-edit the `.ogg` files: change the score and re-bake (the tool fails on loudness, peak, seam, memory or a missing motif). A new theme or stem needs its `MUSIC_TRACKS` entry; `node --test test/audio.test.js`; owner listening on the phone |
| Screen/navigation UI | `src/screens/`, `src/app/shell.js`, `src/app/screens.js` (lazy imports) | `registerRoutes`, focus/escape behavior, route transitions (await a transitioned render), responsive e2e |
| Persisted shape | `src/save.js` | Bump `SAVE_VERSION`, add one migration, validate old/corrupt/future saves |
| User-facing copy | `src/i18n/fr.js`, `src/i18n/en.js` | Use the words in [`glossary.md`](glossary.md); add the same key to both files; test `?lang=en` |
| CSS | `styles/` and sometimes `index.html` | Preserve cascade order and battle lazy-load anchor order |
| Sprite/art | `art/monsters/originals/<id>.png` → `tools/normalize-sprites.mjs` → `assets/monsters/<id>/battle.png` + `battle-shiny.png`, `src/data/sprite-metrics.js`, `assets/asset-manifest.json` | Never hand-edit the generated files: change the source or the tool's `SPRITES`/`CHROMATIQUES` tables and re-run it. A sprite that fills more of the canvas than its size class gets a `scale` entry (pixel-crisp, around the feet); anything that moves a face on the canvas also moves that creature's `PORTRAIT_FOCUS` texel in `src/battle-ui/banners.js` (the Signature cut-in crop). A redraw keeps the replaced source under `art/monsters/originals/pre-redraw/` and records it in the manifest entry's `previous` block; `node --test test/sprite-assets.test.js`. Generation material (`art/briefs/`, `art/concepts/`, `tools/generate-pixellab.mjs`) stays dev-only |

## Non-negotiable contracts

- Combat uses seeded RNG only. Never call `Math.random()` from battle logic.
- Engine modules remain side-effect-free and DOM-free. UI consumes semantic events; it does not reproduce combat calculations.
- Forecasts must use the engine preview functions and match live resolution exactly.
- Every player-facing string exists in both languages.
- Save changes are migrated and validated; malformed or future saves recover safely.
- Every creature owns exactly three moves, one unique passive, and exactly one meaningful Signature.
- Type, class, and status palettes/SVG geometry remain distinct as enforced by the presentation contract.
- Every move keeps a unique `visual` id and a `MOVE_FX` choreography entry (`src/data/choreo.js`); battle presentation follows `docs/battle-presentation.md`.
- Simple and tactical-detail modes expose different density, never different legal actions or mechanics.
- Mouse, touch, keyboard, reduced motion, high contrast, and friendly failure screens are product behavior, not optional polish. Gamepad support is intentionally out of scope and must not be added without a new product requirement.
- No runtime secrets, API keys, CDN dependencies, or network generation.

## Working method

1. Inspect the relevant source and its nearest tests before editing. Do not use old implementation plans as current truth.
2. Preserve unrelated worktree changes. Put all temporary scripts, screenshots, traces, notes, and generated test artifacts in the gitignored root `agents/` directory.
3. Make the smallest ownership-correct change. Keep battle calculations in the engine, authored values in data, and presentation in UI/CSS.
4. Run focused tests first, then the suites appropriate to the change.
5. Update these docs only when an architectural boundary, stable contract, or agent workflow changes. Do not turn them into a changelog.

## Verification matrix

| Scope | Minimum verification |
| --- | --- |
| Docs only | Check links/paths and inspect the diff |
| Pure data/helper | Relevant `node --test ...` file, then `npm test` |
| Combat/data/AI | `npm test` and `npm run test:balance` |
| Screen/CSS/input/presentation | `npm test` and the focused Playwright spec; full `npm run test:e2e` before handoff when practical |
| Save/i18n | `node --test test/i18n-save.test.js test/audio.test.js`, then `npm test` |
| Broad or release-like | `npm test && npm run test:balance && npm run test:e2e` |

Commands and test-only URL hooks are listed in the root [`README.md`](../README.md). The Playwright server uses port `8179`; the manual development server uses `8178`.
