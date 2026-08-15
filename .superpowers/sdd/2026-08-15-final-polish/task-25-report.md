Status: Complete.

Commit SHAs: 7950bbe (polish: add battle dialog semantics implementation); 7210b2c (polish: restore focus after voluntary switch); 203b9ef (polish: dialog fix round 2); round-three Escape fix pending commit.

Test summary: `npm test` (105 passed); `npx playwright test e2e/gameplay.spec.js` (29 passed); `npx playwright test e2e/battle-layout.spec.js` (1 passed), all against served 8179 build; Escape now closes Codex, Battle Log, plate details, and voluntary switch while preserving forced-replacement gating and opener focus; English `?lang=en` switch cards show HP (not PV); screenshots saved under `agents/task25-*.webp`.

Concerns: The seeded walkthrough did not naturally produce a hidden-status `+N` chip, so that exact visual click was not observed manually; the simple-mode overflow path is wired to `openPlateDetails(side)` with localized hidden-status naming and covered by the presentation contract test.