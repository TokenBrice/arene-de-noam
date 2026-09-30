import { test, expect } from '@playwright/test';
import { SAVE_VERSION } from '../src/save.js';
import { installCompletedTutorial } from './helpers.js';

test('simple mode shows the matchup essentials and the settings toggle restores expert depth', async ({
  page,
}) => {
  await installCompletedTutorial(page, { expertMode: false });
  await page.goto(
    '/?seed=1024&animations=0&player=orakyn,abyssar,virelia&enemy=kordane,calderoc,farfombre&enemyMove=crystal_strike'
  );
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();

  await expect(page.locator('.battle-screen')).toHaveClass(/simple-mode/);
  const lucidArc = page.locator('[data-move="lucid_arc"]');
  await expect(lucidArc.locator('.move-effectiveness.effective')).toHaveText('Super efficace');
  await expect(lucidArc.locator('.tile-damage')).toHaveText(/^\d+$/);
  await expect(lucidArc.locator('.tile-disc .affinity-icon')).toBeVisible();
  await expect(page.locator('#hud-player .affinity-icon')).toBeVisible();
  // Tiles carry no sentences: the plain-language effect lives in the info sheet.
  await expect(page.locator('[data-move] .move-description, [data-move] .move-archetype')).toHaveCount(0);
  // Landscape (this 1280×720 viewport): the rival's intent leaves the stage for
  // the dock head, where it names the rival by its face.
  const intent = page.locator('#dock-head .intent-read');
  await expect(intent).toBeVisible();
  await expect(intent).not.toContainText('Frappe cristal');
  await expect(intent.getByRole('img', { name: 'Kordane' })).toBeVisible();
  await expect(page.locator('#hud-enemy .intent-read')).toHaveCount(0);
  // The rookie handicap reads at a glance: the rival's level beside the player's own.
  await expect(page.locator('#hud-enemy .plate-level')).toHaveText('Niv. 43');
  await expect(page.locator('#hud-player .plate-level')).toHaveText('Niv. 50');

  // A touch long-press opens the info sheet and does not play the move.
  await lucidArc.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true });
  const info = page.getByRole('dialog', { name: 'Arc lucide' });
  await expect(info).toBeVisible();
  await expect(info).toContainText('Marque la cible');
  await expect(info.locator('.move-fact.good')).toContainText('Super efficace ×2');
  await expect(info.locator('.exchange-preview')).toHaveCount(0);
  await expect(info.locator('[data-action="move-launch"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(info).toHaveCount(0);
  await expect(page.locator('#turn-chip b')).toHaveText('Tour 1');

  await lucidArc.click();
  await expect(page.locator('#turn-chip b')).toHaveText('Tour 2');
  await expect(page.locator('[data-move="slowing_riddle"]')).toBeEnabled();
  await expect(page.locator('[data-move="slowing_riddle"] .move-combo-badge')).toHaveText('COMBO');
  await page.locator('[data-plate-side="enemy"]').click();
  await expect(page.locator('.plate-detail-status')).toContainText('Marqué');
  await expect(page.locator('.plate-detail-status small')).toHaveCount(0);
  const marked = page.locator('.plate-detail-status[data-status="marked"]');
  await expect(marked).toHaveClass(/negative/);
  await expect(marked).toHaveAttribute('data-polarity', 'negative');
  await expect(marked.locator('.status-icon-target-lock')).toHaveCount(1);
  await expect(marked).toHaveCSS('--status-color', '#AD1457');
  await page.keyboard.press('Escape');
  // The info sheet's "Lancer !" plays the move.
  await page.locator('[data-move="slowing_riddle"]').click({ button: 'right' });
  await page.locator('[data-action="move-launch"]').click();
  await expect(page.locator('#turn-chip b')).toHaveText('Tour 3');
  await expect(page.locator('#hud-player .plate-surge-number')).not.toHaveText('30/100');

  await page.goto('/');
  await page.getByRole('button', { name: /Réglages/ }).click();
  await expect(page.getByText('Détails tactiques', { exact: true })).toBeVisible();
  await page.locator('#expert-mode').check();
  await expect(page.locator('#expert-mode')).toBeChecked();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('arene-de-noam-save')).expertMode))
    .toBe(true);

  await page.goto(
    '/?seed=14&animations=0&player=orakyn,abyssar,virelia&enemy=kordane,calderoc,farfombre&enemyMove=crystal_strike'
  );
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(page.locator('.battle-screen')).toHaveClass(/expert-mode/);
  // Expert only adds density: the same tiles and actions, plus a detail row.
  await expect(page.locator('[data-move]')).toHaveCount(3);
  await expect(page.locator('[data-action="open-switch"]')).toHaveCount(1);
  await expect(page.locator('[data-move] .tile-detail').first()).toBeVisible();
  await expect(page.locator('#hud-enemy .surge-row')).toHaveCount(1);
  await expect(page.locator('.intent-read')).toContainText('Frappe cristal');
  await page.locator('[data-move="lucid_arc"]').click({ button: 'right' });
  await expect(page.locator('.move-info .exchange-preview')).toContainText('Toi');
  await page.keyboard.press('Escape');
  await page.locator('[data-plate-side="player"]').click();
  await expect(page.locator('.plate-detail-talent p')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('arene-de-noam-save')).version))
    .toBe(SAVE_VERSION);
});
