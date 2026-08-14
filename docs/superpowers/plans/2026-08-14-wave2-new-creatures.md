# WAVE 2 ITEM C — Deuilastre & Aubéastre

## Outcome and design decisions

Add two mirrored legendary birds to the post–Édition claire roster, taking it from 24 creatures / 72 moves / 24 talents to **26 creatures / 78 moves / 26 talents** without adding a ninth status or changing the flat Éclat economy.

- **Deuilastre** (`deuilastre`) is the incarnation of evil: a spectral bird, internal affinity `shadow` (displayed as **Ténèbres** when the parallel type-renaming work lands), role `breaker`. It is a fast glass cannon that layers penalties and cashes 100 Éclat into heavy damage plus a complete enemy-team boon purge.
- **Aubéastre** (`aubeastre`, displayed **Aubéastre**) is the incarnation of good: its radiant counterpart, internal affinity `mind` (displayed as **Psy** after the parallel rename), role `support`. It has no damaging move. It heals, protects, removes penalties, and spends 100 Éclat on a protected delayed relay.
- Keep the internal affinity ids `shadow` and `mind`; never hardcode the planned French labels in their data or move copy. All displayed type names continue through `affinity.*` localization, so this item and the type-renaming plan can land in either order.
- The pair are lore and kit mirrors, not equal heads-up duelists. Under the current six-affinity ring, Shadow is ×2 into Mind while Mind is neutral into Shadow. Do not alter the affinity graph to force a symmetric duel; Aubéastre’s answer is to enable a protected ally pivot rather than trade attacks.
- They are available in player selection, Quick Battle, Draft, remix, and balance sampling as soon as added. No early League rival, Trial, or Gauntlet stage adopts them. Only the post-game **Champion Circuit version of Crown** uses them, with Deuilastre leading; the ordinary League Crown team stays unchanged.
- Do not add a new squad preset. The existing eight remain authored beginner-facing examples, while the two legendaries are discovered through free team building.
- Keep save format **v15**. The save validator already iterates `CREATURE_IDS` for mastery and records, and old v15 saves safely give the new ids empty progression. There is no persisted battle state and therefore no schema reason to create v16.

## Full creature design

### Shared stat silhouette

Both birds deliberately share HP, Guard, and Speed so the duality reads before their kits diverge.

| Creature | HP | Attack | Guard | Speed | Position against the current 24 |
|---|---:|---:|---:|---:|---|
| Deuilastre | **79** | **124** | **64** | **122** | New joint-lowest HP (current minimum 80); second-highest Attack, between Solflare 125 and Calderoc 120; second-lowest Guard, between Pyrolynx 62 and Umbrawl/Farfombre 65–66; joint third-fastest speed tier, behind Pyrolynx 126 and Ferrax 124 and ahead of Riptalon 119. |
| Aubéastre | **79** | **73** | **64** | **122** | Same new HP/Guard/Speed extremes; second-lowest Attack, between Nymbloom 72 and Abyssar/Virelia 76. The low Attack is intentional because all three moves are non-damaging. |

The shared 79/64/122 body makes both genuinely fragile: priority helps them express a turn, but neither should survive repeated neutral hits. Deuilastre’s 124 Attack, rather than an oversized regular-move power, supplies the requested damage ceiling without breaking the regular-move TTK profile.

### C1 — Deuilastre

Data shape for `src/data/creatures.js`:

```js
deuilastre: {
  id: 'deuilastre',
  affinity: 'shadow',
  role: 'breaker',
  passive: 'baleful_omen',
  maxHp: 79,
  attack: 124,
  guard: 64,
  speed: 122,
  moves: ['dire_pinion', 'spectral_knell', 'eclipse_of_grace'],
},
```

Moves for `src/data/moves.js`:

```js
dire_pinion: {
  id: 'dire_pinion',
  owner: 'deuilastre',
  affinity: 'shadow',
  kind: 'damage',
  power: 23,
  priority: 1,
  cooldown: 0,
  targetStatuses: [{ id: 'marked', duration: 2 }],
  visual: 'dire_pinion',
},
spectral_knell: {
  id: 'spectral_knell',
  owner: 'deuilastre',
  affinity: 'shadow',
  kind: 'damage',
  power: 16,
  priority: 0,
  cooldown: 1,
  targetStatuses: [
    { id: 'stunned', duration: 2 },
    { id: 'burning', duration: 2 },
  ],
  visual: 'spectral_knell',
},
eclipse_of_grace: {
  id: 'eclipse_of_grace',
  owner: 'deuilastre',
  affinity: 'shadow',
  kind: 'damage',
  power: 48,
  priority: -1,
  cooldown: 2,
  targetStatuses: [{ id: 'marked', duration: 2 }],
  purge: 'all',
  purgeTeam: true,
  purgeBarrier: true,
  visual: 'eclipse_of_grace',
  signature: true,
},
```

French kit:

| Move | Exact effect | Purpose |
|---|---|---|
| **Plume funeste** | Shadow damage, power 23, priority +1, no cooldown; applies `marked` for 2 turns if the attack lands and the target survives. | Reliable fast Combo setup for other teammates. It is intentionally not a Combo finisher itself. |
| **Glas spectral** | Shadow damage, power 16, cooldown 1; applies `stunned` for 2 turns and `burning` for 2 turns. | The heaviest two-penalty regular move in the new kit, paid for with low power and a cooldown. |
| **Éclipse des grâces** — Signature | Shadow damage, power 48, priority −1, cooldown 2; on a landed nonlethal hit also applies `marked` for 2 turns. After the damage transaction, purge every positive status and every barrier from all three enemy combatants. | Massive punish against prepared teams while preserving counterplay from Evasive, Countering, barriers, priority, and Deuilastre’s fragility. |

Talent in `src/data/passives.js`:

```js
baleful_omen: { icon: '◒' },
```

**Mauvais Augure / Baleful Omen:** after one of Deuilastre’s moves successfully applies at least one negative status, gain **+8 Éclat**, once per move. This follows existing passive grammar: `memory_silk` reacts to applied penalties and `encore` grants a flat 8 Éclat. Multiple descriptors on Glas spectral still trigger only one passive event and one +8 gain. A miss or a target K.O. before status application does not trigger it. Éclipse des grâces can trigger it only when its `marked` application succeeds; the +8 occurs after the 100-Éclat spend.

#### Full-team purge semantics and balance

Extend the existing `purge` grammar rather than inventing a new status. `purge: 'all'` retains its current meaning; `purgeTeam: true` expands the recipients from the active defender to the entire opposing team, and `purgeBarrier: true` additionally clears the separate `barrier` resource.

Exact ordering:

1. Resolve Evasive, Focused, Combo, affinity, barrier absorption, HP damage, Countering, recoil/passives, K.O., and `targetStatuses` exactly as a normal damage move does now.
2. Whether the damage hit or missed, iterate all opposing combatants. Remove `focused`, `haste`, `evasive`, and `countering`; set every positive barrier value to zero. Preserve all negative statuses.
3. Emit one existing `status` removal event per stripped status and a new `barrier-break` event per nonzero barrier, with `source: 'purge'`, so playback, the chronicle, and results remain truthful.
4. Because purge happens after the damage transaction, an active barrier still absorbs this hit before being destroyed, Evasive can make the damage miss before it is stripped, and Countering can answer a landed hit before being stripped. This is important counterplay, not an implementation accident.

The effect is balanceable post–Édition claire. Team-wide bonuses are now only barriers plus four positive statuses, and bench timed statuses tick even while benched, so a full-team purge is often only an active-target purge. Its high points are intentionally narrow: `enemy_aegis` / `dual_aegis`, Leaf Mantle’s team barrier, and a team that has banked entry boons.

Compare it to the seven current defensive/healing Signatures:

| Existing Signature | What Éclipse removes | What remains as counterplay |
|---|---|---|
| Oracle Veil | Active barrier 18, Focused, Evasive | Evasive first makes the hit miss; the Signature still trades 100 Éclat to erase the setup. |
| Déjà Vu | Active barrier 9, Evasive, Countering, Focused | Evasive prevents damage; if already consumed, Countering can fire before the purge. |
| Shell Bastion | Active barrier 30 | Its cleanses already happened; the barrier absorbs the current hit before breaking. |
| Ash Rebirth | Focused | The 18% heal and removed penalty are irreversible and remain valuable. |
| Leaf Mantle | Barriers 8/7 across the team | Its 4% team heal and team cleanse remain; this is the one deliberately hard-countered team-buff Signature. |
| Shadow Shed | Barrier 12, Evasive, Haste | Evasive prevents the damage before all three boons are erased. |
| Moonless Omen | Caster barrier 8 | Deuilastre’s Marked/Stunned penalties are not cleansed; priority −1 and Stunned’s damage penalty can blunt the answer. |

Power 48 is below Supernova’s 67, and unlike Supernova it has no recoil because the larger payment is situational team-wide utility. Start tuning with 48; if simulations show polar Shadow-vs-Mind one-shots or >55% pair-adjusted win rate, lower power first to 44–46, then Attack to 121. Do not weaken the defining full purge before trying those levers.

### C2 — Aubéastre

Data shape for `src/data/creatures.js`:

```js
aubeastre: {
  id: 'aubeastre',
  affinity: 'mind',
  role: 'support',
  passive: 'benevolent_omen',
  maxHp: 79,
  attack: 73,
  guard: 64,
  speed: 122,
  moves: ['dawn_dew', 'kindred_halo', 'immaculate_relay'],
},
```

Moves for `src/data/moves.js`:

```js
dawn_dew: {
  id: 'dawn_dew',
  owner: 'aubeastre',
  affinity: 'neutral',
  kind: 'heal',
  power: 0,
  priority: 1,
  cooldown: 2,
  teamHealRatio: 0.06,
  teamCleanse: 1,
  visual: 'dawn_dew',
},
kindred_halo: {
  id: 'kindred_halo',
  owner: 'aubeastre',
  affinity: 'neutral',
  kind: 'support',
  power: 0,
  priority: 2,
  cooldown: 1,
  teamHealRatio: 0.025,
  teamBarrier: 5,
  visual: 'kindred_halo',
},
immaculate_relay: {
  id: 'immaculate_relay',
  owner: 'aubeastre',
  affinity: 'neutral',
  kind: 'support',
  power: 0,
  priority: 3,
  cooldown: 3,
  allySwitch: {
    timing: 'after-actions',
    cleanse: 'all',
    statuses: [{ id: 'focused' }],
  },
  visual: 'immaculate_relay',
  signature: true,
},
```

French kit:

| Move | Exact effect | Purpose |
|---|---|---|
| **Rosée d’aurore** | Priority +1, cooldown 2; every conscious ally heals 6% max HP and loses one negative status. | Primary pure-healing action, between Healing Rain (6.5%, no cleanse) and Nectar Circle (8% plus cleanse). |
| **Halo fraternel** | Priority +2, cooldown 1; every conscious ally heals 2.5% max HP and gains 5 barrier, capped normally at 35. | Small recurring team bonus. At three living allies its ceiling is 15 barrier plus roughly 6–10 HP, well below Leaf Mantle’s Signature package. |
| **Relève immaculée** — Signature | Priority +3, cooldown 3; choose one conscious bench ally before committing the turn. Aubéastre remains active through every queued action. After those actions, the chosen ally enters, loses **all** `marked`, `rooted`, `stunned`, and `burning`, then gains `focused`. | A protected hand-off: the incoming ally never absorbs the attack that was aimed at Aubéastre and arrives ready to strike next turn. |

Talent in `src/data/passives.js`:

```js
benevolent_omen: { icon: '◓' },
```

**Augure bienveillant / Benevolent Omen:** after one of Aubéastre’s moves successfully removes at least one negative status, gain **+8 Éclat**, once per move. It mirrors Mauvais Augure exactly (apply versus remove). Rosée d’aurore may cleanse several allies but grants only +8 total; Relève immaculée grants +8 only if the arriving ally actually had a penalty; Halo fraternel never triggers it. The universal Coach command is not Aubéastre’s move and must not trigger this talent.

## Relève immaculée — engine, UI, AI, and preview contract

### Action selection

- Add the structured `move.allySwitch` property shown above. It composes only existing verbs (`cleanse` and status application) with a new delayed ally-selection/switch wrapper.
- Represent a committed action as `{ type: 'move', moveId: 'immaculate_relay', allyIndex: 1 }`.
- In `getLegalActions()`, emit one action variant per conscious bench ally for an affordable, off-cooldown `allySwitch` move. The move has no legal variant when Aubéastre is `rooted` or no conscious bench ally exists. Rooted must keep its plain-language promise that the creature cannot switch.
- Extend `actionKey()` / `isLegalAction()` to include `allyIndex` only for targeted ally-switch moves. Ordinary move actions remain source-compatible.
- The move grid renders one Relève immaculée button, not duplicate buttons. Clicking it opens the existing replacement-selector presentation in a new `signature-relay` mode. Reuse the portraits, HP, barriers, talents, and keyboard/focus behavior, but change the heading and hint to “Choisis l’allié protégé” / “L’attaque annoncée vise Aubéastre; cet allié entrera ensuite purifié et Concentré.” The dialog remains cancellable because the turn has not been committed.
- Options are only living bench allies. The card replaces the ordinary incoming-damage forecast with a guaranteed badge: “Aucun impact entrant · purifié · Concentré.” Do not show Perfect Relay, affinity-read, or normal-switch Éclat bonuses.

### Deterministic turn flow

1. Both sides commit complete actions, including `allyIndex`; no prompt occurs during resolution.
2. Ordinary `type: 'switch'` actions still resolve at the start of the turn.
3. Relève immaculée acts at priority +3. `executeMove()` emits `move-start`, spends 100 Éclat, starts Aubéastre’s cooldown, and stores a side-local queued relay containing the validated target index. It does **not** change `owner.active` yet.
4. The opponent’s already-committed move resolves against the still-active Aubéastre. If it is damaging, Aubéastre—not the chosen ally—takes the hit, statuses, and possible K.O. This is the explicit meaning of “the incoming ally does not absorb the aimed attack.”
5. After all queued move actions finish, but before `tickEnd()` / arena pulse, resolve queued relays in stable `player`, then `enemy` order. If the selected ally is still conscious, make it active, clear any K.O. replacement flag left by Aubéastre’s fall, emit `switch` with `source: 'signature'`, remove all four negative statuses, apply `focused`, and then run the incoming creature’s normal entry talent.
6. If Aubéastre was K.O.’d by the aimed attack, the promised relay still completes and replaces it without opening the K.O. selector. If Aubéastre was prevented from executing the move at all (already K.O. when its action slot arrives), no relay is queued and ordinary replacement rules apply.
7. If both sides use Relève immaculée, both outgoing birds remain active through the action phase and both relays resolve afterward in stable side order. Since neither relay damages the other, this order must not affect outcome.
8. The arriving ally then participates in normal end-of-turn ticking. Its penalties were removed before the tick, and its indefinite Focused status remains until its next damage move.

### What the special relay does not grant

- No normal voluntary-switch +10 Éclat.
- No Relay Rush +24 Éclat or Haste, even under `relay_fever`.
- No Perfect Relay +6 Éclat, because the incoming ally was never the defender of the forecast attack.
- No second action for the arriving ally this turn.
- No healing beyond the cleanse and Focused bonus specified above.
- It still emits a switch-shaped history event, so the chronicle, accessibility narration, and relay achievement can truthfully record that a switch occurred; distinguish it with `source: 'signature'` for copy and FX.

### AI scoring and intent

- `chooseAiAction()` must score each legal `allyIndex` variant rather than choosing the move and target separately. Candidate value should include: negative statuses removed (10 each), the value of Focused on a candidate with an available damage move (18), candidate HP ratio (up to 8), outgoing/incoming affinity against the current foe (reuse `scoreSwitch` terms), and a large bonus when Aubéastre is below 35% HP. There is zero predicted incoming damage on the candidate.
- Penalize a no-cleanse, full-HP relay unless the candidate has a favorable matchup or a ready high-value damage move. This prevents Champion AI from burning 100 Éclat merely because the move is a Signature.
- Generalize support scoring so `teamPurge`, `purgeBarrier`, and `allySwitch` use board-state value. Replace the current flat `move.purge ? 8 : 0` treatment with actual positive-status count and barrier points; do not let Deuilastre prefer the purge against an empty board solely for utility.
- Apprentice simple intent stays “Signature.” Expert intent may show “Relève immaculée → {ally}”; no damage range is shown.
- `previewMove()` remains `null` for the non-damaging relay. Add a small pure helper such as `previewAllySwitch(state, side, allyIndex)` for the selector/AI if useful; it reports removed penalties, Focused, matchup, and protected incoming damage 0 without mutating state.
- Signature-clash presentation should still detect Relève immaculée versus another Signature from `move-start`; the later relay event supplies the actual switch animation.

## Combo and team-profile integration

- Do **not** set `combo: true` on any of the six moves. A power-48 full-team purge does not need the ×1.4 multiplier, and a pure support creature should not attack merely to participate in Combo.
- Plume funeste and a landed Éclipse des grâces are `marked` setters. `teamComboRoutes()` is already data-driven and will expose routes from Deuilastre to any different teammate with a Marked finisher. No edit to `src/data/combos.js` should be necessary; add a test that one such route exists and that no Deuilastre→Aubéastre route is fabricated.
- The pair’s intended direct synergy is not Combo: Aubéastre absorbs the aimed action, relays Deuilastre in cleansed and Focused, and Deuilastre uses that +30% on its next attack. Shared Éclat prevents immediate back-to-back Signatures.
- Update `src/data/team-profile.js`: count `purgeTeam` and actual barrier-purge capability heavily under `control`; count Rosée/Halo through their existing heal/barrier fields; add `allySwitch` as approximately +18 sustain (full cleanse/protection) and +22 tempo (protected delayed pivot plus Focused). Keep all axes clamped to 100 and extend Team Compass fixture expectations only where actual preset results change.
- Roles remain existing `breaker` and `support`, so no new `role.*` keys are required.

## French and English localization draft

Add the following keys to both final effective dictionaries in `src/i18n.js`. That file currently contains base objects plus later `Object.assign` overrides; place each new key in the final authoritative section for its locale and remove/avoid stale duplicates. Keep move-effect strings within the existing 12-word test.

| Key | French | English |
|---|---|---|
| `creature.deuilastre` | Deuilastre | Deuilastre |
| `creature.aubeastre` | Aubéastre | Aubéastre |
| `passive.baleful_omen` | Mauvais Augure | Baleful Omen |
| `passive.effect.baleful_omen` | Malus infligé par une technique : gagne 8 Éclat. | A move applies a penalty: gain 8 Surge. |
| `passive.benevolent_omen` | Augure bienveillant | Benevolent Omen |
| `passive.effect.benevolent_omen` | Malus retiré par une technique : gagne 8 Éclat. | A move removes a penalty: gain 8 Surge. |
| `move.dire_pinion` | Plume funeste | Dire Pinion |
| `move.effect.dire_pinion` | Prioritaire. Marque la cible pendant 2 tours. | Priority. Marks the target for 2 turns. |
| `move.spectral_knell` | Glas spectral | Spectral Knell |
| `move.effect.spectral_knell` | Sonne et Brûle la cible pendant 2 tours. | Dazes and Burns the target for 2 turns. |
| `move.eclipse_of_grace` | Éclipse des grâces | Eclipse of Grace |
| `move.effect.eclipse_of_grace` | Signature : dégâts massifs, Marque, détruit bonus et barrières ennemis. | Signature: massive damage, Marks, destroys every enemy boost and barrier. |
| `move.dawn_dew` | Rosée d’aurore | Dawn Dew |
| `move.effect.dawn_dew` | Soigne 6 % et retire un malus à chaque allié. | Restores 6% HP and removes one penalty from each ally. |
| `move.kindred_halo` | Halo fraternel | Kindred Halo |
| `move.effect.kindred_halo` | Soigne 2,5 % et donne 5 de barrière à tous. | Restores 2.5% HP and grants everyone barrier 5. |
| `move.immaculate_relay` | Relève immaculée | Immaculate Relay |
| `move.effect.immaculate_relay` | Signature : l’allié choisi entre purifié et Concentré après les attaques. | Signature: chosen ally enters cleansed and Focused after incoming actions. |

Additional FR/EN UI keys are needed for the relay selector, its protected badge, its special playback line, and `barrier-break`; suggested ids are `battle.relayChoose`, `battle.relayHint`, `battle.relayProtected`, `battle.immaculateRelay`, and `battle.action.barrierBreak`. Keep “after incoming actions” explicit in simple and expert copy so the player never expects the ally to tank the announced hit.

### Lore — final draft

`lore.deuilastre` (FR):

> Quand la première étoile projeta son ombre, Deuilastre en sortit avec un cri que même les ruines n’osent répéter. Il ne crée pas la cruauté : il arrache aux cœurs leur dernier éclat de courage, puis se nourrit du silence laissé derrière lui. Les anciens jurent pourtant qu’une plume blanche bat encore sous son aile gauche.

`lore.deuilastre` (EN):

> When the first star cast its shadow, Deuilastre emerged with a cry even ruins dare not repeat. It does not create cruelty: it tears the final spark of courage from every heart, then feeds on the silence left behind. Yet the elders swear a white feather still beats beneath its left wing.

`lore.aubeastre` (FR):

> Quand la première étoile offrit sa lumière, Aubéastre en sortit sans un bruit et la partagea avec tout ce qui tremblait dans la nuit. Il ne combat jamais pour lui-même : il recueille les blessures, relève les faibles et ouvre un passage là où tout semblait perdu. Les anciens jurent pourtant qu’une plume noire repose sous son aile droite.

`lore.aubeastre` (EN):

> When the first star offered its light, Aubéastre emerged without a sound and shared it with everything trembling in the night. It never fights for itself: it gathers wounds, raises the weak, and opens a passage where all seemed lost. Yet the elders swear a black feather rests beneath its right wing.

## Art — PixelLab briefs ready to create

Create these two files during implementation. They intentionally omit `edit_image` because these are new creatures; `tools/generate-pixellab.mjs` will use PixelLab `/generate-image-v2`, write candidates under `art/concepts/<id>/`, and record `generation.json`.

`art/briefs/deuilastre.json`:

```json
{
  "id": "deuilastre",
  "seed": 814201,
  "image_size": {
    "width": 128,
    "height": 128
  },
  "no_background": true,
  "description": "Original legendary spectral bird creature named Deuilastre, dark counterpart to a radiant celestial bird but fully readable as its own silhouette. Lean predatory avian body, sharp hooked beak, long clawed legs tucked into a diving battle stance, three ragged layers of tattered wings, and torn tail feathers dissolving into ghostly wisps. Violet-black and deep plum plumage with a baleful magenta-violet inner glow, cold cyan rim light, severe luminous eyes, and several broken dark halo shards floating behind the head. One tiny hidden white feather under the left wing. Rich premium fantasy pixel art matching the Arène de Noam roster: crisp deliberate pixel clusters, dense selective cluster shading, subtle dithered gradients, selective dark outline weight, dramatic light spill, large clean silhouette at thumbnail size. Full body, three-quarter side battle view facing right, centered with generous padding, transparent background. No blood, gore, clothing, handheld objects, text, logo, extra heads, human anatomy, or resemblance to any existing franchise character."
}
```

`art/briefs/aubeastre.json`:

```json
{
  "id": "aubeastre",
  "seed": 814202,
  "image_size": {
    "width": 128,
    "height": 128
  },
  "no_background": true,
  "description": "Original legendary radiant bird creature named Aubéastre, luminous counterpart to a tattered spectral bird but fully readable as its own silhouette. Lean graceful avian body, fine curved beak, long elegant legs tucked into a rising battle stance, three flowing layers of broad wings, and ribbonlike tail plumes made of soft light. Luminous white, warm gold, pearl and pale sunrise-blue plumage with radiant golden eyes, gentle light spill, and a complete thin solar halo floating behind the head. One tiny hidden black feather under the right wing. Rich premium fantasy pixel art matching the Arène de Noam roster: crisp deliberate pixel clusters, dense selective cluster shading, subtle dithered gradients, selective warm outline weight, dramatic highlights, large clean silhouette at thumbnail size. Full body, three-quarter side battle view facing right, centered with generous padding, transparent background. Do not make it humanoid or angelic with clothing; no handheld objects, text, logo, extra heads, photorealism, or resemblance to any existing franchise character."
}
```

Generation commands:

```sh
node tools/generate-pixellab.mjs art/briefs/deuilastre.json
node tools/generate-pixellab.mjs art/briefs/aubeastre.json
```

Select candidates as a pair, not independently. They should share body scale, three-layer wing rhythm, opposite halo treatment, hidden opposite-color feather, and right-facing framing, while Deuilastre reads angular/torn and Aubéastre reads curved/flowing. Promote the chosen transparent RGBA files to `assets/monsters/deuilastre/battle.png` and `assets/monsters/aubeastre/battle.png`; append full PixelLab model/job/seed/source/final provenance to `assets/asset-manifest.json` without changing Orakyn as `styleAnchor`.

Visual QA must inspect each chosen PNG at native 128×128 and enlarged nearest-neighbor scale, verify transparent corners/no matte, then render them in selection cards, Bestiary cards, switch/relay selector, Move Theater, and live battle on both the dark Eclipse arena and bright Astral arena. Check left/right battle mirroring, clipping, halo separation, high-contrast mode, and reduced-motion fallback.

## Integration map

### Data and authored content

- `src/data/creatures.js`: update the 24-fantasy comment to 26 and append the two exact records. Appending preserves existing ids/order and save/favorite tie-break behavior.
- `src/data/moves.js`: append the six exact moves; preserve one unique mechanical fingerprint and one unique `visual` id per move.
- `src/data/passives.js`: append `baleful_omen` / `benevolent_omen`; counts become 26/26.
- `src/data/combos.js`: no production change expected. Its data-driven Marked routing should pick up Deuilastre automatically; cover this with tests.
- `src/data/team-profile.js`: score team purge and ally switch as described above. `remixTeam()` already enumerates `Object.keys(CREATURES)` and automatically includes both.
- `src/data/trainers.js`: keep all `team` fields unchanged. Add `circuitTeam: ['deuilastre', 'aubeastre', 'prismage']` and `circuitLead: 0` only to Crown. Validate optional circuit teams as legal authored trios.
- `src/data/circuit.js` and `src/screens/team-select.js`: when mode is `circuit`, prefer the selected trainer’s `circuitTeam`/`circuitLead`; League dossiers and League battles continue using `team`. Crown’s post-game Circuit encounter therefore leads Deuilastre and can exercise Aubéastre’s AI relay without exposing either in the early ladder.
- `src/data/squads.js`, `src/data/trials.js`, and `src/data/gauntlet.js`: intentionally unchanged. Document this in the implementation handoff so later work does not accidentally treat omission as missed integration.
- `src/data/draft.js`, Quick random selection, direct URL team parsing, and Bestiary iteration are already `CREATURE_IDS`-driven; verify rather than special-case.

### Engine and AI

- `src/battle/engine.js`: add scoped barrier/team purge, the two mirrored passive triggers, ally-targeted legal actions, queued delayed relays, special switch resolution, and events. Keep `state.version: 7` unless battle snapshots become persisted; they are currently ephemeral.
- Refactor `resolveSwitch()` to accept explicit options/source rather than overloading the current `replacement` boolean further. Normal switch, forced K.O. replacement, and Signature relay must each opt into their exact surge, ace, event, and entry-talent behavior.
- `src/battle/ai.js`: board-state purge scoring, per-target relay scoring, and legal action handling for `allyIndex`. Ensure apprentice random choice still returns a full legal action and champion forecast does not mutate the source state beyond RNG.
- `src/battle/statuses.js`: no ninth status and no status-definition changes. Reuse `NEGATIVE_STATUSES`, `POSITIVE_STATUSES`, `cleanse`, and `purge`.
- `src/battle/damage.js`: no formula change; the existing 2.0/0.5 effectiveness is authoritative.

### Battle UI, playback, previews, and art choreography

- `src/battle-ui/controller.js`: extract/reuse the switch-option renderer for `signature-relay` selection, pass `allyIndex`, resolve the special playback event, and preserve cancel/focus behavior. K.O. replacement selection remains non-cancellable.
- `src/battle-ui/hud.js`: targeted ally-switch actions must not duplicate the move button; expert enemy intent may name the selected relay ally. Existing signature readiness and passive lookup become data-driven automatically.
- `src/battle-ui/playback.js`: narrate `barrier-break` and Signature-sourced switch separately; use a relay-specific FX call and timing, and keep both events in the battle log.
- `src/battle-ui/fx.js`: add `immaculateRelayFx()` for the post-action gate/hand-off and let the six moves use the generic affinity FX base plus authored selectors.
- `src/app/context.js`: export/import any new preview helper and add `barrier-break` plus the Signature relay event/source to `LOG_EVENT_TYPES` / `LOG_TYPE_GROUPS` as needed.
- `src/screens/bestiary.js`: Move Theater already handles heal/support generically, but Relève immaculée needs its visual to read as a relay rather than a generic Focused pulse. Six exact `.move-<id>` selectors are required for the presentation contract.
- `styles/screens/battle-fx.css` and/or `styles/screens/battle-presentation.css`: author distinct selectors for all six ids. Visual direction: black feathers and a halo implosion for Éclipse des grâces; white-gold gate, outgoing silhouette hold, then incoming light sweep for Relève immaculée. Include reduced-motion and high-contrast-safe shapes, not color alone.
- `src/sound.js`: no authored-id table change is required; it already derives move sound from affinity/kind. Verify Shadow damage and neutral support defaults in theater/live battle.

### i18n, save, progression, and documentation

- `src/i18n.js`: add all creature/move/effect/passive/lore/UI keys in FR+EN. Update every duplicated effective 24/72 string: `academy.openBestiary`, `title.rosterLine`, `app.tagline`, and both occurrences per locale of `bestiary.subtitle` (“Vingt-six…” / “Twenty-six…”). Prefer interpolation with roster/move counts where a caller already has access to data.
- `src/save.js`: keep v15 and migrations untouched. Add a regression proving a valid old v15 save loads, preserves old records, ignores unknown ids, and accepts the new ids in teams/records after validation.
- `README.md`: 24→26 and 72→78 in the overview, Bestiary/Move Theater bullet, and `moves.js` description.
- `styles/screens/progression.css`: update the opening “24-creature roster” comment to 26; no visual rule depends on that number.

### Every roster/move-count hardcode found by the audit

Prefer `CREATURE_IDS.length` / `Object.keys(MOVES).length` in rendering code so the next roster addition does not require another sweep.

| File/context | Required change |
|---|---|
| `src/data/creatures.js:1` | Comment 24→26. |
| `src/screens/title.js` hero eyebrow | Replace hardcoded `24 CRÉATURES · 72 TECHNIQUES` with localized/interpolated 26/78 copy. |
| `src/screens/academy.js` eyebrow | `24 · 72 · 3v3` → dynamic `26 · 78 · 3v3`. |
| `src/screens/team-select.js` all-affinity tab | Literal 24 → `CREATURE_IDS.length`. Shadow and Mind filters each become 5; the other four remain 4. |
| `src/screens/bestiary.js` page eyebrow | `24 / 24` → dynamic `26 / 26`. |
| `src/app/shell.js` Bestiary all button, initial count, filtered denominator | All three literal 24 values → dynamic roster count. A Force filter reads `4 / 26`. |
| `src/i18n.js` | Update both base and override occurrences described above: 26 creatures, 78 moves, Vingt-six/Twenty-six guardians. |
| `README.md:3,44,69` | 26 creatures and 78 moves. |
| `styles/screens/progression.css:1` | Comment only, 24→26. |
| `test/data-ai.test.js` | Test title and exact counts 26/78/26; unique visual count 78; non-damage Signatures 7→8; Signature decisiveness predicate must accept `allySwitch`; optional Crown circuit team validation. |
| `test/i18n-save.test.js` | “seventy-eight” title, dynamic 78-key sweep, new bilingual keys/lore, effect length, v15 compatibility. |
| `test/presentation-contract.test.js` | “seventy-eight” title; the dynamic loop will enforce selectors for the six new visuals. |
| `e2e/progression-responsive.spec.js` | Test title; roster/card counts 26; Shadow count 5; academy button 78; theater triggers 78; filtered denominator `4 / 26`; Trial selection roster 26. |
| `e2e/gameplay.spec.js` | `.scout-read` count 24→26; add the targeted relay interaction here or in a focused new spec. |

Do **not** bulk-replace unrelated numeric 24/72 occurrences. The grep also found intentional balance/game values (+24 Relay Rush, 24% Gauntlet camp recovery, turn thresholds, move powers, team-profile weights), test seeds 24/72, audio tempo/pitches, WebGL geometry segments, CSS dimensions/animation percentages/colors, and trial/circuit 72% starting HP. Those remain unchanged.

## Verification plan and balance risks

### Unit/data tests

Add focused deterministic coverage:

1. **Roster contract:** exactly 26 creatures, 78 moves, 26 distinct assigned talents, three unique owner moves each, exactly one Signature each, eight non-damage Signatures, and 78 unique visual ids/mechanical fingerprints.
2. **Status diet:** every new descriptor uses only the eight surviving ids; no new status appears in data, engine, i18n, or CSS.
3. **Deuilastre purge:** seed all three enemies with barriers and all four positive statuses plus representative negatives. Assert damage/barrier ordering on the active target, all enemy positives/barriers removed afterward, negatives preserved, correct events emitted, and no mutation of allies.
4. **Purge counterplay:** Evasive makes damage miss but is then removed; Countering reflects before removal on a landed hit; barrier absorbs this hit before `barrier-break`; negative Marked survives the purge.
5. **Mauvais Augure:** one +8 event for Plume/Glas despite multiple penalties, none on miss/K.O., and correct post-Signature Éclat.
6. **Relay legality:** one legal action per living bench target; none while Rooted, below Signature cost, on cooldown, or with no living bench; `allyIndex` participates in legality.
7. **Relay targeting:** choose a penalized ally while an enemy damage move is queued. Assert Aubéastre takes the hit, chosen ally’s HP/barrier do not absorb it, active index changes after actions, all negatives are gone, Focused exists, cooldown remains on Aubéastre, and no +10/+24/+6 switch surge is emitted.
8. **Relay after K.O.:** Aubéastre may fall to the aimed hit; the preselected ally still enters and `pendingReplacement` is false. If Aubéastre never executes, no protected relay occurs.
9. **Dual relay/replay:** both sides can relay in the same turn with stable deterministic history; safe snapshots/previews do not mutate state.
10. **Augure bienveillant:** one +8 per move when any cleanse succeeds, zero when there was nothing to cleanse, and Coach never triggers it.
11. **AI:** every difficulty returns exact legal targeted actions; Champion prefers a useful penalized/favorable ally, avoids a valueless relay, values populated team purge, and preserves the source-state mutation contract.
12. **Combo/profile:** Deuilastre supplies at least one cross-creature Marked route, Aubéastre creates none, the pair creates no direct route, and all profile axes stay bounded.

### Browser/visual tests

- Update all 26/78 count assertions and both five-creature Shadow/Mind filters.
- With `animations=0`, force Aubéastre at 100 Éclat, click Relève immaculée, verify the ally selector is cancellable and accessible, choose a penalized ally, and assert the enemy damage narration precedes the Signature switch/cleanse/Focused narration.
- Repeat with Aubéastre at lethal HP and confirm no ordinary replacement dialog appears.
- Verify keyboard/gamepad focus returns correctly after cancel and after selection.
- Open all six moves in Move Theater and assert their `.move-*` class; visually check the relay-specific rather than generic-support choreography.
- Run existing reduced-motion, high-contrast, mobile, and no-runtime-leak suites with the larger roster.

### Balance simulation

`tools/simulate-balance.mjs` already samples `CREATURE_IDS`, regular damaging moves, pairwise matchups, Team Compass axes, and the 30–70% roster band dynamically, so both creatures enter the global run automatically. Extend reporting with action counts for team purge and protected relay so a nominal win rate cannot hide an AI that never uses a defining move.

Run at least:

```sh
npm test
ARENA_BALANCE_SAMPLES=5000 node tools/simulate-balance.mjs
ARENA_NAIVE_SAMPLES=1000 node tools/simulate-balance.mjs --naive
npm run test:e2e
```

Expected risk is **polar**, not uniformly overtuned:

- Deuilastre may spike into Mind glass cannons at ×2 and look weak into Grove at ×0.5; its low HP and priority −1 Signature magnify matchup swings. Watch individual and pairwise rates, full-HP regular-move one-shots, and teams that feed it Focused. Mitigation order: Signature power 48→46→44, Attack 124→121, then Glas duration 2→1. Preserve full-team purge identity.
- Aubéastre may be underrated by damage-biased policies, overextend fights through heal/barrier loops, or create oppressive protected entries for existing assassins. Watch turn-cap share, average turns, action selection, and its win rate beside Pyrolynx/Ferrax/Umbrawl/Deuilastre. Mitigation order: Halo barrier 5→4, heal 2.5%→2%, Rosée 6%→5.5%, then remove “all” cleanse from the relay in favor of two penalties. Preserve delayed protection and Focused.
- If either falls outside the broad 30–70% gate while the other is healthy, tune separately. A mirrored aesthetic does not require identical win rate or shared nerfs.

## Execution checklist

### One Sol implementation session

Give one `gpt-5.6-sol` session this plan and ownership of the non-generated implementation in a single coherent pass:

- Add creature/move/passive/trainer-circuit data and update team profiles.
- Implement scoped purge, mirrored talent triggers, targeted delayed relay, AI scoring, preview/action legality, and event ordering.
- Implement controller/HUD/playback/FX/CSS/i18n/count/save-compatibility work.
- Add/update unit, presentation, e2e, and simulation instrumentation tests.
- Keep save v15, eight statuses, flat Éclat, universal Coach, unified Combo, and 2.0/0.5 affinity behavior unchanged.
- Run formatting only on touched implementation files, then the verification commands above. Report exact balance seed/sample counts and rates.

### Orchestrator art steps

1. Create the two exact JSON briefs above and run `tools/generate-pixellab.mjs` for each. Do not expose `.dev.vars` or the PixelLab token.
2. Inspect all outputs with native-resolution image viewing. If one bird misses the shared silhouette/scale, revise only its brief/seed and regenerate; do not accept a mismatched pair because each image looks good alone.
3. Present/record the chosen candidate ids, promote them to the two canonical `assets/monsters/*/battle.png` paths, and append manifest provenance.
4. Start the local app and visually verify cards, filters, theater, selector, both battle sides, Eclipse/Astral arenas, reduced motion, and high contrast. Check console/network for missing sprites.
5. Re-run the presentation contract and relevant e2e smoke after final asset paths are in place.

## Acceptance criteria

- The game exposes 26 complete creatures, 78 complete moves, and 26 named talents in both languages with no placeholder keys or missing sprites.
- Deuilastre is visibly the fastest fragile anti-boon glass cannon: two penalty-heavy normal moves and a post-damage full-enemy-team positive-status/barrier purge at power 48.
- Aubéastre has no damaging move and can heal/protect the team; Relève immaculée requires a preselected living bench ally, leaves Aubéastre as the target of queued actions, then brings the ally in fully cleansed and Focused without normal relay rewards.
- Only the Crown Champion Circuit variant adopts the pair; early League, Trials, Gauntlet, and starter squad presets remain stable.
- No ninth status, Combo exception, new economy, affinity-rule change, or save-version bump is introduced.
- Counts, filters, Bestiary, theater, localization, simulations, and tests all cover the expanded roster; generated art passes native-size and in-game visual QA.

## Typing addendum

### Confirmed chart and evaluation rule

The parallel type-system work is authoritative: there are two canonical, disconnected triangles with cross-triangle neutrality.

```text
Eau → Feu → Plante → Eau
Psy → Combat → Ténèbres → Psy
```

An arrow is ×2 in the forward direction and ×0.5 backward. Same-type and cross-triangle interactions are ×1. For a dual defender only, multiply the move’s result against both defensive types; moves retain one attack type. Thus a dual defender can theoretically receive ×4, ×1, ×0.25, ×2, or ×0.5, although the candidate pairs below top out at ×2.

The tables use these columns:

- **Into C1/C2:** a move of the row’s type attacking that creature.
- **C1 Dark out:** Deuilastre’s Ténèbres damage attacking a single-type target of the row’s type.
- **C2 Psy out:** the multiplier a hypothetical Psy attack from Aubéastre would have. Its actual three-move kit is pure support and all moves are Neutral, so this column explains typing intuition rather than current damage.

### Option A — keep both single typed: C1 Ténèbres, C2 Psy

| Move/target type | Into Deuilastre (Ténèbres) | Into Aubéastre (Psy) | C1 Dark out | C2 Psy out (hypothetical) |
|---|---:|---:|---:|---:|
| Eau | 1 | 1 | 1 | 1 |
| Feu | 1 | 1 | 1 | 1 |
| Plante | 1 | 1 | 1 | 1 |
| Psy | 0.5 | 1 | 2 | 1 |
| Combat | 2 | 0.5 | 0.5 | 2 |
| Ténèbres | 1 | 2 | 1 | 0.5 |

Direct pair math: Deuilastre’s Ténèbres attacks hit Aubéastre for **×2**; a hypothetical Psy attack from Aubéastre would hit Deuilastre for **×0.5**. This is deliberately not a fair duel. It tells the familiar “darkness preys on the mind” story, while Aubéastre’s gameplay answer is to heal and perform a protected relay rather than fight Deuilastre directly.

Balance consequence with the planned stats is concrete. Plume funeste at power 23, Attack 124, versus Aubéastre’s 64 Guard at ×2 rounds to **80 damage**, one more than Aubéastre’s 79 max HP:

```text
round((23 × 124 / 64) × 0.9 × 2) = 80
```

That would make a zero-cooldown priority normal move one-shot the full-health counterpart, which is too polar even if thematically legible. If Option A is selected, change **only Plume funeste from power 23 to power 22**; the same calculation becomes 77 damage. Glas spectral remains power 16, Éclipse des grâces remains power 48, both stat lines remain 79/64/122, and all art briefs remain unchanged. A 100-Éclat Signature may still one-shot this exact weakness; a regular priority setup move should not.

Cost and intuition:

- **Engine/data:** lowest cost. Keep `affinity: 'shadow'` and `affinity: 'mind'`; there is no secondary schema, multiplier composition, or migration.
- **UI:** lowest cost. Every creature continues to show one type chip in selection, Bestiary, Draft, HUD details, and switch cards.
- **Tests:** add canonical-triangle matchup assertions and the 79-HP no-regular-one-shot regression. Existing single-affinity fixtures stay structurally valid.
- **Twelve-year-old Pokémon intuition:** lowest cost. Psychic beats Fighting, Fighting beats Dark, and Dark beats Psychic are recognizable. Pokémon uses an immunity for Dark versus Psychic rather than ×0.5, but “bad matchup” still feels right; no invented edge feels backwards.
- **Teaching:** the Academy can teach exactly two triangles and cross-triangle neutrality, with no legendary exception paragraph.

### Option B — make only the legendary pair dual typed

Dual types are familiar to a Pokémon player, and multiplicative defense is the expected rule. The conceptual cost is therefore much lower than a custom seventh type. The product cost is still substantial because every other creature remains single typed: these two become a permanent schema/UI exception, filters need inclusive semantics, and the Academy must explain why some multipliers cancel.

#### B1 — proposed candidate: C1 Ténèbres/Psy, C2 Psy/Feu

| Move/target type | Into C1 Ténèbres/Psy | Into C2 Psy/Feu | C1 Dark out | C2 Psy out (hypothetical) |
|---|---:|---:|---:|---:|
| Eau | 1 | 2 | 1 | 1 |
| Feu | 1 | 1 | 1 | 1 |
| Plante | 1 | 0.5 | 1 | 1 |
| Psy | 0.5 | 1 | 2 | 1 |
| Combat | 1 | 0.5 | 0.5 | 2 |
| Ténèbres | 2 | 2 | 1 | 0.5 |

This pairing gives Aubéastre a pleasing solar Feu read and two clear weaknesses (Eau, Ténèbres), but it makes Deuilastre neutral to Combat because Psy’s resistance cancels Ténèbres’ weakness. That cancellation is valid dual-type logic, yet it weakens the extremely teachable “Combat beats Ténèbres” counter. It also leaves Deuilastre’s Dark attack at ×2 into Aubéastre, so the Plume funeste 23→22 safety adjustment is still required.

Deuilastre being Ténèbres/Psy is thematically strong—a corrupted mind—but defensively odd: it resists Psy, is weak to Ténèbres, and no longer fears Combat. Aubéastre’s Feu secondary matches white-gold art, but adds an Eau weakness and Plante resistance unrelated to its actual support-only move kit.

#### B2 — proposed candidate: the same mirrored pair in opposite display order

C1 `Ténèbres/Psy` and C2 `Psy/Ténèbres` are the same unordered defensive type pair. Display order can communicate the dominant face, but it has **no mechanical effect**.

| Move/target type | Into either Ténèbres/Psy creature | C1 Dark out | C2 Psy out (hypothetical) |
|---|---:|---:|---:|
| Eau | 1 | 1 | 1 |
| Feu | 1 | 1 | 1 |
| Plante | 1 | 1 | 1 |
| Psy | 0.5 | 2 | 1 |
| Combat | 1 | 0.5 | 2 |
| Ténèbres | 2 | 1 | 0.5 |

“Two faces of one coin” is excellent lore shorthand, but the battle read is worse than the fiction: both birds share an identical weakness to Ténèbres, identical Psy resistance, and identical Combat neutrality. Deuilastre remains ×2 into Aubéastre because its Dark move exploits Aubéastre’s Psy half. A child may reasonably ask why the incarnation of Ténèbres is itself weak to Ténèbres; dual math answers the question, but the answer costs more explanation than it creates strategy.

#### B3 — better thematic dual proposal: C1 Ténèbres/Feu, C2 Psy/Eau

This uses the second triangle to mirror hellish spectral flame against restorative dawn water. It also aligns with the existing kits: Deuilastre applies Burning, while Aubéastre uses Rosée d’aurore and team healing.

| Move/target type | Into C1 Ténèbres/Feu | Into C2 Psy/Eau | C1 Dark out | C2 Psy out (hypothetical) |
|---|---:|---:|---:|---:|
| Eau | 2 | 1 | 1 | 1 |
| Feu | 1 | 0.5 | 1 | 1 |
| Plante | 0.5 | 2 | 1 | 1 |
| Psy | 0.5 | 1 | 2 | 1 |
| Combat | 2 | 0.5 | 0.5 | 2 |
| Ténèbres | 1 | 2 | 1 | 0.5 |

This is the cleanest dual-type story: each bird has two weaknesses and two resistances, every one follows a visible triangle, and the art briefs already contain inner spectral glow / sunrise blue. It still does not solve the direct pairing: Dark remains ×2 into Psy/Eau, so Plume funeste must become power 22. It also gives both birds vulnerabilities from a triangle their moves do not offensively participate in, increasing scouting complexity without adding new buttons or Combo routes.

#### B4 — balance-first dual proposal, not recommended: C1 Ténèbres/Combat, C2 Psy/Combat

| Move/target type | Into C1 Ténèbres/Combat | Into C2 Psy/Combat | C1 Dark out | C2 Psy out (hypothetical) |
|---|---:|---:|---:|---:|
| Eau | 1 | 1 | 1 | 1 |
| Feu | 1 | 1 | 1 | 1 |
| Plante | 1 | 1 | 1 | 1 |
| Psy | 1 | 2 | 2 | 1 |
| Combat | 2 | 0.5 | 0.5 | 2 |
| Ténèbres | 0.5 | 1 | 1 | 0.5 |

The shared Combat half cancels the direct Dark/Psy advantage: Deuilastre’s Dark move is ×1 into Psy/Combat, and a hypothetical Psy move is ×1 into Ténèbres/Combat. Each has one weakness and one resistance. This is the best pure balance shape, but the worst dual-type fiction: a spectral incarnation of evil and a non-attacking pure support bird do not visually or mechanically read as Combat creatures. A wrong-feeling type chosen to repair arithmetic is a higher intuition cost than an honest unfavorable matchup.

#### Dual-type implementation cost common to B1–B4

- **Data:** retain `affinity` as primary and add optional `secondaryAffinity`. Validate that it exists in the canonical six, differs from primary, and is absent on the other 24 creatures.
- **Engine:** introduce one authoritative helper such as `defensiveMultiplier(moveAffinity, creature)` returning `affinityMultiplier(moveAffinity, creature.affinity) * affinityMultiplier(moveAffinity, creature.secondaryAffinity)` when present. `calculateDamage()`, previews, AI forecasts, Perfect Relay, team scouting, best-lead selection, remix matchup scoring, and any Signature-threat read must use this helper; no caller should hand-roll one or two affinities.
- **AI/profile:** update `scoreSwitch`, `bestLeadIndex`, `teamMatchup`, `creatureMatchup`, and “new affinity” Draft/profile logic. A dual creature contributes both types for diversity/filter copy but only its move types for offensive forecasts.
- **UI:** render two chips in team-select cards, selected/enemy rows, Bestiary, Draft, battle plate details, and switch/relay options. Compact HUD team pips may remain color-neutral if two chips do not fit, but their accessible label must name both. Filtering by either component includes the creature; “all” still counts it once.
- **Academy:** add one short rule with examples of cancellation (`×2 × ×0.5 = ×1`) and stacking (`×2 × ×2 = ×4`) even if these two definitions never produce ×4. Without that explanation, a visible Combat hit doing neutral damage to Ténèbres/Psy looks like a bug.
- **Tests:** exhaustive six-attack-type tables for every dual candidate, ×4/×0.25 helper fixtures, preview/actual parity, AI/switch forecast parity, inclusive filter counts, two-chip accessibility, serialization tolerance, and assurance the 24 original creatures behave exactly as before.
- **Twelve-year-old Pokémon intuition:** medium cost. The multiplication is familiar, but canon Pokémon type tables are richer than these two triangles, so players may import incorrect expectations. B3 has the best visual/kit intuition; B4 proves that mechanically tidy but semantically wrong pairings should be rejected.

### Option C — add a seventh type

#### C1 Ténèbres versus C2 Fée

The poetic case is obvious: Fée beats Ténèbres. The systemic case is poor because the six-type pool has no Poison or Steel analogue that a Pokémon player expects to beat Fée.

The closest canon-feeling partial chart would be:

- Fée attacks Ténèbres ×2 and Combat ×2.
- Ténèbres and Combat attack Fée ×0.5.
- Fée attacks Feu ×0.5 because Pokémon Fire resists Fairy.
- Eau, Feu, Plante, and Psy attack Fée ×1; Eau, Plante, and Psy receive ×1 from Fée.

| Move/target type | Into C1 Ténèbres | Into C2 Fée | C1 Dark out | C2 Fairy out (hypothetical) |
|---|---:|---:|---:|---:|
| Eau | 1 | 1 | 1 | 1 |
| Feu | 1 | 1 | 1 | 0.5 |
| Plante | 1 | 1 | 1 | 1 |
| Psy | 0.5 | 1 | 2 | 1 |
| Combat | 2 | 0.5 | 0.5 | 2 |
| Ténèbres | 1 | 0.5 | 1 | 2 |
| Fée | 2 into C1 | 1 | 0.5 into C2 | 1 |

This gives Aubéastre **no ×2 incoming weakness**. Its 79 HP / 64 Guard still make it physically fragile, but its typing is never punishable and resists the two most relevant second-triangle attackers. Worse, Aubéastre has no damaging move, so the poetic Fairy→Dark advantage exists only in an Academy table and never in its kit.

Creating a weakness requires an arbitrary edge. Making Feu→Fée ×2 would at least pair with Fée→Feu ×0.5, but it is not canon Pokémon behavior, gives Feu a second forward target outside its confirmed triangle, and produces the exact kind of wrong-feeling rule this evaluation should avoid. Choosing Eau, Plante, or Psy as the counter is even less intuitive. Adding an eighth Steel/Poison-like type merely to counter two legendary creatures is outside this item and would dismantle the confirmed two-triangle teaching model.

#### Shared Légendaire/Astral type

If Astral is neutral into and from all six types, the complete table is ×1 in every cell. That avoids wrong edges but creates the no-weakness/no-resistance problem for **both** glass creatures, makes type chips decorative, and removes the most useful scouting lesson from the marquee pair. If Astral gains advantages and weaknesses, every edge is custom knowledge with no Pokémon intuition and either crosses or rewrites the two canonical triangles.

#### Seventh-type implementation and teaching cost

- **Engine/data:** the parallel chart must grow from a closed six-type matrix to seven, validate every one of 49 interactions, and stop assuming two equal triangles. `AFFINITY_ORDER`, colors, sounds, filters, arena/academy diagrams, random composition, and all matchup tests acquire a seventh entry.
- **UI:** add a seventh chip/color/icon across selection, Bestiary, HUD, filters, theater, and Academy. With only one or two users of the type, its filter is sparse and visibly exceptional.
- **Tests:** full 7×7 directed matrix, Academy ordering/copy, seven-type filter counts, AI matchup reads, and explicit no-missing-edge coverage.
- **Twelve-year-old Pokémon intuition:** highest cost. “Fairy beats Dark” is familiar, but the missing Steel/Poison counters immediately invite canon expectations the game cannot satisfy. Astral is entirely new. A familiar label with wrong or missing familiar edges is more confusing than a clearly simplified six-type chart.
- **Teaching:** the Academy can no longer truthfully lead with “two triangles.” It needs a triangle diagram plus exception arrows and a legend explaining why Fée/Astral sits outside them. That is a large permanent copy/layout cost for two creatures.
- **Balance:** Fairy Aubéastre would gain defensive consistency exactly where a fast pure support can become frustrating; neutral Astral would erase intended polar matchup risk. Either requires stat/kit compensation and new simulation cohorts, unlike Option A’s single one-point power adjustment.

### Comparison verdict

| Option | Matchup quality | Balance risk | Engine/UI/test cost | Intuition cost (12-year-old Pokémon player) | Verdict |
|---|---|---|---|---|---|
| A — Ténèbres / Psy singles | Clear canonical counter relationship; cross triangle stays neutral | High direct C1→C2 spike, fixed by Plume 23→22 | **Low** | **Low** | Best overall |
| B1 — Ténèbres/Psy + Psy/Feu | Solar flavor, but Combat cancellation obscures Dark’s counter | Still Dark ×2 into C2; new Water weakness | High | Medium | Interesting, not worth exception cost |
| B2 — shared Ténèbres/Psy pair | Excellent “same coin” lore, identical defenses | Both weak to Dark; direct mismatch remains | High | Medium-high | Fiction stronger than gameplay |
| B3 — Ténèbres/Feu + Psy/Eau | Best thematic dual pair; two weaknesses/two resists each | Direct mismatch remains; more polar axes | High | Medium | Best B option, still below A |
| B4 — shared Combat secondary | Direct matchup becomes neutral | Clean arithmetic | High | **High because types feel wrong** | Reject |
| C — Fée or Astral | Poetic label or perfect neutrality | No canonical weakness; support risks consistency/stall | Very high permanent cost | **Very high** | Reject |

### Recommendation — lock Option A

Use **single-type Deuilastre (`shadow` / Ténèbres) and single-type Aubéastre (`mind` / Psy)**. It preserves the confirmed two-triangle lesson, matches familiar Psychic/Fighting/Dark intuition, keeps every roster creature on one schema, and lets the pair’s moral mirror live in names, lore, art, talents, and opposite kits instead of type-chart exceptions.

This addendum supersedes exactly one earlier numeric choice: set **Plume funeste / `dire_pinion` to power 22 instead of 23** to prevent its priority, zero-cooldown ×2 hit from one-shotting full-health Aubéastre. Keep every other stat, move, talent, Signature mechanic, and both PixelLab briefs unchanged.

Exact implementation consequences:

1. In `src/data/creatures.js`, use the already planned `affinity: 'shadow'` and `affinity: 'mind'`; do not add `secondaryAffinity`.
2. In `src/data/moves.js`, use the planned single move affinities and change only `dire_pinion.power` from 23 to 22.
3. Consume the parallel executor’s canonical two-triangle `affinityMultiplier()` everywhere; no dual-defense helper or seventh-type branch belongs to this item.
4. Keep the existing one-chip UI on team selection, Bestiary, Draft, battle details, and switch/relay cards. The parallel localization displays Ténèbres/Psy automatically from the internal ids.
5. Keep Academy structure at six types / two triangles; add no legendary exception copy. Update only the general 26-creature / 78-move counts already listed in this plan.
6. Add regression tests for all six incoming multipliers in the Option A table, cross-triangle neutrality, Deuilastre’s Dark outgoing row, Aubéastre’s Psy defensive row, and exact full-health Plume damage of 77 against Aubéastre.
7. In balance reporting, retain targeted Deuilastre–Aubéastre and Deuilastre-versus-all-Psy cohorts so future Attack/power changes cannot silently restore the regular-move one-shot.
