import { test, expect } from '@playwright/test';
import {
  expectNoRuntimeLeaks,
  installCompletedTutorial,
  playVisibleBattle,
  watchRuntime,
} from './helpers.js';

test('a ladder victory awards an emblem and opens the next authored opponent', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=1&animations=0&player=voltide,brontusk,mossaur&enemyHp=1');
  await page.getByRole('button', { name: /Continuer/ }).click();
  await expect(page.getByRole('heading', { name: 'Gardienne de l’Aube' })).toBeVisible();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await playVisibleBattle(page);
  await expect(page.getByRole('heading', { name: 'Victoire !' })).toBeVisible();
  await page.getByRole('button', { name: /Combat suivant/ }).click();
  await expect(page.getByRole('heading', { name: 'Maître de la Vélocité' })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('arene-de-noam-save')));
  expect(saved.ladderVictories).toBe(1);
  expect(saved.emblems).toContain('dawn');
  expect(saved.records.voltide.battles).toBe(1);
  expect(saved.records.brontusk.battles).toBe(1);
  expect(saved.records.mossaur.battles).toBe(1);
  expect(
    saved.records.voltide.damage + saved.records.brontusk.damage + saved.records.mossaur.damage
  ).toBeGreaterThan(0);
});

test('League map reveals progress, conceals future rivals, and replays cleared duels', async ({ page }) => {
  await installCompletedTutorial(page, { ladderVictories: 2, emblems: ['dawn', 'velocity'] });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ligue des rivaux' }).first().click();
  await expect(page.getByRole('heading', { name: 'Carte de la Ligue' })).toBeVisible();
  await expect(page.locator('.league-rival')).toHaveCount(12);
  await expect(page.locator('.league-rival.cleared')).toHaveCount(2);
  await expect(page.locator('.league-rival.current')).toHaveCount(1);
  await expect(page.locator('.league-rival.locked')).toHaveCount(9);
  await expect(page.locator('.league-rival.locked').first()).toContainText('RIVAL INCONNU');
  await page.getByRole('button', { name: 'Rejouer ce duel' }).first().click();
  await expect(page.getByRole('heading', { name: 'Gardienne de l’Aube' })).toBeVisible();
  await expect(page.locator('.enemy-list')).toContainText('Orakyn');
});

test('all six arena themes render without runtime errors', async ({ page }) => {
  const runtime = watchRuntime(page);
  await installCompletedTutorial(page);
  for (const arena of ['crystal', 'grove', 'tidal', 'volcano', 'astral', 'eclipse']) {
    await page.goto(`/?seed=8&animations=0`);
    await page.getByRole('button', { name: /Combat rapide/ }).click();
    await page.getByLabel('Arène').selectOption(arena);
    await page.getByRole('button', { name: /Entrer dans/ }).click();
    await expect(page.locator('#arena')).toBeVisible();
  }
  await expectNoRuntimeLeaks(runtime);
});

test('expanded roster filters all 24 creatures and exposes authored kits', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await expect(page.locator('[data-creature]')).toHaveCount(24);
  await expect(page.locator('[data-squad]')).toHaveCount(8);
  await expect(page.locator('.profile-bars > span')).toHaveCount(4);
  await expect(page.locator('.selected-row.recommended-lead')).toHaveCount(1);
  await expect(page.locator('.selected-row.recommended-lead')).toContainText('Meneur conseillé');
  await page.locator('[data-squad="storm_circuit"]').click();
  await expect(page.locator('.team-profile')).toContainText('Contrôle');
  await expect(page.locator('[data-doctrine], #contract-select, .team-bonds')).toHaveCount(0);
  await page.locator('[data-filter="shadow"]').click();
  await expect(page.locator('[data-creature]')).toHaveCount(4);
  await page.locator('[data-creature="hexalune"]').click();
  await page.locator('[data-action="title"]').first().click();
  await page.getByRole('button', { name: /Bestiaire/ }).click();
  await expect(page.locator('.bestiary-card')).toHaveCount(24);
  await expect(page.getByText('Moisson de venin').first()).toBeVisible();
});

test('smart remix composes a fresh legal trio with a scouted lead', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  const before = await page
    .locator('.creature-card.selected')
    .evaluateAll((cards) => cards.map((card) => card.dataset.creature).join(','));
  await page.getByRole('button', { name: /Remixer le trio/ }).click();
  await expect(page.locator('.creature-card.selected')).toHaveCount(3);
  await expect(page.locator('.creature-card.lead')).toHaveCount(1);
  await expect(page.locator('[data-doctrine], .team-bonds')).toHaveCount(0);
  const after = await page
    .locator('.creature-card.selected')
    .evaluateAll((cards) => cards.map((card) => card.dataset.creature).join(','));
  expect(after).not.toBe(before);
});

test('three personal squad slots save, reload, and clear a team with its lead', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.locator('[data-squad="storm_circuit"]').click();
  await page.locator('[data-custom-save="0"]').click();
  await expect(page.locator('.custom-squad').first().locator('img')).toHaveCount(3);
  await page.locator('[data-squad="worldbreakers"]').click();
  await page.locator('[data-custom-load="0"]').click();
  await expect(page.locator('[data-creature="voltide"]')).toHaveClass(/selected/);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('arene-de-noam-save')));
  expect(stored.version).toBe(15);
  expect(stored.customSquads[0]).toEqual({ team: ['voltide', 'nymbloom', 'riptalon'], lead: 0 });
  await page.reload();
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await expect(page.locator('.custom-squad').first().locator('img')).toHaveCount(3);
  await page.locator('[data-custom-clear="0"]').click();
  await expect(page.locator('.custom-squad').first()).toContainText('Emplacement libre');
});

test('Bestiary preserves creature career records and highlights a favorite partner', async ({ page }) => {
  await installCompletedTutorial(page, {
    records: {
      orakyn: { battles: 7, wins: 5, damage: 1234, kos: 9, signatures: 2, combos: 4, assists: 3 },
      kordane: { battles: 3, wins: 2, damage: 400, kos: 2, signatures: 1, combos: 0, assists: 0 },
    },
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Bestiaire/ }).click();
  await expect(page.locator('.record-hero')).toContainText('PARTENAIRE FÉTICHE');
  await expect(page.locator('.record-hero')).toContainText('Orakyn');
  await expect(page.locator('.record-hero')).toContainText('1234');
  const card = page
    .locator('.bestiary-card')
    .filter({ has: page.getByRole('heading', { name: 'Orakyn', exact: true }) });
  await expect(card.locator('.creature-record')).toContainText('7combats');
  await expect(card.locator('.creature-record')).toContainText('4Combos');
  await expect(card.locator('.creature-record')).toContainText('3assistances (héritage)');
});

test('the feat hall reveals earned high-skill accomplishments', async ({ page }) => {
  await installCompletedTutorial(page, {
    feats: ['first_signature', 'perfect_relay', 'team_assist'],
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Bestiaire/ }).click();
  await expect(page.locator('.feat-card')).toHaveCount(10);
  await expect(page.locator('.feat-card.earned')).toHaveCount(3);
  await expect(page.locator('.feat-hall .eyebrow')).toHaveText('3/10');
  await expect(page.locator('.feat-hall')).toContainText('Lecture parfaite');
  await expect(page.locator('.feat-hall')).toContainText('Plus forts ensemble');
  await expect(page.locator('.feat-hall')).toContainText('hérité');
});

test('the tactical academy leads with eight essentials and every current effect', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Académie tactique/ }).click();
  await expect(page.getByRole('heading', { name: 'Académie de l’Arène' })).toBeVisible();
  await expect(page.locator('.academy-type-triangle')).toHaveCount(2);
  await expect(page.locator('.academy-affinity')).toHaveCount(6);
  await expect(page.locator('.academy-affinity').first()).toContainText('Eau');
  await expect(page.locator('.academy-affinity').first().locator('u')).toHaveAttribute('aria-label', 'Feu');
  await expect(page.locator('.academy-type-triangle.elemental')).toContainText(
    'Eau bat Feu, Feu bat Plante, Plante bat Eau.'
  );
  await expect(page.locator('.academy-type-triangle.tactical')).toContainText(
    'Psy bat Combat, Combat bat Ténèbres, Ténèbres bat Psy.'
  );
  await expect(page.locator('.academy-core')).toHaveCount(8);
  await expect(page.locator('.academy-core').first()).toContainText('Ton équipe et les PV');
  await expect(page.locator('.academy-core-3')).toContainText('×2');
  await expect(page.locator('.academy-core-3')).toContainText('×0,5');
  await expect(page.locator('.academy-status')).toHaveCount(8);
  await expect(page.locator('.academy-status.boon')).toHaveCount(4);
  await expect(page.locator('.academy-status.penalty')).toHaveCount(4);
  await expect(page.locator('.academy-status').filter({ hasText: '×2' })).toHaveCount(1);
  await expect(page.locator('.academy-status').filter({ hasText: '×2' })).toContainText('Brûlure');
  await expect(page.locator('.academy-status').filter({ hasText: 'Marqué' })).toContainText('Combo');
  await expect(page.locator('.academy-status').filter({ hasText: 'Marqué' })).toContainText('+40 %');
  await page.getByRole('button', { name: /Explorer les 72 techniques/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Bestiaire' })).toBeVisible();
});

test('Bestiary Move Theater replays all authored techniques accessibly', async ({ page }) => {
  await installCompletedTutorial(page, { reducedMotion: false, battleSpeed: 1 });
  await page.goto('/');
  await page.getByRole('button', { name: /Bestiaire/ }).click();
  await expect(page.locator('[data-preview-move]')).toHaveCount(72);
  await expect(page.locator('[data-bestiary-affinity]')).toHaveCount(7);
  await expect(page.locator('[data-bestiary-affinity="force"]')).toContainText('Combat');
  await expect(page.locator('[data-bestiary-affinity="force"] .affinity-icon')).toHaveCount(1);
  await page.locator('[data-bestiary-affinity="force"]').click();
  await expect(page.locator('.bestiary-card:not([hidden])')).toHaveCount(4);
  await expect(page.locator('[data-bestiary-count]')).toHaveText('4 / 24');
  await page.locator('[data-bestiary-affinity="all"]').click();
  await page.getByLabel('Rechercher une créature').fill('Orakyn');
  await expect(page.locator('.bestiary-card:not([hidden])')).toHaveCount(1);
  await page.getByLabel('Rechercher une créature').fill('');
  const trigger = page.locator('[data-preview-move="lucid_arc"]');
  await expect(trigger).toHaveAttribute('role', 'button');
  await trigger.click();
  await expect(page.getByRole('dialog', { name: 'Théâtre des techniques' })).toBeVisible();
  await expect(page.locator('#fx-stage')).toHaveClass(/move-lucid_arc/);
  await expect(page.locator('.theater-battlefield .fighter img')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Fermer' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /Rejouer/ })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Fermer' })).toBeFocused();
  await page.getByRole('button', { name: /Rejouer/ }).click();
  await expect(page.locator('#fx-stage')).toHaveClass(/move-lucid_arc/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.move-theater')).toHaveCount(0);
});

test('mythic trials expose six rule-bending encounters and launch with modifiers', async ({ page }) => {
  await installCompletedTutorial(page, { lastTeam: ['solflare', 'lumivox', 'voltide'] });
  await page.goto('/?seed=61&animations=0');
  await page.getByRole('button', { name: 'Épreuves' }).click();
  await expect(page.locator('.trial-card')).toHaveCount(6);
  await expect(page.getByText(/Les deux équipes commencent à 100 Éclat/)).toBeVisible();
  await page.getByRole('button', { name: 'Relever l’épreuve' }).first().click();
  await expect(page.getByRole('heading', { name: 'Tempête de Signatures' }).first()).toBeVisible();
  await expect(page.locator('[data-creature]')).toHaveCount(24);
  await expect(page.locator('.enemy-list img')).toHaveCount(3);
  await page.getByRole('button', { name: 'Relever l’épreuve' }).click();
  await expect(page.getByText('Tempête de Signatures')).toBeVisible();
  await expect(page.locator('#hud-player').getByText('100/80')).toBeVisible();
  await expect(page.locator('[data-move="supernova"]')).toBeEnabled();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('arene-de-noam-save')));
  expect(saved.difficulty).toBe('apprentice');
});

test('removed loadout systems stay absent and battle opens at neutral Surge', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=63&animations=0');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await expect(page.locator('[data-doctrine], #contract-select, .team-bonds')).toHaveCount(0);
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(page.locator('#hud-player')).toContainText('30/100');
});

test('the gauntlet carries a chosen boon into its second escalating battle', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=9&animations=0&player=mossaur,magmoth,monolith');
  await page.getByRole('button', { name: 'Traversée' }).click();
  await page.getByRole('button', { name: /Commencer la Traversée/ }).click();
  await playVisibleBattle(page);
  await expect(page.getByRole('heading', { name: 'Choisis une faveur' })).toBeVisible();
  await expect(page.locator('.gauntlet-condition')).toContainText('HALTE DU CAMP');
  await expect(page.locator('[data-gauntlet-lead]')).toHaveCount(3);
  await expect(page.locator('[data-gauntlet-lead].recommended')).toHaveCount(1);
  await expect(page.locator('.gauntlet-condition')).toContainText('Mossaur');
  await expect(page.locator('.gauntlet-condition')).toContainText('40%');
  await page.locator('[data-gauntlet-lead="1"]').click();
  await expect(page.locator('[data-gauntlet-lead="1"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-gauntlet-lead="0"]').click();
  await page.locator('[data-boon="surge"]').click();
  await expect(page.getByText(/Couloir des Tempêtes · 2\/3/)).toBeVisible();
  await expect(page.locator('#hud-player')).toContainText('55/100');
  await expect(page.locator('#hud-player')).toContainText('54/134');
});

test('daily draft offers three rounds of distinct choices then reveals a rival', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=20260814&animations=0');
  await page.getByRole('button', { name: 'Draft du jour' }).click();
  await expect(page.locator('[data-draft-pick]')).toHaveCount(3);
  await expect(page.locator('.draft-insight')).toHaveCount(3);
  const chosen = [];
  for (let round = 0; round < 3; round++) {
    const card = page.locator('[data-draft-pick]').first();
    chosen.push(await card.getAttribute('data-draft-pick'));
    await card.click();
    await expect(page.locator('.draft-insight')).toHaveCount(round === 2 ? 0 : 3);
  }
  expect(new Set(chosen).size).toBe(3);
  await expect(page.getByText('RIVAL RÉVÉLÉ')).toBeVisible();
  await expect(page.locator('.draft-rival-team img')).toHaveCount(3);
  await expect(page.locator('.team-profile .profile-bars > span')).toHaveCount(4);
  await expect(page.locator('[data-doctrine], .team-bonds')).toHaveCount(0);
  await expect(page.locator('.draft-slot.recommended')).toHaveCount(1);
  await page.locator('[data-draft-lead="2"]').click();
  await expect(page.locator('[data-draft-lead="2"]')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Entrer dans l’arène' }).click();
  await expect(page.locator('#arena')).toBeVisible();
  await expect(page.locator('#fighter-player')).toHaveAttribute('data-creature', chosen[2]);
  await expect(page.locator('#hud-player')).toContainText('30/100');
});

test('required viewports avoid horizontal clipping and survive rotation', async ({ page }) => {
  await installCompletedTutorial(page);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const size = await page.evaluate(() => ({ body: document.body.scrollWidth, view: innerWidth }));
    expect(size.body).toBeLessThanOrEqual(size.view);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?seed=4&animations=0');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await expect(page.locator('.mobile-selection-dock')).toBeVisible();
  await expect(page.locator('.mobile-selection-dock img')).toHaveCount(3);
  await page.getByRole('button', { name: /Plan de bataille/ }).click();
  const planBox = await page.locator('.select-aside').boundingBox();
  expect(planBox.y).toBeGreaterThanOrEqual(-1);
  expect(planBox.y).toBeLessThan(844);
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(page.locator('.arena-nameplate')).toBeVisible();
  await expect(page.locator('#contract-chip')).toHaveCount(0);
  const boxes = await page.locator('.battle-controls button').evaluateAll((buttons) =>
    buttons.map((button) => {
      const r = button.getBoundingClientRect();
      return { x: r.x, right: r.right, y: r.y, bottom: r.bottom, width: r.width, height: r.height };
    })
  );
  for (const box of boxes) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(390);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  const lineBox = await page.locator('.action-line').boundingBox(),
    moveBox = await page.locator('[data-move]').first().boundingBox();
  expect(lineBox.y + lineBox.height).toBeLessThan(moveBox.y);
  await expect(page.getByText('Tour 1')).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByText('Tour 1')).toBeVisible();
  await expect(page.locator('[data-move]').first()).toBeVisible();
});
