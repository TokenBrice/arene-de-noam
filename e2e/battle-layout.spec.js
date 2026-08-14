import { test, expect } from '@playwright/test';
import { installCompletedTutorial } from './helpers.js';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test('battle plates and command dock never enter the stage at required viewports', async ({ page }) => {
  await installCompletedTutorial(page);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto('/?seed=40&animations=0');
    await page.getByRole('button', { name: /Combat rapide|Quick Battle/ }).click();
    const ensurePlanOpen = async (target) => {
      if (await target.isVisible().catch(() => false)) return;
      const plan = page.locator('details.battle-plan > summary').first();
      await plan.scrollIntoViewIfNeeded();
      await plan.click();
    };
    const ruleSelect = page.getByLabel(/Règle du duel|Duel rule/);
    await ensurePlanOpen(ruleSelect);
    await ruleSelect.selectOption('fortress_duel');
    const doctrine = page.locator('[data-doctrine="assault"]');
    await ensurePlanOpen(doctrine);
    await doctrine.click();
    await page.getByRole('button', { name: /Entrer dans|Enter the/ }).click();

    await expect(page.locator('.battle-stage')).toBeVisible();
    await expect(page.locator('.intent-read')).toBeVisible();
    await expect(page.locator('#hud-player')).toContainText(/Barrière|Barrier/);
    await expect(page.locator('#hud-player')).toContainText(/Exposé|Exposed/);
    await expect(page.locator('#hud-enemy')).toContainText(/Barrière|Barrier/);

    const stage = await page.locator('.battle-stage').boundingBox();
    const dock = await page.locator('.battle-command-dock').boundingBox();
    const plates = await Promise.all([
      page.locator('#hud-player').boundingBox(),
      page.locator('#hud-enemy').boundingBox(),
    ]);

    expect(stage).not.toBeNull();
    expect(dock).not.toBeNull();
    expect(dock.y).toBeGreaterThanOrEqual(stage.y + stage.height - 0.5);
    expect(dock.y + dock.height).toBeLessThanOrEqual(viewport.height);
    expect(intersects(stage, dock)).toBe(false);
    for (const plate of plates) {
      expect(plate).not.toBeNull();
      expect(plate.y + plate.height).toBeLessThanOrEqual(stage.y + 0.5);
      expect(intersects(stage, plate)).toBe(false);
    }

    const plateNumbers = await page
      .locator(
        '#hud-player .plate-hp-number, #hud-player .plate-surge-number, #hud-enemy .plate-hp-number, #hud-enemy .plate-surge-number'
      )
      .evaluateAll((values) =>
        values.map((value) => ({
          clientWidth: value.clientWidth,
          scrollWidth: value.scrollWidth,
        }))
      );
    expect(plateNumbers).toHaveLength(4);
    for (const value of plateNumbers) {
      expect(value.clientWidth).toBeGreaterThan(0);
      expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth);
    }
  }
});
