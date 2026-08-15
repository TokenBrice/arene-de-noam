# Agent documentation

This directory is the implementation map for coding agents. It is intentionally compact and source-oriented.

## Authority and reading order

1. [`AUTONOMOUS_GAME_BUILD_BRIEF.md`](../AUTONOMOUS_GAME_BUILD_BRIEF.md) defines the binding product intent, pillars, scope, and acceptance criteria.
2. [`README.md`](../README.md) describes the currently shipped player-facing rules and commands.
3. [`architecture.md`](architecture.md) explains runtime composition, ownership, and cross-module flow.
4. [`battle-system.md`](battle-system.md) defines the battle state machine, data contracts, and core mechanics.
5. Source and tests are the executable specification. If they disagree with product intent, investigate the discrepancy instead of silently choosing one.

## Sixty-second orientation

- Static browser app: no build, backend, account, analytics, or runtime network calls.
- `index.html` loads `src/main.js` as native ES modules and maps `three` to the vendored copy.
- `src/app/context.js` constructs the shared `ctx` registry. Screens and battle UI register callable routes as import-time side effects.
- `src/battle/` is the deterministic, DOM-free engine. It clones input state and returns `{ state, events }`.
- `src/battle-ui/` owns battle sessions, intent/preview UI, input locking, event playback, effects, and the results handoff.
- `src/data/` contains authored gameplay content and mode configuration. Classes are descriptive; mastery is cosmetic/progression-only.
- `src/save.js` is the strict, versioned localStorage boundary. `src/i18n.js` contains parallel French and English dictionaries.
- `styles/` is an ordered CSS cascade. Battle-only sheets are preloaded by `index.html` and promoted on demand by `ctx.ensureBattleStyles()`.

## Where a change belongs

| Change | Primary files | Required companion work |
| --- | --- | --- |
| Damage, turns, Surge, statuses, switching, legality | `src/battle/engine.js`, `damage.js`, `statuses.js` | Engine tests, preview parity, balance simulation |
| AI choice/scoring | `src/battle/ai.js` | Legality, immutability, seeded-replay tests; balance simulation |
| Creature, move, type, class, passive | `src/data/` | Both locales, presentation contracts, data tests, balance simulation; move CSS when applicable |
| Mode setup or progression | Relevant `src/data/` and `src/screens/` module | Save work if persisted; e2e flow coverage |
| Battle controls/readouts | `src/battle-ui/controller.js`, `hud.js` | Keyboard/touch/gamepad and simple/expert mode checks |
| Event animation/audio | `src/battle-ui/playback.js`, `fx.js`, `src/sound.js`, battle CSS | Reduced-motion and `?animations=0` behavior |
| Screen/navigation UI | `src/screens/`, `src/app/shell.js` | `registerRoutes`, focus/escape behavior, responsive e2e |
| Persisted shape | `src/save.js` | Bump `SAVE_VERSION`, add one migration, validate old/corrupt/future saves |
| User-facing copy | `src/i18n.js` | Add the same key to `fr` and `en`; test `?lang=en` |
| CSS | `styles/` and sometimes `index.html` | Preserve cascade order and battle lazy-load anchor order |
| Sprite/art | `assets/monsters/`, `assets/asset-manifest.json` | Keep runtime local; generation material stays dev-only under `art/`/`tools/` |

## Non-negotiable contracts

- Combat uses seeded RNG only. Never call `Math.random()` from battle logic.
- Engine modules remain side-effect-free and DOM-free. UI consumes semantic events; it does not reproduce combat calculations.
- Forecasts must use the engine preview functions and match live resolution exactly.
- Every player-facing string exists in both languages.
- Save changes are migrated and validated; malformed or future saves recover safely.
- Every creature owns exactly three moves, one unique passive, and exactly one meaningful Signature.
- Type, class, and status palettes/SVG geometry remain distinct as enforced by the presentation contract.
- Every move keeps a unique `visual` id and a `.move-<moveId>` CSS selector.
- Simple and tactical-detail modes expose different density, never different legal actions or mechanics.
- Mouse, touch, keyboard, gamepad, reduced motion, high contrast, and friendly failure screens are product behavior, not optional polish.
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
