# Runtime and repository architecture

## System shape

Arène de Noam is one static page backed by browser-native ES modules. Development runs the sources directly, with no compilation or framework lifecycle; the deployed site is a CI-only production build of the same modules (see [Production build](#production-build-and-offline)). Most modules initialize through import side effects, render HTML strings into `#screen`, and attach event listeners after each render.

The principal data flow is:

```text
index.html
  -> src/main.js imports every registrar
  -> src/app/context.js builds ctx and loads the save/i18n/services
  -> screens register routes into ctx.routes
  -> a screen creates a battle config
  -> battle-ui/controller.js creates engine state
  -> battle/engine.js returns next state + semantic events
  -> battle-ui/playback.js presents events; hud.js renders current state
  -> screens/results.js derives and persists progression from state.history
```

## Bootstrap and shared registry

[`index.html`](../index.html) supplies the DOM shell, CSS order, Three.js import map, the Nunito font preload, and a friendly boot failure fallback. It dynamically imports [`src/main.js`](../src/main.js).

`main.js` imports all screen, battle UI, and input modules for their registration side effects. Only after every import does it install screen-transition wrappers, start global input, and render the title. Once the title is idle it prefetches the arena chunk (`ctx.loadArena()`), then, in the built `dist/` only, registers the service worker.

[`src/app/context.js`](../src/app/context.js) is the composition root:

- Imports data, engine functions, persistence, localization, and sound. It does **not** import Three.js: `ctx.loadArena()` is a memoised `import('../presentation/arena.js')`, and `renderBattle` awaits it beside `ensureBattleStyles()`. Browsers keep a failed module load for the page's lifetime, so a failed load takes the friendly error path with a reload hint (`error.arenaLoad`); `?failWebgl=1` still shows the WebGL error.
- Loads and validates the save, applies a `?lang=fr|en` override, and validates dictionary parity.
- Creates the mutable `ctx` application registry and attaches shared values/helpers with `Object.assign`.
- Exposes `registerRoutes({ name: handler })`, which merges handlers into `ctx.routes`.
- Exposes `route`, a proxy whose properties are stable forwarding functions. `const { renderTitle } = route` is safe before `renderTitle` is registered because lookup occurs when the forwarding function is called.

This registry deliberately avoids direct screen-to-screen imports. When adding a cross-module callable:

1. Define it in its owning module.
2. Include it in that module's final `registerRoutes(...)` call.
3. Consume it through `route` from `context.js`.
4. Ensure `main.js` imports the owning module before any call can occur.

Use a direct import only inside cohesive pure layers such as `src/battle/` and `src/data/`; do not create a second global registry.

## Long-lived application state

The important mutable `ctx` fields are:

| Field | Meaning |
| --- | --- |
| `save` | Validated in-memory save object; write through `ctx.persist()` |
| `selection` | Current pre-battle team/configuration draft |
| `battleSession` | UI session config plus authoritative engine `state`, timeline, and cancellation token |
| `gauntletRun` | Live Expédition run (team, stage, faveurs, camp HP); in memory only, never persisted |
| `draftRun` | Temporary Pioche du jour picks; not persisted |
| `leaveGuard` | The showing page's leave confirmation, set through `ctx.setLeaveGuard` (see navigation) |
| `selectionGuide` | One-shot flag: team select shows its first-time guide after the tutorial |
| `arenaScene` | Current Three.js presenter; dispose before leaving/replacing it |
| `locked` | Prevents input while entrances or event playback are active |
| `routes` | Registered cross-module functions |

Title rendering clears the current battle, the selection and the Pioche picks. An Expédition run outlives it: a run left through the battle pause stays live, and once a stage is cleared the Défis sheet resumes it at the faveur screen. Only starting a new run, finishing it, or confirming its leave guard ends it. Battle sessions carry a monotonically increasing token and `cancelled` flag so delayed animation work cannot mutate a later screen.

## Screen and mode ownership

| Flow | Configuration/data | Screen/controller |
| --- | --- | --- |
| First-run tutorial | Four scripted lessons (super efficace → switch to resist → Signature ✦ → finish) and the rival's script, in `screens/tutorial.js` | Lesson gating, rival plan and prompt-line tip via routes (`tutorialAllows`, `tutorialLesson`, `tutorialTip`, `tutorialEnemyAction`); HUD prompt, battle controller, results |
| Rival League | `data/trainers.js` | `screens/league.js`, `screens/team-select.js` |
| Champion Circuit | `data/circuit.js`, trainer circuit teams | Team select and results |
| Quick Battle | `data/battle-rules.js` | Team select |
| Gauntlet | `data/gauntlet.js` | `screens/gauntlet.js`, team select, results |
| Daily Draft | `data/draft.js` | `screens/draft.js`, results |
| Mythic Trials | `data/trials.js` | `screens/trials.js`, team select, results |
| Bestiary/Move Theater | Creature/move/passive data | `screens/bestiary.js` |
| Academy | Affinities/statuses/i18n copy | `screens/academy.js` |
| Settings | Save preferences | `screens/settings.js` |

`screens/team-select.js` normalizes the selected mode into the config accepted by `route.startBattle(...)`: teams/leads, mode, arena, difficulty, trainer index, and explicit modifiers. Mode effects should enter battle through this config and the engine modifier list, not through hidden UI mutations.

### Navigation and the back gesture

[`src/app/shell.js`](../src/app/shell.js) owns navigation. `bindCommon()` only wires the chrome every screen shares (music, `[data-action="title"]` home, `[data-action="back"]`, settings, mute); screen-specific DOM belongs to the owning screen. Every screen but the hub and battle opens with `ctx.topbar(title, { eyebrow, actions, settings })`: a 48 px chevron back, the page `h1`, the screen's own actions, then mute and settings.

- The Android back gesture, the browser back button and Escape share `route.goBack()`: it closes the Move Theater or the top sheet first; in battle it opens the pause sheet; elsewhere it calls `route.navigateUp()`, which is also behind every `[data-action="back"]` button.
- One level up is the nearest hub the player came through (title, League, Trials, Academy); Settings return to the screen that opened them.
- History holds a single "inside" entry above the boot entry whenever a screen other than the bare title shows, re-armed after each handled back, so back never leaves the app from inside it and forward can never replay a battle. A MutationObserver on `#screen[data-page]` keeps it in sync; screens need no history code.
- A page holding progress one tap could drop sets `ctx.setLeaveGuard({ message, detail, confirm, cancel, onLeave })`. The Expédition sets one on its stage results and faveur screen. While the guard belongs to the showing page, going up (back gesture, Escape, `[data-action="back"]`) or home (`[data-action="title"]`) opens a confirm sheet instead. Confirming clears the guard, runs `onLeave` (the Expédition drops its run), then leaves; showing any other page clears it.

## Battle UI lifecycle

[`src/battle-ui/controller.js`](../src/battle-ui/controller.js) owns the imperative battle lifecycle:

1. `startBattle(config)` creates deterministic engine state and wraps it in `ctx.battleSession`.
2. `renderBattle()` awaits battle-only CSS and the lazy arena chunk, constructs the HUD/stage/controls, creates `ArenaScene` (then `warmUp()`), and binds controls.
3. `hud.js` renders legal buttons, previews, enemy intent, and state plates from the current state.
4. A player action is paired with one cached/planned AI action and passed to `resolveTurn`.
5. The returned state replaces the prior state. `playback.js` serially consumes the returned events while input is locked.
6. Free K.O. replacements are resolved via `applyReplacement`; the enemy is handled first, then the player selector opens if needed.
7. `screens/results.js` reads `state.history`, awards/persists progression, and renders results. Every won Expédition stage shows its results first; its "Étape suivante" call to action calls `advanceGauntlet()` (boon choice), and the final stage books the run win before rendering results. A first League win shows the earned badge (`ctx.badgeArt`, the art shared with the hub strip and the League map) and any side mode it opens. The tutorial also ends on results ("Choisis ton équipe" → team select).

[`src/battle-ui/playback.js`](../src/battle-ui/playback.js) is an event interpreter, not a rules engine. Add or change an engine event whenever presentation needs causal information that cannot safely be reconstructed from final state. Keep event payloads semantic and deterministic.

[`src/battle-ui/director.js`](../src/battle-ui/director.js) (played through `playback.js`) and [`src/presentation/arena.js`](../src/presentation/arena.js) own spectacle, in battle and in the bestiary Move Theater, which plays one move on the same stack ([`battle-presentation.md`](battle-presentation.md) §8.5). Every async effect must tolerate screen/session cancellation. Reduced motion and `?animations=0` must keep flow functional and fast.

## Engine boundary

[`src/battle/`](../src/battle) has no DOM access and uses no global save/UI state.

- `engine.js`: state creation, legality, previews, turn/replacement/command resolution, events.
- `damage.js`: the base damage formula and affinity multiplier application.
- `statuses.js`: status metadata and pure status operations.
- `rng.js`: the only combat randomness primitive. `normalizeSeed` mixes a raw seed once (murmur3 `fmix32`, never 0) before it becomes xorshift32 state, so small seeds do not share their first rolls; `randomFromState` only advances an existing state.
- `ai.js`: scores legal actions against a safe snapshot; only the source RNG cursor is advanced.

Inputs are treated as immutable. Public resolution functions clone before mutation and return a new state. See [`battle-system.md`](battle-system.md) for the exact contracts.

## Persistence and progression

[`src/save.js`](../src/save.js) owns the `arene-de-noam-save` localStorage boundary. Loading follows `parse -> migrate -> validate/sanitize -> merge defaults`. Persistence validates again before writing and returns a boolean instead of throwing. Unsupported future versions and corrupt values fall back to a fresh save with a notice.

For any persisted-shape change:

1. Increment `SAVE_VERSION` by one.
2. Add `migrateV<oldVersion>` that returns the next version.
3. Append it to `SAVE_MIGRATIONS` in exact order.
4. Add the field to defaults and sanitize it in `validateSave`.
5. Keep historical identifiers readable when removing a feature if old saves contain them.
6. Extend migration, round-trip, corrupt, and future-save tests.

Combat state itself is not persisted. [`screens/results.js`](../src/screens/results.js) derives mastery, records, feats, grades, streaks, and mode victories from semantic battle history, then calls `persist()`.

## Localization

[`src/i18n.js`](../src/i18n.js) has two flat dictionaries, `fr` and `en`. Keys must be exactly parallel. `t(key, vars)` falls back to the other language and then renders `⟦key⟧`, but that fallback is resilience rather than permission to omit translations.

Add user-facing text as keys in both dictionaries, including names/effects/lore. Do not hard-code visible French or English in templates unless it is a language-neutral symbol. When changing mechanics, update localized effect copy and tests that assert authored values.

## CSS, Three.js, and assets

CSS order is part of behavior:

```text
tokens.css -> base.css -> components.css -> screen layers -> overrides
```

`index.html` eagerly loads common sheets and lists the battle sheets in a comment manifest (read by tooling and the build). [`src/app/battle-stylesheets.js`](../src/app/battle-stylesheets.js) is the single list of battle sheets in cascade order, each with its eager anchor (the eager sheet that follows it, or `null` for the end). `ctx.ensureBattleStyles()` creates the real stylesheet links on first selection/battle/theater entry and inserts each before its anchor. When adding or moving a battle stylesheet, update the manifest and that list together without changing the effective cascade; the build fails if they disagree.

Three.js is local under `vendor/` and reached through the `three` import-map specifier; only `src/presentation/arena.js` imports it, and only through the lazy `ctx.loadArena()`. Never import `arena.js` statically, or Three.js returns to the title's critical path. `ArenaScene` is presentational and must fail into the controller's friendly WebGL recovery path; `warmUp()` compiles every scene material (hidden FX pools included) during the battle intro so the first hit never stalls on a shader link. Creature runtime sprites live at `assets/monsters/<id>/battle.png`; provenance/processing metadata belongs in `assets/asset-manifest.json`. `art/` and `tools/generate-pixellab.mjs` are development-only and must never become runtime dependencies.

## Production build and offline

[`tools/build.mjs`](../tools/build.mjs) (`npm run build`, run by `.github/workflows/pages.yml` after `npm test`) writes `dist/`, which GitHub Pages deploys:

- **JS:** one minified ESM bundle of `src/main.js` (esbuild, code splitting). The dynamic `arena.js` import makes `arena.js` + Three.js a lazy chunk; `three` resolves to `vendor/three.module.min.js`. Static chunk imports get `<link rel="modulepreload">`.
- **CSS:** eager sheets are bundled in cascade order and split only at battle-sheet anchors, so each lazy battle file still slots into the exact eager cascade; battle sheets sharing an anchor share one lazy file. `url()` assets (fonts) are hashed and the font preload is rewritten to match.
- **Asset map:** the build defines `__ASSET_MAP__` (source stylesheet path → hashed file) for `ensureBattleStyles()`; in development it is undefined and the map is the identity. `__DIST__` marks the bundle so only it registers the service worker.
- **Static files** copied unchanged: `manifest.webmanifest`, `assets/icons/`, `assets/monsters/*/battle.png`, font licences. Runtime code may build URLs only for these.
- **Service worker:** [`sw.js`](../sw.js) is minified into `dist/sw.js` with `__BUILD_ID__` (hash of every dist file) and `__PRECACHE__` (every dist file). It precaches on install (hashed files may come from the HTTP cache, others are revalidated), serves same-origin GET cache-first (every navigation gets the cached `index.html`), and uses `skipWaiting` + `clients.claim`. It keeps the previous build's cache one generation so a page still running that build can lazy-load its battle CSS and arena chunk; older caches are deleted. It is never registered in development or under `navigator.webdriver`, so e2e always hits the network.
