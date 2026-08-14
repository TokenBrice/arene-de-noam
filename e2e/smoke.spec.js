import { test, expect } from '@playwright/test';
import { expectNoRuntimeLeaks, installCompletedTutorial, watchRuntime } from './helpers.js';

test('boots in French, switches to complete English, and keeps a clean console', async ({ page }) => {
  const runtime = watchRuntime(page);
  await page.goto('/?seed=7');
  await expect(page.getByRole('heading', { name: 'Arène de Noam' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Combat rapide/ })).toBeVisible();
  await page.goto('/?lang=en&seed=7');
  await expect(page.getByRole('heading', { name: /Noam.s Arena/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Quick Battle/ })).toBeVisible();
  await page.getByRole('button', { name: /Quick Battle/ }).click();
  await expect(page.locator('.mini-stats').first()).toContainText(/HP \d+ · ATK \d+ · GRD \d+ · SPD \d+/);
  await expect(page.locator('.mini-stats').first()).not.toContainText('PV');
  await page.getByRole('button', { name: /Enter the/ }).click();
  await expect(page.locator('[data-move]:enabled').first()).toBeVisible();
  await page.locator('[data-action="open-switch"]').click();
  await expect(page.locator('.switch-option').first()).toContainText(/\d+\/\d+ HP/);
  await expect(page.locator('.switch-option').first()).not.toContainText('PV');
  await expectNoRuntimeLeaks(runtime);
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
  await page.getByRole('button', { name: 'EN' }).click();
  await page.getByRole('checkbox', { name: 'Mute sound' }).check();
  await page.getByRole('checkbox', { name: 'Reduced motion' }).check();
  await page.getByRole('checkbox', { name: 'High contrast' }).check();
  await expect(page.locator('body')).toHaveClass(/high-contrast/);
  await page.getByRole('button', { name: 'Fast ×2' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings & help' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Mute sound' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Reduced motion' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'High contrast' })).toBeChecked();
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
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(page.getByText(/besoin de WebGL/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Retour/ })).toBeVisible();
});

test('lost graphics context becomes a friendly recovery screen', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?animations=0');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await page.locator('#arena').dispatchEvent('arena-context-lost');
  await expect(page.getByText(/graphique s’est interrompue/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Retour/ })).toBeVisible();
});
