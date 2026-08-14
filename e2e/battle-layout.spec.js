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
    await page.getByRole('button', { name: /Entrer dans|Enter the/ }).click();

    await expect(page.locator('.battle-stage')).toBeVisible();
    await expect(page.locator('.intent-read')).toBeVisible();
    await expect(page.locator('#hud-player')).toContainText(/Barrière|Barrier/);
    await expect(page.locator('#hud-enemy')).toContainText(/Barrière|Barrier/);
    await expect(page.locator('[data-action="trainer-command"]')).toBeVisible();

    const stage = await page.locator('.battle-stage').boundingBox();
    const dock = await page.locator('.battle-command-dock').boundingBox();
    const plates = await Promise.all([
      page.locator('#hud-player').boundingBox(),
      page.locator('#hud-enemy').boundingBox(),
    ]);
    const visibleInfoBoxes = await page.locator('.battle-info-zone *').evaluateAll((elements) =>
      elements
        .map((element) => {
          const box = element.getBoundingClientRect();
          return {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            right: box.right,
          };
        })
        .filter((box) => box.width > 0 && box.height > 0)
    );
    const topBoxes = await page.locator('.battle-top, .battle-top *').evaluateAll((elements) =>
      elements
        .map((element) => {
          const box = element.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height };
        })
        .filter((box) => box.width > 0 && box.height > 0)
    );
    const topItems = await page.locator('.battle-top > *').evaluateAll((elements) =>
      elements
        .map((element) => {
          const box = element.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height };
        })
        .filter((box) => box.width > 0 && box.height > 0)
    );

    expect(stage).not.toBeNull();
    expect(dock).not.toBeNull();
    expect(dock.y).toBeGreaterThanOrEqual(stage.y + stage.height - 0.5);
    expect(dock.y + dock.height).toBeLessThanOrEqual(viewport.height);
    expect(intersects(stage, dock)).toBe(false);
    for (const box of visibleInfoBoxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(viewport.width);
    }
    for (const plate of plates) {
      expect(plate).not.toBeNull();
      expect(plate.y + plate.height).toBeLessThanOrEqual(stage.y + 0.5);
      expect(intersects(stage, plate)).toBe(false);
      for (const topBox of topBoxes) expect(intersects(topBox, plate)).toBe(false);
    }
    for (let left = 0; left < topItems.length; left++) {
      for (let right = left + 1; right < topItems.length; right++) {
        expect(intersects(topItems[left], topItems[right])).toBe(false);
      }
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

    const intentSize = await page.locator('#hud-enemy .intent-read').evaluate((intent) => ({
      clientHeight: intent.clientHeight,
      scrollHeight: intent.scrollHeight,
    }));
    expect(intentSize.clientHeight).toBeGreaterThan(0);
    expect(intentSize.scrollHeight).toBeLessThanOrEqual(intentSize.clientHeight);
  }
});
