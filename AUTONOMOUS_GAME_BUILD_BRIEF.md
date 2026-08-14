# Autonomous Game Build Brief — *Arène de Noam*

Status: binding product and engineering brief  
Project root: `/Users/ahirice/Documents/claude-bordel/noam-game-2`  
Audience: one child, approximately 10 years old, playing mainly in French on desktop or tablet  
Deployment: publicly reachable static website, noncommercial, using entirely original creatures and assets  

## 1. Mission

Build and finish a polished, self-contained browser game focused exclusively on dramatic three-versus-three creature battles. The experience should evoke the excitement, tactical readability, and spectacle of a monster arena without copying any existing franchise's names, characters, silhouettes, interface, music, sounds, logos, wording, or artwork.

This is not a prototype assignment. The deliverable is a complete small game that a child can open, understand, replay, and enjoy without adult assistance. Do not stop at scaffolding, a vertical slice, placeholder content, or a plan.

Working French title: **Arène de Noam**  
Working English title: **Noam's Arena**

## 2. Product pillars

Every implementation decision should reinforce these priorities, in order:

1. **Battles start quickly.** From the title screen, a returning player should reach team selection in one action and combat in at most three.
2. **Choices are understandable.** The interface previews affinity advantage, move power, status effects, cooldowns, and turn-order implications before confirmation.
3. **Creatures feel powerful and individual.** Silhouette, pose, sound, move effects, and battle role must distinguish every creature.
4. **Defeat is friendly.** No lost progress, punishment, consumable resources, grinding, or long restart path.
5. **Spectacle is concise.** Strong camera, particles, motion, and sound should make attacks satisfying without making each turn slow.
6. **The game works equally well with mouse, keyboard, and touch.**

## 3. Fixed scope

The finished version contains:

- Six original playable creatures.
- Three creatures per team, with one active creature at a time.
- Three moves per creature, for eighteen authored moves total.
- A short interactive tutorial.
- Quick Battle mode.
- A six-match Arena Ladder ending in a champion battle.
- Three AI difficulty settings: Apprentice, Challenger, and Champion.
- A Bestiary screen showing every creature, affinity, role, stats, and moves.
- French-first UI with complete English localization selected by `?lang=en` or settings.
- Local progress saving, audio settings, reduced-motion support, and responsive touch controls.
- Original pixel-art creature sprites, procedural battle effects, synthesized sound, and at least three arena themes.
- A static deployment package with no application server and no runtime API key.

Explicitly out of scope:

- An overworld, exploration, catching, collecting duplicates, evolution, breeding, equipment, inventory, shops, currencies, grinding, quests, or dialogue trees.
- Online multiplayer, accounts, chat, leaderboards, backend services, analytics, advertising, or monetization.
- Licensed creatures or references to an existing monster franchise in the shipped game.
- Runtime AI generation or runtime calls to PixelLab.
- Fully rigged 3D characters or large frame-by-frame animation sets.

Optional features may be added only after every required acceptance criterion passes. Good optional candidates are local pass-and-play, a battle replay, or an additional cosmetic arena. Do not let them delay the required game.

## 4. Core player flow

### First visit

1. Title screen defaults to French and offers `Jouer`, `Combat rapide`, `Bestiaire`, and settings.
2. `Jouer` starts a concise guided two-versus-two tutorial: the player uses Orakyn and Abyssar against Kordane and Calderoc. The matchup intentionally demonstrates Mind over Force, Tide over Flame, guarding, and switching.
3. The tutorial teaches choosing a move, affinity advantage, health, defensive moves, and switching. Explanations appear only when relevant and never exceed two short sentences at once.
4. Completing or skipping the tutorial opens team selection for the first ladder match.

### Returning visit

1. Title screen shows ladder progress and a prominent `Continuer` action.
2. The previous team and difficulty are preselected but editable.
3. The player can resume the next match or start a Quick Battle.

### Match flow

1. Show opponent, arena theme, and both teams.
2. Player selects three creatures and their lead creature.
3. Each turn, choose one of three moves or switch.
4. Resolve both sides' choices, play a short event sequence, and return control promptly.
5. When a creature is knocked out, its owner chooses a free replacement.
6. Defeating all three opposing creatures wins the match.
7. Results show decisive moments, ladder progress, and actions for the next fight, rematch, or title screen.

Target match duration is 5–8 minutes. A tutorial fight should take under 3 minutes.

## 5. Exact battle contract

The battle engine is a pure deterministic state machine. Rendering and animation consume engine events but never decide rules.

### Creature statistics

Each creature has integer values for:

- `maxHp`
- `attack`
- `guard`
- `speed`
- one affinity
- exactly three moves

There are no levels, experience points, held items, hidden stats, individual values, accuracy, evasion, critical hits, or random damage rolls.

### Affinities

The six affinities form one readable cycle:

```text
Mind → Force → Tide → Flame → Grove → Shadow → Mind
```

- An attack against the next affinity in the cycle deals `1.5×` damage.
- An attack against the previous affinity in the cycle deals `0.75×` damage.
- All other pairings deal `1×` damage.
- Neutral moves always deal `1×` damage.
- A creature using a damaging move matching its own affinity receives a modest `1.15×` same-affinity bonus.
- Affinity icons, names, and colors must all be visible; color alone must never carry the meaning.

### Damage

Use this initial deterministic formula and tune only the constant or authored stats if playtesting demonstrates a pacing problem:

```text
damage = max(1, round(
  move.power
  × attacker.attack / defender.guard
  × 0.55
  × affinityMultiplier
  × sameAffinityMultiplier
  × statusMultipliers
))
```

The UI may show an approximate damage band before selection, but the engine result is deterministic. Typical neutral attacks should remove roughly 20–30% of an evenly matched creature's health.

### Turn resolution

1. Capture the player action.
2. Ask the AI for an action using only the visible battle state; the AI must not inspect the player's chosen action.
3. Validate both actions against the same start-of-turn state.
4. Resolve switches before moves. If both sides switch, both switches resolve.
5. Resolve moves by explicit move priority, then effective speed, then seeded tie-break.
6. If the first move knocks out the second actor, the second move is skipped.
7. Emit ordered semantic events such as `switch`, `move-start`, `damage`, `status`, `ko`, and `battle-end`.
8. Tick temporary durations and cooldowns once at the end of the turn. Effects and cooldowns created during the current turn do not tick until the end of the following turn, so a one-turn cooldown is unavailable for exactly the next action-selection phase.
9. A replacement after knockout is free and occurs before the next action-selection phase.

Switching brings the incoming creature into the attack aimed at that slot. This makes switching useful but not risk-free.

### Move and status rules

- Each creature has one dependable damaging move, one stronger or disruptive move, and one tactical move.
- Reliable attacks should start at 32–36 power, disruptive attacks at 18–24, one-turn-cooldown attacks at 46–52, and two-turn-cooldown attacks at 55–60. Tune within or slightly beyond these bands only when deterministic simulations justify it.
- Basic moves have no cooldown.
- Strong signature or healing moves may have a one- or two-turn cooldown.
- A move on cooldown is visibly disabled with the remaining turn count.
- Moves never miss.
- Do not implement hard stun, sleep, confusion, or other effects that remove a child's turn without a choice.

Allowed initial statuses:

- `focused`: next damaging move deals `1.30×`, then consumed.
- `guarded`: next incoming damaging move deals `0.60×`, then consumed.
- `exposed`: next incoming damaging move deals `1.25×`, then consumed.
- `slowed`: speed becomes `0.70×` for two turns.
- `weakened`: next damaging move deals `0.75×`, then consumed.

Status stacking is prohibited. Reapplying the same duration-based status refreshes its duration. Clearly show status icons beside health.

## 6. Canonical roster

Names are working canon and may receive minor spelling improvements only if localization or pronunciation demands it. Roles, silhouettes, and affinities are fixed.

| Creature | Affinity | Role | Initial stats `HP/ATK/GRD/SPD` | Visual identity |
|---|---|---|---|---|
| **Orakyn** | Mind | Controller | `90/95/75/85` | Floating owl-mantis oracle; crescent head, hovering crystal, four broad ribbon-arms, indigo/cyan palette |
| **Kordane** | Force | Duelist | `100/105/85/100` | Compact horned mountain-goat martial creature with resonating crystal bracers; never canine |
| **Farfombre** | Shadow | Trickster | `85/90/70/110` | Mischievous living lantern-squid whose detached shadow mimics attacks; avoid round purple ghost silhouettes |
| **Abyssar** | Tide | Tank | `125/75/120/55` | Regal armored deep-sea reptile with layered shell plates and a flowing fin-cape; never a penguin or trident wielder |
| **Calderoc** | Flame | Artillery | `95/120/70/75` | Volcanic armadillo-salamander with glowing shell vents and heavy grounded stance |
| **Virelia** | Grove | Support | `105/75/90/85` | Orchid-glider creature with leaf sails, luminous seed pods, and an elegant non-humanoid silhouette |

Author eighteen localized moves following the role contract. Use concise original names and make every tooltip state power, affinity, effect, priority, and cooldown. The following mechanical loadouts are binding even if final move names change:

- Orakyn: reliable Mind damage; lighter Mind damage plus `slowed`; priority self `guarded`.
- Kordane: reliable Force damage; high-power Force damage with one-turn cooldown and self `exposed`; self `focused`.
- Farfombre: reliable Shadow damage; light Shadow damage plus `weakened`; priority self `guarded` and cleanse one negative status.
- Abyssar: reliable Tide damage; light Tide damage plus `slowed`; priority self `guarded` with two-turn cooldown.
- Calderoc: reliable Flame damage; very high Flame damage with two-turn cooldown and self `exposed`; self `focused`.
- Virelia: reliable Grove damage; heal itself for approximately 22% max HP with two-turn cooldown; self `guarded` plus cleanse one negative status.

Balance requirements:

- Every creature must have at least one favorable and one unfavorable matchup.
- No legal team of three should have a deterministic forced win against every other team.
- Strong moves must create a visible tradeoff through cooldown, priority, or self-exposure.
- Healing must not permit infinite stalemates; add a battle-level turn cap of 40. At the cap, the side with more conscious creatures wins, then greater total HP percentage, then seeded tie-break.

## 7. Modes, progression, and AI

### Arena Ladder

Create six authored opponents with increasing tactical identity and these fixed rosters:

1. Fundamentals — Kordane, Calderoc, Virelia: straightforward attacks and an obvious affinity lesson.
2. Speed — Farfombre, Kordane, Orakyn: fast creatures and priority defense.
3. Endurance — Abyssar, Virelia, Orakyn: guarding and healing.
4. Pressure — Calderoc, Kordane, Abyssar: punish passive play.
5. Deception — Farfombre, Orakyn, Virelia: debuffs and switching.
6. Champion — Abyssar, Calderoc, Farfombre: strongest AI and deliberate coverage.

All six player creatures are available from the beginning; progression unlocks arena emblems, alternate arena color themes, and Bestiary lore—not combat power. A loss keeps all progress and offers an immediate rematch.

### Quick Battle

- Player chooses any three creatures.
- Opponent team can be selected or randomized from legal distinct creatures.
- Arena and difficulty are selectable.
- A seed may be supplied through a test-only URL parameter for reproducibility.

### AI

AI must always return legal actions and complete quickly on the main thread.

- **Apprentice:** recognizes obvious strong/weak affinity but switches rarely and does not plan cooldowns deeply.
- **Challenger:** scores expected damage, knockout chance, statuses, healing, cooldowns, and one sensible switch.
- **Champion:** performs shallow lookahead over likely responses and avoids repeating exploitable patterns.

Difficulty changes decision quality, not hidden stats or damage multipliers. Tie-breaking uses the battle's seeded random source. Apprentice is the default difficulty on first launch.

## 8. UX and presentation

### Screens

- Boot/friendly-failure screen.
- Title and progress screen.
- Team selection with large creature cards and matchup summary.
- Battle arena HUD.
- Forced replacement selector after knockout.
- Results and ladder map.
- Bestiary.
- Settings/help overlay.

### Battle HUD

- Opponent occupies the upper/right arena position and player the lower/left.
- Health bars display current and maximum HP and animate without lying about engine state.
- Three large move buttons remain usable on touch screens.
- Switching opens a compact two-card selector.
- Before confirmation, show affinity label (`Efficace`, `Résisté`, or neutral), power, effects, and cooldown.
- During resolution, prevent duplicate input and play semantic events in order.
- Normal turn presentation should take about 1.5–2.5 seconds. Provide a persistent `×2` speed option and honor reduced-motion preferences.
- Avoid walls of battle-log text. Use one short action sentence plus strong visual feedback.

### Responsive behavior

- Primary composition is landscape but the game must remain operable in portrait.
- Validate at minimum: `1440×900`, `1024×768`, and `390×844`.
- Touch targets are at least 44 CSS pixels.
- Do not depend on hover, right click, or keyboard-only interaction.
- Keyboard shortcuts may supplement visible controls: arrows/tab navigation, Enter/Space confirm, Escape back, `M` mute, and number keys for moves.

### Accessibility and resilience

- Semantic buttons and visible focus treatment.
- Color-independent affinity and status indicators.
- Reduced-motion mode removes camera shake and large translations while retaining readable state changes.
- Mute control and persisted volume setting.
- Pause or safely resume when the tab is hidden.
- Friendly French error messages for WebGL failure, lost context, corrupt save, and unavailable audio.

## 9. Art direction and PixelLab contract

### Canonical style

The approved Orakyn sprite is the visual source of truth:

- Sprite: `art/monsters/orakyn/orakyn-battle.png`
- Selection record: `art/monsters/orakyn/selection.json`
- Native format: transparent `128×128` RGBA PNG.
- Crisp authored-looking pixel clusters, selective dark outline, limited creature-specific palette, strong eyes/focal point, full-body three-quarter battle pose, readable silhouette, generous transparent padding.

Create one canonical right-facing battle sprite per creature and mirror it at render time for the opposing side. Do not generate separate front/back sprites unless mirroring demonstrably fails. Derive UI portraits from the canonical sprite or a consistent crop; do not spend generations on portraits unless the crop is unusable.

Animate sprites primarily in code: idle hover/breathe, anticipation, lunge, recoil, hit flash, squash/stretch, knockout dissolve, shadow, particles, and short camera movement. Generated frame animation is optional polish after the full game is playable.

### Originality rules

- PixelLab prompts must describe only the original design and Orakyn style reference.
- Do not name, upload, or request resemblance to an existing franchise creature.
- Reject outputs with recognizable borrowed silhouettes, props, markings, or anatomy.
- Do not use external sprites, ripped models, franchise fonts, logos, music, cries, icons, or interface elements.
- Keep an asset manifest recording prompt, seed, model/endpoint, generation usage, selected source, and final filename.

### Credential handling

- PixelLab credentials exist in `.dev.vars` as `PIXELLAB_API_TOKEN` and related authorization data.
- Never print, commit, expose to the browser, include in screenshots, or store in generated metadata.
- Programmatic generation occurs only through PixelLab's official API and local development scripts.
- Final browser code contains no PixelLab client and makes no PixelLab requests.

### Generation budget

At framing time the subscription shows **1,955 of 2,000 generation units remaining**, resetting September 9. Existing Orakyn work accounts for 40 units in project metadata; the dashboard includes 45 total units used.

- Soft target for all remaining shippable art: no more than 400 additional units.
- Hard autonomous ceiling: 900 additional units.
- Do not consume the final 1,000 available units without new explicit permission.
- Standard creature workflow: one four-concept batch, one four-refinement batch, then select autonomously.
- A third batch is allowed only for a concrete defect: loss of originality, unreadable silhouette, failed transparency, or severe style mismatch.
- Never generate variants merely to chase subjective perfection.
- Record usage after every request and stop calling the API once all required shippable sprites exist.

## 10. Arena, effects, and audio

Use Three.js for a lightweight 2.5D arena: sprites on planes, simple original geometry, dynamic lighting, layered backgrounds, shadows, particles, and controlled camera motion. Create at least three code-driven themes:

1. Crystal Dome — cool geometric arena and Mind/Force atmosphere.
2. Tidal Vault — deep blue light shafts and Tide/Grove atmosphere.
3. Eclipse Crown — dark championship arena with warm rim light.

Effects are procedural and affinity-specific. Reuse pooled particles and materials. Avoid expensive full-screen effects on mobile.

Use Web Audio synthesis for UI, hits, affinity effects, victory, and six short original creature calls. Music, if included, must be original and generated in-browser or authored from simple synthesis—never copied. Audio must never block boot or gameplay.

## 11. Technical contract

Follow the proven architecture of the sibling `../noam-game` while keeping this game's rules independent of presentation:

- Static `index.html`, CSS, and browser-native ES modules.
- No production build step and no runtime package dependencies.
- Vendor a known-compatible Three.js ES module locally.
- Node's built-in test runner for pure modules.
- Playwright as a development-only dependency for browser tests.
- Serve locally through a simple HTTP server; direct `file://` support is not required.
- Deployable to GitHub Pages or any static host.

Recommended organization:

```text
index.html
styles/
  game.css
src/
  main.js
  battle/
    engine.js
    damage.js
    actions.js
    statuses.js
    ai.js
    rng.js
  data/
    affinities.js
    creatures.js
    moves.js
    trainers.js
  presentation/
    arena.js
    sprites.js
    animations.js
    particles.js
    camera.js
  ui/
    screens.js
    battle-hud.js
    team-select.js
    bestiary.js
    settings.js
  i18n.js
  save.js
  sound.js
assets/
  monsters/
  ui/
vendor/
test/
e2e/
tools/
```

Exact filenames may change when a clearer boundary exists, but maintain these separations:

- Battle state and transitions do not import DOM or Three.js.
- Creature, move, trainer, affinity, and localization content is data-driven.
- AI receives a safe snapshot and cannot mutate battle state.
- Presentation consumes emitted events and cannot change outcomes.
- Save parsing validates all external/localStorage data and falls back safely.

### Determinism and test hooks

- Implement a small seeded PRNG and store its state in battle state.
- Production randomness and AI tie-breaking use only that PRNG.
- Provide nonvisual test hooks or URL parameters for seed, animation speed, and deterministic teams.
- Test hooks must not expose credentials or alter normal gameplay unless explicitly enabled.

### Persistence

Use versioned localStorage containing only:

- tutorial completion
- ladder victories/emblems
- unlocked cosmetics
- last selected team
- difficulty
- language
- sound/volume
- reduced-motion and battle-speed settings

Validate types, ranges, and creature IDs. Include migration infrastructure from version 1. Corrupt or future saves must produce a fresh safe save and a friendly notice, never a blank screen.

### Performance

- Target 60 FPS on a contemporary desktop and stable 30+ FPS on an ordinary tablet.
- Cap renderer pixel ratio at 2.
- Pool transient particles and dispose replaced Three.js resources.
- Avoid per-frame DOM reconstruction and unbounded allocations.
- Resize and orientation changes must preserve the battle.

## 12. Verification contract

### Unit tests

At minimum cover:

- Every affinity pairing and multiplier.
- Damage determinism, guard, focus, exposure, and minimum damage.
- Legal/illegal moves, cooldowns, cooldown ticking, and status refresh/consumption.
- Speed, priority, switch ordering, seeded ties, knockout, free replacement, and battle end.
- Turn-cap tiebreak rules.
- AI always returns a legal action and does not read the chosen player action.
- All six creatures reference exactly three existing moves.
- Trainer teams are legal and distinct.
- French and English localization keys remain complete.
- Save round-trip, corruption handling, defaults, and migration.

### Browser tests

At minimum cover:

- Boot in French with no console errors.
- `?lang=en` produces complete English primary UI.
- Complete the tutorial using visible controls.
- Select a legal team and finish a deterministic full battle.
- Knockout replacement flow.
- Touch selection at tablet viewport.
- Keyboard move selection.
- Mute, battle speed, and reduced-motion settings.
- Reload persistence and corrupt-save recovery.
- WebGL/context failure presents friendly UI rather than a blank page.
- No request is made to PixelLab or any other private API at runtime.

Run unit tests and browser tests before declaring completion. Flaky timing-based tests are defects; use engine events and test-mode animation controls.

### Manual visual review

Inspect actual rendered pages at the three required viewport sizes. Verify sprite alpha, pixel scaling, contrast, clipping, health-bar truthfulness, touch reachability, animation pacing, and both languages. Fix visual defects rather than merely reporting them.

## 13. Autonomous execution plan

Work through these phases in order and continue automatically after each gate passes:

1. **Foundation:** scaffold the static app, vendor Three.js, establish CSS, package scripts, test runner, i18n, and friendly boot failure.
2. **Rules vertical slice:** implement and fully unit-test affinities, moves, statuses, turn resolution, AI legality, and one Orakyn-centered battle using temporary code-native silhouettes only where final art is not yet available.
3. **Playable UX:** title, team selection, complete battle HUD, replacement, results, touch/keyboard input, event animation queue, sound toggles, and responsive layouts.
4. **Roster production:** generate, review, select, and integrate the remaining five sprites using Orakyn as the style anchor and the PixelLab budget rules. Remove every temporary creature placeholder.
5. **Content:** author eighteen moves, six ladder opponents, tutorial, Bestiary, three arena themes, progression, settings, and complete French/English copy.
6. **Polish:** procedural signature effects, creature calls, camera pacing, reduced motion, `×2` battle speed, saves, migrations, and friendly failures.
7. **Hardening:** complete unit and Playwright coverage, perform manual viewport review, fix console errors, memory/resource leaks, input races, and rotation/resizing issues.
8. **Release:** write a user-focused README, document controls and local serving, add a static-host deployment configuration, ensure secret files and generated rejects are excluded appropriately, and deliver a clean release candidate.

Each phase gate requires its relevant tests to pass. Do not defer known defects to the end when they can invalidate later work.

## 14. Autonomy rules

The implementing agent is explicitly authorized to make ordinary product, balance, copy, animation, code-organization, and art-selection decisions necessary to finish this brief without asking the user.

The agent must:

- Make reasonable choices and proceed when several options satisfy this contract.
- Select PixelLab variants using originality, silhouette, style consistency, animation feasibility, and child appeal; do not ask the user to rank routine batches.
- Tune numerical stats and move power through deterministic simulations and playtests.
- Prefer the smaller robust implementation when two approaches provide the same player value.
- Preserve user files and secrets and avoid unrelated workspace changes.
- Keep the game runnable throughout development.
- Replace all temporary placeholders before completion.
- Record material deviations from this brief in the README with a concrete reason.

Do not pause for routine preferences. Pause only if:

- the supplied PixelLab credentials repeatedly fail after safe verification and required art cannot be completed another way;
- an external deployment action needs authority or account access not already supplied;
- a newly discovered constraint makes two materially different product directions unavoidable;
- completing the requested work would require destructive or out-of-scope action.

An external deployment blocker does not block finishing and verifying the deployable game locally.

## 15. Definition of done

The game is complete only when all of the following are true:

- A new player can finish the tutorial and understand attacking, affinity, defense, and switching.
- Quick Battle and all six ladder matches are playable from start to victory or defeat.
- Six original final creatures and eighteen functional moves are present; no placeholder art or text remains.
- All required screens, three difficulties, three arena themes, Bestiary, progression, save, settings, sound, reduced motion, and battle-speed control work.
- French is complete and default; English is complete through `?lang=en` and settings.
- Desktop, tablet touch, keyboard, portrait mobile, resize, and rotation flows remain usable.
- No Pokémon or other third-party character assets, names, sounds, logos, or copied interface elements ship.
- PixelLab credentials are absent from browser assets, logs, metadata, repository tracking, and network requests.
- Unit tests and Playwright tests pass.
- The browser console is clean during tested flows.
- Manual visual review passes at all required viewport sizes.
- The README explains the game, controls, local server, tests, architecture, save behavior, and static deployment.
- The repository contains no unfinished task markers, deliberately disabled required feature, or known release-blocking defect.
- A static host can publish the game without a compilation step or secret.

## 16. Goal prompt derived from this brief

Use the following as the autonomous goal prompt:

> Build and finish the complete browser game specified in `AUTONOMOUS_GAME_BUILD_BRIEF.md`. Treat that document as the binding product, art, engineering, safety, verification, and definition-of-done contract. Work autonomously from the current repository state; do not stop at a plan, scaffold, vertical slice, placeholder implementation, or partial content. Make routine design and implementation decisions yourself, select and refine original PixelLab assets within the stated credit budget, protect all credentials, and continue through implementation, testing, visual review, hardening, and release preparation until every definition-of-done item is genuinely satisfied. Do not ask the user to babysit ordinary choices. If external deployment access is unavailable, finish and verify the complete deployable static game locally and document the single remaining external action.
