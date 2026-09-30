import { test, expect } from '@playwright/test';
import { SAVE_VERSION } from '../src/save.js';
import { arenaReady, installCompletedTutorial } from './helpers.js';

test('simple mode shows the matchup essentials and the settings toggle restores expert depth', async ({
  page,
}) => {
  await installCompletedTutorial(page, { expertMode: false });
  await page.goto(
    '/?seed=1024&animations=0&player=orakyn,abyssar,virelia&enemy=kordane,calderoc,farfombre&enemyMove=crystal_strike'
  );
  await page.locator('[data-action="quick"]').click();
  await page.locator('[data-action="start-battle"]').click();
  await arenaReady(page);
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
  await page.locator('[data-action="settings"]').click();
  const expert = page.getByRole('switch', { name: 'Détails tactiques' });
  await expect(expert).not.toBeChecked();
  await expert.click();
  await expect(expert).toBeChecked();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('arene-de-noam-save')).expertMode))
    .toBe(true);

  await page.goto(
    '/?seed=14&animations=0&player=orakyn,abyssar,virelia&enemy=kordane,calderoc,farfombre&enemyMove=crystal_strike'
  );
  await page.locator('[data-action="quick"]').click();
  await page.locator('[data-action="start-battle"]').click();
  await arenaReady(page);
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

const storedSave = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('arene-de-noam-save')));

test('settings switches and choices persist, fit one phone screen, and the reset asks in a sheet', async ({
  page,
}) => {
  await installCompletedTutorial(page, {
    muted: false,
    reducedMotion: false,
    expertMode: false,
    battleSpeed: 1,
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/?animations=0');
  await page.locator('[data-action="settings"]').click();
  const screen = page.locator('#screen');
  expect(await screen.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(0);

  for (const [name, key] of [
    ['Couper le son', 'muted'],
    ['Mouvements réduits', 'reducedMotion'],
    ['Contraste renforcé', 'highContrast'],
    ['Vibrations légères', 'haptics'],
  ]) {
    const toggle = page.getByRole('switch', { name });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect.poll(async () => (await storedSave(page))[key]).toBe(true);
  }
  await expect(page.locator('body')).toHaveClass(/high-contrast/);
  await expect(page.locator('body')).toHaveClass(/reduced-motion/);
  // Keyboard: Space flips a focused switch.
  const expert = page.getByRole('switch', { name: 'Détails tactiques' });
  await expert.focus();
  await page.keyboard.press('Space');
  await expect(expert).toBeChecked();
  await expect.poll(async () => (await storedSave(page)).expertMode).toBe(true);

  const hint = page.locator('#quality-hint'),
    autoHint = await hint.textContent();
  await page.locator('[data-quality="low"]').click();
  await expect(page.locator('[data-quality="low"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-quality="auto"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(hint).not.toHaveText(autoHint);
  await page.locator('[data-speed="2"]').click();
  await expect(page.locator('[data-speed="2"]')).toHaveClass(/active/);
  await expect.poll(async () => (await storedSave(page)).quality).toBe('low');
  await expect.poll(async () => (await storedSave(page)).battleSpeed).toBe(2);

  await page.reload();
  await page.locator('[data-action="settings"]').click();
  for (const name of [
    'Couper le son',
    'Mouvements réduits',
    'Contraste renforcé',
    'Vibrations légères',
    'Détails tactiques',
  ])
    await expect(page.getByRole('switch', { name })).toBeChecked();
  await expect(page.locator('[data-quality="low"]')).toHaveAttribute('aria-pressed', 'true');

  // Reset: cancelling keeps everything; confirming starts over on the title.
  await page.locator('[data-action="reset-save"]').click();
  const sheet = page.getByRole('dialog', { name: 'Effacer la progression' });
  await expect(sheet).toBeVisible();
  await sheet.locator('[data-action="reset-cancel"]').click();
  await expect(sheet).toHaveCount(0);
  expect((await storedSave(page)).haptics).toBe(true);
  await page.locator('[data-action="reset-save"]').click();
  await page.locator('[data-action="reset-confirm"]').click();
  await expect(page.locator('[data-page="title"]')).toBeVisible();
  const fresh = await storedSave(page);
  expect(fresh.haptics).toBe(false);
  expect(fresh.tutorialComplete).toBe(false);
  expect(fresh.chromatiques).toEqual({});
});

// Light vibrations follow the director's cue bus: one designed pulse per contact beat when on, and
// not a single call when off. `navigator.vibrate` is mocked; animations stay on (?animations=0 is
// silent by design).
async function recordVibrations(page) {
  await page.addInitScript(() => {
    window.vibrations = [];
    Object.defineProperty(Navigator.prototype, 'vibrate', {
      configurable: true,
      value: (pattern) => {
        window.vibrations.push(pattern);
        return true;
      },
    });
  });
}
async function playOneTurn(page) {
  await page.goto(
    '/?seed=1024&player=orakyn,abyssar,virelia&enemy=kordane,calderoc,farfombre&enemyMove=crystal_strike'
  );
  await page.locator('[data-action="quick"]').click();
  await page.locator('[data-action="start-battle"]').click();
  const lucidArc = page.locator('.battle-screen:not(.locked) [data-move="lucid_arc"]');
  await expect(lucidArc).toBeEnabled({ timeout: 45000 });
  await lucidArc.click();
  await expect(page.locator('.battle-screen:not(.locked) [data-move="lucid_arc"]')).toBeEnabled({
    timeout: 45000,
  });
  await expect(page.locator('#turn-chip b')).toHaveText('Tour 2');
  return page.evaluate(() => window.vibrations);
}

test('light vibrations pulse once per contact beat when on', async ({ page }) => {
  await recordVibrations(page);
  await installCompletedTutorial(page, { version: 18, haptics: true, reducedMotion: false, battleSpeed: 2 });
  const calls = await playOneTurn(page);
  // Faster Kordane lands a plain Frappe cristal first (18 ms), then the super-effective Arc lucide (28 ms).
  expect(calls).toEqual([18, 28]);
});

test('light vibrations turned off in settings make no vibration call at all', async ({ page }) => {
  await recordVibrations(page);
  await installCompletedTutorial(page, { version: 18, haptics: true, reducedMotion: false, battleSpeed: 2 });
  await page.goto('/?animations=0');
  await page.locator('[data-action="settings"]').click();
  const toggle = page.getByRole('switch', { name: 'Vibrations légères' });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect.poll(async () => (await storedSave(page)).haptics).toBe(false);
  expect(await playOneTurn(page)).toEqual([]);
});
