import { test, expect } from '@playwright/test';
import { TRAINERS } from '../src/data/trainers.js';
import { arenaReady, expectNoRuntimeLeaks, installCompletedTutorial, watchRuntime } from './helpers.js';

test('boots in French, switches to complete English, and keeps a clean console', async ({ page }) => {
  const runtime = watchRuntime(page);
  await page.goto('/?seed=7');
  await expect(page.getByRole('heading', { name: 'Arène de Noam' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Combat libre/ })).toBeVisible();
  await page.goto('/?lang=en&seed=7&enemy=thornox,kordane,calderoc&enemyMove=toxic_spines,toxic_spines');
  await expect(page.getByRole('heading', { name: /Noam.s Arena/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Free Battle/ })).toBeVisible();
  await page.getByRole('button', { name: /Free Battle/ }).click();
  await page.locator('[data-creature="orakyn"]').click({ button: 'right' });
  await expect(page.locator('.creature-sheet-stats dt')).toHaveText(['HP', 'Attack', 'Defense', 'Speed']);
  await expect(page.locator('.creature-sheet')).not.toContainText('PV');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Fight!', exact: true }).click();
  await arenaReady(page);
  await expect(page.locator('[data-move]:enabled').first()).toBeVisible();
  await page.locator('[data-move]:enabled').first().click();
  await expect(page.locator('[data-move]:enabled').first()).toBeVisible({ timeout: 20000 });
  await page.locator('[data-action="open-switch"]').click();
  await expect(page.locator('.switch-option').first()).toContainText(/\d+\/\d+ HP/);
  await expect(page.locator('.switch-option').first()).not.toContainText('PV');
  await page.locator('[data-switch-index]').first().click();
  await expect(page.locator('[data-move]:enabled').first()).toBeVisible();
  await page.locator('[data-action="open-switch"]').click();
  await page.keyboard.press('Escape');
  const burnChip = page.locator('#hud-player .plate-status.status-burning').first();
  await expect(burnChip).toBeVisible({ timeout: 15000 });
  await expect(burnChip.locator('.status-icon-flame')).toHaveCount(1);
  await expectNoRuntimeLeaks(runtime);
});

test('title JOUER starts the next League battle with the saved team in two taps', async ({ page }) => {
  await installCompletedTutorial(page, { ladderVictories: 1, lastTeam: ['voltide', 'brontusk', 'mossaur'] });
  await page.goto('/?seed=5&animations=0');
  await page.getByRole('button', { name: /Jouer/ }).click();
  await arenaReady(page);
  await expect(page.locator('#fighter-player')).toHaveAttribute('data-creature', 'voltide');
  await expect(page.locator('#fighter-enemy')).toHaveAttribute('data-creature', TRAINERS[1].team[0]);
  await page.locator('[data-move]:enabled').first().click();
  await expect(page.locator('[data-move]:enabled').first()).toBeVisible({ timeout: 20000 });
});

test('settings, language, audio, motion, contrast and speed persist after reload', async ({ page }) => {
  await installCompletedTutorial(page, {
    muted: false,
    reducedMotion: false,
    highContrast: false,
    battleSpeed: 1,
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Réglages' }).click();
  // Réglages render once their chunk has loaded and the route transition runs: until then the
  // title shows, where a loose "EN" would also match other buttons.
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.getByRole('switch', { name: 'Mute sound' }).check();
  await page.getByRole('switch', { name: 'Reduced motion' }).check();
  await page.getByRole('switch', { name: 'High contrast' }).check();
  await expect(page.locator('body')).toHaveClass(/high-contrast/);
  await page.getByRole('button', { name: 'Fast ×2' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings & help' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Mute sound' })).toBeChecked();
  await expect(page.getByRole('switch', { name: 'Reduced motion' })).toBeChecked();
  await expect(page.getByRole('switch', { name: 'High contrast' })).toBeChecked();
  await expect(page.locator('body')).toHaveClass(/high-contrast/);
  await expect(page.getByRole('button', { name: 'Fast ×2' })).toHaveClass(/active/);
});

test('corrupt save recovers with a friendly notice', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('arene-de-noam-save', '{broken'));
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('sauvegarde abîmée');
  await expect(page.getByRole('heading', { name: 'Arène de Noam' })).toBeVisible();
});

test('WebGL failure has a friendly nonblank screen', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?failWebgl=1');
  await page.getByRole('button', { name: /Combat libre/ }).click();
  await page.getByRole('button', { name: /^Combattre/ }).click();
  await expect(page.getByText(/arène ne peut pas s’afficher/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Retour/ })).toBeVisible();
});

test('lost graphics context becomes a friendly recovery screen', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?animations=0');
  await page.getByRole('button', { name: /Combat libre/ }).click();
  await page.getByRole('button', { name: /^Combattre/ }).click();
  await page.locator('#arena').dispatchEvent('arena-context-lost');
  await expect(page.getByText(/affichage de l’arène s’est arrêté/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Retour/ })).toBeVisible();
});
