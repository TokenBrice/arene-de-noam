Status: Complete.

Commit SHAs: e4da26a (polish: add battle dialog semantics).

Test summary: `npm test` (105 passed); `npx playwright test e2e/battle-layout.spec.js` (1 passed); served-build accessibility smoke verified replacement dialog role/modal/labelledby, tab trap, Escape focus restoration, speed label refresh, and 375px two-line arena rule; screenshots saved under `agents/task25-*.webp`.

Concerns: The seeded walkthrough did not naturally produce a hidden-status `+N` chip, so that exact visual click was not observed manually; the simple-mode overflow path is wired to `openPlateDetails(side)` with localized hidden-status naming and covered by the presentation contract test.