# Task 21 — Settings polish

## Status
Complete. Commits:
- `e51fc90` (`polish: return settings to origin and refine sliders`)
- `9c6c29f` (`polish: restore generic title action alongside settings origin`)

## Implemented
- Shared topbar settings binding records the invoking `screen.dataset.page` in `ctx.settingsReturn` and retains the battle session when entering from results.
- Settings back action uses origin-aware routing for title, team selection, bestiary, academy, league, trials, draft, gauntlet boon, and results, with title fallback. Team selection returns through the existing `ctx.selection` and preserves the selected roster.
- Generic `[data-action="title"]` binding remains installed for every shared screen, including results and battle rendering-error cards; origin routing is scoped to the settings screen so it cannot shadow those existing controls.
- Volume controls now render as real styled range sliders with token-based tracks/thumbs, checkbox-only 24px sizing, minimum 140px range sizing, and responsive wrapping.
- Music and SFX sliders include live `<output>` percentage readouts and matching `aria-valuetext`; `input` updates do not rerender the screen.
- Settings grid aligns cards to the start edge so the help card no longer stretches to match the settings card.

## Verification
- Served app on port 8182 (French and English): title → settings → title; quick team selection → settings → team selection with the same six selected creature images; slider updates from 45% to 70% updated the output and `aria-valuetext` immediately.
- Served quick battle completed to results; results `Back` (`data-action="title"`) returned to title successfully.
- At 320px viewport: `document.documentElement.scrollWidth === clientWidth === 320`; both sliders remained 180px wide with `min-inline-size: 140px` and readouts visible.
- Desktop and mobile screenshots captured:
  - `agents/polish-audit/after/settings-desktop-fr.webp`
  - `agents/polish-audit/after/settings-mobile-fr.webp`
  - `agents/polish-audit/after/settings-desktop-en.webp`
- `node --test test/i18n-save.test.js`: 17 passed.
- `npm test`: 104 passed after the generic title fix.

## Concerns
- Playwright/e2e was not run per the track constraint; served-browser smoke checks covered the requested settings and results paths instead.
- `node_modules/` remains pre-existing untracked workspace content and was not committed; screenshots remain under gitignored `agents/`.
 
---
 
# Task 22 — Navigation hygiene
 
## Status
Complete. Commits:
- `b7ec31a` (`polish: preserve navigation focus`)
- `1f67475` (`polish: nav hygiene fix round 1`)
 
## Implemented
- Route transitions now reset the scroll container and focus the rendered `h1` on page changes, while same-page rerenders preserve scroll.
- Added `rerenderPreservingFocus` and stable focus keys across team selection controls, draft picks/leads, gauntlet leads, and settings toggles.
- Existing creature-card/filter focus restoration and Task 21 settings-origin routing remain intact.
 
## Verification
- `npm test`: 104 passed.
- Served on port 8182: focused difficulty control remained focused after changing it; title → scrolled bestiary landed at scroll top with the heading focused; settings language toggle retained focus.
- Focused Playwright navigation test: passed.
- Draft/gauntlet Playwright regression checks: 2 passed.
- Settings smoke Playwright check: passed.
 
## Concerns
- Full `e2e/progression-responsive.spec.js` still has two unrelated pre-existing failures: academy copy expects `+40 %`, and the mythic-trials action times out.
- `node_modules/` remains pre-existing untracked workspace content and was not committed; temporary Playwright config remains under gitignored `agents/`.

## Review fixes
- Cold boot no longer programmatically focuses the first title heading or runs page-reset behavior.
- Clearing a filled custom squad slot explicitly focuses the replacement save control.
- The final draft pick hands focus to the corresponding lead button.
- Review-fix browser checks: 4 passed on port 8182; `npm test`: 104 passed.

---

# Task 27 — High-contrast + visual details

## Status
Complete. Commit:
- `23e5f10` (`polish: add high-contrast and responsive visual details`)

## Implemented
- Added opaque, two-pixel high-contrast surfaces for feat, record, rival, draft, boon, and academy panels; removed the decorative screen pattern in high contrast.
- Disabled battle moves retain full contrast with a dashed border and `▦` corner marker; locked feats keep text fully opaque, desaturate only the icon artwork, and show a lock glyph.
- Fallen result sprites now use `grayscale(.45) brightness(.8)` while retaining their identity.
- Localized the battle last-stand badge through `data-last-label` and `battle.lastBadge` (`DERNIÈRE` / `LAST`); title records now show translated trial and gauntlet labels.
- Removed the compact draft combo heading when no route content is rendered, tightened title roster-fan reserved height to 140px, sized trial squad portrait chips to 44px, and added a mobile squad-rail mask fade with proximity snapping.
- Added presentation-contract coverage for the high-contrast and responsive details.

## Verification
- `npm test`: 109 passed.
- `node --test test/presentation-contract.test.js`: 5 passed.
- Served browser checks on port 8182: French and English title, title records, bestiary (including locked feat glyph), team selection (375px squad rail), battle (375px disabled move cues and localized last badge), and results (375px defeat sprite state); high contrast toggled on and off.
- Screenshots captured under `agents/polish-audit/after/`:
  - `t27-title-fr-375-hc.webp`
  - `t27-title-fr-1440-hc.webp`
  - `t27-title-en-1440-hc.webp`
  - `t27-bestiary-fr-375-hc.webp`
  - `t27-selection-fr-375-hc.webp`
  - `t27-battle-fr-375-hc.webp`
  - `t27-results-fr-375-hc.webp`

## Concerns
- Playwright/e2e was not run per the track constraint; served-browser smoke checks covered the requested routes and breakpoints.
- `node_modules/` remains pre-existing untracked workspace content and was not committed; screenshots remain under gitignored `agents/`.

## Review fixes
- Corrected the high-contrast academy surface contract to target the rendered `.academy-section`, `.academy-core`, and `.academy-type-triangle` panels.
- Restored locked league rivals to full opacity and saturation with a dashed high-contrast border and lock cue; enemy last-stand badges remain readable instead of mirrored.
- Added served HC screenshots covering league, academy, draft, boon, trials, expanded records/feats, and an active localized last-stand badge.
- Review-fix verification: `npm test` 109 passed; `node --test test/presentation-contract.test.js` 5 passed.
