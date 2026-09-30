import { test, expect } from '@playwright/test';
import { installCompletedTutorial } from './helpers.js';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 360, height: 800, minStage: 420 },
  { width: 412, height: 915, minStage: 470 },
  { width: 800, height: 360 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test('the battle HUD keeps the stage clear, readable and tappable from 320×568 to 1440×900', async ({
  page,
}) => {
  await installCompletedTutorial(page, { expertMode: false });

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/?seed=40&animations=0&player=orakyn,abyssar,virelia&enemy=hexalune,calderoc,farfombre');
    await page.getByRole('button', { name: /Combat rapide|Quick Battle/ }).click();
    const ruleSelect = page.getByLabel(/Règle du duel|Duel rule/);
    if (!(await ruleSelect.isVisible().catch(() => false))) {
      const plan = page.locator('details.battle-plan > summary').first();
      await plan.scrollIntoViewIfNeeded();
      await plan.click();
    }
    await ruleSelect.selectOption('fortress_duel');
    await page.getByRole('button', { name: /Entrer dans|Enter the/ }).click();
    await expect(page.locator('.battle-screen:not(.locked) [data-move]:enabled').first()).toBeVisible();

    // Portrait: a tab under the rival's plate. Landscape: the dock head, off the stage.
    const landscape = viewport.width > viewport.height;
    await expect(
      page.locator(landscape ? '#dock-head .intent-read' : '#hud-enemy .intent-read')
    ).toBeVisible();
    await expect(page.locator('#hud-player .plate-status[data-status="barrier"]')).toBeVisible();
    await expect(page.locator('#hud-enemy .plate-status[data-status="barrier"]')).toBeVisible();
    await expect(page.locator('#hud-player .team-dot')).toHaveCount(3);
    await expect(page.locator('#hud-enemy .plate-type .affinity-icon')).toBeVisible();

    const stage = await page.locator('.battle-stage').boundingBox();
    const dock = await page.locator('.battle-command-dock').boundingBox();
    // The dock is its own region: it never covers the stage, which keeps its rect.
    expect(intersects(stage, dock)).toBe(false);
    expect(dock.y + dock.height).toBeLessThanOrEqual(viewport.height + 0.5);
    if (viewport.minStage) expect(stage.height).toBeGreaterThanOrEqual(viewport.minStage);

    // Plates and the top row stay on screen and never overlap each other.
    const plates = await Promise.all(
      ['#hud-enemy .battle-plate', '#hud-player .battle-plate', '.battle-top'].map((selector) =>
        page.locator(selector).boundingBox()
      )
    );
    for (const box of plates) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
      expect(box.y).toBeGreaterThanOrEqual(0);
    }
    expect(intersects(plates[0], plates[1])).toBe(false);
    expect(intersects(plates[0], plates[2])).toBe(false);

    // Readability: nothing under 12 px in the dock, move names ≥ 16 px, taps ≥ 48 px, nothing clipped.
    const audit = await page.evaluate(() => {
      const dockNode = document.querySelector('.battle-command-dock'),
        walker = document.createTreeWalker(dockNode, NodeFilter.SHOW_TEXT),
        small = [];
      while (walker.nextNode()) {
        const element = walker.currentNode.parentElement;
        if (!walker.currentNode.textContent.trim() || !element.checkVisibility()) continue;
        if (parseFloat(getComputedStyle(element).fontSize) < 12) small.push(element.className);
      }
      const buttons = [...document.querySelectorAll('.battle-screen button')].filter((button) =>
        button.checkVisibility()
      );
      return {
        small,
        names: [...document.querySelectorAll('.move-tile .move-name')].map((name) =>
          parseFloat(getComputedStyle(name).fontSize)
        ),
        tinyTargets: buttons
          .map((button) => button.getBoundingClientRect())
          .filter((rect) => rect.width < 47.5 || rect.height < 47.5).length,
        clipped: [...document.querySelectorAll('.battle-command-dock *, .battle-plate *, .battle-top *')]
          .filter(
            (element) =>
              element.checkVisibility() &&
              !element.matches('.visually-hidden, .visually-hidden *') &&
              getComputedStyle(element).overflow !== 'visible' &&
              !element.matches('.plate-hp, .surge-track, .tile-sig-fill, .bench-mon') &&
              (element.scrollWidth > element.clientWidth + 1 ||
                element.scrollHeight > element.clientHeight + 1)
          )
          .map((element) => element.className),
      };
    });
    expect(audit.small).toEqual([]);
    for (const size of audit.names) expect(size).toBeGreaterThanOrEqual(16);
    expect(audit.tinyTargets).toBe(0);
    expect(audit.clipped).toEqual([]);

    // Dock tiles never overflow their grid cell horizontally.
    const tiles = await page
      .locator('.move-tile')
      .evaluateAll((nodes) => nodes.map((node) => ({ scroll: node.scrollWidth, client: node.clientWidth })));
    for (const tile of tiles) expect(tile.scroll).toBeLessThanOrEqual(tile.client + 1);
  }
});

test('the pause sheet opens from the top row and Escape, mid-turn included, and abandons in-sheet', async ({
  page,
}) => {
  await installCompletedTutorial(page, { expertMode: false });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/?seed=40&animations=0&player=orakyn,abyssar,virelia&enemy=kordane,calderoc,farfombre');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(page.locator('.battle-screen:not(.locked) [data-move]:enabled').first()).toBeVisible();

  await page.keyboard.press('Escape');
  const pause = page.getByRole('dialog', { name: 'Pause' });
  await expect(pause).toBeVisible();
  await expect(pause.locator('.pause-context')).toContainText('Dôme de cristal');
  await pause.locator('[data-speed="2"]').click();
  await expect(page.locator('.battle-top [data-action="battle-speed"]')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await pause.locator('[data-action="battle-abandon"]').click();
  await expect(pause.locator('.abandon-confirm')).toBeVisible();
  await pause.locator('[data-action="battle-abandon-cancel"]').click();
  await expect(pause.locator('.abandon-confirm')).toBeHidden();
  await page.getByRole('button', { name: 'Reprendre' }).click();
  await expect(pause).toHaveCount(0);

  await page.locator('[data-action="battle-pause"]').click();
  await page.locator('[data-action="battle-abandon"]').click();
  await page.locator('[data-action="battle-abandon-confirm"]').click();
  await expect(page.getByRole('heading', { name: 'Arène de Noam' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('arene-de-noam-save')).battleSpeed))
    .toBe(2);
});

test('switch sheet rows show HP and a verdict, and the recommendation never covers a portrait', async ({
  page,
}) => {
  await installCompletedTutorial(page, { expertMode: false });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(
    '/?seed=40&animations=0&player=orakyn,abyssar,virelia&enemy=kordane,calderoc,farfombre&enemyMove=crystal_strike'
  );
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await page.keyboard.press('c');
  const rows = page.locator('.switch-option');
  await expect(rows).toHaveCount(2);
  for (const row of await rows.all()) {
    await expect(row.locator('.switch-hp')).toBeVisible();
    await expect(row.locator('.switch-verdict')).toHaveText(/Résiste|Neutre|Risqué/);
  }
  const recommended = page.locator('.switch-option.recommended');
  await expect(recommended).toHaveCount(1);
  const [tab, portrait] = await Promise.all([
    recommended.locator('.switch-recommended').boundingBox(),
    recommended.locator('.switch-portrait').boundingBox(),
  ]);
  expect(intersects(tab, portrait)).toBe(false);
});
