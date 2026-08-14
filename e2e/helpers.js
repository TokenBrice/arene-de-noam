import { expect } from '@playwright/test';

export function watchRuntime(page) {
  const errors = [];
  const privateRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/pixellab|api[_-]?key|\.dev\.vars/i.test(request.url())) privateRequests.push(request.url());
  });
  return { errors, privateRequests };
}

export async function installCompletedTutorial(page, extra = {}) {
  await page.addInitScript(
    ({ extra }) => {
      if (!localStorage.getItem('arene-de-noam-save'))
        localStorage.setItem(
          'arene-de-noam-save',
          JSON.stringify({
            version: 15,
            tutorialComplete: true,
            ladderVictories: 0,
            emblems: [],
            cosmetics: ['crystal'],
            mastery: {},
            records: {},
            customSquads: [null, null, null],
            feats: [],
            trials: [],
            gauntletWins: 0,
            draftWins: 0,
            circuitWins: 0,
            contractsCompleted: 0,
            bestGrade: null,
            battlesPlayed: 0,
            wins: 0,
            winStreak: 0,
            bestStreak: 0,
            lastTeam: ['orakyn', 'abyssar', 'virelia'],
            difficulty: 'apprentice',
            language: 'fr',
            muted: true,
            volume: 0.7,
            reducedMotion: true,
            highContrast: false,
            expertMode: true,
            battleSpeed: 2,
            ...extra,
          })
        );
    },
    { extra }
  );
}

export async function playVisibleBattle(page, { untilSelection = false } = {}) {
  for (let turn = 0; turn < 300; turn++) {
    if (
      untilSelection &&
      (await page
        .getByRole('heading', { name: /Compose ton équipe|Build your team/ })
        .isVisible()
        .catch(() => false))
    )
      return;
    if (
      await page
        .getByRole('heading', { name: /Victoire|Victory|Belle bataille|Good battle/ })
        .isVisible()
        .catch(() => false)
    )
      return;
    if (await page.locator('[data-boon]:visible').count()) return;
    const replacement = page.locator('[data-switch-index]:visible').first();
    if (await replacement.count()) {
      await replacement.click({ timeout: 300 }).catch(() => {});
      await page.waitForTimeout(20);
      continue;
    }
    const move = page.locator('[data-move]:visible:enabled').first();
    if (await move.count()) {
      await move.click({ timeout: 300 }).catch(() => {});
      await page.waitForTimeout(20);
      continue;
    }
    await page.waitForTimeout(20);
  }
  throw new Error('Battle did not finish within the deterministic turn budget');
}

export async function expectNoRuntimeLeaks(runtime) {
  expect(runtime.errors).toEqual([]);
  expect(runtime.privateRequests).toEqual([]);
}
