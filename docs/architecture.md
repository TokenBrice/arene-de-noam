# Runtime and repository architecture

## System shape

Arène de Noam is one static page backed by browser-native ES modules. There is no compilation or framework lifecycle. Most modules initialize through import side effects, render HTML strings into `#screen`, and attach event listeners after each render.

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

[`index.html`](../index.html) supplies the DOM shell, CSS order, Three.js import map, and a friendly boot failure fallback. It dynamically imports [`src/main.js`](../src/main.js).

`main.js` imports all screen, battle UI, and input modules for their registration side effects. Only after every import does it install screen-transition wrappers, start global input, and render the title.

[`src/app/context.js`](../src/app/context.js) is the composition root:

- Imports data, engine functions, persistence, localization, sound, and arena rendering.
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
| `gauntletRun`, `draftRun` | Temporary mode state; not persisted mid-run |
| `arenaScene` | Current Three.js presenter; dispose before leaving/replacing it |
| `locked` | Prevents input while entrances or event playback are active |
| `routes` | Registered cross-module functions |

Title rendering clears transient runs and the current battle. Battle sessions carry a monotonically increasing token and `cancelled` flag so delayed animation work cannot mutate a later screen.

## Screen and mode ownership

| Flow | Configuration/data | Screen/controller |
| --- | --- | --- |
| First-run tutorial | Fixed tutorial actions | `screens/tutorial.js`, battle controller, results |
| Rival League | `data/trainers.js` | `screens/league.js`, `screens/team-select.js` |
| Champion Circuit | `data/circuit.js`, trainer circuit teams | Team select and results |
| Quick Battle | `data/battle-rules.js` | Team select |
| Gauntlet | `data/gauntlet.js` | `screens/gauntlet.js`, team select, results |
| Daily Draft | `data/draft.js` | `screens/draft.js`, results |
| Mythic Trials | `data/trials.js` | `screens/trials.js`, team select, results |
| Bestiary/Move Theater | Creature/move/passive data | `screens/bestiary.js` |
| Academy | Affinities/statuses/i18n copy | `screens/academy.js` |
| Settings | Save preferences | `screens/settings.js`, shared shell augmentation |

`screens/team-select.js` normalizes the selected mode into the config accepted by `route.startBattle(...)`: teams/leads, mode, arena, difficulty, trainer index, and explicit modifiers. Mode effects should enter battle through this config and the engine modifier list, not through hidden UI mutations.

## Battle UI lifecycle

[`src/battle-ui/controller.js`](../src/battle-ui/controller.js) owns the imperative battle lifecycle:

1. `startBattle(config)` creates deterministic engine state and wraps it in `ctx.battleSession`.
2. `renderBattle()` loads battle-only CSS, constructs the HUD/stage/controls, creates `ArenaScene`, and binds controls.
3. `hud.js` renders legal buttons, previews, enemy intent, and state plates from the current state.
4. A player action is paired with one cached/planned AI action and passed to `resolveTurn`.
5. The returned state replaces the prior state. `playback.js` serially consumes the returned events while input is locked.
6. Free K.O. replacements are resolved via `applyReplacement`; the enemy is handled first, then the player selector opens if needed.
7. `screens/results.js` reads `state.history`, awards/persists progression, and renders results or advances a multi-stage mode.

[`src/battle-ui/playback.js`](../src/battle-ui/playback.js) is an event interpreter, not a rules engine. Add or change an engine event whenever presentation needs causal information that cannot safely be reconstructed from final state. Keep event payloads semantic and deterministic.

[`src/battle-ui/fx.js`](../src/battle-ui/fx.js) and [`src/presentation/arena.js`](../src/presentation/arena.js) own spectacle. Every async effect must tolerate screen/session cancellation. Reduced motion and `?animations=0` must keep flow functional and fast.

## Engine boundary

[`src/battle/`](../src/battle) has no DOM access and uses no global save/UI state.

- `engine.js`: state creation, legality, previews, turn/replacement/command resolution, events.
- `damage.js`: the base damage formula and affinity multiplier application.
- `statuses.js`: status metadata and pure status operations.
- `rng.js`: the only combat randomness primitive.
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

`index.html` eagerly loads common sheets. Battle sheets are declared as `preload` in intended cascade order, while `context.js` creates real stylesheet links on first battle/theater entry and inserts each before a known eager anchor. When adding or moving a battle stylesheet, update both lists without changing the effective cascade.

Three.js is local under `vendor/`. `ArenaScene` is presentational and must fail into the controller's friendly WebGL recovery path. Creature runtime sprites live at `assets/monsters/<id>/battle.png`; provenance/processing metadata belongs in `assets/asset-manifest.json`. `art/` and `tools/generate-pixellab.mjs` are development-only and must never become runtime dependencies.
