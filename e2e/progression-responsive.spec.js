import { test, expect } from '@playwright/test';
import { TRAINERS } from '../src/data/trainers.js';
import {
  arenaReady,
  expectNoRuntimeLeaks,
  installCompletedTutorial,
  playVisibleBattle,
  watchRuntime,
} from './helpers.js';

const PHONE = { width: 360, height: 800 };

// Every side mode is open (badge gating comes from ladderVictories).
const ALL_MODES = { ladderVictories: 6 };

async function expectInFirstViewport(page, locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
}

test('a ladder victory awards progress and opens the next authored opponent', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=1&animations=0&player=voltide,brontusk,mossaur&enemyHp=1');
  await page.locator('[data-action="continue"]').click();
  await arenaReady(page);
  await playVisibleBattle(page);
  await expect(page.getByRole('heading', { name: 'Victoire !' })).toBeVisible();
  // "Next rival" starts the League's second authored battle straight away.
  await page.locator('[data-action="next-battle"]').click();
  await arenaReady(page);
  await expect(page.locator('#fighter-enemy')).toHaveAttribute('data-creature', TRAINERS[1].team[0]);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('arene-de-noam-save')));
  expect(saved.ladderVictories).toBe(1);
  expect(saved.records.voltide.battles).toBe(1);
  expect(saved.records.brontusk.battles).toBe(1);
  expect(saved.records.mossaur.battles).toBe(1);
  expect(
    saved.records.voltide.damage + saved.records.brontusk.damage + saved.records.mossaur.damage
  ).toBeGreaterThan(0);
});

test('a first League win celebrates the badge and the mode it opens; a replay does not', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await installCompletedTutorial(page, { ladderVictories: 5 });
  await page.goto('/?seed=1&animations=0&player=voltide,brontusk,mossaur&enemyHp=1');
  await page.locator('[data-action="continue"]').click();
  await arenaReady(page);
  await playVisibleBattle(page);
  const hero = page.locator('.rs-hero--badge');
  await expect(hero.getByRole('img', { name: 'Diamant de Fer' })).toBeVisible();
  await expect(hero).toContainText('6/12');
  // Badge 6 opens the Pioche du jour.
  await expect(page.locator('.rs-unlock--draft')).toBeVisible();
  await expect(page.locator('.rs-unlock')).toHaveCount(1);
  await expectInFirstViewport(page, page.locator('[data-action="next-battle"]'));
  await page.locator('[data-action="result-recap"]').click();
  await expect(page.locator('.rs-badges .badge-art--earned')).toHaveCount(6);
  await expect(page.locator('.rs-badges .badge-art--locked')).toHaveCount(6);
  await page.keyboard.press('Escape');
  // Beating the same rival again earns nothing new.
  await page.locator('[data-action="rematch"]').click();
  await arenaReady(page);
  await playVisibleBattle(page);
  await expect(page.getByRole('heading', { name: 'Victoire !' })).toBeVisible();
  await expect(page.locator('.rs-hero--badge, .rs-badge-card, .rs-unlock')).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('arene-de-noam-save')));
  expect(saved.ladderVictories).toBe(6);
});

test('the League card fights with the saved team, or opens team select first', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await installCompletedTutorial(page, { ladderVictories: 2 });
  await page.goto('/?animations=0');
  await page.locator('[data-action="league"]').first().click();
  await expect(page.getByRole('heading', { name: 'Carte de la Ligue' })).toBeVisible();
  await expect(page.locator('.league-node')).toHaveCount(12);
  await expect(page.locator('.league-node.cleared')).toHaveCount(2);
  await expect(page.locator('.league-node.current')).toHaveCount(1);
  await expect(page.locator('.league-node.locked')).toHaveCount(9);
  await expect(page.locator('.league-node.current')).toHaveAttribute('aria-pressed', 'true');
  const card = page.locator('.league-card');
  await expect(card).toContainText('Rival 3/12');
  await expect(card.locator('.weather-chip')).toHaveCount(2);
  await expect(page.locator('.primary-btn')).toHaveCount(1);
  await expectInFirstViewport(page, page.locator('[data-action="league-fight"]'));
  await expectInFirstViewport(page, page.locator('[data-action="league-team"]'));
  await page.locator('[data-league-node="5"]').click();
  await expect(card).toContainText('???');
  await expect(card.locator('button')).toHaveCount(0);
  // A cleared rival: "Changer d'équipe" prepares the duel in team select…
  await page.locator('[data-league-node="0"]').click();
  await expect(page.locator('[data-league-node="0"]')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Changer d’équipe' }).click();
  await expect(page.locator('#screen')).toHaveAttribute('data-page', 'selection');
  await expect(page.locator('.ts-rival')).toContainText('Gardienne de l’Aube');
  // …while the gold button replays it straight away with the saved team, like JOUER.
  await page.locator('[data-action="back"]').click();
  await expect(page.locator('#screen')).toHaveAttribute('data-page', 'league');
  await expect(page.locator('[data-league-node="0"]')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Rejouer ce duel' }).click();
  await arenaReady(page);
  await expect(page.locator('#fighter-enemy')).toHaveAttribute('data-creature', TRAINERS[0].team[0]);
  await expect(page.locator('#fighter-player')).toHaveAttribute('data-creature', 'orakyn');
});

test('all six arena themes render without runtime errors', async ({ page }) => {
  const runtime = watchRuntime(page);
  await installCompletedTutorial(page);
  for (const arena of ['crystal', 'grove', 'tidal', 'volcano', 'astral', 'eclipse']) {
    await page.goto(`/?seed=8&animations=0`);
    await page.locator('[data-action="quick"]').click();
    await page.locator('[data-action="open-options"]').click();
    await page.locator(`[data-arena-pick="${arena}"]`).click();
    await page.keyboard.press('Escape');
    await page.locator('[data-action="start-battle"]').click();
    await arenaReady(page);
  }
  await expectNoRuntimeLeaks(runtime);
});

test('Bestiary is a compact grid with one sticky search row and a creature sheet', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await installCompletedTutorial(page, {
    records: {
      orakyn: { battles: 7, wins: 5, damage: 1234, kos: 9, signatures: 2, combos: 4, assists: 3 },
      kordane: { battles: 3, wins: 2, damage: 400, kos: 2, signatures: 1, combos: 0, assists: 0 },
    },
  });
  await page.goto('/');
  await page.locator('[data-action="bestiary"]').click();
  await expect(page.locator('.bestiary-card')).toHaveCount(30);
  expect(await page.locator('#screen *').count()).toBeLessThan(800);
  await expect(page.locator('[data-bestiary-affinity]')).toHaveCount(7);
  await expect(page.locator('[data-bestiary-class]')).toHaveCount(7);
  await page.locator('[data-bestiary-toggle]').click();
  await page.locator('[data-bestiary-affinity="force"]').click();
  await expect(page.locator('.bestiary-card:not([hidden])')).toHaveCount(5);
  await expect(page.locator('[data-bestiary-count]')).toHaveText('5/30');
  await page.locator('[data-bestiary-affinity="all"]').click();
  await page.locator('[data-bestiary-class="breaker"]').click();
  await expect(page.locator('.bestiary-card:not([hidden])')).toHaveCount(5);
  await page.locator('[data-bestiary-class="all"]').click();
  await page.getByLabel('Rechercher une créature').fill('Orakyn');
  await expect(page.locator('.bestiary-card:not([hidden])')).toHaveCount(1);
  await page.getByLabel('Rechercher une créature').fill('zzz');
  await expect(page.locator('.bestiary-empty')).toBeVisible();
  await page.locator('[data-bestiary-clear]').click();
  await expect(page.locator('.bestiary-card:not([hidden])')).toHaveCount(30);
  await page.locator('#screen').evaluate((node) => node.scrollTo(0, 600));
  const tools = await page.locator('.bestiary-tools').boundingBox();
  expect(tools.y).toBeLessThanOrEqual(1);

  await page.locator('[data-bestiary-open="orakyn"]').click();
  const sheet = page.getByRole('dialog', { name: 'Orakyn' });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('[data-preview-move]')).toHaveCount(3);
  await expect(sheet.locator('.creature-record')).toContainText('7combats');
  await expect(sheet.locator('.creature-record .legacy-record')).toContainText('3');
  await expect(sheet.locator('.chroma-row.locked')).toBeVisible();
  await expect(sheet.locator('[data-action="bestiary-watch"]')).toHaveClass(/primary-btn/);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  await page.locator('[data-action="bestiary-stats"]').click();
  await expect(page.locator('.record-hero')).toContainText('PARTENAIRE FÉTICHE');
  await expect(page.locator('.record-hero')).toContainText('Orakyn');
  await expect(page.locator('.record-hero')).toContainText('1234');
});

test('the Mes stats sheet reveals earned feats', async ({ page }) => {
  await installCompletedTutorial(page, { feats: ['first_signature', 'perfect_relay', 'team_assist'] });
  await page.goto('/');
  await page.locator('[data-action="bestiary"]').click();
  await page.locator('[data-action="bestiary-stats"]').click();
  await expect(page.locator('.feat-card')).toHaveCount(10);
  await expect(page.locator('.feat-card.earned')).toHaveCount(3);
  await expect(page.locator('.feat-hall .eyebrow')).toHaveText('3/10');
  await expect(page.locator('.feat-hall')).toContainText('Changement parfait');
  await expect(page.locator('.feat-hall')).toContainText('Plus forts ensemble');
});

test('a mastered creature toggles its Chromatique from the Bestiary sheet', async ({ page }) => {
  await installCompletedTutorial(page, { mastery: { orakyn: 60 } });
  await page.goto('/');
  await page.locator('[data-action="bestiary"]').click();
  const card = page.locator('[data-bestiary-open="orakyn"]');
  await expect(card.locator('.bestiary-chroma')).toHaveCount(1);
  await card.click();
  const toggle = page.locator('[data-chromatique="orakyn"]');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.creature-sheet-portrait img')).toHaveAttribute('src', /battle-shiny\.png$/);
  await expect(card.locator('img')).toHaveAttribute('src', /battle-shiny\.png$/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('arene-de-noam-save')));
  expect(saved.chromatiques).toEqual({ orakyn: true });
  await toggle.click();
  await expect(card.locator('img')).toHaveAttribute('src', /battle\.png$/);
});

test('the École type wheel explains matchups, weather, coverage and the 8 effects', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await installCompletedTutorial(page);
  await page.goto('/');
  await page.locator('[data-action="academy"]').click();
  await expect(page.getByRole('heading', { name: 'École de l’arène' })).toBeVisible();
  await expect(page.locator('[data-academy-type]')).toHaveCount(6);
  // The lead of the saved team (Orakyn, Psy) is preselected.
  await expect(page.locator('[data-academy-type="mind"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-academy-type="flame"]').click();
  const detail = page.locator('.type-detail');
  await expect(detail.locator('.type-matchups .good')).toContainText('Plante');
  await expect(detail.locator('.type-matchups .good')).toContainText('×2');
  await expect(detail.locator('.type-matchups .bad')).toContainText('Eau');
  await expect(detail.locator('.type-matchups .bad')).toContainText('×0,5');
  await expect(detail.locator('.type-weather')).toContainText('Forge du volcan');
  await expect(detail.locator('.type-coverage li')).toHaveCount(5);
  await expect(page.locator('.type-edge.good')).toHaveCount(1);
  await expect(page.locator('.type-edge.bad')).toHaveCount(1);
  await expect(page.locator('.academy-weather li')).toHaveCount(6);
  await expect(page.locator('.academy-core')).toHaveCount(8);
  await expect(page.locator('.academy-class')).toHaveCount(6);
  await expect(page.locator('.academy-class').filter({ hasText: 'Défenseur' })).toHaveCount(1);
  await expect(page.locator('.academy-status')).toHaveCount(8);
  await expect(page.locator('.academy-status.positive')).toHaveCount(4);
  await expect(page.locator('.academy-status.negative')).toHaveCount(4);
  await expect(page.locator('.academy-status .status-icon')).toHaveCount(8);
  expect(
    await page.locator('.academy-status').evaluateAll((cards) => cards.map((card) => card.dataset.status))
  ).toEqual(['focused', 'haste', 'evasive', 'countering', 'marked', 'rooted', 'stunned', 'burning']);
  // No word on the screen is smaller than 12 px.
  const smallest = await page
    .locator('#screen')
    .evaluate((root) =>
      Math.min(
        ...[...root.querySelectorAll('*')]
          .filter((node) =>
            [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim())
          )
          .map((node) => parseFloat(getComputedStyle(node).fontSize))
      )
    );
  expect(smallest).toBeGreaterThanOrEqual(12);
  const cta = page.locator('[data-action="academy-bestiary"]');
  await expectInFirstViewport(page, cta);
  await cta.click();
  await expect(page.getByRole('heading', { name: 'Bestiaire' })).toBeVisible();
});

test('Bestiary Move Theater plays techniques on the battle stage above the creature sheet', async ({
  page,
}) => {
  await installCompletedTutorial(page, { reducedMotion: false, battleSpeed: 1 });
  await page.goto('/');
  await page.locator('[data-action="bestiary"]').click();
  await page.locator('[data-bestiary-open="orakyn"]').click();
  const trigger = page.locator('[data-preview-move="lucid_arc"]');
  await trigger.click();
  const theater = page.getByRole('dialog', { name: 'Théâtre des techniques' });
  await expect(theater).toBeVisible();
  await expect(theater).toHaveAttribute('data-move', 'lucid_arc');
  // The battle's WebGL stage: arena canvas and named fighter proxies (orakyn vs its sparring partner).
  await expect(theater.locator('.theater-stage #arena')).toBeVisible();
  await expect(theater.locator('#fighter-player')).toHaveAttribute('data-creature', 'orakyn');
  await expect(theater.locator('#fighter-enemy')).toHaveAttribute('data-creature', 'abyssar');
  await expect(theater.locator('.theater-head .status-badge[data-status="marked"]')).toContainText('Marqué');
  await expect(page.getByRole('button', { name: 'Fermer' }).last()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /Rejouer/ })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  // The director plays the move: its contact readout lands on the partner.
  await expect(theater).toHaveAttribute('data-state', 'done', { timeout: 15000 });
  const number = theater.locator('#fx-text .fx-number[data-side="enemy"][data-kind="damage"] .fx-value');
  await expect(number).toHaveText(/^−\d+$/);
  await page.getByRole('button', { name: /Rejouer/ }).click();
  await expect(theater).toHaveAttribute('data-state', 'playing');
  await expect(theater).toHaveAttribute('data-state', 'done', { timeout: 15000 });
  // Escape closes the theater first, then the sheet, then goes up to the title.
  await page.keyboard.press('Escape');
  await expect(page.locator('.move-theater')).toHaveCount(0);
  await expect(page.locator('#arena')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet-layer .sheet[aria-modal="true"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#screen')).toHaveAttribute('data-page', 'title');
});

test('mythic trials are list rows with one gold button and launch with modifiers', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await installCompletedTutorial(page, { ...ALL_MODES, lastTeam: ['solflare', 'lumivox', 'voltide'] });
  await page.goto('/?seed=61&animations=0');
  await page.locator('[data-action="challenges"]').click();
  await page.locator('[data-action="trials"]').click();
  await expect(page.locator('.trial-row')).toHaveCount(6);
  await expect(page.locator('.primary-btn')).toHaveCount(1);
  await expect(page.locator('.trial-row.selected')).toContainText(/Signatures ✦ sont prêtes/);
  await expectInFirstViewport(page, page.locator('[data-action="trial-0"]'));
  await page.locator('[data-trial-select="3"]').click();
  await expect(page.locator('[data-trial-select="3"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.primary-btn')).toHaveCount(1);
  await page.locator('[data-trial-select="0"]').click();
  await expect(page.locator('[data-trial-select="3"]')).toHaveAttribute('aria-expanded', 'false');
  // Tapping the open row folds it; the list then has no gold button.
  await page.locator('[data-trial-select="0"]').click();
  await expect(page.locator('[data-trial-select="0"]')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.primary-btn')).toHaveCount(0);
  await page.locator('[data-trial-select="0"]').click();
  await page.getByRole('button', { name: 'Jouer cette épreuve' }).click();
  await expect(page.locator('#screen')).toHaveAttribute('data-page', 'selection');
  await page.locator('[data-action="start-battle"]').click();
  await page.locator('[data-action="battle-pause"]').click();
  await expect(page.locator('.pause-context')).toContainText('Tempête de Signatures');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-move="supernova"]')).toBeEnabled();
});

test('the Expédition shows the next rival and lead first, then a picked boon and Continuer', async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await installCompletedTutorial(page, ALL_MODES);
  // Seed 38: the first-move autoplay wins battle 1 with Mossaur and Magmoth K.O. (the camp revives
  // them at 40%) and Monolith at 35%.
  await page.goto('/?seed=38&animations=0&player=mossaur,magmoth,monolith');
  await page.locator('[data-action="challenges"]').click();
  await page.locator('[data-action="gauntlet"]').click();
  await page.locator('[data-action="start-battle"]').click();
  await arenaReady(page);
  await playVisibleBattle(page);
  await page.locator('[data-action="next-stage"]').click();
  await expect(page.getByRole('heading', { name: 'Choisis une faveur' })).toBeVisible();
  await expect(page.locator('.gauntlet-next')).toContainText('Le Couloir des Tempêtes');
  await expect(page.locator('[data-gauntlet-lead]')).toHaveCount(3);
  await expect(page.locator('[data-gauntlet-lead].recommended')).toHaveCount(1);
  // "Qui commence ?" opens on the Conseillé creature.
  await expect(page.locator('[data-gauntlet-lead].recommended')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.gauntlet-leads')).toContainText('Mossaur');
  await expect(page.locator('.gauntlet-leads')).toContainText(/40\s%/);
  await expect(page.locator('[data-boon]')).toHaveCount(4);
  const next = page.locator('[data-action="gauntlet-continue"]');
  await expect(next).toBeDisabled();
  await expectInFirstViewport(page, next);
  await page.locator('[data-gauntlet-lead="1"]').click();
  await expect(page.locator('[data-gauntlet-lead="1"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-gauntlet-lead="0"]').click();
  await page.locator('[data-boon="surge"]').click();
  await expect(page.locator('[data-boon="surge"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#screen')).toHaveAttribute('data-page', 'gauntlet-boon');
  await next.click();
  await page.locator('[data-action="battle-pause"]').click();
  await expect(page.locator('.pause-context')).toContainText(/Couloir des Tempêtes · 2\/3/);
  await page.keyboard.press('Escape');
  // The picked Réserve stellaire boon carries in (+25 on the opening 30), with the camp's HP.
  await expect(page.locator('#hud-player')).toContainText('55/100');
  await expect(page.locator('#hud-player')).toContainText('54/134');
});

test('leaving an Expédition between stages asks first; a run left from battle resumes', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await installCompletedTutorial(page, ALL_MODES);
  await page.goto('/?seed=38&animations=0&player=mossaur,magmoth,monolith');
  const onPage = (name) => expect(page.locator('#screen')).toHaveAttribute('data-page', name);
  const run = () =>
    page.evaluate(async () => {
      const { gauntletRun } = (await import('./src/app/context.js')).ctx;
      return gauntletRun && { stage: gauntletRun.stage, boons: gauntletRun.boons };
    });
  await page.locator('[data-action="challenges"]').click();
  await page.locator('[data-action="gauntlet"]').click();
  await page.locator('[data-action="start-battle"]').click();
  await arenaReady(page);
  await playVisibleBattle(page);
  // Stage results: Escape and Accueil ask; staying keeps the run.
  await page.keyboard.press('Escape');
  await page.locator('[data-action="leave-cancel"]').click();
  await page.locator('[data-action="title"]').click();
  await page.locator('[data-action="leave-cancel"]').click();
  await onPage('results');
  expect(await run()).toEqual({ stage: 0, boons: [] });
  // Faveurs: back asks too. Take a faveur and play on, then abandon the stage-2 battle.
  await page.locator('[data-action="next-stage"]').click();
  await page.locator('[data-action="back"]').click();
  await page.locator('[data-action="leave-cancel"]').click();
  await onPage('gauntlet-boon');
  await page.locator('[data-boon="surge"]').click();
  await page.locator('[data-action="gauntlet-continue"]').click();
  await arenaReady(page);
  await page.locator('[data-action="battle-pause"]').click();
  await page.locator('[data-action="battle-abandon"]').click();
  await page.locator('[data-action="battle-abandon-confirm"]').click();
  await onPage('title');
  // The live run resumes from Défis at the faveur screen, faveur kept.
  await page.locator('[data-action="challenges"]').click();
  const resume = page.locator('[data-action="gauntlet"][data-resume]');
  await expect(resume).toContainText('2/3');
  await resume.click();
  await onPage('gauntlet-boon');
  await expect(page.locator('.boon-card.held')).toHaveCount(1);
  await expect(page.locator('[data-action="gauntlet-continue"]')).toBeEnabled();
  // Confirming the leave drops the run: the Expédition starts over.
  await page.keyboard.press('Escape');
  await page.locator('[data-action="leave-confirm"]').click();
  await onPage('title');
  expect(await run()).toBeNull();
  await page.locator('[data-action="challenges"]').click();
  await expect(page.locator('[data-action="gauntlet"][data-resume]')).toHaveCount(0);
});

test('the tutorial ends on a real Victoire that awards XP, then leads to team select', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/?seed=4242&animations=0');
  await page.locator('[data-action="play"]').first().click();
  const target = page.locator('.battle-screen:not(.locked) .tutorial-target');
  for (let lesson = 0; lesson < 4; lesson++) {
    await expect(target).toBeEnabled({ timeout: 15000 });
    const opensSwitch = (await target.getAttribute('data-action')) === 'open-switch';
    await target.click();
    if (opensSwitch) await page.locator('[data-switch-index]').filter({ hasText: 'Abyssar' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Victoire !' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.rs-row')).toHaveCount(2);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('arene-de-noam-save')));
  expect(saved.tutorialComplete).toBe(true);
  expect(saved.battlesPlayed).toBe(1);
  expect(saved.mastery.orakyn).toBeGreaterThan(0);
  expect(saved.mastery.abyssar).toBeGreaterThan(0);
  await page.locator('[data-action="pick-team"]').click();
  await expect(page.locator('#screen')).toHaveAttribute('data-page', 'selection');
  await expect(page.locator('.ts-guide')).toContainText('Bravo');
});

test('a skipped tutorial greets team select without a Bravo', async ({ page }) => {
  await page.goto('/?seed=4242&animations=0');
  await page.locator('[data-action="play"]').first().click();
  await page.locator('.battle-screen:not(.locked) [data-action="skip-tutorial"]').click({ timeout: 15000 });
  await page.locator('[data-action="skip-confirm"]').click();
  await expect(page.locator('#screen')).toHaveAttribute('data-page', 'selection');
  await expect(page.locator('.ts-guide')).toBeVisible();
  await expect(page.locator('.ts-guide')).not.toContainText('Bravo');
});

test('a newly opened side mode is marked Nouveau until it is played', async ({ page }) => {
  await page.setViewportSize(PHONE);
  // Four badges: Expédition and Épreuves open; the Expédition was already won once.
  await installCompletedTutorial(page, { ladderVictories: 4, gauntletWins: 1 });
  await page.goto('/?animations=0');
  await expect(page.locator('.hub-tile--challenges .new-pill')).toBeVisible();
  await page.locator('[data-action="challenges"]').click();
  await expect(page.locator('.hub-challenge--trials .new-pill')).toBeVisible();
  await expect(page.locator('.hub-challenge--gauntlet .new-pill')).toHaveCount(0);
  await expect(page.locator('.hub-challenge--draft .new-pill')).toHaveCount(0);
  // A cleared trial counts as played: nothing is new any more.
  await page.evaluate(() => {
    const save = JSON.parse(localStorage.getItem('arene-de-noam-save'));
    localStorage.setItem('arene-de-noam-save', JSON.stringify({ ...save, trials: ['starstorm'] }));
  });
  await page.reload();
  await expect(page.locator('.hub-tile--challenges')).toBeVisible();
  await expect(page.locator('.new-pill')).toHaveCount(0);
});

test('the back gesture goes one level up, pauses battles and never leaves from inside', async ({ page }) => {
  await installCompletedTutorial(page, { ladderVictories: 2 });
  await page.goto('/?seed=5&animations=0');
  const onPage = (name) => expect(page.locator('#screen')).toHaveAttribute('data-page', name);
  await page.locator('[data-action="league"]').first().click();
  await page.locator('[data-league-node="0"]').click();
  await page.locator('[data-action="league-team"]').click();
  await onPage('selection');
  await page.goBack();
  await onPage('league');
  await page.goBack();
  await onPage('title');

  await page.locator('[data-action="academy"]').click();
  await page.locator('[data-action="academy-bestiary"]').click();
  await page.locator('[data-bestiary-open="orakyn"]').click();
  await page.goBack();
  await expect(page.locator('.sheet-layer .sheet[aria-modal="true"]')).toHaveCount(0);
  await onPage('bestiary');
  await page.goBack();
  await onPage('academy');
  await page.locator('[data-action="back"]').first().click();
  await onPage('title');

  await page.locator('[data-action="quick"]').click();
  await page.locator('[data-action="start-battle"]').click();
  await arenaReady(page);
  await onPage('battle');
  const token = await page.evaluate(
    async () => (await import('./src/app/context.js')).ctx.battleSession.sessionToken
  );
  await page.goBack();
  await expect(page.locator('.pause-sheet')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.pause-sheet')).toHaveCount(0);
  await onPage('battle');
  expect(
    await page.evaluate(async () => (await import('./src/app/context.js')).ctx.battleSession.sessionToken)
  ).toBe(token);
  await expect(page).toHaveURL(/seed=5/);
});

test('removed loadout systems stay absent and battle opens at neutral Signature', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=63&animations=0');
  await page.locator('[data-action="quick"]').click();
  await expect(page.locator('[data-doctrine], #contract-select, .team-bonds')).toHaveCount(0);
  await page.locator('[data-action="start-battle"]').click();
  await arenaReady(page);
  await expect(page.locator('#hud-player')).toContainText('30/100');
});

test('secondary screens fit phone, landscape and desktop: no horizontal clipping, one-line titles', async ({
  page,
}) => {
  await installCompletedTutorial(page, ALL_MODES);
  const open = {
    league: () => page.locator('[data-action="league"]').first().click(),
    bestiary: () => page.locator('[data-action="bestiary"]').click(),
    academy: () => page.locator('[data-action="academy"]').click(),
    trials: async () => {
      await page.locator('[data-action="challenges"]').click();
      await page.locator('[data-action="trials"]').click();
    },
    draft: async () => {
      await page.locator('[data-action="challenges"]').click();
      await page.locator('[data-action="draft"]').click();
    },
  };
  for (const viewport of [PHONE, { width: 800, height: 360 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    for (const go of Object.values(open)) {
      await page.goto('/?animations=0');
      await go();
      await expect(page.locator('.topbar-title h1')).toBeVisible();
      const size = await page.evaluate(() => {
        const h1 = document.querySelector('.topbar-title h1');
        return {
          body: document.documentElement.scrollWidth,
          screen: document.querySelector('#screen').scrollWidth,
          view: innerWidth,
          // The page title never wraps under its topbar actions.
          titleLines: Math.round(
            h1.getBoundingClientRect().height / parseFloat(getComputedStyle(h1).lineHeight)
          ),
        };
      });
      expect(size.body).toBeLessThanOrEqual(size.view);
      expect(size.screen).toBeLessThanOrEqual(size.view);
      expect(size.titleLines).toBe(1);
    }
  }
});

test('cold boot does not steal focus during initial title render', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?animations=0');
  await expect(page.locator('[data-action="quick"]')).toBeVisible();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test('navigation focuses the new heading and settings keep language focus', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?animations=0');
  await page.locator('[data-action="bestiary"]').click();
  await expect(page.getByRole('heading', { name: 'Bestiaire' })).toBeFocused();
  await expect(page.locator('#screen')).toHaveJSProperty('scrollTop', 0);
  await page.locator('[data-action="settings"]').click();
  const language = page.locator('[data-lang="en"]');
  await language.focus();
  await language.click();
  await expect(page.locator('[data-lang="en"]')).toBeFocused();
  await page.locator('[data-action="back"]').first().click();
  await expect(page.locator('#screen')).toHaveAttribute('data-page', 'bestiary');
});

test('daily Pioche du jour offers three rounds of distinct choices then reveals a rival', async ({
  page,
}) => {
  await installCompletedTutorial(page, ALL_MODES);
  await page.goto('/?seed=20260814&animations=0');
  await page.locator('[data-action="challenges"]').click();
  await page.locator('[data-action="draft"]').click();
  await expect(page.locator('[data-draft-pick]')).toHaveCount(3);
  const chosen = [];
  for (let round = 0; round < 3; round++) {
    // Every offer says what it would add to the trio picked so far.
    await expect(page.locator('.draft-offer-insight')).toHaveCount(3);
    const card = page.locator('[data-draft-pick]').first();
    chosen.push(await card.getAttribute('data-draft-pick'));
    await card.click();
  }
  expect(new Set(chosen).size).toBe(3);
  await expect(page.locator('.draft-offer-insight')).toHaveCount(0);
  await expect(page.locator('.draft-rival-team img')).toHaveCount(3);
  await page.locator('[data-action="draft-battle"]').click();
  await arenaReady(page);
  await expect(page.locator('#hud-player')).toContainText('30/100');
});
