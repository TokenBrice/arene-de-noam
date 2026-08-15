Status: Complete.

Commit SHAs: 7950bbe (polish: add battle dialog semantics implementation); 7210b2c (polish: restore focus after voluntary switch); round-two fix pending commit.

Test summary: `npm test` (105 passed); `npx playwright test e2e/battle-layout.spec.js` (1 passed against served 8179 build); served-build accessibility smoke verified replacement dialog role/modal/labelledby, tab trap, Escape focus restoration, voluntary switch returning focus to the switch opener after playback, speed label refresh, English `?lang=en` switch cards showing HP (not PV), and 375px two-line arena rule; screenshots saved under `agents/task25-*.webp`.

Concerns: The seeded walkthrough did not naturally produce a hidden-status `+N` chip, so that exact visual click was not observed manually; the simple-mode overflow path is wired to `openPlateDetails(side)` with localized hidden-status naming and covered by the presentation contract test.