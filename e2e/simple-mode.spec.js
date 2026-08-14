import { test, expect } from '@playwright/test';

async function installPreExpertSave(page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('arene-de-noam-save')) return;
    localStorage.setItem(
      'arene-de-noam-save',
      JSON.stringify({
        version: 13,
        tutorialComplete: true,
        lastTeam: ['orakyn', 'abyssar', 'virelia'],
        language: 'fr',
        muted: true,
        reducedMotion: true,
        battleSpeed: 2,
      })
    );
  });
}

test('simple mode shows the matchup essentials and the settings toggle restores expert depth', async ({
  page,
}) => {
  await installPreExpertSave(page);
  await page.goto('/?seed=14&animations=0&player=orakyn,abyssar,virelia&enemy=kordane,calderoc,farfombre');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();

  await expect(page.locator('.battle-screen')).toHaveClass(/simple-mode/);
  await expect(page.locator('[data-move="lucid_arc"] .move-effectiveness.effective')).toContainText('▲');
  await expect(page.locator('[data-move] .move-archetype')).toHaveCount(0);
  await expect(page.locator('[data-move] .move-assist-badge')).toHaveCount(0);
  await expect(page.locator('[data-move] .combo-ready:visible')).toHaveCount(0);
  await expect(page.locator('.arena-resonance')).toHaveCount(0);
  await expect(page.locator('#contract-chip')).toHaveCount(0);

  await page.locator('[data-move="lucid_arc"]').click();
  await expect(page.locator('[data-move="slowing_riddle"]')).toBeEnabled();
  await page.locator('[data-move="slowing_riddle"]').click();
  await expect(page.locator('#hud-player .flow-chip')).toHaveCount(0);

  await page.goto('/');
  await page.getByRole('button', { name: /Réglages/ }).click();
  await page.locator('#expert-mode').check();
  await expect(page.locator('#expert-mode')).toBeChecked();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('arene-de-noam-save')).expertMode))
    .toBe(true);

  await page.goto('/?seed=14&animations=0&player=orakyn,abyssar,virelia&enemy=kordane,calderoc,farfombre');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(page.locator('.battle-screen')).toHaveClass(/expert-mode/);
  await expect(page.locator('[data-move] .move-archetype').first()).toBeVisible();
  await expect(page.locator('.arena-resonance')).toBeVisible();
  await expect(page.locator('#contract-chip')).toBeVisible();
});
