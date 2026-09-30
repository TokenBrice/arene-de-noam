# Arène de Noam

**Arène de Noam** (_Noam's Arena_ in English) is a local, deterministic 3v3 creature-battle game for the browser. It includes 30 creatures, 90 authored moves, six readable classes, six animated arenas, French and English, progression, and mouse, touch, and keyboard controls.

There is no account, backend, analytics, runtime generation, or network API dependency, and development needs no build step. Three.js is vendored locally; Playwright and esbuild are development-only.

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
- Actions fill the shared **Signature ✦** gauge. At the required cost, choose a creature's Signature.
- Eight effects shape battle: Focused, Haste, Dodge, Ricochet, Marked, Rooted, Dazed, and Burning.
- Every creature has one innate talent. Every arena has a continuous weather: one type's attacks deal `+20%` and another's `−20%` for both teams (the Crystal Dome is neutral). Previews include it.
- Each landed attack has a seeded `1/16` chance to be a **critical hit** (`×1.5`). Previews always show the non-critical value.
- Apprentice rivals are a lower level (`×0.85` HP and Attack), only ever pick moves, and never land a critical hit on you.

The universal **Coach Boost** can be used once per battle when the active creature has a penalty. It removes all its penalties and grants 15 ✦ without spending the move or switch action.

## Combo

Any attack that lands on a **Marked** creature consumes Marked and deals **30% more damage** to every hit in that action. Venom Harvest also grows `+20%` per Burning stack on the target, without consuming it.

If another ally applied Marked, a short cut-in credits that helper. The credit adds no damage and no ✦ beyond the Combo's single 30% rule.

## Modes

The title is the mode hub. **Play** opens the tutorial on first launch, then starts the next League battle (the Champion Circuit once the League is won) straight away with the last team; **My team** opens team selection first. The League map's rival card works the same way: **Fight!** (or **Replay this duel**) starts with the last team, **Change team** opens team selection first. **Challenges** groups Expedition, Mythic Trials and Daily Pick, which open at 2, 4 and 6 League badges (a mode already played stays open). A newly opened mode is marked **New** on the Challenges tile and on its row until it is first played; this is read from the save (no Expedition won or under way, no trial cleared, no Daily Pick won), not stored.

- **Rival League** — twelve authored rivals, arenas, badges, styles, and Ace phases. A first win earns the rival's badge; **Next rival** starts the next duel straight away with the same team.
- **Champion Circuit** — post-League battles under six rotating conditions.
- **Free Battle** — choose teams, lead, difficulty, arena, and one optional rule.
- **Expedition** — three battles with persistent wounds, recovery, and boon choices. Leaving between stages asks first; a run left from the battle pause resumes from Challenges.
- **Daily Pick** — make three picks, choose a lead, and face the daily rival.
- **Mythic Trials** — six authored challenge encounters.
- **Bestiary & Move Theater** — records, talents, lore, mastery progress, class filters, and all 90 move previews.
- **Arena School** — the eight essentials, both type triangles, and the eight-effect reference.

Team selection and the Daily Pick show type coverage and team classes (Defender, Speedster, Support, Tactician, Attacker, All-Rounder). Mastery ranks are collection progress only and never change combat stats. Player-facing words follow [`docs/glossary.md`](docs/glossary.md).

## Controls and accessibility

- Mouse/touch: use the visible battle controls.
- `1`, `2`, `3`: choose a move.
- `C`: open switching.
- `L`: open the Battle Chronicle.
- `M`: mute or unmute.
- `Escape`: close an overlay or leave a non-battle screen.

Settings include independent music/effect volume, mute, normal/`×2` speed, reduced motion, high contrast, and French/English. **Tactical details** shows exact damage and absorption, predicted order, full move effects, extra status icons with durations and sources, and deeper battle context. It changes information density only; it never hides a legal action or mechanic.

## Saving

Progress and preferences use the versioned `arene-de-noam-save` localStorage key. Save version **18** validates and migrates older data. It stores mode progress, emblems, cosmetic mastery XP, per-creature records, three `{ team, lead }` squads, feats, grades, streaks, settings (including graphics quality and the opt-in light vibrations), which unlocked creatures show their Chromatique, and the last team.

New battles count `records.combos`. Existing `records.assists` and the `team_assist` feat remain readable as legacy history but are no longer awarded. Corrupt or future saves fall back safely with a friendly notice.

## Architecture

- `src/data/moves.js` — the 90 authored move definitions.
- `src/data/classes.js` — the six descriptive class identities and SVG icons.
- `src/data/combos.js` — the shared Combo rule and team route discovery.
- `src/battle/` — deterministic engine, damage, statuses, seeded RNG, previews, and AI.
- `src/battle-ui/` — HUD, controller, event playback, and battle effects.
- `src/screens/` — team selection, Draft, Academy, tutorial, results, and other modes.
- `src/i18n/fr.js`, `src/i18n/en.js`, `src/i18n.js`, `src/save.js` — localization (one dictionary module per language, loaded on demand by the `src/i18n.js` core) and persistence.
- `src/sound.js`, `src/sound-cries.js` — audio: synthesized UI/battle cues and the 30 authored creature cries, and playback of the baked music (a base stem per screen, plus a tension stem per arena that follows the battle).
- `src/presentation/` — the Three.js stadium (painted plates, baked light, quality tiers), WebGL fighters, and the pixel-grid effects layer.
- `assets/asset-manifest.json` — provenance and processing record for shipped sprites.
- `assets/arenas/` — the six painted arena plates and courts (WebP, baked offline by `tools/generate-arena-plates.mjs`), with their provenance in `assets/arenas/manifest.json`.
- `assets/music/` — the original score as looping Ogg Opus files, one per screen family and arena (plus the arenas' tension stems). Its source is `tools/music/score.js`, rendered, mastered (−16 LUFS, ≤ −1 dBTP) and checked by the dev-only `node tools/bake-music.mjs`; one five-note motif runs through the title, the arenas and the victory.

## Verification

```sh
npm test
npm run test:balance
npm run test:e2e
```

The automated suites cover data invariants, engine and preview parity, Combo transactions, Surge accounting, AI legality and immutability, save migration, FR/EN parity, authored animation IDs, complete modes, progression, input methods, responsive layouts, focus handling, and recovery paths.

The balance simulation rotates every arena and checks average fight length, turn-cap rate, the `6.25% ± 1` critical-hit rate, the whole-roster `30–70%` win-rate band, and a paired weather check (the same matchups in every arena; no type may shift more than 8 points from the neutral Crystal Dome). Run `node tools/simulate-balance.mjs --naive` for Apprentice, Standard, and Champion against the deterministic naive policy. Set `ARENA_BALANCE_SEED` to reproduce another matrix.

Test-only URL hooks include `seed`, `animations=0`, `player`, `enemy`, `enemyMove` (one move or a comma-separated sequence), `playerHp`, `enemyHp`, `teamHp`, and `failWebgl=1`.

## Static deployment

GitHub Pages serves a production build made in CI. On every push to `main`, `.github/workflows/pages.yml` runs `npm ci`, `npm test` and `npm run build`, then deploys `dist/`. No server logic or secret is required.

```sh
npm run build     # writes dist/: minified, content-hashed bundles + offline service worker
npm run preview   # builds, then serves dist/ on http://127.0.0.1:8177/
```

The title never waits for Three.js: the arena chunk loads in the background once the title is idle. The service worker makes repeat visits instant and the game playable offline; development never registers it. Never deploy `.dev.vars`; it is ignored and no browser module imports it.
