# Arène de Noam

**Arène de Noam** (*Noam's Arena* in English) is a complete, self-contained browser RPG about deterministic three-versus-three creature battles. It ships with 24 original creatures, 72 creature-specific techniques, six animated arenas, full French/English localization, progression, and desktop/mobile/gamepad support.

There is no account, backend, analytics, runtime generation, build step, or network API dependency. Three.js is vendored locally; Playwright is development-only.

## Play locally

```sh
npm run serve
```

Open **http://127.0.0.1:8178/**. Direct `file://` loading is unsupported because the game uses browser-native ES modules.

The first launch offers a short interactive tutorial. The game starts in French; switch language in Settings or append `?lang=en`.

## Modes

- **Rival League** — twelve authored trainers with distinct teams, styles, arenas, emblems, and Ace phases.
- **Champion Circuit** — post-League endless ascension against all twelve rivals under six rotating high-stakes conditions.
- **Quick Battle** — configure both teams, arena, AI difficulty, and one of six battle rules.
- **Gauntlet** — three escalating battles with persistent wounds, recovery between rounds, and stacking boon choices.
- **Daily Draft** — a deterministic daily three-round draft with composition insights, rival reveal, and lead scouting.
- **Mythic Trials** — six rule-bending encounters with a full team-preparation and scouting phase.
- **Bestiary & Move Theater** — searchable/filterable creature records, talents, lore, mastery, every move description, and replayable choreography for all 72 techniques.
- **Tactical Academy** — the affinity cycle, major systems, and complete status glossary.

## Combat identity

Every creature owns exactly three authored moves and exactly one Signature. No two moves share the same mechanical fingerprint or visual choreography. Kits cover priority rushes, multi-hit chains, executes, speed scaling, barriers, healing, team healing, drains, recoil, purges, cleanses, counters, evasion, control, damage-over-time, setup/finish combos, and status detonations. Seven Signatures are defensive or restorative team-saving ultimates rather than renamed attacks.

Each creature also has a unique innate talent, and authored move interactions create cross-creature assist routes. The Team Compass scores Pressure, Control, Sustain, and Tempo, then recommends an opening lead. Smart Remix searches legal squads for affinity coverage, roles, assist routes, and matchup value. Team composition itself never adds hidden battle bonuses.

Affinity follows one cycle: **Mind → Force → Tide → Flame → Grove → Shadow → Mind**. Attacks into the next affinity deal `1.5×`; attacks into the previous affinity deal `0.75×`. Names and icons always accompany color.

Other combat systems include:

- shared Éclat (Surge) and one Signature per creature; ordinary offensive moves grant 20, support moves grant 25, and direct HP lost grants 25% rounded;
- one universal once-per-battle **Coach Boost**: when the active creature has a penalty, it cleanses every penalty and grants 15 Éclat without consuming the action;
- exact damage, barrier, order, and Apprentice exchange forecasts;
- tactical switching, entry talents, Perfect Relay reads, and free K.O. replacement;
- visible arena powers;
- trainer styles, hidden Champion intent, threat-aware Signature defense, and reactive switching;
- three-factor performance grades (victory, turns, survivors), feats, cosmetic mastery progression, career records, streaks, and a Battle Chronicle;
- Final Duel, rally, Ace, assist, clash, detonation, and finisher states.

Named, visible moments can add Éclat beyond the flat rule: a voluntary switch grants 10, Relay Fever grants 24, an Assist or Encore grants 8, a Perfect Relay grants 6, and the Astral pulse grants 15 when it refreshes Focus. Explicit Trial, Gauntlet, and Ace effects remain visible exceptions as well.

The pure engine is deterministic for a given seed. Control effects alter stats and options but never remove the player's entire turn. A 40-turn cap resolves by conscious fighters, then remaining HP ratio, then seeded tie-breaking.

## Presentation

Each of the 72 moves has its own CSS choreography layered over a semantic event pipeline. Signatures use creature cut-ins, field sigils, hit-stop, camera direction, custom particles, synthesized audio, and arena-scale aftershocks. Signature clashes, Coach Boost, Perfect Relays, Relay Rush, assists, detonations, rival Aces, K.O. finishers, rallies, and the Final Duel have dedicated sequences.

Six Three.js arenas have unique geometry, animated architecture, lights, particles, arena powers, and pooled impact bursts. Lighting, camera depth, particle motion, and vignette intensity react to late-battle tension and imminent arena pulses.

## Controls and accessibility

- Mouse/touch: all actions have visible controls and mobile layouts.
- Coach button: becomes available once per battle when the active creature has a penalty; it cleanses every penalty, grants 15 Éclat, and leaves the move/switch action available.
- `1`, `2`, `3`: choose a move.
- `C`: open switching.
- `L`: open the Battle Log.
- `M`: mute/unmute.
- `Escape`: close overlays or return from non-battle screens.
- Gamepad: D-pad/stick navigation, confirm/back, switch, Codex, and Battle Log shortcuts.

Settings include volume, mute, normal/`×2` battle speed, reduced motion, high contrast, and French/English. Dialogs trap focus, important state has text/icon redundancy, and WebGL/context failure paths remain usable.

## Saving

Progress and preferences use the versioned `arene-de-noam-save` localStorage key. Save version **15** strictly validates and migrates older data. It includes League/Circuit/Trial/Gauntlet/Draft progress, emblems, mastery, per-creature records, three `{ team, lead }` custom squads, feats, grades, streaks, settings, and the last team. Historical `contractsCompleted` and `contract_hero` values remain readable as frozen legacy progress; doctrines are removed from v14 custom squads. Corrupt or future saves fall back safely with a friendly notice.

## Architecture

- `src/battle/` — pure deterministic engine, damage, statuses, seeded RNG, and AI.
- `src/data/` — affinities, roster, moves, passives, rivals, modes, progression, composition, and encounter data.
- `src/presentation/` — responsive Three.js arena renderer and reactive battle lighting.
- `src/main.js` — localized screens, progression flows, semantic animation queue, and input binding.
- `src/i18n.js`, `src/save.js`, `src/sound.js` — localization, persistence, and synthesized Web Audio.
- `assets/asset-manifest.json` — provenance and processing record for shipped sprites.

## Verification

```sh
npm test
npm run test:balance
npm run test:e2e
```

The automated suites check data uniqueness, exact engine behavior, flat Éclat accounting, Coach eligibility, AI legality and immutability, Champion threat responses, composition tools, save migration, localization parity, every authored animation ID, complete battles, all six arenas, all modes, progression, touch/keyboard/gamepad controls, responsive layouts, modal focus, failure recovery, and runtime leaks.

The balance simulation runs seeded whole-roster battles, checks average fight length and turn-cap rate, and rejects creature win rates outside the `30–70%` band. Run `node tools/simulate-balance.mjs --naive` to audit Apprentice, Standard, and Champion against the deterministic naive policy. Set `ARENA_BALANCE_SEED` to reproduce another matrix.

Test-only URL hooks include `seed`, `animations=0`, `player`, `enemy`, `enemyMove` (one move or a comma-separated sequence), `playerHp`, `enemyHp`, `teamHp`, `finalDuel=1`, and `failWebgl=1`.

## Static deployment

Publish the repository root as static files. No compilation, server logic, or secret is required. `.nojekyll` is included for GitHub Pages. Never deploy `.dev.vars`; it is ignored and no browser module imports it.
