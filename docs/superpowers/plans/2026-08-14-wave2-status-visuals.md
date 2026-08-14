# Arène de Noam — Wave 2 Item B: status-effect visual identity

> Planning baseline: repository inspected on 2026-08-14 after “Édition claire.” This is a presentation-only wave for the existing eight statuses. Preserve every status mechanic, duration, stack rule, cleanse order, save shape, and localized effect sentence.

**Goal:** make all eight statuses nameable by a 12-year-old at a glance, even when color is unavailable, and make “helps me” versus “hurts me” obvious on every status-bearing surface.

**Implementation size:** one short Sol session. The work is centralized metadata/rendering plus CSS and focused assertions; no new image assets, canvas system, animation scheduler, or gameplay data are needed.

## 1. Locked visual identity

### 1.1 Rendering format: standardized inline SVG, not font glyphs

Use eight tiny, monochrome inline SVGs. The current status strings are inserted into trusted `innerHTML` on every icon-bearing surface, so SVG is supported without an asset request or network fetch. SVG also avoids platform/font differences in `◎`, `»`, `◇`, `↶`, `⌖`, `★`, `♧`, and `♨`, and remains crisp at the current 20 px plate size and 38 px orbit size.

In `src/battle/statuses.js`, keep `positive` and all mechanical fields intact, replace `icon` with a unique semantic `iconKey`, and export a small `statusIcon(id)` renderer. It returns one decorative `<svg class="status-icon status-icon-${iconKey}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">…</svg>` using `fill="none"`, `stroke="currentColor"`, `stroke-width="2.2"`, round caps, and round joins. Where an icon includes a solid eye/star, use `fill="currentColor"`. The surrounding control/card retains the localized visible name, `title`, or `aria-label`; never ask the SVG itself to carry the accessible name.

The exact eight motifs are locked as follows. Their silhouettes must remain recognizable at 16 px:

| id | FR name | Polarity | New color | Exact SVG motif | One-line rationale |
|---|---|---:|---:|---|---|
| `focused` | Concentré | buff | `#1DA1F2` | **Eye:** almond eye outline plus one solid round pupil | “Je regarde bien” is more immediate than a second target symbol; sky blue reads as clear attention. |
| `haste` | Accéléré | buff | `#C6FF00` | **Wing:** one swept feather/wing silhouette with two horizontal speed cuts | A child can call it a wing or speed mark; electric lime is the fastest-looking hue. |
| `evasive` | Insaisissable | buff | `#7A5CFA` | **Ghost:** rounded ghost hood, two eyes, and a three-notch floating hem | The disappearing ghost directly says “you cannot catch me”; deep violet separates it from Focus. |
| `countering` | Riposte | buff | `#00E0A4` | **Shield-arrow:** shield outline with a short arrow turning outward at its upper-right | Shield plus return arrow says “the hit comes back”; mint is defensive without borrowing barrier cyan. |
| `marked` | Marqué | debuff | `#FF5CC8` | **Target-lock X:** four open corner brackets surrounding a large diagonal X | It is visibly a locked target but cannot be confused with the Eye; hot pink reads as exposed/danger. |
| `rooted` | Enraciné | debuff | `#9C5B32` | **Roots:** short trunk splitting into three hooked ground roots | This is literal earth/roots rather than the current club-like `♧`; brown is uniquely grounded. |
| `stunned` | Sonné | debuff | `#FFEA70` | **Dizzy stars:** one large four-point star with two smaller orbiting stars | Children already read circling stars as dazed; pale yellow is reserved for this effect alone. |
| `burning` | Brûlure | debuff | `#F4511E` | **Flame:** teardrop flame outline with one inner flame tongue | A literal flame is immediate; vermilion is hotter and darker than Sonné and Rooted. |

Use `#07091D` as the icon ink when a surface fills the whole icon plate with the status hue; use white for Rooted’s filled plate. Evasive is acceptable with dark ink at icon scale (4.45:1, comfortably above the 3:1 non-text threshold). On dark/translucent surfaces, use the hue as `currentColor` and keep the background near-black.

Do not convert unrelated uses of the legacy characters—rank stars, arena/trait icons, badges, or affinity diamonds. Do replace the two status-specific hard-coded glyphs: Focused’s `◎` in `tacticalFx()` and Marked’s `⌖` in `comboRoutesHtml()`.

### 1.2 Deuteranopia verification

The palette was checked by converting sRGB to linear RGB, applying the Machado full-deuteranopia matrix, converting the result to CIELAB, and measuring every pair with ΔE76. Lock an acceptance floor of **ΔE76 ≥ 20** for this palette. All 28 pairs pass; the minimum is **23.7** (`haste`/`stunned`). This is a design-time guard, not a claim that color alone is sufficient—the unique pictogram and polarity shape are mandatory redundant channels.

Simulated full-deuteranopia colors: Focused `#5D91F0`, Haste `#FFEB36`, Evasive `#0073F7`, Riposte `#C5BFA8`, Marked `#9BA6C4`, Rooted `#7D7132`, Sonné `#FFEC76`, Brûlure `#AA9711`.

| ΔE76 | Focused | Haste | Evasive | Riposte | Marked | Rooted | Sonné | Brûlure |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Focused | — | 140.8 | 25.6 | 68.5 | 37.9 | 91.4 | 118.0 | 117.6 |
| Haste |  | — | 164.5 | 72.4 | 103.1 | 64.7 | **23.7** | 35.8 |
| Evasive |  |  | — | 92.7 | 62.4 | 112.6 | 142.1 | 140.0 |
| Riposte |  |  |  | — | 30.7 | 38.2 | 49.7 | 53.5 |
| Marked |  |  |  |  | — | 57.2 | 80.4 | 80.9 |
| Rooted |  |  |  |  |  | — | 51.0 | 31.0 |
| Sonné |  |  |  |  |  |  | — | 31.1 |
| Brûlure |  |  |  |  |  |  |  | — |

Add a unit guard for valid/unique hex values and unique `iconKey`s. Do not add the color-science implementation to production; document the calculation here and rely on exact palette assertions to prevent silent drift.

## 2. Polarity is a shape, not a color

Keep `positive` as the single semantic source and derive `positive`/`negative` classes in every renderer.

- **Buff / Avantage:** rounded token or rounded icon plate, lighter translucent fill, solid border, and a tiny **upward triangle** badge at the upper-right. Large rows/cards also carry the visible word `▲ AVANTAGE` (localized through two new i18n keys).
- **Debuff / Malus:** angular/chamfered token or icon plate, visibly darker fill, inset border, and a tiny **downward triangle** badge at the lower-right. Large rows/cards carry `▼ MALUS`.
- The triangle is a pseudo-element or adjacent decorative span and must not replace the icon or status name. At the 20 px plate/orbit sizes, show the triangle notch without text; at detail/Academy/Codex sizes, show the localized polarity label.
- High contrast keeps the same geometry, uses solid cyan/white for buffs and dashed pink/white for debuffs, and never removes the up/down marker.
- Barrier remains its own hexagonal positive resource. It does not enter the eight-status palette and should not receive a status polarity badge.

Introduce a presentation-only `STATUS_DISPLAY_ORDER = ['focused', 'haste', 'evasive', 'countering', 'marked', 'rooted', 'stunned', 'burning']`. Sort visual lists with it so the same status always occupies the same mental slot. Do **not** reorder `STATUS_DEFINITIONS` or derive cleanse priority from this display constant: the current mechanical `NEGATIVE_STATUSES` order must not change.

## 3. Current source of truth and complete consumer map

Colors and glyphs currently live in `STATUS_DEFINITIONS` at `src/battle/statuses.js:1-10`; consumers pass `meta.color` through `--status-color`, while several CSS blocks choose the final tint/background. Implement the following map completely.

| File / render path | What it does today | Required Wave 2 change |
|---|---|---|
| `src/battle/statuses.js` | Owns `positive`, text `icon`, and `color`. | Install the exact palette and `iconKey`s above; export `statusIcon()` and `STATUS_DISPLAY_ORDER`; leave mechanics unchanged. |
| `src/app/context.js` — `statusVisuals()` | Builds fighter orbits with `meta.icon`/`meta.color`; barrier is prepended. | Sort statuses by display order, render SVG, and add polarity class/data. Keep barrier first. |
| `src/app/context.js` — `comboRoutesHtml()` | Hard-codes Marked as `⌖ → COMBO`. | Render the Marked SVG/color token through the same helper; keep `COMBO +40%` text. |
| `src/battle-ui/hud.js` — `hudHtml()` | Builds 20 px plate chips and hidden text; visible limit is 4 expert / 2 simple. | Carry `positive`, sort by display order, render SVG, and add polarity class. Do not change limits or barrier ordering. |
| `src/battle-ui/hud.js` — `hudDetailHtml()` | Builds expert and compact status rows; polarity classes already exist. | Replace glyph with SVG, add the polarity marker/label, and preserve localized effect, stack, duration, and helper copy. |
| `src/battle-ui/hud.js` — move context | Renders localized move effect as plain text. | Append structured status badges from move data; do not parse translated prose. Include produced statuses plus `comboSetupStatus(move)` for Combo requirements, de-duplicated in display order. |
| `src/battle-ui/controller.js` — battle Codex | Builds active-status rows from the registry but lacks polarity classes. | Use SVG, color, stable order, and the large-row polarity treatment. |
| `src/battle-ui/controller.js` — switch panel | Joins bare glyphs into the passive `<small>` in expert mode, so they have neither color nor names. | Replace with a `.switch-statuses` cluster of colored/polarized mini tokens, each titled with its localized name; add one visually hidden joined-name string for screen readers. Preserve simple-mode status omission. |
| `src/screens/academy.js` | Maps all definitions into one grid; `.boon`/`.penalty` exist but are only CSS classes. | Render explicit Avantages and Malus groups, SVGs, labels, and the layout in section 4. |
| `src/screens/bestiary.js` — move list and theater | Effect descriptions are plain strings; the theater sends only the first self-status to generic FX. | Append the same structured status badges to move rows and theater heading. Pass the actual first displayed status to existing `tacticalFx`; do not animate every listed status sequentially. |
| `src/battle-ui/fx.js` — `tacticalFx()` | Focused is hard-coded yellow/`◎`; every other status falls back to cyan/hexagon. | Resolve `STATUS_DEFINITIONS[event.status]`, set `--fx-color` to its hue, render its SVG in `.fx-core`, and add positive/negative/application/removal classes. Heal/barrier paths remain unchanged. |
| `src/battle-ui/fx.js` — `statusTickFx()` | Already resolves the registry hue; currently used for Burning tick and Countering recoil. | Keep the existing particles/burst plumbing, add the SVG behind/beside the number, and preserve the exact status hue. |
| `src/battle-ui/playback.js` | Routes status application/removal through `tacticalFx()`, Burning tick and Riposte recoil through `statusTickFx()`. | No new event or timer; ensure the existing `event.status` reaches the updated functions unchanged. |
| `styles/screens/progression.css` | Owns generic status orbits plus special Burning/Rooted/Stunned shapes; contains dead `.status-poisoned`. | Add shared SVG sizing/polarity geometry, retain useful Rooted/Stunned silhouette motion only if it does not compete with the icon, replace Burning motion per section 5, and remove dead Poisoned CSS. |
| `styles/screens/battle-layout.css` | Owns compact plate chips and detail rows. | Apply the same SVG sizes, buff/debuff geometry, markers, and overflow-safe sizing at all current breakpoints. |
| `styles/screens/battle-presentation.css` | Owns Codex rows, switch cards, orbit keyframes, and status-tick curtain. | Style Codex polarity and the new switch token cluster; keep status tokens within current card height. |
| `styles/overrides/academy.css` | Owns Academy status grid/card visuals. | Implement the two-group card treatment below. |
| `styles/screens/bestiary.css` and `styles/screens/accessibility.css` | Own move list/theater and high-contrast behavior. | Style compact inline status badges and make SVG/polarity markers survive high contrast, focus, and mobile theater layout. |
| `styles/screens/battle-fx.css` | Owns tactical/status FX and reduced-motion suppression. | Let status application core inherit `--fx-color`, size SVG correctly, add Burning pulse, and extend both reduced-motion branches. |

Add a tiny shared HTML helper beside `statusIcon()` (or in `src/app/context.js` if keeping `statuses.js` mechanics-only) for `statusBadgeHtml(id, { label, compact })`. Reuse it in move descriptions, combo route, and switch panel so no renderer rebuilds SVG/polarity markup by hand. It must escape/localize the visible label at the caller boundary and must never accept arbitrary icon markup.

## 4. Academy lexicon redesign

Inside lesson 7, replace the single undifferentiated grid with two semantic groups in this exact order:

1. `▲ Avantages`: Concentré, Accéléré, Insaisissable, Riposte.
2. `▼ Malus`: Marqué, Enraciné, Sonné, Brûlure.

Each `.academy-status` card uses a 52 × 52 px icon plate on desktop (44 × 44 px at 320 px), a 4 px hue-colored left edge, the localized polarity kicker, name, current short effect sentence, and existing `×2` stack badge for Brûlure. Buff cards retain rounded corners and a lighter wash; debuff cards use chamfered/icon angular treatment and a darker wash. The icon is at least 28 px inside the plate. Keep four cards per group on wide screens, two columns on tablet/mobile, and one column only if 320 px text clips. Do not truncate the name or effect.

Use `STATUS_DISPLAY_ORDER`, not object insertion order, for this and every other status list. The Academy is the canonical visual legend: if a small battle token is ambiguous, the same icon/hue/polarity shape here must teach it without a second symbol system.

## 5. Motion identity using existing FX plumbing only

- **Orbit:** every `status-orb` already receives `--status-color`; keep the generic gentle float and make border/glow/icon inherit the exact registry hue. Do not add per-status JavaScript.
- **Application/removal:** `playback.js` already routes all status events to `tacticalFx()`. Replace the hard-coded Focus/cyan branch with registry lookup so all eight application bursts, particles, arena burst calls, and SVG cores use the status hue. Removal reuses the same FX with a `status-remove` class for a short inward/fade treatment if CSS alone can express it.
- **Tick/recoil:** `statusTickFx()` already gets registry color. Add the corresponding icon to the existing core; keep number and particle timing unchanged.
- **Brûlure cheap win:** give only `.status-burning` a 650–750 ms ember pulse that alternates scale (1 → 1.12), glow intensity, and slight upward drift. Its application/tick core gets the same one-shot pulse. This replaces, rather than stacks with, the current `statusFlame` loop.
- **Reduced motion:** under both `@media (prefers-reduced-motion: reduce)` and `body.reduced-motion`, set status orbit and Burning animations to `none`, hide status FX particles as today, and leave a static colored SVG/core for recognition. Add no flashing, rotation loop, new timeout, or Three.js effect.

## 6. Assertions and verification

### Unit assertions that touch icon/color metadata

Current tests do **not** assert any exact status glyph or color. Preserve their mechanical scope and add the following focused checks:

- `test/data-ai.test.js`, alongside “move status data uses exactly the eight-status contract”: assert an exact metadata table of `{ id, positive, color, iconKey }`, eight unique colors, eight unique icon keys, valid six-digit uppercase hex values, and unchanged four/four polarity counts. Keep the existing exact status-id order assertion as-is so visual work cannot alter mechanics accidentally.
- If `statusIcon()` is exported from `statuses.js`, assert for every id that it returns one `<svg>`, includes the matching `status-icon-${iconKey}`, `aria-hidden="true"`, and no emoji/surrogate-pair character. Do not snapshot full SVG path strings; `iconKey` plus visual review is the stable contract.
- Keep `test/i18n-save.test.js`’s existing eight-label/effect coverage and add only the two polarity label keys in both dictionaries if visible `Avantage`/`Malus` copy is introduced.

### E2E assertions affected or added

- `e2e/progression-responsive.spec.js` currently asserts 8 Academy cards, 4 `.boon`, 4 `.penalty`, Brûlure `×2`, and Marqué Combo copy. Preserve those assertions; add exact Avantages/Malus group order, one SVG per card, eight unique computed `--status-color` values, unique `data-icon`, and the explicit `[data-status]` sequence.
- `e2e/gameplay.spec.js` currently locates Marqué, Accéléré, and Sonné by visible French text. Preserve those text checks. On their existing deterministic applications, also assert the relevant plate token has the expected `data-status`, polarity class, SVG, and CSS variable; assert `.tactical-marked`, `.tactical-haste`, or `.tactical-stunned` uses the same `--fx-color` while visible.
- `e2e/simple-mode.spec.js` currently verifies Marqué in `.plate-detail-status`. Add negative geometry/data, Marked SVG, and exact hue; keep the current absence of effect `<small>` in simple mode.
- `e2e/battle-layout.spec.js` currently checks non-overlap at 320×568, 390×844, 768×1024, and 1440×900. Exercise at least two visible status tokens before measuring, then assert SVGs remain within chip bounds and plate/status rows do not overflow. Do not replace its existing geometry checks.
- `e2e/smoke.spec.js` and the switch recommendation tests currently assert switch text/recommendation only. Add one expert-mode fixture with a benched creature carrying statuses, then assert `.switch-statuses` exposes colored SVG tokens and an accessible joined-name label without changing HP localization.
- Bestiary theater coverage in `e2e/progression-responsive.spec.js`: for a move that applies a status and a Combo finisher, assert the move row/theater shows the structured badge with the expected icon/color/name while the original translated effect remains plain readable text.

No E2E should assert legacy characters (`◎`, `»`, `◇`, `↶`, `⌖`, `★`, `♧`, `♨`) as status identity. Text-name assertions remain valuable because they protect accessibility and localization.

### Orchestrator screenshot pass

After automated checks, capture and compare the following at 320×568, 390×844, 768×1024, and 1440×900:

- Academy lesson 7 in French: both groups, exact order, large recognizable icons, no clipped effects, Brûlure `×2`, and unmistakable rounded-up versus angular-down polarity.
- The same Academy view under browser deuteranopia emulation: identify all eight by icon and verify no adjacent pair visually merges; pay special attention to Haste/Sonné, Focus/Evasive, and Rooted/Brûlure.
- Expert battle with two or more simultaneous statuses on each fighter: plate chips, orbits, overflow count, expanded plate details, and active-status Codex all use the same icon/hue/polarity.
- Simple mode with Marqué: the two-token cap, expanded compact detail, and hidden full effects remain intact.
- Expert switch panel with a status-bearing bench: tokens fit the card, are colored, and remain subordinate to HP/matchup/recommendation.
- Bestiary move list and theater for one status-applying move and one Combo consumer: badges support rather than replace the French description.
- Status application FX for one buff and one debuff plus a Brûlure tick: matching hue/icon, no old yellow/cyan fallback, no obscured damage number.
- Repeat the battle/Academy captures with high contrast, then with reduced motion. High contrast must retain polarity geometry; reduced motion must show static icons with no orbit/Burning loop or hidden meaning.

## 7. One-session execution checklist

1. **Registry first:** update `STATUS_DEFINITIONS`, add `STATUS_DISPLAY_ORDER`, `statusIcon()`, and the shared badge helper; add exact metadata assertions. Do not change status object order, mechanics, or effect copy.
2. **Static consumers:** migrate orbit, plate chips/details, Codex, switch panel, Combo route, move context, Bestiary, and theater. Search for all eight legacy status glyphs afterward and classify remaining hits as unrelated iconography.
3. **Polarity/layout:** add shared SVG sizing and positive/negative motifs, then rebuild Academy into its two ordered groups. Cover desktop, mobile, high contrast, and overflow in CSS without adding an asset.
4. **Existing FX only:** make `tacticalFx()` registry-driven, add SVG to `statusTickFx()`, and implement the Burning CSS pulse plus both reduced-motion overrides. Leave playback events/timing and arena APIs unchanged.
5. **Focused verification:** update the enumerated unit/E2E assertions, run the status/data unit files and the affected Playwright specs, then run the full existing suite if focused checks pass.
6. **Orchestrator visual gate:** perform the screenshot checklist, including deuteranopia/high-contrast/reduced-motion passes; fix clipping or ambiguity before handoff.

### Done means

- A child can describe each icon as eye, wing, ghost, shield-arrow, boxed X, roots, dizzy stars, or flame without reading the label.
- Buff/debuff polarity remains obvious in grayscale and under deuteranopia.
- Every status surface uses the exact same registry hue/icon and stable display order.
- No application FX falls back to generic cyan or old yellow Focus; Brûlure alone has the distinct pulse, and reduced motion is static.
- All eight gameplay mechanics, names, durations, stacks, cleanse behavior, and save data remain untouched.
