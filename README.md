# Arène de Noam

**Arène de Noam** (*Noam's Arena* in English) is a local, deterministic 3v3 creature-battle game for the browser. It includes 30 creatures, 90 authored moves, six readable classes, six animated arenas, French and English, progression, and mouse, touch, keyboard, and gamepad controls.

There is no account, backend, analytics, build step, runtime generation, or network API dependency. Three.js is vendored locally; Playwright is development-only.

## Play locally

```sh
npm run serve
```

Open **http://127.0.0.1:8178/**. Direct `file://` loading is unsupported because the game uses browser-native ES modules.

The first launch offers a short tutorial. The game starts in French; change the language in Settings or append `?lang=en`.

## The essentials

- Bring three creatures and knock out all three rivals. Barriers protect HP temporarily.
- Switch to improve the matchup. The incoming creature receives the planned enemy action; K.O. replacement is free.
- Types form two independent triangles: **Water → Fire → Grass → Water** and **Psychic → Fighting → Dark → Psychic**. Follow an arrow for `2×`; reverse it for `0.5×`. Same-type and cross-triangle matchups are neutral at `1×`.
- Every creature has exactly three moves. One may be a Signature, and cooldowns make a move wait before returning.
- Priority decides turn order first, then Speed.
- Actions fill the shared Surge gauge. At the required cost, choose a creature's Signature.
- Eight effects shape battle: Focused, Haste, Elusive, Counter, Marked, Rooted, Dazed, and Burning.
- Every creature has one innate talent. Every arena has one visible rule and a pulse every four turns unless a mode says otherwise.

The universal **Coach Boost** can be used once per battle when the active creature has a penalty. It removes all its penalties and grants 15 Surge without spending the move or switch action.

## Combo

A setup move applies **Marked**. A move labeled **Combo** consumes Marked and deals **40% more damage** to every hit in that action. `Venom Harvest` follows the same rule using Burning as its setup.

If another ally applied the setup, a short cut-in credits that helper. The credit adds no damage and no Surge beyond the Combo's single 40% rule.

## Modes

- **Rival League** — twelve authored rivals, arenas, emblems, styles, and Ace phases.
- **Champion Circuit** — post-League battles under six rotating conditions.
- **Quick Battle** — choose teams, lead, difficulty, arena, and one optional rule.
- **Gauntlet** — three battles with persistent wounds, recovery, and boon choices.
- **Daily Draft** — make three picks, choose a lead, and face the daily rival.
- **Mythic Trials** — six authored challenge encounters.
- **Bestiary & Move Theater** — records, talents, lore, mastery progress, class filters, and all 90 move previews.
- **Arena Academy** — the eight essentials, both type triangles, and the eight-effect reference.

Team selection and Draft show type coverage, team roles, and cross-creature Combo routes. Mastery ranks are collection progress only and never change combat stats.

## Controls and accessibility

- Mouse/touch: use the visible battle controls.
- `1`, `2`, `3`: choose a move.
- `C`: open switching.
- `L`: open the Battle Chronicle.
- `M`: mute or unmute.
- `Escape`: close an overlay or leave a non-battle screen.
- Gamepad: D-pad/stick navigation, confirm/back, switch, Codex, and Chronicle shortcuts.

Settings include independent music/effect volume, mute, normal/`×2` speed, reduced motion, high contrast, and French/English. **Tactical details** shows exact damage and absorption, predicted order, full move effects, extra status icons with durations and sources, and deeper battle context. It changes information density only; it never hides a legal action or mechanic.

## Saving

Progress and preferences use the versioned `arene-de-noam-save` localStorage key. Save version **15** validates and migrates older data. It stores mode progress, emblems, cosmetic mastery XP, per-creature records, three `{ team, lead }` squads, feats, grades, streaks, settings, and the last team.

New battles count `records.combos`. Existing `records.assists` and the `team_assist` feat remain readable as legacy history but are no longer awarded. Corrupt or future saves fall back safely with a friendly notice.

## Architecture

- `src/data/moves.js` — the 90 authored move definitions.
- `src/data/classes.js` — the six descriptive class identities and SVG icons.
- `src/data/combos.js` — the shared Combo rule and team route discovery.
- `src/battle/` — deterministic engine, damage, statuses, seeded RNG, previews, and AI.
- `src/battle-ui/` — HUD, controller, event playback, and battle effects.
- `src/screens/` — team selection, Draft, Academy, tutorial, results, and other modes.
- `src/i18n.js`, `src/save.js`, `src/sound.js` — localization, persistence, and synthesized audio.
- `src/presentation/` — responsive Three.js arenas and reactive battle lighting.
- `assets/asset-manifest.json` — provenance and processing record for shipped sprites.

## Verification

```sh
npm test
npm run test:balance
npm run test:e2e
```

The automated suites cover data invariants, engine and preview parity, Combo transactions, Surge accounting, AI legality and immutability, save migration, FR/EN parity, authored animation IDs, complete modes, progression, input methods, responsive layouts, focus handling, and recovery paths.

The balance simulation checks average fight length, turn-cap rate, and the whole-roster `30–70%` win-rate band. Run `node tools/simulate-balance.mjs --naive` for Apprentice, Standard, and Champion against the deterministic naive policy. Set `ARENA_BALANCE_SEED` to reproduce another matrix.

Test-only URL hooks include `seed`, `animations=0`, `player`, `enemy`, `enemyMove` (one move or a comma-separated sequence), `playerHp`, `enemyHp`, `teamHp`, and `failWebgl=1`.

## Static deployment

Publish the repository root as static files. No compilation, server logic, or secret is required. `.nojekyll` is included for GitHub Pages. Never deploy `.dev.vars`; it is ignored and no browser module imports it.
