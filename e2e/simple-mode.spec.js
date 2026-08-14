import { test, expect } from '@playwright/test';
import { installCompletedTutorial } from './helpers.js';

test('simple mode shows the matchup essentials and the settings toggle restores expert depth', async ({
  page,
}) => {
  await installCompletedTutorial(page, { expertMode: false });
  await page.goto('/?seed=14&animations=0&player=orakyn,abyssar,virelia&enemy=kordane,calderoc,farfombre&enemyMove=crystal_strike');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();

  await expect(page.locator('.battle-screen')).toHaveClass(/simple-mode/);
  await expect(page.locator('#hud-player .surge-caption')).toHaveText('Signature');
  await expect(page.locator('[data-move="lucid_arc"] .move-effectiveness.effective')).toContainText('▲');
  await expect(page.locator('[data-move] .move-archetype')).toHaveCount(0);
  await expect(page.locator('[data-move] .damage-preview')).toHaveCount(0);
  await expect(page.locator('[data-move] .move-context-source')).toHaveCount(0);
  await expect(page.locator('.exchange-preview')).toHaveCount(0);
  await expect(page.locator('[data-move] .move-combo-badge:visible')).toHaveCount(0);
  await expect(page.locator('.intent-read')).not.toContainText('Frappe cristal');
  await expect(page.locator('.arena-resonance, #contract-chip, .flow-chip')).toHaveCount(0);

  await page.locator('[data-move="lucid_arc"]').click();
  await expect(page.locator('[data-move="slowing_riddle"]')).toBeEnabled();
  await expect(page.locator('[data-move="slowing_riddle"] .move-combo-badge')).toContainText('COMBO +40%');
  await page.locator('[data-plate-side="enemy"]').click();
  await expect(page.locator('.plate-detail-status')).toContainText('Marqué');
  await expect(page.locator('.plate-detail-status small')).toHaveCount(0);
  await page.locator('[data-action="close-plate"]').click();
  await page.locator('[data-move="slowing_riddle"]').click();
  await expect(page.locator('#hud-player .plate-surge-number')).not.toContainText('30/100');

  await page.goto('/');
  await page.getByRole('button', { name: /Réglages/ }).click();
  await expect(page.getByText('Détails tactiques', { exact: true })).toBeVisible();
  await page.locator('#expert-mode').check();
  await expect(page.locator('#expert-mode')).toBeChecked();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('arene-de-noam-save')).expertMode))
    .toBe(true);

  await page.goto('/?seed=14&animations=0&player=orakyn,abyssar,virelia&enemy=kordane,calderoc,farfombre&enemyMove=crystal_strike');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(page.locator('.battle-screen')).toHaveClass(/expert-mode/);
  await expect(page.locator('#hud-player .surge-caption')).toHaveText('Éclat');
  await expect(page.locator('[data-move] .move-archetype').first()).toBeVisible();
  await expect(page.locator('[data-move] .move-context-source')).toHaveCount(3);
  await expect(page.locator('.exchange-preview')).toHaveCount(2);
  await expect(page.locator('.intent-read')).toContainText('Frappe cristal');
  await page.locator('[data-plate-side="player"]').click();
  await expect(page.locator('.plate-detail-talent p')).toBeVisible();
  await page.locator('[data-action="close-plate"]').click();
  await expect(page.locator('.arena-resonance, #contract-chip, .flow-chip')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('arene-de-noam-save')).version))
    .toBe(15);
});
